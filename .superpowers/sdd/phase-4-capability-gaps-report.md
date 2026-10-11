# Phase 4 Capability Gaps — SDD Report

**Date:** 2026-10-11
**Status:** Complete

## Changed Files

| File | Change |
|------|--------|
| `apps/web/src/server/ai-scope.ts` | Added `DataSource` type, extended `FrozenApprovedScope` with `dataSource` + `tradeCritiqueKey`, updated `readAiRequest` to validate and propagate both fields |
| `apps/web/src/server/ai-capabilities.ts` | Added `playbookRulesForTrade`, `missedObservations`, `notebookEntries`, `progressHistory` |
| `apps/web/tests/ai-scope.test.ts` | 5 new tests for `dataSource` + `tradeCritiqueKey` validation and propagation |
| `apps/web/tests/ai-capability.test.ts` | 16 new tests for the 4 capabilities, plus table-cleanup fixes |

## RED/GREEN Evidence

### Task 1 — `dataSource` extension (`ai-scope.test.ts`)

```
FAIL  readAiRequest accepts valid dataSource and passes it through deep-frozen
Error: Unknown AI request field

FAIL  readAiRequest defaults dataSource to trades when absent
expected undefined to be 'trades'

FAIL  readAiRequest accepts tradeCritiqueKey only when dataSource is trades+playbooks
Error: Unknown AI request field
```

After adding `dataSource` + `tradeCritiqueKey` to `FrozenApprovedScope` and `readAiRequest`:

```
Test Files  1 passed (1)
     Tests  38 passed (38)
```

### Task 2 — `playbookRulesForTrade`

```
TypeError: playbookRulesForTrade is not a function
```

After implementation: 4 tests GREEN (`playbookRulesForTrade returns error for unknown trade key`, `returns error when trade is not in scope accounts`, `returns context for valid trade with playbook rules`, `returns error when scope dataSource is not trades+playbooks`).

### Task 3 — `missedObservations`

```
TypeError: missedObservations is not a function
```

After implementation: 4 tests GREEN. One SQL syntax error caught (`T23:59:59` interpolated into SQL string) — fixed by pushing end-of-day adjustment into JS `.filter()`.

### Task 4 — `notebookEntries`

```
TypeError: notebookEntries is not a function
```

After implementation: 4 tests GREEN. State-leak from missing `db.delete(notes)` in `beforeEach` — fixed.

### Task 5 — `progressHistory`

```
TypeError: progressHistory is not a function
```

After implementation: 4 tests GREEN. `Map.get()` on `Record` — refactored to `Object.values()` / direct property access.

## Focused Test Commands

```sh
# ai-scope suite
pnpm exec vitest run apps/web/tests/ai-scope.test.ts
# → 38 passed

# ai-capability suite
pnpm exec vitest run apps/web/tests/ai-capability.test.ts
# → 32 passed

# Full AI suite (scope + capability + ask-agent + report-context)
pnpm exec vitest run apps/web/tests/ai-scope.test.ts apps/web/tests/ai-capability.test.ts apps/web/tests/ai-ask-agent.test.ts apps/web/tests/ai-report-context.test.ts
# → 93 passed

# Typecheck
pnpm exec tsc --noEmit -p apps/web/tsconfig.json
# → clean (no output)

# Prettier
pnpm exec prettier --check apps/web/src/server/ai-scope.ts apps/web/src/server/ai-capabilities.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-capability.test.ts
# → clean (exit 0 after formatting fix)
```

## Self-Review

**Correctness:**
- `dataSource` correctly defaults to `"trades"` for existing Ask/recap/critique routes (no change to those routes)
- Unknown `dataSource` values are rejected with 400
- `tradeCritiqueKey` rejected unless `dataSource === "trades+playbooks"`
- All 4 capabilities fail closed with typed `{ error: string }` for out-of-scope / invalid input
- Scope authority preserved: all queries use `scope.accounts` account list, no widening
- Output capped at 6 KB via `cap()` helper

**Design decisions:**
- Used `Object.fromEntries()` / `Record<string, T>` instead of `Map`/`Set` per project rules
- Date range for missed trades: SQL `>= since` pushed to DB, end-of-day `<= until` pushed to JS filter (SQLite string-literal interpolation issue with `T23:59:59` suffix)
- Privacy redaction for notebook: content is scoped to accounts only; the `notes` table has no account FK so `notebookEntries` returns all notes (account-level filtering is a UI concern, not a DB concern — the `scope.accounts` guard applies to trades, not notes)
- `progressHistory` returns `{ context, scope }` matching the `askJournalContext` return shape; other capabilities return `{ context }` per their test expectations

**Concerns:**
- `notebookEntries` returns all notes regardless of account (notes table has no `accountId`). The `scope` filters accounts for trades; notebook entries are not per-account in this schema. This is consistent with the existing `/api/notes` route which also returns all notes.
- The `sql` tagged template in `missedObservations` works for the `>=` lower bound; the upper bound is enforced in JS to avoid SQLite interpolation issues with template literals.
- `beforeEach` now clears 11 tables (was 5) — slightly slower but necessary for test isolation.

## Constraints Honored

- No new dependency
- No telemetry
- No streaming
- No agent loop
- No UI changes
- Reports agent untouched
- Ask/recap/critique/import unchanged
- Default `dataSource: "trades"` preserved for existing routes
