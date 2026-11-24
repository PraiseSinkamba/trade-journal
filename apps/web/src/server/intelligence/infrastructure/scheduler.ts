import { and, asc, eq, gt, gte, lt, or } from "drizzle-orm";
import { nextDailyOccurrence } from "@luxalgo/journal-core";
import type { JournalDb } from "@/db/connection";
import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
import { intelligenceJobs, intelligenceSchedules, knowledgeSources } from "@/db/schema";
import type { SourceKind } from "@/server/domain-events";
import {
  jobPayloadSchema,
  type JobPayload,
  type JobRecord,
  type JobStatus,
  type JobStore,
} from "../contracts/jobs";
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

/**
 * The job statuses whose occurrence is still in flight.
 *
 * An in-flight occurrence will advance its schedule itself: the worker runs
 * the handler and the handler moves the checkpoint. A duplicate tick must not
 * move anything while the occurrence is in flight. Every other status is
 * burnt: no handler will ever move that occurrence's schedule on again.
 */
const LIVE_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "pending",
  "running",
  "retry_wait",
]);

/** The status of the job with the given idempotency key, when it exists. */
const jobStatus = (tx: JournalTx, key: string): JobStatus | null => {
  const row = tx
    .select({ status: intelligenceJobs.status })
    .from(intelligenceJobs)
    .where(eq(intelligenceJobs.idempotencyKey, key))
    .get();
  return row?.status ?? null;
};

/**
 * The stored checkpoint, or the fact that it cannot be read.
 *
 * A damaged checkpoint is not an empty one. The empty checkpoint is written
 * explicitly when a condition schedule is anchored, and it legitimately starts
 * at the beginning of the source log. A checkpoint that is absent or does not
 * parse has lost its cursor, and reading it as "nothing consumed yet" would
 * replay the log from the start.
 */
type StoredCheckpoint =
  | { readonly kind: "cursor"; readonly checkpoint: ScheduleCheckpoint }
  | { readonly kind: "damaged" };

/** Parses a stored checkpoint, telling a damaged one from an empty one. */
const readCheckpoint = (raw: string | null): StoredCheckpoint => {
  if (raw === null) return { kind: "damaged" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "damaged" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { kind: "damaged" };
  }
  const record = parsed as Record<string, unknown>;
  const lastRecordedAt = record.lastRecordedAt;
  if (typeof lastRecordedAt !== "number" || !Number.isFinite(lastRecordedAt)) {
    return { kind: "damaged" };
  }
  const lastSourceId = record.lastSourceId;
  if (lastSourceId === undefined || (lastSourceId !== null && typeof lastSourceId !== "string")) {
    return { kind: "damaged" };
  }
  return { kind: "cursor", checkpoint: { lastRecordedAt, lastSourceId } };
};

/**
 * The payload of a stored job, when it is a schedule trigger.
 *
 * A stored payload is read back through the same strict schema it was
 * written with, so a corrupt row is skipped rather than trusted.
 */
const readSchedulePayload = (
  payloadJson: string,
): Extract<JobPayload, { type: "schedule_trigger" }> | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  const result = jobPayloadSchema.safeParse(parsed);
  if (!result.success || result.data.type !== "schedule_trigger") return null;
  return result.data;
};

/**
 * The position of the newest source change this schedule has offered.
 *
 * A condition occurrence's payload names the source change it was created for
 * and the instant that change was recorded, which is exactly the position the
 * handler writes into the checkpoint. The newest such occurrence is therefore
 * the durable position of the schedule, and a damaged checkpoint recovers to
 * it: an already-consumed change is never replayed, while a change recorded
 * after the damage is in front of it and still fires.
 *
 * The occurrence key of a condition trigger is `<scheduleId>:<sourceId>`, so
 * the schedule's own occurrences are the rows whose key starts with the
 * schedule id and a colon. The range ends at the colon's successor, which no
 * key of this schedule can reach.
 */
const offeredFrontier = (tx: JournalTx, scheduleId: string): ScheduleCheckpoint | null => {
  const prefix = `${scheduleId}:`;
  const rows = tx
    .select({ payloadJson: intelligenceJobs.payloadJson })
    .from(intelligenceJobs)
    .where(
      and(
        eq(intelligenceJobs.type, "schedule_trigger"),
        gte(intelligenceJobs.idempotencyKey, prefix),
        lt(intelligenceJobs.idempotencyKey, `${prefix}\uffff`),
      ),
    )
    .all();
  let frontier: { recordedAt: number; sourceId: string } | null = null;
  for (const row of rows) {
    const payload = readSchedulePayload(row.payloadJson);
    if (!payload || payload.type !== "schedule_trigger") continue;
    if (payload.scheduleId !== scheduleId) continue;
    if (payload.trigger !== "condition" || payload.sourceId === null) continue;
    if (
      frontier === null ||
      payload.dueAt > frontier.recordedAt ||
      (payload.dueAt === frontier.recordedAt && payload.sourceId > frontier.sourceId)
    ) {
      frontier = { recordedAt: payload.dueAt, sourceId: payload.sourceId };
    }
  }
  return frontier === null
    ? null
    : { lastRecordedAt: frontier.recordedAt, lastSourceId: frontier.sourceId };
};

