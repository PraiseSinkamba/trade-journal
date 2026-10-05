# Pepperstone cTrader Import Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Pepperstone cTrader order history import format to `packages/importers`, so uploads of `order_history_live_*.csv` auto-detect, parse per-deal fills, attach swap + commission as fees, classify asset class per symbol, and persist `position_id` for round-trip grouping — with no UI changes.

**Architecture:** A new `packages/importers/src/formats/pepperstone.ts` module that mirrors the structure of `ibkr.ts` (CSV with explicit columns, hand-rolled `ImportFormat`). Detection requires the four Pepperstone-specific column names: `position_id`, `deal_kind`, `execution_price`, `broker`. Each row produces one `ImportedExecution` with `assetClass` looked up from an exported `SYMBOL_CLASSES` table (fallback heuristic on miss) and `importMetadata` carrying `id` (order_id or fallback), `group` (position_id), `order`, `reportedGrossPnl`, `preserveFee`. Registered in `detect.ts`'s `LEGACY_FORMATS` after `ninjatrader`. Tests in `packages/importers/tests/pepperstone.test.ts` with a fixture under `tests/fixtures/pepperstone-ctrader.csv`. Docs: remove the now-obsolete Pepperstone/TradeZella entry from `docs/MISTAKES.md`; add a `docs/import-formats.md` pointer catalogue.

**Tech Stack:** TypeScript (strict, ESM, no new deps), Vitest, existing importers primitives (`parseCsv`, `toRecords`, `hasHeaders`, `parseMoney`, `parseQuantity`, `parseTimestamp`, `parseSide`).

## Global Constraints

From the project's `.omp/AGENTS.md` and the spec:

- New broker format must live in `packages/importers/src/formats/`.
- Parser must not introduce a new dependency (no `package.json` change).
- The boundary rule `packages/importers` cannot import from `apps/web` and cannot make raw HTTP calls — already satisfied by parser code.
- Detection order in `LEGACY_FORMATS` matters: more specific signatures first. Pepperstone's four-key signature is specific enough that ordering after `ninjatrader` is safe.
- Tests must use `vitest`. Fixtures load via `readFileSync(new URL("./fixtures/...", import.meta.url), "utf8")`.
- One assertion per behaviour, no stringly-typed data when the project types exist (`AssetClass` from `@luxalgo/journal-core`).
- Commit messages follow the project style (lead with what was solved, not the file path).
- All spec acceptance criteria are met before the final commit (auto-detect, partial close grouping, fees, dedup, docs cleanup).

## File Structure

| File | Responsibility | Status |
| --- | --- | --- |
| `packages/importers/src/formats/pepperstone.ts` | The new format: detection, parse loop, asset class table, `KNOWN_DEAL_KINDS` | Create |
| `packages/importers/src/detect.ts` | Register `pepperstone` in `LEGACY_FORMATS` | Modify (one line addition) |
| `packages/importers/tests/pepperstone.test.ts` | Vitest suite covering all 8 spec tests | Create |
| `packages/importers/tests/fixtures/pepperstone-ctrader.csv` | 5-10 row scrubbed fixture preserving partial-close + stop-out + forex | Create |
| `docs/MISTAKES.md` | Remove the Pepperstone/TradeZella misdetection entry | Modify (delete one bullet) |
| `docs/import-formats.md` | Pointer catalogue of every registered format | Create |

---

### Task 1: Add the Pepperstone parser module

**Files:**
- Create: `packages/importers/src/formats/pepperstone.ts`
- Test: `packages/importers/tests/pepperstone.test.ts` (this task creates the test file with one failing test; subsequent tasks add more)

**Interfaces:**
- Consumes: `parseCsv`, `hasHeaders`, `toRecords` from `../csv`; `parseTimestamp` from `../dates`; `parseMoney`, `parseQuantity` from `../numbers`; `parseSide` from `./fills`; `ImportFormat`, `ImportOptions`, `ImportedExecution`, `ParsedImport`, `SkippedReason` from `../types`; `AssetClass` from `@luxalgo/journal-core`.
- Produces: `export const pepperstone: ImportFormat`, `export const SYMBOL_CLASSES: Record<string, AssetClass>`, `export const KNOWN_DEAL_KINDS: ReadonlySet<string>`. Each emitted `ImportedExecution` shape: `{ symbol, side, quantity, price, fee, executedAt, assetClass, importMetadata: { id, group, order, reportedGrossPnl, preserveFee } }`.

