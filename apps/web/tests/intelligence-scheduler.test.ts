import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localInstant, nextDailyOccurrence } from "@luxalgo/journal-core";
import type { ScheduleDefinition } from "../src/server/intelligence/infrastructure/scheduler";

/**
 * The durable scheduler (Phase 15).
 *
 * A due schedule becomes a durable job whose key names the schedule, the due
 * instant and the definition version. Every case runs against a disposable
 * journal, exactly like the sibling suites.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-scheduler-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const {
  db,
  intelligenceJobs,
  intelligenceRuns,
  intelligenceSchedules,
  knowledgeSources,
  withJournalTransaction,
} = await import("../src/db");
const { createJobStore } = await import("../src/server/intelligence/infrastructure/jobs");
const { createScheduleHandler, createScheduler } =
  await import("../src/server/intelligence/infrastructure/scheduler");

const HOUR = 3_600_000;
const MINUTE = 60_000;
/** 2026-03-07T12:00:00Z — the day before the New York spring-forward. */
const BEFORE_GAP = Date.UTC(2026, 2, 7, 12, 0, 0);
/** 2026-10-31T12:00:00Z — the day before the New York fall-back. */
const BEFORE_FOLD = Date.UTC(2026, 9, 31, 12, 0, 0);

const intervalSchedule = {
  id: "schedule-interval",
  version: 1,
  kind: "time",
  cadence: "interval",
  everyMs: HOUR,
} as const;

const dailySchedule = {
  id: "schedule-daily",
  version: 1,
  kind: "time",
  cadence: "daily",
  timeZone: "America/New_York",
  hour: 2,
  minute: 30,
} as const;

/** The same daily schedule at 01:30 — the local time a fold makes ambiguous. */
const foldSchedule = {
  id: "schedule-fold",
  version: 1,
  kind: "time",
  cadence: "daily",
  timeZone: "America/New_York",
  hour: 1,
  minute: 30,
} as const;

const conditionSchedule = {
  id: "schedule-condition",
  version: 1,
  kind: "condition",
  pollIntervalMs: MINUTE,
} as const;

const scheduler = (definitions: readonly ScheduleDefinition[]) =>
  createScheduler({ db, jobs: createJobStore(db), definitions });

const rows = () => db.select().from(intelligenceSchedules).all();
const jobRows = () => db.select().from(intelligenceJobs).all();

/** Runs the schedule handler for the newest job in the journal, as a worker would. */
const runScheduleHandler = (
  definitions: readonly ScheduleDefinition[],
  clock: () => number,
): void => {
  const handler = createScheduleHandler({ definitions, clock });
  const job = jobRows()[jobRows().length - 1]!;
  withJournalTransaction((tx) =>
    handler.run(tx, {
      id: job.id,
      type: job.type,
      payload: JSON.parse(job.payloadJson),
      status: "pending",
      attempts: 0,
      availableAt: job.availableAt,
      owner: null,
      fence: 0,
      leaseUntil: null,
      cancelRequested: false,
      lastError: null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }),
  );
};

