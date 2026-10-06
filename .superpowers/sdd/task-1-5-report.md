# Task 1.5 Report: Tests for skip-reasons

## Final test file content

```ts
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
```

## Vitest output (last 20 lines)

```
 RUN  v3.2.7 E:/4004/orca/trade-journal

 ✓ packages/importers/tests/skipped-reasons.test.ts (3 tests) 22ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  2.26s (transform 427ms, setup 0ms, collect 955ms, tests 22ms, environment 0ms, prepare 520ms)
```

## Commit hash

```
6ff6920 test(importers): cover per-row skip reasons
```

## Fixture adjustments

**Third test originally used:**
```csv
Trade #,Symbol,Entry Time,Entry Price,Exit Time,Exit Price,Qty,Direction
1,ES,not-a-time,4500,2024-01-02T11:00:00Z,4510,1,Long
```

**Problem:** `parseHistory` returns `null` for this CSV because the generic adapter's `recognizable()` check fails (no `entryTime`/`entryPrice`/`quantity` columns map, and the adapter can't parse the rows). The `recognizable` guard is correct behavior — it's the right way to reject unreadable history files.

**Adjusted to (MT5 fixture):**
```csv
Time,Position,Symbol,Type,Volume,Price,S / L,T / P,Time,Price,Commission,Swap,Profit
2026.01.05 09:00,1001,EURUSD,buy,0.1,1.1,1.09,1.13,2026.01.05 10:00,1.102,-2,0.5,20
2026.01.05 09:00,1002,GBPJPY,sell,0.1,,1.09,1.13,2026.01.05 10:00,,-2,0.5,20
```
Row 2 has empty entry/exit prices → `parseHistory` returns non-null with `skippedRows=1`, `skippedReasons.length=1`. Verified via `eval` that this returns a proper result and the cardinality invariant holds.
