import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import type { ExecutionSourceQuality } from "../src/server/executions";

/**
 * The observation suite (Phase 08).
 *
 * An observation is a factual statement about a trade that the journal can
 * supersede, invalidate and never silently revive. Every case here drives the
 * durable path — a committed trade change, the outbox, a job, the worker, the
 * handler and the store — against a disposable journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-observations-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
// A static import cannot work here: the import would run before the
// environment is set.
const {
  db,
  withJournalTransaction,
  accounts,
  eventDeliveries,
  executionEvidence,
  executions,
  intelligenceJobs,
  intelligenceObservations,
  intelligenceSeedCheckpoints,
  intelligenceWorkerLease,
  domainOutbox,
  observationEvidence,
  tradeIdentities,
  tradeIdentityLinks,
  tradeProjectionRevisions,
  tradeRevisionExecutions,
  trades,
} = await import("../src/db");
const { insertExecutionsInTx, deleteExecutionsForTradesInTx } =
  await import("../src/server/executions");
const { changeContext, reconcileAccountInTx } = await import("../src/server/trading/reconcile");
const { createJobStore, createEffectStore, createReplayService } =
  await import("../src/server/intelligence/infrastructure/jobs");
const { createWorkerService } = await import("../src/server/intelligence/infrastructure/worker");
const { createOutboxDispatcher } = await import("../src/server/intelligence/infrastructure/outbox");
const { observationHandlers, observationOutboxHandlers } =
  await import("../src/server/intelligence/composition");

const NOW = 1_800_000_000_000;
const OWNER = "observation-worker";

const jobs = createJobStore(db);
const effects = createEffectStore();
const dispatcher = createOutboxDispatcher({ db, jobs, handlers: observationOutboxHandlers });
const replay = createReplayService({
  db,
  jobs,
  handlers: observationOutboxHandlers,
  clock: () => NOW,
});
const requestReplay = (eventId: string): string => {
  const handler = observationOutboxHandlers[0]!;
  return replay.requestReplay(eventId, handler.id, handler.version);
};

/** The worker that observes the committed trade changes of this scratch journal. */
const worker = createWorkerService({
  db,
  jobs,
  effects,
  dispatcher,
  handlers: observationHandlers,
  clock: () => NOW,
  owner: OWNER,
});

/** Runs the worker until it has nothing left to claim. */
const drain = async (): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await worker.tick(NOW))) return;
  }
  throw new Error("The worker did not settle.");
};

/** An account that owns nothing but the fills the case inserts. */
const createAccount = (id: string): string => {
  db.insert(accounts).values({ id, name: id, kind: "manual", createdAt: "2026-01-01" }).run();
  return id;
};

/** Inserts fills and reconciles them, exactly like an ingestion does. */
const insertFills = (
  accountId: string,
  rows: ImportedExecution[],
  quality?: (row: ImportedExecution) => ExecutionSourceQuality | null,
): void => {
  withJournalTransaction((tx) => {
    insertExecutionsInTx(
      tx,
      accountId,
      rows,
      "import",
      changeContext("user", "live"),
      undefined,
      quality ? { quality } : undefined,
    );
  });
};

/** Replaces the exit of a trade with a corrected one, in one transaction. */
const correctExit = (accountId: string, price: number): void => {
  const exitRow = db
    .select()
    .from(executions)
    .where(eq(executions.accountId, accountId))
    .all()
    .find((row) => row.side === "sell");
  if (!exitRow) throw new Error("The account has no exit fill to correct.");
  withJournalTransaction((tx) => {
    deleteExecutionsForTradesInTx(tx, accountId, [exitRow.id]);
    insertExecutionsInTx(
      tx,
      accountId,
      [{ symbol: "TEST", side: "sell", quantity: 10, price, fee: 0, executedAt: EXIT_AT }],
      "import",
      changeContext("user", "live"),
    );
  });
};

