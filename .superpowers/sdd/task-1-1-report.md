# Task 1.1 Report — Add `SkippedReason` to `ParsedImport`

## Files modified

- `packages/importers/src/types.ts`

## `SkippedReason` interface and `ParsedImport.skippedReasons` field

```ts
export interface SkippedReason {
  /** 1-based row number in the parsed file, or null when the row index is unknown. */
  row: number | null;
  /** Human-readable, parser-internals-free explanation. */
  reason: string;
}

export interface ParsedImport {
  format: string;
  executions: ImportedExecution[];
  /** Rows the parser saw but could not turn into executions. */
  skippedRows: number;
  /** Per-row reasons the parser dropped a row. Length equals skippedRows. */
  skippedReasons: SkippedReason[];
  warnings: string[];
  ...
}
```

## Typecheck result for the importers package

```
pnpm -F journal-importers typecheck
```

**Expected failures** in OTHER files (to be fixed in Tasks 1.2–1.4):
- `fills.ts:110` — `skippedReasons` missing in return literal
- `generic.ts:42` — same
- `history.ts:271,286` — same
- `ibkr.ts:31,84` — same
- `metatrader.ts:90` — same
- `ninjatrader.ts:26` — same
- `thinkorswim.ts:18,69` — same
- `tradezella.ts:102` — same

`types.ts` itself compiles cleanly.

## Commit hash

```
5a1f0c7 feat(importers): surface per-row skip reasons on ParsedImport
```

## Concerns

None.
