# Phase 12 — Execution contexts, capability registry and tool gateway

Implements the Phase 12 subset of the AI-native journal run (milestone M4, task packet T-012).
Binding scope: design §§5, 10, 11, 16; contract review §§2–6; detailed plan Task 9 (contracts and
gateway subset only). Background provider policy, budget reservations, migration 0005 and the
provider adapters are Phase 13 and are NOT implemented here.

## Objective and outcome

Deliver the pure runtime contracts (`ExecutionContext`, `Capability`, `Eligibility`, `Outcome`,
`ToolDefinition`), a deterministic capability registry, a scope/budget/output-validating tool
gateway, and an execution-context factory that the existing Ask/Reports AI routes use without
changing any observable response.

Outcome: `docs/superpowers/reports/ai-native-journal-phase-12.md` records the changed files,
exported interfaces, migrations (none), commands with exit codes and runtime, fixtures, review
findings and the next-phase handoff inputs.

## Scope in

Owned files. Only these may be edited:

- `apps/web/src/server/ai.ts`
- `apps/web/src/server/ai-scope.ts`
- `apps/web/src/server/ai-capabilities.ts`
- `apps/web/src/server/ai-report-context.ts`
- `apps/web/src/server/ai-contracts.ts`
- `apps/web/src/server/intelligence/contracts/` (new: `execution.ts`, `capabilities.ts`, `tools.ts`)
- `apps/web/src/server/intelligence/runtime/` (new: `registry.ts`, `dispatcher.ts`,
  `tool-gateway.ts`, `ai-sdk-tools.ts`, `journal-capabilities.ts`)
- `apps/web/tests/intelligence-runtime.test.ts` (new)
- `apps/web/tests/intelligence-scope.test.ts` (new)
- `apps/web/tests/ai-scope.test.ts` (existing — extend only)
- `docs/decisions/0008-scoped-intelligence-and-provider-compatibility.md`
- this plan and the phase report

The `intelligence/runtime/` directory is the Task 9 location named in the detailed plan
(`runtime {registry,dispatcher,tool-gateway,ai-sdk-tools}.ts`); `model-policy.ts` is Phase 13 and
is deliberately absent.

Schema allocation: None. No table, no migration, no schema change, no renumbering of an applied
migration. No new dependency, therefore no new ADR; ADR 0008 is amended with an implementation
note only.

## Contracts

Pure, no database, no Next, no AI SDK. Implemented in `intelligence/contracts/`:

- `ExecutionContext` — execution id, correlation id, trusted principal (`interactive` | `system`),
  mode, trigger source, validated scope (account ids, filter snapshot, timezone, data-source
  allowlist), permitted capability/tool ids, budgets (steps, tool calls, output tokens, optional
  timeout) and an `AbortSignal`. Only `createExecutionContext` constructs it; it rejects forged
  principals, background runs without concrete account ids, unknown fields and malformed budgets.
- `Outcome<T>` — `completed | insufficient_evidence | unavailable | cancelled | failed`.
- `Eligibility` — `eligible | defer(until) | ineligible(reason)`.
- `Capability` — id, version, mode (`deterministic` | `ai-assisted`), triggers, strict input and
  output schemas, tool ids, dependency ids, required model features, lazy instruction loader,
  deterministic `evaluate` and `execute`.
- `ToolDefinition` — id, version, description, access (`read` | `propose` | `write`), strict input
  and output schemas, `execute`.
- `JournalCapabilityPort` — the query port the pure runtime uses instead of the database.

Runtime (`intelligence/runtime/`):

- `createCapabilityRegistry()` — explicit registration, duplicate `(id, version)` rejection,
  deterministic ordering by id then version.
- `createCapabilityDispatcher()` — evaluates eligibility, then executes and validates the output.
- `createToolGateway()` — authorises the tool id against the context, checks the access category,
  the tool-call budget and cancellation, validates the input, calls the tool and validates the
  output.
- `createAiSdkTools()` — exposes only the approved registry subset to the AI SDK and maps gateway
  outcomes back to the legacy tool result shapes.
