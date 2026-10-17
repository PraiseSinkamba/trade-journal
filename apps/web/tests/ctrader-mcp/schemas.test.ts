import { describe, expect, it } from "vitest";
import {
  cTraderAccountSchema,
  cTraderAccountsResponseSchema,
  cTraderBalanceSchema,
  cTraderDealSchema,
  cTraderDealsResponseSchema,
  cTraderOrderSchema,
  cTraderOrdersResponseSchema,
  cTraderPositionSchema,
  cTraderPositionsResponseSchema,
  cTraderSymbolSchema,
  cTraderSymbolsResponseSchema,
} from "@/server/ctrader-mcp/schemas";

const localDeal = {
  orderId: 12345,
  positionId: 67890,
  symbolName: "EURUSD",
  dealType: "fill",
  side: "Buy" as const,
  filledVolume: 1000,
  executionPrice: 1.2345,
  entryPrice: 1.234,
  pips: 1,
  grossProfit: 0,
  commission: -0.5,
  swap: 0.25,
  netProfit: -0.25,
  label: "",
  comment: "",
  time: "2026-09-30T12:00:00Z",
};

describe("cTraderDealSchema (Local)", () => {
  it("parses a Local deal payload", () => {
    const parsed = cTraderDealSchema.parse(localDeal);
    expect(parsed.orderId).toBe(12345);
    expect(parsed.positionId).toBe(67890);
    expect(parsed.symbolName).toBe("EURUSD");
    expect(parsed.side).toBe("Buy");
    expect(parsed.commission).toBe(-0.5);
  });

  it("accepts string orderId/positionId", () => {
    const parsed = cTraderDealSchema.parse({ ...localDeal, orderId: "O-1", positionId: "P-1" });
    expect(parsed.orderId).toBe("O-1");
    expect(parsed.positionId).toBe("P-1");
  });

  it("rejects missing required fields", () => {
    expect(() => cTraderDealSchema.parse({ ...localDeal, time: undefined })).toThrow();
  });

  it("rejects invalid side", () => {
    expect(() => cTraderDealSchema.parse({ ...localDeal, side: "BUY" })).toThrow();
  });
});

describe("cTraderDealsResponseSchema", () => {
  it("wraps an array of deals", () => {
    const parsed = cTraderDealsResponseSchema.parse({ deals: [localDeal] });
    expect(parsed.deals).toHaveLength(1);
  });
});

describe("cTraderAccountSchema (Local)", () => {
  it("parses a get_accounts_list entry", () => {
    const a = cTraderAccountSchema.parse({
      id: 42,
      login: 1001,
      accountName: "Test Account",
      brokerTitle: "Pepperstone",
      isLive: true,
      balance: 100,
      currency: "USD",
      accountType: "live",
      isOnline: true,
    });
    expect(a.id).toBe(42);
    expect(a.isLive).toBe(true);
  });

  it("cTraderAccountsResponseSchema accepts the wrapped shape", () => {
    const parsed = cTraderAccountsResponseSchema.parse({
      accounts: [
        {
          id: 1,
          accountName: "a",
          brokerTitle: "b",
          isLive: false,
          balance: 0,
          currency: "USD",
          accountType: "demo",
          isOnline: true,
        },
      ],
      count: 1,
    });
    expect(parsed.accounts[0]?.id).toBe(1);
  });
});

describe("cTraderBalanceSchema (Local)", () => {
  it("parses a get_balance payload with marginLevel null", () => {
    const b = cTraderBalanceSchema.parse({
      balance: 100,
      equity: 100,
      margin: 0,
      freeMargin: 100,
      marginLevel: null,
      netProfit: 0,
      grossProfit: 0,
      leverage: 100,
      depositAsset: "USD",
      accountName: "Test",
      accountType: "live",
      traderId: "1",
      brokerName: "Pepperstone",
      connectionState: "OK",
      isSwapFree: false,
    });
    expect(b.balance).toBe(100);
    expect(b.marginLevel).toBeNull();
    expect(b.depositAsset).toBe("USD");
  });
});

describe("cTraderSymbolSchema (Local)", () => {
  it("parses a representative payload", () => {
    const s = cTraderSymbolSchema.parse({
      symbolName: "EURUSD",
      description: "Euro vs US Dollar",
    });
    expect(s.symbolName).toBe("EURUSD");
  });

  it("cTraderSymbolsResponseSchema wraps an array", () => {
    const parsed = cTraderSymbolsResponseSchema.parse({
      symbols: [{ symbolName: "EURUSD" }],
    });
    expect(parsed.symbols[0]?.symbolName).toBe("EURUSD");
  });
});

describe("cTraderPositionSchema / cTraderOrderSchema (Local)", () => {
  it("cTraderPositionSchema accepts a representative position", () => {
    const parsed = cTraderPositionSchema.parse({
      positionId: 1,
      symbolName: "EURUSD",
      side: "Buy",
      volume: 0.1,
      entryPrice: 1.1,
      netProfit: 0,
    });
    expect(parsed.positionId).toBe(1);
  });

  it("cTraderPositionsResponseSchema wraps positions", () => {
    const parsed = cTraderPositionsResponseSchema.parse({
      positions: [{ positionId: 1, symbolName: "EURUSD" }],
    });
    expect(parsed.positions[0]?.positionId).toBe(1);
  });

  it("cTraderOrderSchema accepts a working-order payload", () => {
    const parsed = cTraderOrderSchema.parse({
      orderId: 1,
      symbolName: "EURUSD",
      side: "Buy",
      type: "LIMIT",
      volume: 0.1,
      limitPrice: 1.1,
      stopPrice: null,
    });
    expect(parsed.side).toBe("Buy");
  });

  it("cTraderOrdersResponseSchema wraps orders", () => {
    const parsed = cTraderOrdersResponseSchema.parse({ orders: [] });
    expect(parsed.orders).toEqual([]);
  });
});
