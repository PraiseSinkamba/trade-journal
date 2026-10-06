# Broker Statement Parser Style Guide

Parser authoring for `packages/importers/`. Covers both the legacy `formats/` path and the `history/adapters/` path.

---

## Two Paths — One Entry Point

`packages/importers/src/detect.ts` routes incoming files. **Never call both paths** from application code and never bypass the router.

```
File received → detect.ts → legacy formats/ OR history/adapters/ → parsed result
```

`parseAuto()` is the single public entry point. It calls `detect()` internally.

```ts
// Correct
import { parseAuto } from '@luxalgo/importers';
const result = await parseAuto(fileBuffer, filename);

// Wrong — bypasses format detection and router
import { parseFills } from '@luxalgo/importers/formats/fills';
```

---

## Declarative Column Spec for CSV Fills

For CSV fills, define a column spec using `makeFillsFormat` from `formats/fills.ts`. This is the declarative API — never parse CSV rows with ad-hoc string splits.

```ts
// packages/importers/src/formats/fills.ts pattern
export const myBrokerFills = makeFillsFormat({
  name: 'my-broker',
  columns: {
    date:     { index: 0, type: 'date',   label: 'Date' },
    symbol:   { index: 1, type: 'string', label: 'Symbol' },
    side:     { index: 2, type: 'side',   label: 'Action' },
    quantity: { index: 3, type: 'number', label: 'Qty' },
    price:    { index: 4, type: 'number', label: 'Price' },
    netAmount:{ index: 5, type: 'number', label: 'Net', signed: true },
  },
  // date/time in broker-local; conversion happens at the engine boundary
  parseDate: (raw) => parseBrokerDate(raw, 'MM/dd/yyyy'),
});
```

Each column entry is typed: `date`, `string`, `number`, `side`, `currency`. The spec drives both parsing and type inference — no runtime type assertions.

---

## Side Normalization — `parseSide`

Use `parseSide` from `packages/importers/src/formats/sides.ts`. It handles the full set of broker variants:

```
BUY / SELL / LONG / SHORT / BOT / SLD / SOLD / COVER / OPEN / CLOSE / ...
```

**Never reimplement side normalization** in a new format. If a variant is missing, add it to `parseSide` and write a fixture test for it.

```ts
import { parseSide } from '@luxalgo/importers/src/formats/sides';
const side = parseSide(rawSide); // → 'buy' | 'sell'
```

---

## Date Parsing

Use helpers from `packages/importers/src/dates.ts`. Dates are assumed to be in broker-local time zone — the conversion to UTC happens once, at the engine boundary.

```ts
// Correct — use the date helper
import { parseBrokerDate, formatDate } from '@luxalgo/importers/src/dates';
const utcDate = parseBrokerDate(raw, 'MM/dd/yyyy');

// Wrong — mixing parsers or ignoring timezone
const d = new Date(raw); // non-deterministic across brokers
```

Never use `new Date()` directly on broker-supplied strings. Broker date formats vary (`MM/DD/YYYY`, `DD-MM-YY`, `YYYY-MM-DD`) and `Date` constructor is platform-dependent.

---

## Number Parsing

Use `parseNumber` from `packages/importers/src/numbers.ts`. It handles locale-aware decimal/thousand separators and returns a `number`.

```ts
import { parseNumber } from '@luxalgo/importers/src/numbers';

// Handles "1,234.56", "1.234,56", "1234.56", "-1234"
const price = parseNumber(rawPrice);
```

**Never use `parseFloat()` or `Number()` directly** on P&L, quantity, or price fields from broker output. Broker CSVs mix locale formats.

---

## "Never Guess" Rule

A file either:
1. Matches a **documented signature** (header pattern, column layout) — parsed with the specific format.
2. Goes to the **generic column mapper** — user maps columns at import time.
3. **Throws** with a precise reason.

```ts
// Correct — throws with actionable error
if (!signatureMatch(buffer, KNOWN_SIGNATURES[i])) {
  throw new ParseError(`Unrecognized format. Expected headers: ${EXPECTED.join(', ')}`);
}

// Wrong — silently returns empty or falls through to generic mapper with no signal
if (row.length === 0) return [];
```

---

## Error Reporting — Per-Row, Not Per-File

Collect row-level problems and return them in the result, **do not throw on the first bad row**.

```ts
const errors: ParseWarning[] = [];
for (const row of rows) {
  try {
    // parse row
  } catch (e) {
    errors.push({ row: i, message: e instanceof Error ? e.message : String(e) });
  }
}
return { executions, errors };
```

If every row fails, the import itself fails — but individual row failures are surfaced, not silently dropped.

---

## Determinism — `importOrder`

`importOrder` is assigned at import time (not parse time) and used by `compareExecutions` to order executions from the same import group. Preserve it:

```ts
// Set at import, not inside the parser
const enriched = executions.map((e, i) => ({
  ...e,
  importOrder: importSession.nextOrder + i,
}));
```

---

## Fixture Tests

Every new format requires:
1. A fixture file in `packages/importers/tests/fixtures/<format-name>/` — real-looking CSV/PDF/JSON export from the broker.
2. A test that calls `parseAuto(fixtureBuffer)` and asserts the parsed executions round-trip through the engine.

```ts
// packages/importers/tests/fills.test.ts pattern
test('my-broker fills round-trip', async () => {
  const buf = await fs.readFile('tests/fixtures/my-broker/export.csv');
  const result = await parseAuto(buf, 'export.csv');
  expect(result.errors).toHaveLength(0);
  expect(result.executions.length).toBeGreaterThan(0);
});
```

Fixture files are committed to the repo. Real broker data should be sanitized (replace account numbers, amounts with plausible values).

---

## Cite

- `packages/importers/src/detect.ts` — `parseAuto` entry point, router, format detection
- `packages/importers/src/formats/fills.ts` — `makeFillsFormat`, declarative column spec
- `packages/importers/src/dates.ts` — `parseBrokerDate`, `formatDate`
- `packages/importers/src/numbers.ts` — `parseNumber`
- `packages/importers/src/formats/sides.ts` — `parseSide`

---

## Checklist before PR

- [ ] All broker input flows through `parseAuto()` — no direct format imports in application code
- [ ] New CSV format uses `makeFillsFormat` with a typed column spec, not string-split parsing
- [ ] Side values go through `parseSide`; no reimplementation in the new format
- [ ] Dates go through `parseBrokerDate` from `dates.ts`; no raw `new Date()` on broker strings
- [ ] Numbers go through `parseNumber` from `numbers.ts`; no `parseFloat` on P&L fields
- [ ] Row-level parse errors are collected and returned in the result; first-bad-row throw only for fatal/malformed file
- [ ] A fixture CSV/PDF/JSON lives in `packages/importers/tests/fixtures/<format>/` with a round-trip test
- [ ] `importOrder` is assigned at import time, not inside the parser