/** Deletes every fill of an account and reconciles the removal. */
const removeFills = (accountId: string): void => {
  const ids = db
    .select({ id: executions.id })
    .from(executions)
    .where(eq(executions.accountId, accountId))
    .all()
    .map((row) => row.id);
  withJournalTransaction((tx) => {
    deleteExecutionsForTradesInTx(tx, accountId, ids);
    reconcileAccountInTx(tx, accountId, changeContext("user", "live"));
  });
};

/** The observations the journal holds. */
const observations = () => db.select().from(intelligenceObservations).all();
/** The evidence links the journal holds. */
const links = () => db.select().from(observationEvidence).all();
/** The committed trade changes, oldest revision first. */
const events = () =>
  db
    .select()
    .from(domainOutbox)
    .all()
    .sort(
      (left, right) =>
        left.aggregateRevision - right.aggregateRevision || left.id.localeCompare(right.id),
    );
/** The committed trade change of one account at one revision. */
const eventFor = (accountId: string, index: number) =>
  events().filter((row) => JSON.parse(row.payloadJson).accountId === accountId)[index]!;
/** The job the outbox fanned an event out to. */
const jobForEvent = (eventId: string) =>
  db
    .select()
    .from(intelligenceJobs)
    .all()
    .find((row) => {
      const payload = JSON.parse(row.payloadJson) as { eventId?: string };
      return payload.eventId === eventId;
    });

/**
 * Hands one job to the observation handler again, the way a redelivery does.
 *
 * The handler reads the committed event and the current revision inside the
 * caller's transaction, so a redelivery is judged by the same fence as the
 * first delivery.
 */
const deliver = (jobId: string): void => {
  const job = jobs.load(jobId);
  if (!job) throw new Error(`No job ${jobId}.`);
  const payload = job.payload;
  if (payload.type !== "evaluate_trade") throw new Error("The job is not a trade evaluation.");
  withJournalTransaction((tx) => {
    for (const handler of observationHandlers) {
      if (handler.id !== payload.handlerId) continue;
      if (handler.version !== payload.handlerVersion) continue;
      handler.run(tx, job);
    }
  });
};

const ENTRY_AT = "2026-09-01T10:00:00Z";
const EXIT_AT = "2026-09-01T11:00:00Z";

const entry: ImportedExecution = {
  symbol: "TEST",
  side: "buy",
  quantity: 10,
  price: 100,
  fee: 0,
  executedAt: ENTRY_AT,
};
const exit: ImportedExecution = {
  symbol: "TEST",
  side: "sell",
  quantity: 10,
  price: 102,
  fee: 0,
  executedAt: EXIT_AT,
};

/** An opening fill the journal invented, not a source record. */
const syntheticEntry = (id: string, executedAt: string): ImportedExecution => ({
  symbol: "TEST",
  side: "buy",
  quantity: 10,
  price: 100,
  fee: 0,
  executedAt,
  importMetadata: { id: `synthetic:open:${id}`, order: 0 },
});
/** The closing fill of a synthetic cycle. */
const exitAt = (price: number, executedAt: string): ImportedExecution => ({
  symbol: "TEST",
  side: "sell",
  quantity: 10,
  price,
  fee: 0,
  executedAt,
  importMetadata: { id: `exit-${executedAt}`, order: 1 },
});
/** The classification a source proves about a synthetic opening fill. */
const syntheticQuality = (row: ImportedExecution): ExecutionSourceQuality | null =>
  row.importMetadata?.id?.startsWith("synthetic:open:")
    ? { timingQuality: "reconstructed", sourceKind: "ctrader_synthetic_open" }
    : null;

