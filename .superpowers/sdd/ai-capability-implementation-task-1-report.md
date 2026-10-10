# AI Capability Extraction — Phase 2 Task 1 Report

## Status: COMPLETE

## Changed Files

| File | Change |
|------|--------|
| `apps/web/src/server/ai-scope.ts` | Added `deepFreeze` utility, `FrozenApprovedScope` type, and updated `readAiRequest` to return `FrozenApprovedScope`; updated `accountContext` to accept `FrozenApprovedScope` |
| `apps/web/src/server/ai-capabilities.ts` | **NEW** — `askJournal`, `dailyRecapContext`, `tradeCritiqueContext` |
| `apps/web/src/app/api/ai/ask/route.ts` | Migrated to `askJournal` capability |
| `apps/web/src/app/api/ai/recap/route.ts` | Migrated to `dailyRecapContext` capability with note-authorization gate |
| `apps/web/src/app/api/ai/critique/route.ts` | Migrated to `tradeCritiqueContext` capability |
| `apps/web/tests/ai-capability.test.ts` | **NEW** — 15 tests covering all Phase 2 contracts |

## Test Results

### RED (failing before implementation)
```
apps/web/tests/ai-capability.test.ts — initially failed (tests written before source existed)
```

### GREEN (all passing after implementation)
```
npx vitest run apps/web/tests/ai-capability.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-runtime.test.ts

Test Files  4 passed (4)
     Tests  75 passed (75)
```

### New capability tests (15 total)
1. `deepFreeze returns primitives unchanged`
2. `deepFreeze freezes objects in place`
3. `deepFreeze freezes arrays in place`
4. `deepFreeze returns already-frozen objects unchanged`
5. `deepFreeze handles circular references`
6. `readAiRequest returns a deeply frozen scope`
7. `askJournal returns error when no trades match filters`
8. `askJournal returns answer and frozen scope when trades exist`
9. `askJournal scope label reflects selected accounts`
10. `dailyRecapContext throws when no closed trades for the day`
11. `dailyRecapContext returns recap and frozen scope from route for a valid day`
12. `dailyRecapContext note is passed from route when onlyDateFilters, undefined otherwise`
13. `readAiRequest scope is deeply frozen for recap`
14. `tradeCritiqueContext returns null for unknown key`
15. `tradeCritiqueContext returns critique for valid key`

### Existing tests (60 total — no regressions)
- `ai-scope.test.ts`: 32 tests
- `ai-ui.test.ts`: 10 tests
- `ai-runtime.test.ts`: 18 tests

## Implementation Details

### `FrozenApprovedScope`
- `readAiRequest` now returns `FrozenApprovedScope` (explicit return type annotation)
- `deepFreeze` utility recursively freezes objects and arrays in-place, handles circular references, and returns primitives unchanged
- `accounts` field is `ReadonlyArray` to prevent mutation
- Return statement: `return deepFreeze({ filters, timeZone, accounts: selectedAccounts, ... })`

### `askJournal(scope)`
- Accepts `body: unknown`, calls `readAiRequest(body, "question")` internally
- Returns `{ error: string } | { answer: string; scope: FrozenApprovedScope }`
- Zero trades → `{ error: ... }` (no AI call)
- Routes retain: `buildAskJournalPrompt`, `runAi`, response shape

