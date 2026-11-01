# Phase 13 — Background AI policies, reservations and provider adapter integration

Implements the Phase 13 subset of the AI-native journal run (milestone M4, task packet T-013): the
remainder of detailed-plan Task 9. Binding scope: design §§10, 11, 12, 16; contract review §§2–6;
the phase guide's Phase 13 row ("Remainder of Task 9", schema allocation `0005`).

Phase 12 delivered the contracts, the capability registry and the tool gateway. This phase delivers
the **background** half of Task 9: the policy that authorises a background run, the pinned
provider/model/endpoint it may use, the daily attempt reservation, and the provider adapter that
executes it without falling back to another provider.

## Objective and outcome

Deliver:

- migration `0005` with `intelligence_runs`, `intelligence_policy` and
  `intelligence_budget_reservations`;
- a strict, revisioned background policy (opt-in accounts, model capability declarations, context
  bound);
- `authorizeBackgroundRun(runId, now, signal)` — re-authorise a queued run against the *current*
  configuration and return its `ExecutionContext`;
- `reserveBackgroundAttempt(tx, runId, now)` — take one daily allowance atomically, before any
  network use, and keep the reservation when the attempt dies;
- a pinned background provider adapter that never falls back to another provider and that stops on
  cancellation;
- the user-facing opt-in in Settings (API, server settings and the AI settings card).

Background AI stays **off** until the user opts in, and a configuration change never silently
reroutes a queued run: the run becomes `unavailable` until it is explicitly rescheduled.

## Scope in

Owned files (only these may be edited):

- `apps/web/src/db/migrations/0005-intelligence-runtime.ts` (new)
- `apps/web/src/db/migrations.ts` (registry), `apps/web/src/db/schema.ts` (typed tables),
  `apps/web/src/db/bootstrap.ts` (final-schema snapshot), `apps/web/src/db/migration-checksums.json`
  (regenerated artifact)
- `apps/web/src/server/intelligence/contracts/policy.ts` (new — shared background contracts)
- `apps/web/src/server/intelligence/runtime/model-policy.ts` (new — pure policy evaluation)
- `apps/web/src/server/intelligence/infrastructure/policy-store.ts` (new — SQLite adapter)
- `apps/web/src/server/intelligence/composition.ts` (wiring)
- `apps/web/src/server/ai-contracts.ts` (background execution limits)
- `apps/web/src/server/ai-runtime.ts` (abort signal on the existing adapters, background adapter)
- `apps/web/src/server/settings.ts` (current endpoint configuration)
- `apps/web/src/app/api/settings/route.ts` (policy read/write)
- `apps/web/src/components/ai-settings.tsx` (opt-in card)
- `apps/web/tests/intelligence-provider-policy.test.ts` (new)
- this plan and the phase report

`apps/web/src/server/ai-import.ts` and `apps/web/src/server/ai-scope.ts` are owned but must not
change: the hosted-only statement-import policy and the interactive scope stay as they are, and the
phase tests assert both.

Schema allocation: `0005` only. No renumbering or editing of the applied migrations `0001`–`0004`,
no new dependency (therefore no new ADR), no new package, no model-driven financial write, no
network call inside a write transaction, no unrestricted SQL or HTTP tool.

## Contracts

Shared background contracts (`intelligence/contracts/policy.ts` — the only surface the runtime and
the infrastructure may share):

```ts
export const BACKGROUND_POLICY_ID = "background";
export const BACKGROUND_DAILY_ATTEMPT_LIMIT = 10;
export const BACKGROUND_EXECUTION_LIMITS = { maxOutputTokens: 1200, maxSteps: 4, maxToolCalls: 4, timeoutMs: 30_000, maxRetries: 0 };
export const backgroundPolicySchema: ZodType<BackgroundPolicy>;   // strict
export const backgroundScopeSchema: ZodType<BackgroundScope>;       // strict
export const backgroundRunStatusSchema: ZodType<BackgroundRunStatus>;
```

Application contracts:

```ts
// composition.ts
export const getBackgroundPolicy: () => BackgroundPolicyView;
export const saveBackgroundPolicy: (patch: BackgroundPolicyPatch) => BackgroundPolicyView;
export const enqueueBackgroundRun: (input: { effectKey: string; scope: BackgroundScope; meta?: Record<string, unknown> }) => string;
export const authorizeBackgroundRun: (runId: string, now: number, signal: AbortSignal) => Outcome<ExecutionContext>;
export const reserveBackgroundAttempt: (tx: JournalTx, runId: string, now: number) => boolean;
export const executeBackgroundRun: (input: { runId: string; system: string; prompt: string; signal: AbortSignal; now?: number }) => Promise<Outcome<BackgroundRunOutput>>;

// infrastructure/policy-store.ts
export const reserveBackgroundAttempt: (tx: JournalTx, runId: string, now: number) => boolean;

// runtime/model-policy.ts (pure)
export const evaluateBackgroundAuthorization: (input: BackgroundAuthorizationInput) => Outcome<ExecutionContext>;

// server/ai-runtime.ts
export const runBackgroundAi: (request: BackgroundAiRequest) => Promise<AiRunResult<string>>;
```

