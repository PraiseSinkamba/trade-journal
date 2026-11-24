import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImportedExecution } from "@luxalgo/journal-importers";

/**
 * The domain events of a trading mutation (Phase 05).
 *
 * A committed change leaves a durable event in the same transaction as the
 * change that caused it. The event carries references only, never the broker
 * payload, and a failed operation leaves no event behind.
 *
 * Every case runs against a disposable journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-mutation-events-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const { db, accounts, executions, trades, domainOutbox, tradeProjectionRevisions } =
  await import("../src/db");
const { recordManualTrades, importGenericExecutions } =
  await import("../src/server/trading/commands");
const { parseTradeChanged } = await import("../src/server/domain-events");

const ACCOUNT = "acct-events";

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

/** The stored events, parsed back through the strict event schema. */
const events = () =>
  db
    .select()
    .from(domainOutbox)
    .all()
    .map((row) =>
      parseTradeChanged({
        id: row.id,
        type: row.type,
        schemaVersion: row.schemaVersion,
        aggregate: {
          type: row.aggregateType,
          id: row.aggregateId,
          revision: row.aggregateRevision,
        },
        correlationId: row.correlationId,
        causationId: row.causationId ?? undefined,
        origin: row.origin,
        recordedAt: new Date(row.recordedAt).toISOString(),
        occurredAt: row.occurredAt ? new Date(row.occurredAt).toISOString() : undefined,
        payload: JSON.parse(row.payloadJson),
      }),
    );

beforeEach(() => {
  db.delete(domainOutbox).run();
  db.delete(tradeProjectionRevisions).run();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({ id: ACCOUNT, name: "Events", kind: "manual", createdAt: "2026-01-01" })
    .run();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("a committed change leaves a durable event", () => {
  it("describes the change by reference, not by broker payload", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);

    const stored = events();
    expect(stored).toHaveLength(1);
    const event = stored[0]!;
    expect(event.type).toBe("trade.projection_changed");
    expect(event.schemaVersion).toBe(1);
    expect(event.origin).toBe("user");
    expect(event.payload).toMatchObject({
      accountId: ACCOUNT,
      kind: "discovered",
      mode: "live",
    });
    expect(event.payload.tradeKey).toBe(`${ACCOUNT}|TEST|long|2026-09-01T10:00:00Z`);
    expect(event.payload.projectionRevisionId).toBeTruthy();
    // The payload holds references only: no price, quantity or fee.
    expect(Object.keys(event.payload).sort()).toEqual([
      "accountId",
      "kind",
      "mode",
      "projectionRevisionId",
      "tradeKey",
    ]);
  });

  it("records the commit time, not the broker close time", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    const event = events()[0]!;
    expect(Date.parse(event.recordedAt)).toBeGreaterThan(0);
    expect(event.occurredAt).toBeUndefined();
  });

  it("raises one event per changed projection and one per revision", () => {
    // The entry alone is an open cycle.
    recordManualTrades(ACCOUNT, [entry]);
    const first = events()[0]!;

    // The exit closes the same cycle, so the same trade changes.
    recordManualTrades(ACCOUNT, [exit]);
    const second = events()[1]!;

    expect(second.aggregate.id).toBe(first.aggregate.id);
    expect(second.aggregate.revision).toBe(first.aggregate.revision + 1);
    expect(second.payload.projectionRevisionId).not.toBe(first.payload.projectionRevisionId);
  });

  it("raises no event at all for an identical retry", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    const before = events().length;

    recordManualTrades(ACCOUNT, [entry, exit]);

    expect(events()).toHaveLength(before);
  });

  it("marks an imported close as historical, so it never reads as a live closure", () => {
    importGenericExecutions(ACCOUNT, [entry, exit]);
    const event = events()[0]!;
    expect(event.origin).toBe("import");
    expect(event.payload.mode).toBe("historical");
    expect(event.payload.kind).toBe("discovered");
  });

  it("leaves the event pending for the worker to pick up", () => {
    recordManualTrades(ACCOUNT, [entry, exit]);
    expect(db.select().from(domainOutbox).all()[0]?.dispatchedAt).toBeNull();
  });
});

describe("a failed operation leaves no event behind", () => {
  it("rolls the event back when the projection write fails", () => {
    db.$client.exec(
      "CREATE TRIGGER fail_trade BEFORE INSERT ON trades BEGIN SELECT RAISE(FAIL, 'test projection failure'); END",
    );
    try {
      expect(() => recordManualTrades(ACCOUNT, [entry, exit])).toThrow();
    } finally {
      db.$client.exec("DROP TRIGGER fail_trade");
    }

    expect(events()).toHaveLength(0);
    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(db.select().from(trades).all()).toHaveLength(0);
  });

  it("rolls the fills and the notes back when the event append fails", () => {
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

    expect(events()).toHaveLength(0);
    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(db.select().from(trades).all()).toHaveLength(0);
  });
});
