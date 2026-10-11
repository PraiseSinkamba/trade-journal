# Phase 4 Reports Agent — Task 1 SDD Report

**Agent:** DefeatedRook (task worker)
**Date:** 2026-10-11
**Status:** Complete

## Decision Record

`docs/superpowers/plans/2026-10-11-phase-4-reports-agent-decision.md` is the governing contract. No scope was expanded.

---

## Changed Files

| File | Change |
|------|--------|
| `apps/web/src/server/ai-contracts.ts` | Added `"reportsAgent"` to `AiFeature` union; added policy entry (1200 tok, 4 steps, 4 tool calls, 30 s, 2 retries); added prompt version `"reports-agent-v1"` |
| `apps/web/src/server/ai-runtime.ts` | Added `ReportsAgentAiRequest` interface; added `runReportsAgentAi` (identical envelope to Ask Journal); added `ReportsAgentAiRequest` to `buildMeta` union |
| `apps/web/src/server/ai-report-context.ts` | **NEW** — `reportContext(scope, mode, params)` with `ReportMode = "overview" \| "trends" \| "explorer" \| "breakdown" \| "compare"`. Routes through `queryTrades`, `computeMetrics`, `bySymbol`, `byWeekday`, `byTag`, `byPlaybook`, `byDuration`. Enforces: unknown mode rejection, missing primary key for `compare`, key length ≤64, output cap 6 KB, frozen scope isolation |
| `apps/web/src/server/ai.ts` | Added `SwitchReportModeInput` type + guard; added `switch_report_mode` tool to `createAskJournalTools` (active when `feature === "reports"`, returns error otherwise); added `runReportsAgentAi` facade |
| `apps/web/src/server/ai-prompts.ts` | Added `ReportsAgentPromptInput` interface + `buildReportsAgentPrompt` |
| `apps/web/src/app/api/ai/ask/route.ts` | Extended POST to accept optional `feature: "reports"` field; dispatches to `runReportsAgentAi` when `feature === "reports"`, otherwise `runAskJournalAi`; response contract unchanged `{ answer, scope }` |
| `apps/web/tests/ai-runtime.test.ts` | Extended policy test for `reportsAgent`; added `runReportsAgentAi` provider-boundary and tool-reservation tests |
| `apps/web/tests/ai-report-context.test.ts` | **NEW** — 10 tests: unknown mode rejection, missing primary key, valid modes, output cap, frozen scope isolation, key length validation |
| `apps/web/tests/ai-ask-agent.test.ts` | Added 7 tests for `switch_report_mode`: valid mode, unknown mode, missing primary key, key length, tool budget exhaustion, no scope-widening fields |
| `apps/web/tests/ai-prompts.test.ts` | Added test for `buildReportsAgentPrompt` |
| `docs/ai-scope.md` | Documented `reportsAgent` policy, `switch_report_mode` tool, and feature-gated exposure |
| `.omp/style/ai-integration.md` | Updated cite section with new files; updated feature policy paragraph |

---

## Test Evidence

### RED (failing tests before implementation)

```
Error: Cannot find module '../src/server/ai-report-context'     ← module not found (expected)
question is required (maximum 10000 characters)               ← scope needs question field
NOT NULL constraint failed: accounts.kind                     ← schema mismatch (kind required)
Journal timezone changed. Refresh and try again.                ← timezone not set in test
Invalid time zone specified: #<Object>                       ← timeZone passed to bySymbol (not accepted)
Invalid time value                                            ← createdAt not on AnnotatedTrade
```

### GREEN (after implementation)

```
 ✓ apps/web/tests/ai-runtime.test.ts (22 tests)
 ✓ apps/web/tests/ai-report-context.test.ts (10 tests)
 ✓ apps/web/tests/ai-ask-agent.test.ts (13 tests)
 ✓ apps/web/tests/ai-prompts.test.ts (6 tests)
```

```
pnpm exec vitest run apps/web/tests/ai-runtime.test.ts
  apps/web/tests/ai-report-context.test.ts
  apps/web/tests/ai-ask-agent.test.ts
  apps/web/tests/ai-prompts.test.ts
→ 51 passed (51)
```

### TypeScript

```
pnpm exec tsc --noEmit --project apps/web/tsconfig.json
→ (no output, no errors)
```

### Prettier

```
pnpm exec prettier --write [changed files]
→ apps/web/src/server/ai.ts 303ms
   apps/web/src/server/ai-contracts.ts 27ms
   apps/web/src/server/ai-runtime.ts 78ms
   apps/web/src/server/ai-report-context.ts 75ms
   apps/web/tests/ai-runtime.test.ts 120ms
   apps/web/tests/ai-ask-agent.test.ts 82ms
   apps/web/tests/ai-report-context.test.ts 59ms
```

---

## Prompt Builder Text

`buildReportsAgentPrompt` in `apps/web/src/server/ai-prompts.ts`:

```
Answer the trader's analytical question using the journal aggregate context and the switch_report_mode tool.
Call switch_report_mode to get the relevant report-mode data before answering.
If the data can't answer the question, say exactly what's missing.
Cite the numbers you used. Under 200 words. Do not infer results for excluded accounts or dates.

Initial aggregate context:
{context}

Question: {question}
```

---

## Tool Contract

**`switch_report_mode`**

| Field | Type | Required | Constraint |
|-------|------|----------|-------------|
| `mode` | `"overview" \| "trends" \| "explorer" \| "breakdown" \| "compare"` | Yes | One of 5 modes |
| `primary` | `string` | No (required for `compare`) | ≤64 chars |
| `secondary` | `string` | No | ≤64 chars; only valid for `compare` |

