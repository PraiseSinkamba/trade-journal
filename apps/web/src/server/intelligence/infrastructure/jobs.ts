import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { JournalDb } from "@/db/connection";
import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
import { eventDeliveries, intelligenceJobs } from "@/db/schema";
import { newUuid } from "@/server/ids";
import {
  jobPayloadSchema,
  MAX_JOB_PAYLOAD_BYTES,
  type EffectStore,
  type JobClaim,
  type JobPayload,
  type JobRecord,
  type JobStatus,
  type JobStore,
} from "../contracts/jobs";

/**
 * The durable job store (Phase 04).
 *
 * A claim takes the write lock first and then guards the row it selected, so
 * two connections can never win the same job. The fence increments with every
 * claim, and completion is guarded by that same fence, so a worker whose lease
 * was taken over cannot acknowledge the work it started.
 */

/** How long a worker may hold the journal's lease. */
export const WORKER_LEASE_MS = 30_000;
/** How often a worker refreshes its lease while it works. */
export const WORKER_RENEW_INTERVAL_MS = 10_000;
/** How long a claimed job stays owned by its worker. */
export const JOB_LEASE_MS = 60_000;
/** How often a worker refreshes the lease of the job it is running. */
export const JOB_RENEW_INTERVAL_MS = 15_000;
/** How long the worker waits between polls. */
export const POLL_INTERVAL_MS = 1_000;
/** How many events one dispatch transaction fans out. */
export const DISPATCH_LIMIT = 100;
/** How often a job is attempted before it fails for good. */
export const MAX_JOB_ATTEMPTS = 5;
/** The wait before the second, third, fourth and fifth attempt. */
export const JOB_RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 30_000, 120_000];
/** The name of the journal's single worker lease. */
export const WORKER_LEASE_NAME = "journal-worker";

/**
 * Why a claim was refused.
 *
 * `stale` means another worker owns the job now, `expired` means the lease ran
 * out and `cancelled` means the job was cancelled.
 */
export type StaleClaimReason = "stale" | "expired" | "cancelled";

/** Thrown when a claim no longer authorizes the work. */
export class StaleClaimError extends Error {
  readonly reason: StaleClaimReason;

  constructor(reason: StaleClaimReason, message: string) {
    super(message);
    this.name = "StaleClaimError";
    this.reason = reason;
  }
}

/** The jobs a worker may claim right now. */
const claimable = (now: number) =>
  and(
    eq(intelligenceJobs.cancelRequested, false),
    or(
      and(
        inArray(intelligenceJobs.status, ["pending", "retry_wait"]),
        lte(intelligenceJobs.availableAt, now),
      ),
      and(eq(intelligenceJobs.status, "running"), lte(intelligenceJobs.leaseUntil, now)),
    ),
  );

/**
 * The SQLite job store.
 *
 * The store owns its own connection, so a claim never runs on the request
 * thread's transaction: a claim is one short transaction of its own.
 */
