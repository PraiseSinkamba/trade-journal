import { and, asc, eq, gt, gte, or } from "drizzle-orm";
import { nextDailyOccurrence } from "@luxalgo/journal-core";
import type { JournalDb } from "@/db/connection";
import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
import { intelligenceJobs, intelligenceSchedules, knowledgeSources } from "@/db/schema";
import type { SourceKind } from "@/server/domain-events";
import type { JobRecord, JobStore } from "../contracts/jobs";
import type { JobHandler } from "./worker";

/**
 * The durable scheduler (Phase 15).
 *
 * A schedule is due when its row says so, and a due schedule becomes a
 * durable job. The job key carries the schedule id, the instant the
 * occurrence was due and the definition version, so the same occurrence can
 * never be enqueued twice — not by a repeated tick, not by a restart.
 *
 * The scheduler reads durable rows and writes durable jobs. It selects no
 * provider, no model and no endpoint: evaluating whether something is due
 * never calls an AI (design §8, ADR 0008).
 */

/** A schedule that fires at a local wall-clock time or on a fixed interval. */
export type TimeScheduleDefinition = {
  readonly id: string;
  readonly version: number;
  readonly kind: "time";
} & (
  | {
      readonly cadence: "daily";
      readonly timeZone: string;
      readonly hour: number;
      readonly minute: number;
    }
  | {
      readonly cadence: "interval";
      readonly everyMs: number;
    }
);

/** A schedule that fires when durable source changes pass a threshold. */
export type ConditionScheduleDefinition = {
  readonly id: string;
  readonly version: number;
  readonly kind: "condition";
  /** Only source changes of this kind satisfy the condition. */
  readonly sourceKind?: SourceKind;
  /** How many source changes must pass the checkpoint. Defaults to one. */
  readonly threshold?: number;
  /** How often the condition is evaluated, in milliseconds. */
  readonly pollIntervalMs: number;
};

/** One schedule the scheduler knows about. */
export type ScheduleDefinition = TimeScheduleDefinition | ConditionScheduleDefinition;

/** The durable cursor a condition schedule consumes. */
export interface ScheduleCheckpoint {
  /** The instant of the last consumed source change. */
  readonly lastRecordedAt: number;
  /** The id of the last consumed source change. */
  readonly lastSourceId: string | null;
}

/** The scheduler service. */
export interface Scheduler {
  /** Fires every schedule that is due at `now` and returns how many fired. */
  scheduleDue(now: number): number;
}

/** The handler id the schedule trigger jobs are routed to. */
export const SCHEDULE_HANDLER_ID = "schedule-trigger";
/** The version of that handler. */
export const SCHEDULE_HANDLER_VERSION = "1";

/** The checkpoint a freshly anchored condition schedule starts from. */
const emptyCheckpoint = (): ScheduleCheckpoint => ({
  lastRecordedAt: 0,
  lastSourceId: null,
});

/**
 * The next occurrence of a time schedule, strictly after `afterMs`.
 *
 * A daily occurrence is derived from the local calendar date, so a
 * daylight-saving transition cannot produce two occurrences on one day. An
 * interval occurrence is derived from the occurrence that was due, so a long
 * offline gap skips the occurrences it missed instead of replaying them.
 */
export const nextOccurrence = (
  definition: TimeScheduleDefinition,
  dueAt: number,
  afterMs: number,
): number => {
  if (definition.cadence === "interval") {
    const elapsed = Math.floor((afterMs - dueAt) / definition.everyMs);
    return dueAt + (elapsed + 1) * definition.everyMs;
  }
  return nextDailyOccurrence(definition.timeZone, definition.hour, definition.minute, afterMs);
};

/** Parses a stored checkpoint, tolerating an absent or damaged one. */
const readCheckpoint = (raw: string | null): ScheduleCheckpoint => {
  if (!raw) return emptyCheckpoint();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return emptyCheckpoint();
    const record = parsed as Record<string, unknown>;
    const lastRecordedAt = Number(record.lastRecordedAt ?? 0);
    const lastSourceId = typeof record.lastSourceId === "string" ? record.lastSourceId : null;
    return {
      lastRecordedAt: Number.isFinite(lastRecordedAt) ? lastRecordedAt : 0,
      lastSourceId,
    };
  } catch {
    return emptyCheckpoint();
  }
};

