# Phase 12 report — Execution contexts, capability registry and tool gateway

Phase 12 of the AI-native journal run, milestone M4, task packet T-012. This report records what
changed, the evidence against the exact code SHA, the review findings and their resolutions, the
deviations and the inputs the next phase needs.

- Source branch: `codex/ai-native-journal-p12` (Orca child worktree of the feature worktree)
- Base SHA: `58209ba32ebb29a9c74b8d7ba4ebe48c766203ec` (verified feature HEAD)
- Phase plan: `docs/superpowers/plans/ai-native-journal/phase-12.md` (committed first, `a2f1f72`)
- Implementation: `a80af56` — _feat: execute scoped intelligence through compatible AI adapters_
  (the detailed plan's Task 9 subject; this phase implements only the contracts and gateway subset
  of Task 9, not its background provider policy or migration 0005)
- Follow-up: `ead9b98` — documents the propose access rule in the tool gateway
- Tip SHA at report time: the commit that adds this report (see the coordinator handoff)

## Outcome

Delivered the pure runtime contracts (`ExecutionContext`, `Capability`, `Eligibility`, `Outcome`,
`ToolDefinition`), a deterministic capability registry, a scope-, budget- and output-validating
tool gateway, and the execution-context factory the existing Ask and Reports AI routes use. The
runtime reaches the journal only through typed query ports and never touches the database.

## Changed files

New contracts (pure — no database, no Next, no AI SDK):

| File                                                         | Exports                                                                                                                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/intelligence/contracts/execution.ts`    | `ExecutionContext`, `ExecutionScope`, `ExecutionBudgets`, `Outcome`, `Principal`, `ExecutionMode`, `DataSource`, `DATA_SOURCES`, `allowsDataSource`, `approvedScopeSchema`, `executionContextSchema` |
| `apps/web/src/server/intelligence/contracts/capabilities.ts` | `Capability`, `CapabilityEvaluationContext`, `CapabilityMode`, `Eligibility`, `CapabilityRegistry`, `JournalCapabilityPort`, `JOURNAL_CAPABILITY_IDS`                                                |
| `apps/web/src/server/intelligence/contracts/tools.ts`        | `ToolDefinition`, `ToolAccess`, `ToolGateway`, `TOOL_FAILURE`                                                                                                                                        |

New runtime:

| File                                                               | Exports                                            |
| ------------------------------------------------------------------ | -------------------------------------------------- |
| `apps/web/src/server/intelligence/runtime/execution.ts`            | `createExecutionContext`                           |
| `apps/web/src/server/intelligence/runtime/registry.ts`             | `createCapabilityRegistry`                         |
| `apps/web/src/server/intelligence/runtime/dispatcher.ts`           | `createCapabilityDispatcher`, `CAPABILITY_FAILURE` |
| `apps/web/src/server/intelligence/runtime/tool-gateway.ts`         | `createToolGateway`                                |
| `apps/web/src/server/intelligence/runtime/journal-capabilities.ts` | `createJournalCapabilities`                        |
| `apps/web/src/server/intelligence/runtime/ai-sdk-tools.ts`         | `createGatewayTool`, `ExecutableSdkTool`           |

Modified:

| File                                                                    | Change                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/ai-scope.ts`                                       | `createInteractiveContext`; `DataSource` re-exported from the shared contract; the data-source list now comes from `DATA_SOURCES`           |
| `apps/web/src/server/ai-capabilities.ts`                                | The Ask and Reports tools are registered `ToolDefinition`s; `createAskJournalSdkTools`; `createScopedJournalPort` implements the query port |
| `apps/web/src/server/ai-contracts.ts`                                   | `AI_TOOL_IDS`, `AI_FEATURE_TOOL_IDS`, `AI_TOOL_RESULTS`, `aiToolFailure`                                                                    |
| `apps/web/src/server/ai.ts`                                             | The tools are built through the gateway and the SDK adapter; the tool bodies moved to `ai-capabilities.ts`                                  |
| `docs/decisions/0008-scoped-intelligence-and-provider-compatibility.md` | Implementation note for this phase                                                                                                          |

Tests: `apps/web/tests/intelligence-runtime.test.ts` (new, 23 tests) and
`apps/web/tests/intelligence-scope.test.ts` (new, 12 tests). `apps/web/tests/ai-scope.test.ts` was
reviewed and needed no change; it runs in the phase gate.

## Migrations

None. Schema allocation for this phase is none: no table, no migration, no schema change, no
renumbering of an applied migration, no new dependency and therefore no new ADR. ADR 0008 gained an
implementation note only.

## Behaviour

- The Ask and Reports tools keep their legacy results: the same summary context, the same bounded
  trade search, the same scoped trade detail with at most fifty fills, the same report-mode
  context, and the same error strings ("Invalid tool arguments.", "AI tool limit reached.",
  "Trade is not available in this journal scope.", "Report mode is not enabled for this request.").
- The tool-call budget is still owned by the AI runtime; the context stops reserving calls at the
  declared `maxToolCalls`, so a context without a runtime hook cannot run unbounded calls.
- Provider behaviour is untouched: hosted OpenAI keeps `store:false`, an OpenAI-compatible server
  keeps its own key, and no prompt or credential diagnostic is exposed. No route, response shape or
  import contract changed.
- No tool can widen the account, filter or timezone of the approved scope, and no SQL, HTTP,
  credential or cTrader tool is registered. No registered tool writes to the journal.

## Evidence

