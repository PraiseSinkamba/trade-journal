import { describe, expect, it, vi } from "vitest";
import {
  dealExecutionId,
  fetchAllDeals,
  mapDealToExecution,
} from "@/server/ctrader-mcp/deals";

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
