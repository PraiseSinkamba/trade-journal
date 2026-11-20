## Verdict: PASS

## Reviewer Report — Phase 23: the fenced provider job for the review question

Review run 1 of 2: the plan (`docs/superpowers/plans/ai-native-journal/phase-23.md`) against the
implementation in the same worktree.

### Findings

- [PASS] Ownership table vs the changed set — `docs/superpowers/plans/ai-native-journal/phase-23.md`
  now lists every changed file. `runtime/model-policy.ts` was missing and has been added; the two
  throwaway copies in the repository root (`fmt-tmp.md`, `plan-fmt-tmp.md`) have been deleted.
- [PASS] The fenced final transaction now rechecks the policy revision —
  `apps/web/src/server/intelligence/runtime/capability-job.ts:288` refuses a run whose pinned
  policy revision is no longer the current one (`policy_changed`, status `unavailable`), which is
  what the plan promises at `phase-23.md:181`. The prepare half already checked it
  (`runtime/model-policy.ts:89`); the commit half did not, so a policy edited during the provider
  call could still land a question. Fixed, and covered by a new test
  ("stores nothing when the policy is revised while the answer is held").
- [PASS] Stale-target wording — `phase-23.md:157-160` now says the run ends without a question and
  the job fails with the reason, which is what `runtime/capability-job.ts:169` and
  `infrastructure/worker.ts:377-385` do.
- [PASS] Evidence status wording — `phase-23.md:92` now names the four real values
  (`open`, `win`, `loss`, `breakeven`); the reviewer's `beakeven` was a misreading, the schema says
  `breakeven` and no such typo exists anywhere in `apps/web`.
- [PASS] Format — `pnpm exec prettier --check` is clean on every file this slice touched, the plan
  document included. The repository-wide prettier failures are pre-existing and in unrelated files
  (73 files: `docs/superpowers/reports/*`, `docs/superpowers/specs/*`, `packages/importers/src/*`,
  `PRODUCT.md`).
- [PASS] Typecheck — `pnpm --filter web typecheck` reports 0 errors.
- [PASS] Tests — `pnpm exec vitest run apps/web/tests/intelligence-` → 25 files, 446 passed,
  1 skipped. The new suite `apps/web/tests/intelligence-review-insight.test.ts` → 18 passed.
  The boundary suite `apps/web/tests/intelligence-boundaries.test.ts` → 8 passed.
- [PASS] Hard block: new dependency without an ADR — `node scripts/check-licenses.mjs` → "Dependency
  licenses OK."; no manifest changed, so no ADR is owed.
- [PASS] Hard block: raw `fetch`/`axios`/`http.` in `packages/importers/src/` — no matches.
- [PASS] Hard block: trade key change without a migration — `packages/core/src/round-trips.ts` is
  untouched.
- [PASS] Hard block: P&L colour as the sole chart signal — no chart file changed.
- [PASS] Hard block: a new telemetry endpoint — no route file changed or added.
- [PASS] Boundary rules — `packages/core` imports nothing from `apps/web` or
  `packages/importers`; `packages/importers` imports nothing from `apps/web` and makes no raw HTTP
  call; `apps/web` is the only importer of `@luxalgo/broker-sdk`.
- [NOTE] The background transport carries the prompt version `review-insight-v1`, which is not
  registered in the interactive `AI_PROMPT_VERSIONS`. That is the existing background-runtime
  convention (`background-v1` in `composition.ts` is registered the same way), so no code change is
  owed; it is recorded in the phase report instead.

### Summary

20 PASS, 0 FAIL, 0 BLOCK. The five findings of the plan review are fixed: the missing ownership
row, the two throwaway files, the plan document's formatting, the two wording drifts, and the
policy-revision gap in the final transaction. The gap was a real defect in the code, not in the
plan; it is now closed and pinned by a test that fails when the check is removed.

The phase report (`docs/superpowers/reports/ai-native-journal-phase-23.md`) is written with the
implementation commit.
