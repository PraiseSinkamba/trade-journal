import { z } from "zod";
import type { JournalTx } from "@/db/transaction";
import type { InsightInput } from "./insights";
import type { BackgroundRunStatus } from "./policy";

/**
 * The durable job contract (Phase 04).
 *
 * A job is a bounded unit of work with a stable identity, an idempotency key
 * and a status. This module holds the vocabulary and the ports only: the
 * SQLite adapters live in `../infrastructure/jobs.ts`.
 */

/** The lifecycle of a job. */
export type JobStatus = "pending" | "running" | "completed" | "retry_wait" | "failed" | "cancelled";

/**
 * The largest job payload the journal stores, in bytes.
 *
 * The same cap the event payload has: a job carries references, never bulk
 * data (contract review §4).
 */
export const MAX_JOB_PAYLOAD_BYTES = 16 * 1024;

const evaluateTradePayload = z
  .object({
    type: z.literal("evaluate_trade"),
    eventId: z.string().min(1),
    handlerId: z.string().min(1),
    handlerVersion: z.string().min(1),
  })
  .strict();

const seedAccountPayload = z
  .object({
    type: z.literal("seed_account"),
    accountId: z.string().min(1),
  })
  .strict();

const runCapabilityPayload = z
  .object({
    type: z.literal("run_capability"),
    runId: z.string().min(1),
    /** The capability the job runs, and the version it was queued for. */
    capabilityId: z.string().min(1),
    capabilityVersion: z.string().min(1),
    /** The observation the capability reads. */
    observationId: z.string().min(1),
  })
  .strict();

const workflowEffectPayload = z
  .object({
    type: z.literal("workflow_effect"),
    workflowId: z.string().min(1),
    transitionRevision: z.number().int().nonnegative(),
  })
  .strict();

const retentionPayload = z
  .object({
    type: z.literal("retention"),
    before: z.number().int().nonnegative(),
  })
  .strict();

const scheduleTriggerPayload = z
  .object({
    type: z.literal("schedule_trigger"),
    scheduleId: z.string().min(1),
    dueAt: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    trigger: z.enum(["time", "condition"]),
    /** The source change a condition occurrence consumed; null for a time trigger. */
    sourceId: z.string().min(1).nullable(),
    handlerId: z.string().min(1),
    handlerVersion: z.string().min(1),
  })
  .strict();

/**
 * The strict schema of a job payload.
 *
 * The union is the shared vocabulary of the job system; only `evaluate_trade`
 * is produced in Phase 04.
 */
export const jobPayloadSchema = z.discriminatedUnion("type", [
  evaluateTradePayload,
  seedAccountPayload,
  runCapabilityPayload,
  workflowEffectPayload,
  retentionPayload,
  scheduleTriggerPayload,
]);

/** The work a job carries. */
export type JobPayload = z.infer<typeof jobPayloadSchema>;

/**
 * A held claim on a job.
 *
 * `fence` is the generation of the claim. It increments on every claim, so a
 * worker whose lease was taken over can be told apart from the current owner.
 */
export type JobClaim = Readonly<{
  jobId: string;
  owner: string;
  fence: number;
  leaseUntil: number;
}>;

/**
 * The result of an asynchronous job.
 *
 * The slow half of the job runs outside every write transaction: it awaits
 * the provider. What it produced is either an answer the final transaction
 * can commit, or a refusal that ends the run without an answer.
 */
export type AsyncJobOutcome =
  /** The work produced an answer the final transaction can commit. */
  | { readonly status: "completed"; readonly answer: InsightInput | null }
  /**
   * The work ended without an answer.
   *
   * `runStatus` is the state the run ends in. A retryable failure returns the
   * run to `queued`, so the next attempt may run it again; a terminal one
   * leaves the run finished.
   */
  | {
      readonly status: "failed";
      readonly reason: string;
      readonly retryable: boolean;
      readonly runStatus: BackgroundRunStatus;
    };

/**
 * A handler whose work spans an await.
 *
 * The provider call must not sit inside a write transaction, so an
 * asynchronous handler is split in two: `prepare` does the slow work with no
 * transaction open, and `commit` writes the outcome inside the caller's
 * transaction, where the claim fence and the acknowledgement land together.
 */
export interface AsyncJobHandler {
  /** The capability this handler serves. */
  readonly id: string;
  /** The capability version this handler serves. */
  readonly version: string;
  /**
   * The slow half. It runs with no write transaction open, so it may await
   * the provider and be aborted when the worker stops.
   */
  prepare(context: AsyncJobContext): Promise<AsyncJobOutcome>;
  /**
   * The commit half. It runs inside the caller's transaction: the claim
   * fence, the writes and the acknowledgement commit together or not at all.
   */
  commit(tx: JournalTx, job: JobRecord, outcome: AsyncJobOutcome): void;
}

/**
 * What the slow half of an asynchronous job is given.
 *
 * The context never carries a transaction: the slow half must not hold one
 * open while it awaits. It runs short transactions of its own through
 * `runInTransaction`, on the worker's own connection.
 */
export interface AsyncJobContext {
  /** The job being run. */
  readonly job: JobRecord;
  /** The claim that authorises the work. */
  readonly claim: JobClaim;
  /** The worker's clock. */
  readonly now: number;
  /**
   * Cancelled when the worker stops or the lease is lost. The provider call
   * stops when it fires, and the answer is discarded.
   */
  readonly signal: AbortSignal;
  /** Runs one short transaction on the worker's own connection. */
  readonly runInTransaction: <T>(
    fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T,
  ) => T;
}

/** A stored job, as the worker sees it. */
export interface JobRecord {
  readonly id: string;
  readonly type: string;
  readonly payload: JobPayload;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly availableAt: number;
  readonly owner: string | null;
  readonly fence: number;
  readonly leaseUntil: number | null;
  readonly cancelRequested: boolean;
  readonly lastError: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Durable job storage.
 *
 * `enqueue` joins the caller's transaction, so a fanout writes the delivery
 * and its job together. Every other operation runs in its own short
 * transaction: a claim must never hold a transaction open across the work it
 * claims.
 */
export interface JobStore {
  enqueue(tx: JournalTx, key: string, payload: JobPayload, availableAt: number): string;
  claim(owner: string, now: number): JobClaim | null;
  renew(claim: JobClaim, now: number): boolean;
  cancel(jobId: string): void;
  fail(claim: JobClaim, code: string, now: number, retryable: boolean): boolean;
  load(jobId: string): JobRecord | null;
}

/**
 * The effect side of a job.
 *
 * Both operations run inside the caller's transaction: the effect and the
 * acknowledgement commit together, or neither does.
 */
export interface EffectStore {
  assertClaim(tx: JournalTx, claim: JobClaim, now: number): void;
  complete(tx: JournalTx, claim: JobClaim, now: number): void;
}

/** A running worker. */
export interface WorkerHandle {
  stop(): Promise<void>;
}

/** The durable worker. */
export interface WorkerService {
  start(signal: AbortSignal): Promise<WorkerHandle>;
}
