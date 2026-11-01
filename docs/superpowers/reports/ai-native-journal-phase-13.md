# Phase 13 report — Background AI policies, reservations and provider adapter integration

Phase 13 of the AI-native journal run, milestone M4, task packet T-013. This report records what
changed, the evidence against the exact code SHA, the review findings and their resolutions, the
deviations and the inputs the next phase needs.

- Source branch: `codex/ai-native-journal-p13` (Orca child worktree of the feature worktree)
- Base SHA: `135fd0ecd7d6252e17d0e406e907e6e76dbbed5f` (verified feature HEAD)
- Phase plan: `docs/superpowers/plans/ai-native-journal/phase-13.md` (committed first, `d5fdfbe`)
- Implementation: `6012ab4` — _feat: execute scoped intelligence through compatible AI adapters_
- Tip SHA at report time: the commit that adds this report (see the coordinator handoff)

## Outcome

Delivered the background half of the detailed plan's Task 9: a revisioned background policy, the
pinned provider/model/endpoint a run is approved against, the transactional daily attempt
reservation, a provider adapter that never falls back and stops on cancellation, and the settings
surface that opts a journal in per account.

Background AI is off until the operator turns it on. A queued run is refused — with no provider
request — when the configuration changed, when the policy was revised, when the account did not opt
in or no longer exists, when the policy does not declare the capability the run needs, or when the
day's allowance is spent.

## Changed files

New shared contracts (pure — no database, no Next, no AI SDK):

| File                                                      | Exports                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/server/intelligence/contracts/policy.ts`     | `BACKGROUND_POLICY_ID`, `BACKGROUND_DAILY_ATTEMPT_LIMIT`, `BACKGROUND_EXECUTION_LIMITS`, `BACKGROUND_FEATURES`, `BACKGROUND_FAILURE`, `BACKGROUND_RUN_FAILURE`, `DEFAULT_BACKGROUND_POLICY`, `endpointFingerprint`, `backgroundPolicySchema`, `backgroundPolicyPatchSchema`, `backgroundScopeSchema`, `backgroundRunStatusSchema`, `BackgroundPolicy`, `BackgroundPolicyPatch`, `BackgroundPolicyView`, `BackgroundScope`, `BackgroundRunRecord`, `BackgroundRunOutput` |

New runtime and infrastructure:

| File                                                                            | Exports                                                                                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/server/intelligence/runtime/model-policy.ts`                       | `evaluateBackgroundAuthorization`, `BackgroundAuthorizationInput`, `CurrentProviderConfiguration`                                                        |
| `apps/web/src/server/intelligence/infrastructure/policy-store.ts`               | `createPolicyStore`, `reserveBackgroundAttempt`, `dayIndex`, `PolicyStore`, `StoredPolicy`, `EnqueueRunInput`, `RunReservation`                            |

Modified:

