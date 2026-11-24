import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import type * as Settings from "../src/server/settings";

vi.mock("../src/server/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof Settings>()),
  resolveAiConfiguration: () => {
    throw new Error("Historical seed must not access a provider.");
  },
}));

const scratch = mkdtempSync(join(tmpdir(), "journal-seed-"));
process.env.JOURNAL_DATA_DIR = scratch;
// The DB opens at module evaluation; static imports would run before the scratch path is set.
const {
  db,
  withJournalTransaction,
  accounts,
  trades,
  executions,
  executionEvidence,
  tradeIdentities,
  tradeIdentityLinks,
  tradeProjectionRevisions,
  tradeRevisionExecutions,
  domainOutbox,
  eventDeliveries,
  intelligenceJobs,
  intelligenceWorkerLease,
  intelligenceObservations,
  observationEvidence,
  intelligenceSeedCheckpoints,
} = await import("../src/db");
const { insertExecutionsInTx } = await import("../src/server/executions");
const { changeContext } = await import("../src/server/trading/reconcile");
const { createBackfillService } =
  await import("../src/server/intelligence/infrastructure/backfill");
const { createIntelligenceServices } = await import("../src/server/intelligence/composition");
const { createJobStore, createEffectStore } =
  await import("../src/server/intelligence/infrastructure/jobs");
const { createOutboxDispatcher } = await import("../src/server/intelligence/infrastructure/outbox");
const { createWorkerService } = await import("../src/server/intelligence/infrastructure/worker");
const NOW = 1_800_000_000_000;
const jobs = createJobStore(db);
const seed = (batchSize = 100) => createBackfillService({ db, jobs, clock: () => NOW, batchSize });
const events = () => db.select().from(domainOutbox).all();
const revisions = () => db.select().from(tradeProjectionRevisions).all();
const checkpoint = () => db.select().from(intelligenceSeedCheckpoints).get();
const createAccount = (id = "seed-account") => {
  db.insert(accounts).values({ id, name: id, kind: "manual", createdAt: "2026-01-01" }).run();
  return id;
};
const fills = (symbol: string, closed = true): ImportedExecution[] => [
  { symbol, side: "buy", quantity: 10, price: 100, fee: 0, executedAt: "2026-01-01T10:00:00.000Z" },
  ...(closed
    ? [
        {
          symbol,
          side: "sell" as const,
          quantity: 10,
          price: 102,
          fee: 0,
          executedAt: "2026-01-01T11:00:00.000Z",
        },
      ]
    : []),
];
const insert = (accountId: string, rows: ImportedExecution[]) =>
  withJournalTransaction((tx) => {
    insertExecutionsInTx(tx, accountId, rows, "import", changeContext("import", "historical"));
  });
/** An old journal has financial projections but no identity evidence layer. */
const forgetMappings = () => {
  db.delete(tradeRevisionExecutions).run();
  db.delete(tradeProjectionRevisions).run();
  db.delete(tradeIdentityLinks).run();
  db.delete(tradeIdentities).run();
};
const drain = async (seedBatchSize = 1) => {
  const services = createIntelligenceServices({ db, clock: () => NOW, seedBatchSize });
  const worker = createWorkerService({
    db,
    jobs,
    effects: createEffectStore(),
    dispatcher: createOutboxDispatcher({ db, jobs, handlers: services.outboxHandlers }),
    handlers: services.handlers,
    clock: () => NOW,
    owner: "seed-worker",
  });
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!(await worker.tick(NOW))) return;
  }
  throw new Error("Seed worker did not settle.");
};