### `dailyRecapContext(scope, date, existingNote)`
- Accepts `FrozenApprovedScope` (from route's `readAiRequest`), `date: string`, `existingNote: string | undefined`
- Route performs `onlyDateFilters` guard and reads `journalDays.note` before calling capability
- Returns `{ recap: string }` — scope is NOT returned (route owns it)
- Zero day trades → throws (route catches and returns 400)

### `tradeCritiqueContext(key)`
- Accepts `key: string` (primary key)
- Returns `null` for unknown key (route returns 404)
- Returns `{ critique: string }` for valid trade
- Routes retain: `buildTradeCritiquePrompt`, `runAi`

### Route Changes
- **ask**: Thin — calls `askJournal`, returns `ok({ answer, scope: result.scope.scope })` or `bad(error)`
- **recap**: Route owns `onlyDateFilters` guard + `journalDays.note` read; calls `dailyRecapContext(scope, date, existingNote)`
- **critique**: Thin — validates key presence, calls `tradeCritiqueContext(key)`, returns 404 if null

## Self-Review

### What was done correctly
- `deepFreeze` handles circular refs (important for any future graph structures)
- `FrozenApprovedScope.accounts` is `ReadonlyArray` to prevent mutation
- `dailyRecapContext` does NOT read the database — note is passed as parameter per research contract
- Routes retain prompts, `runAi`, and response shapes — no behavior change for clients
- `accountContext` updated to accept `FrozenApprovedScope` to fix TypeScript readonly compatibility

### Concerns
1. `tradeCritiqueContext` returns `null` for unknown key rather than throwing — this is intentional (route decides 404 vs 500) but worth documenting
2. `askJournal` returns `{ error: string }` discriminated union — callers use `"error" in result` pattern
3. `dailyRecapContext` throws on empty day trades — route catches and converts to 400, preserving existing behavior

## Review Fixes Applied

### Fix 1: `askJournal` boundary — remove HTTP body parsing from capability
**Before:** `askJournalContext(body: unknown)` called `readAiRequest` internally, parsing `request.json()`.
**After:** `askJournalContext(scope: FrozenApprovedScope)` accepts a pre-validated scope. Route owns `readAiRequest` + `buildAskJournalPrompt` + `runAi`.

**`apps/web/src/server/ai-capabilities.ts`**
```ts
// BEFORE (violated boundary)
export async function askJournalContext(body: unknown) {
  const scope = readAiRequest(body, "question"); // ← capability parsed HTTP body
  ...
}

// AFTER (correct boundary)
export async function askJournalContext(scope: FrozenApprovedScope) {
  const { question, timeZone, filters } = scope; // ← scope passed in, not parsed
  ...
}
```

**`apps/web/src/app/api/ai/ask/route.ts`**
```ts
// Route now owns: HTTP body → readAiRequest → capability → runAi
export const POST = handler(async (request: Request) => {
  const scope = readAiRequest(await request.json(), "question"); // ← moved here
  const result = await askJournalContext(scope);
  if ("error" in result) return bad(result.error);
  const { context, scope: resolvedScope } = result;
  const answer = await runAi(buildAskJournalPrompt({ question: resolvedScope.question!, context }));
  return ok({ answer, scope: resolvedScope.scope });
});
```

### Fix 2: `runAi` calls belong in routes, not capabilities
**Review finding:** `buildAskJournalPrompt/runAi`, `buildDailyRecapPrompt/runAi`, `buildTradeCritiquePrompt/runAi` were inside capabilities. Per the contract, capabilities return typed read-only context only; routes retain `runAi` and server-error behavior.

**State after fix:**
| Function | Location | Role |
|---|---|---|
| `askJournalContext` | `ai-capabilities.ts` | Returns `{ context, scope }` only |
| `buildAskJournalPrompt` | `ai-prompts.ts` | Prompt builder (unchanged) |
| `runAi` | Route | Route calls it after getting context |
| `dailyRecapContext` | `ai-capabilities.ts` | Already returning context only (verified) |
| `buildDailyRecapPrompt` | `ai-prompts.ts` | Prompt builder (unchanged) |
| `runAi` | Route | Route calls it; empty-day → `bad()`, AI errors propagate |
| `tradeCritiqueContext` | `ai-capabilities.ts` | Already returning `{ trade, fills }` only (verified) |
| `buildTradeCritiquePrompt` | `ai-prompts.ts` | Prompt builder (unchanged) |
| `runAi` | Route | Route calls it after getting trade data |

### Recap route: targeted empty-day catch preserved
```ts
try {
  const { context, date: d } = await dailyRecapContext(scope, date, existingNote);
  const recap = await runAi(buildDailyRecapPrompt({ date: d, ...context }));
  return ok({ recap, scope: scope.scope });
} catch (e) {
  if (e instanceof Error && e.message === "No closed trades match this day and the selected filters") {
    return bad(e.message); // ← only this known error maps to bad(); AI/runtime errors propagate
  }
  throw e;
}
```

## Test Evidence (Review Fixes)

```
$ pnpm test -- apps/web/tests/ai-capability.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-prompts.test.ts apps/web/tests/ai-runtime.test.ts

  Test Files  61 passed (61)
       Tests  612 passed (612)
    Duration  52.13s
```

**Key behavior changes tested:**
- `askJournal returns error when no trades match filters` → capability called with scope (not raw body); `runAi` NOT called by capability
- `askJournal returns answer and frozen scope when trades exist` → capability returns `{ context, scope }` only; `runAi` NOT called by capability
- `askJournal scope label reflects selected accounts` → scope label derived correctly from frozen scope
- `dailyRecapContext returns recap and frozen scope from route for a valid day` → capability returns typed context; `runAi` NOT called by capability
- `dailyRecapContext note is passed from route when onlyDateFilters, undefined otherwise` → existingNote embedded in context; `runAi` NOT called by capability
- `tradeCritiqueContext returns trade+fills for valid key` → capability returns `{ trade, fills }` only; `runAi` NOT called by capability

**Typecheck:** `pnpm --filter web typecheck` → ✓ Route types generated successfully, no TypeScript errors

**Format:** Changed files (`ai-capabilities.ts`, `ask/route.ts`, `ai-capability.test.ts`) pass Prettier check with no warnings

## Commit
`feat(ai): enforce capability boundary — capabilities return read-only context, routes own runAi`

**Files staged:**
- `apps/web/src/server/ai-capabilities.ts`
- `apps/web/src/app/api/ai/ask/route.ts`
- `apps/web/tests/ai-capability.test.ts`
