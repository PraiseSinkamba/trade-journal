## Verdict: PASS

## Reviewer Report — Phase 22 implementation (the revision-bound insight storage)

### Findings

- [PASS] format:check — every touched file is prettier-clean (`pnpm exec prettier --check` over the
  14 touched source, test and documentation files).
- [PASS] typecheck — `pnpm --filter web typecheck` exits 0.
- [PASS] migration artifact — `pnpm --filter web migrations:check` exits 0; the checksum artifact
  was regenerated with `pnpm --filter web migrations:build`, never hand-edited.
- [PASS] tests — the five named suites pass (5 files, 100 tests) and the whole app suite passes
  (105 files, 1223 passed, 1 skipped).
- [PASS] commit subject — _feat: persist a revision-bound AI insight_ says what the phase delivers.
- [PASS] migration contract — `0008` is additive only, every statement carries `IF NOT EXISTS`,
  `INSIGHTS_SQL` is reused by `BOOTSTRAP_SQL`, the registry entry is appended in version order, and
  `0001`–`0007` are byte-unchanged.
- [PASS] boundary rule — `apps/web/tests/intelligence-boundaries.test.ts` passes; the contracts
  module imports only the `JournalTx` type and the infrastructure module imports only the
  contracts, `@/db` and `@/server/ids`.
- [PASS] no new dependency, no provider call, no network, no promise inside a migration's `up`, and
  no change to any route, component, the AI runtime, the model policy or the worker.

### Findings from the implementation review, and what was done about them

The reviewer run on the implementation diff returned FAIL with one MAJOR and five MINOR findings.
Every one was fixed and re-verified.

- [PASS] `apps/web/src/server/intelligence/contracts/insights.ts:81` (MAJOR, fixed) — the store port
  was never bound: nothing satisfied `InsightStore`, the compiler could not catch drift, and Phase B
  would have had to import the infrastructure directly and failed the boundary rule. The adapter now
  exposes `createInsightStore(): InsightStore`, the factory the repo's other stores use. The
  typecheck is the guard: removing `readCurrentInsightInTx` from the factory fails with
  `TS2741: Property 'readCurrentInsightInTx' is missing`.
- [PASS] `apps/web/src/server/intelligence/infrastructure/insight-store.ts:153` (MINOR, fixed) — two
  of the four live-reference checks compared ids across disjoint spaces and could never be true.
  The guard is now the two same-space checks: the live index holds observation ids and projection
  revision ids, and those are the two spaces the insight's own ids live in.
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:312` (MINOR, fixed) — the
  chunked delete of insights by observation id was unreachable: the observations were already
  deleted and the foreign key cascades, so the statement matched zero rows. It is gone; the
  account-id delete is the one that does the work.
- [PASS] `apps/web/tests/intelligence-insights.test.ts:162` (MINOR, fixed) — the prune test only
  exercised the observation half of the live guard, so the revision check was never exercised by any
  test. A new case gives the live workflow an evidence list naming the insight's revision and a
  subject that is not the insight's observation, so only the revision check can keep the question
  alive. Removing the revision check from the prune fails that case.
- [PASS] `apps/web/src/server/intelligence/infrastructure/insight-store.ts:85` (MINOR, fixed) — the
  read ignored `capability_version`, so two rows for the same subject and revision with different
  versions both satisfied the `WHERE` clause and the read returned an arbitrary one. The read now
  names one capability version, and a new case covers the two-version case.
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-22.md:44` (MINOR, fixed) — the ownership
  table listed the phase report, which did not exist in the worktree. It exists now, at
  `docs/superpowers/reports/ai-native-journal-phase-22.md`.

### The teeth

Ten mutations were made against the production code and every one was seen to fail before the code
was restored: the business-key conflict guard, the read's current-revision condition, the read's
capability-version filter, the live-reference guard (both halves), the purge's insight deletes, the
restore's ledger re-application, the migration's `up`, the question validation, and the store
factory's port binding. Each mutation failed at least one named test or the typecheck; each was
restored and re-verified green. The table is in the phase report. No mutation marker is left in the
tree.

Two mutations exposed tests that passed for the wrong reason, and both were corrected: the purge
case did not discriminate the guarantee until the observation cascade was also removed, and the new
revision case did not isolate the revision half until the live workflow's subject was decoupled
from the insight's observation.

### Summary

All findings addressed and re-verified. No BLOCK, no MAJOR, no MINOR outstanding. The
implementation matches the reviewed plan, the migration contract and the repository conventions.