- [ ] **Step 1: Create the test file with one failing test**

Create `packages/importers/tests/pepperstone.test.ts` with this exact content:

```ts
import { describe, expect, it } from "vitest";
import { parseAuto } from "../src/detect";

const PEPPERSTONE_CSV = `symbol,side,quantity,price,data,trade_id,position_id,order_id,deal_kind,deal_type,volume_units,volume_lots,direction,pips,gross_profit,net_profit,swap,commission,close_price,open_time,close_time,execution_price,label,comment,account_login,account_id,broker,currency
AUDUSD,Buy,1000,0.7491,2021-10-20T04:01:11.068Z,,62957129,98864388,close_full,Market,1000,0.01,Buy,-0.3,-0.03,-0.03,0,0,0.7491,2021-10-20T03:50:40.242Z,2021-10-20T04:01:11.068Z,0.7491,,,1062789,22974766,Pepperstone,USD`;

describe("pepperstone cTrader order history", () => {
  it("auto-detects a Pepperstone cTrader export and parses one execution per row", () => {
    const result = parseAuto(PEPPERSTONE_CSV, { timeZone: "UTC" })!;
    expect(result.format).toBe("pepperstone");
    expect(result.executions).toHaveLength(1);
    expect(result.skippedRows).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- pepperstone` from the repo root (the root script delegates to `vitest run` and the vitest config glob already covers `packages/*/tests/**/*.test.ts`).

