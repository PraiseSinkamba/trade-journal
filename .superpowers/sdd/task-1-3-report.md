# Task 1.3 Report — Legacy Parser Skip Reasons

## Changes

### `ibkr.ts`
- **Skip site 1** (discriminator filter, line ~51): `row: null` — HTML table extraction from raw CSV rows has no stable index; null is correct.
  - Reason: `"row was not an Order fill (skipped discriminator)"`
- **Skip site 2** (missing fields, line ~72): `row: null` — same rationale.
  - Reason: `"missing symbol, side, quantity, price or timestamp"`
- **Early return** (no Trades section): also added `skippedReasons: []` to satisfy type.

### `metatrader.ts`
- **Skip site 1** (bad/missing fields, line ~67): `row: null` — HTML `<tr>` iteration over matched rows has no clean numeric index.
  - Reason: `"missing symbol, quantity, entry price, or open/close timestamps"`
- **Skip site 2** (missing exit price, line ~74): `row: null` — same.
  - Reason: `"missing exit price"`

### `tradezella.ts`
- **Skip site** (line ~85): `row: i + 2` — `records` is a CSV array with a header row, so 1-based data row = `i + 2`.
  - Reasons cascade:
    - `!symbol` → `"missing symbol"`
    - `!openedAt` → `"unparseable open timestamp"`
    - `!closedAt` → `"unparseable close timestamp"`
    - `quantity <= 0` → `"non-positive quantity"`
    - `!Number.isFinite(entryPrice)` → `"missing entry price"`
    - (fallback) `"missing exit price"`
- **Loop refactored**: `for (const row of records)` → `for (let i = 0; i < records.length; i++)` with `const row = records[i]!`.

### Bonus fix
`tradezella.ts` had pre-existing type errors on the `commissions` line where `|| 0` on a `string` result was narrowing to `string | 0` instead of `string | undefined`, making `parseMoney` reject it. Fixed with `?? ""`.

## Typecheck (importers package)

```
src/formats/history.ts(271,3): error TS2741: Property 'skippedReasons' is missing…
src/formats/history.ts(286,5): error TS2322: …not assignable to type 'ParsedImport'.
```
- `ibkr.ts` ✅
- `metatrader.ts` ✅
- `tradezella.ts` ✅
- `history.ts` two errors — owned by Task 1.4, not this slice.

## Commit
```
8497a92 feat(importers): emit per-row reasons from legacy format parsers
```

## Concerns
None.
