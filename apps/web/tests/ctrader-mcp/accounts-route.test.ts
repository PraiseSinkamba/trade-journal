import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, db } from "@/db";
import { POST } from "@/app/api/accounts/route";
import { CTraderMcpClient } from "@/server/ctrader-mcp/client";
import { CTraderMcpSyncError } from "@/server/ctrader-mcp/errors";
import type { SyncOutcome } from "@/server/sync";

// Mock the cTrader MCP client used by the route handler. Other brokers
// route through the broker-sdk and stay untouched.
const fake = vi.hoisted(() => ({
  toolResponses: {} as Record<string, unknown>,
  initialize: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
  callTool: vi.fn<(name: string) => Promise<unknown>>(),
}));

const syncStub = vi.fn<(id: string) => Promise<SyncOutcome>>();

vi.mock("@/server/ctrader-mcp/client", () => ({
  CTraderMcpClient: vi.fn(() => fake),
}));

vi.mock("@/server/sync", () => ({
  syncAccount: (id: string) => syncStub(id),
}));

beforeEach(() => {
  fake.toolResponses = {};
  fake.initialize.mockReset().mockResolvedValue(undefined);
  fake.close.mockReset().mockResolvedValue(undefined);
  fake.callTool.mockReset().mockImplementation((name: string) =>
    Promise.resolve(fake.toolResponses[name]),
  );
  syncStub.mockReset().mockResolvedValue({
    accountId: "",
    inserted: 0,
    duplicates: 0,
    skipped: 0,
    skippedReasons: [],
    equity: null,
    positions: 0,
    syncedAt: "2026-01-01T00:00:00.000Z",
  });
});

afterEach(() => {
  // Clean any accounts the test created.
  db.delete(accounts).run();
  vi.clearAllMocks();
});

const postBody = (body: unknown) =>
  new Request("http://localhost/api/accounts", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST /api/accounts (cTrader MCP)", () => {
  it("seeds initialBalance and currency from get_balance when not supplied", async () => {
    fake.toolResponses = {
      get_balance: {
        balance: 24.71,
        equity: 24.71,
        margin: 0,
        freeMargin: 24.71,
        marginLevel: null,
        depositAsset: "USD",
        brokerName: "Pepperstone",
      },
      get_symbols: { symbols: [] },
      get_deals: { deals: [] },
      get_positions: { positions: [] },
      get_pending_orders: { orders: [] },
    };

    const res = await POST(
      postBody({
        name: "Pepperstone Live",
        kind: "sync",
        broker: "ctrader-mcp",
        credentials: {
          endpoint: "http://127.0.0.1:9876/mcp/",
          ctraderAccountId: 1,
        },
      }) as Request,
    );

    expect(res.status).toBe(200);
    const row = db.select().from(accounts).get();
    expect(row).toBeTruthy();
    expect(row!.initialBalance).toBeCloseTo(24.71, 2);
    expect(row!.currency).toBe("USD");
  });

  it("respects a user-supplied initialBalance and currency", async () => {
    fake.toolResponses = {
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

    const res = await POST(
      postBody({
        name: "Pepperstone Live",
        kind: "sync",
        broker: "ctrader-mcp",
        initialBalance: 5000,
        currency: "EUR",
        credentials: {
          endpoint: "http://127.0.0.1:9876/mcp/",
          ctraderAccountId: 1,
        },
      }) as Request,
    );

    expect(res.status).toBe(200);
    const row = db.select().from(accounts).get();
    expect(row!.initialBalance).toBe(5000);
    expect(row!.currency).toBe("EUR");
  });

  it("returns 502 and deletes the half-created account when get_balance fails", async () => {
    fake.initialize.mockRejectedValueOnce(
      new CTraderMcpSyncError("unreachable", "Can't reach cTrader MCP"),
    );

    const res = await POST(
      postBody({
        name: "Bad cTrader",
        kind: "sync",
        broker: "ctrader-mcp",
        credentials: {
          endpoint: "http://127.0.0.1:9876/mcp/",
          ctraderAccountId: 1,
        },
      }) as Request,
    );

    expect(res.status).toBe(502);
    const remaining = db.select().from(accounts).all();
    expect(remaining).toHaveLength(0);
  });
});