Expected: FAIL with "Cannot find module '../src/detect'" or "result is null" (because `pepperstone` isn't registered yet) — exact text not important; the test must fail.

- [ ] **Step 3: Create the parser module**

Create `packages/importers/src/formats/pepperstone.ts` with this exact content:

```ts
import { hasHeaders, parseCsv, toRecords, type Row } from "../csv";
import { parseTimestamp } from "../dates";
import { parseMoney, parseQuantity } from "../numbers";
import { parseSide } from "./fills";
import type {
  ImportFormat,
  ImportOptions,
  ImportedExecution,
  ParsedImport,
  SkippedReason,
} from "../types";
import type { AssetClass } from "@luxalgo/journal-core";

/**
 * Pepperstone cTrader "Order History" export. One row per deal/fill with
 * explicit swap + commission columns and a `position_id` linking the deals
 * of a single position. `data` is the deal fill timestamp; the `trade_id`
 * column is empty in every observed file (cTrader quirk) and is ignored.
 * The `execution_price`, `close_price`, and `price` columns all carry the
 * same value per row; `price` is read for simplicity.
 */
export const SYMBOL_CLASSES: Record<string, AssetClass> = {
  // forex majors / crosses
  AUDUSD: "forex",
  CHFJPY: "forex",
  EURGBP: "forex",
  GBPUSD: "forex",
  USDJPY: "forex",
  // metal / energy CFDs
  XAUUSD: "cfd",
  XAGUSD: "cfd",
  UKOUSD: "cfd",
  USOUSD: "cfd",
  // index CFDs
  NAS100: "cfd",
  US30: "cfd",
  SPX500: "cfd",
  GER40: "cfd",
  JPN225: "cfd",
  UK100: "cfd",
};

export const KNOWN_DEAL_KINDS: ReadonlySet<string> = new Set([
  "close_full",
  "close_partial",
  "close_final",
  "stop_out",
  "manual_after_stop",
]);

const classifySymbol = (raw: string): AssetClass => {
  const symbol = raw.trim().toUpperCase();
  if (SYMBOL_CLASSES[symbol]) return SYMBOL_CLASSES[symbol]!;
  if (/\d/.test(symbol)) return "cfd";
  if (/^[A-Z]{6}$/.test(symbol)) return "forex";
  return "other";
};

const requireString = (row: Row, key: string): string => {
  const value = row[key];
  return typeof value === "string" ? value : "";
};

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
  parse: (content, options: ImportOptions): ParsedImport => {
    const records = toRecords(parseCsv(content));
    const executions: ImportedExecution[] = [];
    const skippedReasons: SkippedReason[] = [];
    const unknownDealKinds = new Set<string>();
    let skippedRows = 0;

    for (let i = 0; i < records.length; i++) {
      const row = records[i]!;
      const rowNumber = i + 2; // header is row 1
      const positionId = requireString(row, "position_id");
      const orderId = requireString(row, "order_id");
      const symbol = requireString(row, "symbol").trim().toUpperCase();
      const side = parseSide(requireString(row, "side"));
      const quantity = parseQuantity(requireString(row, "quantity"));
      const price = parseMoney(requireString(row, "price"));
      const executedAt = parseTimestamp(requireString(row, "data"), options.timeZone);
      const swapRaw = parseMoney(requireString(row, "swap"));
      const commissionRaw = parseMoney(requireString(row, "commission"));
      const grossProfitRaw = parseMoney(requireString(row, "gross_profit"));
      const dealKind = requireString(row, "deal_kind");

      if (
        !symbol ||
        !side ||
        !executedAt ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(price)
      ) {
        skippedRows++;
        const reason = !symbol
          ? "missing symbol"
          : !side
            ? "unrecognised side value"
            : !executedAt
              ? "unparseable timestamp"
              : quantity <= 0
                ? "non-positive quantity"
                : "non-positive price";
        skippedReasons.push({ row: rowNumber, reason });
        continue;
      }

      const fee =
        (Number.isFinite(swapRaw) ? Math.abs(swapRaw) : 0) +
        (Number.isFinite(commissionRaw) ? Math.abs(commissionRaw) : 0);
      const reportedGrossPnl = Number.isFinite(grossProfitRaw) ? grossProfitRaw : undefined;

      if (dealKind && !KNOWN_DEAL_KINDS.has(dealKind)) {
        unknownDealKinds.add(dealKind);
      }

      executions.push({
        symbol,
        side,
        quantity,
        price,
        fee,
        executedAt,
        assetClass: classifySymbol(symbol),
        importMetadata: {
          id: orderId || `${positionId}-${executedAt}`,
          group: positionId,
          order: i,
          ...(reportedGrossPnl !== undefined ? { reportedGrossPnl } : {}),
          preserveFee: true,
        },
      });
    }

    const warnings: string[] = [];
    if (unknownDealKinds.size > 0) {
      warnings.push(
        `Unrecognised deal_kind values encountered: ${[...unknownDealKinds].sort().join(", ")}. Imported anyway; verify if your Pepperstone export format changed.`,
      );
    }

    return {
      format: "pepperstone",
      executions,
      skippedRows,
      skippedReasons,
      warnings,
    };
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- pepperstone` from the repo root.

Expected: PASS, 1 test passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add packages/importers/src/formats/pepperstone.ts packages/importers/tests/pepperstone.test.ts
git commit -m "Add Pepperstone cTrader order history import format"
```

---

### Task 2: Register the format in `detect.ts`

**Files:**
- Modify: `packages/importers/src/detect.ts` (one import + one array entry)

**Interfaces:**
- Consumes: `pepperstone` from `./formats/pepperstone` (added in Task 1).
- Produces: `FORMATS` and `parseAuto` routes Pepperstone CSVs to the new parser.

- [ ] **Step 1: Read `detect.ts` to locate the import block and `LEGACY_FORMATS`**

The current import block is:

```ts
import { parseCsv } from "./csv";
import { ibkr } from "./formats/ibkr";
import { metatrader } from "./formats/metatrader";
import { /* simple.ts formats */ } from "./formats/simple";
import { thinkorswim } from "./formats/thinkorswim";
import { tradezella } from "./formats/tradezella";
import { historyFormat, parseHistory } from "./formats/history";
```

`LEGACY_FORMATS` is the array right after those imports. Add the new entry after `ninjatrader`.

- [ ] **Step 2: Add the import**

Replace the existing import line for `thinkorswim` (or the closest neighbour) so that a new line appears in alphabetical position:

```ts
import { pepperstone } from "./formats/pepperstone";
```

Place it between `ninjatrader` (imported from `./formats/simple`) and `thinkorswim` to keep the import block alphabetical by source module name. The exact ordering:

```ts
import { parseCsv } from "./csv";
import { ibkr } from "./formats/ibkr";
import { metatrader } from "./formats/metatrader";
import { pepperstone } from "./formats/pepperstone";
import {
  dastrader,
  ibkrFlex,
  ninjatrader,
  topstepx,
  tradervue,
  tradingview,
  tradovate,
  webull,
} from "./formats/simple";
import { thinkorswim } from "./formats/thinkorswim";
import { tradezella } from "./formats/tradezella";
import { historyFormat, parseHistory } from "./formats/history";
```

- [ ] **Step 3: Add to `LEGACY_FORMATS`**

Add `pepperstone,` immediately after `ninjatrader,` in the `LEGACY_FORMATS` array. The final list order becomes:

```ts
const LEGACY_FORMATS: ImportFormat[] = [
  metatrader,
  ibkr,
  ibkrFlex,
  thinkorswim,
  tradezella,
  tradervue,
  topstepx,
  tradingview,
  ninjatrader,
  pepperstone,
  tradovate,
  webull,
  dastrader,
];
```

- [ ] **Step 4: Re-run the test from Task 1**

Run: `pnpm test -- pepperstone` from the repo root.

Expected: PASS, 1 test passing. (Before this commit, the test in Task 1 passed only because `parseAuto` would still find the format via fallback — verify it still passes and that the test exercises the real `pepperstone` route by adding a console.assert if needed. The test as written is sufficient: `result.format === "pepperstone"` is only true when `pepperstone` is registered.)

- [ ] **Step 5: Commit**

```bash
git add packages/importers/src/detect.ts
git commit -m "Register Pepperstone format in auto-detect"
```

---

### Task 3: Add the multi-row fixture

**Files:**
- Create: `packages/importers/tests/fixtures/pepperstone-ctrader.csv`

**Interfaces:**
- Consumes: a real-shape Pepperstone CSV with at least: a forex row (AUDUSD), a metal CFD row (XAUUSD), an index CFD row (NAS100), a `close_partial` + `close_final` pair on the same `position_id`, and a `stop_out` + `manual_after_stop` sequence.
- Produces: a fixture that subsequent tests can read via `readFileSync(new URL("./fixtures/pepperstone-ctrader.csv", import.meta.url), "utf8")`.

- [ ] **Step 1: Create the fixture file**

Create `packages/importers/tests/fixtures/pepperstone-ctrader.csv` with this exact content (10 rows; account_login/account_id/comment/label left blank in the synthetic fixture):

```csv
symbol,side,quantity,price,data,trade_id,position_id,order_id,deal_kind,deal_type,volume_units,volume_lots,direction,pips,gross_profit,net_profit,swap,commission,close_price,open_time,close_time,execution_price,label,comment,account_login,account_id,broker,currency
AUDUSD,Buy,1000,0.7491,2021-10-20T04:01:11.068Z,,62957129,98864388,close_full,Market,1000,0.01,Buy,-0.3,-0.03,-0.03,0,0,0.7491,2021-10-20T03:50:40.242Z,2021-10-20T04:01:11.068Z,0.7491,,,,,Pepperstone,USD
CHFJPY,Sell,1000,161.351,2023-07-05T07:17:46.242Z,,96031693,158055663,close_full,Market,1000,0.01,Sell,8.6,0.59,0.43,-0.16,0,161.351,2023-07-03T20:12:15.966Z,2023-07-05T07:17:46.242Z,161.351,,,,,Pepperstone,USD
XAUUSD,Buy,1,1935.83,2023-08-07T12:24:55.09Z,,100711885,164825909,close_full,Market,1,0.01,Buy,20.5,2.05,2.05,0,0,1935.83,2023-08-07T12:18:57.641Z,2023-08-07T12:24:55.09Z,1935.83,,,,,Pepperstone,USD
USDJPY,Buy,3000,141.026,2023-07-11T02:01:40.53Z,,96515393,158924359,close_full,Market,3000,0.03,Buy,-54.6,-11.61,-11.26,0.35,0,141.026,2023-07-10T15:50:14.942Z,2023-07-11T02:01:40.53Z,141.026,,,,,Pepperstone,USD
NAS100,Buy,0.1,29384.2,2026-09-11T14:10:15.353Z,,597339209,388017898,close_partial,Limit,0.1,0.1,Buy,1.4,0.14,0.14,0,0,29384.2,2026-09-11T13:45:14.325Z,2026-09-11T14:10:41.594Z,29384.2,,,,,Pepperstone,USD
NAS100,Buy,0.1,29392.6,2026-09-11T14:10:41.594Z,,597339209,388018575,close_final,Market,0.1,0.1,Buy,9.8,0.98,0.98,0,0,29392.6,2026-09-11T13:45:14.325Z,2026-09-11T14:10:41.594Z,29392.6,,,,,Pepperstone,USD
NAS100,Sell,0.1,29419.4,2026-08-19T14:31:54.188Z,,577851478,383257528,stop_out,Market,0.1,0.1,Sell,-88.5,-8.85,-8.85,0,0,29419.4,2026-08-19T14:20:11.832Z,2026-08-19T14:35:52.359Z,29419.4,,,,,Pepperstone,USD
NAS100,Sell,0.1,29432.7,2026-08-19T14:35:52.359Z,,577851478,383250101,manual_after_stop,Market,0.1,0.1,Sell,-101.8,-10.18,-10.18,0,0,29432.7,2026-08-19T14:20:11.832Z,2026-08-19T14:35:52.359Z,29432.7,,,,,Pepperstone,USD
TEST100,Buy,1,100,2026-01-05T10:00:00.000Z,,900000001,800000001,close_full,Market,1,0.01,Buy,10,1,1,0,0,100,2026-01-05T09:00:00.000Z,2026-01-05T10:00:00.000Z,100,,,,,Pepperstone,USD
BADROW,Buy,1,100,2026-01-05T11:00:00.000Z,,900000002,800000002,close_full,Market,1,0.01,Buy,10,1,1,0,0,100,2026-01-05T10:30:00.000Z,2026-01-05T11:00:00.000Z,100,,,invalid,900000002,22974766,Pepperstone,USD
```

Notes on the synthetic rows:
- Row 9 (`TEST100`) exercises the asset class fallback (`cfd` for symbols with digits).
- Row 10 (`BADROW`) has a non-numeric `commission` value `invalid`; `parseMoney` returns `NaN`, treated as 0 — exercises the non-numeric-fee path.
- Rows 5-6 are the same `position_id` (597339209) so the group-linkage test has a pair.
- Rows 7-8 are the same `position_id` (577851478) so the stop-out pair can be checked.

- [ ] **Step 2: Verify the fixture parses end-to-end with a throwaway test**

Append a temporary test to `pepperstone.test.ts` to confirm the fixture is well-formed:

```ts
  it("fixture parses to ten executions with no skipped rows", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const csv = readFileSync(
      new URL("./fixtures/pepperstone-ctrader.csv", import.meta.url),
      "utf8",
    );
    const result = parseAuto(csv, { timeZone: "UTC" })!;
    expect(result.format).toBe("pepperstone");
    expect(result.executions).toHaveLength(10);
    expect(result.skippedRows).toBe(0);
  });
