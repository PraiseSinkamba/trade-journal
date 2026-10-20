import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, accounts, executions, trades } from "@/db";
import { encryptJson } from "@/server/crypto";
import { newId } from "@/server/ids";
import { syncCTraderMcpAccount } from "@/server/ctrader-mcp/sync";
import type { InsertResult } from "@/server/executions";

// Test seam: tests install a fake MCP via globalThis.__FAKE_MCP__ and use the
// typed alias below for read/write. Defined once to avoid per-use inline casts.
const testSlot = globalThis as unknown as { __FAKE_MCP__?: unknown };
const ORIGINAL = testSlot.__FAKE_MCP__;
let fake: FakeMcp;

interface FakeMcp {
  toolResponses: Record<string, unknown>;
  callCount: number;
  initialize: () => Promise<void>;
  close: () => Promise<void>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

// vi.importActual bypasses the module cache and returns the real module.
// vi.hoisted runs before vi.mock factory, so the real fn is captured here.
const { insertExecutions: realInsertExecutions } = await vi.importActual<{
  insertExecutions: (...a: unknown[]) => InsertResult;
}>("@/server/executions");

const insertExecutionsMock = vi.hoisted(() =>
  vi.fn<(...a: unknown[]) => InsertResult>((...a) => realInsertExecutions(...a)),
);

vi.mock("@/server/executions", () => ({
  insertExecutions: (...a: unknown[]) => insertExecutionsMock(...a),
}));

beforeEach(() => {
  fake = {
    toolResponses: {},
    callCount: 0,
    initialize: async () => {},
    close: async () => {},
    callTool: async (name: string) => {
      fake.callCount++;
      const resp = fake.toolResponses[name];
      if (resp instanceof Error) throw resp;
      // Default for tools the new sync flow always calls but older
      // fixtures don't pre-populate; keeps test output free of harmless
      // "get_order_history failed" warnings.
      if (resp === undefined && name === "get_order_history") {
        return { trades: [] };
      }
      return resp;
    },
  };
});

afterEach(() => {
  testSlot.__FAKE_MCP__ = ORIGINAL;
  vi.restoreAllMocks();
});

const creds = {
  endpoint: "http://127.0.0.1:9876/mcp/",
  ctraderAccountId: 42,
};

const addAccount = (id: string, extra: Partial<typeof accounts.$inferInsert> = {}) => {
  db.insert(accounts)
    .values({
      id,
      name: id,
      kind: "sync",
      broker: "ctrader-mcp",
      currency: "USD",
      credentialsEnc: encryptJson(creds),
      createdAt: "2026-01-01",
      ...extra,
    })
    .run();
};

describe("syncCTraderMcpAccount (Local)", () => {
  it("inserts one execution per deal and re-sync is a no-op", async () => {
    fake.toolResponses = {
      get_symbols: {
        symbols: [{ name: "EURUSD", description: "Euro vs US Dollar", assetClass: "Forex (Spot)" }],
      },
      get_deals: {
        deals: [
          {
            orderId: 1,
            positionId: 100,
            symbolName: "EURUSD",
            dealType: "fill",
            side: "Buy",
            filledVolume: 1000,
            executionPrice: 1.1,
            entryPrice: 1.1,
            time: "2026-09-30T12:00:00Z",
            commission: 0,
            swap: 0,
            grossProfit: 0,
          },
          {
            orderId: 2,
            positionId: 100,
            symbolName: "EURUSD",
            dealType: "close",
            side: "Sell",
            filledVolume: 1000,
            executionPrice: 1.2,
            entryPrice: 1.1,
            time: "2026-09-30T13:00:00Z",
            commission: 0,
            swap: 0,
            grossProfit: 100,
          },
        ],
      },
      get_positions: { positions: [] },
      get_pending_orders: { orders: [] },
      get_balance: {
        balance: 100,
        equity: 100,
        margin: 0,
        freeMargin: 100,
        marginLevel: null,
        depositAsset: "USD",
        brokerName: "Pepperstone",
      },
    };
    testSlot.__FAKE_MCP__ = fake;

    const accountId = newId();
    addAccount(accountId);

    const first = await syncCTraderMcpAccount(accountId);
    expect(first.inserted).toBe(2);
    expect(first.duplicates).toBe(0);

    const second = await syncCTraderMcpAccount(accountId);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(2);
  });

  it("emits synthetic entry + real close when only the close is in the deal stream", async () => {
    fake.toolResponses = {
      get_symbols: {
        symbols: [{ name: "NAS100", description: "US Tech 100", assetClass: "Indices" }],
      },
      get_deals: {
        deals: [
          {
            orderId: 395217525,
            positionId: 626745677,
            symbolName: "NAS100",
            dealType: "close",
            side: "Sell",
            filledVolume: 0.1,
            executionPrice: 29555,
            entryPrice: 29447.1,
            grossProfit: -10.79,
            commission: 0,
            swap: 0,
            time: "2026-10-15T14:01:25.056Z",
          },
        ],
      },
      get_positions: { positions: [] },
      get_pending_orders: { orders: [] },
      get_balance: {
        balance: 24.71,
        equity: 24.71,
        margin: 0,
        freeMargin: 24.71,
        marginLevel: null,
        depositAsset: "USD",
        brokerName: "Pepperstone",
      },
    };
    testSlot.__FAKE_MCP__ = fake;

    const accountId = newId();
    addAccount(accountId);

    const out = await syncCTraderMcpAccount(accountId);
    expect(out.inserted).toBe(2);

    const rows = db.select().from(executions).where(eq(executions.accountId, accountId)).all();
    expect(rows.length).toBe(2);
    const trade = db.select().from(trades).where(eq(trades.accountId, accountId)).get();
    expect(trade).toBeTruthy();
    expect(trade!.status).toBe("loss");
    expect(trade!.grossPnl).toBeCloseTo(-10.79, 2);
  });

  it("emits raw fills when both sides of a closed position are in the deal stream", async () => {
    fake.toolResponses = {
      get_symbols: {
        symbols: [{ name: "EURUSD", description: "Euro vs US Dollar", assetClass: "Forex (Spot)" }],
      },
      get_deals: {
        deals: [
          {
            orderId: 1,
            positionId: 200,
            symbolName: "EURUSD",
            dealType: "fill",
            side: "Buy",
            filledVolume: 1000,
            executionPrice: 1.1,
            entryPrice: 1.1,
            time: "2026-09-30T12:00:00Z",
            commission: 0,
            swap: 0,
            grossProfit: 0,
          },
          {
            orderId: 2,
            positionId: 200,
            symbolName: "EURUSD",
            dealType: "close",
            side: "Sell",
            filledVolume: 1000,
            executionPrice: 1.2,
            entryPrice: 1.1,
            time: "2026-09-30T13:00:00Z",
            commission: 0,
            swap: 0,
            grossProfit: 100,
          },
        ],
      },
      get_positions: { positions: [] },
      get_pending_orders: { orders: [] },
      get_balance: {
        balance: 100,
        equity: 100,
        margin: 0,
        freeMargin: 100,
        marginLevel: null,
        depositAsset: "USD",
        brokerName: "Pepperstone",
      },
    };
    testSlot.__FAKE_MCP__ = fake;

    const accountId = newId();
    addAccount(accountId);

    const out = await syncCTraderMcpAccount(accountId);
    expect(out.inserted).toBe(2);

    const trade = db.select().from(trades).where(eq(trades.accountId, accountId)).get();
    expect(trade).toBeTruthy();
    expect(trade!.status).toBe("win");
    expect(trade!.grossPnl).toBeCloseTo(100, 2);
  });

  it("keeps a position open when its id is in the open positions list", async () => {
    fake.toolResponses = {
      get_symbols: {
        symbols: [{ name: "EURUSD", description: "Euro vs US Dollar", assetClass: "Forex (Spot)" }],
      },
      get_deals: {
        deals: [
          {
            orderId: 5,
            positionId: 300,
            symbolName: "EURUSD",
            dealType: "fill",
            side: "Buy",
            filledVolume: 1000,
            executionPrice: 1.1,
            entryPrice: 1.1,
            time: "2026-09-30T12:00:00Z",
            commission: 0,
            swap: 0,
            grossProfit: 0,
          },
        ],
      },
      get_positions: {
        positions: [{ positionId: 300, symbolName: "EURUSD" }],
      },
      get_pending_orders: { orders: [] },
      get_balance: {
        balance: 100,
        equity: 100,
        margin: 0,
        freeMargin: 100,
        marginLevel: null,
        depositAsset: "USD",
        brokerName: "Pepperstone",
      },
    };
    testSlot.__FAKE_MCP__ = fake;

    const accountId = newId();
    addAccount(accountId);

    const out = await syncCTraderMcpAccount(accountId);
    expect(out.inserted).toBe(1);

    const trade = db.select().from(trades).where(eq(trades.accountId, accountId)).get();
    expect(trade).toBeTruthy();
    expect(trade!.status).toBe("open");
  });

  it("does not advance lastSyncAt when insertExecutions throws", async () => {
    const insertError = new Error("simulated insertExecutions failure");
    insertExecutionsMock.mockImplementation(() => {
      throw insertError;
    });

    fake.toolResponses = {
      get_symbols: { symbols: [] },
      get_deals: {
        deals: [
          {
            orderId: 1,
            positionId: 100,
            symbolName: "EURUSD",
            dealType: "fill",
            side: "Buy",
            filledVolume: 1000,
            executionPrice: 1.1,
            time: "2026-09-30T12:00:00Z",
            commission: 0,
            swap: 0,
          },
        ],
      },
      get_positions: { positions: [] },
      get_pending_orders: { orders: [] },
      get_balance: {
        balance: 100,
        equity: 100,
        margin: 0,
        freeMargin: 100,
        marginLevel: null,
        depositAsset: "USD",
        brokerName: "Pepperstone",
      },
    };
    testSlot.__FAKE_MCP__ = fake;

    const accountId = newId();
    const createdAt = "2026-01-01T00:00:00.000Z";
    addAccount(accountId, { lastSyncAt: createdAt });

    await expect(syncCTraderMcpAccount(accountId)).rejects.toThrow();

    const row = db
      .select({ lastSyncAt: accounts.lastSyncAt })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get();
    expect(row?.lastSyncAt).toBe(createdAt);
  });

  it("throws when account not found", async () => {
    await expect(syncCTraderMcpAccount("not-found")).rejects.toThrow("Account not found");
  });

  it("throws when account is not broker-connected", async () => {
    const accountId = newId();
    db.insert(accounts)
      .values({
        id: accountId,
        name: accountId,
        kind: "manual",
        broker: "",
        currency: "USD",
        credentialsEnc: null,
        createdAt: "2026-01-01",
      })
      .run();

    await expect(syncCTraderMcpAccount(accountId)).rejects.toThrow(
      "Account is not broker-connected",
    );
  });

  it("classifies a transport-level failure as 'unreachable'", async () => {
    fake.callTool = async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:9876");
    };
    testSlot.__FAKE_MCP__ = fake;

    const accountId = newId();
    addAccount(accountId);

    await expect(syncCTraderMcpAccount(accountId)).rejects.toMatchObject({
      kind: "unreachable",
    });
  });

  it("uses the opening time from get_order_history to compute a real durationMs", async () => {
    fake.toolResponses = {
      get_symbols: {
        symbols: [{ name: "NAS100", description: "US Tech 100", assetClass: "Indices" }],
      },
      get_deals: {
        deals: [
          {
            orderId: 395217525,
            positionId: 626745677,
            symbolName: "NAS100",
            dealType: "close",
            side: "Sell",
            filledVolume: 0.1,
            executionPrice: 29555,
            entryPrice: 29447.1,
            grossProfit: -10.79,
            commission: 0,
            swap: 0,
            time: "2026-10-15T14:01:25.056Z",
          },
        ],
      },
      get_positions: { positions: [] },
      get_pending_orders: { orders: [] },
      get_balance: {
        balance: 24.71,
        equity: 24.71,
        margin: 0,
        freeMargin: 24.71,
        marginLevel: null,
        depositAsset: "USD",
        brokerName: "Pepperstone",
      },
      get_order_history: {
        trades: [
          {
            positionId: 626745677,
            symbolName: "NAS100",
            side: "Buy",
            openTime: "2026-10-15T13:30:00.000Z",
            closeTime: "2026-10-15T14:01:25.056Z",
          },
        ],
      },
    };
    testSlot.__FAKE_MCP__ = fake;

    const accountId = newId();
    addAccount(accountId);

    const out = await syncCTraderMcpAccount(accountId);
    expect(out.inserted).toBe(2);

    const trade = db.select().from(trades).where(eq(trades.accountId, accountId)).get();
    expect(trade).toBeTruthy();
    expect(trade!.status).toBe("loss");
    // (14:01:25 - 13:30:00) in milliseconds = 1,885,056 ms
    expect(trade!.durationMs).toBe(
      Date.parse("2026-10-15T14:01:25.056Z") - Date.parse("2026-10-15T13:30:00.000Z"),
    );
    expect(trade!.openedAt).toBe("2026-10-15T13:30:00.000Z");
    expect(trade!.closedAt).toBe("2026-10-15T14:01:25.056Z");
  });

  it("falls back to durationMs=0 when get_order_history fails", async () => {
    fake.toolResponses = {
      get_symbols: {
        symbols: [{ name: "NAS100", description: "US Tech 100", assetClass: "Indices" }],
      },
      get_deals: {
        deals: [
          {
            orderId: 395217525,
            positionId: 626745677,
            symbolName: "NAS100",
            dealType: "close",
            side: "Sell",
            filledVolume: 0.1,
            executionPrice: 29555,
            entryPrice: 29447.1,
            grossProfit: -10.79,
            commission: 0,
            swap: 0,
            time: "2026-10-15T14:01:25.056Z",
          },
        ],
      },
      get_positions: { positions: [] },
      get_pending_orders: { orders: [] },
      get_balance: {
        balance: 24.71,
        equity: 24.71,
        margin: 0,
        freeMargin: 24.71,
        marginLevel: null,
        depositAsset: "USD",
        brokerName: "Pepperstone",
      },
      get_order_history: new Error("upstream timeout"),
    };
    testSlot.__FAKE_MCP__ = fake;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const accountId = newId();
    addAccount(accountId);

    const out = await syncCTraderMcpAccount(accountId);
    expect(out.inserted).toBe(2);

    const trade = db.select().from(trades).where(eq(trades.accountId, accountId)).get();
    expect(trade).toBeTruthy();
    expect(trade!.status).toBe("loss");
    // No order history → entry uses close time → durationMs=0
    expect(trade!.durationMs).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
