import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";

/**
 * The mutation commands (Phase 07).
 *
 * Every mutation of the journal happens in one transaction: the fills, the
 * rebuilt projections, the projection revisions, the durable domain events, the
 * annotations, the settings and the account bookkeeping commit together or
 * not at all. A transfer keeps a trade's identity only where a unique full
 * execution-membership match proves it.
 *
 * Every case runs against a disposable journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-mutation-commands-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const {
  db,
  accounts,
  executions,
  trades,
  settings,
  tradeIdentities,
  tradeProjectionRevisions,
  tradeRevisionExecutions,
  domainOutbox,
  eventDeliveries,
  intelligenceJobs,
  executionEvidence,
  withJournalTransaction,
} = await import("../src/db");
const {
  recordManualTrades,
  deleteTrades,
  clearAccount,
  deleteAccount,
  transferAccount,
  updateSettings,
  updateAccount,
  setAccountArchived,
} = await import("../src/server/trading/commands");
const { changeContext } = await import("../src/server/trading/reconcile");
const { createEffectStore } = await import("../src/server/intelligence/infrastructure/jobs");

const ACCOUNT = "acct-one";
const OTHER = "acct-two";
const DESTINATION = "acct-destination";

const buy = (executedAt: string, price = 100, quantity = 10): ImportedExecution => ({
  symbol: "TEST",
  side: "buy",
  quantity,
  price,
  fee: 0,
  executedAt,
});
const sell = (executedAt: string, price = 102, quantity = 10): ImportedExecution => ({
  symbol: "TEST",
  side: "sell",
  quantity,
  price,
  fee: 0,
  executedAt,
});

const live = () => changeContext("user", "live");
const maintenance = () => changeContext("user", "maintenance");

const tradeRows = () => db.select().from(trades).all();
const tradeKeys = () => tradeRows().map((row) => row.key);
const identityRows = () => db.select().from(tradeIdentities).all();
const eventRows = () =>
  db
    .select()
    .from(domainOutbox)
    .all()
    .map(
      (row) =>
        JSON.parse(row.payloadJson) as {
          kind: string;
          mode: string;
          tradeKey: string;
          accountId: string;
        },
    );
const eventKinds = () => eventRows().map((row) => row.kind);
const settingRows = () => db.select().from(settings).all();

const seedAccount = (id: string, extra: Record<string, unknown> = {}) => {
  db.insert(accounts)
    .values({
      id,
      name: id,
      kind: "manual",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    })
    .run();
};

beforeEach(() => {
  db.delete(eventDeliveries).run();
  db.delete(domainOutbox).run();
  db.delete(intelligenceJobs).run();
  db.delete(executionEvidence).run();
  db.delete(tradeRevisionExecutions).run();
  db.delete(tradeProjectionRevisions).run();
  db.delete(tradeIdentities).run();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  seedAccount(ACCOUNT);
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("deleting one trade", () => {
  it("takes its fills, its projection and its identity, and records the removal", () => {
    recordManualTrades(ACCOUNT, [
      buy("2026-09-01T10:00:00Z"),
      sell("2026-09-01T11:00:00Z"),
      buy("2026-09-02T10:00:00Z"),
      sell("2026-09-02T11:00:00Z"),
    ]);
    const target = tradeRows().find((row) => row.key.includes("2026-09-01"))!;
    const survivor = tradeRows().find((row) => row.key.includes("2026-09-02"))!;
    const identity = identityRows().find((row) => row.currentKey === target.key)!;

    deleteTrades([target.key], live());

    expect(db.select().from(executions).all()).toHaveLength(2);
    expect(tradeKeys()).toEqual([survivor.key]);
    expect(identityRows().find((row) => row.id === identity.id)?.state).toBe("tombstoned");
    expect(eventKinds()).toContain("removed");
    expect(eventRows().find((row) => row.kind === "removed")?.tradeKey).toBe(target.key);
    // The other trade of the account survives untouched.
    expect(identityRows().find((row) => row.currentKey === survivor.key)?.state).toBe("active");
  });

  it("ignores a key that names no trade", () => {
    recordManualTrades(ACCOUNT, [buy("2026-09-01T10:00:00Z"), sell("2026-09-01T11:00:00Z")]);
    const before = { trades: tradeKeys(), events: eventRows().length };

    deleteTrades(["no-such-trade"], live());

    expect(tradeKeys()).toEqual(before.trades);
    expect(eventRows()).toHaveLength(before.events);
  });

  it("deletes the shared fill of a crossing-flat pair and rebuilds the sibling", () => {
    // The sell crosses through flat: it closes the long and opens a short.
    recordManualTrades(ACCOUNT, [
      buy("2026-09-01T10:00:00Z"),
      sell("2026-09-01T11:00:00Z", 102, 20),
    ]);
    const long = tradeRows().find((row) => row.direction === "long")!;
    const short = tradeRows().find((row) => row.direction === "short")!;
    // The crossing fill belongs to both cycles.
    const longIds = JSON.parse(long.executionIdsJson) as string[];
    const shortIds = JSON.parse(short.executionIdsJson) as string[];
    expect(longIds.filter((id) => shortIds.includes(id))).toHaveLength(1);

    deleteTrades([short.key], live());

    // The shared fill is gone, and the sibling is rebuilt from what is left.
    expect(db.select().from(executions).all()).toHaveLength(1);
    expect(tradeKeys()).toEqual([long.key]);
    expect(tradeRows()[0]?.status).toBe("open");
    // The removal and the revision commit together.
    expect(eventKinds()).toContain("removed");
    expect(eventKinds()).toContain("revised");
  });
});

describe("deleting many trades", () => {
  it("rebuilds every affected account once, in one transaction", () => {
    seedAccount(OTHER);
    recordManualTrades(ACCOUNT, [
      buy("2026-09-01T10:00:00Z"),
      sell("2026-09-01T11:00:00Z"),
      buy("2026-09-02T10:00:00Z"),
      sell("2026-09-02T11:00:00Z"),
    ]);
    recordManualTrades(OTHER, [buy("2026-09-03T10:00:00Z"), sell("2026-09-03T11:00:00Z")]);
    const first = tradeRows().find((row) => row.key.includes("2026-09-01"))!;
    const second = tradeRows().find((row) => row.key.includes("2026-09-03"))!;

    deleteTrades([first.key, second.key], live());

    expect(db.select().from(executions).all()).toHaveLength(2);
    expect(tradeKeys()).toHaveLength(1);
    // One removal per account, and nothing for the trade that survived.
    expect(eventKinds().filter((kind) => kind === "removed")).toHaveLength(2);
    expect(eventRows().every((row) => row.mode === "live")).toBe(true);
  });
});

describe("emptying an account", () => {
  it("takes its fills and its projections, tombstones its identities and survives", () => {
    db.update(accounts)
      .set({ ibkrSyncTimeZone: "America/New_York" })
      .where(eq(accounts.id, ACCOUNT))
      .run();
    recordManualTrades(ACCOUNT, [
      buy("2026-09-01T10:00:00Z"),
      sell("2026-09-01T11:00:00Z"),
      buy("2026-09-02T10:00:00Z"),
      sell("2026-09-02T11:00:00Z"),
    ]);
    const identities = identityRows();

    clearAccount(ACCOUNT, live());

    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(tradeRows()).toHaveLength(0);
    expect(identityRows().every((row) => row.state === "tombstoned")).toBe(true);
    expect(identities).toHaveLength(2);
    expect(eventKinds().filter((kind) => kind === "removed")).toHaveLength(2);
    expect(db.select().from(accounts).all()).toHaveLength(1);
    expect(db.select().from(accounts).all()[0]?.ibkrSyncTimeZone).toBeNull();
  });

  it("refuses to empty an account that does not exist", () => {
    expect(() => clearAccount("no-such-account", live())).toThrow("Account not found.");
  });
});

describe("deleting an account", () => {
  it("takes the trades, the fills, the identities, the evidence and the intelligence", () => {
    recordManualTrades(ACCOUNT, [buy("2026-09-01T10:00:00Z"), sell("2026-09-01T11:00:00Z")]);
    const fills = db.select().from(executions).all();
    const event = db.select().from(domainOutbox).all()[0]!;
    for (const fill of fills) {
      db.insert(executionEvidence)
        .values({
          executionId: fill.id,
          timingQuality: "source_reported",
          sourceKind: "manual",
          recordedAt: 1,
        })
        .run();
    }
    db.insert(intelligenceJobs)
      .values({
        id: "job-leased",
        idempotencyKey: "job-leased",
        type: "evaluate_trade",
        payloadJson: "{}",
        status: "running",
        attempts: 1,
        availableAt: 1,
        owner: "worker-1",
        fence: 3,
        leaseUntil: Date.now() + 60_000,
        cancelRequested: false,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    db.insert(eventDeliveries)
      .values({
        eventId: event.id,
        handlerId: "evaluate_trade",
        handlerVersion: "1",
        state: "pending",
        jobId: "job-leased",
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    db.insert(settings).values({ key: "currentAccountId", value: ACCOUNT }).run();

    deleteAccount(ACCOUNT, live());

    expect(tradeRows()).toHaveLength(0);
    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(identityRows()).toHaveLength(0);
    expect(db.select().from(tradeProjectionRevisions).all()).toHaveLength(0);
    expect(db.select().from(tradeRevisionExecutions).all()).toHaveLength(0);
    expect(db.select().from(executionEvidence).all()).toHaveLength(0);
    expect(db.select().from(domainOutbox).all()).toHaveLength(0);
    expect(db.select().from(eventDeliveries).all()).toHaveLength(0);
    expect(db.select().from(intelligenceJobs).all()).toHaveLength(0);
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(db.select().from(settings).all()).toHaveLength(0);

    // A worker that still holds the leased job is fenced: its completion
    // finds no job row.
    expect(() =>
      withJournalTransaction((tx) =>
        createEffectStore().complete(
          tx,
          { jobId: "job-leased", owner: "worker-1", fence: 3, leaseUntil: Date.now() + 60_000 },
          Date.now(),
        ),
      ),
    ).toThrow(/Stale claim/);
  });

  it("does nothing for an account that does not exist", () => {
    deleteAccount("no-such-account", live());
    expect(db.select().from(accounts).all()).toHaveLength(1);
  });
});

describe("moving an account's history into another account", () => {
  const seedSource = () => {
    recordManualTrades(ACCOUNT, [buy("2026-09-01T10:00:00Z"), sell("2026-09-01T11:00:00Z")]);
    const trade = tradeRows()[0]!;
    db.update(trades)
      .set({
        notes: "Held for the breakout.",
        tagsJson: JSON.stringify(["setup"]),
        mistakesJson: JSON.stringify(["late entry"]),
        rating: 4,
        stopLoss: 95,
        profitTarget: 110,
        reviewedAt: "2026-09-05T00:00:00.000Z",
      })
      .where(eq(trades.key, trade.key))
      .run();
    seedAccount(DESTINATION);
    return trade;
  };

  it("moves the fills and continues the identity the membership proves", () => {
    const source = seedSource();
    const identity = identityRows()[0]!;

    transferAccount(ACCOUNT, DESTINATION, live());

    expect(
      db
        .select()
        .from(executions)
        .all()
        .map((row) => row.accountId),
    ).toEqual([DESTINATION, DESTINATION]);
    expect(tradeRows()).toHaveLength(1);
    const moved = tradeRows()[0]!;
    expect(moved.accountId).toBe(DESTINATION);
    expect(moved.key).toBe(`${DESTINATION}|TEST|long|2026-09-01T10:00:00Z`);
    // The identity moved with the trade and was not retired.
    const movedIdentity = identityRows()[0]!;
    expect(movedIdentity.id).toBe(identity.id);
    expect(movedIdentity.accountId).toBe(DESTINATION);
    expect(movedIdentity.state).toBe("active");
    expect(movedIdentity.currentKey).toBe(moved.key);
    // The revision records the proven transfer.
    const revision = db
      .select()
      .from(tradeProjectionRevisions)
      .all()
      .filter((row) => row.tradeId === identity.id)
      .at(-1)!;
    expect(revision.resolution).toBe("explicit_transfer");
    expect(revision.accountId).toBe(DESTINATION);
    // The annotations followed the trade.
    expect(moved.notes).toBe("Held for the breakout.");
    expect(moved.tagsJson).toBe(JSON.stringify(["setup"]));
    expect(moved.mistakesJson).toBe(JSON.stringify(["late entry"]));
    expect(moved.rating).toBe(4);
    expect(moved.stopLoss).toBe(95);
    expect(moved.profitTarget).toBe(110);
    expect(moved.reviewedAt).toBe("2026-09-05T00:00:00.000Z");
    // The source has no projections left.
    expect(tradeRows().filter((row) => row.accountId === ACCOUNT)).toHaveLength(0);
  });

  it("rejects an ambiguous move and writes nothing", () => {
    const source = seedSource();
    // The destination already holds a fill of the same symbol: the moved
    // cycle merges with it and can no longer be matched.
    recordManualTrades(DESTINATION, [buy("2026-09-01T09:00:00Z", 99)]);
    const before = {
      executions: db.select().from(executions).all().length,
      trades: tradeKeys(),
      identities: identityRows().length,
      events: eventRows().length,
    };

    expect(() => transferAccount(ACCOUNT, DESTINATION, live())).toThrow(
      "The moved history merges with fills the destination account already holds.",
    );

    expect(db.select().from(executions).all()).toHaveLength(before.executions);
    expect(tradeKeys()).toEqual(before.trades);
    expect(identityRows()).toHaveLength(before.identities);
    expect(eventRows()).toHaveLength(before.events);
    expect(tradeRows().find((row) => row.key === source.key)?.notes).toBe("Held for the breakout.");
    expect(identityRows()[0]?.accountId).toBe(ACCOUNT);
    expect(identityRows()[0]?.state).toBe("active");
  });

  it("refuses a move whose fill the destination already holds", () => {
    seedSource();
    // The very same fill: it is unique per account, so it cannot move.
    recordManualTrades(DESTINATION, [buy("2026-09-01T10:00:00Z")]);
    const before = {
      executions: db.select().from(executions).all().length,
      trades: tradeKeys(),
      identities: identityRows().length,
      events: eventRows().length,
    };

    expect(() => transferAccount(ACCOUNT, DESTINATION, live())).toThrow(
      "The moved history contains a fill the destination account already holds.",
    );

    expect(db.select().from(executions).all()).toHaveLength(before.executions);
    expect(tradeKeys()).toEqual(before.trades);
    expect(identityRows()).toHaveLength(before.identities);
    expect(eventRows()).toHaveLength(before.events);
  });

  it("keeps the identity of each cycle of a crossing-flat pair", () => {
    recordManualTrades(ACCOUNT, [
      buy("2026-09-01T10:00:00Z"),
      sell("2026-09-01T11:00:00Z", 102, 20),
      buy("2026-09-01T12:00:00Z", 104, 10),
    ]);
    const identities = identityRows();
    expect(identities).toHaveLength(2);
    seedAccount(DESTINATION);

    transferAccount(ACCOUNT, DESTINATION, live());

    const moved = identityRows();
    expect(moved).toHaveLength(2);
    expect(moved.every((row) => row.accountId === DESTINATION)).toBe(true);
    expect(moved.every((row) => row.state === "active")).toBe(true);
    expect(new Set(moved.map((row) => row.currentKey)).size).toBe(2);
    const resolutions = db
      .select()
      .from(tradeProjectionRevisions)
      .all()
      .map((row) => row.resolution);
    expect(resolutions.filter((resolution) => resolution === "explicit_transfer")).toHaveLength(2);
  });

  it("refuses to move an account into itself", () => {
    expect(() => transferAccount(ACCOUNT, ACCOUNT, live())).toThrow(
      "Choose a different destination account.",
    );
  });
});

describe("changing a multiplier", () => {
  it("stores the setting and rebuilds every account in the same transaction", () => {
    recordManualTrades(ACCOUNT, [
      { ...buy("2026-09-01T10:00:00Z", 100), symbol: "ES", quantity: 1 },
      { ...sell("2026-09-01T11:00:00Z", 110), symbol: "ES", quantity: 1 },
    ]);
    const trade = tradeRows()[0]!;
    db.update(trades)
      .set({ notes: "Held for the breakout." })
      .where(eq(trades.key, trade.key))
      .run();
    expect(trade.netPnl).toBe(10);

    updateSettings({ multipliers: { ES: 50 } });

    const setting = settingRows().find((row) => row.key === "multipliers");
    expect(setting?.value).toBe(JSON.stringify({ ES: 50 }));
    const rebuilt = tradeRows()[0]!;
    expect(rebuilt.netPnl).toBe(500);
    expect(rebuilt.notes).toBe("Held for the breakout.");
    expect(eventKinds()).toContain("revised");
  });

  it("stores nothing when the rebuild fails", () => {
    recordManualTrades(ACCOUNT, [
      { ...buy("2026-09-01T10:00:00Z", 100), symbol: "ES", quantity: 1 },
      { ...sell("2026-09-01T11:00:00Z", 110), symbol: "ES", quantity: 1 },
    ]);
    const before = tradeRows()[0]!.netPnl;
    db.$client.exec(
      "CREATE TRIGGER fail_projection BEFORE INSERT ON trades BEGIN SELECT RAISE(FAIL, 'test rebuild failure'); END",
    );
    try {
      expect(() => updateSettings({ multipliers: { ES: 50 } })).toThrow();
    } finally {
      db.$client.exec("DROP TRIGGER fail_projection");
    }

    expect(settingRows().filter((row) => row.key === "multipliers")).toHaveLength(0);
    expect(tradeRows()[0]?.netPnl).toBe(before);
  });
});

describe("changing the profit method of an account", () => {
  it("recomputes the projections and keeps the annotations", () => {
    recordManualTrades(ACCOUNT, [
      buy("2026-09-01T10:00:00Z", 100),
      buy("2026-09-01T10:30:00Z", 110),
      sell("2026-09-01T11:00:00Z", 120, 15),
    ]);
    const trade = tradeRows()[0]!;
    db.update(trades)
      .set({ notes: "Held for the breakout." })
      .where(eq(trades.key, trade.key))
      .run();
    const fifo = trade.netPnl;

    updateAccount(ACCOUNT, { profitCalcMethod: "lifo" });

    const recomputed = tradeRows()[0]!;
    expect(recomputed.netPnl).not.toBe(fifo);
    expect(recomputed.notes).toBe("Held for the breakout.");
    expect(eventKinds()).toContain("revised");
    expect(db.select().from(accounts).all()[0]?.profitCalcMethod).toBe("lifo");
  });

  it("keeps the refusal of an IBKR account with synced history", () => {
    seedAccount("acct-ibkr", { kind: "sync", broker: "ibkr-flex" });
    db.insert(executions)
      .values({
        id: "sync-fill",
        accountId: "acct-ibkr",
        symbol: "TEST",
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 0,
        executedAt: "2026-09-01T10:00:00Z",
        source: "sync",
        contentHash: "sync-fill-hash",
        createdAt: "2026-01-01T00:00:00.000Z",
      })
      .run();

    expect(() => updateAccount("acct-ibkr", { broker: "ibkr" })).toThrow(
      "An IBKR account with synced history cannot change brokers. Connect a separate account to preserve its timestamp history.",
    );
  });
});

describe("archiving an account", () => {
  it("clears the persisted default that pointed at the archived account", () => {
    db.insert(settings).values({ key: "currentAccountId", value: ACCOUNT }).run();

    setAccountArchived(ACCOUNT, true);

    expect(db.select().from(accounts).all()[0]?.archivedAt).not.toBeNull();
    expect(db.select().from(settings).all()).toHaveLength(0);
  });

  it("keeps the persisted default of an account that is unarchived", () => {
    db.insert(settings).values({ key: "currentAccountId", value: ACCOUNT }).run();
    seedAccount(OTHER);

    setAccountArchived(OTHER, true);

    expect(db.select().from(settings).all()[0]?.value).toBe(ACCOUNT);
  });
});