beforeEach(() => {
  db.delete(observationEvidence).run();
  db.delete(intelligenceObservations).run();
  db.delete(executionEvidence).run();
  db.delete(tradeRevisionExecutions).run();
  db.delete(tradeProjectionRevisions).run();
  db.delete(tradeIdentityLinks).run();
  db.delete(tradeIdentities).run();
  db.delete(domainOutbox).run();
  db.delete(eventDeliveries).run();
  db.delete(intelligenceJobs).run();
  db.delete(intelligenceWorkerLease).run();
  db.delete(intelligenceSeedCheckpoints).run();
  db.delete(executions).run();
  db.delete(trades).run();
  db.delete(accounts).run();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("a duplicate delivery", () => {
  it("writes one observation and one evidence link, and the observation stays active", async () => {
    const account = createAccount("acct-duplicate");
    insertFills(account, [entry, exit]);
    await drain();

    const first = observations();
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("active");
    expect(links()).toHaveLength(1);

    // The same event, handed to the handler a second time.
    const job = jobForEvent(eventFor(account, 0).id);
    if (!job) throw new Error("The event was never fanned out.");
    expect(job.status).toBe("completed");
    deliver(job.id);

    const after = observations();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(first[0]!.id);
    expect(after[0]!.status).toBe("active");
    expect(after[0]!.updatedAt).toBe(first[0]!.updatedAt);
    expect(links()).toHaveLength(1);
    expect(links()[0]!.observationId).toBe(first[0]!.id);
    expect(links()[0]!.revisionId).toBe(first[0]!.sourceRevision);
  });
});

describe("a correction", () => {
  it("supersedes the earlier observation and activates the new one", async () => {
    const account = createAccount("acct-correction");
    insertFills(account, [entry, exit]);
    await drain();

    const first = observations();
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("active");
    expect(first[0]!.netPnl).toBe(20);
    expect(first[0]!.timingQuality).toBe("source_reported");
    expect(first[0]!.durationMs).toBe(3_600_000);

    // The same trade, with a corrected exit: a new revision and a new event.
    correctExit(account, 105);
    await drain();

    const after = observations();
    expect(after).toHaveLength(2);

    const superseded = after.find((row) => row.id === first[0]!.id)!;
    const active = after.find((row) => row.id !== first[0]!.id)!;
    expect(superseded.status).toBe("superseded");
    expect(active.status).toBe("active");
    expect(active.sourceRevision).not.toBe(superseded.sourceRevision);
    expect(active.netPnl).toBe(50);
    expect(links()).toHaveLength(2);

    // The direct fact and the derived observation are stored apart.
    const revision = db
      .select()
      .from(tradeProjectionRevisions)
      .where(eq(tradeProjectionRevisions.id, active.sourceRevision))
      .get();
    expect(revision).toBeTruthy();
    expect(active.directFactsJson).toBe(revision!.snapshotJson);
    const derived = JSON.parse(active.observationJson) as {
      kind: string;
      evidence: { revisionId: string; netPnl: number };
    };
    expect(derived.kind).toBe("trade_projection");
    expect(derived.evidence.revisionId).toBe(active.sourceRevision);
    expect(derived.evidence.netPnl).toBe(50);
    expect(active.directFactsJson).not.toBe(active.observationJson);
  });
});

describe("a removal", () => {
  it("invalidates the active observation and writes no new observation", async () => {
    const account = createAccount("acct-removal");
    insertFills(account, [entry, exit]);
    await drain();

    const first = observations();
    expect(first).toHaveLength(1);
    expect(first[0]!.status).toBe("active");

    removeFills(account);

    const removal = events().find((row) => {
      const payload = JSON.parse(row.payloadJson) as { kind?: string };
      return payload.kind === "removed";
    });
    expect(removal).toBeTruthy();

    await drain();

    const after = observations();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(first[0]!.id);
    expect(after[0]!.status).toBe("invalidated");
    expect(links()).toHaveLength(1);
  });
});

describe("a reversed event order", () => {
  it("refuses the old event, so the old truth is never revived", async () => {
    const account = createAccount("acct-reversed");
    insertFills(account, [entry, exit]);
    await drain();

    const first = observations();
    expect(first).toHaveLength(1);
    const oldEvent = eventFor(account, 0);

    correctExit(account, 105);
    await drain();

    const afterCorrection = observations();
    expect(afterCorrection).toHaveLength(2);
    expect(afterCorrection.find((row) => row.id === first[0]!.id)!.status).toBe("superseded");

    // The old event arrives after the newer revision was recorded.
    const oldJob = jobForEvent(oldEvent.id);
    if (!oldJob) throw new Error("The old event was never fanned out.");
    deliver(oldJob.id);

    const after = observations();
    expect(after).toHaveLength(2);
    expect(after.find((row) => row.id === first[0]!.id)!.status).toBe("superseded");
    expect(after.find((row) => row.id !== first[0]!.id)!.status).toBe("active");
    expect(links()).toHaveLength(2);
  });
});

describe("a synthetic entry", () => {
  it("is never source-reported timing, with either a zero or a nonzero duration", async () => {
    const zero = createAccount("acct-synthetic-zero");
    const nonzero = createAccount("acct-synthetic-nonzero");

    insertFills(
      zero,
      [syntheticEntry("order-42", ENTRY_AT), exitAt(102, ENTRY_AT)],
      syntheticQuality,
    );
    insertFills(
      nonzero,
      [syntheticEntry("order-43", ENTRY_AT), exitAt(102, EXIT_AT)],
      syntheticQuality,
    );

    await drain();

    const all = observations();
    expect(all).toHaveLength(2);

    const zeroObservation = all.find((row) => row.accountId === zero)!;
    const zeroSnapshot = JSON.parse(zeroObservation.directFactsJson) as {
      durationMs: number | null;
      timingQuality: string;
    };
    // The projection really has a duration: a zero one.
    expect(zeroSnapshot.durationMs).toBe(0);
    expect(zeroObservation.timingQuality).not.toBe("source_reported");
    expect(zeroObservation.timingQuality).toBe("reconstructed");
    expect(zeroObservation.durationMs).toBeNull();

    const nonzeroObservation = all.find((row) => row.accountId === nonzero)!;
    const nonzeroSnapshot = JSON.parse(nonzeroObservation.directFactsJson) as {
      durationMs: number | null;
      timingQuality: string;
    };
    // The projection really has a duration: a nonzero one.
    expect(nonzeroSnapshot.durationMs).toBe(3_600_000);
    expect(nonzeroObservation.timingQuality).not.toBe("source_reported");
    expect(nonzeroObservation.timingQuality).toBe("reconstructed");
    expect(nonzeroObservation.durationMs).toBeNull();
  });
});

describe("a legacy quality", () => {
  it("stays unknown and is never guessed from a duration", async () => {
    const account = createAccount("acct-legacy");
    // A legacy synthetic entry: the journal invented it and no source ever
    // proved anything about its timing, so it has no evidence sidecar row.
    insertFills(account, [syntheticEntry("order-legacy", ENTRY_AT), exitAt(102, EXIT_AT)]);

    await drain();

    const all = observations();
    expect(all).toHaveLength(1);
    const observation = all[0]!;
    expect(observation.timingQuality).toBe("unknown");
    expect(observation.durationMs).toBeNull();

    // The duration exists in the fact; it is the quality that withholds it.
    const snapshot = JSON.parse(observation.directFactsJson) as {
      durationMs: number | null;
      timingQuality: string;
    };
    expect(snapshot.durationMs).toBe(3_600_000);
    expect(snapshot.timingQuality).toBe("unknown");

    const derived = JSON.parse(observation.observationJson) as {
      evidence: { timingQuality: string; durationMs: number | null };
    };
    expect(derived.evidence.timingQuality).toBe("unknown");
    expect(derived.evidence.durationMs).toBeNull();
  });
});

describe("a stale or cancelled source", () => {
  it("writes no observation", async () => {
    const stale = createAccount("acct-stale");
    const cancelled = createAccount("acct-cancelled");
    insertFills(stale, [entry, exit]);
    insertFills(cancelled, [entry, exit]);
    const oldEvent = eventFor(stale, 0);

    // A newer revision is recorded, so the old event is stale.
    correctExit(stale, 105);

    dispatcher.dispatchOutbox(100, NOW);
    const staleJob = jobForEvent(oldEvent.id);
    if (!staleJob) throw new Error("The old event was never fanned out.");
    const freshJob = jobForEvent(eventFor(stale, 1).id);
    if (!freshJob) throw new Error("The new event was never fanned out.");
    const cancelledJob = jobForEvent(eventFor(cancelled, 0).id);
    if (!cancelledJob) throw new Error("The cancelled event was never fanned out.");

    // The stale source is refused by the current-revision fence.
    deliver(staleJob.id);
    expect(observations()).toHaveLength(0);
    expect(links()).toHaveLength(0);

    // The same handler writes the observation of the current revision, so the
    // refusal above was the fence and not a handler that never runs.
    deliver(freshJob.id);
    expect(observations().filter((row) => row.accountId === stale)).toHaveLength(1);
    expect(links()).toHaveLength(1);

    // A cancelled source never runs at all.
    jobs.cancel(cancelledJob.id);
    await drain();

    expect(observations().filter((row) => row.accountId === cancelled)).toHaveLength(0);
    const cancelledRow = db
      .select()
      .from(intelligenceJobs)
      .where(eq(intelligenceJobs.id, cancelledJob.id))
      .get();
    expect(cancelledRow?.status).toBe("cancelled");
    expect(cancelledRow?.attempts).toBe(0);
  });
});

describe("a deleted account", () => {
  it("writes no observation", async () => {
    const live = createAccount("acct-live");
    const deleted = createAccount("acct-deleted");
    insertFills(live, [entry, exit]);
    insertFills(deleted, [entry, exit]);

    db.delete(accounts).where(eq(accounts.id, deleted)).run();

    dispatcher.dispatchOutbox(100, NOW);
    const liveJob = jobForEvent(eventFor(live, 0).id);
    if (!liveJob) throw new Error("The live event was never fanned out.");
    const deletedJob = jobForEvent(eventFor(deleted, 0).id);
    if (!deletedJob) throw new Error("The deleted event was never fanned out.");

    // The same handler writes the observation of a live account, so the
    // refusal below is the deleted account and not a handler that never runs.
    deliver(liveJob.id);
    expect(observations().filter((row) => row.accountId === live)).toHaveLength(1);

    deliver(deletedJob.id);

    expect(observations().filter((row) => row.accountId === deleted)).toHaveLength(0);
    expect(observations()).toHaveLength(1);
    expect(links()).toHaveLength(1);
  });
});

describe("a quality the source proves later", () => {
  it("corrects the projection and the observation exactly once", async () => {
    const account = createAccount("acct-quality-upgrade");
    const fills = [syntheticEntry("order-upgrade", ENTRY_AT), exitAt(102, EXIT_AT)];

    // The first delivery proves nothing about the invented opening fill; the
    // real close is a source record all along.
    insertFills(account, fills, (row) =>
      row.importMetadata?.id?.startsWith("synthetic:open:")
        ? { timingQuality: "unknown", sourceKind: "ctrader_synthetic_open" }
        : { timingQuality: "source_reported", sourceKind: "ctrader_deal" },
    );
    await drain();

    const first = observations().filter((row) => row.accountId === account);
    expect(first).toHaveLength(1);
    expect(first[0]!.timingQuality).toBe("unknown");
    expect(first[0]!.status).toBe("active");
    const revisionsAfterFirst = db
      .select()
      .from(tradeProjectionRevisions)
      .where(eq(tradeProjectionRevisions.accountId, account))
      .all().length;
    const eventsAfterFirst = events().filter(
      (row) => JSON.parse(row.payloadJson).accountId === account,
    ).length;

    // The same fills are delivered again, and this time the source proves
    // where the invented opening fill came from. The fills are duplicates, so
    // nothing is inserted, but the quality changed — so the projection is
    // corrected with it, exactly once.
    insertFills(account, fills, syntheticQuality);
    await drain();

    const corrected = observations().filter((row) => row.accountId === account);
    expect(corrected).toHaveLength(2);
    expect(corrected.filter((row) => row.status === "active")).toHaveLength(1);
    const active = corrected.find((row) => row.status === "active")!;
    expect(active.timingQuality).toBe("reconstructed");
    expect(active.durationMs).toBeNull();
    expect(corrected.find((row) => row.status === "superseded")!.timingQuality).toBe("unknown");
    expect(
      db
        .select()
        .from(tradeProjectionRevisions)
        .where(eq(tradeProjectionRevisions.accountId, account))
        .all().length,
    ).toBe(revisionsAfterFirst + 1);
    expect(events().filter((row) => JSON.parse(row.payloadJson).accountId === account).length).toBe(
      eventsAfterFirst + 1,
    );

    // A third, identical delivery learns nothing new, so it records nothing
    // new.
    insertFills(account, fills, syntheticQuality);
    await drain();
    expect(observations().filter((row) => row.accountId === account)).toHaveLength(2);
    expect(
      db
        .select()
        .from(tradeProjectionRevisions)
        .where(eq(tradeProjectionRevisions.accountId, account))
        .all().length,
    ).toBe(revisionsAfterFirst + 1);
  });
});

describe("explicit durable replay", () => {
  it("coalesces pending and running work and preserves completed business effects", async () => {
    const account = createAccount("acct-explicit-replay");
    insertFills(account, [entry, exit]);
    const event = eventFor(account, 0);
    const id = requestReplay(event.id);
    expect(requestReplay(event.id)).toBe(id);
    dispatcher.dispatchOutbox(100, NOW);
    const claim = jobs.claim(OWNER, NOW)!;
    expect(claim.jobId).toBe(id);
    expect(requestReplay(event.id)).toBe(id);
    expect(jobs.load(id)!.fence).toBe(claim.fence);
    expect(jobs.fail(claim, "TRANSIENT", NOW, true)).toBe(true);
    expect(requestReplay(event.id)).toBe(id);
    expect(jobs.load(id)!.status).toBe("retry_wait");
    expect(jobs.load(id)!.attempts).toBe(1);
    const retryClaim = jobs.claim(OWNER, NOW + 1_000)!;
    expect(jobs.fail(retryClaim, "TERMINAL", NOW + 1_000, false)).toBe(true);
    expect(requestReplay(event.id)).toBe(id);
    expect(jobs.load(id)).toMatchObject({
      status: "pending",
      attempts: 0,
      owner: null,
      leaseUntil: null,
      lastError: null,
    });
    expect(jobs.load(id)!.fence).toBeGreaterThan(retryClaim.fence);
    expect(() => withJournalTransaction((tx) => effects.assertClaim(tx, retryClaim, NOW))).toThrow(
      "Stale claim",
    );
    expect(() => withJournalTransaction((tx) => effects.complete(tx, retryClaim, NOW))).toThrow(
      "Stale claim",
    );
    await drain();
    const first = observations()[0]!;
    expect(observations()).toHaveLength(1);
    expect(requestReplay(event.id)).toBe(id);
    expect(requestReplay(event.id)).toBe(id);
    await drain();
    expect(observations()).toEqual([first]);
    expect(links()).toHaveLength(1);
    expect(db.select().from(eventDeliveries).all()).toHaveLength(1);
    expect(db.select().from(intelligenceJobs).all()).toHaveLength(1);
    expect(jobs.load(id)!.status).toBe("completed");
    expect(db.select().from(trades).all()).toHaveLength(1);
    expect(db.select().from(executions).all()).toHaveLength(2);
  });

  it.each(["correction", "removal"] as const)(
    "discards stale replay when %s commits before processing",
    async (change) => {
      const account = createAccount(`acct-stale-${change}`);
      insertFills(account, [entry, exit]);
      await drain();
      const first = observations()[0]!;
      requestReplay(eventFor(account, 0).id);
      if (change === "correction") correctExit(account, 105);
      else removeFills(account);
      await drain();
      expect(observations().find((row) => row.id === first.id)!.status).toBe(
        change === "correction" ? "superseded" : "invalidated",
      );
      expect(observations()).toHaveLength(change === "correction" ? 2 : 1);
      expect(links()).toHaveLength(change === "correction" ? 2 : 1);
      requestReplay(eventFor(account, 0).id);
      await drain();
      expect(observations().find((row) => row.id === first.id)!.status).toBe(
        change === "correction" ? "superseded" : "invalidated",
      );
    },
  );

  it("rejects unregistered versions, missing events and cancelled work", () => {
    const account = createAccount("acct-replay-validation");
    insertFills(account, [entry, exit]);
    const event = eventFor(account, 0);
    const handler = observationOutboxHandlers[0]!;
    expect(() => replay.requestReplay("", handler.id, handler.version)).toThrow();
    expect(() => replay.requestReplay("missing", handler.id, handler.version)).toThrow(
      "does not exist",
    );
    expect(() => replay.requestReplay(event.id, handler.id, "unregistered")).toThrow(
      "not registered",
    );
    const id = requestReplay(event.id);
    jobs.cancel(id);
    expect(() => requestReplay(event.id)).toThrow("Cancelled work");
    expect(jobs.load(id)!.status).toBe("cancelled");
  });

  it("permits explicitly registered new versions and rejects deleted accounts", () => {
    const account = createAccount("acct-replay-version");
    insertFills(account, [entry, exit]);
    const event = eventFor(account, 0);
    const handler = observationOutboxHandlers[0]!;
    const versioned = createReplayService({
      db,
      jobs,
      handlers: [...observationOutboxHandlers, { id: handler.id, version: "2" }],
      clock: () => NOW,
    });
    const original = requestReplay(event.id);
    const upgraded = versioned.requestReplay(event.id, handler.id, "2");
    expect(upgraded).not.toBe(original);
    expect(versioned.requestReplay(event.id, handler.id, "2")).toBe(upgraded);
    expect(db.select().from(eventDeliveries).all()).toHaveLength(2);
    db.delete(accounts).where(eq(accounts.id, account)).run();
    expect(() => requestReplay(event.id)).toThrow("account does not exist");
  });

  it.each(["queued", "replayed"] as const)(
    "suppression fences %s old events and rejects further replay",
    async (state) => {
      const account = createAccount(`acct-suppressed-${state}`);
      insertFills(account, [entry, exit]);
      const event = eventFor(account, 0);
      if (state === "replayed") {
        await drain();
        requestReplay(event.id);
      } else {
        dispatcher.dispatchOutbox(100, NOW);
      }
      withJournalTransaction((tx) => {
        tx.delete(intelligenceObservations)
          .where(eq(intelligenceObservations.accountId, account))
          .run();
        tx.insert(intelligenceSeedCheckpoints)
          .values({
            accountId: account,
            status: "suppressed",
            lastTradeKey: null,
            baselineOperationId: "explicit-reset",
            updatedAt: NOW,
          })
          .run();
      });
      const financial = db.select().from(trades).all();
      expect(() => requestReplay(event.id)).toThrow("suppressed");
      await drain();
      expect(observations()).toHaveLength(0);
      expect(links()).toHaveLength(0);
      expect(db.select().from(trades).all()).toEqual(financial);
      expect(db.select().from(executions).all()).toHaveLength(2);
    },
  );
});
