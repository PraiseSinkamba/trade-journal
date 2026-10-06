# Task 1.4 Fix Report — parseHistory skippedReasons at 4 sites

## Changes made to `packages/importers/src/formats/history.ts`

### Site A — fill-validation skip (line ~115)

```diff
- skippedRows++;
- continue;
+ skippedRows++;
+ if (!symbol) {
+   skippedReasons.push({ row: fill.row, reason: "missing symbol" });
+ } else if (fill.time === null || !Number.isFinite(fill.time)) {
+   skippedReasons.push({ row: fill.row, reason: "unparseable timestamp" });
+ } else if (!(fill.quantity > 0) || !Number.isFinite(fill.quantity)) {
+   skippedReasons.push({ row: fill.row, reason: "non-positive quantity" });
+ } else {
+   skippedReasons.push({ row: fill.row, reason: "non-positive price" });
+ }
+ continue;
```

### Site B — opposite-position skip (line ~143)

```diff
- skippedRows++;
- warnings.push(
-   `Line ${fill.row}: the deal has no matching position in this file; skipped.`,
- );
- continue;
+ skippedRows++;
+ skippedReasons.push({ row: fill.row, reason: "no matching position in this file" });
+ warnings.push(
+   `Line ${fill.row}: the deal has no matching position in this file; skipped.`,
+ );
+ continue;
```

### Site C — invalid reconstructed trade skip (line ~214)

```diff
- skippedRows += trade.sourceRows.length;
- continue;
+ skippedRows += trade.sourceRows.length;
+ let reason = "missing or invalid trade data";
+ if (!symbol) reason = "missing symbol";
+ else if (!trade.direction) reason = "missing trade direction";
+ else if (trade.entryTime === null || !Number.isFinite(trade.entryTime))
+   reason = "missing or invalid entry time";
+ else if (trade.exitTime === null || !Number.isFinite(trade.exitTime) || trade.exitTime < trade.entryTime)
+   reason = "missing or invalid exit time";
+ else if (trade.entryPrice === null || !Number.isFinite(trade.entryPrice))
+   reason = "missing entry price";
+ else if (trade.exitPrice === null || !Number.isFinite(trade.exitPrice))
+   reason = "missing exit price";
+ else if (trade.quantity === null || !(trade.quantity > 0) || !Number.isFinite(trade.quantity))
+   reason = "missing or non-positive quantity";
+ for (const row of trade.sourceRows) {
+   skippedReasons.push({ row, reason });
+ }
+ continue;
```

### Site D — open positions skip (line ~286)

```diff
  if (history.openTrades.length) {
    skippedRows += history.openTrades.reduce((sum, trade) => sum + trade.sourceRows.length, 0);
+   for (const trade of history.openTrades) {
+     for (const row of trade.sourceRows) {
+       skippedReasons.push({ row, reason: "incomplete position (no matching exit)" });
+     }
+   }
    warnings.push(
      `${history.openTrades.length} incomplete position(s) skipped; this history export requires completed entry/exit pairs.`,
    );
  }
```

### New accumulator declaration (line ~91)

```diff
  let skippedRows = history.stats.skippedRows;
+ const skippedReasons: SkippedReason[] = [];
  const occurrences = new Map<string, number>();
```

### Return literal (line ~307)

```diff
- skippedReasons: history.stats.skippedReasons,
+ skippedReasons: [...history.stats.skippedReasons, ...skippedReasons],
```

## Typecheck result

```
npx tsc --noEmit -p packages/importers/tsconfig.json → 0 errors (4.84s)
```

## Commit

```
1b9f6e0 fix(importers): track skippedReasons at all four parseHistory skip sites
```