/**
 * The source changes that pass the checkpoint, oldest first, at most `limit`.
 *
 * The source-change log is the durable input of a condition trigger: it is
 * written inside the transaction of the write that caused it, so a condition
 * never sees a change that did not commit.
 *
 * The query is bounded by the threshold: a poll reads only as many changes as
 * it needs to decide, never the whole log.
 */
const changesAfterCheckpoint = (
  tx: JournalTx,
  definition: ConditionScheduleDefinition,
  checkpoint: ScheduleCheckpoint,
  limit: number,
): { id: string; recordedAt: number }[] => {
  const afterCursor =
    checkpoint.lastSourceId === null
      ? gte(knowledgeSources.recordedAt, checkpoint.lastRecordedAt)
      : or(
          gt(knowledgeSources.recordedAt, checkpoint.lastRecordedAt),
          and(
            eq(knowledgeSources.recordedAt, checkpoint.lastRecordedAt),
            gt(knowledgeSources.id, checkpoint.lastSourceId),
          ),
        );
  return tx
    .select({ id: knowledgeSources.id, recordedAt: knowledgeSources.recordedAt })
    .from(knowledgeSources)
    .where(
      and(
        afterCursor,
        definition.sourceKind === undefined
          ? undefined
          : eq(knowledgeSources.kind, definition.sourceKind),
      ),
    )
    .orderBy(asc(knowledgeSources.recordedAt), asc(knowledgeSources.id))
    .limit(limit)
    .all();
};

/**
 * Creates the scheduler.
 *
 * The tick runs in one immediate transaction on the connection it is given,
 * so a worker schedules on its own connection rather than on the request
 * thread's, and the job and the row move together.
 */
export const createScheduler = (deps: {
  db: JournalDb;
  jobs: JobStore;
  definitions: readonly ScheduleDefinition[];
}): Scheduler => {
  /**
   * Anchors a missing or out-of-date schedule row on its definition.
   *
   * A definition change re-anchors the row and drops the pending occurrence
   * rather than firing it under a fresh key. The checkpoint is left alone, so
   * a definition change cannot replay consumed source changes.
   */
  const anchorSchedule = (tx: JournalTx, definition: ScheduleDefinition, now: number): void => {
    const nextDueAt =
      definition.kind === "time"
        ? nextOccurrence(definition, now, now)
        : now + definition.pollIntervalMs;
    tx.insert(intelligenceSchedules)
      .values({
        id: definition.id,
        definitionVersion: definition.version,
        nextDueAt,
        checkpointJson: definition.kind === "condition" ? JSON.stringify(emptyCheckpoint()) : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: intelligenceSchedules.id,
        set: {
          definitionVersion: definition.version,
          nextDueAt,
          updatedAt: now,
        },
      })
      .run();
  };

  return {
    scheduleDue(now: number): number {
      return withConnectionTransaction(deps.db, (tx) => {
        let fired = 0;

        for (const definition of deps.definitions) {
          const row = tx
            .select()
            .from(intelligenceSchedules)
            .where(eq(intelligenceSchedules.id, definition.id))
            .get();

          if (!row || row.definitionVersion !== definition.version) {
            anchorSchedule(tx, definition, now);
            continue;
          }

          if (row.nextDueAt > now) continue;

          if (definition.kind === "time") {
            const dueAt = row.nextDueAt;
            const key = `${definition.id}:${dueAt}:${definition.version}`;
            const existing = tx
              .select({ id: intelligenceJobs.id })
              .from(intelligenceJobs)
              .where(eq(intelligenceJobs.idempotencyKey, key))
              .get();
            if (existing) continue;
            deps.jobs.enqueue(
              tx,
              key,
              {
                type: "schedule_trigger",
                scheduleId: definition.id,
                dueAt,
                version: definition.version,
                trigger: "time",
                sourceId: null,
                handlerId: SCHEDULE_HANDLER_ID,
                handlerVersion: SCHEDULE_HANDLER_VERSION,
              },
              now,
            );
            fired += 1;
            continue;
          }

          const checkpoint = readCheckpoint(row.checkpointJson);
          const threshold = Math.max(1, definition.threshold ?? 1);
          const changes = changesAfterCheckpoint(tx, definition, checkpoint, threshold);
          if (changes.length < threshold) {
            // The condition is not satisfied: the next evaluation is one poll
            // interval away and nothing is enqueued.
            tx.update(intelligenceSchedules)
              .set({ nextDueAt: now + definition.pollIntervalMs, updatedAt: now })
              .where(eq(intelligenceSchedules.id, definition.id))
              .run();
            continue;
          }

          const newest = changes[changes.length - 1]!;
          // The condition key names the source change, not the definition
          // version: a version change must not let one source change fire
          // twice under two keys.
          const key = `${definition.id}:${newest.id}`;
          const existing = tx
            .select({ id: intelligenceJobs.id })
            .from(intelligenceJobs)
            .where(eq(intelligenceJobs.idempotencyKey, key))
            .get();
          if (existing) continue;
          deps.jobs.enqueue(
            tx,
            key,
            {
              type: "schedule_trigger",
              scheduleId: definition.id,
              dueAt: newest.recordedAt,
              version: definition.version,
              trigger: "condition",
              sourceId: newest.id,
              handlerId: SCHEDULE_HANDLER_ID,
              handlerVersion: SCHEDULE_HANDLER_VERSION,
            },
            now,
          );
          fired += 1;
        }

        return fired;
      });
    },
  };
};

