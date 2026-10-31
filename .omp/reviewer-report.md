## Verdict: PASS

## Reviewer Report — Phase 12 repair: legacy tool-call budget error

Diff reviewed: `85a4226b118daad6892b33377905f390519020cf..<repair tip>` (branch
`codex/ai-native-journal-p12`).

Scope reviewed (this repair only):

- `apps/web/src/server/intelligence/runtime/execution.ts` — the `consumeToolCall` wrapper
- `apps/web/tests/intelligence-runtime.test.ts` — one added test
- `apps/web/tests/ai-runtime.test.ts` — one added test (coordinator-approved additive extension)
- `docs/superpowers/reports/ai-native-journal-phase-12.md` — repair section, corrected budget claim
- `docs/decisions/0008-scoped-intelligence-and-provider-compatibility.md` — narrowed implementation note

### PASS / FAIL

PASS — the blocking defect is fixed and the two documentation claims are now true of the code.

### Findings

- [PASS] `execution.ts` — the wrapper no longer short-circuits before the runtime hook. It always
  calls `reserve()`, so the runtime observes the exhaustion and can raise the request-level limit
  error; the context ceiling stays authoritative, because the call is refused whenever
  `reserved >= maxToolCalls` whatever the hook answers; `reserved` still counts only successful
  reservations. The hook signature, the `ExecutionContext` contract, the gateway, the registry, the
  dispatcher and the AI SDK adapter are unchanged.
- [PASS] `intelligence-runtime.test.ts` — the new test asserts the hook is called five times for a
  ceiling of four and that the fifth call is refused. It fails against the pre-repair code.
- [PASS] `ai-runtime.test.ts` — the new test runs the production chain (runtime →
  `createAskJournalTools` → `createInteractiveContext` → gateway) with five parallel tool calls in
  one step and asserts the exact legacy error, so a model that exceeds `maxToolCalls` gets
  "AI request could not complete within the journal context limit. Please try a more specific
  question." and not a normal answer. It fails against the pre-repair code. No existing test in the
  file was modified, weakened or deleted.
- [PASS] Phase report — the corrected claim states where the ceiling lives and that the runtime is
  notified at the ceiling; the repair section records the defect, the fix, the review finding, the
  new tests and the verification results with exit codes and runtimes.
- [PASS] ADR 0008 — the implementation note now states the budget path explicitly and no longer
  claims unchanged results without qualification.
- [PASS] Scope — no schema change, no migration, no new dependency, no change to the hook
  signature, the contracts, the gateway, the registry, the dispatcher or the SDK adapter.

### Verification

- `pnpm exec vitest run apps/web/tests/intelligence-runtime.test.ts apps/web/tests/intelligence-scope.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-runtime.test.ts` — exit 0, 4 files, 97 tests passed
- `pnpm --filter web typecheck` — exit 0, clean
- Failing-before check: with only the `execution.ts` change stashed, both new tests failed and the
  rest of the suite passed.