| File                                                         | Change                                                                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/intelligence/composition.ts`             | The background policy service: `getBackgroundPolicy`, `saveBackgroundPolicy`, `enqueueBackgroundRun`, `authorizeBackgroundRun`, `reserveBackgroundAttempt`, `executeBackgroundRun` |
| `apps/web/src/server/ai-runtime.ts`                          | `runBackgroundAi` (the pinned background adapter); an optional abort signal on the text, Ask agent and Reports agent adapters                                 |
| `apps/web/src/server/ai-contracts.ts`                         | `AiExecutionFeature` widened to include `"background"`                                                                                                 |
| `apps/web/src/server/settings.ts`                             | `getCurrentProviderConfiguration` — the provider, model and endpoint without the key                                                                   |
| `apps/web/src/app/api/settings/route.ts`                      | `backgroundAi` in the settings payload; the background policy patch is validated before any setting is written                                             |
| `apps/web/src/components/ai-settings.tsx`                     | The Background AI opt-in card: enable, accounts, declared capabilities, context bound                                                                  |
| `apps/web/src/db/migrations/0005-intelligence-runtime.ts`      | New migration: `intelligence_runs`, `intelligence_policy`, `intelligence_budget_reservations`                                                           |
| `apps/web/src/db/migrations.ts`                               | Registers migration `0005`                                                                                                                              |
| `apps/web/src/db/schema.ts`                                  | The three new typed tables                                                                                                                              |
| `apps/web/src/db/bootstrap.ts`                               | Splices the same DDL constant into the final-schema snapshot                                                                                           |
| `apps/web/src/db/migration-checksums.json`                   | Regenerated artifact                                                                                                                                     |

Tests: `apps/web/tests/intelligence-provider-policy.test.ts` (new, 33 tests: 30 phase cases plus
the racing-reservation case and the two `0005` migration cases added by the test-coverage repair).

## Migrations

One new forward-only migration, `0005-intelligence-runtime`, additive only. It creates three
tables and never rewrites an existing one, so a legacy journal and a fresh journal converge on the
same schema.

| Table                            | Columns                                                                                                                                  | Keys / indexes                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `intelligence_runs`              | `id`, `effect_key`, `status`, `provider`, `model`, `endpoint_fingerprint`, `policy_revision`, `scope_json`, `meta_json`, `created_at`, `updated_at` | PK `id`, unique `effect_key`, index `(status, created_at)`                                          |
| `intelligence_policy`            | `id`, `revision`, `settings_json`, `recorded_at`                                                                                         | PK `(id, revision)`                                                                                   |
| `intelligence_budget_reservations` | `run_id`, `attempt`, `day`, `reserved_at`                                                                                                  | PK `(run_id, attempt)`, FK `run_id` → `intelligence_runs(id)` on delete cascade, index `(day)`            |

- Migrations `0001`–`0004` are untouched; the checksum artifact was regenerated with
  `pnpm --filter web migrations:build` and verified with `pnpm --filter web migrations:check`.
- The phase test carries the `0005`-specific assertions: the three tables `intelligence_runs`,
  `intelligence_policy` and `intelligence_budget_reservations` exist in the journal, the registered
  checksum of migration `0005` is the checksum of the migration source, and the ledger row the
  runner applied holds that checksum.
- `BOOTSTRAP_SQL` splices the same `INTELLIGENCE_RUNTIME_SQL` constant the migration applies, so a
  migrated journal and the declared schema cannot drift.
- No new dependency, therefore no new ADR. ADR 0008 already covers the provider-compatibility
  decision this phase implements.
- Rollback: additive tables only. Deploying the previous binary with the new tables retained is
  safe; no destructive down migration, no data rewrite.

## Behaviour

- The policy document is `{ schemaVersion, enabled, accounts, capabilities, maxInputCharacters }`.
  It is stored one row per revision; a queued run pins the revision it was approved under, so a
  policy change never applies to a run retroactively. An unchanged document keeps its revision, so
  saving the same policy does not invalidate queued runs.
- A run pins the provider, the model and a SHA-256 fingerprint of provider, model and endpoint.
  The authorisation compares the pinned fingerprint with the current configuration: a changed URL,
  model or provider refuses the run with `configuration_changed`, and the fingerprint is checked
  again immediately before the request, so a concurrent settings change cannot reroute it.
- A refusal that will not change on its own — a changed configuration or a revised policy — is
  recorded on the run: the run becomes `unavailable` until it is explicitly rescheduled. Queueing
  the same effect again re-pins and re-queues it.
- The daily allowance is ten attempts per journal per UTC day. The reservation is taken inside the
  caller's transaction and committed before the provider call, so a crashed attempt keeps its
  allowance and a fresh retry spends another one.
- The provider adapter issues exactly one request against the pinned configuration: no automatic
  retries, a 30 s deadline, the caller's abort signal, hosted OpenAI keeps `store:false`, and a
  compatible server keeps its own key (and may have none). A hosted provider without a key is
  refused before the model is built, so no request reaches the provider.
- A cancelled run records `cancelled`, not a provider timeout.
- Run metadata holds provider, model, attempt count, duration, finish reason, token counts and
  error kind. No prompt, no response and no credential is stored.
- The interactive AI policy constants, the provider behaviour and the import/AI response contracts
  are unchanged. No route response shape changed except the additive `backgroundAi` key in
  `/api/settings`.

## Evidence

Runtime: Node v24.20.0, pnpm 11.0.8, frozen lockfile. Fixtures: a disposable absolute
`JOURNAL_DATA_DIR` scratch directory with synthetic accounts `acct-1`/`acct-2`. All commands ran in
this worktree against the SHA recorded above.

| Command                                                                                                                                                                                                                                                                                                                                                                                                                               | Exit | Result                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-provider-policy.test.ts`                                                                                                                                                                                                                                                                                                                                                       | 0    | 1 file, 30 tests passed                            |
| `pnpm exec vitest run apps/web/tests/intelligence-runtime.test.ts apps/web/tests/intelligence-scope.test.ts apps/web/tests/intelligence-provider-policy.test.ts apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-settings.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-feedback.test.ts`                                                       | 0    | 7 files, 157 tests passed                          |
| `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/ai-import.test.ts apps/web/tests/ai-capability.test.ts apps/web/tests/ai-ask-agent.test.ts apps/web/tests/ai-reports-route.test.ts apps/web/tests/ai-prompts.test.ts apps/web/tests/ai-settings-ui.test.ts apps/web/tests/intelligence-packaging.test.ts` | 0    | 9 files, 111 tests passed                          |
| `pnpm test` (full suite, includes `packages/core/tests` and the cTrader suites)                                                                                                                                                                                                                                                                                                                                                 | 0    | 106 files, 1141 tests passed, 98.33 s              |
| `pnpm --filter web typecheck`                                                                                                                                                                                                                                                                                                                                                                                                     | 0    | clean                                              |
| `pnpm --filter web migrations:check`                                                                                                                                                                                                                                                                                                                                                                                                 | 0    | checksum artifact up to date                       |

