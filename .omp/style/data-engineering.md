# Data Engineering Style — trade-journal

## Trade Key Format

The trade key is the identity anchor for every position cycle. It is constructed in `packages/core/src/round-trips.ts` inside `finalizeCycle`:

```
{accountId}|{symbol}|{direction}|{openedAt}[|import:{encodedGroup}][|N]
```

```ts
// packages/core/src/round-trips.ts:97
const baseKey = `${accountId}|${symbol}|${cycle.direction}|${cycle.openedAt}${
  importGroup ? `|import:${encodeURIComponent(importGroup)}` : ""
}`;
const collision = keyCollisions.get(baseKey) ?? 0;
const tradeKey = collision > 0 ? `${baseKey}|${collision}` : baseKey;
```

**What goes in:** identity facts only — who, what, direction, when they opened. **What never goes in:** labels, tags, balances, notes, or any fact that can change during the life of the position. Adding non-identity fields to the key breaks P&L continuity on updates.

The collision suffix (`|N`) is added automatically when the same identity tuple reappears within the same import batch — this is an internal disambiguation, not a version number.

## Round-Trip Engine Invariants

These hold for every `buildRoundTrips` call. Each has a corresponding test in `packages/core/tests/`.

**1. Crossing-flat fills split into two trades.**

A fill that closes one position and opens the opposite direction in the same symbol at the same timestamp produces two distinct `RoundTrip` records: the closing side closes, the opening side starts a new cycle. The engine detects this via direction flip + zero net quantity crossing.

**2. Fee split pro-rata by quantity.**

When a single fill closes a partial position, fees are attributed proportionally: `(closedQty / totalQty) * fee`. The `consumeLots` function in `packages/core/src/round-trips.ts` computes this via the matched notional ratio.

```ts
// packages/core/src/round-trips.ts — consumeLots returns matched notional
const matchedNotional = consumeLots(cycle, quantity, method);
// fees are then split: matchedNotional / (price * quantity) * fee
```

**3. Total P&L is method-independent.**

`fifo`, `lifo`, and `wavg` (`ProfitCalcMethod` in `packages/core/src/types.ts`) all produce the same aggregate closed P&L across all trades. They differ only in *which entry lot* each partial exit is matched against. The aggregate sum must be identical; if a refactor breaks this equality, the test suite catches it.

## Edge Score Versioning

`EDGE_SCORE_VERSION = 2` in `packages/core/src/edge-score.ts` is the single source of truth for the composite score formula.

**Never silently change component weights or full-marks thresholds.** The docblock enumerates every component, its weight, and what "full marks" means:

```ts
// packages/core/src/edge-score.ts:11–25
/**
 * Components and full-marks thresholds:
 * - winRate:      60% win rate            (weight 15)
 * - profitFactor: 3.0                     (weight 25)
 * - avgWinLoss:   2.5 : 1                 (weight 20)
 * - drawdown:     0% of peak (linear to 25%+ = 0) (weight 15)
 * - recovery:     net P&L = 3× max drawdown (weight 10)
 * - consistency:  largest winning day ≤ 15% of total day profits (weight 15)
 */
```

Changing a weight or threshold **must** bump `EDGE_SCORE_VERSION` and update `docs/edge-score.md`. A silent change corrupts the historical score record.

## Importer Contract

`packages/importers/src/detect.ts` defines the routing contract:

```ts
// packages/importers/src/detect.ts:49–55
const route = (content: string, options: ImportOptions): Route | null => {
  const headers = parseCsv(content)[0] ?? [];
  const legacyFormat = LEGACY_FORMATS.find((candidate) => candidate.detect(headers, content));
  const legacy = legacyFormat ? legacyFormat.parse(content, options) : undefined;
  if (legacyFormat && legacy?.executions.length) return { format: legacyFormat, parsed: legacy };
  const history = parseHistory(content, options);
  if (history) return { format: historyFormat, parsed: history };
  if (legacyFormat && legacy) return { format: legacyFormat, parsed: legacy };
  return null; // ← null: offer the column mapper
};
```

**A file either matches a documented `ImportFormat` signature or it goes to the column mapper.** No guessing, no heuristic regex fallback that bypasses the documented signatures. The detection order is intentional: content-signature formats (multi-section/HTML) run first, then header-signature CSVs from most to least specific. `detectFormat` and `parseAuto` share the `route` decision so the user always sees the same format the parser used.

## Execution Uniqueness (`executionHash`)

