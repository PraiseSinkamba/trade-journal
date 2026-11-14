## Verdict: PASS

## Reviewer Report — Phase 14 repair (journal write and source revision independence)

### PASS / FAIL

PASS. The repair diff resolves all four findings of the Phase 14 implementation review. The one
production file that changed differs from the implementation commit `1281bdb` only in the ordering
of the upsert and the revision decision, exactly as the brief requires. The two strengthened test
cases are real tests: each was seen to fail against deliberately broken behaviour and to pass again
after the restore. The plan's column table now states the nullability the shipped migration
actually has. No migration, schema, dependency, financial, hash, key or annotation change.

### Findings

- [PASS] `apps/web/src/app/api/journal/[date]/route.ts` — FINDING 1 resolved. The guard
  `if (stored?.note === text) return [];` no longer sits before the upsert. The upsert now runs
  first and is byte-identical to the pre-Phase-14 base route: it always refreshes
  `journal_days.updated_at` with `nowIso()`. The guard afterwards only decides whether a revision
  is emitted. An unchanged note therefore still writes and still produces no revision; there is no
  early return before the write.
- [PASS] `apps/web/tests/intelligence-knowledge-revisions.test.ts` — FINDING 2 resolved. The new
  case "undoes the source write when the event application fails" makes the source write succeed
  first (the trade annotation is written) and lets the event application fail afterwards (the
  source revision names an account that does not exist, and the `knowledge_sources.account_id`
  foreign key refuses it; `foreign_keys = ON` is set on every journal connection). It asserts the
  write was undone and that no revision survived. Splitting `recordSourceChanges` into two
  transactions leaves the annotation applied and the case fails.
- [PASS] `apps/web/tests/intelligence-knowledge-revisions.test.ts` — FINDING 3 resolved. The
  no-revision case is now driven through `PUT /api/journal/[date]`: the same text is written twice
  and the case asserts exactly one revision in total, an unchanged note, and that the second write
  still refreshed `journal_days.updated_at`. Deleting the route's guard makes the second write
  emit a second revision and the case fails; skipping the upsert for an unchanged note leaves the
  timestamp stale and the case fails. Fake timers are scoped to `Date` and restored in a `finally`.
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-14.md` — FINDING 4 resolved. The
  `knowledge_hypotheses` / `knowledge_patterns` column table now states the shipped shape:
  `evaluator_id` and `evaluator_version` are nullable in both tables, and `evaluation_state`,
  `required_evidence` and `available_evidence` are nullable and patterns-only with the exact
  `IS NULL OR ...` checks. The prose above the table no longer claims that a pattern always names
  its evaluator. The migration and the schema were not changed to match the plan.
- [PASS] scope — the only production file that differs from `1281bdb` is
  `apps/web/src/app/api/journal/[date]/route.ts`, and it differs only in the ordering of the
  upsert and the revision decision. `apps/web/src/server/intelligence/composition.ts` and every
  other production file are byte-unchanged. The remaining diff is the test file and the plan
  document.
- [PASS] `pnpm exec vitest run apps/web/tests/intelligence-knowledge-revisions.test.ts` — 27 tests
  pass, exit code 0.
- [PASS] `pnpm --filter web typecheck` — exit code 0, no diagnostics.
- [PASS] format — `prettier --check` reports the touched route and test files clean; the plan
  document was formatted with `prettier --write` on that single file.
- [PASS] commit subject — "fix: keep the journal note write and the source revision independent"
  states what was fixed in terms a non-engineer can follow.

### Notes (not blocking, outside this repair's scope)

- The plan's column table lists the `source_kind` `CHECK` constraint as `—`, while the shipped DDL
  declares one. This drift predates the repair and is not one of the four findings; it is recorded
  for a later phase rather than changed here.

### Summary

9 PASS, 0 FAIL, 0 BLOCK.
