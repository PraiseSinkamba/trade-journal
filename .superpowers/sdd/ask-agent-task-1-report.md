# Ask Journal Agent — Phase 3 Task 1 Report

## Status

Review fixes are applied; verification and the task-files-only commit require the main agent because this worker has no command-execution or Git tool.

## Changed Files

| File | Change |
| --- | --- |
| `apps/web/src/server/ai-contracts.ts` | Added the closed `askJournalAgent` feature, policy (`30s`, `4` steps, `4` tool calls), prompt version, and redacted step/tool-call metadata. |
| `apps/web/src/server/ai-runtime.ts` | Added one provider-neutral `generateText` tool loop with `isStepCount`, runtime-owned tool-call budget, a 30s timeout, safe budget exhaustion behavior, redacted metadata, and a conservative per-step output allocation whose four-step sum cannot exceed the 1,200-token Ask execution budget. |
| `apps/web/src/server/ai.ts` | Added frozen-scope closures for `get_journal_summary`, `find_trades`, and `get_trade_detail`, plus the Ask-only facade. |
| `apps/web/src/server/trades-query.ts` | Added an optional timezone argument so scoped tools use the approved timezone if the journal setting changes during an agent execution. |
| `apps/web/src/server/ai-prompts.ts` | Updated the initial Ask prompt to distinguish aggregate context from bounded read-only tool results. |
| `apps/web/src/app/api/ai/ask/route.ts` | Migrated only Ask Journal to one `runAskJournalAi` execution while retaining `{ answer, scope }`. |
| `apps/web/tests/ai-ask-agent.test.ts` | Added deterministic tool scope, invalid-argument, out-of-scope key, no-write, budget, and frozen-timezone behavior tests. |
| `apps/web/tests/ai-scope.test.ts` | Updated Ask route seam and asserts exactly one agent execution with the unchanged response shape. |
| `apps/web/tests/ai-runtime.test.ts` | Added finite Ask policy, one loop invocation, total-output allocation, runtime-supplied four-call budget / fifth-call denial, step stopper, and agent metadata coverage. |
| `apps/web/tests/ai-capability.test.ts` | Added a deterministic initial-aggregate frozen-timezone regression test. |
| `apps/web/tests/ai-prompts.test.ts` | Updated the Ask prompt behavior assertion. |
| `docs/ai-scope.md` | Documented the scoped Ask tool contract, bounds, and verification surface. |
| `.omp/style/ai-integration.md` | Updated the current AI contract to identify Ask as the sole bounded tool-using flow. |

## Tool Contract

- `get_journal_summary({})` returns the route-derived aggregate context only.
- `find_trades({ symbol?, outcome?, dateOrder? })` reuses `queryTrades(scope.filters, scope.timeZone)`, returns at most five deterministic summaries, and accepts no account/date/filter/timezone/provider/model/settings arguments.
- `get_trade_detail({ key })` verifies the key inside that same scoped query before returning one bounded trade projection and at most fifty chronological fills.
- Each closure returns a safe error object for invalid input, an unavailable/out-of-scope key, or an exhausted runtime budget. Tool bodies call only existing read services and do not write.

## Performance and Budget Behavior

- One `generateText` Ask execution per successful route request; no direct prompt fallback.
- Policy fixes `maxOutputTokens: 1200` total for Ask execution, allocated as 300 per maximum model step; retries, timeout, maximum steps, and maximum tool calls remain `2`, `30000`, `4`, and `4`.
- The runtime supplies the call-budget closure to tools. A fifth tool attempt reads no journal data; a completed loop with a budget breach or step-limit tool-call stop returns the established safe AI error path.
- Trade search and fill output are capped at five and fifty records respectively; sorting uses stable date-plus-key/id ordering.

## Review Fixes

- The AI SDK applies `maxOutputTokens` to each model step. Ask has four fixed maximum steps, so the runtime passes `Math.floor(1200 / 4)` (300) per step; four allocations cannot exceed the 1,200-token execution cap.
- `askJournalContext` now calls `queryTrades(filters, timeZone)`, using the exact approved timezone already passed to every Ask tool.
- The runtime test captures and invokes the reservation closure passed into `createTools`, proving calls one through four are accepted and the fifth is rejected at the runtime/tool boundary.
- The capability test creates a UTC day-boundary trade, approves the UTC scope, changes the stored journal timezone to `America/New_York`, and asserts the initial aggregate still contains the UTC-scoped symbol.

## RED / GREEN Evidence

### RED

The output-allocation and frozen-timezone regression tests were added before their production changes. This worker cannot execute commands, so it records no unobserved failing-command outcome.

### GREEN verification required from the main agent

```text
pnpm exec vitest run apps/web/tests/ai-ask-agent.test.ts apps/web/tests/ai-capability.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-prompts.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-feedback.test.ts
pnpm --filter web typecheck
pnpm exec prettier --check apps/web/src/server/ai-contracts.ts apps/web/src/server/ai-runtime.ts apps/web/src/server/ai.ts apps/web/src/server/ai-capabilities.ts apps/web/src/server/trades-query.ts apps/web/src/server/ai-prompts.ts apps/web/src/app/api/ai/ask/route.ts apps/web/tests/ai-ask-agent.test.ts apps/web/tests/ai-capability.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-prompts.test.ts docs/ai-scope.md .omp/style/ai-integration.md .superpowers/sdd/ask-agent-task-1-report.md
```

## Self-Review

- Ask is the only migrated flow; recap, critique, and import retain direct workflows.
- The route creates the frozen scope before any agent code and passes no client-selected provider/model/settings data.
- Tool schemas and runtime guards reject unsupported fields; scope verification occurs again before trade detail reads.
- Runtime metadata contains feature/version/counts only, never prompt, response, key, or journal data.
- No dependency, streaming, external service, write path, retry policy change, or response-shape change was introduced.

## Commits

No commit was created by this worker because git execution is unavailable. The main agent must stage only the files above, run the recorded checks, update this section with the commit hash, and commit the task files.