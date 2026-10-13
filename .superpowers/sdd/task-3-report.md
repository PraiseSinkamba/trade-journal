# Task 3 Report: Zod Schemas + Tool Wrappers

## Files Created

### Source (7 files)
- `apps/web/src/server/ctrader-mcp/schemas.ts` — All Zod schemas + `AssetClass` type
- `apps/web/src/server/ctrader-mcp/accounts.ts` — `listCTraderAccounts`
- `apps/web/src/server/ctrader-mcp/symbols.ts` — `fetchSymbols`, `buildAssetClassMap`
- `apps/web/src/server/ctrader-mcp/account.ts` — `getAccountInfo`
- `apps/web/src/server/ctrader-mcp/positions.ts` — `getOpenPositions`
- `apps/web/src/server/ctrader-mcp/orders.ts` — `getPendingOrders`
- `apps/web/src/server/ctrader-mcp/deals.ts` — `fetchAllDeals`, `mapDealToExecution`

### Tests (2 files)
- `apps/web/tests/ctrader-mcp/schemas.test.ts` — 2 tests (parse valid deal, reject missing fields)
- `apps/web/tests/ctrader-mcp/deals.test.ts` — 2 tests (BUY/SELL mapping)

## Test Results

```
$ pnpm vitest run apps/web/tests/ctrader-mcp/schemas.test.ts
 ✓ apps/web/tests/ctrader-mcp/schemas.test.ts (2 tests) 11ms
 Test Files  1 passed (1)
      Tests  2 passed (2)

$ pnpm vitest run apps/web/tests/ctrader-mcp/deals.test.ts
 ✓ apps/web/tests/ctrader-mcp/deals.test.ts (2 tests) 8ms
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

All 4 required tests pass.

## Fix-pass

### Finding 1 — Zod input/output decoupling

**Root cause:** `schema: z.ZodType<OUT>` defaults input = output, making `.parse(data: unknown)` incompatible. Switching to `z.ZodSchema<OUT>` (= `z.ZodType<OUT, ZodTypeDef, any>`) decouples input from output, but TypeScript still couldn't infer the single `OUT` generic from the schema argument inside the `do...while` loop (TS7022 on `page`). Final fix: use a schema-type generic `S` so `z.infer<S>` is inferred directly.

`client.ts` — changed `callTool<OUT>(schema: z.ZodSchema<OUT>)` → `callTool<S extends z.ZodType<z.infer<S>, ZodTypeDef, unknown>>(schema: S)`.

**Finding 1 fix** (`client.ts`):
```ts
// Before (input=output coupling; OUT can't be inferred from schema arg alone)
async callTool<OUT>(name, args, schema: z.ZodType<OUT>): Promise<OUT>

// After (input decoupled from output; S inferred as the schema type directly)
async callTool<S extends z.ZodType<z.infer<S>, z.ZodTypeDef, unknown>>(
  name, args, schema: S,
): Promise<z.infer<S>>
```

`deals.ts`: added `const page: z.infer<typeof cTraderDealsResponseSchema>` to break the TS7022 inference cycle (TypeScript couldn't resolve `S` from `callTool` inside the do-while with `cursor` creating a circular type dependency).

### Finding 2 — stock→equity at mapper boundary

`deals.ts:46` — changed `assetClass` → `assetClass === "stock" ? "equity" : assetClass` before assigning to `ImportedExecution.assetClass`. Local `AssetClass` enum in `schemas.ts` is unchanged.

### Test command
```
$ npx vitest run apps/web/tests/ctrader-mcp/ --reporter=verbose
  RUN  v3.2.7
   Test Files  4 passed (4)
        Tests  11 passed (11)
   Start at 14:18:32
   Duration  2.55s
```

### Typecheck (touched files)
```
$ npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | grep -E "ctrader-mcp/(deals|positions|client)\.ts"
(none — clean)
```

### Commit
```
8464a6f fix(ctrader-mcp): decouple zod input/output in callTool; map stock to equity
```

## Commit

```
ac5860d feat(ctrader-mcp): tool wrappers and Zod schemas for cTrader responses
```

## Notes

- `fetchAllDeals` pagination loop uses `nextCursor` key as the brief specifies; adapts to null/undefined.
- `mapDealToExecution` accepts `symbolName: string` and `assetClass: AssetClass` as separate args (caller resolves symbolId→name/class from the symbol map built by `buildAssetClassMap`).
- `commission` and `swap` defaults (`z.number().default(0)`) mean `deal.commission ?? 0` in `mapDealToExecution` is safe even if Zod strips them.
- All wrappers are thin pass-throughs to `client.callTool`; no dedicated tests beyond the two required.
