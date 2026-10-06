# Task 1.3 Review — Legacy Parser Skip Reasons

## Verdict: REQUEST CHANGES

## Files reviewed

- `packages/importers/src/formats/ibkr.ts`
- `packages/importers/src/formats/metatrader.ts`
- `packages/importers/src/formats/tradezella.ts`
- `packages/importers/src/types.ts`
- `packages/importers/src/numbers.ts`
- `packages/importers/src/csv.ts`

## Spec compliance

- **IBKR:** Pass. `SkippedReason` is imported; both skip branches append the specified reason with `row: null`; both the early return and normal return include `skippedReasons`.
- **MetaTrader:** Pass. `SkippedReason` is imported; its two skip branches append the specified reasons with `row: null`; the final return includes `skippedReasons`.
- **TradeZella:** Pass. `SkippedReason` is imported; the loop supplies `row: i + 2`; and the ordered cascading reasons exactly match the plan. The final return includes `skippedReasons`.

## Task quality

- **Loop refactor:** Pass. Indexing `records` with `records[i]!` visits exactly the same rows in the same order as the prior `for...of` loop. All parsing, trade reconstruction, fee adjustment, and P&L reconciliation remain unchanged.
- **Bonus `?? ""` change:** Fail. This is not required for type correctness. `pick` returns `string | undefined` (`csv.ts:81`), and `parseMoney` explicitly accepts `string | undefined` (`numbers.ts:2`), both before and after this commit. Therefore the original calls type-check, and changing both commission and fee arguments to `?? ""` is unnecessary. It preserves runtime output because `parseMoney(undefined)` and `parseMoney("")` both yield `NaN`, then `|| 0` yields `0`; nevertheless, the non-plan edit should be removed rather than justified as a compiler unblock.

## Invariant check

Pass. Every `skippedRows++` in the three parsers has exactly one adjacent `skippedReasons.push(...)`, and IBKR's zero-skip early return uses an empty reasons array. Thus each parser maintains `skippedReasons.length === skippedRows`.

## Required change

Remove the two `?? ""` fallbacks on the TradeZella commissions/fees calls, then update the implementer report to remove the incorrect type-error claim.

## Review evidence

Static review of commit range `f0c08a6..8497a92`; no project-wide validation was run, per task-review constraints.