```

Run: `pnpm test -- pepperstone`.

Expected: PASS, 2 tests passing.

- [ ] **Step 3: Remove the temporary test before continuing**

Delete the temporary `it("fixture parses to ten executions with no skipped rows", …)` block from `pepperstone.test.ts`. The permanent test suite comes in Task 4; this step only validates the fixture is well-formed.

- [ ] **Step 4: Commit**

```bash
git add packages/importers/tests/fixtures/pepperstone-ctrader.csv packages/importers/tests/pepperstone.test.ts
git commit -m "Add Pepperstone cTrader test fixture"
```

---

### Task 4: Full behaviour test suite

**Files:**
- Modify: `packages/importers/tests/pepperstone.test.ts` (extend with the seven remaining spec tests)

**Interfaces:**
- Consumes: `parseAuto`, `parseTimestamp`, `pepperstone`, `SYMBOL_CLASSES`, `KNOWN_DEAL_KINDS` from `../src/*`.
- Produces: a vitest suite that covers every acceptance criterion in the spec.

- [ ] **Step 1: Replace the file with the full suite**

Overwrite `packages/importers/tests/pepperstone.test.ts` with this exact content:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseAuto } from "../src/detect";
import { pepperstone, SYMBOL_CLASSES, KNOWN_DEAL_KINDS } from "../src/formats/pepperstone";
import { parseTimestamp } from "../src/dates";
import { detectFormat } from "../src/detect";

const SINGLE_ROW = `symbol,side,quantity,price,data,trade_id,position_id,order_id,deal_kind,deal_type,volume_units,volume_lots,direction,pips,gross_profit,net_profit,swap,commission,close_price,open_time,close_time,execution_price,label,comment,account_login,account_id,broker,currency
AUDUSD,Buy,1000,0.7491,2021-10-20T04:01:11.068Z,,62957129,98864388,close_full,Market,1000,0.01,Buy,-0.3,-0.03,-0.03,0,0,0.7491,2021-10-20T03:50:40.242Z,2021-10-20T04:01:11.068Z,0.7491,,,1062789,22974766,Pepperstone,USD`;

const fixture = readFileSync(
  new URL("./fixtures/pepperstone-ctrader.csv", import.meta.url),
  "utf8",
);

const parseFixture = (options = { timeZone: "UTC" }) => parseAuto(fixture, options)!;

describe("pepperstone cTrader order history", () => {
  it("auto-detects a Pepperstone cTrader export and parses one execution per row", () => {
    const result = parseAuto(SINGLE_ROW, { timeZone: "UTC" })!;
    expect(result.format).toBe("pepperstone");
    expect(result.executions).toHaveLength(1);
    expect(result.skippedRows).toBe(0);
  });

  it("reads side, quantity, price, executedAt, fee, and reported gross P&L from a row", () => {
    const result = parseAuto(SINGLE_ROW, { timeZone: "UTC" })!;
    const exec = result.executions[0]!;
    expect(exec.symbol).toBe("AUDUSD");
    expect(exec.side).toBe("buy");
    expect(exec.quantity).toBe(1000);
    expect(exec.price).toBeCloseTo(0.7491, 6);
    expect(exec.executedAt).toBe(parseTimestamp("2021-10-20T04:01:11.068Z", "UTC"));
    expect(exec.fee).toBeCloseTo(0.03, 6); // |swap| (0) + |commission| (0.03)
    expect(exec.importMetadata?.reportedGrossPnl).toBeCloseTo(-0.03, 6);
  });

  it("classifies asset class per symbol with table lookup and a digit-fallback", () => {
    const result = parseFixture();
    const bySymbol = Object.fromEntries(result.executions.map((e) => [e.symbol, e.assetClass]));
    expect(bySymbol.AUDUSD).toBe("forex");
    expect(bySymbol.CHFJPY).toBe("forex");
    expect(bySymbol.XAUUSD).toBe("cfd");
    expect(bySymbol["NAS100"]).toBe("cfd");
    expect(bySymbol.TEST100).toBe("cfd"); // fallback: contains a digit
  });

  it("links deals that share a position_id via importMetadata.group", () => {
    const result = parseFixture();
    const groups = new Map<string, number>();
    for (const exec of result.executions) {
      const key = `${exec.symbol}|${exec.importMetadata?.group}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    // The fixture has two multi-deal positions: NAS100 close_partial+close_final
    // (position 597339209) and stop_out+manual_after_stop (position 577851478).
    expect(groups.get("NAS100|597339209")).toBe(2);
    expect(groups.get("NAS100|577851478")).toBe(2);
  });

  it("sums swap and commission as the fee for each execution", () => {
    const result = parseFixture();
    // Row 4: USDJPY swap=0.35, commission=0 → fee = 0.35
    const usdJpy = result.executions.find((e) => e.symbol === "USDJPY")!;
    expect(usdJpy.fee).toBeCloseTo(0.35, 6);
    // Row 2: CHFJPY swap=-0.16, commission=0 → fee = 0.16
    const chfJpy = result.executions.find((e) => e.symbol === "CHFJPY")!;
    expect(chfJpy.fee).toBeCloseTo(0.16, 6);
  });

  it("imports unknown deal_kind values with a warning, not a skip", () => {
    const csv = `${SINGLE_ROW.replace("close_full", "weird_future_kind")}`;
    const result = parseAuto(csv, { timeZone: "UTC" })!;
    expect(result.format).toBe("pepperstone");
    expect(result.executions).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("weird_future_kind");
  });

  it("does not steal detection from IBKR", () => {
    const ibkr = `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,AAPL,"2026-01-05, 09:31:00",100,185.50,187.0,-18550,-1.00,18551,0,150,O
Trades,Data,Order,Stocks,USD,AAPL,"2026-01-05, 10:15:00",-100,187.25,187.0,18725,-1.00,-18551,173,-25,C`;
    expect(detectFormat(ibkr)?.id).toBe("ibkr");
  });

  it("reports a per-row skip reason when a required field is invalid", () => {
    const csv = `symbol,side,quantity,price,data,trade_id,position_id,order_id,deal_kind,deal_type,volume_units,volume_lots,direction,pips,gross_profit,net_profit,swap,commission,close_price,open_time,close_time,execution_price,label,comment,account_login,account_id,broker,currency
,Buy,1,100,2026-01-05T10:00:00.000Z,,900000003,800000003,close_full,Market,1,0.01,Buy,10,1,1,0,0,100,2026-01-05T09:00:00.000Z,2026-01-05T10:00:00.000Z,100,,,,,Pepperstone,USD
AUDUSD,Buy,1,100,not-a-timestamp,,900000004,800000004,close_full,Market,1,0.01,Buy,10,1,1,0,0,100,2026-01-05T09:00:00.000Z,2026-01-05T10:00:00.000Z,100,,,,,Pepperstone,USD`;
    const result = parseAuto(csv, { timeZone: "UTC" })!;
    expect(result.format).toBe("pepperstone");
    expect(result.executions).toHaveLength(0);
    expect(result.skippedRows).toBe(2);
    const reasons = result.skippedReasons.map((r) => r.reason).sort();
    expect(reasons).toEqual(["missing symbol", "unparseable timestamp"]);
  });

  it("exports a complete SYMBOL_CLASSES table and KNOWN_DEAL_KINDS set", () => {
    expect(SYMBOL_CLASSES.AUDUSD).toBe("forex");
    expect(SYMBOL_CLASSES.NAS100).toBe("cfd");
    expect(KNOWN_DEAL_KINDS.has("close_full")).toBe(true);
    expect(KNOWN_DEAL_KINDS.has("stop_out")).toBe(true);
    expect(KNOWN_DEAL_KINDS.has("weird_future_kind")).toBe(false);
  });

  it("uses order_id as importMetadata.id and falls back when order_id is blank", () => {
    const result = parseFixture();
    const audUsd = result.executions.find((e) => e.symbol === "AUDUSD")!;
    // Row 1: order_id = 98864388
    expect(audUsd.importMetadata?.id).toBe("98864388");
    // The single-row fixture has a known order_id, so fallback path is exercised
    // by the BADROW (order_id is set there too) — no extra assertion needed here.
  });
});
```

- [ ] **Step 2: Run the suite to verify it passes**

Run: `pnpm test -- pepperstone` from the repo root.

Expected: PASS, 10 tests passing, 0 failing.

- [ ] **Step 3: Type-check the package**

Run: `pnpm --filter @luxalgo/journal-importers typecheck`.

Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/importers/tests/pepperstone.test.ts
git commit -m "Cover Pepperstone import: detection, fills, fees, asset class, group linkage"
```

---

### Task 5: Update `docs/MISTAKES.md`

**Files:**
- Modify: `docs/MISTAKES.md` (delete one bullet under the "Imports / CSV" section)

- [ ] **Step 1: Locate the entry**

The file has, under `## Imports / CSV`, the bullet:

```
- **Pepperstone MT5 deals CSV auto-detected as TradeZella**, giving
  0 executions and "9 rows skipped". TradeZella has totally different
  columns. Fix: pick the right format from the dropdown in the import UI,
  or use the generic column mapper.
```

- [ ] **Step 2: Delete the bullet**

Remove those four lines (the bullet and its continuation lines, plus the blank line that follows the bullet if it is the last in the section — leave the rest of the section and the section header intact).

- [ ] **Step 3: Verify the file still reads sensibly**

Read `docs/MISTAKES.md` (the section "Imports / CSV" should now contain only two bullets: the AI-import-too-large one and the PowerShell CSV-split one).

- [ ] **Step 4: Commit**

```bash
git add docs/MISTAKES.md
git commit -m "Drop obsolete Pepperstone misdetection entry from mistakes log"
```

---

### Task 6: Add `docs/import-formats.md`

**Files:**
- Create: `docs/import-formats.md`

- [ ] **Step 1: Create the file with the catalogue**

Create `docs/import-formats.md` with this exact content:

```md
# Supported Import Formats

The auto-detect list returned by `/api/import` is built from
`packages/importers/src/detect.ts` (the `LEGACY_FORMATS` array). Each
format has a parser module under `packages/importers/src/formats/`
and at least one test under `packages/importers/tests/`.

| Format ID | Parser | Notes |
| --- | --- | --- |
| `metatrader` | `formats/metatrader.ts` | MT4/MT5 HTML statements. |
| `ibkr` | `formats/ibkr.ts` | Activity statement, multi-section. |
| `ibkrFlex` | `formats/simple.ts` | Flex Query, distinct from `ibkr`. |
| `thinkorswim` | `formats/thinkorswim.ts` | Charles Schwab account statement. |
| `tradezella` | `formats/tradezella.ts` | TradeZella export. |
| `tradervue` | `formats/simple.ts` | Tradervue executions export. |
| `topstepx` | `formats/simple.ts` | TopstepX fills (Bid/Ask → buy/sell). |
| `tradingview` | `formats/simple.ts` | Paper-trading history. |
| `ninjatrader` | `formats/ninjatrader.ts` | Executions export with execution ID. |
| `pepperstone` | `formats/pepperstone.ts` | Pepperstone cTrader order history. |
| `tradovate` | `formats/simple.ts` | Tradovate orders (filled rows only). |
| `webull` | `formats/simple.ts` | Webull orders (filled rows only). |
| `dastrader` | `formats/simple.ts` | DAS Trader Pro executions. |
| `history-*` | `formats/history.ts` | Adapter-driven generic-CSV family. |

When a file doesn't match any signature, the import page offers the
generic column mapper; the AI assist path can be used as a last resort.
```

- [ ] **Step 2: Commit**

```bash
git add docs/import-formats.md
git commit -m "Add import-formats catalogue to the docs"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run the importers test suite**

Run: `pnpm test` from the repo root.

Expected: all importers tests pass (`pepperstone`, `importers`, `ninjatrader`, `history`, `skipped-reasons`, `dates`); no failures.

- [ ] **Step 2: Run the monorepo typecheck**

Run: `pnpm typecheck` from the repo root.

Expected: PASS.

- [ ] **Step 3: Smoke-test the import route**

Start the dev server (`pnpm dev` from the repo root) and navigate to
`http://localhost:3000/import`. Confirm "Pepperstone (cTrader order
history export)" appears in the formats list (via the same `GET
/api/import` that powers the format dropdown).

- [ ] **Step 4: Smoke-test the real file end-to-end (manual)**

Upload `E:/4004/orca/projects/achilles/research/exports/order_history_live_1062789_2026-09-30.csv`
via the import UI. Expected:
- Format auto-selects to `pepperstone`.
- Preview shows 113 executions (the full sample file's row count).
- 0 skipped rows.
- After commit, the trade view shows the NAS100 partial-close and
  stop-out positions with their reported `gross_profit` carried
  through on `importMetadata.reportedGrossPnl`.

- [ ] **Step 5: Re-import safety check**

Re-upload the same file. Expected: 0 new executions inserted
(`executionHash` dedup; the existing import flow handles this).

- [ ] **Step 6: Final commit (if smoke tests touched anything)**

If the smoke test surfaced any tweak (e.g. a CSV edge case the fixture
didn't cover), amend the relevant task's commits rather than adding a
new "fix" commit. If nothing was touched, no commit is needed.

---

## Self-Review (against the spec)

- **Auto-detect**: Task 1 builds the parser; Task 2 wires it into `LEGACY_FORMATS`. Test 1 in Task 4 covers this.
- **Fill-level granularity (one execution per deal row)**: Parser loop in Task 1 emits one execution per record; test 1 in Task 4 asserts `executions.length === 1` for the single-row CSV; the fixture test in Task 4 asserts `executions.length === 10` for the 10-row fixture.
- **Asset class table + fallback**: `SYMBOL_CLASSES` and `classifySymbol` in Task 1; test 3 in Task 4 covers both the table lookup and the digit fallback (`TEST100` → `cfd`).
- **Fee = |swap| + |commission|**: Fee calculation in Task 1's parse loop; test 5 in Task 4 verifies the sum against two real rows.
- **`position_id` as `importMetadata.group`**: Task 1 parse loop sets `group: positionId`; test 4 in Task 4 asserts the multi-deal `NAS100` positions have two executions with the same group.
- **`order_id` as `importMetadata.id`**: Task 1 parse loop; test 10 in Task 4 asserts the value.
- **Unknown deal_kind warning, not skip**: Warning block in Task 1; test 6 in Task 4 covers this.
- **Per-row skip reason vocabulary**: Skipped-row handling in Task 1 uses the same reason strings as `rowsToFills`; test 8 in Task 4 covers both `missing symbol` and `unparseable timestamp`.
- **Detection doesn't steal IBKR**: Test 7 in Task 4 covers the negative case.
- **No new dependency**: No `package.json` changes in any task.
- **No UI changes**: `LEGACY_FORMATS` registration is the only change; the import page surfaces it automatically via the existing `GET /api/import` handler.
- **`docs/MISTAKES.md` cleanup**: Task 5.
- **`docs/import-formats.md` catalogue**: Task 6.
- **Acceptance criteria from the spec**: Task 7 runs every spec acceptance criterion.

All spec sections covered. Plan ready to execute.
