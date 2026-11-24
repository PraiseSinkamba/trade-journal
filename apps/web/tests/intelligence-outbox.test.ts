import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TradeChanged } from "../src/server/domain-events";
import type { JobPayload } from "../src/server/intelligence/contracts/jobs";

/**
 * The transactional outbox (Phase 04).
 *
 * A domain event is appended in the same transaction as the change that caused
 * it, and the fanout turns pending events into per-handler deliveries and jobs
 * exactly once.
 *
 * Every case runs against a disposable journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-outbox-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const { db, domainOutbox, eventDeliveries, intelligenceJobs, withJournalTransaction } =
  await import("../src/db");
const { appendDomainEvent } = await import("../src/server/domain-event-store");
const { parseTradeChanged, MAX_EVENT_PAYLOAD_BYTES } = await import("../src/server/domain-events");
const { createJobStore } = await import("../src/server/intelligence/infrastructure/jobs");
const { createOutboxDispatcher } = await import("../src/server/intelligence/infrastructure/outbox");

const NOW = 1_800_000_000_000;
const ACCOUNT = "acct-outbox";

const event = (overrides: Partial<TradeChanged> = {}): TradeChanged => ({
  id: "evt-1",
  type: "trade.projection_changed",
  schemaVersion: 1,
  aggregate: { type: "trade", id: "trade-1", revision: 3 },
  correlationId: "corr-1",
  origin: "import",
  recordedAt: "2026-02-01T00:00:00.000Z",
  payload: {
    accountId: ACCOUNT,
    tradeKey: `${ACCOUNT}|EURUSD|long|2026-01-02T00:00:00Z`,
    kind: "closed",
    mode: "live",
    projectionRevisionId: "rev-1",
  },
  ...overrides,
});

const HANDLERS = [{ id: "trade-evaluator", version: "1" }];

/** The dispatcher under test, wired to the journal's own connection. */
const dispatcher = () =>
  createOutboxDispatcher({ db, jobs: createJobStore(db), handlers: HANDLERS });

/** Appends one event inside a transaction, as a mutation path would. */
const append = (value: TradeChanged = event()): void => {
  withJournalTransaction((tx) => appendDomainEvent(tx, value));
};

const outboxRows = () => db.select().from(domainOutbox).all();
const deliveryRows = () => db.select().from(eventDeliveries).all();
const jobRows = () => db.select().from(intelligenceJobs).all();

beforeEach(() => {
  db.delete(eventDeliveries).run();
  db.delete(intelligenceJobs).run();
  db.delete(domainOutbox).run();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("domain event contract", () => {
  it("accepts a well-formed trade change and rejects anything else", () => {
    expect(parseTradeChanged(event())).toEqual(event());
    expect(() => parseTradeChanged({ ...event(), schemaVersion: 2 })).toThrow();
    expect(() => parseTradeChanged({ ...event(), unexpected: true })).toThrow();
    expect(() =>
      parseTradeChanged({ ...event(), payload: { ...event().payload, kind: "sideways" } }),
    ).toThrow();
  });
});

describe("appending a domain event", () => {
  it("stores one outbox row with the envelope columns and the payload", () => {
    append();

    const rows = outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "evt-1",
      type: "trade.projection_changed",
      schemaVersion: 1,
      aggregateType: "trade",
      aggregateId: "trade-1",
      aggregateRevision: 3,
      correlationId: "corr-1",
      origin: "import",
      accountId: ACCOUNT,
      dispatchedAt: null,
    });
    expect(JSON.parse(rows[0]!.payloadJson)).toEqual(event().payload);
  });

  it("leaves no event behind when the surrounding transaction rolls back", () => {
    expect(() =>
      withJournalTransaction((tx) => {
        appendDomainEvent(tx, event());
        throw new Error("mutation failed");
      }),
    ).toThrow("mutation failed");

    expect(outboxRows()).toHaveLength(0);
  });

  it("keeps one row when the same aggregate revision is appended twice", () => {
    append();
    append(event({ id: "evt-2" }));

    expect(outboxRows()).toHaveLength(1);
    expect(outboxRows()[0]!.id).toBe("evt-1");
  });

  it("refuses a payload larger than the 16 KiB cap", () => {
    const oversized = event({
      payload: { ...event().payload, tradeKey: "k".repeat(MAX_EVENT_PAYLOAD_BYTES + 1) },
    });

    expect(() => append(oversized)).toThrow();
    expect(outboxRows()).toHaveLength(0);
  });

  it("refuses an event that does not satisfy the strict schema", () => {
    expect(() => append({ ...event(), schemaVersion: 2 } as unknown as TradeChanged)).toThrow();
    expect(outboxRows()).toHaveLength(0);
  });
});

describe("dispatching the outbox", () => {
  it("creates one delivery and one job per event and handler, and marks the event dispatched", () => {
    append();

    expect(dispatcher().dispatchOutbox(100, NOW)).toBe(1);

    const deliveries = deliveryRows();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      eventId: "evt-1",
      handlerId: "trade-evaluator",
      handlerVersion: "1",
      state: "pending",
    });

    const jobs = jobRows();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "pending", attempts: 0, owner: null });
    expect(jobs[0]!.idempotencyKey).toBe("evt-1:trade-evaluator:1");
    expect(JSON.parse(jobs[0]!.payloadJson)).toMatchObject({
      type: "evaluate_trade",
      eventId: "evt-1",
      handlerId: "trade-evaluator",
      handlerVersion: "1",
    });
    expect(deliveries[0]!.jobId).toBe(jobs[0]!.id);

    expect(outboxRows()[0]!.dispatchedAt).toBe(NOW);
  });

  it("uses the event id, handler id and handler version as the job key", () => {
    append();
    dispatcher().dispatchOutbox(100, NOW);

    expect(jobRows()[0]!.idempotencyKey).toBe("evt-1:trade-evaluator:1");
  });

  it("persists nothing when the fanout crashes before its commit", () => {
    append();
    // A trigger that aborts the job insert makes the fanout fail mid-flight.
    db.$client.exec(`
      CREATE TRIGGER fail_job_insert BEFORE INSERT ON intelligence_jobs
      BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);

    try {
      expect(() => dispatcher().dispatchOutbox(100, NOW)).toThrow();
    } finally {
      db.$client.exec("DROP TRIGGER fail_job_insert");
    }

    expect(jobRows()).toHaveLength(0);
    expect(deliveryRows()).toHaveLength(0);
    expect(outboxRows()[0]!.dispatchedAt).toBeNull();
  });

  it("dispatches the same event exactly once when the fanout is repeated", () => {
    append();
    dispatcher().dispatchOutbox(100, NOW);

    // The event is offered to the dispatcher a second time.
    db.update(domainOutbox).set({ dispatchedAt: null }).run();

    expect(dispatcher().dispatchOutbox(100, NOW)).toBe(1);
    expect(jobRows()).toHaveLength(1);
    expect(deliveryRows()).toHaveLength(1);
  });

  it("leaves the backlog pending when the dispatcher is not run", () => {
    append();

    expect(jobRows()).toHaveLength(0);
    expect(outboxRows()[0]!.dispatchedAt).toBeNull();
  });
});

describe("job payloads", () => {
  it("round-trips the payload of a dispatched event", () => {
    append();
    dispatcher().dispatchOutbox(100, NOW);

    const payload = JSON.parse(jobRows()[0]!.payloadJson) as JobPayload;
    expect(payload.type).toBe("evaluate_trade");
  });
});