/**
 * The cursor a condition schedule reads.
 *
 * The stored cursor is used as it is. A damaged one is re-anchored to the
 * newest change the schedule has already offered, so an already-consumed
 * change is never replayed and a change recorded after the damage still fires.
 * With no occurrence at all nothing was consumed, so the empty cursor is the
 * truthful position.
 */
const effectiveCheckpoint = (
  tx: JournalTx,
  definition: ConditionScheduleDefinition,
  raw: string | null,
): ScheduleCheckpoint => {
  const stored = readCheckpoint(raw);
  if (stored.kind === "cursor") return stored.checkpoint;
  return offeredFrontier(tx, definition.id) ?? emptyCheckpoint();
};

/**
 * Whether a source change sits behind the cursor.
 *
 * The cursor orders the source log the way the poll reads it: by the instant a
 * change was recorded and, for changes recorded in the same instant, by their
 * id. A change behind the cursor was already consumed, so consuming it again
 * would move the cursor backwards.
 */
const isBehindCheckpoint = (
  checkpoint: ScheduleCheckpoint,
  recordedAt: number,
  sourceId: string,
): boolean => {
  if (checkpoint.lastSourceId === null) return false;
  if (recordedAt !== checkpoint.lastRecordedAt) return recordedAt < checkpoint.lastRecordedAt;
  return sourceId < checkpoint.lastSourceId;
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
            const status = jobStatus(tx, key);
            if (status !== null) {
              if (!LIVE_JOB_STATUSES.has(status)) {
                // The occurrence failed for good: it will never run again and
                // no handler will ever move the row on. The tick does what the
                // handler would have done, so the schedule catches up to its
                // next occurrence instead of stalling on a key that is taken.
                tx.update(intelligenceSchedules)
                  .set({ nextDueAt: nextOccurrence(definition, dueAt, now), updatedAt: now })
                  .where(eq(intelligenceSchedules.id, definition.id))
                  .run();
              }
              // A live occurrence is a duplicate tick: the unique key keeps the
              // occurrence single and its handler moves the schedule on.
              continue;
            }
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

          const threshold = Math.max(1, definition.threshold ?? 1);
          // The scan walks past the occurrences that will never run again, so a
          // burnt occurrence cannot hide the changes behind it. The durable
          // checkpoint stays with the handler: the tick never writes it.
          let scan = effectiveCheckpoint(tx, definition, row.checkpointJson);
          let advance = false;
          for (;;) {
            const changes = changesAfterCheckpoint(tx, definition, scan, threshold);
            if (changes.length < threshold) {
              // The condition is not satisfied: the next evaluation is one poll
              // interval away and nothing is enqueued.
              advance = true;
              break;
            }

            const newest = changes[changes.length - 1]!;
            // The condition key names the source change, not the definition
            // version: a version change must not let one source change fire
            // twice under two keys.
            const key = `${definition.id}:${newest.id}`;
            const status = jobStatus(tx, key);
            if (status === null) {
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
              break;
            }
            if (LIVE_JOB_STATUSES.has(status)) {
              // A duplicate tick: the occurrence is in flight and its handler
              // moves the schedule on. Nothing here moves.
              break;
            }
            // The occurrence failed for good: it will never run again, so no
            // handler will ever move this row on. The tick does what the
            // handler would have done and steps the scan over the burnt
            // change, so a later change can still fire.
            advance = true;
            scan = { lastRecordedAt: newest.recordedAt, lastSourceId: newest.id };
          }
          if (advance) {
            tx.update(intelligenceSchedules)
              .set({ nextDueAt: now + definition.pollIntervalMs, updatedAt: now })
              .where(eq(intelligenceSchedules.id, definition.id))
              .run();
          }
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
      // The cursor the schedule reads is the same one the tick reads: a
      // damaged checkpoint recovers to the position of the change this
      // occurrence consumed, so a retry can never move it backwards.
      const checkpoint = effectiveCheckpoint(tx, definition, row.checkpointJson);
      // The checkpoint only moves forward: a retry of an older occurrence
      // never makes an already consumed change count again.
      if (isBehindCheckpoint(checkpoint, change.recordedAt, change.id)) return;
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