beforeEach(() => {
  process.env.JOURNAL_EVENT_CAPTURE = "0";
  db.delete(observationEvidence).run();
  db.delete(intelligenceObservations).run();
  db.delete(executionEvidence).run();
  forgetMappings();
  db.delete(eventDeliveries).run();
  db.delete(domainOutbox).run();
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

describe("historical current-state seed", () => {
  it("discovers closed and open historical trades without financial or annotation writes", async () => {
    const accountId = createAccount();
    insert(accountId, [...fills("CLOSED"), ...fills("OPEN", false)]);
    forgetMappings();
    db.update(trades).set({ notes: "keep notes", tagsJson: '["keep"]', stopLoss: 95 }).run();
    const before = db.select().from(trades).all();
    const services = createIntelligenceServices({ db, clock: () => NOW, seedBatchSize: 1 });
    expect(services.seedAccount(accountId, "baseline").discovered).toBe(1);
    await drain();
    expect(events()).toHaveLength(2);
    for (const event of events()) {
      expect(JSON.parse(event.payloadJson)).toMatchObject({
        kind: "discovered",
        mode: "historical",
      });
      expect(event.correlationId).toBe("baseline");
      expect(event.occurredAt).toBeNull();
    }
    expect(db.select().from(trades).all()).toEqual(before);
    expect(db.select().from(intelligenceObservations).all()).toHaveLength(2);
    expect(db.select().from(observationEvidence).all()).toHaveLength(2);
    expect(checkpoint()?.status).toBe("completed");
    expect(services.seedAccount(accountId, "again").discovered).toBe(0);
  });

  it("publishes capture-off current mapped revision without creating a revision", async () => {
    const accountId = createAccount();
    insert(accountId, fills("MAPPED"));
    const before = revisions();
    expect(events()).toHaveLength(0);
    expect(seed().seedAccount(accountId, "mapped").discovered).toBe(1);
    expect(revisions()).toEqual(before);
    expect(JSON.parse(events()[0]!.payloadJson).projectionRevisionId).toBe(before[0]!.id);
    await drain();
    expect(db.select().from(intelligenceObservations).get()?.timingQuality).toBe("source_reported");
    expect(db.select().from(intelligenceObservations).get()?.durationMs).toBe(3_600_000);
  });

  it("retains reconstructed timing provenance without asserting source-reported duration", async () => {
    const accountId = createAccount();
    withJournalTransaction((tx) => {
      insertExecutionsInTx(
        tx,
        accountId,
        fills("RECONSTRUCTED"),
        "import",
        changeContext("import", "historical"),
        undefined,
        {
          quality: () => ({ timingQuality: "reconstructed", sourceKind: "ctrader_synthetic_open" }),
        },
      );
    });
    forgetMappings();
    seed().seedAccount(accountId, "quality-baseline");
    await drain();
    const observation = db.select().from(intelligenceObservations).get();
    expect(observation?.timingQuality).toBe("reconstructed");
    expect(observation?.durationMs).toBeNull();
    expect(JSON.parse(revisions()[0]!.snapshotJson).timingQuality).toBe("reconstructed");
  });

  it("keeps real mutation event and current revision unchanged when mutation arrives before seed", () => {
    const accountId = createAccount();
    insert(accountId, fills("MUTATED", false));
    process.env.JOURNAL_EVENT_CAPTURE = "1";
    insert(accountId, [fills("MUTATED")[1]!]);
    const beforeEvents = events();
    const beforeRevisions = revisions();
    expect(seed().seedAccount(accountId, "late-baseline")).toMatchObject({
      discovered: 0,
      unchanged: 1,
    });
    expect(events()).toEqual(beforeEvents);
    expect(revisions()).toEqual(beforeRevisions);
    expect(JSON.parse(beforeEvents[0]!.payloadJson).kind).toBe("closed");
  });

  it("rejects replay addressed to a worker-only seed handler", () => {
    const accountId = createAccount();
    process.env.JOURNAL_EVENT_CAPTURE = "1";
    insert(accountId, fills("REPLAY"));
    const services = createIntelligenceServices({ db, clock: () => NOW });
    expect(() => services.requestReplay(events()[0]!.id, "seed-account", "1")).toThrow(
      "not registered",
    );
    expect(db.select().from(intelligenceJobs).all()).toEqual([]);
    expect(db.select().from(eventDeliveries).all()).toEqual([]);
  });

  it.each(["source_reported", "reconstructed", "unknown"] as const)(
    "keeps %s source quality identical between reconciliation and baseline",
    (timingQuality) => {
      const accountId = createAccount();
      withJournalTransaction((tx) => {
        insertExecutionsInTx(
          tx,
          accountId,
          fills("QUALITY"),
          "import",
          changeContext("import", "historical"),
          undefined,
          { quality: () => ({ timingQuality, sourceKind: "quality-fixture" }) },
        );
      });
      const before = revisions()[0]!;
      forgetMappings();
      seed().seedAccount(accountId, "equivalent-baseline");
      const after = revisions()[0]!;
      expect(after.fingerprint).toBe(before.fingerprint);
      expect(after.snapshotJson).toBe(before.snapshotJson);
    },
  );

  it("resumes bounded cursor with original operation and drains durable continuation jobs", async () => {
    const accountId = createAccount();
    insert(accountId, [...fills("A"), ...fills("B"), ...fills("C")]);
    forgetMappings();
    expect(seed(1).seedAccount(accountId, "original").discovered).toBe(1);
    const firstCursor = checkpoint()!.lastTradeKey;
    expect(checkpoint()).toMatchObject({ status: "running", baselineOperationId: "original" });
    expect(db.select().from(intelligenceJobs).all()).toHaveLength(1);
    expect(seed(1).seedAccount(accountId, "replacement").discovered).toBe(1);
    expect(checkpoint()!.lastTradeKey! > firstCursor!).toBe(true);
    await drain();
    expect(events()).toHaveLength(3);
    expect(new Set(events().map((event) => event.correlationId))).toEqual(new Set(["original"]));
    expect(revisions()).toHaveLength(3);
    expect(checkpoint()?.status).toBe("completed");
    expect(db.select().from(intelligenceObservations).all()).toHaveLength(3);
  });

  it("rolls back revisions, events and cursor when continuation enqueue fails", () => {
    const accountId = createAccount();
    insert(accountId, [...fills("A"), ...fills("B")]);
    forgetMappings();
    db.$client.exec(`CREATE TRIGGER fail_seed_continuation BEFORE INSERT ON intelligence_jobs
      BEGIN SELECT RAISE(ABORT, 'seed continuation rollback'); END;`);
    try {
      expect(() => seed(1).seedAccount(accountId, "rollback")).toThrow(
        "seed continuation rollback",
      );
      expect(events()).toHaveLength(0);
      expect(revisions()).toHaveLength(0);
      expect(db.select().from(tradeIdentities).all()).toHaveLength(0);
      expect(checkpoint()).toBeUndefined();
    } finally {
      db.$client.exec("DROP TRIGGER fail_seed_continuation");
    }
    expect(seed(1).seedAccount(accountId, "retry").discovered).toBe(1);
  });

  it("honors explicit suppression but resumes incomplete seed", () => {
    const accountId = createAccount();
    insert(accountId, [...fills("A"), ...fills("B")]);
    seed(1).seedAccount(accountId, "incomplete");
    expect(checkpoint()?.status).toBe("running");
    const before = events();
    db.update(intelligenceSeedCheckpoints).set({ status: "suppressed" }).run();
    expect(seed().seedAccount(accountId, "must-not-rebuild").discovered).toBe(0);
    expect(events()).toEqual(before);
    expect(checkpoint()?.baselineOperationId).toBe("incomplete");
  });

  it("emits nothing for missing or deleted accounts, including leftover financial rows", async () => {
    expect(seed().seedAccount("missing", "missing-operation").discovered).toBe(0);
    expect(checkpoint()).toBeUndefined();
    const accountId = createAccount();
    insert(accountId, [...fills("A"), ...fills("B")]);
    seed(1).seedAccount(accountId, "deleted-operation");
    const before = events();
    db.delete(accounts).where(eq(accounts.id, accountId)).run();
    expect(seed().seedAccount(accountId, "after-delete").discovered).toBe(0);
    await drain();
    expect(events().map(({ id, payloadJson }) => ({ id, payloadJson }))).toEqual(
      before.map(({ id, payloadJson }) => ({ id, payloadJson })),
    );
    expect(db.select().from(intelligenceObservations).all()).toHaveLength(0);
    expect(checkpoint()).toBeUndefined();
  });
});
