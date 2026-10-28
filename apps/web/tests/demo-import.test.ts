import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The demo journal (Phase 06).
 *
 * The demo is an import, not a live account: it goes through the same
 * ingestion boundary as every other import, in historical mode, and the demo
 * account and its fills are written in one transaction.
 */

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-demo-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const { db, accounts, executions, trades, domainOutbox } = await import("../src/db");
const { loadDemoData } = await import("../src/server/demo");
const { parseTradeChanged } = await import("../src/server/domain-events");

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
        origin: row.origin,
        recordedAt: new Date(row.recordedAt).toISOString(),
        occurredAt: row.occurredAt ? new Date(row.occurredAt).toISOString() : undefined,
        payload: JSON.parse(row.payloadJson),
      }),
    );

beforeEach(() => {
  db.delete(domainOutbox).run();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
});
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("the demo journal loads through the import boundary", () => {
  it("writes the demo account, its fills and its trades once", () => {
    const first = loadDemoData();
    expect(first.alreadyLoaded).toBe(false);
    expect(first.inserted).toBeGreaterThan(0);
    expect(db.select().from(accounts).all()).toHaveLength(1);
    expect(db.select().from(executions).all()).toHaveLength(first.inserted);
    expect(db.select().from(trades).all().length).toBeGreaterThan(0);

    const second = loadDemoData();
    expect(second).toMatchObject({
      accountId: first.accountId,
      inserted: 0,
      alreadyLoaded: true,
    });
    expect(db.select().from(accounts).all()).toHaveLength(1);
    expect(db.select().from(executions).all()).toHaveLength(first.inserted);
  });

  it("records the demo as a historical import, never as a live opening", () => {
    process.env.JOURNAL_EVENT_CAPTURE = "1";
    try {
      loadDemoData();
    } finally {
      delete process.env.JOURNAL_EVENT_CAPTURE;
    }
    const stored = events();
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((event) => event.origin === "import")).toBe(true);
    expect(stored.every((event) => event.payload.mode === "historical")).toBe(true);
    expect(stored.some((event) => event.payload.kind === "opened")).toBe(false);
  });

  it("leaves no empty demo account when the fills cannot be written", () => {
    db.$client.exec(
      "CREATE TRIGGER fail_fill BEFORE INSERT ON executions BEGIN SELECT RAISE(FAIL, 'test fill failure'); END",
    );
    try {
      expect(() => loadDemoData()).toThrow();
    } finally {
      db.$client.exec("DROP TRIGGER fail_fill");
    }
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(db.select().from(executions).all()).toHaveLength(0);
    expect(db.select().from(trades).all()).toHaveLength(0);
  });
});
