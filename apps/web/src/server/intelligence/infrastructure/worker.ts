import { and, eq, lte } from "drizzle-orm";
import { ZodError } from "zod";
import type { JournalDb } from "@/db/connection";
import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
import { intelligenceWorkerLease } from "@/db/schema";
import { newUuid } from "@/server/ids";
import type { EffectStore, JobRecord, JobStore } from "../contracts/jobs";
import {
  WORKFLOW_EFFECT_HANDLER_ID,
  WORKFLOW_EFFECT_HANDLER_VERSION,
} from "../experience/workflows";
import {
  DISPATCH_LIMIT,
  POLL_INTERVAL_MS,
  StaleClaimError,
  WORKER_LEASE_MS,
  WORKER_LEASE_NAME,
  WORKER_RENEW_INTERVAL_MS,
} from "./jobs";
import type { OutboxDispatcher } from "./outbox";

/** The handler that runs the retention prune. */
export const RETENTION_HANDLER_ID = "retention";

/** The version of that handler. */
export const RETENTION_HANDLER_VERSION = "1";

/**
 * The durable worker (Phase 04).
 *
 * One worker holds the journal's lease, claims one job at a time and commits
 * the effect together with the acknowledgement. A worker that lost the lease
 * cannot acknowledge anything: the lease row carries the fence, and the job
 * carries the fence of its own claim.
 */

/** A handler that executes the work of one job kind. */
export interface JobHandler {
  readonly id: string;
  readonly version: string;
  run(tx: JournalTx, job: JobRecord): void;
}

/** What the worker is doing right now. */
export type WorkerState = "disabled" | "idle" | "working" | "blocked" | "stopped";

/** The worker's sanitized state: counters and codes, never payloads. */
export interface WorkerStatus {
  readonly state: WorkerState;
  readonly owner: string;
  readonly leaseHeld: boolean;
  readonly leaseUntil: number | null;
  readonly lastHeartbeatAt: number | null;
  readonly processed: number;
  readonly failed: number;
  readonly lastErrorCode: string | null;
}

/** A running worker. */
export interface WorkerHandle {
  stop(): Promise<void>;
}

/** The durable worker. */
export interface WorkerService {
  start(signal: AbortSignal): Promise<WorkerHandle>;
}

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** Whether an error is SQLite refusing a write because the journal is busy. */
const isBusy = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  String((error as { code: unknown }).code).startsWith("SQLITE_BUSY");

/**
 * Creates the worker.
 *
 * The clock and the handler registry are injected: the worker never reads a
 * global clock and never starts itself.
 */
