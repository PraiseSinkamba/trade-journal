import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

/**
 * The retention, purge and reset suite (Phase 20).
 *
 * A prune may only take what is finished and unreferenced. A live workflow, a
 * pending opportunity, an open conversation or an unacknowledged failure keeps
 * the row it points at alive, and a purge may not leave anything of an account
 * behind — nor may it leave the account resurrectable.
 *
 * Every case runs against a disposable journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-retention-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const {
  db,
  withJournalTransaction,
  accounts,
  domainOutbox,
  eventDeliveries,
  intelligenceConversations,
  intelligenceJobs,
  intelligenceObservations,
  intelligenceOpportunities,
  intelligenceRuns,
  intelligenceSeedCheckpoints,
  intelligenceWorkflows,
  knowledgeHypotheses,
  knowledgePatterns,
  observationEvidence,
} = await import("../src/db");
const {
  pruneIntelligence,
  pruneSupersededKnowledge,
  forgetPurgeLedger,
  purgeAccountIntelligence,
  readPurgeLedger,
  recordPurgeLedger,
  requestAccountIntelligenceRebuildInTx,
  resetAccountIntelligenceInTx,
} = await import("../src/server/intelligence/infrastructure/retention");
const { createJobStore, createEffectStore, StaleClaimError } =
  await import("../src/server/intelligence/infrastructure/jobs");
// The composition opens the journal when it is evaluated, so it is imported
// dynamically for the same reason as the journal itself.
const { createIntelligenceWorker, workflowEngine, interactiveExecutionContext } =
  await import("../src/server/intelligence/composition");

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const OWNER = "retention-worker";
// The instant the worker ticks at. It is at least NOW, because a job the
// domain enqueued with the wall clock must still be claimable.
const TICK = Math.max(NOW, Date.now() + 1000);

const jobs = createJobStore(db);
const effects = createEffectStore();

/** An account row, with the fields the intelligence tables point at. */
const insertAccount = (id: string): void => {
  db.insert(accounts)
    .values({
      id,
      name: id,
      broker: "test",
      kind: "manual",
      currency: "USD",
      initialBalance: 0,
      profitCalcMethod: "fifo",
      credentialsEnc: null,
      autoSync: false,
      lastSyncAt: null,
      ibkrSyncTimeZone: null,
      snapshotJson: null,
      archivedAt: null,
      createdAt: new Date(NOW).toISOString(),
    })
    .run();
};

/** An outbox event with one delivery and one job. */
const insertEvent = (
  eventId: string,
  accountId: string,
  options: {
    readonly recordedAt?: number;
    readonly deliveryState?: "pending" | "delivered" | "failed" | "cancelled";
    readonly jobStatus?: "pending" | "running" | "completed" | "failed" | "cancelled";
    readonly jobType?: string;
  } = {},
): void => {
  const recordedAt = options.recordedAt ?? NOW;
  db.insert(domainOutbox)
    .values({
      id: eventId,
      type: "trade.projection_changed",
      schemaVersion: 1,
      aggregateType: "trade",
      aggregateId: `trade-${eventId}`,
      aggregateRevision: 1,
      correlationId: `corr-${eventId}`,
      origin: "import",
      accountId,
      payloadJson: "{}",
      recordedAt,
      occurredAt: null,
      dispatchedAt: recordedAt,
    })
    .run();
  db.insert(intelligenceJobs)
    .values({
      id: `job-${eventId}`,
      idempotencyKey: `${eventId}:trade-observation:1`,
      type: options.jobType ?? "evaluate_trade",
      payloadJson: JSON.stringify({
        type: "evaluate_trade",
        eventId,
        handlerId: "trade-observation",
        handlerVersion: "1",
      }),
      status: options.jobStatus ?? "completed",
      attempts: 1,
      availableAt: recordedAt,
      owner: null,
      fence: 1,
      leaseUntil: null,
      cancelRequested: false,
      lastError: null,
      createdAt: recordedAt,
      updatedAt: recordedAt,
    })
    .run();
  db.insert(eventDeliveries)
    .values({
      eventId,
      handlerId: "trade-observation",
      handlerVersion: "1",
      state: options.deliveryState ?? "delivered",
      jobId: `job-${eventId}`,
      lastError: options.deliveryState === "failed" ? "handler_exploded" : null,
      createdAt: recordedAt,
      updatedAt: recordedAt,
    })
    .run();
};

/** An observation of an account, with its evidence link. */
const insertObservation = (
  id: string,
  accountId: string,
  options: {
    readonly status?: "active" | "superseded" | "invalidated";
    readonly updatedAt?: number;
  } = {},
): void => {
  const updatedAt = options.updatedAt ?? NOW;
  db.insert(intelligenceObservations)
    .values({
      id,
      subjectId: `trade-${id}`,
      sourceRevision: `rev-${id}`,
      evaluatorId: "trade-evaluator",
      evaluatorVersion: "1",
      type: "trade_outcome",
      status: options.status ?? "active",
      accountId,
      currency: "USD",
      netPnl: 100,
      fees: 0,
      tradeStatus: "win",
      timingQuality: "source_reported",
      durationMs: null,
      directFactsJson: "{}",
      observationJson: "{}",
      recordedAt: updatedAt,
      updatedAt,
    })
    .run();
  db.insert(observationEvidence)
    .values({ observationId: id, revisionId: `rev-${id}` })
    .run();
};

