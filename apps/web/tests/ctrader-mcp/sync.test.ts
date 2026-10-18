import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, accounts } from "@/db";
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

const addAccount = (
  id: string,
  extra: Partial<typeof accounts.$inferInsert> = {},
) => {
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
            time: "2026-09-30T12:00:00Z",
            commission: 0,
            swap: 0,
          },
          {
            orderId: 2,
            positionId: 100,
            symbolName: "EURUSD",
            dealType: "close",
            side: "Sell",
            filledVolume: 1000,
            executionPrice: 1.2,
            time: "2026-09-30T13:00:00Z",
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
    addAccount(accountId);

    const first = await syncCTraderMcpAccount(accountId);
    expect(first.inserted).toBe(2);
    expect(first.duplicates).toBe(0);

    const second = await syncCTraderMcpAccount(accountId);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(2);
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
    await expect(syncCTraderMcpAccount("not-found")).rejects.toThrow(
      "Account not found",
    );
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
});
