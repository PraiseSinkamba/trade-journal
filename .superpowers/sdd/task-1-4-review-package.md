# Task 1.4 Review Package

## Commit
- Range: `8497a92..471e9fb`
- Subject: `feat(importers): propagate skip reasons through history adapters and parseHistory`
- Stat: 8 files, +55/-11

## Files

- `packages/importers/src/history/adapters/adapter.ts` — added `skippedReasons` to `AdapterParseResult`.
- `packages/importers/src/history/adapters/metatrader.ts` — pushed reasons at 4 sites.
- `packages/importers/src/history/adapters/mt5deals.ts` — pushed reasons at 2 sites.
- `packages/importers/src/history/adapters/tradingview.ts` — pushed reasons at 3 sites.
- `packages/importers/src/history/adapters/generic.ts` — refactored 4 helpers to also return `skippedReasons`.
- `packages/importers/src/history/import.ts` — added `skippedReasons` to stats literals.
- `packages/importers/src/history/model.ts` — added field to `ImportStats`.
- `packages/importers/src/formats/history.ts` — propagated from stats into final return.

## Important concern flagged by implementer

`filterByStatus` in generic.ts pushes ONE aggregate reason for N filtered rows (since it doesn't track individual row indices). Result: when status-filtered rows exist, `skippedReasons.length < skippedRows`. The `AdapterParseResult.skippedReasons` JSDoc says length equals skippedRows (inherited from `ParsedImport.skippedReasons`).

The UI side: import/page.tsx renders the disclosure as "N rows skipped — M detailed". When M=1 and N=12, the user sees an honest "12 rows skipped, 1 detailed (non-filled status...)". 

## Implementer report path

`.superpowers/sdd/task-1-4-report.md`

## Typecheck state

`pnpm -F journal-importers typecheck` → **0 errors** ✓

## Global constraints

- `packages/importers` purity. ✓
- No new dependencies. ✓
- Human-facing reason strings. ✓