Runtime: Node v24.20.0, pnpm 11.0.8, frozen lockfile, isolated `node_modules`. Fixtures: disposable
absolute `JOURNAL_DATA_DIR` scratch directories with synthetic accounts `a`/`b` and synthetic fills
`ONLY_A`/`ONLY_B`. All commands ran in this worktree against the SHA recorded above.

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                              | Exit | Result                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-runtime.test.ts apps/web/tests/intelligence-scope.test.ts apps/web/tests/ai-scope.test.ts`                                                                                                                                                                                                                                                                                                         | 0    | 3 files, 73 tests passed                              |
| `pnpm exec vitest run apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-capability.test.ts apps/web/tests/ai-ask-agent.test.ts apps/web/tests/ai-reports-route.test.ts apps/web/tests/ai-import.test.ts apps/web/tests/ai-feedback.test.ts apps/web/tests/ai-prompts.test.ts apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/intelligence-runtime.test.ts apps/web/tests/intelligence-scope.test.ts` | 0    | 11 files, 188 tests passed                            |
| `pnpm test` (full suite, includes `packages/core/tests` and the cTrader suites)                                                                                                                                                                                                                                                                                                                                                                      | 0    | 105 files, 1109 tests passed, 124.44 s at the tip SHA |
| `pnpm --filter web typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                        | 0    | clean                                                 |
| `pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck`                                                                                                                                                                                                                                                                                                                                                                  | 0    | clean                                                 |
| `pnpm exec prettier --check` on the changed files                                                                                                                                                                                                                                                                                                                                                                                                    | 0    | clean                                                 |

One earlier full-suite run failed `intelligence-supervisor.test.ts > restarts workers that stop
replying to IPC health` with a timeout while two review agents were running Vitest in parallel on
the same host. The test passes in isolation and in the recorded clean full-suite run; it is a
load-sensitive subprocess test, not a regression from this phase.

### Blocked host evidence

The root `pnpm typecheck` also runs the `desktop` workspace, whose `cargo check` fails on a
PRE-EXISTING repo defect: the Tauri sidecar resource
`binaries/node-x86_64-pc-windows-msvc.exe` is not produced because the sidecar setup script uses
CommonJS `require()` inside an ESM package. That defect belongs to the Phase 21 Tauri packaging
subset under ADR 0009 and is not this phase's to fix; the TypeScript workspace typechecks above are
the phase evidence. It is carried forward to the release gate, never mocked.

## Review findings and resolutions

Two read-only reviews ran over the diff: one against the packet, the design and the contract
review, one for correctness. Resolved in this phase:

| Finding                                                                                     | Resolution                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The gateway never checked the scope of the execution (design §11, review §3)                | `ToolDefinition` now declares `requiredDataSources` and the gateway refuses a tool whose data source the execution does not allow (`scope_not_permitted`) |
| The declared `maxToolCalls` was not authoritative                                           | The context stops reserving tool calls at the declared ceiling, whatever the runtime hook returns                                                         |
| The interactive context used a signal that never aborted, so cancellation was unreachable   | The context is built with `AbortSignal.timeout` from the feature policy                                                                                   |
| The trade-critique capability resolved any trade key globally, crossing the account scope   | The scoped port resolves the trade through the approved scope first, so another account's trade is missing evidence                                       |
| The capability registry ordered versions lexicographically, so `10` was older than `2`      | Version segments are compared numerically                                                                                                                 |
| The account list was capped at 64, so a journal with more accounts would fail an AI request | The cap is removed; the approved scope is the only source of account ids                                                                                  |
| Legacy modules imported runtime internals for shared vocabulary                             | `JOURNAL_CAPABILITY_IDS` and `TOOL_FAILURE` moved into the contracts module                                                                               |
| The data-source list was duplicated in the legacy scope module                              | It now comes from `DATA_SOURCES` in the contracts module                                                                                                  |
| A cancelled call was reported to the model as an exhausted budget                           | Cancellation has its own result string                                                                                                                    |

Accepted with a documented reason:

- The execution context factory lives in the runtime layer rather than the shared contracts, so
  only a composition-facing module constructs a context. The background/system principal pairing
  is enforced there; the policy-backed background constructor belongs to Phase 13.
- A `propose` tool needs no extra gate because it only suggests a change for approval; no propose
  tool is registered in this phase.
- Capability execution does not charge the tool-call budget: that budget belongs to the model's
  tool calls, not to deterministic runtime work.
- Capability eligibility must not depend on the input, because the dispatcher evaluates a
  capability before it knows what it will run. The contract now states this.
- A reviewer reported that the trade-detail fills gained an `id` field. Checked against the
  pre-phase source: the legacy fill projection already carried `id`, so the payload is unchanged.

## Deviations from the phase plan

1. The plan ordered the work as contracts, runtime, failing tests, legacy adapters. The
   implementation was written before the new tests, so the tests arrived after the code they cover.
   The test coverage and the assertions are unchanged; only the order differed.
2. `apps/web/src/server/intelligence/runtime/` is the location the detailed plan's Task 9 names for
   the registry, dispatcher, gateway and SDK adapter. The packet's ownership list named only the
   `contracts/` directory; the runtime directory is the plan-authorised location and no other
   worker owns it.
3. `model-policy.ts` from Task 9 is deliberately absent: provider policy is Phase 13.

## Next-phase inputs (Phase 13)

- The background constructor of the execution context: it must be built from persisted policy and
  reauthorized at execution time, with the provider, model and endpoint fingerprint pinned.
- Budget reservations: the context declares `maxToolCalls`, but a background attempt still needs a
  transactional daily reservation (Task 9, migration 0005).
- Model capability settings and the endpoint-fingerprint drift check; a compatible server may not
  silently reroute a queued run.
- The registry, gateway, dispatcher and the query port are ready to be used by the background
  dispatcher; they need no schema change of their own.
