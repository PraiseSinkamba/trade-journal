# TypeScript Style — trade-journal

## Strict Mode

`tsconfig.base.json` enables `strict: true` and `noUncheckedIndexedAccess: true` for the entire monorepo. These are project-wide defaults; per-file suppressions are prohibited.

**`!` (non-null assertion) — when allowed:**

```ts
// After a guard that narrows the type at runtime
const group = groups.get(key);
if (group.length > 0) {
  const first = group[0]!; // ✓ allowed: runtime length check above
}

// After Array.isArray + length check on parsed JSON
const headers = parseCsv(content)[0] ?? [];
if (headers.length > 0) { /* ... */ }
```

**`!` — when forbidden:**

```ts
// Never assert existence of array elements without a runtime guard
const item = rows[0]!; // ✗ banned: rows could be empty — use rows[0] ?? default
```

`noUncheckedIndexedAccess` makes every `arr[i]` return `T | undefined`. Honor it instead of suppressing it.

## ESM

All packages use `"type": "module"` (implied by `"module": "ESNext"` + `"moduleResolution": "bundler"` in `tsconfig.base.json`). CommonJS interop via `esModuleInterop: true` is for external deps only.

**Package entry points** (`packages/*/package.json`) use the dev pattern:

```json
{
  "main": "./src/index.ts",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts",
    "./package.json": "./package.json"
  }
}
```

Never use `require()` inside source code. Drizzle's `better-sqlite3` driver, `new Database(...)` in `apps/web/src/db/index.ts`, is initialized via top-level import, not lazy require.

## Naming

**Domain identifiers are camelCase.** See `packages/core/src/types.ts` for the canonical field names:

```ts
// ✓ correct
tradeKey, executedAt, profitFactor, openedAt, grossPnl, closedAt, side, quantity, price

// ✗ wrong (not the domain vocabulary)
trade_key, executed_at, profit_factor, TradeKey, ExecutedAt
```

**File naming:**

- UI components (`.tsx`): `kebab-case` — `round-trip-card.tsx`, `execution-table.tsx`
- Server-side and library modules (`.ts`): `kebab-case` is also fine, but module names match the symbol they export — `executions.ts`, `ibkr-sync-timezone.ts`, `edge-score.ts`
- Never use `PascalCase` file names for modules in `apps/web/src/server/` or `packages/core/src/`

**Discriminator unions use string literals** (`"long" | "short"`, `"win" | "loss" | "breakeven" | "open"`) as shown in `packages/core/src/types.ts` (`TradeDirection`, `TradeStatus`).

## Assertions

Use `requireValue` from `apps/web/src/server/api.ts`. Never throw raw `Error` or `throw new Error(...)` inline in route handlers.

```ts
// ✓ correct — apps/web/src/server/executions.ts
requireValue(
  db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get(),
  "Account not found.",
);

// ✗ wrong
if (!condition) throw new Error("msg");
```

`requireValue` is defined in `apps/web/src/server/api.ts` and re-exported from `apps/web/src/server/executions.ts`.

## Async / DB

Prefer async/await with Drizzle's typed query builder. Wrap multi-table writes in a transaction:

```ts
// ✓ correct — drizzle transaction, immediate behavior
await db.transaction(async (tx) => {
  await tx.insert(executions).values(rows);
  await tx.update(accounts).set({ ... });
}, { behavior: "immediate" });

// Pass `tx` explicitly when sharing the transaction across helper functions
```

Drizzle's `db.transaction((tx) => ...)` shares the same connection. Never open a raw `Database` connection alongside Drizzle — use the `db` singleton from `apps/web/src/db/index.ts`.

## Determinism in Core

`compareExecutions` in `packages/core/src/round-trips.ts` is the sole total ordering over executions. Its docstring states the contract explicitly:

> "Total order over executions: time, then import order, then id. Every fill has a defined value at each level, so the comparator is transitive and the result never depends on the input order."

```ts
// packages/core/src/round-trips.ts:138–141
const compareExecutions = (a: Execution, b: Execution): number =>
  compareNumbers(Date.parse(a.executedAt), Date.parse(b.executedAt)) ||
  compareNumbers(importOrderOf(a), importOrderOf(b)) ||
  a.id.localeCompare(b.id);
```

**Never re-sort executions by a different comparator.** The round-trip engine calls `group.sort(compareExecutions)` internally; external sort orders that contradict this will desynchronize position tracking. If you need a different sort for display, derive it in the presentation layer, not in `packages/core`.

## Module Boundaries

```
packages/core        ← domain engine, zero external deps
packages/importers   ← broker statement parsers, leaf package
apps/web            ← Next.js app, imports from both above
```

`packages/core` must never import from `apps/web` or `packages/importers`. `packages/importers` is a leaf — no package imports from it except `apps/web`. Diagram the dependency direction before adding any new cross-package import.

## Discriminators + `never`

When a type has a discriminator field, exhaust all variants in `switch` and assert `never` in the default branch:

```ts
// packages/core/src/round-trips.ts — uses this pattern internally
const status: RoundTrip["status"] = isOpen
  ? "open"
  : Math.abs(netPnl) <= 1e-9
    ? "breakeven"
    : netPnl > 0
      ? "win"
      : "loss";
```

```ts
// ✓ correct
switch (execution.side) {
  case "buy": return handleBuy(execution);
  case "sell": return handleSell(execution);
  default: {
    const _exhaustive: never = execution.side;
    throw new Error(`Unknown side: ${_exhaustive}`);
  }
}
```

## Money / Number Formatting

**Never use `Number.toFixed` for rounding P&L.** Money rounding lives in `packages/core/src/numbers.ts` (import from there; if it doesn't have the helper you need, add it there, not inline).

```ts
// ✗ wrong
const pnl = (gross - fees).toFixed(2);

// ✓ correct — use the numbers module
import { centsToDollars, roundMoney } from "@luxalgo/journal-core/numbers";
const pnl = centsToDollars(cents);
```

When precision bites, store money as integer cents in the DB and convert only at the display boundary. Document any new float-money decision with a `// ponytail:` comment naming the ceiling and upgrade path.

## Imports from Configured Paths

`apps/web/tsconfig.json` extends `tsconfig.base.json` and adds path aliases (`@/` → `src/`). Always use aliased imports in `apps/web`:

```ts
// ✓ correct
import { db, executions } from "@/db";
import { requireValue } from "./api";

// ✗ wrong — relative path where an alias exists
import { db } from "../../db";
```

---

## Checklist before PR

- [ ] `tsconfig.base.json` unchanged; no `// @ts-ignore` or `any` introduced
- [ ] `noUncheckedIndexedAccess: true` respected — no bare `arr[i]!` without a runtime guard above it
- [ ] No `require()` calls in source; all imports are ESM
- [ ] `requireValue` used for assertions in route handlers (not raw `throw new Error`)
- [ ] `compareExecutions` not circumvented; no resort of executions outside `packages/core`
- [ ] Module boundary respected — `packages/core` has zero imports from `apps/web` or `packages/importers`
- [ ] Money formatting goes through `packages/core/src/numbers.ts` helpers; no `toFixed` on P&L
