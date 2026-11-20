## Verdict: PASS

## Reviewer Report — Phase 23: the fenced provider job for the review question

Review run 2 of 2: the implementation diff against the plan
(`docs/superpowers/plans/ai-native-journal/phase-23.md`).

### Commands run

- `pnpm --filter web typecheck` → clean, 0 errors.
- `pnpm exec prettier --check` on every file the slice touched → "All matched files use Prettier
  code style!". (The repository-wide prettier failures are pre-existing and in unrelated files.)
- `pnpm exec vitest run apps/web/tests/intelligence-` → 25 files, **448 passed, 1 skipped**.
- `pnpm exec vitest run apps/web/tests/intelligence-review-insight.test.ts` → **19 passed**.
- `node scripts/check-licenses.mjs` → "Dependency licenses OK."; no manifest changed.
- Boundary greps: `packages/core` imports nothing from `apps/web` or `packages/importers`;
  `packages/importers` imports nothing from `apps/web` and makes no raw HTTP call.
- `pnpm exec vitest run apps/web/tests/intelligence-boundaries.test.ts` → 8 passed.

### Findings and their resolution

- [FAIL → FIXED] `apps/web/src/server/intelligence/infrastructure/insight-store.ts:255` — the
  evidence read the holding time from the raw projection snapshot, so a reconstructed-timing trade
  would have been sent to the provider with a holding time the journal deliberately nulled
  (`intelligence_observations.duration_ms`). The evidence now reads the nulled observation column,
  and the prompt's "the journal does not know how long the trade was held" branch can fire again.
  Pinned by a new test, "states that the holding time is unknown when the journal did not know it";
  the mutation evidence is in the phase report.
- [FAIL → FIXED] `apps/web/src/server/intelligence/runtime/capability-job.ts:157` — every
  authorisation refusal was flattened into the run status `unavailable`, so a deleted account ended
  the run `unavailable` instead of `cancelled` and a missing run ended `unavailable` instead of
  `failed`. The decision's own status is now mapped through, which agrees with the commit half of
  the same handler and with the operator documentation. Pinned by the account-deletion test, which
  now asserts `cancelled` and the reason `account_missing`.
- [FAIL → FIXED] `apps/web/src/server/intelligence/runtime/capability-job.ts:137` — two reason codes
  for one condition: the worker answers `unhandled_capability` for a job naming an unregistered
  capability, and the handler carried an unreachable `unknown_capability` branch that the
  operations guide advertised but that could never appear. The branch now answers
  `invalid_payload`, and `unknown_capability` is gone from the operations guide: one condition, one
  code.
- [FAIL → FIXED] `apps/web/src/server/intelligence/contracts/capabilities.ts:81` — a doubled `/**`
  split the doc comment of `BackgroundCapability`. Fixed.
- [FAIL → FIXED] `apps/web/tests/intelligence-review-insight.test.ts` — the suite did not pin the
  holding-time contract, and the refusal cases asserted only a status, not the reason. The suite
  now has 19 cases: the holding-time case above, and the consent, policy-revision,
  endpoint-change and account-deletion cases each assert the recorded `refusalReason`
  (`account_not_opted_in`, `policy_changed`, `configuration_changed`, `account_missing`).
- [NOTE] The background transport carries the prompt version `review-insight-v1`, which is not in
  the interactive `AI_PROMPT_VERSIONS` registry. That is the existing background-runtime
  convention (`background-v1` is registered the same way), so no code change is owed; it is
  recorded in the phase report.

### Verified against the plan

The business-key identity (the run's effect key, the job's idempotency key and the insight's
business key are one string), the atomic enqueue in the observation transaction, the
insert-once semantics, the six eligibility gates, the prepare/commit split with the provider call
outside every write transaction, the attempt reserved before the call, the stale target costing no
allowance, the lease renewal across the wait, the lost lease discarding the answer, the fenced
final transaction re-checking the claim, the account, the consent, the policy revision, the pinned
configuration, the current observation revision and the opportunity's liveness, and the concrete
adapters being wired only in `composition.ts` — all confirmed by reading the code and by the
suite.

### Summary

22 PASS, 0 FAIL, 0 BLOCK. The three behavioural findings and the two missing test dimensions of
review run 2 are fixed, and each fix is pinned by a test that fails when the fix is removed. The
phase report (`docs/superpowers/reports/ai-native-journal-phase-23.md`) is written with the
implementation commit.