beforeEach(() => {
  db.delete(eventDeliveries).run();
  db.delete(domainOutbox).run();
  db.delete(intelligenceJobs).run();
  db.delete(observationEvidence).run();
  db.delete(intelligenceObservations).run();
  db.delete(knowledgeHypotheses).run();
  db.delete(knowledgePatterns).run();
  db.delete(intelligenceWorkflows).run();
  db.delete(intelligenceConversations).run();
  db.delete(intelligenceOpportunities).run();
  db.delete(intelligenceRuns).run();
  db.delete(intelligenceSeedCheckpoints).run();
  db.delete(accounts).run();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("the reference-safe prune", () => {
  it("keeps the event of a pending delivery", () => {
    insertAccount("acct-1");
    insertEvent("evt-pending", "acct-1", {
      recordedAt: NOW - 41 * DAY,
      deliveryState: "pending",
      jobStatus: "pending",
    });

    const before = NOW - 40 * DAY;
    pruneIntelligence(before, 100);

    const events = db.select().from(domainOutbox).all();
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe("evt-pending");
  });

  it("keeps the event of a failed delivery, with its diagnostic", () => {
    insertAccount("acct-1");
    // The job of the delivery is finished, so only the delivery's own failure
    // keeps the event alive: the diagnostic of an unacknowledged failure must
    // not be swept away with the event.
    insertEvent("evt-failed", "acct-1", {
      recordedAt: NOW - 41 * DAY,
      deliveryState: "failed",
      jobStatus: "cancelled",
    });

    pruneIntelligence(NOW - 40 * DAY, 100);

    const events = db.select().from(domainOutbox).all();
    expect(events).toHaveLength(1);
    const delivery = db.select().from(eventDeliveries).all();
    expect(delivery[0]!.lastError).toBe("handler_exploded");
  });

  it("keeps the event of a running job", () => {
    insertAccount("acct-1");
    insertEvent("evt-running", "acct-1", {
      recordedAt: NOW - 41 * DAY,
      deliveryState: "delivered",
      jobStatus: "running",
    });

    pruneIntelligence(NOW - 40 * DAY, 100);

    expect(db.select().from(domainOutbox).all()).toHaveLength(1);
  });

  it("keeps an event that was never dispatched", () => {
    insertAccount("acct-1");
    // A committed event the worker never took: it is the backlog, and
    // deleting it would destroy work the journal still owes.
    db.insert(domainOutbox)
      .values({
        id: "evt-undispatched",
        type: "trade.projection_changed",
        schemaVersion: 1,
        aggregateType: "trade",
        aggregateId: "trade-evt-undispatched",
        aggregateRevision: 1,
        correlationId: "corr-evt-undispatched",
        origin: "import",
        accountId: "acct-1",
        payloadJson: "{}",
        recordedAt: NOW - 41 * DAY,
        occurredAt: null,
        dispatchedAt: null,
      })
      .run();

    pruneIntelligence(NOW - 40 * DAY, 100);

    const events = db.select().from(domainOutbox).all();
    expect(events.map((event) => event.id)).toContain("evt-undispatched");
  });

  it("keeps an event the dispatcher never stamped", () => {
    insertAccount("acct-1");
    // The handler answered, but the dispatcher never stamped the event: the
    // event is still the record of work the journal owes, and its delivery
    // carries the dedup key.
    db.insert(domainOutbox)
      .values({
        id: "evt-unstamped",
        type: "trade.projection_changed",
        schemaVersion: 1,
        aggregateType: "trade",
        aggregateId: "trade-evt-unstamped",
        aggregateRevision: 1,
        correlationId: "corr-evt-unstamped",
        origin: "import",
        accountId: "acct-1",
        payloadJson: "{}",
        recordedAt: NOW - 41 * DAY,
        occurredAt: null,
        dispatchedAt: null,
      })
      .run();
    db.insert(intelligenceJobs)
      .values({
        id: "job-evt-unstamped",
        idempotencyKey: "evt-unstamped:trade-observation:1",
        type: "evaluate_trade",
        payloadJson: JSON.stringify({
          type: "evaluate_trade",
          eventId: "evt-unstamped",
          handlerId: "trade-observation",
          handlerVersion: "1",
        }),
        status: "completed",
        attempts: 1,
        availableAt: NOW - 41 * DAY,
        owner: null,
        fence: 1,
        leaseUntil: null,
        cancelRequested: false,
        lastError: null,
        createdAt: NOW - 41 * DAY,
        updatedAt: NOW - 41 * DAY,
      })
      .run();
    db.insert(eventDeliveries)
      .values({
        eventId: "evt-unstamped",
        handlerId: "trade-observation",
        handlerVersion: "1",
        state: "delivered",
        jobId: "job-evt-unstamped",
        lastError: null,
        createdAt: NOW - 41 * DAY,
        updatedAt: NOW - 41 * DAY,
      })
      .run();

    pruneIntelligence(NOW - 40 * DAY, 100);

    const events = db.select().from(domainOutbox).all();
    expect(events.map((event) => event.id)).toContain("evt-unstamped");
  });

  it("keeps a dispatched event that has no delivery row", () => {
    insertAccount("acct-1");
    // The dispatcher marked the event as dispatched but no handler answered
    // yet: the delivery is the work that is still owed, so the event is not a
    // finished subtree.
    db.insert(domainOutbox)
      .values({
        id: "evt-no-delivery",
        type: "trade.projection_changed",
        schemaVersion: 1,
        aggregateType: "trade",
        aggregateId: "trade-evt-no-delivery",
        aggregateRevision: 1,
        correlationId: "corr-evt-no-delivery",
        origin: "import",
        accountId: "acct-1",
        payloadJson: "{}",
        recordedAt: NOW - 41 * DAY,
        occurredAt: null,
        dispatchedAt: NOW - 41 * DAY,
      })
      .run();

    pruneIntelligence(NOW - 40 * DAY, 100);

    const events = db.select().from(domainOutbox).all();
    expect(events.map((event) => event.id)).toContain("evt-no-delivery");
  });

  it("removes the event of a finished subtree", () => {
    insertAccount("acct-1");
    insertEvent("evt-done", "acct-1", {
      recordedAt: NOW - 41 * DAY,
      deliveryState: "delivered",
      jobStatus: "completed",
    });

    const result = pruneIntelligence(NOW - 40 * DAY, 100);

    expect(result.removed).toBeGreaterThan(0);
    expect(db.select().from(domainOutbox).all()).toHaveLength(0);
    // The delivery cascades with the event.
    expect(db.select().from(eventDeliveries).all()).toHaveLength(0);
    expect(db.select().from(intelligenceJobs).all()).toHaveLength(0);
  });

  it("keeps a recent event even when it is finished", () => {
    insertAccount("acct-1");
    insertEvent("evt-recent", "acct-1", { deliveryState: "delivered", jobStatus: "completed" });

    pruneIntelligence(NOW - 5 * DAY, 100);

    expect(db.select().from(domainOutbox).all()).toHaveLength(1);
  });
});

describe("the compact dedup keys", () => {
  it("keeps the delivery of a surviving event", () => {
    insertAccount("acct-1");
    insertEvent("evt-live", "acct-1", {
      recordedAt: NOW - 41 * DAY,
      deliveryState: "pending",
      jobStatus: "pending",
    });

    pruneIntelligence(NOW - 40 * DAY, 100);

    const deliveries = db.select().from(eventDeliveries).all();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.eventId).toBe("evt-live");
  });

  it("keeps the run row with its effect key and empties only its diagnostics", () => {
    insertAccount("acct-1");
    db.insert(intelligenceRuns)
      .values({
        id: "run-1",
        effectKey: "effect-1",
        status: "completed",
        provider: "openai",
        model: "gpt",
        endpointFingerprint: "fp",
        policyRevision: 1,
        scopeJson: JSON.stringify({
          accountIds: ["acct-1"],
          filters: {},
          timeZone: "UTC",
          dataSources: ["observations"],
          requiredFeatures: [],
          inputCharacters: 100,
        }),
        metaJson: JSON.stringify({ attempts: 2 }),
        createdAt: NOW - 40 * DAY,
        updatedAt: NOW - 40 * DAY,
      })
      .run();

    pruneIntelligence(NOW - 30 * DAY, 100);

    const runs = db.select().from(intelligenceRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.effectKey).toBe("effect-1");
    expect(runs[0]!.metaJson).toBe("{}");
  });

  it("keeps a failed run with its diagnostics", () => {
    insertAccount("acct-1");
    db.insert(intelligenceRuns)
      .values({
        id: "run-failed",
        effectKey: "effect-failed",
        status: "failed",
        provider: "openai",
        model: "gpt",
        endpointFingerprint: "fp",
        policyRevision: 1,
        scopeJson: JSON.stringify({
          accountIds: ["acct-1"],
          filters: {},
          timeZone: "UTC",
          dataSources: ["observations"],
          requiredFeatures: [],
          inputCharacters: 100,
        }),
        metaJson: JSON.stringify({ attempts: 5 }),
        createdAt: NOW - 40 * DAY,
        updatedAt: NOW - 40 * DAY,
      })
      .run();

    pruneIntelligence(NOW - 30 * DAY, 100);

    const runs = db.select().from(intelligenceRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.metaJson).toBe(JSON.stringify({ attempts: 5 }));
  });
});

describe("the bounded prune", () => {
  it("removes at most the rows the limit allows", () => {
    insertAccount("acct-1");
    for (let index = 0; index < 5; index += 1) {
      insertEvent(`evt-${index}`, "acct-1", {
        recordedAt: NOW - 41 * DAY,
        deliveryState: "delivered",
        jobStatus: "completed",
      });
    }

    const result = pruneIntelligence(NOW - 40 * DAY, 2);

    // The bound counts rows, and a finished subtree costs two of them: the
    // job and the event whose deliveries cascade with it.
    expect(result.removed).toBe(2);
    expect(db.select().from(domainOutbox).all()).toHaveLength(4);
  });
});

describe("the knowledge prune", () => {
  it("keeps an observation a live workflow names", () => {
    insertAccount("acct-1");
    insertObservation("obs-1", "acct-1", { status: "superseded", updatedAt: NOW - 100 * DAY });
    // The workflow rests on no revision, so only its subject — the observation
    // id — keeps that observation alive.
    db.insert(intelligenceWorkflows)
      .values({
        id: "wf-1",
        definitionKey: "review_observation",
        definitionVersion: 1,
        revision: 1,
        status: "waiting_for_user",
        subjectType: "observation",
        subjectId: "obs-1",
        accountId: "acct-1",
        evidenceIdsJson: "[]",
        selfReportJson: null,
        deferUntil: null,
        effectRevision: 0,
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();

    pruneSupersededKnowledge(NOW - 90 * DAY, 100);

    expect(db.select().from(intelligenceObservations).all()).toHaveLength(1);
  });

  it("keeps an observation a live opportunity names", () => {
    insertAccount("acct-1");
    insertObservation("obs-1", "acct-1", { status: "superseded", updatedAt: NOW - 100 * DAY });
    // The opportunity rests on no revision, so only its subject — the
    // observation id — keeps that observation alive.
    db.insert(intelligenceOpportunities)
      .values({
        id: "opp-1",
        dedupKey: "opportunity/observation/obs-1",
        subjectType: "observation",
        subjectId: "obs-1",
        accountId: "acct-1",
        status: "pending",
        eligibleAt: NOW - 100 * DAY,
        expiresAt: NOW + DAY,
        evidenceIdsJson: "[]",
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();

    pruneSupersededKnowledge(NOW - 90 * DAY, 100);

    expect(db.select().from(intelligenceObservations).all()).toHaveLength(1);
  });

  it("keeps an observation an open conversation names", () => {
    insertAccount("acct-1");
    insertObservation("obs-1", "acct-1", { status: "superseded", updatedAt: NOW - 100 * DAY });
    db.insert(intelligenceConversations)
      .values({
        id: "conv-1",
        subjectType: "observation",
        subjectId: "obs-1",
        accountId: "acct-1",
        status: "open",
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();

    pruneSupersededKnowledge(NOW - 90 * DAY, 100);

    expect(db.select().from(intelligenceObservations).all()).toHaveLength(1);
  });

  it("keeps an observation a dismissed revision names", () => {
    insertAccount("acct-1");
    insertObservation("obs-1", "acct-1", { status: "superseded", updatedAt: NOW - 100 * DAY });
    db.insert(intelligenceOpportunities)
      .values({
        id: "opp-dismiss",
        dedupKey: "dismissal/evidence/rev-obs-1",
        subjectType: "evidence",
        subjectId: "rev-obs-1",
        accountId: null,
        status: "dismissed",
        eligibleAt: NOW - 100 * DAY,
        expiresAt: NOW + DAY,
        evidenceIdsJson: "[]",
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();

    pruneSupersededKnowledge(NOW - 90 * DAY, 100);

    expect(db.select().from(intelligenceObservations).all()).toHaveLength(1);
  });

  it("keeps a knowledge record a live workflow cites", () => {
    insertAccount("acct-1");
    // The knowledge record rests on a revision the live workflow names, so
    // the record is still cited and must survive.
    // A newer version of the same subject exists, so the record is not the
    // current knowledge of its subject: only the live citation keeps it.
    db.insert(knowledgeHypotheses)
      .values({
        id: "hyp-2",
        subjectType: "note",
        subjectId: "note-1",
        version: 2,
        status: "active",
        payloadSchemaVersion: 1,
        payloadJson: "{}",
        evidenceIdsJson: "[]",
        evaluatorId: "evaluator",
        evaluatorVersion: "1",
        sourceKind: "note",
        sourceId: "note-1",
        sourceRevision: 1,
        accountId: null,
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();
    db.insert(knowledgeHypotheses)
      .values({
        id: "hyp-1",
        subjectType: "note",
        subjectId: "note-1",
        version: 1,
        status: "superseded",
        payloadSchemaVersion: 1,
        payloadJson: "{}",
        evidenceIdsJson: JSON.stringify(["rev-live"]),
        evaluatorId: "evaluator",
        evaluatorVersion: "1",
        sourceKind: "note",
        sourceId: "note-1",
        sourceRevision: 1,
        accountId: null,
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();
    db.insert(intelligenceWorkflows)
      .values({
        id: "wf-1",
        definitionKey: "review_observation",
        definitionVersion: 1,
        revision: 1,
        status: "waiting_for_user",
        subjectType: "observation",
        subjectId: "obs-other",
        accountId: "acct-1",
        evidenceIdsJson: JSON.stringify(["rev-live"]),
        selfReportJson: null,
        deferUntil: null,
        effectRevision: 0,
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();

    pruneSupersededKnowledge(NOW - 90 * DAY, 100);

    // The cited record survives; the newer one is not a candidate at all.
    const records = db.select().from(knowledgeHypotheses).all();
    expect(records.map((record) => record.id).sort()).toEqual(["hyp-1", "hyp-2"]);
  });

  it("removes a knowledge record a source deletion invalidated", () => {
    insertAccount("acct-1");
    // A source deletion invalidates the record and raises no successor, so
    // the record is the newest of its subject and still finished knowledge: it
    // must not survive the window forever.
    db.insert(knowledgeHypotheses)
      .values({
        id: "hyp-invalidated",
        subjectType: "note",
        subjectId: "note-1",
        version: 1,
        status: "invalidated",
        payloadSchemaVersion: 1,
        payloadJson: "{}",
        evidenceIdsJson: "[]",
        evaluatorId: "evaluator",
        evaluatorVersion: "1",
        sourceKind: "note",
        sourceId: "note-1",
        sourceRevision: 1,
        accountId: null,
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();

    pruneSupersededKnowledge(NOW - 90 * DAY, 100);

    expect(db.select().from(knowledgeHypotheses).all()).toHaveLength(0);
  });

  it("keeps a live knowledge record that is the newest of its subject", () => {
    insertAccount("acct-1");
    db.insert(knowledgeHypotheses)
      .values({
        id: "hyp-active",
        subjectType: "note",
        subjectId: "note-2",
        version: 1,
        status: "active",
        payloadSchemaVersion: 1,
        payloadJson: "{}",
        evidenceIdsJson: "[]",
        evaluatorId: "evaluator",
        evaluatorVersion: "1",
        sourceKind: "note",
        sourceId: "note-2",
        sourceRevision: 1,
        accountId: null,
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();

    pruneSupersededKnowledge(NOW - 90 * DAY, 100);

    expect(db.select().from(knowledgeHypotheses).all()).toHaveLength(1);
  });

  it("removes a superseded observation nobody names", () => {
    insertAccount("acct-1");
    insertObservation("obs-1", "acct-1", { status: "superseded", updatedAt: NOW - 100 * DAY });

    const result = pruneSupersededKnowledge(NOW - 90 * DAY, 100);

    expect(result.removed).toBeGreaterThan(0);
    expect(db.select().from(intelligenceObservations).all()).toHaveLength(0);
  });

  it("keeps a recent observation", () => {
    insertAccount("acct-1");
    insertObservation("obs-1", "acct-1", { status: "superseded", updatedAt: NOW - 10 * DAY });

    pruneSupersededKnowledge(NOW - 90 * DAY, 100);

    expect(db.select().from(intelligenceObservations).all()).toHaveLength(1);
  });
});

describe("the account purge", () => {
  it("removes the intelligence of the account and records the deletion", () => {
    insertAccount("acct-1");
    insertEvent("evt-1", "acct-1");
    insertObservation("obs-1", "acct-1");
    db.insert(intelligenceWorkflows)
      .values({
        id: "wf-1",
        definitionKey: "review_observation",
        definitionVersion: 1,
        revision: 1,
        status: "completed",
        subjectType: "observation",
        subjectId: "obs-1",
        accountId: "acct-1",
        evidenceIdsJson: "[]",
        selfReportJson: null,
        deferUntil: null,
        effectRevision: 1,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    recordPurgeLedger(scratch, "acct-1", "deleted");
    withJournalTransaction((tx) => purgeAccountIntelligence(tx, "acct-1"));

    expect(db.select().from(domainOutbox).all()).toHaveLength(0);
    expect(db.select().from(intelligenceJobs).all()).toHaveLength(0);
    expect(db.select().from(intelligenceObservations).all()).toHaveLength(0);
    expect(db.select().from(intelligenceWorkflows).all()).toHaveLength(0);
    const ledger = readPurgeLedger(scratch);
    expect(ledger).toEqual([{ accountId: "acct-1", kind: "deleted" }]);
  });

  it("removes the rows that are not account bound but talk about its observations", () => {
    insertAccount("acct-1");
    insertObservation("obs-1", "acct-1");
    db.insert(intelligenceOpportunities)
      .values({
        id: "opp-1",
        dedupKey: "opportunity/observation/obs-1",
        subjectType: "observation",
        subjectId: "obs-1",
        accountId: null,
        status: "pending",
        eligibleAt: NOW,
        expiresAt: NOW + DAY,
        evidenceIdsJson: "[]",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    withJournalTransaction((tx) => purgeAccountIntelligence(tx, "acct-1"));

    expect(db.select().from(intelligenceOpportunities).all()).toHaveLength(0);
  });

  it("takes the account id out of the scope of its background runs", () => {
    insertAccount("acct-1");
    insertAccount("acct-2");
    db.insert(intelligenceRuns)
      .values({
        id: "run-1",
        effectKey: "effect-1",
        status: "completed",
        provider: "openai",
        model: "gpt",
        endpointFingerprint: "fp",
        policyRevision: 1,
        scopeJson: JSON.stringify({
          accountIds: ["acct-1", "acct-2"],
          filters: {},
          timeZone: "UTC",
          dataSources: ["observations"],
          requiredFeatures: [],
          inputCharacters: 100,
        }),
        metaJson: "{}",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    withJournalTransaction((tx) => purgeAccountIntelligence(tx, "acct-1"));

    const runs = db.select().from(intelligenceRuns).all();
    expect(runs).toHaveLength(1);
    const scope = JSON.parse(runs[0]!.scopeJson) as { accountIds: string[] };
    expect(scope.accountIds).toEqual(["acct-2"]);
  });

  it("deletes a background run whose only account is gone", () => {
    insertAccount("acct-1");
    db.insert(intelligenceRuns)
      .values({
        id: "run-1",
        effectKey: "effect-1",
        status: "completed",
        provider: "openai",
        model: "gpt",
        endpointFingerprint: "fp",
        policyRevision: 1,
        scopeJson: JSON.stringify({
          accountIds: ["acct-1"],
          filters: {},
          timeZone: "UTC",
          dataSources: ["observations"],
          requiredFeatures: [],
          inputCharacters: 100,
        }),
        metaJson: "{}",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    withJournalTransaction((tx) => purgeAccountIntelligence(tx, "acct-1"));

    expect(db.select().from(intelligenceRuns).all()).toHaveLength(0);
  });
});

describe("the reset and its reseed suppression", () => {
  it("purges the intelligence and suppresses the seed", () => {
    insertAccount("acct-1");
    insertObservation("obs-1", "acct-1");
    db.insert(intelligenceSeedCheckpoints)
      .values({
        accountId: "acct-1",
        status: "completed",
        lastTradeKey: "trade-1",
        baselineOperationId: "op-1",
        updatedAt: NOW,
      })
      .run();

    recordPurgeLedger(scratch, "acct-1", "reset");
    withJournalTransaction((tx) => resetAccountIntelligenceInTx(tx, "acct-1", NOW));

    expect(db.select().from(intelligenceObservations).all()).toHaveLength(0);
    const checkpoint = db
      .select()
      .from(intelligenceSeedCheckpoints)
      .where(eq(intelligenceSeedCheckpoints.accountId, "acct-1"))
      .get();
    expect(checkpoint?.status).toBe("suppressed");
    // The checkpoint still names its baseline operation, so the column the
    // schema requires is written.
    expect(checkpoint?.baselineOperationId).toBe("op-1");
    const ledger = readPurgeLedger(scratch);
    expect(ledger).toEqual([{ accountId: "acct-1", kind: "reset" }]);
  });

  it("enqueues the seed job when a rebuild is requested", () => {
    insertAccount("acct-1");
    recordPurgeLedger(scratch, "acct-1", "reset");
    withJournalTransaction((tx) => {
      resetAccountIntelligenceInTx(tx, "acct-1", NOW);
      requestAccountIntelligenceRebuildInTx(tx, "acct-1", NOW);
    });

    // Without a seed job the account would sit at a pending checkpoint with no
    // observations, which is the opposite of what a rebuild asks for.
    const jobs = db.select().from(intelligenceJobs).all();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.type).toBe("seed_account");
    expect(JSON.parse(jobs[0]!.payloadJson)).toMatchObject({
      type: "seed_account",
      accountId: "acct-1",
    });
  });

  it("re-arms the seed job when the account is rebuilt again", () => {
    insertAccount("acct-1");
    recordPurgeLedger(scratch, "acct-1", "reset");

    // The first rebuild runs the seed.
    withJournalTransaction((tx) => {
      resetAccountIntelligenceInTx(tx, "acct-1", NOW);
      requestAccountIntelligenceRebuildInTx(tx, "acct-1", NOW);
    });
    const first = db.select().from(intelligenceJobs).all();
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("pending");

    // The seed runs and finishes.
    withJournalTransaction((tx) => {
      tx.update(intelligenceJobs)
        .set({ status: "completed", updatedAt: NOW })
        .where(eq(intelligenceJobs.id, first[0]!.id))
        .run();
    });

    // A second reset and rebuild must run the seed again: a job key that
    // collides with the finished one would leave the account with a pending
    // checkpoint and no runnable work.
    withJournalTransaction((tx) => {
      resetAccountIntelligenceInTx(tx, "acct-1", NOW);
      requestAccountIntelligenceRebuildInTx(tx, "acct-1", NOW);
    });

    const second = db.select().from(intelligenceJobs).all();
    expect(second).toHaveLength(1);
    expect(second[0]!.status).toBe("pending");
    expect(second[0]!.attempts).toBe(0);
    // The re-armed job is runnable work: a worker can claim it, so the
    // account's intelligence comes back.
    const claim = jobs.claim(OWNER, NOW + 1000);
    expect(claim?.jobId).toBe(second[0]!.id);
  });

  it("moves the checkpoint back to pending when a rebuild is requested", () => {
    insertAccount("acct-1");
    recordPurgeLedger(scratch, "acct-1", "reset");
    withJournalTransaction((tx) => {
      resetAccountIntelligenceInTx(tx, "acct-1", NOW);
      requestAccountIntelligenceRebuildInTx(tx, "acct-1", NOW);
    });
    forgetPurgeLedger(scratch, "acct-1");

    const checkpoint = db
      .select()
      .from(intelligenceSeedCheckpoints)
      .where(eq(intelligenceSeedCheckpoints.accountId, "acct-1"))
      .get();
    expect(checkpoint?.status).toBe("pending");
    // The reset has been undone, so the ledger forgets it.
    const ledger = readPurgeLedger(scratch);
    expect(ledger).toEqual([]);
  });
});

describe("the cancellation fence", () => {
  it("fences a completion that races the purge", () => {
    insertAccount("acct-1");
    insertEvent("evt-1", "acct-1", { deliveryState: "pending", jobStatus: "pending" });

    // The worker claims the job, then the purge runs.
    const claim = jobs.claim(OWNER, NOW);
    expect(claim).not.toBeNull();

    withJournalTransaction((tx) => purgeAccountIntelligence(tx, "acct-1"));

    expect(db.select().from(intelligenceJobs).all()).toHaveLength(0);
    expect(db.select().from(domainOutbox).all()).toHaveLength(0);

    // The completion finds no job row and is fenced.
    let fenced: unknown = null;
    try {
      withJournalTransaction((tx) => effects.complete(tx, claim!, NOW));
    } catch (error) {
      fenced = error;
    }
    expect(fenced).toBeInstanceOf(StaleClaimError);
    expect((fenced as InstanceType<typeof StaleClaimError>).reason).toBe("stale");
  });
});

describe("the retention job", () => {
  it("prunes through the worker's retention handler", async () => {
    insertAccount("acct-1");
    // The finished subtree nobody names: the transport prune may take it.
    insertEvent("evt-gone", "acct-1", {
      recordedAt: NOW - 42 * DAY,
      deliveryState: "delivered",
      jobStatus: "completed",
    });
    // The pending delivery is live, so its event stays.
    insertEvent("evt-pending", "acct-1", {
      recordedAt: NOW - 42 * DAY,
      deliveryState: "pending",
      jobStatus: "pending",
    });
    // The failed delivery and its failed job are unacknowledged failures, so
    // the event and the job stay.
    insertEvent("evt-failed", "acct-1", {
      recordedAt: NOW - 42 * DAY,
      deliveryState: "failed",
      jobStatus: "failed",
    });
    // The running job still has work to do, so its event stays.
    insertEvent("evt-running", "acct-1", {
      recordedAt: NOW - 42 * DAY,
      deliveryState: "delivered",
      jobStatus: "running",
    });
    // The pending job of the live event must not be claimed by the worker
    // before the retention job: it belongs to a later attempt.
    db.update(intelligenceJobs)
      .set({ availableAt: NOW + DAY })
      .where(eq(intelligenceJobs.id, "job-evt-pending"))
      .run();

    // A finished run loses its diagnostics but keeps its effect key, and a
    // failed run keeps both.
    db.insert(intelligenceRuns)
      .values({
        id: "run-done",
        effectKey: "effect-done",
        status: "completed",
        provider: "openai",
        model: "gpt",
        endpointFingerprint: "fp",
        policyRevision: 1,
        scopeJson: JSON.stringify({
          accountIds: ["acct-1"],
          filters: {},
          timeZone: "UTC",
          dataSources: ["observations"],
          requiredFeatures: [],
          inputCharacters: 100,
        }),
        metaJson: JSON.stringify({ attempts: 2 }),
        createdAt: NOW - 42 * DAY,
        updatedAt: NOW - 42 * DAY,
      })
      .run();
    db.insert(intelligenceRuns)
      .values({
        id: "run-failed",
        effectKey: "effect-failed",
        status: "failed",
        provider: "openai",
        model: "gpt",
        endpointFingerprint: "fp",
        policyRevision: 1,
        scopeJson: JSON.stringify({
          accountIds: ["acct-1"],
          filters: {},
          timeZone: "UTC",
          dataSources: ["observations"],
          requiredFeatures: [],
          inputCharacters: 100,
        }),
        metaJson: JSON.stringify({ attempts: 5 }),
        createdAt: NOW - 42 * DAY,
        updatedAt: NOW - 42 * DAY,
      })
      .run();

    // The knowledge class: an active observation, one a live record names,
    // and one nobody names.
    insertObservation("obs-active", "acct-1", { status: "active", updatedAt: NOW - 100 * DAY });
    insertObservation("obs-workflow", "acct-1", {
      status: "superseded",
      updatedAt: NOW - 100 * DAY,
    });
    insertObservation("obs-opportunity", "acct-1", {
      status: "superseded",
      updatedAt: NOW - 100 * DAY,
    });
    insertObservation("obs-conversation", "acct-1", {
      status: "superseded",
      updatedAt: NOW - 100 * DAY,
    });
    insertObservation("obs-stale", "acct-1", {
      status: "superseded",
      updatedAt: NOW - 100 * DAY,
    });
    db.insert(intelligenceWorkflows)
      .values({
        id: "wf-live",
        definitionKey: "review_observation",
        definitionVersion: 1,
        revision: 1,
        status: "waiting_for_user",
        subjectType: "observation",
        subjectId: "obs-workflow",
        accountId: "acct-1",
        evidenceIdsJson: "[]",
        selfReportJson: null,
        deferUntil: null,
        effectRevision: 0,
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();
    db.insert(intelligenceOpportunities)
      .values({
        id: "opp-live",
        dedupKey: "opportunity/observation/obs-opportunity",
        subjectType: "observation",
        subjectId: "obs-opportunity",
        accountId: "acct-1",
        status: "pending",
        eligibleAt: NOW - 100 * DAY,
        expiresAt: NOW + DAY,
        evidenceIdsJson: "[]",
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();
    db.insert(intelligenceConversations)
      .values({
        id: "conv-live",
        subjectType: "observation",
        subjectId: "obs-conversation",
        accountId: "acct-1",
        status: "open",
        createdAt: NOW - 100 * DAY,
        updatedAt: NOW - 100 * DAY,
      })
      .run();

    const retentionJobId = withJournalTransaction((tx) =>
      jobs.enqueue(tx, "retention:run-1", { type: "retention", before: NOW - 41 * DAY }, NOW),
    );
    const worker = createIntelligenceWorker({ db, clock: () => NOW, owner: OWNER });
    for (let tick = 0; tick < 5; tick += 1) {
      const row = db
        .select()
        .from(intelligenceJobs)
        .where(eq(intelligenceJobs.id, retentionJobId))
        .get();
      if (row?.status !== "pending") break;
      await worker.tick(TICK);
    }

    // The job itself ran: the handler was found, so the job is not a dead
    // letter.
    const retentionJob = db
      .select()
      .from(intelligenceJobs)
      .where(eq(intelligenceJobs.id, retentionJobId))
      .get();
    expect(retentionJob?.status).toBe("completed");
    expect(retentionJob?.lastError).toBeNull();
    expect(
      db
        .select()
        .from(intelligenceJobs)
        .all()
        .filter((job) => job.status === "failed" && job.lastError === "unhandled_job"),
    ).toHaveLength(0);

    // The transport class: the unreferenced finished subtree is gone, with
    // its job row.
    expect(
      db
        .select()
        .from(domainOutbox)
        .all()
        .map((event) => event.id),
    ).not.toContain("evt-gone");
    expect(
      db
        .select()
        .from(intelligenceJobs)
        .all()
        .map((job) => job.id),
    ).not.toContain("job-evt-gone");
    // The live and the failed delivery keep their events.
    expect(
      db
        .select()
        .from(domainOutbox)
        .all()
        .map((event) => event.id),
    ).toContain("evt-pending");
    expect(
      db
        .select()
        .from(domainOutbox)
        .all()
        .map((event) => event.id),
    ).toContain("evt-failed");
    expect(
      db
        .select()
        .from(intelligenceJobs)
        .all()
        .map((job) => job.id),
    ).toContain("job-evt-failed");
    expect(
      db
        .select()
        .from(domainOutbox)
        .all()
        .map((event) => event.id),
    ).toContain("evt-running");
    const failedDelivery = db
      .select()
      .from(eventDeliveries)
      .where(eq(eventDeliveries.eventId, "evt-failed"))
      .get();
    expect(failedDelivery?.lastError).toBe("handler_exploded");
    const failedRun = db
      .select()
      .from(intelligenceRuns)
      .where(eq(intelligenceRuns.id, "run-failed"))
      .get();
    expect(failedRun?.metaJson).toBe(JSON.stringify({ attempts: 5 }));

    // The compact dedup keys survive: the delivery of the surviving event,
    // the run row with its effect key, and the opportunity row.
    expect(
      db
        .select()
        .from(eventDeliveries)
        .where(eq(eventDeliveries.eventId, "evt-pending"))
        .all()
        .map((delivery) => [delivery.eventId, delivery.handlerId, delivery.handlerVersion]),
    ).toEqual([["evt-pending", "trade-observation", "1"]]);
    const doneRun = db
      .select()
      .from(intelligenceRuns)
      .where(eq(intelligenceRuns.id, "run-done"))
      .get();
    expect(doneRun?.effectKey).toBe("effect-done");
    expect(doneRun?.metaJson).toBe("{}");
    const opportunity = db
      .select()
      .from(intelligenceOpportunities)
      .where(eq(intelligenceOpportunities.id, "opp-live"))
      .get();
    expect(opportunity?.dedupKey).toBe("opportunity/observation/obs-opportunity");

    // The knowledge class: the active observation is untouched, the live
    // records keep theirs, and the unreferenced one is gone.
    const observations = db
      .select()
      .from(intelligenceObservations)
      .all()
      .map((row) => row.id);
    expect(observations).toContain("obs-active");
    expect(observations).toContain("obs-workflow");
    expect(observations).toContain("obs-opportunity");
    expect(observations).toContain("obs-conversation");
    expect(observations).not.toContain("obs-stale");
  });
});

describe("the deferred workflow", () => {
  it("resumes through the worker's workflow effect handler", async () => {
    insertAccount("acct-1");
    insertObservation("obs-1", "acct-1");

    const started = workflowEngine.startWorkflow(
      {
        subjectType: "observation",
        subjectId: "obs-1",
        accountId: "acct-1",
        evidenceIds: [],
      },
      interactiveExecutionContext(["acct-1"]),
    );
    const worker = createIntelligenceWorker({ db, clock: () => NOW, owner: OWNER });

    // The first effect hands the workflow to the user.
    const firstJob = db
      .select()
      .from(intelligenceJobs)
      .where(eq(intelligenceJobs.idempotencyKey, `workflow-effect:${started.workflowId}:1`))
      .get();
    expect(firstJob?.status).toBe("pending");
    for (let tick = 0; tick < 5; tick += 1) {
      const row = db
        .select()
        .from(intelligenceJobs)
        .where(eq(intelligenceJobs.idempotencyKey, `workflow-effect:${started.workflowId}:1`))
        .get();
      if (row?.status !== "pending") break;
      await worker.tick(TICK);
    }
    const presented = db
      .select()
      .from(intelligenceWorkflows)
      .where(eq(intelligenceWorkflows.id, started.workflowId))
      .get();
    expect(presented?.status).toBe("waiting_for_user");

    // The user defers the workflow; the deferral enqueues the wake-up.
    const deferred = workflowEngine.transitionWorkflow(
      {
        commandId: "cmd-defer-1",
        workflowId: started.workflowId,
        expectedRevision: presented!.revision,
        action: "defer",
        deferUntil: NOW,
      },
      interactiveExecutionContext(["acct-1"]),
    );
    expect(deferred.kind).toBe("applied");
    const scheduled = db
      .select()
      .from(intelligenceWorkflows)
      .where(eq(intelligenceWorkflows.id, started.workflowId))
      .get();
    expect(scheduled?.status).toBe("scheduled");

    // The wake-up runs on the worker's schedule.
    for (let tick = 0; tick < 5; tick += 1) {
      const row = db
        .select()
        .from(intelligenceJobs)
        .where(eq(intelligenceJobs.idempotencyKey, `workflow-effect:${started.workflowId}:3`))
        .get();
      if (row?.status !== "pending") break;
      await worker.tick(TICK);
    }
    const wakeJob = db
      .select()
      .from(intelligenceJobs)
      .where(eq(intelligenceJobs.idempotencyKey, `workflow-effect:${started.workflowId}:3`))
      .get();
    expect(wakeJob?.status).toBe("completed");

    // The workflow waits for the user again, and the dead letter never
    // accumulated.
    const resumed = db
      .select()
      .from(intelligenceWorkflows)
      .where(eq(intelligenceWorkflows.id, started.workflowId))
      .get();
    expect(resumed?.status).toBe("waiting_for_user");
    expect(resumed?.effectRevision).toBe(3);
    expect(
      db
        .select()
        .from(intelligenceJobs)
        .all()
        .filter((job) => job.status === "failed" && job.lastError === "unhandled_job"),
    ).toHaveLength(0);
  });
});
