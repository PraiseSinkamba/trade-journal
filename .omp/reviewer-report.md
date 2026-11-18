## Verdict: PASS

## Reviewer Report — Phase 22 plan (`docs/superpowers/plans/ai-native-journal/phase-22.md`)

### Findings

- [PASS] plan:190 (MAJOR, fixed) — the `0008` DDL lacked the `IF NOT EXISTS` guards every prior
  migration uses; `BOOTSTRAP_SQL` embeds the same text, so an unguarded `CREATE TABLE` would abort
  the upgrade of a legacy journal. The plan now spells out the guarded DDL verbatim.
- [PASS] plan:120 (MAJOR, fixed) — the business key's rationale was wrong: `source_revision` was
  ambiguous between the projection revision UUID and the knowledge revision ordinal. The plan now
  states that `source_revision` holds `trade_projection_revisions.id`, exactly like
  `intelligence_observations.source_revision`, and explains why the ordinal would collide.
- [PASS] plan:168 (MAJOR, fixed) — the port promised `persistInsightInTx(): string` while also
  promising that an invalid question writes nothing. The port now returns `string | null`, and a
  duplicate write returns the id of the row that is already there (read back by business key).
- [PASS] plan:169 (MINOR, fixed) — the read port returns `InsightRow | null`, matching the repo's
  store ports.
- [PASS] plan:219 (MINOR, fixed) — the check list now includes
  `apps/web/tests/intelligence-boundaries.test.ts`, which the plan calls part of the gate.
- [PASS] plan:208 (MINOR, fixed) — the exit evidence now covers the restore guarantee
  (`intelligence-backup.test.ts`) and the account-deletion cascade, and both files are in the
  ownership table.
- [PASS] plan:91 (MINOR, fixed) — the plan no longer mints a second capability-id registry; only
  the version constant is minted, and Phase B adds the id to `JOURNAL_CAPABILITY_IDS`.
- [PASS] plan:66 (MINOR, fixed) — the index set now covers the prune rule
  (`source_revision`, `created_at`), and the plan says the 90-day test reads `created_at`.
- [PASS] plan:73 (MINOR, fixed) — the `run_id` foreign key rationale is stated as `SET NULL` and
  never `CASCADE`: the question must survive the loss of its producer.
- [PASS] plan:157 (MINOR, fixed) — the plan no longer claims the old observation always becomes
  `superseded`; the revision check is named as the mechanism that hides the older question, and the
  observation status is a secondary signal.

### Summary

10 findings on the plan revision, all addressed. No BLOCK, no MAJOR outstanding. The plan is
implementable as written.

The implementation diff gets its own reviewer run and its own report.
