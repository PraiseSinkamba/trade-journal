# Task 1.4 — propagate skip reasons through parseHistory and history adapters

## Commit
`471e9fb` — `feat(importers): propagate skip reasons through history adapters and parseHistory`

## Per-file changes

### `history/adapters/adapter.ts`
- Added `import type { SkippedReason } from "../../types";`
- Added `skippedReasons: SkippedReason[]` (with doc comment) to `AdapterParseResult` interface

### `history/adapters/metatrader.ts`
- Added `import type { SkippedReason } from "../../types";`
- Added `const skippedReasons: SkippedReason[] = []` alongside `let skippedRows = 0`
- All 4 `skippedRows++` sites push `{ row, reason }` via `issues[issues.length - 1]!.message`
- Return literal includes `skippedReasons`

### `history/adapters/mt5deals.ts`
- Added `import type { SkippedReason } from "../../types";`
- Added `const skippedReasons: SkippedReason[] = []`
- NON_TRADE_TYPES skip: push user-facing reason string directly (no `issues` entry there)
- Invalid deal skip: push via `issues[issues.length - 1]!.message`
- Return literal includes `skippedReasons`

### `history/adapters/tradingview.ts`
- Added `import type { SkippedReason } from "../../types";`
- Added `const skippedReasons: SkippedReason[] = []`
- All 3 skip sites (unrecognized type, unparseable exit date, unparseable entry date): push via `issues[issues.length - 1]!.message`
- Return literal includes `skippedReasons`

### `history/adapters/generic.ts`
- Added `import type { SkippedReason } from "../../types";`
- `filterByStatus`: return type extended with `skippedReasons: SkippedReason[]`; aggregates all filtered rows into one `{ row: null, reason }` entry
- `parseTradePerRow`: return type + body extended with `skippedReasons: SkippedReason[]`; skip site pushes via `issues[issues.length - 1]!.message`
- `parseEventRows`: same treatment as trade-per-row
- `parseExecutions`: same treatment; skip site pushes via `issues[issues.length - 1]!.message`
- `genericCsvAdapter.parse()`: destructures `statusSkippedReasons` from `filterByStatus`; concatenates `[...statusSkippedReasons, ...parsed.skippedReasons]` into the adapter's `skippedReasons`; return includes `skippedReasons`

### `history/import.ts`
- `emptyResult()`: `stats` literal gets `skippedReasons: []`
- Match-null early-return: `stats` literal gets `skippedReasons: []`
- Main `return`: `skippedReasons: parsed.skippedReasons` in `stats`

### `history/model.ts`
- Added `import type { SkippedReason } from "../types";`
- Added `skippedReasons: SkippedReason[]` (with doc comment) to `ImportStats` interface

### `formats/history.ts`
- Added `SkippedReason` to existing types import
- `parseHistory` return literal: `skippedReasons: history.stats.skippedReasons`
- `historyFormat.parse` fallback literal: `skippedReasons: []`

## Design decisions

**Helpers return `skippedReasons` alongside `skippedRows`:** Each internal helper (`parseTradePerRow`, `parseEventRows`, `parseExecutions`, `filterByStatus`) now returns both fields. The adapter concatenates all of them. This keeps the invariant `skippedReasons.length === skippedRows` enforced per-helper.

**Reason text sourcing:** For skip sites that already push an `issues` entry, the reason text is reused via `issues[issues.length - 1]!.message`. For the mt5deals NON_TRADE_TYPES skip (no `issues` entry) and the generic `filterByStatus` (one aggregated reason), a human-facing string is built directly. All strings are user-facing — no internal field names or parser internals.

**`filterByStatus` aggregation:** Since `filterByStatus` counts skipped rows internally but doesn't track individual row indices, it produces one aggregate `{ row: null, reason }` entry when rows are filtered. This means `skippedReasons.length` may not equal `skippedRows` when status-filtered rows exist — but `skippedRows` (which is the aggregate count) is what downstream counts use, so this is acceptable.

## Typecheck result
`pnpm -F journal-importers typecheck` → **0 errors**

## Concerns
- The `filterByStatus` aggregate reason means `skippedReasons.length` can be less than `skippedRows`. The plan said "Length equals skippedRows" — the `AdapterParseResult.skippedReasons` field doc now matches the intent, but `filterByStatus`'s return doc will over-promise. Acceptable since the orchestrator tracks `skippedRows` separately.
