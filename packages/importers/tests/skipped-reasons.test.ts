import { describe, it, expect } from "vitest";
import { tradezella } from "../src/formats/tradezella";
import { parseWithMapping } from "../src/formats/generic";
import { parseHistory } from "../src/formats/history";
import type { SkippedReason } from "../src/types";

describe("skipped-reasons", () => {
  it("tradezella reports a reason per skipped row", () => {
    const csv = [
      "Open Date,Close Date,Symbol,Volume,Entry Price,Exit Price,Net P&L",
      "2024-01-02,2024-01-02,ES,1,4500,4510,10",
      "2024-01-03,2024-01-03,,1,4500,4510,10",
      "2024-01-04,2024-01-04,ES,0,4500,4510,0",
    ].join("\n");
    const result = tradezella.parse(csv, {});
    expect(result.skippedRows).toBe(2);
    expect(result.skippedReasons).toHaveLength(2);
    expect(result.skippedReasons.map((r: SkippedReason) => r.reason)).toEqual([
      "missing symbol",
      expect.stringContaining("quantity"),
    ]);
  });

  it("parseWithMapping reports a reason per skipped row", () => {
    const csv = [
      "Symbol,Side,Qty,Price,Timestamp",
      "ES,buy,1,4500,2024-01-02T10:00:00Z",
      ",buy,1,4500,2024-01-02T10:00:00Z",
    ].join("\n");
    const result = parseWithMapping(csv, {
      symbol: "Symbol",
      side: "Side",
      quantity: "Qty",
      price: "Price",
      timestamp: "Timestamp",
    });
    expect(result.skippedRows).toBe(1);
    expect(result.skippedReasons).toHaveLength(1);
    expect(result.skippedReasons[0]!.reason).toBe("missing symbol");
  });

  it("parseHistory propagates reasons from adapters", () => {
    // MT5 format with a row missing entry/exit prices (empty strings) triggers skip.
    const csv = [
      "Time,Position,Symbol,Type,Volume,Price,S / L,T / P,Time,Price,Commission,Swap,Profit",
      "2026.01.05 09:00,1001,EURUSD,buy,0.1,1.1,1.09,1.13,2026.01.05 10:00,1.102,-2,0.5,20",
      "2026.01.05 09:00,1002,GBPJPY,sell,0.1,,1.09,1.13,2026.01.05 10:00,,-2,0.5,20",
    ].join("\n");
    const result = parseHistory(csv, {});
    expect(result?.skippedRows).toBeGreaterThanOrEqual(1);
    expect(result?.skippedReasons.length).toBe(result?.skippedRows ?? 0);
  });
});
