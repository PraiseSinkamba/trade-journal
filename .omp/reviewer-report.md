## Verdict: PASS

## Reviewer Report — Phase 14 plan (knowledge-source revisions and invalidation)

### PASS / FAIL

PASS. The plan-review round raised four MAJOR findings and eighteen MINOR/NIT findings; all four
MAJOR findings and every MINOR finding that touches a contract, a schema rule or an acceptance
criterion are resolved in the committed plan text. The findings that touch wording only are
recorded below with the resolution.

### Findings

- [PASS] `docs/superpowers/plans/ai-native-journal/phase-14.md` — MAJOR 1 (successor enqueue
  contradicted the acceptance bullets) resolved. The `applySourceChange` section now states that
  only rows moved to `stale` receive a pending successor, that a `deleted` action moves rows to
  `invalidated` and enqueues nothing, and the acceptance section repeats the split.
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-14.md` — MAJOR 2 (a second correction left
  the pending successor bound to an older source revision) resolved. Step 4 of the contract now
  supersedes an older pending request and binds the new successor to the newest source revision,
  and the acceptance section asserts it.
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-14.md` — MAJOR 3 (the annotation-destroying
  trade deletes emitted no source change) resolved. The write-path matrix now carries two extra rows,
  `DELETE /api/trades/[key]` and the bulk `delete` action, as `annotation` `deleted` changes, and the
  matrix note explains that the trade delete runs inside the same immediate transaction as the
  source change.
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-14.md` — MAJOR 4 (the SQLite adapter placed
  inside the knowledge domain) resolved. The knowledge directory is now pure
  (`patterns.ts`, `revisions.ts`); the adapter is `infrastructure/knowledge-revisions.ts`, exposed
  through `composition.ts`, and the scope section states the contract-review §2 and ADR 0008 reason.
- [PASS] schema allocation and migration checklist — the MAJOR (unversioned, uncapped JSON
  payloads) and the MINOR (missing nullability, defaults and `CHECK` constraints) are resolved: the
  plan now lists every column with nullability, default and `CHECK` constraint, adds
  `payload_schema_version`, and caps `payload_json` and `evidence_ids_json` at 16 KiB.
- [PASS] upgrade coverage — the MINOR (no explicit `0005` → `0006` upgrade case) is resolved: the
  checklist now requires the phase test to upgrade a journal that is at `0005` and assert the same
  four tables.
- [PASS] `intelligence_schedules` — the MINOR (untyped checkpoint, no schedule version) is resolved:
  the table now defines `checkpoint_json` as a capped JSON object and states that
  `definition_version` is the version Phase 15 keys its `(scheduleId, dueAt, version)` job from.
- [PASS] `knowledge_hypotheses` — the MINOR (no evaluator identity on a derived finding) is resolved:
  both tables carry `evaluator_id` and `evaluator_version`; the hypotheses' are nullable because a
  hypothesis may be self-reported, the patterns' are not because a pattern is always the result of a
  pattern evaluation.
- [PASS] `knowledge_patterns` representation — the MINOR (the evaluation union stored twice) is
  resolved: the row keeps the evaluation state as columns (`evaluation_state`,
  `required_evidence`, `available_evidence`, `evaluator_id`, `evaluator_version`) and the pure
  `PatternEvaluation` union stays a contract of the evaluator.
- [PASS] account scope — the MINOR (invalidation did not constrain the account) is resolved: the
  contract states that the account-scoped kinds match on the same `account_id` and the shared kinds
  on `account_id IS NULL`; the MINOR on the inverted scope wording is resolved by stating that a
  narrowed account scope never exposes shared-source knowledge and only the unscoped view does.
- [PASS] write-path details — the MINORs are resolved: the folder delete emits one `note` change per
  affected note id under one correlation id; the `rule_check` source id is the rule-check row id
  `JSON.stringify([tradeKey, playbookId, rule])`, account-scoped through the trade; the correlation
  id is one `newUuid()` per request.
- [PASS] `evaluatePattern` — the MINOR (no signature, no source for `required`) is resolved: the
  signature and the meaning of `required` and `available` are stated.
- [PASS] transaction semantics — the MINOR (no `behavior: "immediate"`) is resolved: the matrix
  states `withJournalTransaction` with `behavior: "immediate"`, and the source revision is allocated
  inside that transaction.
- [PASS] revision allocation — the MINOR (allocation outside the transaction) is resolved: the
  matrix states the revision is allocated inside the same immediate transaction.
- [PASS] `SourceChange` discrimination — the MINOR (prose said ten members, the type was flat) is
  resolved: the type now discriminates on `kind`, the account scope is part of the member, and the
  prose says "ten permitted combinations".
- [PASS] meaningful test fixtures — the MINOR (nothing produced knowledge rows, so the assertions
  could pass vacuously) is resolved: step 2 of the plan requires the test to seed dependent knowledge
  rows explicitly.
- [PASS] composition wiring — the MINOR (a step named a deliverable that does not exist) is resolved:
  step 7 now names the concrete wiring (one adapter instance reached through `composition.ts`).
- [NOTE] `composition.ts` ownership — the plan keeps `composition.ts` in scope. The coordinator's
  dispatch message allocates it explicitly ("`apps/web/src/server/intelligence/composition.ts` (wire
  the source change and the knowledge invalidation)"), which is the newer allocation; the packet's
  ownership paragraph lists it as shared, and the phase rule reserves it to one owner per phase.
  This phase has one writer.
- [NOTE] `apps/web/src/server/trading/commands.ts` — not edited. The trade-delete source change is
  emitted by the route that owns the write path, inside the same transaction as the `deleteTrades`
  command, so the command file needs no change.
- [NOTE] No behavioural rule, no evaluator registration, no scheduler behaviour and no UI are
  planned. The full `pnpm test` gate stays with the coordinator's destination run.

### Summary

17 PASS, 0 FAIL, 0 BLOCK. The four MAJOR findings and every MINOR finding that touches a contract,
a schema rule or an acceptance criterion are resolved in the plan text. Three notes are recorded
above without changing a check result.