export const createWorkerService = (deps: {
  db: JournalDb;
  jobs: JobStore;
  effects: EffectStore;
  dispatcher: OutboxDispatcher;
  handlers: readonly JobHandler[];
  clock: () => number;
  owner?: string;
  enabled?: boolean;
  pollIntervalMs?: number;
  dispatchLimit?: number;
  /** The durable scheduler, ticked on the worker's own connection and clock. */
  scheduler?: { scheduleDue(now: number): number };
}): WorkerService & {
  tick(now: number): Promise<boolean>;
  status(): WorkerStatus;
  stop(): Promise<void>;
} => {
  const owner = deps.owner ?? `worker-${newUuid()}`;
  const enabled = deps.enabled ?? true;
  const pollIntervalMs = deps.pollIntervalMs ?? POLL_INTERVAL_MS;
  const dispatchLimit = deps.dispatchLimit ?? DISPATCH_LIMIT;

  let state: WorkerState = enabled ? "idle" : "disabled";
  let fence: number | null = null;
  let leaseUntil: number | null = null;
  let lastHeartbeatAt: number | null = null;
  let processed = 0;
  let failed = 0;
  let lastErrorCode: string | null = null;
  let stopped = false;

  /**
   * Holds the journal's lease, renewing the one it already has.
   *
   * The lease is a single row. A worker that already owns it renews it under
   * the fence it observed; a worker that finds an expired lease takes it over
   * at a higher fence. A live lease owned by somebody else is never taken, so
   * a second launch stays blocked.
   */
  const holdLease = (now: number): boolean =>
    withConnectionTransaction(deps.db, (tx) => {
      const current = tx
        .select({
          owner: intelligenceWorkerLease.owner,
          fence: intelligenceWorkerLease.fence,
          leaseUntil: intelligenceWorkerLease.leaseUntil,
        })
        .from(intelligenceWorkerLease)
        .where(eq(intelligenceWorkerLease.name, WORKER_LEASE_NAME))
        .get();

      if (!current) {
        const created = tx
          .insert(intelligenceWorkerLease)
          .values({
            name: WORKER_LEASE_NAME,
            owner,
            fence: 1,
            leaseUntil: now + WORKER_LEASE_MS,
            heartbeatAt: now,
          })
          .onConflictDoNothing()
          .returning({ fence: intelligenceWorkerLease.fence })
          .get();
        if (!created) return false;
        fence = created.fence;
        leaseUntil = now + WORKER_LEASE_MS;
        lastHeartbeatAt = now;
        return true;
      }

      if (current.owner === owner && current.leaseUntil > now) {
        // The lease is still ours. It is refreshed on its own cadence, not on
        // every poll.
        if (lastHeartbeatAt !== null && now - lastHeartbeatAt < WORKER_RENEW_INTERVAL_MS) {
          fence = current.fence;
          leaseUntil = current.leaseUntil;
          return true;
        }
        const renewed = tx
          .update(intelligenceWorkerLease)
          .set({ leaseUntil: now + WORKER_LEASE_MS, heartbeatAt: now })
          .where(
            and(
              eq(intelligenceWorkerLease.name, WORKER_LEASE_NAME),
              eq(intelligenceWorkerLease.owner, owner),
              eq(intelligenceWorkerLease.fence, current.fence),
            ),
          )
          .run();
        if (renewed.changes !== 1) return false;
        fence = current.fence;
        leaseUntil = now + WORKER_LEASE_MS;
        lastHeartbeatAt = now;
        return true;
      }

      const taken = tx
        .update(intelligenceWorkerLease)
        .set({
          owner,
          fence: current.fence + 1,
          leaseUntil: now + WORKER_LEASE_MS,
          heartbeatAt: now,
        })
        .where(
          and(
            eq(intelligenceWorkerLease.name, WORKER_LEASE_NAME),
            eq(intelligenceWorkerLease.fence, current.fence),
            lte(intelligenceWorkerLease.leaseUntil, now),
          ),
        )
        .returning({ fence: intelligenceWorkerLease.fence })
        .get();
      if (!taken) return false;
      fence = taken.fence;
      leaseUntil = now + WORKER_LEASE_MS;
      lastHeartbeatAt = now;
      return true;
    });

  /** Forgets the lease the worker no longer holds. */
  const releaseLease = (): void => {
    fence = null;
    leaseUntil = null;
  };

  /** The handler registered for a job's kind and version. */
  const findHandler = (job: JobRecord): JobHandler | undefined => {
    const payload = job.payload;
    if (payload.type === "seed_account") {
      return deps.handlers.find(
        (handler) => handler.id === "seed-account" && handler.version === "1",
      );
    }
    // The retention and the workflow effect name their handler by their kind:
    // neither payload carries a handler id of its own.
    if (payload.type === "retention") {
      return deps.handlers.find(
        (handler) =>
          handler.id === RETENTION_HANDLER_ID && handler.version === RETENTION_HANDLER_VERSION,
      );
    }
    if (payload.type === "workflow_effect") {
      return deps.handlers.find(
        (handler) =>
          handler.id === WORKFLOW_EFFECT_HANDLER_ID &&
          handler.version === WORKFLOW_EFFECT_HANDLER_VERSION,
      );
    }
    if (payload.type !== "evaluate_trade" && payload.type !== "schedule_trigger") return undefined;
    return deps.handlers.find(
      (handler) => handler.id === payload.handlerId && handler.version === payload.handlerVersion,
    );
  };

  /** Runs one unit of work: dispatch, claim, execute, acknowledge. */
  const tick = async (now: number): Promise<boolean> => {
    if (!enabled) {
      state = "disabled";
      return false;
    }
    if (!holdLease(now)) {
      releaseLease();
      state = "blocked";
      return false;
    }
    state = "working";
    // The scheduler runs on the worker's own connection and clock, so a due
    // schedule becomes a durable job on the same tick that claims one.
    deps.scheduler?.scheduleDue(now);
    deps.dispatcher.dispatchOutbox(dispatchLimit, now);
    const claim = deps.jobs.claim(owner, now);
    if (!claim) {
      state = "idle";
      return false;
    }
    const job = deps.jobs.load(claim.jobId);
    const handler = job ? findHandler(job) : undefined;
    if (!job || !handler) {
      // An unknown job kind or handler version is terminal: retrying it would
      // fail the same way forever.
      deps.jobs.fail(claim, "unhandled_job", now, false);
      failed += 1;
      lastErrorCode = "unhandled_job";
      state = "idle";
      return true;
    }
    try {
      withConnectionTransaction(deps.db, (tx) => {
        deps.effects.assertClaim(tx, claim, now);
        handler.run(tx, job);
        // The acknowledgement is guarded by the lease, so it is judged against
        // the time the work actually finished: work that outlived its lease
        // is refused, not silently acknowledged.
        deps.effects.complete(tx, claim, deps.clock());
      });
      processed += 1;
    } catch (error) {
      if (error instanceof StaleClaimError) {
        // The claim no longer authorizes the work: the job was taken over or
        // cancelled. That is not a handler failure, and the guarded update
        // refuses to touch a job this worker no longer owns.
        lastErrorCode = error.reason;
      } else {
        // A schema violation never succeeds on a retry; anything else may.
        const validation = error instanceof ZodError;
        const code = validation ? "validation_failed" : "handler_failed";
        deps.jobs.fail(claim, code, now, !validation);
        failed += 1;
        lastErrorCode = code;
      }
    }
    state = "idle";
    return true;
  };

  const start = async (signal: AbortSignal): Promise<WorkerHandle> => {
    stopped = false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const loop = (async () => {
      while (!stopped && !controller.signal.aborted) {
        try {
          await tick(deps.clock());
        } catch (error) {
          // A busy journal is transient: the work stays pending and the next
          // poll tries again. Any other fault degrades intelligence, not the
          // process: the loop stops and reports a sanitized code.
          if (isBusy(error)) {
            lastErrorCode = "journal_busy";
            state = "idle";
          } else {
            lastErrorCode = error instanceof Error ? error.name : "worker_failed";
            break;
          }
        }
        if (stopped || controller.signal.aborted) break;
        await wait(pollIntervalMs, controller.signal);
      }
      state = "stopped";
    })();
    return {
      stop: async () => {
        stopped = true;
        controller.abort();
        await loop;
      },
    };
  };

  return {
    start,
    tick,
    status: () => ({
      state,
      owner,
      leaseHeld: fence !== null,
      leaseUntil,
      lastHeartbeatAt,
      processed,
      failed,
      lastErrorCode,
    }),
    stop: async () => {
      stopped = true;
    },
  };
};