`executionHash` is defined in `apps/web/src/server/ids.ts` (imported by `apps/web/src/server/executions.ts`) and is called during `insertExecutions`. It computes a hash on `(account_id, content_hash)` — the account scope prevents cross-account key collisions, and the content hash prevents duplicate fills from re-importing.

```ts
// apps/web/src/server/executions.ts — deduplication via executionHash
import { executionHash, newId, nowIso } from "./ids";
// Hash uniqueness is (account_id, content_hash) — never add timestamp or fee here
```

If you add fields to the hash input, the dedup logic silently changes and re-importing old files will produce duplicates or lost trades. Any hash-input change requires a migration script and a version bump in the import path.

## `importMetadata` Preservation

`ImportMetadata` (in `packages/core/src/types.ts`) is a provenance blob carried verbatim through the engine. It is stored in `executions.import_metadata_json` (additive `ALTER TABLE` in `apps/web/src/db/index.ts`) and is never stripped, rewritten, or "cleaned up" by analytics code.

```ts
// packages/core/src/types.ts:29–45 — fields carried through
export interface ImportMetadata {
  id: string;
  group?: string;          // keeps separately reported positions from netting
  order: number;
  reportedGrossPnl?: number;
  preserveFee?: boolean;   // source-supplied fee wins over account default
  ninjaTrader?: { sourceId, instrument, executionId?, effect?, sequence?, reportedFee? };
}
```

Analytics code that needs a field from `importMetadata` reads it directly. Analytics code must not erase or overwrite fields it doesn't understand — treat it as opaque bytes at the boundary.

## SQLite Configuration

`apps/web/src/db/index.ts` sets the canonical pragmas at connection time:

```ts
// apps/web/src/db/index.ts:14–15
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
```

- **WAL mode:** readers never block writers; always use this in production
- **Foreign keys:** enforced at the connection level, not per-query — never override with `PRAGMA foreign_keys = OFF`
- **Additive `ALTER TABLE` guards:** the connection transaction checks `pragma("table_info(...)")` before each `ALTER TABLE ADD COLUMN` so the upgrade is idempotent (re-run-safe on the same DB file)

The canonical DDL is `BOOTSTRAP_SQL` (in `apps/web/src/db/bootstrap.ts`). Any schema change must update `BOOTSTRAP_SQL` first; the runtime upgrade path is a separate migration concern.

## Timezone Correctness

IBKR syncs can produce mixed-timezone fills inside one account. The DB schema has `accounts.ibkr_sync_time_zone` (additive upgrade in `apps/web/src/db/index.ts:26–28`) and the app uses `assertIbkrSyncTimeZone` to block mixed-zone syncs at the boundary.

All day/month/hour keys for analytics use `Intl.DateTimeFormat` — never `Date.getHours()` or `new Date().getDay()` which drift across timezones. The helpers (`dayKeyOf`, `monthKeyOf`, `hourOf`) live in `packages/core/src/dates.ts` and must be used for all aggregation keys.

## Money Precision

If a calculation requires fractional cents or shows rounding drift in P&L reports, store the relevant column as **integer cents** in SQLite. The conversion to dollars happens at the display boundary only.

Any new float-money field (a new `price` or `fee` column, a calculation intermediate) **must** be documented with a `// ponytail:` comment naming the precision ceiling and the upgrade path to cents:

```ts
// ponytail: float fee, ceiling ±0.01 per fill — promote to cents column if drift surfaces
const fee = (price * quantity * rate) / 100;
```

## Test Examples

Real invariants are tested in `packages/core/tests/` — refer there for the canonical expected behavior of each edge case above before adding new logic.

---

## Checklist before PR

- [ ] Trade key format unchanged; no non-identity fields encoded into the key
- [ ] `buildRoundTrips` still produces identical P&L sum under fifo / lifo / wavg (run `packages/core/tests/round-trips.test.ts`)
- [ ] `EDGE_SCORE_VERSION` bumped if any weight or threshold changed; `docs/edge-score.md` updated
- [ ] New `ImportFormat` added to the correct position in the detection order in `packages/importers/src/detect.ts`; no heuristic bypass
- [ ] `executionHash` input unchanged; if a hash-input change is necessary, a migration script exists
- [ ] `importMetadata` fields are preserved verbatim through the engine (no stripping, no lossy coercion)
- [ ] SQLite pragma `foreign_keys = ON` is never disabled; additive `ALTER TABLE` guards in place before each column add
- [ ] New money fields documented with `// ponytail:` ceiling comment if stored as float
