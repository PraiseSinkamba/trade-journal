import { count, desc, eq, sql } from "drizzle-orm";
import type { JournalDb } from "@/db/connection";
import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
import { intelligenceBudgetReservations, intelligencePolicy, intelligenceRuns } from "@/db/schema";
import { newUuid } from "@/server/ids";
import {
  BACKGROUND_DAILY_ATTEMPT_LIMIT,
  backgroundPolicySchema,
  backgroundScopeSchema,
  type BackgroundPolicy,
  type BackgroundRunRecord,
  type BackgroundRunStore,
  type BackgroundRunStatus,
  type BackgroundScope,
  type EnqueueRunInput,
  type RunReservation,
  type StoredPolicy,
} from "../contracts/policy";

/**
 * The background policy store (Phase 13).
 *
 * It persists three things: the revisioned background policy, the queued
 * background runs, and the daily attempt reservations.
 *
 * The reservation is taken in an immediate transaction before any network use,
 * so a crash keeps the reservation: the allowance is consumed conservatively
 * rather than handed back (contract review §6).
 */

/** The UTC day index a timestamp belongs to. */
export const dayIndex = (now: number): number => Math.floor(now / 86_400_000);

/**
 * The store types are the contract's: the adapter implements the port, and it
 * never declares a second shape for the same thing.
 */
export type { EnqueueRunInput, RunReservation, StoredPolicy };

