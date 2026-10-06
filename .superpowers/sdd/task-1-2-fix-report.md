# Task 1.2 Fix Report — ninjatrader invalid-commission skip reason

## Diff

```diff
-    for (const row of toRecords(parseCsv(content))) {
+    const records = toRecords(parseCsv(content));
+    for (let i = 0; i < records.length; i++) {
+      const row = records[i]!;
       const commission = pick(row, ["commission"]);
       if (commission !== undefined && ... ) {
         errors.add("An execution has an invalid commission ...");
         skippedRows++;
+        skippedReasons.push({ row: i + 2, reason: "invalid commission value" });
         continue;
       }
```

Row number is `i + 2` (1-based, accounting for the CSV header at line 1).

## Typecheck

`packages/importers/src/formats/ninjatrader.ts`: **0 errors** ✓

Pre-existing diagnostics in unfilled files (unchanged from Task 1.2 baseline):
- `history.ts` — TS2741 + TS2322
- `ibkr.ts` — TS2741 (×2)
- `metatrader.ts` — TS2741
- `tradezella.ts` — TS2741

## Commit

```
f0c08a676705a55ec339646a4e9da604d5f40359
```
