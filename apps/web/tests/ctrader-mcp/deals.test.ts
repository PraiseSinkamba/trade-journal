import { describe, expect, it } from "vitest";
import { mapDealToExecution } from "@/server/ctrader-mcp/deals";

describe("mapDealToExecution", () => {
  it("maps a BUY deal with commission+swap into fee", () => {
    const ex = mapDealToExecution(
      {
        dealId: "D-1",
        positionId: "P-1",
        symbolId: 42,
        side: "BUY",
        filledVolume: 1000,
        executionPrice: 1.2345,
        executionTime: "2026-09-30T12:00:00Z",
        commission: -0.5,
        swap: 0.25,
      },
      "EURUSD",
      "forex",
      0,
    );
    expect(ex.fee).toBe(-0.25);
    expect(ex.side).toBe("buy");
    expect(ex.importMetadata?.id).toBe("D-1");
    expect(ex.importMetadata?.group).toBe("P-1");
  });

  it("maps SELL side to sell", () => {
    const ex = mapDealToExecution(
      {
        dealId: "D-2",
        positionId: "P-1",
        symbolId: 42,
        side: "SELL",
        filledVolume: 1000,
        executionPrice: 1.2345,
        executionTime: "2026-09-30T12:01:00Z",
        commission: 0,
        swap: 0,
      },
      "EURUSD",
      "forex",
      1,
    );
    expect(ex.side).toBe("sell");
  });
});
