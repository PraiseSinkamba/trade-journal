import { z } from "zod";
import type { JournalTx } from "@/db/transaction";

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
