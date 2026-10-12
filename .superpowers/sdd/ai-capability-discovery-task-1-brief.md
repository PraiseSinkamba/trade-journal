### Task 1: Establish the Phase 2 capability contract from current behavior

**Files:**
- Create: `docs/superpowers/research/2026-10-10-ai-capability-extraction.md`
- Test: no new tests; discovery validates against existing source and focused test evidence only.

**Interfaces:**
- Consumes: `readAiRequest`, `accountContext`, `queryTrades`, `getTradeByKey`, `listExecutions`, the current Ask/recap/critique routes, and AI scope/UI tests.
- Produces: an evidence-cited discovery record that a follow-up implementation plan can use to define exact capability inputs, outputs, ownership, bounds, and route cutovers.

**Global constraints:**
- The completed AI execution foundation is already present in `apps/web/src/server/ai-runtime.ts`, `ai-contracts.ts`, and `ai-prompts.ts`; do not modify it.
- Preserve validated account/filter/date/timezone scope from `readAiRequest`; missing or invalid input must never widen scope.
- Recap and critique remain direct calls. AI import remains a schema-bound preview/review/commit workflow.
- Do not add an agent loop, tool calling, raw database capability, provider configuration, persistence side effect, dependency, telemetry endpoint, or external analytics.
- Do not change API response contracts, prompt text, user-visible behavior, or existing tests during discovery.
- Do not write, stage, amend, or delete unrelated user changes.

1. Trace current read-only data paths with language-server references. Cover Ask Journal, daily recap, and critique. Record validation, query/service, metrics/context transformation, prompt-builder paths, and side effects that stay outside capabilities.
2. Specify the smallest immutable approved-scope value capabilities can accept, created only after `readAiRequest` validation. Include filters, selected accounts, timezone, display scope/context, and date/key constraint. Determine whether cloning/freezing is required from caller evidence.
3. Define only the minimum extracted read-only capability operations. For each: capability name, approved scope input, data read, typed output, result bound, and route consumer. No raw SQL, generic query language, writes, provider/settings access, or model-selected scope changes. Where no safe bound exists, state the current constraint and the smallest compatibility-preserving decision needed.
4. Name existing parity coverage and required deterministic capability tests: malformed scope, account isolation, empty result, timezone, recap-note exclusion, critique key scope. Tests must cover behavior, not forwarding.
5. Record safe cutover order and precise Phase 3 Ask-agent evidence gate. Absence of evidence means Ask stays direct.
6. Run `pnpm test apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-runtime.test.ts` and `pnpm exec prettier --check docs/superpowers/research/2026-10-10-ai-capability-extraction.md`. Commit only this new research record and `docs/superpowers/plans/2026-10-10-ai-capability-discovery.md` with a reviewer-readable outcome subject.