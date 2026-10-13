import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, accounts } from "@/db";
import { encryptJson } from "@/server/crypto";
import { newId } from "@/server/ids";
import { syncCTraderMcpAccount } from "@/server/ctrader-mcp/sync";

const ORIGINAL = (globalThis as { __FAKE_MCP__?: unknown }).__FAKE_MCP__;
let fake: FakeMcp;

interface FakeMcp {
  toolResponses: Record<string, unknown>;
  callCount: number;
  initialize: () => Promise<void>;
  close: () => Promise<void>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

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
  (globalThis as { __FAKE_MCP__?: unknown }).__FAKE_MCP__ = ORIGINAL;
});

const creds = {
  mode: "remote" as const,
  endpoint: "https://fake.ctrader.com",
  bearerToken: "fake-token",
  ctraderAccountId: 1,
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

describe("syncCTraderMcpAccount", () => {
  it("inserts one execution per deal and re-sync is a no-op", async () => {
    fake.toolResponses = {
      get_account_list_by_access_token: {
        accounts: [{ accountId: 1, brokerName: "TestBroker", currency: "USD" }],
      },
      get_symbols: {
        symbols: [
          {
            symbolId: 42,
            name: "EURUSD",
            digits: 5,
            assetClass: "forex",
          },
        ],
      },
      get_deals: {
        deals: [
          {
            dealId: "D-1",
            positionId: "P-1",
            symbolId: 42,
            side: "BUY",
            filledVolume: 1000,
            executionPrice: 1.1,
            executionTime: "2026-09-30T12:00:00Z",
            commission: 0,
            swap: 0,
          },
          {
            dealId: "D-2",
            positionId: "P-1",
            symbolId: 42,
            side: "SELL",
            filledVolume: 1000,
            executionPrice: 1.2,
            executionTime: "2026-09-30T13:00:00Z",
            commission: 0,
            swap: 0,
          },
        ],
      },
      get_positions: { positions: [] },
      get_pending_orders: { orders: [] },
      get_account_info: {
        accountId: 1,
        balance: 100,
        equity: 100,
        freeMargin: 100,
        currency: "USD",
      },
    };
    (globalThis as { __FAKE_MCP__?: unknown }).__FAKE_MCP__ = fake;

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
    const syncError = new Error("simulated insertExecutions failure");
    fake.toolResponses = {
      get_account_list_by_access_token: {
        accounts: [{ accountId: 1, brokerName: "TestBroker", currency: "USD" }],
      },
      get_symbols: {
        symbols: [
          {
            symbolId: 42,
            name: "EURUSD",
            digits: 5,
            assetClass: "forex",
          },
        ],
      },
      // Inject error when fetching deals — simulates a mid-sync failure
      get_deals: syncError,
      get_positions: { positions: [] },
      get_pending_orders: { orders: [] },
      get_account_info: {
        accountId: 1,
        balance: 100,
        equity: 100,
        freeMargin: 100,
        currency: "USD",
      },
    };
    (globalThis as { __FAKE_MCP__?: unknown }).__FAKE_MCP__ = fake;

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
});
