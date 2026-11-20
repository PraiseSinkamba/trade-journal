## Verdict: PASS

## Reviewer Report — Phase 23 repair round: the fenced provider job for the review question

The repair round of Phase B (T-023). The implementation-diff review of the phase returned **FAIL**
with eight findings, and a mapping of the suite against the production code found nine behaviours
that no test could fail. This report states what the repair changed and — more importantly — what
the suite now proves, and what it still does not.

### Commands run

- `pnpm exec vitest run apps/web/tests/intelligence-review-insight.test.ts … intelligence-worker … intelligence-provider-policy … intelligence-observations … intelligence-recovery … intelligence-boundaries`
  → **6 files, 100 tests, exit 0**, 17.2 s.
- `pnpm exec vitest run apps/web/tests/intelligence-review-insight.test.ts` → **30 tests, exit 0**,
  8.4 s.
- `pnpm --filter web typecheck` → exit 0, 27.5 s.

The second repair round re-ran the narrow gate:

- `pnpm exec vitest run apps/web/tests/intelligence-review-insight.test.ts apps/web/tests/intelligence-provider-policy.test.ts apps/web/tests/intelligence-boundaries.test.ts`
  → **3 files, 72 tests, exit 0**, 9.5 s.
- `pnpm --filter web typecheck` → exit 0, 29.5 s.
- `pnpm exec prettier --check` on the changed files → exit 0 after formatting.
- Mutation proof: the enqueue's `existingAccountIds` gate was deleted, the new case failed with
  "expected [ { …(11) } ] to have a length of +0 but got 1", and the gate was restored; the suite
  was green again.

### The eight findings, and what the repair did

| # | Finding                                                                          | Resolution                                                                                                                                                                    |
| - | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | the operations guide advertised three codes the code cannot emit                | the guide now names the codes the feature cannot emit and why (`capacity_unknown`, `context_too_large`, `invalid_evidence`, and the two capability-feature codes)         |
| 2 | the guide omitted `lease_lost` and `run_not_found`, and misstated where a code lands | the guide now says where every code lands: the job's `last_error` only, the run's reason and status and the job's `last_error`, or the run's reason and status alone |
| 3 | this report claimed the lease renewal and the opportunity recheck were confirmed; they were not | both are pinned by cases now, and the earlier claim is withdrawn                                                                                             |
| 4 | the transport dropped the call metadata                                          | the transport returns the answer with its metadata; the run records the prompt version, the provider, the model, the duration and the token counts — never the prompt, the answer or a credential |
| 5 | the business-key identity was only two-thirds pinned                            | the identity case asserts the run's effect key, the job's idempotency key and the insight's business key are one string                                                      |
| 6 | the legacy path could complete a run from a bare provider response              | `executeBackgroundRun` has no production caller; it now refuses a capability job's run before it reserves an attempt or reaches a provider. A case pins the guard              |
| 7 | `invalid_payload` was a second code for one condition                           | the code and its branches are gone; `unhandled_capability` is the one code, and the string no longer exists anywhere in the repository                                     |
| 8 | a run that failed once kept its stale `refusalReason`                           | the success path writes `refusalReason: null`, so the meta merge clears the old reason                                                                                        |

### What the suite proves now — each case was seen to fail when its check was deleted

