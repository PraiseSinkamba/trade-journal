# Task 1.2 Report — rowsToFills skip reasons

## Files modified

- `packages/importers/src/formats/fills.ts`
- `packages/importers/src/formats/generic.ts`
- `packages/importers/src/formats/ninjatrader.ts`
- `packages/importers/src/formats/thinkorswim.ts`

## Final `rowsToFills` signature

```ts
export const rowsToFills = (
  records: Row[],
  columns: FillsColumnMap,
  options: ImportOptions,
  spec: Pick<FillsFormatSpec, "rowFilter" | "normalizeSymbol"> = {},
): { executions: ImportedExecution[]; skippedRows: number; skippedReasons: SkippedReason[] } => {
```

Key changes:
- Refactored `for (const row of records)` → `for (let i = 0; i < records.length; i++)` to capture 1-based row index
- `skippedReasons` array accumulates `{ row: i + 2, reason: string }` entries
- Reasons: "row did not match the format filter", "missing symbol", "unrecognised side value", "unparseable timestamp", "non-positive quantity", "non-positive price"
- Also fixed `makeFillsFormat` (which uses `rowsToFills`) to propagate `skippedReasons`

## Consumer diffs

**generic.ts** — destructure and forward:
```diff
- const { executions, skippedRows } = rowsToFills(...)
+ const { executions, skippedRows, skippedReasons } = rowsToFills(...)
- return { format: "generic", executions, skippedRows, warnings: [] };
+ return { format: "generic", executions, skippedRows, skippedReasons, warnings: [] };
```

**ninjatrader.ts** — accumulate in local array, push to return:
```diff
+ const skippedReasons: SkippedReason[] = [];
  ...
  skippedRows += parsed.skippedRows;
+ skippedReasons.push(...parsed.skippedReasons);
  ...
  return { format: "ninjatrader", executions, skippedRows, skippedReasons, warnings, errors: [...errors] };
```

**thinkorswim.ts** — destructure and forward + early-return fix:
```diff
- const { executions, skippedRows } = rowsToFills(...)
+ const { executions, skippedRows, skippedReasons } = rowsToFills(...)
- return { format: "thinkorswim", executions, skippedRows, warnings };
+ return { format: "thinkorswim", executions, skippedRows, skippedReasons, warnings };
+ // early return also added skippedReasons: []
```

## Typecheck result

Expected failures remain in unfilled files (Tasks 1.3+):
- `history.ts` — 2 errors
- `ibkr.ts` — 2 errors
- `metatrader.ts` — 1 error
- `thinkorswim.ts` — 1 error (early return, now fixed)
- `tradezella.ts` — 1 error

Clean: `fills.ts`, `generic.ts`, `ninjatrader.ts`.

## Commit

`2538e6b` — feat(importers): propagate skip reasons through rowsToFills consumers

## Concerns

None — plan followed exactly. `thinkorswim.ts` early-return path required `skippedReasons: []` to satisfy the type; this is correct behavior (no rows were parsed so no rows were skipped).