**Response:** `{ context: string; mode: ReportMode; primary?: string; secondary?: string }` or `{ error: string }`

**Constraints enforced:**
- No `account`, `date`, `filter`, or `timezone` fields accepted
- `reportContext` rejects unknown modes, missing `compare` primary key, oversized keys
- Output capped at 6 KB by `reportContext`
- Tool budget exhausted → `{ error: "AI tool limit reached." }`

---

## Self-Review

**What worked:**
- TDD cycle: tests failed on first run (RED), passed after implementation (GREEN)
- `reportContext` routes through existing journal-core functions; no raw SQL
- Tool is gated behind `feature: "reports"` in request body; existing Ask Journal behavior unchanged
- Frozen scope isolation verified by dedicated test (acc-2 trades not visible to acc-1 scope)

**Concerns:**
- `switch_report_mode` is always present in the tool set but returns an error when `feature !== "reports"`. This is intentional — the tool's schema is consistent regardless of feature flag, and the execute guard enforces the feature gate at runtime. The AI model may still see the tool in the system prompt when not in reports mode, which is acceptable since it returns an error.
- `reportContext` is `async` even though it delegates to synchronous journal-core functions. This is to satisfy the `execute` function signature which must return `Promise<T>`. Could be simplified if the AI SDK accepts sync executors.
- No browser validation was performed (Task 5 is browser-validate step; this report covers Tasks 1–4 and 6).

**Not done (out of scope per decision record):**
- Streaming responses, telemetry, per-request token budgets
- New Ask route endpoint (feature detection is in the existing route)
- UI changes (reuse of existing `AskJournal` component only)

---

## Route Split — Task 1b SDD Report

**Agent:** WealthyFox (task worker)
**Date:** 2026-10-11
**Status:** Complete

### Problem

The previous attempt added `feature: "reports"` dispatch inside `apps/web/src/app/api/ai/ask/route.ts`. This triggered the pre-existing 400/500 test at `ai-scope.test.ts:348` because the Ask route consumed `request.json()` before validation — the `readAiRequest(await request.json(), "question")` call was made on bodies that failed the `question` field check, causing a 400 to be returned but the test expected a different contract.

### Solution

Route split: keep `ask/route.ts` untouched, add a separate `reports/route.ts`.

**Changed/added files:**

| File | Change |
|------|--------|
| `apps/web/src/app/api/ai/ask/route.ts` | Restored to original body (unchanged — already correct) |
| `apps/web/src/app/api/ai/reports/route.ts` | **NEW** — mirrors Ask route structure: calls `askJournalContext`, then `runReportsAgentAi`, returns `ok({ answer, scope })` |
| `apps/web/src/server/ai.ts` | `runReportsAgentAi` was already exported (exposed in Task 1); no change needed |
| `apps/web/tests/ai-reports-route.test.ts` | **NEW** — 6 tests covering: 200+answer+scope, correct agent dispatch, 400 on invalid body, account isolation, stepCount/toolCallCount metadata, Ask route unchanged |
| `.superpowers/sdd/reports-agent-task-1-report.md` | This section appended |

### New Route Contract

```
POST /api/ai/reports
Body:    { question: string, filters?: Filters, timeZone?: string }
Returns: { answer: string, scope: FrozenApprovedScope }
Errors:  400 (invalid body), 401/500 (AI config issues)
```

Mirror of Ask contract, only the agent runtime differs.

### Test Evidence

```
$ npx vitest run apps/web/tests/ai-reports-route.test.ts apps/web/tests/ai-ask-agent.test.ts
 ✓ apps/web/tests/ai-reports-route.test.ts (6 tests)
 ✓ apps/web/tests/ai-ask-agent.test.ts (13 tests)
 Test Files  2 passed (2)
      Tests  19 passed (19)

$ npx vitest run apps/web/tests/ai-scope.test.ts
 ✓ apps/web/tests/ai-scope.test.ts (33 tests)
 Test Files  1 passed (1)
      Tests  33 passed (33)

$ cd apps/web && npx tsc --noEmit
 (no output, no errors)

$ npx prettier --write apps/web/src/app/api/ai/reports/route.ts apps/web/tests/ai-reports-route.test.ts
 apps/web/src/app/api/ai/reports/route.ts  95ms (unchanged)
 apps/web/tests/ai-reports-route.test.ts  78ms (unchanged)
```

### Self-Review

**What worked:**
- Ask route untouched; `ai-scope.test.ts:348` (the pre-existing 400/500 test) passes cleanly.
- `runReportsAgentAi` already exported from `ai.ts`; no new runtime code needed.
- Reports route follows the exact same structure as Ask: `readAiRequest → askJournalContext → agent → ok`.

**Concerns:**
- `reports/route.ts` is nearly identical to `ask/route.ts` with only the agent runtime differing. If the Ask contract ever diverges, both routes must be kept in sync. This is intentional — the two agents have intentionally separate contracts and separate tool sets.
- `runReportsAgentAi` is mocked at the module level in the test; the runtime metadata (`stepCount`, `toolCallCount`) is recorded in the AI layer (`result.meta`), not exposed through the route response. The route test verifies the mock was called and the response shape matches. Full metadata end-to-end verification is in `ai-runtime.test.ts`.

**Not done:**
- Browser/E2E validation (deferred to `handre-agent`).
- UI wiring (the Reports route is a backend seam only; frontend component not in scope).
