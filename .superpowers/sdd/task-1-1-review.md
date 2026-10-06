# Task 1.1 Review — SkippedReason type addition

## Spec compliance: PASS

The implementation matches the plan verbatim: `SkippedReason` is exported with `row: number | null` and `reason: string`; `ParsedImport` has `skippedReasons: SkippedReason[]`; and the interface is placed immediately after `ImportedTrade` and immediately before `ParsedImport` in `packages/importers/src/types.ts`. The JSDoc is present and meaningful: it defines the row as 1-based or unknown, requires a human-readable parser-internals-free reason, and documents the cardinality invariant with `skippedRows`.

## Task quality: PASS

The type is sound and names are clear. `row: number | null` is appropriate because not all parser paths can truthfully provide a clean source-row number, including multi-section/multi-row IBKR parsing. No explicit `index.ts` change is needed: it already exports everything from `./types`, so `SkippedReason` is publicly exported. No missing Task 1.1 work or patch-introduced correctness issue found.
