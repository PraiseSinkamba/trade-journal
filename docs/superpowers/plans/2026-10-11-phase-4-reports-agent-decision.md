---
status: in-progress
phase: 4
updated: 2026-10-11
---

# Phase 4 4.1 Decision Record — Reports Agent

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` for this scoped extension. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Ask Journal surface so the existing Reports page can ask analytical questions that currently require navigating between report modes.

**Architecture:** Add one new AI feature `reportsAgent` next to `askJournalAgent`. Add one new typed, read-only capability `reportContext(scope, mode, params)` that calls the existing `queryTrades`, `computeMetrics`, and report-mode query functions and returns a bounded text summary. Expose one new tool `switch_report_mode` to the Ask Journal tool loop. The tool narrows the current report view inside the same frozen scope; it does not switch pages or invoke a write.

**Tech Stack:** Next.js App Router, TypeScript, SQLite/Drizzle, `@luxalgo/journal-core`, Vercel AI SDK tool loop, Vitest.

## Global Constraints

- The existing Ask Journal agent, recap, critique, and import are unchanged.
- The new `reportsAgent` reuses the same `FrozenApprovedScope`; tools cannot widen account/date/filter/timezone.
- `switch_report_mode` accepts `mode` and at most two narrow keys (`primary` ≤64 chars, `secondary` ≤64 chars); the tool rejects unknown keys, unknown modes, or unsupported parameters.
- `reportContext` is read-only and routes through existing query functions; no raw SQL, no broker SDK, no settings access.
- Total per-execution budget for the new feature: 1,200 output tokens distributed across 4 steps × 4 tool calls, 30 s, 2 retries. Same envelope as `askJournalAgent`.
- No new dependency, no telemetry, no external service, no streaming, no extra UI change beyond reusing the existing `AskJournal` component.
- No new file outside `apps/web/src/server/`, `apps/web/src/app/api/ai/`, `apps/web/tests/`, and `docs/`.

---

### Task 1: Add the `reportsAgent` feature policy and prompt version

**Files:**

- Modify: `apps/web/src/server/ai-contracts.ts`
- Modify: `apps/web/tests/ai-runtime.test.ts`

**Interfaces:**

- `AiFeature` includes `"reportsAgent"`.
- `AI_FEATURE_POLICIES.reportsAgent` matches `askJournalAgent` (1200 tok, 2 retries, 30_000 ms, 4 steps, 4 tool calls).
- `AI_PROMPT_VERSIONS.reportsAgent` is `"reports-agent-v1"`.

- [ ] **Step 1: Write the failing policy test**
- [ ] **Step 2: Add the feature to the union, policy, and prompt version; observe GREEN**
- [ ] **Step 3: Run `pnpm exec vitest run apps/web/tests/ai-runtime.test.ts` and the existing `ai-scope`/`ai-capability`/`ai-prompts` suites. Expected: all green**

### Task 2: Build the `reportContext` capability

**Files:**

- Create: `apps/web/src/server/ai-report-context.ts`
- Test: `apps/web/tests/ai-report-context.test.ts`

**Interfaces:**

- `reportContext(scope: FrozenApprovedScope, mode: ReportMode, params: { primary?: string; secondary?: string }): Promise<{ context: string } | { error: string }>`.
- `ReportMode = "overview" | "trends" | "explorer" | "breakdown" | "compare"`.
- Implementation reuses `queryTrades`, `computeMetrics`, `bySymbol`, `byWeekday`, `byTag`, `byPlaybook`, `byDuration` from `@luxalgo/journal-core`. No raw SQL.

- [ ] **Step 1: Write deterministic failing tests** for unknown mode rejection, missing key, empty result, account isolation, frozen-scope re-use, output size cap (≤6 KB).
- [ ] **Step 2: Implement `reportContext`** so all tests pass without changing the underlying data functions.
- [ ] **Step 3: Run `pnpm exec vitest run apps/web/tests/ai-report-context.test.ts`**

### Task 3: Add `switch_report_mode` to the Ask Journal tool loop

**Files:**

- Modify: `apps/web/src/server/ai.ts`
- Modify: `apps/web/src/server/ai-prompts.ts`
- Test: extend `apps/web/tests/ai-ask-agent.test.ts`

**Interfaces:**

- New tool `switch_report_mode({ mode: ReportMode; primary?: string; secondary?: string })` returns `{ context: string; mode: ReportMode; primary?: string; secondary?: string } | { error: string }`.
- Tool closure is bound to the route-created `FrozenApprovedScope`; arguments may not include account, date, filter, or timezone.
- Tool calls `reportContext` and returns the bounded text summary.

- [ ] **Step 1: Write failing tests for tool scope, mode whitelist, parameter validation, budget exhaustion, and that the runtime reserves 4 tool calls and denies the 5th.**
- [ ] **Step 2: Implement the tool and update the agent prompt to describe the new tool.**
- [ ] **Step 3: Re-run `pnpm exec vitest run apps/web/tests/ai-ask-agent.test.ts`**

### Task 4: Bind the Reports feature to the Ask route without changing the response contract

**Files:**

- Modify: `apps/web/src/server/ai.ts`
- Modify: `apps/web/src/app/api/ai/ask/route.ts` (only if required to detect the new feature)
- Test: extend `apps/web/tests/ai-ask-agent.test.ts`

**Interfaces:**

- The Ask route still returns `{ answer: string; scope: ... }`.
- The new tool is only exposed when the request's `feature` field requests it; otherwise the existing Ask Journal tool set is used.

- [ ] **Step 1: Write a failing test for the route selecting the tool set by feature**
- [ ] **Step 2: Implement the feature selection without breaking the existing tool set**
- [ ] **Step 3: Re-run the focused Ask agent suite and `ai-scope` suite**

### Task 5: Browser-validate the Reports agent

- [ ] **Step 1: Start the dev server with `JOURNAL_DATA_DIR=apps/web/data pnpm --filter web dev`**
- [ ] **Step 2: Open `/reports` with a known account and ask a question that requires switching modes**
- [ ] **Step 3: Verify the answer references the report-mode context and that the browser stays in the same scope**
- [ ] **Step 4: Screenshot the conversation and save under `docs/user-guide/ai/`**

### Task 6: Commit and document

- [ ] **Step 1: Prettier, typecheck, and full test suite**
- [ ] **Step 2: Commit only the task files; update the AI style guide with the new feature**