const decodeScope = (raw: string): BackgroundScope | null => {
  try {
    const parsed = backgroundScopeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const decodeMeta = (raw: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/**
 * Reserve one attempt of the daily background allowance.
 *
 * The free function is the port method under another name: the reservation
 * is taken in the caller's transaction, it is never deleted, and it returns
 * false when the day's allowance is already spent.
 */
export const reserveBackgroundAttempt = (tx: JournalTx, runId: string, now: number): boolean =>
  reserveAttemptInTx(tx, runId, now);

/**
 * The reservation itself, shared by the free function and the port method.
 *
 * The reservation is taken in the caller's transaction: it commits with the
 * work that follows it, and it is never deleted, so a crashed attempt keeps
 * its reservation and a fresh retry spends another allowance.
 *
 * Returns false when the day's allowance is already spent.
 */
const reserveAttemptInTx = (tx: JournalTx, runId: string, now: number): boolean => {
  const day = dayIndex(now);
  const used = tx
    .select({ value: count() })
    .from(intelligenceBudgetReservations)
    .where(eq(intelligenceBudgetReservations.day, day))
    .get();
  if ((used?.value ?? 0) >= BACKGROUND_DAILY_ATTEMPT_LIMIT) return false;
  const attempt = tx
    .select({
      value: sql<number>`coalesce(max(${intelligenceBudgetReservations.attempt}), 0) + 1`,
    })
    .from(intelligenceBudgetReservations)
    .where(eq(intelligenceBudgetReservations.runId, runId))
    .get();
  tx.insert(intelligenceBudgetReservations)
    .values({ runId, attempt: attempt?.value ?? 1, day, reservedAt: now })
    .run();
  return true;
};

/**
 * The background policy store.
 *
 * Every write runs in the caller's transaction, so a policy change and the
 * runs it invalidates commit together.
 */
export const createPolicyStore = (deps: { db: JournalDb }): BackgroundRunStore => {
  const db = deps.db;

  const readPolicyInTx = (tx: JournalTx, id: string): StoredPolicy | null => {
    const row = tx
      .select()
      .from(intelligencePolicy)
      .where(eq(intelligencePolicy.id, id))
      .orderBy(desc(intelligencePolicy.revision))
      .limit(1)
      .get();
    if (!row) return null;
    let settings: BackgroundPolicy | null = null;
    try {
      const parsed = backgroundPolicySchema.safeParse(JSON.parse(row.settingsJson));
      settings = parsed.success ? parsed.data : null;
    } catch {
      settings = null;
    }
    return { id: row.id, revision: row.revision, settings, invalid: settings === null };
  };

  const readRunInTx = (tx: JournalTx, runId: string): BackgroundRunRecord | null => {
    const row = tx.select().from(intelligenceRuns).where(eq(intelligenceRuns.id, runId)).get();
    if (!row) return null;
    const scope = decodeScope(row.scopeJson);
    if (!scope) return null;
    return {
      id: row.id,
      effectKey: row.effectKey,
      status: row.status,
      provider: row.provider as BackgroundRunRecord["provider"],
      model: row.model,
      endpointFingerprint: row.endpointFingerprint,
      policyRevision: row.policyRevision,
      scope,
      meta: decodeMeta(row.metaJson),
    };
  };

  return {
    readPolicy(id: string): StoredPolicy | null {
      return withConnectionTransaction(db, (tx) => readPolicyInTx(tx, id));
    },

    readPolicyInTx,

    /**
     * Record a new policy revision.
     *
     * Revisions are append-only: the previous document stays readable, so a
     * run approved under an older revision is recognisable and has to be
     * rescheduled explicitly.
     */
    writePolicyInTx(
      tx: JournalTx,
      id: string,
      settings: BackgroundPolicy,
      now: number,
    ): { id: string; revision: number } {
      const current = readPolicyInTx(tx, id);
      // An unchanged document keeps its revision: saving the same policy must
      // not invalidate the runs that were approved under it.
      if (current?.settings && JSON.stringify(current.settings) === JSON.stringify(settings))
        return { id, revision: current.revision };
      const revision = (current?.revision ?? 0) + 1;
      tx.insert(intelligencePolicy)
        .values({
          id,
          revision,
          settingsJson: JSON.stringify(settings),
          recordedAt: now,
        })
        .run();
      return { id, revision };
    },

    /**
     * Queue a background run.
     *
     * The effect key is the idempotency key: queueing the same effect twice
     * returns the original run instead of a second one. A run that already
     * ended is pinned again and queued afresh: that is the explicit
     * reschedule an operator asks for after a configuration change.
     */
    enqueueRunInTx(tx: JournalTx, input: EnqueueRunInput, now: number): BackgroundRunRecord {
      const existing = tx
        .select()
        .from(intelligenceRuns)
        .where(eq(intelligenceRuns.effectKey, input.effectKey))
        .get();
      const id = existing?.id ?? newUuid();
      if (!existing) {
        tx.insert(intelligenceRuns)
          .values({
            id,
            effectKey: input.effectKey,
            status: "queued",
            provider: input.provider,
            model: input.model,
            endpointFingerprint: input.endpointFingerprint,
            policyRevision: input.policyRevision,
            scopeJson: JSON.stringify(input.scope),
            metaJson: JSON.stringify(input.meta ?? {}),
            createdAt: now,
            updatedAt: now,
          })
          .run();
      } else if (existing.status !== "queued" && existing.status !== "running") {
        tx.update(intelligenceRuns)
          .set({
            status: "queued",
            provider: input.provider,
            model: input.model,
            endpointFingerprint: input.endpointFingerprint,
            policyRevision: input.policyRevision,
            scopeJson: JSON.stringify(input.scope),
            metaJson: JSON.stringify(input.meta ?? {}),
            updatedAt: now,
          })
          .where(eq(intelligenceRuns.id, id))
          .run();
      }
      const stored = readRunInTx(tx, id);
      if (!stored) throw new Error(`The background run ${id} could not be read back.`);
      return stored;
    },

    /**
     * Queue a run exactly once.
     *
     * The effect key is the business key of the effect, so a repeated delivery
     * of the same observation finds the run that already exists and writes
     * nothing: the run is never re-pinned, never re-queued and never spends a
     * second provider attempt.
     */
    enqueueRunOnceInTx(tx: JournalTx, input: EnqueueRunInput, now: number): BackgroundRunRecord {
      tx.insert(intelligenceRuns)
        .values({
          id: newUuid(),
          effectKey: input.effectKey,
          status: "queued",
          provider: input.provider,
          model: input.model,
          endpointFingerprint: input.endpointFingerprint,
          policyRevision: input.policyRevision,
          scopeJson: JSON.stringify(input.scope),
          metaJson: JSON.stringify(input.meta ?? {}),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: intelligenceRuns.effectKey })
        .run();
      const row = tx
        .select({ id: intelligenceRuns.id })
        .from(intelligenceRuns)
        .where(eq(intelligenceRuns.effectKey, input.effectKey))
        .get();
      if (!row) throw new Error("The background run could not be read back.");
      const stored = readRunInTx(tx, row.id);
      if (!stored) throw new Error(`The background run ${row.id} could not be read back.`);
      return stored;
    },

    readRun(runId: string): BackgroundRunRecord | null {
      return withConnectionTransaction(db, (tx) => readRunInTx(tx, runId));
    },

    readRunInTx,

    /** Merge the sanitized metadata of a run. */
    updateRunMetaInTx(
      tx: JournalTx,
      runId: string,
      meta: Record<string, unknown>,
      now: number,
    ): void {
      const current = readRunInTx(tx, runId);
      tx.update(intelligenceRuns)
        .set({
          metaJson: JSON.stringify({ ...(current?.meta ?? {}), ...meta }),
          updatedAt: now,
        })
        .where(eq(intelligenceRuns.id, runId))
        .run();
    },

    /** Move a run to a new status. */
    updateRunStatusInTx(
      tx: JournalTx,
      runId: string,
      status: BackgroundRunStatus,
      now: number,
    ): void {
      tx.update(intelligenceRuns)
        .set({ status, updatedAt: now })
        .where(eq(intelligenceRuns.id, runId))
        .run();
    },

    /** The attempts already reserved on the day of `now`. */
    attemptsReservedOnDay(now: number): number {
      const row = db
        .select({ value: count() })
        .from(intelligenceBudgetReservations)
        .where(eq(intelligenceBudgetReservations.day, dayIndex(now)))
        .get();
      return row?.value ?? 0;
    },

    /** Reserve one attempt of the daily allowance, in the caller's transaction. */
    reserveAttemptInTx,

    /** The reservations of one run. */
    reservationsForRun(runId: string): RunReservation[] {
      return db
        .select({
          runId: intelligenceBudgetReservations.runId,
          attempt: intelligenceBudgetReservations.attempt,
          day: intelligenceBudgetReservations.day,
          reservedAt: intelligenceBudgetReservations.reservedAt,
        })
        .from(intelligenceBudgetReservations)
        .where(eq(intelligenceBudgetReservations.runId, runId))
        .all();
    },

    /** The run queued under an effect key, or null. */
    findRunByEffectKey(effectKey: string): BackgroundRunRecord | null {
      const row = db
        .select({ id: intelligenceRuns.id })
        .from(intelligenceRuns)
        .where(eq(intelligenceRuns.effectKey, effectKey))
        .get();
      return row ? this.readRun(row.id) : null;
    },
  };
};
