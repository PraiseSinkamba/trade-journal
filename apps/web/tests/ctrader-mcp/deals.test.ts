import { describe, expect, it, vi } from "vitest";
import {
  dealExecutionId,
  fetchAllDeals,
  mapClosedPositionToExecutions,
  mapDealToExecution,
} from "@/server/ctrader-mcp/deals";
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

describe("mapDealToExecution (Local)", () => {
  it("maps a Buy deal with commission+swap into fee", () => {
    const ex = mapDealToExecution(localDeal, "EURUSD", "forex", 0);
    expect(ex.side).toBe("buy");
    expect(ex.fee).toBe(0.75);
    expect(ex.executedAt).toBe("2026-09-30T12:00:00Z");
    expect(ex.importMetadata?.id).toBe("12345:2026-09-30T12:00:00Z:1000:1.2345");
    expect(ex.importMetadata?.group).toBe("67890");
    expect(ex.assetClass).toBe("forex");
  });

  it("maps Sell to sell and remaps stock to equity", () => {
    const ex = mapDealToExecution(
      { ...localDeal, side: "Sell" as const },
      "EURUSD",
      "stock",
      1,
    );
    expect(ex.side).toBe("sell");
    expect(ex.assetClass).toBe("equity");
  });

  it("falls back to other when asset class is unknown", () => {
    const ex = mapDealToExecution(
      { ...localDeal, symbolName: "FOO" },
      "FOO",
      "other",
      0,
    );
    expect(ex.assetClass).toBe("other");
  });
});

describe("dealExecutionId", () => {
  it("is stable for the same deal", () => {
    expect(dealExecutionId(localDeal)).toBe(dealExecutionId({ ...localDeal }));
  });

  it("differs when any of orderId/time/filledVolume/executionPrice changes", () => {
    expect(dealExecutionId(localDeal)).not.toBe(
      dealExecutionId({ ...localDeal, orderId: 99999 }),
    );
    expect(dealExecutionId(localDeal)).not.toBe(
      dealExecutionId({ ...localDeal, time: "2026-09-30T12:00:01Z" }),
    );
    expect(dealExecutionId(localDeal)).not.toBe(
      dealExecutionId({ ...localDeal, filledVolume: 2000 }),
    );
    expect(dealExecutionId(localDeal)).not.toBe(
      dealExecutionId({ ...localDeal, executionPrice: 1.2346 }),
    );
  });
});

describe("fetchAllDeals (Local)", () => {
  it("calls get_deals once and returns its deals", async () => {
    const callTool = vi.fn().mockResolvedValue({ deals: [localDeal] });
    const fake = { initialize: async () => undefined, close: async () => undefined, callTool };
    const out = await fetchAllDeals(
      fake as unknown as Parameters<typeof fetchAllDeals>[0],
    );
    expect(out).toEqual([localDeal]);
    expect(callTool).toHaveBeenCalledWith(
      "get_deals",
      expect.objectContaining({ count: 200 }),
      expect.anything(),
    );
  });

  it("respects an optional symbolName filter", async () => {
    const callTool = vi.fn().mockResolvedValue({ deals: [] });
    const fake = { initialize: async () => undefined, close: async () => undefined, callTool };
    await fetchAllDeals(
      fake as unknown as Parameters<typeof fetchAllDeals>[0],
      { symbolName: "EURUSD" },
    );
    expect(callTool).toHaveBeenCalledWith(
      "get_deals",
      expect.objectContaining({ symbolName: "EURUSD" }),
      expect.anything(),
    );
  });
});