| Case                                                                     | The check it pins                                        | Broken on purpose — what happened                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| renews the lease while the provider is thinking, and writes nothing when the lease is lost | the worker's renewal callback and its lease-lost branch | the case failed: the abort was the only cancel path for the provider call |
| stores nothing when the review opportunity is withdrawn                  | the final transaction's `isLiveInTx` recheck              | the case failed: an insight was stored                                    |
| stores nothing when the policy is switched off                           | the `policyDisabled` clause                              | the case failed: the reason was `policy_changed`                          |
| stores nothing when the policy is deleted                                | the `policyMissing` clause                               | the case failed: the run stayed `running`                                 |
| stores nothing when the policy is corrupted                              | the `policyInvalid` clause                               | the case failed: the run stayed `running`                                 |
| stores nothing when the pinned model changes                             | the pinned-model comparison                              | the case failed: an insight was stored                                    |
| fails a job that names a capability version nobody registered             | the registry lookup's version dimension                  | the case failed: the job reached the handler                              |
| queues neither a run nor a job for a historical or a maintenance delivery | the enqueue's `mode !== "live"` gate                     | the case failed: two runs and two jobs were written                       |
| asks the real transport against a local server                           | the whole transport adapter                              | the case failed: no prompt version in the answer                         |
| the stored question carries the same business key as the run and the job | the business key construction                            | the case failed: the keys differed                                        |
| the attempt reservation is recorded before the provider is called        | the attempt reservation                                  | the case failed: no reservation row existed                              |
| refuses a capability job's run in the legacy background path             | the legacy path's capability guard                       | the case failed: the legacy path reached the provider                    |
| queues neither a run nor a job when the enqueue's own account gate refuses the account | the enqueue's `existingAccountIds` gate | the case failed: a run was written for an account the journal no longer held |

### The second repair round

The final scoped review of this phase returned FAIL with two documentation findings, and the
coordinator's teeth proof found one unpinned gate. All three are fixed:

| Finding                                                                                                                       | Resolution                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the guide said nothing about the call is stored, while the run's `meta_json` holds the prompt version, the provider, the model, the duration and the token counts | the guide now states exactly what is kept — the refusal reason, the capability id and version, and the call metadata of a successful call — and keeps the true guarantee: never the prompt, never the answer, never a credential |
| the guide called `provider_error` the only retryable code                                                                 | `lease_lost` and the worker's `handler_failed` are retried too, and `validation_failed` is not; the guide now says so                                            |
| the enqueue's account gate was unpinned                                                                                       | the gate is kept and pinned directly: a new case drives the enqueue with a journal that reports no account and asserts no run and no job                             |

The earlier report's claim that the lease renewal and the opportunity recheck were confirmed by
the suite was false: deleting either check left every case green. They are pinned now, and the
claim is withdrawn rather than repeated.

### What the suite does NOT prove

- The account gate in `runtime/review-enqueue.ts` cannot be reached through the production
  delivery path: the observation reader already returns null for a deleted account, and the
  executions write refuses the delivery before the enqueue runs. The gate is defence in depth, and
  it is now pinned DIRECTLY by a case that drives the enqueue with a journal that reports no
  account — deleting the gate makes that case fail. The delivery-path case was renamed to state
  what it really proves: that the whole delivery is refused.
- The worker's optional renew interval is a test seam. The composition does not expose it, because
  nothing in production needs to; the lease-lost case wires the worker directly.

### Scope

No migration, no change under `apps/web/src/db/`, no new dependency, no change to the AI
runtime's provider list, endpoint routing or policy caps, no component and no `apps/web/src/app/**`
change. No existing test was weakened or deleted; the only change to an existing test file is one
arbitrary failure-code literal in `apps/web/tests/intelligence-jobs.test.ts` (`invalid_payload` →
`handler_failed`), because that string left the codebase. The boundary suite passes unchanged.

The second repair round changed no production code at all: two documentation passages, one test
rename and one new case. The enqueue's account gate was kept, as defence in depth, and is now
pinned by a case that drives the enqueue directly.

### Summary

PASS for the repair round: the eight findings are fixed, the nine coverage holes are closed with
cases that have been seen to fail, and the one remaining gap is recorded rather than hidden. The
phase report (`docs/superpowers/reports/ai-native-journal-phase-23.md`) carries the full teeth
evidence.

PASS for the second repair round: the two guide contradictions are corrected against the code, and
the enqueue's account gate is pinned by a case that fails when the gate is deleted. No claim in
this report or in the phase report outruns the suite.