`authorizeBackgroundRun` and `reserveBackgroundAttempt` keep the exact signatures of detailed-plan
Task 9. `buildModel` keeps every provider it supports (Anthropic, OpenAI, OpenAI-compatible).

### Policy and run records

`intelligence_policy` holds the revisioned policy document (one row per revision):

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "accounts": ["<account id>"],
  "capabilities": { "tools": false, "structuredOutput": false },
  "maxInputCharacters": 8000
}
```

`intelligence_runs` holds one queued background run: `id`, unique `effect_key` (idempotent enqueue),
`status`, the pinned `provider` / `model` / `endpoint_fingerprint`, the pinned `policy_revision`, the
authorised `scope_json` (concrete account ids, filters, timezone, data sources, required features)
and a sanitized `meta_json` (never a prompt, a response or a credential).

`intelligence_budget_reservations` holds one row per reserved attempt: `run_id`, `attempt`, the
`day` index and `reserved_at`, with the day indexed for the daily lookup.

### Decision rules (`runtime/model-policy.ts`, pure)

`evaluateBackgroundAuthorization` returns `Outcome<ExecutionContext>` and refuses, in order:

| Reason                            | When                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `run_not_found`                   | no run row for the id                                            |
| `cancelled`                       | the run was cancelled, or the abort signal already fired         |
| `run_finished`                    | the run already ended; it needs an explicit reschedule           |
| `policy_missing` / `policy_invalid` | no policy row, or the stored document does not parse          |
| `policy_disabled`                 | background AI is not opted in                                     |
| `policy_changed`                  | the policy was revised after the run was queued                   |
| `account_not_opted_in`            | a scope account is not in the policy's opted-in accounts          |
| `account_missing`                 | a scope account no longer exists (cancels the work)               |
| `configuration_changed`           | provider, model or endpoint fingerprint no longer match the run's |
| `tools_unsupported`               | the run requires tools and the policy does not allow them         |
| `structured_output_unsupported`   | the run requires structured output and the policy forbids it      |
| `capacity_unknown`                | the policy has no usable context bound                            |
| `context_too_large`               | the run wants more context than the policy allows                 |

The run service refuses two more reasons outside the policy decision:
`daily_budget_exhausted` (the day's allowance is spent) and
`provider_not_configured` (the pinned provider has no key or no server URL). Both are
refused before any provider request.

A refusal that will not change on its own — `configuration_changed` and
`policy_changed` — is recorded on the run, which becomes `unavailable` until it is
explicitly rescheduled.

On success the run becomes a background `ExecutionContext`: trusted `system` principal, concrete
account ids, the background budgets (four steps, four tool calls, 1200 output tokens, 30 s) and the
caller's abort signal.

### Reservation rules

`reserveBackgroundAttempt(tx, runId, now)` runs inside the caller's immediate transaction: it
counts the reservations already taken for the UTC day of `now`, refuses when the daily allowance
(`BACKGROUND_DAILY_ATTEMPT_LIMIT = 10`) is spent, and otherwise inserts the next attempt of the run.
The row is committed **before** the provider call, so a crash keeps the allowance (a fresh retry
takes another one). No network call happens inside the transaction.

### Provider adapter rules

`runBackgroundAi` builds the model from the pinned configuration only:

- the pinned provider, model and endpoint — never another provider, never another model;
- zero automatic provider retries, 1200 output tokens, a 30 s deadline;
- the caller's abort signal, so a cancelled run stops the provider request;
- hosted OpenAI keeps `store:false`; an OpenAI-compatible server keeps its own key, and only the
  key saved for that server is sent;
- sanitized errors only — no prompt and no credential ever reaches a message or the run metadata.

## Schema allocation and migration checklist (0005)

`apps/web/src/db/migrations/0005-intelligence-runtime.ts` creates, forward-only and additive:

| Table                            | Columns                                                                                                                                  | Keys / indexes                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `intelligence_policy`            | `id`, `revision`, `settings_json`, `recorded_at`                                                                                       | PK `(id, revision)`                                                                                   |
| `intelligence_runs`              | `id`, `effect_key`, `status`, `provider`, `model`, `endpoint_fingerprint`, `policy_revision`, `scope_json`, `meta_json`, `created_at`, `updated_at` | PK `id`, unique `effect_key`, index `(status, created_at)`                                          |
| `intelligence_budget_reservations` | `run_id`, `attempt`, `day`, `reserved_at`                                                                                                | PK `(run_id, attempt)`, FK `run_id` → `intelligence_runs(id)` on delete cascade, index `(day)`            |

Checklist:

- [x] New numbered migration; `0001`–`0004` are untouched and their checksums stay valid.
- [x] Column list, nullability, defaults, indexes and FK actions are listed in this plan and in the
      phase report.
- [x] Strict application payload schemas (`backgroundPolicySchema`, `backgroundScopeSchema`) beside
      the SQL constraints.
- [x] Upgrade from the previous phase and from baseline 0001, fresh database, repeated startup,
      injected failure and concurrent startup — the existing migration suite is registry-driven, so
      the new migration is covered by it; the phase test adds the 0005-specific assertions: the
      three tables `intelligence_runs`, `intelligence_policy` and
      `intelligence_budget_reservations` exist in the journal, and the registered checksum of
      migration `0005` matches both the migration source and the ledger row the runner applied.
- [x] Snapshot parity: `BOOTSTRAP_SQL` splices the same DDL constant the migration applies.
- [x] Checksum artifact regenerated with `pnpm --filter web migrations:build`.
- [x] Rollback: additive tables only. Rollback means deploying the previous binary with the new
      tables retained, or restoring a verified backup — no destructive down migration, no data
      rewrite.
- [x] No backfill, no provider call, no historical engagement triggered by the migration.

## Steps

1. Commit this plan (`docs: plan the background AI policies and provider adapters`).
2. Write the failing test `apps/web/tests/intelligence-provider-policy.test.ts` first: migration
   `0005` applied with its three tables and a checksum that matches the registry, policy
   round-trip, authorisation outcomes, the changed-endpoint refusal, the daily reservation,
   cancellation and provider parity.
3. Add `intelligence/contracts/policy.ts` (shared contracts) and
   `intelligence/runtime/model-policy.ts` (pure evaluation).
4. Add `apps/web/src/db/migrations/0005-intelligence-runtime.ts`, register it, mirror it in
   `schema.ts` and `bootstrap.ts`, regenerate the checksum artifact.
5. Add `intelligence/infrastructure/policy-store.ts` (policy rows, run rows, daily reservation).
6. Wire `intelligence/composition.ts`: policy view, policy write, enqueue, authorise, reserve,
   execute.
7. Extend `server/ai-contracts.ts` with the background execution limits and the background execution
   feature on the execution metadata.
8. Extend `server/ai-runtime.ts`: optional abort signal on the existing adapters (legacy call sites
   and the interactive constants unchanged) and the pinned `runBackgroundAi` adapter.
9. Extend `server/settings.ts` with the current endpoint configuration used for the fingerprint.
10. Expose the policy through `app/api/settings/route.ts` and add the opt-in card to
    `components/ai-settings.tsx`.
11. Run the targeted command, the typecheck and the regressions; record the results.
12. Review the diff (one reviewer run), resolve the findings, commit the implementation and write
    the phase report.

## Verification commands

Targeted:

```
pnpm exec vitest run apps/web/tests/intelligence-provider-policy.test.ts
```

Phase gate:

```
pnpm exec vitest run apps/web/tests/intelligence-runtime.test.ts apps/web/tests/intelligence-scope.test.ts apps/web/tests/intelligence-provider-policy.test.ts apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-settings.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-feedback.test.ts
pnpm typecheck
```

Regressions that must stay green: `apps/web/tests/intelligence-migrations.test.ts` (registry-driven,
covers 0005), `apps/web/tests/intelligence-boundaries.test.ts` (import direction), and the legacy AI
suites (`ai-import`, `ai-capability`, `ai-ask-agent`, `ai-reports-route`, `ai-prompts`,
`ai-settings-ui`).

## Acceptance

- **Configuration change:** a queued run whose provider, model or endpoint changed becomes
  `unavailable` with reason `configuration_changed`; no provider request is issued and no fallback
  provider is contacted.
- **No fallback:** the background adapter contacts exactly the pinned endpoint; a failing pinned
  provider never reroutes to another provider.
- **Cancellation:** an aborted run stops the provider request — the in-flight provider request is
  aborted by the caller's own signal — and ends as `cancelled`.
- **Daily reservation:** the allowance is taken atomically before the network use — the reservation
  row is already committed when the provider is called — the reservation survives a crashed
  attempt, two racing reservations spend the day's last slot exactly once, and the eleventh
  attempt of the day is refused.
- **Provider parity:** a hosted provider without a key fails before any request, a keyless
  OpenAI-compatible server works, and a run that requires tools is refused when the policy does not
  allow them.
- **Compatibility:** the interactive policies, the hosted-only import policy, the provider
  behaviour (`store:false`, compatible key binding) and the JSON response keys are unchanged; no
  prompt or credential reaches a diagnostic.

## Stop condition

Stop when the targeted tests, the phase gate, the typecheck and the regressions have been run and
recorded, the review findings are resolved, the implementation and this phase's report are
committed. Any real failure stops the phase: report it honestly, never weaken an expectation, never
widen the scope and never start Phase 14.

## Out of scope

The coordinator owns the reviewed, non-fast-forward merge into `codex/ai-native-journal`. No push, no
PR, no merge to `main`. Background scheduling (Phase 15), knowledge revisions (Phase 14), workflows
(Phase 16) and the interaction surfaces (Phases 18–19) are other phases.