beforeEach(() => {
  db.delete(intelligenceJobs).run();
  db.delete(intelligenceSchedules).run();
  db.delete(knowledgeSources).run();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("the scheduler tick", () => {
  it("fires a due schedule exactly once and never enqueues the same key twice", () => {
    const due = Date.UTC(2026, 0, 5, 8, 0, 0);
    const active = scheduler([intervalSchedule]);

    // The first tick anchors the row and fires nothing: the occurrence is in
    // the future.
    expect(active.scheduleDue(due)).toBe(0);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ id: intervalSchedule.id, definitionVersion: 1 });
    expect(jobRows()).toHaveLength(0);

    // The next tick is one interval later and the occurrence is due.
    expect(active.scheduleDue(due + HOUR)).toBe(1);
    expect(jobRows()).toHaveLength(1);
    expect(jobRows()[0]!.idempotencyKey).toBe(`schedule-interval:${due + HOUR}:1`);
    expect(JSON.parse(jobRows()[0]!.payloadJson)).toMatchObject({
      type: "schedule_trigger",
      scheduleId: "schedule-interval",
      dueAt: due + HOUR,
      version: 1,
      trigger: "time",
      sourceId: null,
    });

    // A tick that arrives twice for the same due time fires nothing: the
    // (scheduleId, dueAt, version) key is unique.
    expect(active.scheduleDue(due + HOUR)).toBe(0);
    expect(jobRows()).toHaveLength(1);
  });

  it("fires the missed occurrence once after a restart and continues from the new checkpoint", () => {
    const due = Date.UTC(2026, 0, 5, 8, 0, 0);
    const definitions = [intervalSchedule];

    scheduler(definitions).scheduleDue(due);
    expect(scheduler(definitions).scheduleDue(due + HOUR)).toBe(1);

    // A restart: a fresh scheduler over the same journal finds the occurrence
    // already enqueued and fires nothing.
    expect(scheduler(definitions).scheduleDue(due + HOUR)).toBe(0);
    expect(jobRows()).toHaveLength(1);

    // The handler consumes the occurrence and moves the schedule on: the next
    // occurrence is one interval after the one that fired.
    runScheduleHandler(definitions, () => due + HOUR);
    expect(rows()[0]!.nextDueAt).toBe(due + 2 * HOUR);

    // The schedule continues from there.
    expect(scheduler(definitions).scheduleDue(due + 2 * HOUR)).toBe(1);
    expect(jobRows()).toHaveLength(2);
  });

  it("drops the pending occurrence when the definition version changes", () => {
    const due = Date.UTC(2026, 0, 5, 8, 0, 0);
    const first = scheduler([intervalSchedule]);
    first.scheduleDue(due);
    expect(first.scheduleDue(due + HOUR)).toBe(1);
    expect(jobRows()).toHaveLength(1);

    // The definition changes under the worker: the row is re-anchored and the
    // pending occurrence of the old version is dropped rather than replayed
    // under the new key.
    const changed = scheduler([{ ...intervalSchedule, version: 2 }]);
    expect(changed.scheduleDue(due + HOUR)).toBe(0);
    expect(rows()[0]!.definitionVersion).toBe(2);
    expect(jobRows()).toHaveLength(1);

    // The job that carries the old version cannot move the new definition's
    // schedule: the re-anchored row stays where the new version put it, even
    // when the stale job runs much later.
    const anchored = rows()[0]!.nextDueAt;
    runScheduleHandler([{ ...intervalSchedule, version: 2 }], () => due + 5 * HOUR);
    expect(rows()[0]!.nextDueAt).toBe(anchored);
  });

  it("selects no provider and no model when it fires", () => {
    const due = Date.UTC(2026, 0, 5, 8, 0, 0);
    scheduler([intervalSchedule]).scheduleDue(due);
    scheduler([intervalSchedule]).scheduleDue(due + HOUR);

    const payload = JSON.parse(jobRows()[0]!.payloadJson) as Record<string, unknown>;
    expect(payload.provider).toBeUndefined();
    expect(payload.model).toBeUndefined();
    expect(payload.endpointFingerprint).toBeUndefined();
    expect(db.select().from(intelligenceRuns).all()).toHaveLength(0);
  });
});

