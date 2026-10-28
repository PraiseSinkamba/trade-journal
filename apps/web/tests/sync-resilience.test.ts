import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-sync-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
// Event capture is off in production; the event behaviour is proved here.
process.env.JOURNAL_EVENT_CAPTURE = "1";

interface FakeTrade {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee?: number;
  executedAt?: string;
}
interface FakeBrokerAccount {
  id: string;
  name: string;
  currency: string;
  equity: number;
  positions: unknown[];
  trades: FakeTrade[];
}

// The broker connection is the only network seam of the SDK sync path.
const broker = vi.hoisted(() => ({ accounts: [] as FakeBrokerAccount[] }));
vi.mock("@luxalgo/broker-sdk", () => ({
  connect: () => ({
    broker: "alpaca",
    label: "test",
    credentials: {},
    fetchSnapshot: async () => ({
      broker: "alpaca",
      fetchedAt: "2026-09-02T00:00:00.000Z",
      accounts: broker.accounts,
    }),
    fetchBars: async () => [],
  }),
  listBrokers: () => [],
}));

const { db, accounts, executions, trades, domainOutbox, tradeProjectionRevisions } =
  await import("../src/db");
const { insertExecutions, partitionExecutions } = await import("../src/server/executions");
const { encryptJson } = await import("../src/server/crypto");
const { syncAccount } = await import("../src/server/sync");

const good: ImportedExecution = {
  symbol: "ES",
  side: "buy",
  quantity: 1,
  price: 5000,
  fee: 1.2,
  executedAt: "2026-09-01T10:00:00Z",
};
const mixed = [
  good,
  { ...good, side: "sell", price: NaN, executedAt: "2026-09-01T11:00:00Z" },
  { ...good, quantity: 0, executedAt: "2026-09-01T12:00:00Z" },
  { ...good, fee: Infinity, executedAt: "2026-09-01T13:00:00Z" },
  { ...good, side: "sell", price: 5010, executedAt: "2026-09-01T14:00:00Z" },
] as ImportedExecution[];

const SDK_ACCOUNT = "sdk-broker";

/** The broker snapshot the fake SDK connection returns. */
const brokerSnapshot = (trades: FakeTrade[]) => {
  broker.accounts = [
    {
      id: SDK_ACCOUNT,
      name: "SDK Broker",
      currency: "USD",
      equity: 10_000,
      positions: [],
      trades,
    },
  ];
};

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  // The outbox has no account foreign key, so it is cleared explicitly.
  db.delete(domainOutbox).run();
  db.insert(accounts)
    .values({ id: "broker", name: "Broker", kind: "sync", createdAt: "2026-01-01" })
    .run();
  db.insert(accounts)
    .values({
      id: SDK_ACCOUNT,
      name: "SDK Broker",
      kind: "sync",
      broker: "alpaca",
      currency: "USD",
      credentialsEnc: encryptJson({ apiKey: "test" }),
      createdAt: "2026-01-01",
    })
    .run();
  broker.accounts = [];
});
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("one odd broker record does not fail the whole sync", () => {
  it("keeps the valid fills from a mixed broker batch and reports how many were skipped", () => {
    const result = insertExecutions("broker", mixed, "sync");
    expect(result.inserted).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.skippedReasons).toHaveLength(3);
    expect(result.skippedReasons.join(" ")).toMatch(/price/);
    expect(result.skippedReasons.join(" ")).toMatch(/quantity/);
    expect(result.skippedReasons.join(" ")).toMatch(/fee/);
    expect(db.select().from(executions).all()).toHaveLength(2);
  });

  it("skips invalid rows from an imported file instead of rejecting the file", () => {
    const result = insertExecutions("broker", mixed, "import");
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(3);
  });

  it("still rejects a manually entered batch when any fill is invalid", () => {
    expect(() => insertExecutions("broker", mixed, "manual")).toThrow();
    expect(db.select().from(executions).all()).toHaveLength(0);
  });

  it("caps the list of skip reasons so a large broken batch stays reportable", () => {
    const broken = Array.from({ length: 20 }, (_, i) => ({
      ...good,
      quantity: -1,
      executedAt: `2026-09-01T10:${String(i).padStart(2, "0")}:00Z`,
    }));
    const { skipped, skippedReasons, usable } = partitionExecutions(broken, "sync");
    expect(skipped).toBe(20);
    expect(usable).toHaveLength(0);
    expect(skippedReasons.length).toBeLessThanOrEqual(5);
  });
});