export const createJobStore = (db: JournalDb): JobStore => ({
  enqueue(tx: JournalTx, key: string, payload: JobPayload, availableAt: number): string {
    const parsed = jobPayloadSchema.parse(payload);
    const payloadJson = JSON.stringify(parsed);
    if (Buffer.byteLength(payloadJson, "utf8") > MAX_JOB_PAYLOAD_BYTES) {
      throw new Error(`Job ${key} exceeds the ${MAX_JOB_PAYLOAD_BYTES} byte payload limit.`);
    }
    const id = newUuid();
    const now = Date.now();
    tx.insert(intelligenceJobs)
      .values({
        id,
        idempotencyKey: key,
        type: parsed.type,
        payloadJson,
        status: "pending",
        attempts: 0,
        availableAt,
        owner: null,
        fence: 0,
        leaseUntil: null,
        cancelRequested: false,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: intelligenceJobs.idempotencyKey })
      .run();
    // A repeated key keeps the original job, so the caller gets the same id.
    const stored = tx
      .select({ id: intelligenceJobs.id })
      .from(intelligenceJobs)
      .where(eq(intelligenceJobs.idempotencyKey, key))
      .get();
    return stored?.id ?? id;
  },

  claim(owner: string, now: number): JobClaim | null {
    return withConnectionTransaction(db, (tx) => {
      const candidate = tx
        .select({ id: intelligenceJobs.id })
        .from(intelligenceJobs)
        .where(and(claimable(now), lt(intelligenceJobs.attempts, MAX_JOB_ATTEMPTS)))
        .orderBy(asc(intelligenceJobs.availableAt), asc(intelligenceJobs.id))
        .limit(1)
        .get();
      if (!candidate) {
        // A job that used up its attempts is terminal, however it got there:
        // a handler failure, or a worker that kept crashing before it could
        // report one.
        const exhausted = tx
          .update(intelligenceJobs)
          .set({ status: "failed", owner: null, leaseUntil: null, updatedAt: now })
          .where(and(claimable(now), gte(intelligenceJobs.attempts, MAX_JOB_ATTEMPTS)))
          .returning({ id: intelligenceJobs.id })
          .all();
        for (const job of exhausted) {
          tx.update(eventDeliveries)
            .set({ state: "failed", updatedAt: now })
            .where(eq(eventDeliveries.jobId, job.id))
            .run();
        }
        return null;
      }
      const claimed = tx
        .update(intelligenceJobs)
        .set({
          status: "running",
          owner,
          fence: sql`${intelligenceJobs.fence} + 1`,
          leaseUntil: now + JOB_LEASE_MS,
          attempts: sql`${intelligenceJobs.attempts} + 1`,
          updatedAt: now,
        })
        .where(and(eq(intelligenceJobs.id, candidate.id), claimable(now)))
        .returning({
          id: intelligenceJobs.id,
          owner: intelligenceJobs.owner,
          fence: intelligenceJobs.fence,
          leaseUntil: intelligenceJobs.leaseUntil,
        })
        .get();
      if (!claimed) return null;
      return {
        jobId: claimed.id,
        owner,
        fence: claimed.fence,
        leaseUntil: claimed.leaseUntil ?? now + JOB_LEASE_MS,
      };
    });
  },

  renew(claim: JobClaim, now: number): boolean {
    const renewed = db
      .update(intelligenceJobs)
      .set({ leaseUntil: now + JOB_LEASE_MS, updatedAt: now })
      .where(
        and(
          eq(intelligenceJobs.id, claim.jobId),
          eq(intelligenceJobs.owner, claim.owner),
          eq(intelligenceJobs.fence, claim.fence),
          eq(intelligenceJobs.status, "running"),
          eq(intelligenceJobs.cancelRequested, false),
          gt(intelligenceJobs.leaseUntil, now),
        ),
      )
      .run();
    return renewed.changes === 1;
  },

  cancel(jobId: string): void {
    withConnectionTransaction(db, (tx) => {
      const cancelled = tx
        .update(intelligenceJobs)
        .set({ cancelRequested: true, status: "cancelled", updatedAt: Date.now() })
        .where(
          and(
            eq(intelligenceJobs.id, jobId),
            inArray(intelligenceJobs.status, ["pending", "retry_wait", "running"]),
          ),
        )
        .run();
      if (cancelled.changes !== 1) return;
      // The delivery records the cancellation, so the event is not left
      // looking undelivered forever.
      tx.update(eventDeliveries)
        .set({ state: "cancelled", updatedAt: Date.now() })
        .where(eq(eventDeliveries.jobId, jobId))
        .run();
    });
  },

  fail(claim: JobClaim, code: string, now: number, retryable: boolean): boolean {
    return withConnectionTransaction(db, (tx) => {
      const current = tx
        .select({ attempts: intelligenceJobs.attempts })
        .from(intelligenceJobs)
        .where(eq(intelligenceJobs.id, claim.jobId))
        .get();
      if (!current) return false;
      const exhausted = current.attempts >= MAX_JOB_ATTEMPTS;
      const waiting = retryable && !exhausted;
      const failed = tx
        .update(intelligenceJobs)
        .set({
          status: waiting ? "retry_wait" : "failed",
          availableAt: waiting ? now + (JOB_RETRY_DELAYS_MS[current.attempts - 1] ?? 0) : now,
          owner: null,
          leaseUntil: null,
          lastError: code,
          updatedAt: now,
        })
        .where(
          and(
            eq(intelligenceJobs.id, claim.jobId),
            eq(intelligenceJobs.owner, claim.owner),
            eq(intelligenceJobs.fence, claim.fence),
            eq(intelligenceJobs.status, "running"),
          ),
        )
        .run();
      if (failed.changes !== 1) return false;
      if (!waiting) {
        tx.update(eventDeliveries)
          .set({ state: "failed", lastError: code, updatedAt: now })
          .where(eq(eventDeliveries.jobId, claim.jobId))
          .run();
      }
      return true;
    });
  },

  load(jobId: string): JobRecord | null {
    const row = db.select().from(intelligenceJobs).where(eq(intelligenceJobs.id, jobId)).get();
    if (!row) return null;
    const parsed = jobPayloadSchema.safeParse(JSON.parse(row.payloadJson));
    if (!parsed.success) return null;
    return {
      id: row.id,
      type: row.type,
      payload: parsed.data,
      status: row.status as JobStatus,
      attempts: row.attempts,
      availableAt: row.availableAt,
      owner: row.owner,
      fence: row.fence,
      leaseUntil: row.leaseUntil,
      cancelRequested: row.cancelRequested,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});

/**
 * The effect store: the guarded side of a claim.
 *
 * Both operations run inside the caller's transaction, so the effect and the
 * acknowledgement commit together — or neither does.
 */
export const createEffectStore = (): EffectStore => ({
  assertClaim(tx: JournalTx, claim: JobClaim, now: number): void {
    const row = tx
      .select({
        owner: intelligenceJobs.owner,
        fence: intelligenceJobs.fence,
        status: intelligenceJobs.status,
        leaseUntil: intelligenceJobs.leaseUntil,
        cancelRequested: intelligenceJobs.cancelRequested,
      })
      .from(intelligenceJobs)
      .where(eq(intelligenceJobs.id, claim.jobId))
      .get();
    if (!row) {
      throw new StaleClaimError("stale", `Stale claim: job ${claim.jobId} no longer exists.`);
    }
    if (row.cancelRequested || row.status === "cancelled") {
      throw new StaleClaimError(
        "cancelled",
        `Cancelled job ${claim.jobId}: the work was cancelled.`,
      );
    }
    if (row.owner !== claim.owner || row.fence !== claim.fence || row.status !== "running") {
      throw new StaleClaimError(
        "stale",
        `Stale claim: job ${claim.jobId} is held by another worker at a later fence.`,
      );
    }
    if (row.leaseUntil === null || row.leaseUntil <= now) {
      throw new StaleClaimError(
        "expired",
        `Expired claim: the lease on job ${claim.jobId} has run out.`,
      );
    }
  },

  complete(tx: JournalTx, claim: JobClaim, now: number): void {
    const completed = tx
      .update(intelligenceJobs)
      .set({ status: "completed", leaseUntil: null, updatedAt: now })
      .where(
        and(
          eq(intelligenceJobs.id, claim.jobId),
          eq(intelligenceJobs.owner, claim.owner),
          eq(intelligenceJobs.fence, claim.fence),
          eq(intelligenceJobs.status, "running"),
          eq(intelligenceJobs.cancelRequested, false),
          gt(intelligenceJobs.leaseUntil, now),
        ),
      )
      .run();
    if (completed.changes !== 1) {
      // The guarded update matched nothing: the job was cancelled, taken over
      // or its lease ran out. Say which, so the worker reports the real reason.
      const row = tx
        .select({
          owner: intelligenceJobs.owner,
          fence: intelligenceJobs.fence,
          status: intelligenceJobs.status,
          leaseUntil: intelligenceJobs.leaseUntil,
          cancelRequested: intelligenceJobs.cancelRequested,
        })
        .from(intelligenceJobs)
        .where(eq(intelligenceJobs.id, claim.jobId))
        .get();
      if (row?.cancelRequested || row?.status === "cancelled") {
        throw new StaleClaimError(
          "cancelled",
          `Cancelled job ${claim.jobId}: the work was cancelled.`,
        );
      }
      if (row && (row.owner !== claim.owner || row.fence !== claim.fence)) {
        throw new StaleClaimError(
          "stale",
          `Stale claim: job ${claim.jobId} is held by another worker at a later fence.`,
        );
      }
      if (row && (row.leaseUntil === null || row.leaseUntil <= now)) {
        throw new StaleClaimError(
          "expired",
          `Expired claim: the lease on job ${claim.jobId} has run out.`,
        );
      }
      throw new StaleClaimError(
        "stale",
        `Stale claim: job ${claim.jobId} is no longer held at fence ${claim.fence}.`,
      );
    }
    tx.update(eventDeliveries)
      .set({ state: "delivered", updatedAt: now })
      .where(eq(eventDeliveries.jobId, claim.jobId))
      .run();
  },
});
