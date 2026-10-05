# Pepperstone cTrader Import Format — Design

**Date:** 2026-10-05
**Status:** Approved (brainstorming), pending implementation
**Scope:** Single-file format parser + tests + detection + docs cleanup

## Problem

Pepperstone cTrader "Order History" CSV exports (e.g.
`order_history_live_1062789_2026-09-30.csv`) are not recognised by any
existing parser in `packages/importers`. The user must fall through to the
manual column mapper. The same shape was previously misidentified as
TradeZella (see `docs/MISTAKES.md`, entry "Pepperstone MT5 deals CSV
auto-detected as TradeZella"), which produced 0 executions and a wall of
"row skipped" warnings.

The data is rich enough to be a first-class format: one CSV row per
deal/fill, with explicit swap + commission columns, position linkage via
`position_id`, and an asset class that is inferrable from the symbol.

## Goals

1. **Auto-detect** Pepperstone cTrader order-history exports without
   manual mapping.
2. **Preserve fill-level granularity**: one execution per deal row.
   Partial closes, stop-outs, and stop-out-then-manual sequences stay
   visible instead of being collapsed into an average.
3. **Preserve every datum the journal can hold**: side, quantity, price,
   fees (swap + commission), asset class, source position, and broker
   order ID for dedup.
4. **Zero UI changes**: register the format in the existing
   `LEGACY_FORMATS` array. The import page surfaces it automatically via
   `/api/import` GET.

## Non-goals

- Live broker connectivity (cTrader Open API). `@luxalgo/broker-sdk`
  owns that path; this spec covers file import only.
- Round-trip P&L reconciliation against `gross_profit` / `net_profit`.
  The CSV reports per-deal `gross_profit` and `net_profit`; we persist
  the data on `importMetadata.reportedGrossPnl` so a future
  reconciliation screen can use it, but no UI work is in scope here.
- A "reconstruct average entry/exit" mode. The MT4/MT5 statement path
  already covers that case.
- New `importMetadata` schema fields. Reuse existing `id`, `group`,
  `order`, `reportedGrossPnl`, `preserveFee`.

## Format shape (the CSV)

Header (28 columns, exact order from the sample):

```
symbol,side,quantity,price,data,trade_id,position_id,order_id,deal_kind,
deal_type,volume_units,volume_lots,direction,pips,gross_profit,net_profit,
swap,commission,close_price,open_time,close_time,execution_price,label,
comment,account_login,account_id,broker,currency
```

Per-row facts that matter to the parser:

- `data` — ISO 8601 timestamp of the deal fill. **This is the
  `executedAt` of the execution.** The `trade_id` column is empty in
  every sample row (cTrader quirk); we never read it.
- `side` — `Buy` or `Sell`. Also carried by `direction`.
- `quantity` — units; mirrors `volume_units`. `volume_lots` is a
  derived display value.
- `price` — execution price (mirrors `execution_price`, `close_price`
  for closes).
- `swap` and `commission` — both signed. Fee per execution is
  `|swap| + |commission|`.
- `position_id` — links deals to the position they belong to. Used as
  `importMetadata.group` so multi-deal positions stay paired and don't
  net with other positions.
- `order_id` — broker order ID. Used as `importMetadata.id` for dedup;
  falls back to `position_id||"-"||data` when blank (rare but possible
  on a manual-after-stop).
- `deal_kind` — observed values: `close_full`, `close_partial`,
  `close_final`, `stop_out`, `manual_after_stop`. All five are imported.
  Unknown future values trigger a single warning but are still
  imported.
- `symbol` — one of `AUDUSD`, `CHFJPY`, `EURGBP`, `GBPUSD`, `USDJPY`,
  `XAUUSD`, `NAS100`, `US30` in the sample. Map to `forex` or `cfd`
  via the table below.
- `broker` — `Pepperstone`. Not a detection key on its own (other
  Pepperstone exports exist), but used to tighten detection.
- `open_time`, `close_time` — present for the position as a whole, not
  the deal. Persisted on `importMetadata` only if we later add fields
  for it; not in scope here.

## Module design

New file: `packages/importers/src/formats/pepperstone.ts`.

```ts
export const pepperstone: ImportFormat = {
  id: "pepperstone",
  label: "Pepperstone (cTrader order history export)",
  detect: (headers) =>
    hasHeaders(headers, [
      ["position_id"],
      ["deal_kind"],
      ["execution_price"],
      ["broker"],
    ]),
  parse: (content, options) => { /* see "Parsing algorithm" */ },
};

export const SYMBOL_CLASSES: Record<string, AssetClass> = { /* table */ };
export const KNOWN_DEAL_KINDS: ReadonlySet<string> = new Set([
  "close_full", "close_partial", "close_final",
  "stop_out", "manual_after_stop",
]);
```

Registered in `packages/importers/src/detect.ts` by adding
`pepperstone` to the `LEGACY_FORMATS` array, positioned after
`ninjatrader` (the closest precedent: a fill-level CSV with fees and
group linkage).

## Parsing algorithm

For each CSV record (parsed via `parseCsv` + `toRecords`):

1. Read `position_id`, `order_id`, `symbol`, `side`, `quantity`,
   `price`, `data`, `deal_kind`, `swap`, `commission`, `broker`.
2. Parse side via the shared `parseSide` from `fills.ts` — handles
   `Buy`/`Sell` (and the case variants Pepperstone could change to).
3. Parse `quantity` via `parseQuantity`; reject if non-finite or ≤ 0.
4. Parse `price` via `parseMoney`; reject if non-finite.
5. Parse `data` via `parseTimestamp` with `options.timeZone`; reject
   if null.
6. Compute `fee = |swap| + |commission|` (both passed through
   `parseMoney`; non-finite components treated as 0, matching the
   existing `rowsToFills` fee-summing convention).
7. Resolve `assetClass` from `SYMBOL_CLASSES[symbol.toUpperCase()]`;
   on miss, fall back: any digit in the symbol → `cfd`; exactly six
   uppercase letters → `forex`; else `other`.
8. Collect `unknownDealKinds` (any value not in `KNOWN_DEAL_KINDS`).
9. Emit:

   ```ts
   {
     symbol, side, quantity, price, fee, executedAt, assetClass,
     importMetadata: {
       id: order_id || `${position_id}-${executedAt}`,
       group: position_id,
       order: rowIndex,
       reportedGrossPnl: parseMoney(gross_profit),
       preserveFee: true,
     },
   }
   ```

10. If `unknownDealKinds.size > 0` after the loop, push a single
    warning: `"Unrecognised deal_kind values encountered: {…}. Imported
    anyway; verify if your Pepperstone export format changed."`

Skipped rows use the existing `skippedReasons.push({ row, reason })`
shape with the same reason vocabulary as `rowsToFills`
("missing symbol", "unrecognised side value", "unparseable
timestamp", "non-positive quantity", "non-positive price").

## Symbol class table

| Symbol | Class |
| --- | --- |
| `AUDUSD`, `CHFJPY`, `EURGBP`, `GBPUSD`, `USDJPY` | `forex` |
| `XAUUSD`, `XAGUSD`, `UKOUSD`, `USOUSD` | `cfd` |
| `NAS100`, `US30`, `SPX500`, `GER40`, `JPN225`, `UK100` | `cfd` |

The table is exported so a future caller (e.g. an `import review` UI
or settings page) can extend it without editing this file.

## Error handling

- A row that fails any of symbol / side / quantity / price / timestamp
  validation is skipped via `skippedReasons`. No silent drops.
- Unknown `deal_kind` values are imported with a single warning (see
  step 10 above), not skipped. Goal: forward-compatibility if
  Pepperstone adds new deal kinds.
- Missing `order_id` is recoverable: `importMetadata.id` falls
  back to `${position_id}-${executedAt}`. If `position_id` is also
  blank the row is rejected with reason "missing symbol" — a row
  with no `position_id` is almost certainly not a real deal row
  (the same row would already have failed other validations in
  practice).
- Non-numeric `swap` / `commission` are treated as 0; the
  `preserveFee: true` flag tells downstream layers that the value is
  intentionally 0 rather than unknown.

## Testing

New file: `packages/importers/tests/pepperstone.test.ts`.

Fixture: `packages/importers/tests/fixtures/pepperstone-ctrader.csv` —
5-10 rows extracted from the sample, scrubbed of `account_login` /
`account_id` / `comment` / `label` personal data, but preserving one
multi-deal position (a `close_partial` + `close_final` pair on
`NAS100`) and one stop-out sequence (`stop_out` + `manual_after_stop`
on `NAS100`) so the position-grouping and warning paths are
exercised.

Tests:

1. **Detection**: `parseAuto(fixture, {})` returns
   `parsed.format === "pepperstone"`.
2. **Row count and content**: every fixture row produces one
   execution; `side` / `quantity` / `price` / `executedAt` / `fee`
   match the source values; the fixture's `gross_profit` matches
   `importMetadata.reportedGrossPnl`.
3. **Asset class**: assert `forex` for `AUDUSD`, `cfd` for `XAUUSD`
   and `NAS100`, and the fallback `cfd` for a synthetic `TEST100`
   row.
4. **Group linkage**: a multi-deal `NAS100` position yields two
   executions with the same `importMetadata.group` value (the
   `position_id`); a different `NAS100` row with a different
   `position_id` has a different `group`.
5. **Fees**: a row with both `swap` and `commission` non-zero yields
   `fee === |swap| + |commission|`.
6. **Unknown deal_kind warning**: a synthetic row with
   `deal_kind = "weird_future_kind"` produces a warning listing that
   value but is still imported.
7. **Negative detection**: a minimal IBKR-shaped CSV (the "Trades,
   Header" sentinel) still routes to `ibkr`, not to `pepperstone`.
8. **Skipped row reporting**: a synthetic row with a missing `side`
   value pushes a `skippedReasons` entry with the expected reason.

## Documentation changes

- `docs/MISTAKES.md`: remove the entry "Pepperstone MT5 deals CSV
  auto-detected as TradeZella" — that misidentification is fixed by
  this change. The note is no longer actionable.
- New file `docs/import-formats.md`: a one-paragraph pointer
  catalogue listing every registered broker format and where its
  parser lives. Keeps the `docs/MISTAKES.md` "auto-detected as X"
  class of issues from reappearing without anyone noticing.

## Acceptance criteria

- [ ] `pnpm --filter @luxalgo/journal-importers test` passes with
      the new test file.
- [ ] `pnpm typecheck` passes.
- [ ] Uploading the user's
      `order_history_live_1062789_2026-09-30.csv` to the import page
      auto-selects the Pepperstone format, previews > 100
      executions, and shows zero skipped rows.
- [ ] After commit, the trade view shows the NAS100 partial-close
      and stop-out positions with the same entry/exit prices and
      approximate P&L the broker reports.
- [ ] Re-uploading the same file is a no-op (existing
      `executionHash` dedup; no duplicate executions).
- [ ] `docs/MISTAKES.md` no longer contains the Pepperstone /
      TradeZella entry.
- [ ] `docs/import-formats.md` exists and lists the new format.

## Risks

- **Detection signature overlap with another format.** The four-key
  signature `position_id` + `deal_kind` + `execution_price` + `broker`
  is specific to Pepperstone cTrader; no other registered format
  uses these column names. If a future format does, the
  `LEGACY_FORMATS` ordering means we'd need to put the more specific
  one first. Detected during test 7.
- **Asset class fallback misclassification.** The fallback guesses
  `cfd` for symbols with digits, which would misclassify crypto
  pairs like `BTCUSD` (Pepperstone does not currently list crypto on
  cTrader, but may in future). Acceptable for v1; the table is
  extensible without code changes via the exported constant.
- **Future `deal_kind` values.** We import unknown kinds with a
  warning rather than dropping them. If a new kind has a different
  fee semantics (e.g. an explicit `balance` kind with no
  position context), the warning will surface the change. Verified
  by test 6.
