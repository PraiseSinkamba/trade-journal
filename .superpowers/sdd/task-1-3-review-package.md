# Task 1.3 Review Package

## Commit
- Range: `f0c08a6..8497a92`
- Subject: `feat(importers): emit per-row reasons from legacy format parsers`
- Stat: 3 files, +30/-6

## Files

- `packages/importers/src/formats/ibkr.ts` — both skip sites push reasons; `row: null` for both (HTML table extraction has no stable index).
- `packages/importers/src/formats/metatrader.ts` — both skip sites push reasons; `row: null` (same rationale).
- `packages/importers/src/formats/tradezella.ts` — single skip site uses cascading reasons; `row: i + 2`; loop refactored to track index.

## Sample diff (tradezella.ts)

```ts
for (let i = 0; i < records.length; i++) {
  const row = records[i]!;
  ...
  if (... condition ...) {
    skippedRows++;
    const reason = !symbol
      ? "missing symbol"
      : !openedAt ? "unparseable open timestamp"
      : !closedAt ? "unparseable close timestamp"
      : quantity <= 0 ? "non-positive quantity"
      : !Number.isFinite(entryPrice) ? "missing entry price"
      : "missing exit price";
    skippedReasons.push({ row: i + 2, reason });
  }
}
```

## Implementer report path

`.superpowers/sdd/task-1-3-report.md`

## Bonus fix (NOT in plan)

`tradezella.ts` had pre-existing type errors on the `commissions` line. The implementer added a `?? ""` fix to make it compile. This is a side-fix to unblock compilation, not a plan change.

## Expected typecheck state

- Clean: ibkr.ts, metatrader.ts, tradezella.ts
- Failing (Task 1.4): history.ts (×2)

## Global constraints

- `packages/importers` purity. ✓
- No new dependencies. ✓
- Human-facing reason strings only. ✓