/**
 * Creates the handler that commits the effect of a fired schedule.
 *
 * The handler runs inside the job's own transaction, so the effect and the
 * acknowledgement commit together. It selects no provider and no model: the
 * durable effect of a fired schedule is the schedule's own state moving on.
 */
export const createScheduleHandler = (deps: {
  definitions: readonly ScheduleDefinition[];
  clock?: () => number;
}): JobHandler => {
  const byId = new Map(deps.definitions.map((definition) => [definition.id, definition]));
  return {
    id: SCHEDULE_HANDLER_ID,
    version: SCHEDULE_HANDLER_VERSION,
    run: (tx: JournalTx, job: JobRecord): void => {
      if (job.payload.type !== "schedule_trigger") return;
      const payload = job.payload;
      const definition = byId.get(payload.scheduleId);
      if (!definition) return;
      const now = deps.clock?.() ?? Date.now();
      const row = tx
        .select({
          definitionVersion: intelligenceSchedules.definitionVersion,
          checkpointJson: intelligenceSchedules.checkpointJson,
        })
        .from(intelligenceSchedules)
        .where(eq(intelligenceSchedules.id, definition.id))
        .get();
      if (!row) return;

      if (definition.kind === "time") {
        // A definition change dropped the pending occurrence: the job that
        // carries the old version must not move the new definition's schedule.
        if (row.definitionVersion !== payload.version) return;
        tx.update(intelligenceSchedules)
          .set({
            nextDueAt: nextOccurrence(definition, payload.dueAt, now),
            updatedAt: now,
          })
          .where(eq(intelligenceSchedules.id, definition.id))
          .run();
        return;
      }

      if (!payload.sourceId) return;
      const change = tx
        .select({ id: knowledgeSources.id, recordedAt: knowledgeSources.recordedAt })
        .from(knowledgeSources)
        .where(eq(knowledgeSources.id, payload.sourceId))
        .get();
      if (!change) return;
      const checkpoint = readCheckpoint(row.checkpointJson);
      // The checkpoint only moves forward: a retry of an older occurrence
      // never makes an already consumed change count again.
      if (checkpoint.lastRecordedAt > change.recordedAt) return;
      const advanced: ScheduleCheckpoint = {
        lastRecordedAt: change.recordedAt,
        lastSourceId: change.id,
      };
      tx.update(intelligenceSchedules)
        .set({
          nextDueAt: now + definition.pollIntervalMs,
          checkpointJson: JSON.stringify(advanced),
          updatedAt: now,
        })
        .where(eq(intelligenceSchedules.id, definition.id))
        .run();
    },
  };
};
