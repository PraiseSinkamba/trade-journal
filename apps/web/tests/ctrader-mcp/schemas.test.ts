import { describe, expect, it } from "vitest";
import { cTraderDealSchema } from "@/server/ctrader-mcp/schemas";

const validDeal = {
  dealId: "D-1",
  positionId: "P-1",
  symbolId: 42,
  side: "BUY",
  filledVolume: 1000,
  executionPrice: 1.2345,
  executionTime: "2026-09-30T12:00:00Z",
  commission: -0.5,
  swap: 0,
};

describe("cTraderDealSchema", () => {
  it("parses a valid deal", () => {
    const parsed = cTraderDealSchema.parse(validDeal);
    expect(parsed.dealId).toBe("D-1");
  });
  it("rejects missing required fields", () => {
    expect(() => cTraderDealSchema.parse({ ...validDeal, dealId: undefined })).toThrow();
  });
});
