import { describe, expect, it } from "vitest";
import {
  cTraderAccountSchema,
  cTraderAccountsResponseSchema,
  cTraderBalanceSchema,
  cTraderDealSchema,
  cTraderDealsResponseSchema,
  cTraderHistoricalOrderSchema,
  cTraderOrderHistoryResponseSchema,
  cTraderOrderSchema,
  cTraderOrdersResponseSchema,
  cTraderPositionSchema,
  cTraderPositionsResponseSchema,
  cTraderSymbolSchema,
  cTraderSymbolsResponseSchema,
} from "@/server/ctrader-mcp/schemas";
import { findAssetClass } from "@/server/ctrader-mcp/symbols";

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
      name: "EURUSD",
      description: "Euro vs US Dollar",
      category: "FX Majors",
      assetClass: "Forex (Spot)",
    });
    expect(s.name).toBe("EURUSD");
    expect(s.category).toBe("FX Majors");
    expect(s.assetClass).toBe("Forex (Spot)");
  });

  it("accepts passthrough fields from the live cTrader payload", () => {
    const s = cTraderSymbolSchema.parse({
      name: "NAS100",
      description: "US Tech 100",
      category: "Indices",
      assetClass: "Indices",
      digits: 2,
      pipPosition: 1,
    });
    expect(s.name).toBe("NAS100");
    // passthrough: extra fields kept on the parsed object
    expect((s as Record<string, unknown>).digits).toBe(2);
  });

  it("cTraderSymbolsResponseSchema wraps an array", () => {
    const parsed = cTraderSymbolsResponseSchema.parse({
      symbols: [{ name: "EURUSD" }],
    });
    expect(parsed.symbols[0]?.name).toBe("EURUSD");
  });
});

describe("findAssetClass (symbols.ts)", () => {
  it("maps Forex (Spot) to forex", () => {
    expect(
      findAssetClass(
        [{ name: "EURUSD", description: "", category: "", assetClass: "Forex (Spot)" }],
        "EURUSD",
      ),
    ).toBe("forex");
  });

  it("maps Indices to cfd", () => {
    expect(
      findAssetClass(
        [{ name: "NAS100", description: "", category: "", assetClass: "Indices" }],
        "NAS100",
      ),
    ).toBe("cfd");
  });

  it("maps Crypto to crypto", () => {
    expect(
      findAssetClass(
        [{ name: "BTCUSD", description: "", category: "", assetClass: "Crypto" }],
        "BTCUSD",
      ),
    ).toBe("crypto");
  });

  it("falls back to category heuristic when assetClass is empty", () => {
    // No assetClass, category starts with "FX " → forex.
    expect(
      findAssetClass(
        [{ name: "EURUSD", description: "", category: "FX Majors", assetClass: "" }],
        "EURUSD",
      ),
    ).toBe("forex");
  });

  it("falls back to category heuristic when assetClass field is missing", () => {
    expect(
      findAssetClass(
        [{ name: "US500", description: "US 500", category: "", assetClass: "" }],
        "US500",
      ),
    ).toBe("cfd");
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

describe("cTraderHistoricalOrderSchema (Local)", () => {
  it("parses a representative get_order_history entry", () => {
    const parsed = cTraderHistoricalOrderSchema.parse({
      positionId: 626745677,
      symbolName: "NAS100",
      side: "Sell",
      openTime: "2026-10-15T13:54:24.728Z",
      closeTime: "2026-10-15T14:01:25.056Z",
    });
    expect(parsed.positionId).toBe(626745677);
    expect(parsed.side).toBe("Sell");
    expect(parsed.openTime).toBe("2026-10-15T13:54:24.728Z");
    expect(parsed.closeTime).toBe("2026-10-15T14:01:25.056Z");
  });

  it("accepts passthrough fields from the live cTrader payload", () => {
    const parsed = cTraderHistoricalOrderSchema.parse({
      positionId: 1,
      side: "Buy",
      openTime: "2026-09-30T12:00:00Z",
      closeTime: "2026-09-30T12:30:00Z",
      entryPrice: 1.1,
      closePrice: 1.2,
      pips: 10,
      grossProfit: 100,
      netProfit: 100,
      swap: 0,
      commission: 0,
      label: "",
      comment: "",
    });
    expect((parsed as Record<string, unknown>).entryPrice).toBe(1.1);
    expect((parsed as Record<string, unknown>).grossProfit).toBe(100);
  });

  it("accepts string positionId", () => {
    const parsed = cTraderHistoricalOrderSchema.parse({
      positionId: "P-1",
      side: "Buy",
      openTime: "2026-09-30T12:00:00Z",
      closeTime: "2026-09-30T12:30:00Z",
    });
    expect(parsed.positionId).toBe("P-1");
  });

  it("cTraderOrderHistoryResponseSchema wraps trades and accepts an optional count", () => {
    const parsed = cTraderOrderHistoryResponseSchema.parse({
      trades: [
        {
          positionId: 1,
          side: "Buy",
          openTime: "2026-09-30T12:00:00Z",
          closeTime: "2026-09-30T12:30:00Z",
        },
      ],
      count: 1,
    });
    expect(parsed.trades[0]?.positionId).toBe(1);
    expect(parsed.count).toBe(1);
  });

  it("cTraderOrderHistoryResponseSchema accepts an empty trades list", () => {
    const parsed = cTraderOrderHistoryResponseSchema.parse({ trades: [] });
    expect(parsed.trades).toEqual([]);
    expect(parsed.count).toBeUndefined();
  });
});