describe("mapClosedPositionToExecutions (Local)", () => {
  const closedDeal = {
    orderId: 395217525,
    positionId: 626745677,
    symbolName: "NAS100",
    dealType: "close",
    side: "Sell" as const,
    filledVolume: 0.1,
    executionPrice: 29555,
    entryPrice: 29447.1,
    pips: -107.9,
    grossProfit: -10.79,
    commission: 0,
    swap: 0,
    netProfit: -10.79,
    label: "",
    comment: "",
    time: "2026-10-15T14:01:25.056Z",
  };

  it("emits a synthetic entry plus the real close with reportedGrossPnl", () => {
    const result = mapClosedPositionToExecutions(closedDeal, "NAS100", "cfd", 5);
    result.forEach((entry, i) => {
      if (i === 0) {
        // Synthetic entry: opposite side, entryPrice, fee 0, same group, order=dealIndex*2.
        expect(entry.side).toBe("buy");
        expect(entry.price).toBe(29447.1);
        expect(entry.quantity).toBe(0.1);
        expect(entry.fee).toBe(0);
        expect(entry.executedAt).toBe("2026-10-15T14:01:25.056Z");
        expect(entry.symbol).toBe("NAS100");
        expect(entry.assetClass).toBe("cfd");
        expect(entry.importMetadata?.id).toBe(
          `synthetic:open:${closedDeal.orderId}:${closedDeal.time}:${closedDeal.filledVolume}:${closedDeal.executionPrice}`,
        );
        expect(entry.importMetadata?.group).toBe("626745677");
        expect(entry.importMetadata?.order).toBe(10);
      } else {
        // Real close: same as mapDealToExecution but with reportedGrossPnl and order=dealIndex*2+1.
        expect(entry.side).toBe("sell");
        expect(entry.price).toBe(29555);
        expect(entry.quantity).toBe(0.1);
        expect(entry.fee).toBe(0);
        expect(entry.executedAt).toBe("2026-10-15T14:01:25.056Z");
        expect(entry.symbol).toBe("NAS100");
        expect(entry.assetClass).toBe("cfd");
        expect(entry.importMetadata?.id).toBe(
          `${closedDeal.orderId}:${closedDeal.time}:${closedDeal.filledVolume}:${closedDeal.executionPrice}`,
        );
        expect(entry.importMetadata?.group).toBe("626745677");
        expect(entry.importMetadata?.order).toBe(11);
        expect(entry.importMetadata?.reportedGrossPnl).toBe(-10.79);
        expect(entry.importMetadata?.preserveFee).toBe(true);
      }
    });
  });

  it("flips sides for a Buy close", () => {
    const buyClose = { ...closedDeal, side: "Buy" as const, grossProfit: 5.5 };
    const result = mapClosedPositionToExecutions(buyClose, "EURUSD", "forex", 0);
    result.forEach((fill, i) => {
      if (i === 0) expect(fill.side).toBe("sell");
      else {
        expect(fill.side).toBe("buy");
        expect(fill.importMetadata?.reportedGrossPnl).toBe(5.5);
      }
    });
  });

  it("remaps stock asset class to equity on both fills", () => {
    const result = mapClosedPositionToExecutions(closedDeal, "AAPL", "stock", 0);
    result.forEach((fill) => {
      expect(fill.assetClass).toBe("equity");
    });
  });

  it("uses openingTime for the synthetic entry when provided", () => {
    const result = mapClosedPositionToExecutions(
      closedDeal,
      "NAS100",
      "cfd",
      5,
      "2026-10-15T13:55:42.000Z",
    );
    expect(result[0]?.executedAt).toBe("2026-10-15T13:55:42.000Z");
    // Close is still the close time.
    expect(result[1]?.executedAt).toBe("2026-10-15T14:01:25.056Z");
  });

  it("falls back to deal.time when openingTime is omitted", () => {
    const result = mapClosedPositionToExecutions(closedDeal, "NAS100", "cfd", 5);
    expect(result[0]?.executedAt).toBe("2026-10-15T14:01:25.056Z");
    expect(result[1]?.executedAt).toBe("2026-10-15T14:01:25.056Z");
  });
});

describe("deal × symbol join (Local)", () => {
  it("joins a deal symbolName against a symbol keyed by `name`", async () => {
    // The orchestrator looks up assetClass via findAssetClass(symbols, deal.symbolName).
    // Symbols arrive keyed by `name`; deals arrive keyed by `symbolName`.
    // Both must agree on the same string ("NAS100" === "NAS100").
    const callTool = vi.fn().mockResolvedValue({
      deals: [{ ...localDeal, symbolName: "NAS100" }],
    });
    const fake = { initialize: async () => undefined, close: async () => undefined, callTool };
    const deals = await fetchAllDeals(
      fake as unknown as Parameters<typeof fetchAllDeals>[0],
    );
    const symbols = [
      { name: "NAS100", description: "US Tech 100", category: "Indices", assetClass: "Indices" },
    ];
    const assetClass = findAssetClass(symbols, deals[0]!.symbolName);
    const ex = mapDealToExecution(deals[0]!, deals[0]!.symbolName, assetClass, 0);
    expect(deals[0]!.symbolName).toBe("NAS100");
    expect(ex.symbol).toBe("NAS100");
    expect(ex.assetClass).toBe("cfd");
  });
});
