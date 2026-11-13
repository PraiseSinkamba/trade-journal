## Verdict: PASS

## Reviewer Report — Phase 14 implementation (knowledge-source revisions and invalidation)

### PASS / FAIL

PASS. The implementation review of the Phase 14 diff raised two MAJOR findings and eight
MINOR/NIT findings. Both MAJOR findings are resolved with teeth — the record kind now survives
the invalidation, and the rollback case now exercises the real write path — and every MINOR
finding that touches behaviour, a contract or the test's value is resolved too. The remaining
notes are recorded without changing a check result.

### Findings

- [PASS] `apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts` — MAJOR 1 (a stale
  pattern's re-evaluation request became a hypothesis row, so the record kind was lost and the
  pattern stayed stale forever) resolved. `KnowledgeSuccessor` now carries `recordKind`
  (`apps/web/src/server/intelligence/contracts/knowledge.ts`), `subjectKey` names the subject inside
  its table, and the adapter inserts the successor into `knowledge_patterns` or
  `knowledge_hypotheses` according to the record it came from. The pattern table's evaluation
  columns (`evaluator_id`, `evaluator_version`, `evaluation_state`, `required_evidence`,
  `available_evidence`) became nullable so a pending pattern can exist without an evaluator, and
  migration `0006` carries the same constraint. Teeth: the new test case "keeps a stale pattern in
  the pattern table and asks for a re-evaluation there" asserts the pending row is in
  `knowledge_patterns` with `evaluatorId === null` and that `knowledge_hypotheses` holds no row for
  that subject. Insert the successor into the hypothesis table instead and that case fails.
- [PASS] `apps/web/tests/intelligence-knowledge-revisions.test.ts` — MAJOR 2 (the rollback case
  never called the new write path, so it proved nothing about atomicity) resolved. The case now
  calls `recordSourceChanges` with a write callback that throws, and asserts three things: no
  `knowledge_sources` row, the dependent hypothesis still `active`, and the note content unchanged.
  Teeth: write the source revision outside the transaction and the `knowledge_sources` assertion
  fails; invalidate the knowledge before the rollback and the `active` assertion fails.
- [PASS] `apps/web/src/server/intelligence/contracts/knowledge.ts` — MINOR (successors keyed by
  subject only, so a hypothesis and a pattern sharing a subject collapsed) resolved by the same
  `recordKind` keying as MAJOR 1.
- [PASS] `apps/web/tests/intelligence-knowledge-revisions.test.ts` — MINOR (only hypotheses were
  seeded, so the pattern branch was untested) resolved by the new pattern case above.
- [PASS] `apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts` — MINOR (the
  successor payload was copied with a bare `JSON.parse` and the evidence list was uncapped)
  resolved: the payload is parsed with `knowledgePayloadSchema`, and both the payload and the
  evidence list are checked against `MAX_KNOWLEDGE_PAYLOAD_BYTES`.
- [PASS] `apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts` — MINOR
  (`subjectVersions` full-scanned both tables on every source write) resolved: only the affected
  subjects are looked up, and only in the table they belong to.
- [PASS] `apps/web/src/app/api/folders/[id]/route.ts` and `apps/web/src/app/api/playbooks/[id]/route.ts`
  — MINOR (the moved notes and the referenced trades were read outside the write transaction)
  resolved: both read their rows inside the transaction that moves or clears them, so a row that
  arrived in the meantime is covered by its own revision.
- [PASS] `apps/web/src/app/api/journal/[date]/route.ts` — MINOR (a write that changed nothing still
  emitted a revision) resolved: the write callback returns no revision when the stored note text is
  already what was written. The plan and the test now state this rule, and the new case "records no
  revision for a write that changed nothing" covers it.
- [PASS] `apps/web/tests/intelligence-knowledge-revisions.test.ts` — MINOR (five matrix rows had no
  route-level case) resolved: `PATCH /api/notes/[id]`, `DELETE /api/notes/[id]`,
  `PATCH /api/playbooks/[id]`, `DELETE /api/playbooks/[id]` and `POST /api/trades/bulk` now have
  route-level cases that assert the recorded revisions and their statuses.
- [PASS] `apps/web/src/server/intelligence/composition.ts` — NIT (unused `SourceAction` and
  `SourceKind` imports) resolved.
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-14.md` — the plan now matches the
  implemented layout: the pure knowledge contracts live in `intelligence/contracts/knowledge.ts`
  (the enforced import-boundary rule 5 forbids `infrastructure/` importing a sibling domain's
  private file, and `contracts/observations.ts` already holds the pure trade-projection evaluator),
  the pattern evaluation columns are nullable while a pattern is pending, the pending successor
  keeps its record kind, and a write that changes nothing records no revision.
- [PASS] `apps/web/src/db/migrations/0006-knowledge-scheduling.ts` and
  `apps/web/src/db/migration-checksums.json` — the migration is additive and immutable, the
  registry entry and the checksum artifact are regenerated (`pnpm --filter web migrations:build`,
  `migrations:check` reports the artifact is up to date), the typed schema mirrors the DDL and
  `BOOTSTRAP_SQL` splices the same constant.
- [PASS] scope — no scheduler behaviour, no workflow, engagement or UI work, no new dependency, no
  schema change outside migration `0006`, no model-driven financial write, no network call inside a
  write transaction, and no change to any provider, credential, cTrader, import or AI response
  contract.
- [PASS] compatibility — the existing route response bodies are unchanged; the wrapped write paths
  answer exactly what they answered before (`{ id }`, `{ updated }`, `{ deleted }`, `{ saved }`),
  and the trade, its fills and its annotations survive a source write and a rebuild.
- [PASS] scoped verification — `pnpm exec vitest run apps/web/tests/intelligence-knowledge-revisions.test.ts`
  → 1 file, 26 tests passed (≈0.31 s); `pnpm --filter web typecheck` → clean;
  `pnpm --filter web migrations:check` → the artifact is up to date; the supporting regressions
  `intelligence-migrations` (17), `intelligence-boundaries` (8), `intelligence-observations`,
  `journal-features`, `folder-delete`, `note-formatting` and `account-mutation-routes` → 7 files,
  72 tests passed.
- [NOTE] the full `pnpm test` gate is the coordinator's destination run, not this phase's; it was
  not run here, by the coordinator's instruction.

### Summary

15 PASS, 0 FAIL, 0 BLOCK. Both MAJOR findings are resolved with teeth, every MINOR finding that
touches behaviour, a contract or the test's value is resolved, the scoped verification commands are
green, and the plan text matches the implementation.