- `createJournalCapabilities(port)` — the registered deterministic journal capabilities.

## Legacy adapters (owned server files)

- `ai-scope.ts` — `createInteractiveContext(scope, signal, options)` builds the execution context
  from an approved frozen scope; the `DataSource` type moves to the shared contract and is
  re-exported for existing importers.
- `ai-capabilities.ts` — `createScopedJournalPort(scope)` implements the query port over the
  existing read-only capability functions. No legacy behaviour changes.
- `ai.ts` — the Ask/Reports tools become registered `ToolDefinition`s executed through the gateway;
  `createAskJournalTools` keeps its signature and its exact result shapes.
- `ai-contracts.ts` — the feature-to-tool-id allowlist.
- `ai-report-context.ts` — unchanged unless a required signature moves.

## Steps

1. Commit this plan (`docs: plan the scoped capability registry and tool gateway`).
2. Write `intelligence/contracts/execution.ts`, `capabilities.ts`, `tools.ts` (pure, strict Zod).
3. Write `intelligence/runtime/registry.ts`, `dispatcher.ts`, `tool-gateway.ts`,
   `journal-capabilities.ts`, `ai-sdk-tools.ts`.
4. Write the failing tests first: `apps/web/tests/intelligence-runtime.test.ts` and
   `apps/web/tests/intelligence-scope.test.ts`.
5. Implement the legacy adapters (`ai-scope.ts`, `ai-capabilities.ts`, `ai-contracts.ts`,
   `ai.ts`).
6. Run the targeted tests, the legacy AI suites, the typecheck and the full suite.
7. Review the diff for boundary violations and legacy parity; record findings.
8. Commit the implementation (`feat: execute scoped intelligence through compatible AI adapters`)
   and write the phase report.

## Verification commands

Targeted:

```
pnpm exec vitest run apps/web/tests/intelligence-runtime.test.ts apps/web/tests/intelligence-scope.test.ts apps/web/tests/ai-scope.test.ts
```

Legacy AI parity and regressions:

```
pnpm exec vitest run apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-capability.test.ts apps/web/tests/ai-ask-agent.test.ts apps/web/tests/ai-reports-route.test.ts apps/web/tests/ai-import.test.ts apps/web/tests/ai-feedback.test.ts apps/web/tests/ai-prompts.test.ts apps/web/tests/intelligence-boundaries.test.ts
```

Typecheck of the TypeScript workspaces:

```
pnpm --filter web typecheck
pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck
```

Full suite:

```
pnpm test
```

The root `pnpm typecheck` also runs the `desktop` workspace, whose `cargo check` fails on a
PRE-EXISTING repo defect (Tauri sidecar packaging, Phase 21 scope under ADR 0009). That defect is
recorded as blocked host evidence and never mocked.

## Acceptance

- Scope: forged principals, deleted accounts, out-of-scope account ids, empty background scope and
  unknown context fields are refused before any tool runs.
- Allowlist: only the tools and capabilities named by the execution context may run.
- Budget: an exhausted tool-call budget returns no journal data.
- Output: an invalid tool output is rejected instead of being returned to the model.
- Legacy AI parity: unchanged JSON response keys, hosted OpenAI `store:false`, compatible key
  binding, no prompt or credential diagnostics, and the existing Ask/Reports tool results unchanged.
- No unrestricted SQL or HTTP tool, no cTrader tool, no model-driven financial write, no new
  dependency, no schema change.

## Stop condition

Stop when the targeted tests, the legacy AI regression set, the TypeScript workspace typechecks and
the full suite have all been run and recorded, the review findings are resolved, the phase report
is written and both commits exist. Any real failure stops the phase: report it honestly, never
weaken an expectation, never widen scope and never start Phase 13.

## Out of scope

The coordinator owns the reviewed, non-fast-forward merge into `codex/ai-native-journal`. No push,
no PR, no merge to `main`. Background provider policy, budget reservations, migration 0005 and the
provider adapters are Phase 13.