describe("the local time helpers", () => {
  it("resolves a daylight-saving gap forward through the gap", () => {
    const resolved = localInstant(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
      "America/New_York",
    );

    expect(resolved.resolution).toBe("gap");
    expect(new Date(resolved.epochMs).toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("resolves a daylight-saving fold to the earlier of the two instants", () => {
    const resolved = localInstant(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
      "America/New_York",
    );

    expect(resolved.resolution).toBe("fold");
    expect(new Date(resolved.epochMs).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("gives one occurrence per local day across a transition", () => {
    const gapDay = nextDailyOccurrence("America/New_York", 2, 30, BEFORE_GAP);
    expect(new Date(gapDay).toISOString()).toBe("2026-03-08T07:30:00.000Z");

    const afterGap = nextDailyOccurrence("America/New_York", 2, 30, gapDay);
    expect(new Date(afterGap).toISOString()).toBe("2026-03-09T06:30:00.000Z");

    const foldDay = nextDailyOccurrence("America/New_York", 1, 30, BEFORE_FOLD);
    expect(new Date(foldDay).toISOString()).toBe("2026-11-01T05:30:00.000Z");

    const afterFold = nextDailyOccurrence("America/New_York", 1, 30, foldDay);
    expect(new Date(afterFold).toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });
});

describe("a daily schedule across a daylight-saving transition", () => {
  it("fires once on the gap day", () => {
    const definitions = [dailySchedule];
    const active = scheduler(definitions);

    active.scheduleDue(BEFORE_GAP);
    const gapDue = rows()[0]!.nextDueAt;
    expect(new Date(gapDue).toISOString()).toBe("2026-03-08T07:30:00.000Z");

    expect(active.scheduleDue(gapDue)).toBe(1);
    expect(jobRows()).toHaveLength(1);
    // The gap day yields exactly one occurrence, not two.
    expect(active.scheduleDue(gapDue + MINUTE)).toBe(0);
    expect(jobRows()).toHaveLength(1);
  });

  it("never fires the later instant of a fold", () => {
    const definitions = [foldSchedule];
    const active = scheduler(definitions);

    active.scheduleDue(BEFORE_FOLD);
    const foldDue = rows()[0]!.nextDueAt;
    expect(new Date(foldDue).toISOString()).toBe("2026-11-01T05:30:00.000Z");

    expect(active.scheduleDue(foldDue)).toBe(1);
    expect(jobRows()).toHaveLength(1);
    expect(jobRows()[0]!.idempotencyKey).toBe(`schedule-fold:${foldDue}:1`);

    // The later instant of the fold (06:30Z) never becomes an occurrence: the
    // next one is the next local day.
    expect(active.scheduleDue(foldDue + MINUTE)).toBe(0);
    expect(jobRows()).toHaveLength(1);
  });
});

describe("a long offline gap", () => {
  it("coalesces the missed occurrences into one fire", () => {
    const due = Date.UTC(2026, 0, 5, 8, 0, 0);
    const definitions = [intervalSchedule];
    const active = scheduler(definitions);

    active.scheduleDue(due);
    // A hundred hours later the journal comes back.
    const back = due + 100 * HOUR;
    expect(active.scheduleDue(back)).toBe(1);
    expect(jobRows()).toHaveLength(1);
    expect(jobRows()[0]!.idempotencyKey).toBe(`schedule-interval:${due + HOUR}:1`);

    // The handler moves the schedule to the next interval boundary after the
    // catch-up, so the hundred missed occurrences are skipped rather than
    // replayed.
    runScheduleHandler(definitions, () => back);
    expect(rows()[0]!.nextDueAt).toBe(back + HOUR);

    // The next occurrence is the next boundary — one fire, not a hundred.
    expect(active.scheduleDue(back + HOUR)).toBe(1);
    expect(jobRows()).toHaveLength(2);
  });
});

describe("a condition trigger", () => {
  it("fires on a source change", () => {
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    db.insert(knowledgeSources)
      .values({
        id: "source-a",
        kind: "note",
        sourceId: "note-1",
        revision: 1,
        accountId: null,
        status: "active",
        correlationId: "corr-1",
        recordedAt: now,
      })
      .run();

    const definitions = [conditionSchedule];
    const active = scheduler(definitions);

    // The first tick anchors the row and evaluates nothing yet.
    expect(active.scheduleDue(now)).toBe(0);
    expect(rows()[0]!.checkpointJson).not.toBeNull();

    // The next evaluation finds the source change and fires.
    expect(active.scheduleDue(now + MINUTE)).toBe(1);
    expect(jobRows()).toHaveLength(1);
    expect(jobRows()[0]!.idempotencyKey).toBe("schedule-condition:source-a");
    expect(JSON.parse(jobRows()[0]!.payloadJson)).toMatchObject({
      trigger: "condition",
      sourceId: "source-a",
    });
  });

  it("does not let a version bump make one source change fire twice", () => {
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    db.insert(knowledgeSources)
      .values({
        id: "source-a",
        kind: "note",
        sourceId: "note-1",
        revision: 1,
        accountId: null,
        status: "active",
        correlationId: "corr-1",
        recordedAt: now,
      })
      .run();

    const definitions = [conditionSchedule];
    const active = scheduler(definitions);
    active.scheduleDue(now);
    expect(active.scheduleDue(now + MINUTE)).toBe(1);
    expect(jobRows()).toHaveLength(1);

    // The definition changes before the pending occurrence is consumed: the
    // same source change must not fire a second time under the new version.
    const changed = scheduler([{ ...conditionSchedule, version: 2 }]);
    expect(changed.scheduleDue(now + MINUTE)).toBe(0);
    expect(jobRows()).toHaveLength(1);

    // The next poll under the new version sees the same unconsumed change and
    // must not fire it again.
    expect(changed.scheduleDue(now + 2 * MINUTE)).toBe(0);
    expect(jobRows()).toHaveLength(1);
  });

  it("never lets a retried older occurrence move the checkpoint backwards", () => {
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    for (const [id, recordedAt] of [
      ["source-a", now],
      ["source-b", now + 1],
    ] as const) {
      db.insert(knowledgeSources)
        .values({
          id,
          kind: "note",
          sourceId: `note-${id}`,
          revision: 1,
          accountId: null,
          status: "active",
          correlationId: "corr-1",
          recordedAt,
        })
        .run();
    }

    const definitions = [conditionSchedule];
    const active = scheduler(definitions);
    active.scheduleDue(now);
    // The poll consumes the pending changes in order, one batch per fire.
    expect(active.scheduleDue(now + MINUTE)).toBe(1);
    expect(jobRows()).toHaveLength(1);
    expect(jobRows()[0]!.idempotencyKey).toBe("schedule-condition:source-a");

    runScheduleHandler(definitions, () => now + MINUTE);
    const first = JSON.parse(rows()[0]!.checkpointJson ?? "{}") as {
      lastRecordedAt: number;
      lastSourceId: string | null;
    };
    expect(first.lastSourceId).toBe("source-a");

    // The next poll consumes the next change.
    expect(active.scheduleDue(now + 2 * MINUTE)).toBe(1);
    runScheduleHandler(definitions, () => now + 2 * MINUTE);
    const advanced = JSON.parse(rows()[0]!.checkpointJson ?? "{}") as {
      lastRecordedAt: number;
      lastSourceId: string | null;
    };
    expect(advanced.lastSourceId).toBe("source-b");

    // A retried older occurrence must not move the checkpoint back.
    const older = {
      ...JSON.parse(jobRows()[0]!.payloadJson),
      sourceId: "source-a",
    };
    withJournalTransaction((tx) => {
      createScheduleHandler({ definitions, clock: () => now + 3 * MINUTE }).run(tx, {
        id: "job-old",
        type: "schedule_trigger",
        payload: older,
        status: "pending",
        attempts: 0,
        availableAt: now,
        owner: null,
        fence: 0,
        leaseUntil: null,
        cancelRequested: false,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    const afterRetry = JSON.parse(rows()[0]!.checkpointJson ?? "{}") as {
      lastSourceId: string | null;
    };
    expect(afterRetry.lastSourceId).toBe("source-b");
  });

  it("does not re-fire a condition whose checkpoint already consumed the change", () => {
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    db.insert(knowledgeSources)
      .values({
        id: "source-a",
        kind: "note",
        sourceId: "note-1",
        revision: 1,
        accountId: null,
        status: "active",
        correlationId: "corr-1",
        recordedAt: now,
      })
      .run();

    const definitions = [conditionSchedule];
    const active = scheduler(definitions);
    active.scheduleDue(now);
    expect(active.scheduleDue(now + MINUTE)).toBe(1);

    // The handler consumes the change and advances the durable checkpoint.
    runScheduleHandler(definitions, () => now + MINUTE);
    const checkpoint = JSON.parse(rows()[0]!.checkpointJson ?? "{}") as {
      lastRecordedAt: number;
      lastSourceId: string | null;
    };
    expect(checkpoint.lastSourceId).toBe("source-a");
    expect(checkpoint.lastRecordedAt).toBe(now);

    // The replayed condition fires nothing: the checkpoint consumed it.
    expect(active.scheduleDue(now + 2 * MINUTE)).toBe(0);
    expect(jobRows()).toHaveLength(1);
  });
});