One earlier full-suite run failed `intelligence-supervisor.test.ts > restarts workers that stop
replying to IPC health` with a timeout while a review agent ran Vitest in parallel on the same
host. The test passes in isolation and in the recorded clean full-suite run; it is a load-sensitive
subprocess test, not a regression from this phase.

### Blocked host evidence

The root `pnpm typecheck` also runs the `desktop` workspace, whose `cargo check` fails on a
PRE-EXISTING repo defect: the Tauri sidecar resource
`binaries/node-x86_64-pc-windows-msvc.exe` is not produced because the sidecar setup script uses
CommonJS `require()` inside an ESM package. That defect belongs to the Phase 21 Tauri packaging
subset under ADR 0009 and is not this phase's to fix; the TypeScript workspace typechecks above are
the phase evidence. It is carried forward to the release gate, never mocked.

The deployment tests that need a live compatible server and a real in-flight cancellation were not
available on this host. They remain blocked, never passed.

## Review findings and resolutions

One read-only implementation-diff review ran over the staged diff (15 files, +2041/−119). It
returned findings against the phase plan, the contract review and the repo conventions. All of them
are resolved; the full table is in `.omp/reviewer-report.md`.

The defects that mattered most:

- A persisted `cancelled` run re-authorized and spent another provider request, and an
  `unavailable` run was never written, so a configuration change was not durable: changing the
  configuration away and back silently revived the run. Both are fixed — a terminal run is refused
  with `run_finished`, and a configuration or policy refusal is recorded on the run.
- The composed execution path had no test coverage, so the provider-request assertions were
  vacuous. `intelligence-provider-policy.test.ts` now drives `executeBackgroundRun` end to end:
  one request to the pinned endpoint with the reservation row already committed at call time, no
  request on a refusal, no request without a key, a cancelled run recorded as cancelled and
  aborted through the caller's own signal, a refused run recorded as unavailable, and a terminal
  run refused.
- Deleting an opted-in account locked the Background AI card out of saving, because the policy kept
  the deleted id and the save refused it. The save now drops accounts that no longer exist.
- `executeBackgroundRun` re-read the live provider settings instead of the pinned ones. The
  fingerprint is now checked again immediately before the request.
- The settings PATCH wrote the AI settings before validating the background policy. The background
  policy is now parsed and validated first, so a bad request changes no setting.

Accepted with a documented reason:

- The provider adapter lives in the legacy `server/ai-runtime.ts` module, which owns `buildModel`
  and the provider parity rules. The background adapter therefore keeps every provider and the
  existing `store:false` and compatible-key behaviour instead of reimplementing them.
- `daily_budget_exhausted` and `provider_not_configured` are refusals of the run service rather
  than of the policy decision. They are stable identifiers in `BACKGROUND_RUN_FAILURE`, and the
  phase plan lists them next to the policy reasons.
- The background policy is stored in `intelligence_policy` rather than in the settings key/value
  table: it is revisioned and pinned per run, and the settings route is its only writer.

## Test coverage repair (implementation-diff review)

The implementation-diff review of this phase found the production code correct, but three test
cases that could not fail for the reason they claimed, and one coverage claim that was not true.
The repair touches `apps/web/tests/intelligence-provider-policy.test.ts` and this plan/report
pair only: `git diff 6012ab4 -- apps/web/src/` is empty, so no production behaviour changed.

### Findings and resolutions

1. **The cancellation case could not fail.** "Stops the request when the caller cancels" aborted
   the controller inside the fetch stub and threw an `AbortError`, so it still passed when
   `runBackgroundAi` forwarded no signal at all — it pinned an error kind instead of the
   behaviour. The stub now captures the signal the provider call actually received
   (`init.signal`), the caller cancels while the request is in flight, and the case asserts that
   the captured signal was aborted and carries the caller's own abort reason. The existing
   "the request was stopped" assertion is kept.
