import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";

/**
 * Trade reconciliation (Phase 05).
 *
 * A manual or generic-import change leaves its fills, its reconstructed trade
 * projections, its immutable projection evidence and its durable domain event
 * in one transaction. A projection that did not change writes no revision and
 * raises no event, and an identical retry is silent.
 *
 * Every case runs against a disposable journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-reconcile-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const {
  db,
  accounts,
  executions,
  trades,
  tradeIdentities,
  tradeProjectionRevisions,
  domainOutbox,
  withJournalTransaction,
  settings,
} = await import("../src/db");
const { rebuildAccount } = await import("../src/server/rebuild");
const { recordManualTrades, importGenericExecutions, updateSettings } =
  await import("../src/server/trading/commands");
const { changeContext, reconcileAccountInTx } = await import("../src/server/trading/reconcile");

const ACCOUNT = "acct-reconcile";

const entry: ImportedExecution = {
  symbol: "TEST",
  side: "buy",
  quantity: 10,
  price: 100,
  fee: 0,
  executedAt: "2026-09-01T10:00:00Z",
};
const exit: ImportedExecution = {
  symbol: "TEST",
  side: "sell",
  quantity: 10,
  price: 102,
  fee: 0,
  executedAt: "2026-09-01T11:00:00Z",
};

const eventRows = () =>
  db
    .select()
    .from(domainOutbox)
    .all()
    .map((row) => JSON.parse(row.payloadJson) as { kind: string; mode: string; tradeKey: string });
const revisionRows = () => db.select().from(tradeProjectionRevisions).all();
const identityRows = () => db.select().from(tradeIdentities).all();

beforeEach(() => {
  db.delete(domainOutbox).run();
  db.delete(tradeProjectionRevisions).run();
  db.delete(tradeIdentities).run();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values({ id: ACCOUNT, name: "Reconcile", kind: "manual", createdAt: "2026-01-01" })
    .run();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("a manual trade is reconciled with its projection evidence", () => {
  it("writes the fills, the projection, the identity, the revision and one event", () => {
    expect(recordManualTrades(ACCOUNT, [entry, exit])).toMatchObject({
      inserted: 2,
      duplicates: 0,
    });

    expect(db.select().from(executions).all()).toHaveLength(2);
    const trade = db.select().from(trades).all()[0];
    expect(trade).toMatchObject({ accountId: ACCOUNT, status: "win", netPnl: 20 });
    expect(identityRows()).toHaveLength(1);
    expect(revisionRows()).toHaveLength(1);
    expect(eventRows()).toHaveLength(1);
    expect(eventRows()[0]).toMatchObject({ kind: "discovered", mode: "live" });
  });

  it("writes the notes onto the trade the fills opened", () => {
    recordManualTrades(ACCOUNT, [entry, exit], "## Setup\nWaited for confirmation.");
    expect(db.select().from(trades).all()[0]?.notes).toBe("## Setup\nWaited for confirmation.");
  });

  it("keeps the annotations when a rebuild recomputes the trade", () => {
    recordManualTrades(ACCOUNT, [entry, exit], "Held for the breakout.");
    rebuildAccount(ACCOUNT);
    expect(db.select().from(trades).all()[0]?.notes).toBe("Held for the breakout.");
  });
});

describe("an unchanged projection writes no revision and raises no event", () => {
  it("says so after a rebuild that changes nothing", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    const revisionsBefore = revisionRows().length;
    const eventsBefore = eventRows().length;

    rebuildAccount(ACCOUNT);

    expect(revisionRows()).toHaveLength(revisionsBefore);
    expect(eventRows()).toHaveLength(eventsBefore);
  });

  it("stays silent when the same fills are submitted again", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    const eventsBefore = eventRows().length;

    expect(recordManualTrades(ACCOUNT, [entry, exit])).toMatchObject({
      inserted: 0,
      duplicates: 2,
    });

    expect(eventRows()).toHaveLength(eventsBefore);
    expect(db.select().from(executions).all()).toHaveLength(2);
  });
});

describe("a changed projection is classified by what changed", () => {
  it("revises the trade when only its fee changed", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    const revisionBefore = revisionRows().length;

    // A corrected fee changes the computed facts of the same trade.
    db.update(executions).set({ fee: 1.5 }).where(eqSymbol()).run();
    rebuildAccount(ACCOUNT);

    expect(revisionRows().length).toBe(revisionBefore + 1);
    const events = eventRows();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ kind: "revised" });
  });

  it("reports an open cycle that closes as closed", () => {
    // The entry alone is an open cycle.
    recordManualTrades(ACCOUNT, [entry]);
    expect(eventRows()[0]).toMatchObject({ kind: "opened" });

    // The exit closes the same cycle.
    recordManualTrades(ACCOUNT, [exit]);
    expect(eventRows()[1]).toMatchObject({ kind: "closed" });
  });

  it("discovers a historical close instead of calling it a live closure", () => {
    importGenericExecutions(ACCOUNT, [entry, exit]);
    expect(eventRows()[0]).toMatchObject({ kind: "discovered", mode: "historical" });
  });

  it("removes a projection that disappeared and retires its identity", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    const identity = identityRows()[0];
    expect(identity).toBeDefined();

    db.delete(executions).run();
    rebuildAccount(ACCOUNT);

    expect(db.select().from(trades).all()).toHaveLength(0);
    expect(identityRows()[0]?.state).toBe("tombstoned");
    expect(eventRows().at(-1)).toMatchObject({ kind: "removed" });
  });
});

describe("a journal that predates the evidence layer keeps its own state", () => {
  it("reports an unchanged projection as unchanged instead of discovering it again", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    // A journal written before the evidence layer existed has trade rows but no
    // identities and no revisions.
    db.delete(tradeProjectionRevisions).run();
    db.delete(tradeIdentities).run();
    db.delete(domainOutbox).run();

    const result = withJournalTransaction((tx) =>
      reconcileAccountInTx(tx, ACCOUNT, changeContext("system", "maintenance")),
    );

    expect(result).toMatchObject({ unchanged: 1, discovered: 0, opened: 0, revised: 0 });
    expect(identityRows()).toHaveLength(0);
    expect(revisionRows()).toHaveLength(0);
    expect(eventRows()).toHaveLength(0);
  });

  it("reports a vanished projection as removed even without an identity to retire", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    db.delete(tradeProjectionRevisions).run();
    db.delete(tradeIdentities).run();
    db.delete(domainOutbox).run();
    db.delete(executions).run();

    const result = withJournalTransaction((tx) =>
      reconcileAccountInTx(tx, ACCOUNT, changeContext("system", "maintenance")),
    );

    expect(result).toMatchObject({ removed: 1 });
    expect(db.select().from(trades).all()).toHaveLength(0);
    expect(eventRows()).toHaveLength(0);
  });
});

describe("the whole operation is one transaction", () => {
  it("rolls the fills, the projections, the revisions, the events and the notes back", () => {
    // A trigger that fails the projection write aborts the whole operation.
    db.$client.exec(
      "CREATE TRIGGER fail_trade BEFORE INSERT ON trades BEGIN SELECT RAISE(FAIL, 'test reconciliation failure'); END",
    );
    try {
      expect(() =>
        recordManualTrades(ACCOUNT, [entry, exit], "A note that must not survive"),
      ).toThrow();
    } finally {
      db.$client.exec("DROP TRIGGER fail_trade");
    }

    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(db.select().from(trades).all()).toHaveLength(0);
    expect(revisionRows()).toHaveLength(0);
    expect(identityRows()).toHaveLength(0);
    expect(eventRows()).toHaveLength(0);
  });

  it("rolls the operation back when the event append fails", () => {
    db.$client.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON domain_outbox BEGIN SELECT RAISE(FAIL, 'test event failure'); END",
    );
    try {
      expect(() =>
        recordManualTrades(ACCOUNT, [entry, exit], "A note that must not survive"),
      ).toThrow();
    } finally {
      db.$client.exec("DROP TRIGGER fail_event");
    }

    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(db.select().from(trades).all()).toHaveLength(0);
    expect(revisionRows()).toHaveLength(0);
    expect(eventRows()).toHaveLength(0);
  });

  it("rolls the fills back when the note write fails, so the note is in the same transaction", () => {
    // The failure happens on the note write itself, the last write of the
    // operation. Were the note written outside the transaction, the fills
    // would already be committed and would survive.
    db.$client.exec(
      "CREATE TRIGGER fail_note BEFORE UPDATE OF notes ON trades BEGIN SELECT RAISE(FAIL, 'test note failure'); END",
    );
    try {
      expect(() =>
        recordManualTrades(ACCOUNT, [entry, exit], "A note that must not survive"),
      ).toThrow();
    } finally {
      db.$client.exec("DROP TRIGGER fail_note");
    }

    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(db.select().from(trades).all()).toHaveLength(0);
    expect(revisionRows()).toHaveLength(0);
    expect(eventRows()).toHaveLength(0);
  });
});

describe("persisted event capture controls future mutations", () => {
  it("keeps projection evidence while off and captures only future changes after re-enabling", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    const initialEvents = eventRows();
    expect(initialEvents).toHaveLength(1);
    updateSettings({ journalEventCapture: false });
    db.update(executions).set({ fee: 1 }).where(eqSymbol()).run();
    rebuildAccount(ACCOUNT);

    expect(db.select().from(trades).all()[0]?.netPnl).toBe(18);
    expect(revisionRows()).toHaveLength(2);
    expect(eventRows()).toEqual(initialEvents);

    updateSettings({ journalEventCapture: true });
    rebuildAccount(ACCOUNT);
    expect(eventRows()).toEqual(initialEvents);
    db.update(executions).set({ fee: 2 }).where(eqSymbol()).run();
    rebuildAccount(ACCOUNT);
    expect(revisionRows()).toHaveLength(3);
    expect(eventRows()).toHaveLength(2);
    expect(eventRows().at(-1)).toMatchObject({ kind: "revised" });
  });

  it("retires removed identities while off without deleting queued events or backfilling on enable", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    const initialEvents = db.select().from(domainOutbox).all();
    updateSettings({ journalEventCapture: false });
    db.delete(executions).run();
    rebuildAccount(ACCOUNT);

    expect(db.select().from(trades).all()).toHaveLength(0);
    expect(identityRows()[0]?.state).toBe("tombstoned");
    expect(db.select().from(domainOutbox).all()).toEqual(initialEvents);
    updateSettings({ journalEventCapture: true });
    rebuildAccount(ACCOUNT);
    expect(db.select().from(domainOutbox).all()).toEqual(initialEvents);
    recordManualTrades(ACCOUNT, [entry, exit]);
    db.delete(executions).run();
    rebuildAccount(ACCOUNT);
    expect(eventRows()).toHaveLength(initialEvents.length + 2);
    expect(eventRows().at(-1)).toMatchObject({ kind: "removed" });
  });
});

describe("the reconciliation boundary is callable on its own", () => {
  it("reports what it changed", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    const result = withJournalTransaction((tx) =>
      reconcileAccountInTx(tx, ACCOUNT, changeContext("system", "maintenance")),
    );
    expect(result).toMatchObject({ discovered: 0, unchanged: 1, revised: 0 });
  });
});

/** The saved TEST fill, so a fee correction touches exactly one row. */
function eqSymbol() {
  return eq(executions.symbol, "TEST");
}