describe("a broker sync commits its fills, its snapshot and its events together", () => {
  const esRoundTrip: FakeTrade[] = [
    {
      symbol: "ES",
      side: "buy",
      quantity: 1,
      price: 5000,
      fee: 1,
      executedAt: "2026-09-01T10:00:00Z",
    },
    {
      symbol: "ES",
      side: "sell",
      quantity: 1,
      price: 5010,
      fee: 1,
      executedAt: "2026-09-01T11:00:00Z",
    },
  ];

  const accountRow = () => db.select().from(accounts).where(eq(accounts.id, SDK_ACCOUNT)).get();
  const events = () =>
    db.select().from(domainOutbox).where(eq(domainOutbox.accountId, SDK_ACCOUNT)).all();
  const revisions = () =>
    db
      .select()
      .from(tradeProjectionRevisions)
      .where(eq(tradeProjectionRevisions.accountId, SDK_ACCOUNT))
      .all();

  it("rolls the whole sync back when the event append fails", async () => {
    brokerSnapshot(esRoundTrip);
    db.$client.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON domain_outbox BEGIN SELECT RAISE(FAIL, 'test event failure'); END",
    );
    try {
      await expect(syncAccount(SDK_ACCOUNT)).rejects.toThrow();
    } finally {
      db.$client.exec("DROP TRIGGER fail_event");
    }

    expect(
      db.select().from(executions).where(eq(executions.accountId, SDK_ACCOUNT)).all(),
    ).toHaveLength(0);
    expect(db.select().from(trades).where(eq(trades.accountId, SDK_ACCOUNT)).all()).toHaveLength(0);
    expect(events()).toHaveLength(0);
    expect(revisions()).toHaveLength(0);
    expect(accountRow()?.lastSyncAt).toBeNull();
    expect(accountRow()?.snapshotJson).toBeNull();
  });

  it("writes the fills, the snapshot and the event in one go", async () => {
    brokerSnapshot(esRoundTrip);

    const outcome = await syncAccount(SDK_ACCOUNT);

    expect(outcome.inserted).toBe(2);
    expect(
      db.select().from(executions).where(eq(executions.accountId, SDK_ACCOUNT)).all(),
    ).toHaveLength(2);
    expect(db.select().from(trades).where(eq(trades.accountId, SDK_ACCOUNT)).all()).toHaveLength(1);
    expect(events()).toHaveLength(1);
    expect(accountRow()?.lastSyncAt).toBeTruthy();
    expect(accountRow()?.snapshotJson).toBeTruthy();
  });

  it("stays silent when the same fills are synced again", async () => {
    brokerSnapshot(esRoundTrip);
    await syncAccount(SDK_ACCOUNT);
    const before = events().length;

    const second = await syncAccount(SDK_ACCOUNT);

    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(events()).toHaveLength(before);
  });

  it("writes no revision for a projection that did not change", async () => {
    brokerSnapshot(esRoundTrip);
    await syncAccount(SDK_ACCOUNT);
    const esKey = db.select().from(trades).where(eq(trades.accountId, SDK_ACCOUNT)).get()!.key;
    const esRevisions = () => revisions().filter((row) => row.tradeKey === esKey).length;

    // A new symbol adds a new trade, so the account is reconciled again.
    brokerSnapshot([
      ...esRoundTrip,
      {
        symbol: "NQ",
        side: "buy",
        quantity: 1,
        price: 20000,
        fee: 1,
        executedAt: "2026-09-01T12:00:00Z",
      },
    ]);
    await syncAccount(SDK_ACCOUNT);

    expect(esRevisions()).toBe(1);
    expect(revisions().length).toBe(2);
  });
});