2. **The recorded-cancellation case had the same root cause.** "Records a cancelled run as
   cancelled, not as a timeout" proved only the stored status, so it survived the removal of the
   abort plumbing and could not tell a real cancellation from a self-inflicted stub error. It now
   also asserts that the composed path aborted the in-flight provider request through the
   caller's signal.
3. **The reservation order was checked too late.** "Calls the pinned endpoint once, after the
   reservation is committed" read the reservation rows after the call returned, so it survived a
   reservation taken after the provider request. The stub now reads the reservations at call time,
   and the case asserts that the row of the run already exists then. A racing-reservation case was
   added: two reservations for the same run and day race for the day's last slot through a second
   connection, exactly one succeeds, the day's rows never exceed the allowance, and the loser
   leaves no row behind. The journal's transactions are synchronous, so the two racers serialise;
   what the case proves is that the winner's committed reservation is visible to the second
   connection and that the allowance is spent exactly once.
4. **The `0005` coverage claim was false.** The plan's checklist said "the phase test adds the
   0005-specific assertions", and the test file held no `0005`, `intelligence_runs` or checksum
   assertion at all. Two cases were added: the three tables `intelligence_runs`,
   `intelligence_policy` and `intelligence_budget_reservations` exist in the journal, and the
   registered checksum of migration `0005` matches both the migration source and the ledger row
   the runner applied. The plan checklist, the plan's step 2 and its acceptance bullets, and this
   report now describe what the test actually does.

### Proof of teeth

Every strengthened case was seen to fail against broken production code, and the production code
was then restored exactly.

| Case                                                                          | Broken production code                                                                    | Result with the strengthened test | Result after the restore |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------- |
| `stops the request when the caller cancels`                                   | `abortSignal` removed from the `generateText` call in `runBackgroundAi`                    | FAIL — `expected false to be true` | PASS               |
| `records a cancelled run as cancelled, not as a timeout`                      | the same removal                                                                            | FAIL — `expected false to be true` | PASS               |
| `calls the pinned endpoint once, after the reservation is committed`           | the reservation in `executeBackgroundRun` moved after the provider call                     | FAIL — `expected [] to have a length of 1 but got +0` | PASS     |

### Repair verification

| Command                                                                                                                                                                                                                          | Exit | Runtime    | Result                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- | ---------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-provider-policy.test.ts apps/web/tests/intelligence-runtime.test.ts apps/web/tests/intelligence-scope.test.ts apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-settings.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-feedback.test.ts` | 0    | 8.49 s     | 7 files, 160 tests passed |
| `pnpm --filter web typecheck`                                                                                                                                                                                                     | 0    | 25.03 s    | clean                  |

The whole-project `pnpm test` suite was not run: the coordinator runs the destination gate once,
alone, after the merge. The repaired test file was brought back to the repository's Prettier
formatting; the repo-wide `pnpm format:check` drift (77 files, including these two documents)
pre-exists this phase — both documents were already Prettier-dirty when the phase committed them,
and the repair edited their lines without reformatting the files.

One review pass ran over the repair diff and returned `PASS` (15 PASS, 0 FAIL, 0 BLOCK); its
report is `.omp/reviewer-report.md`.

## Deviations from the phase plan

1. The implementation was written before the new test file, so the tests arrived after the code
   they cover. The coverage and the assertions are unchanged; only the order differed.
2. `apps/web/src/server/intelligence/contracts/policy.ts` is a new file the plan's owned list did
   not name. The import-boundary rules require the shared background types to live in `contracts/`,
   because the runtime and the infrastructure may only share that surface.
3. The phase plan's reason table gained `run_finished`, `context_too_large`,
   `daily_budget_exhausted` and `provider_not_configured` while the implementation was written. The
   plan file was updated in the same commit so the table matches the shipped code.

## Next-phase inputs (Phase 14/15)

- The background constructor of the execution context is in place and re-authorises against the
  current configuration on every attempt. What is still missing is the capability that produces
  the work: no background capability is registered yet, so a background run has no prompt and no
  query port to read through.
- The scheduler (Phase 15) owns when a background run is enqueued. The effect key is the
  idempotency key: queueing the same effect twice returns the same run, and queueing a run that
  already ended is the explicit reschedule.
- The knowledge revision store (Phase 14) owns what a background run writes back. No background
  capability writes to the journal in this phase.
- The daily allowance is ten attempts per journal per UTC day, taken transactionally before the
  provider call. A phase that needs a different allowance changes `BACKGROUND_DAILY_ATTEMPT_LIMIT`
  and the migration column comment together.
