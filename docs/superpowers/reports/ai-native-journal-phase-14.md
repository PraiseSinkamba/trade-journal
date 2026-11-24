# Phase 14 report — Knowledge-source revisions and invalidation

Phase 14 of the AI-native journal run, milestone M4, task packet T-014. This report records what
changed, the evidence against the exact code SHA, the review findings and their resolutions, the
deviations and the inputs the next phase needs.

- Source branch: `codex/ai-native-journal-p14` (Orca child worktree of the feature worktree)
- Base SHA: `934953ca9801b025a34cd1386fd536120922fb6e` (the verified feature HEAD)
- Phase plan: `docs/superpowers/plans/ai-native-journal/phase-14.md` (committed first, `4ab6776`)
- Implementation: `1281bdb` — _feat: schedule bounded intelligence and propagate source revisions_
- Tip SHA at report time: the commit that adds this report (see the coordinator handoff)

## Outcome

Delivered the **source half** of detailed-plan Task 10: the `SourceChange` contract, the write
paths that emit it, and the knowledge lifecycle that survives a source correction or a deletion.

A user-authored source — a trade annotation, a trade rule check, a playbook, a journal day note or
a note — now changes in **one** immediate transaction with the revision that describes it. A
correction marks the knowledge that was derived from the old content `stale` and raises a pending
re-evaluation request bound to the newest source revision; a deletion invalidates that knowledge
and raises nothing, because a source that no longer exists cannot be re-derived.

The scheduler half of Task 10 — `scheduleDue`, duplicate ticks, DST, offline coalescing — is
**Phase 15** and is not implemented here. Migration `0006` creates the `intelligence_schedules`
table and nothing writes into it.

## Changed files and exported interfaces

New shared contracts (pure — no database, no Next, no AI SDK):

| File                                                      | Exports                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/server/intelligence/contracts/knowledge.ts` | `MAX_KNOWLEDGE_PAYLOAD_BYTES`, `KNOWLEDGE_PAYLOAD_SCHEMA_VERSION`, `PatternEvaluation`, `patternEvaluationSchema`, `evaluatePattern`, `knowledgePayloadSchema`, `KnowledgePayload`, `KnowledgeStatus`, `KnowledgeRecordKind`, `KnowledgeRecord`, `KnowledgeSuccessor`, `InvalidationDecision`, `nextRevision`, `subjectKey`, `dependsOnSource`, `planInvalidation` |

New event contract:

| File                                   | Exports                                                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/domain-events.ts` | `SourceKind`, `SourceAction`, `SourceChange`, `ACCOUNT_SCOPED_SOURCE_KINDS`, `SHARED_SOURCE_KINDS`, `sourceChangeSchema`, `parseSourceChange` |

New SQLite adapter:

| File                                                                     | Exports                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts` | `currentSourceRevision`, `nextSourceRevision`, `applySourceChange`, `listKnowledgeInScope` |

Modified:

| File                                                      | Change                                                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/server/intelligence/composition.ts`         | The source-revision service: `SourceChangeRequest`, `recordSourceChanges`, and the `applySourceChange` re-export                                                   |
| `apps/web/src/app/api/notes/route.ts`                     | A created note commits with its `note` revision                                                                                                                    |
| `apps/web/src/app/api/notes/[id]/route.ts`                | An edited and a deleted note commit with their `note` revisions                                                                                                    |
| `apps/web/src/app/api/folders/[id]/route.ts`              | Each note the deleted folder moved commits with its own `note` revision, under one correlation id                                                                  |
| `apps/web/src/app/api/journal/[date]/route.ts`            | The journal day note commits with its `journal` revision; an unchanged note records none                                                                           |
| `apps/web/src/app/api/playbooks/route.ts`                 | A created playbook commits with its `playbook` revision                                                                                                            |
| `apps/web/src/app/api/playbooks/[id]/route.ts`            | An edited playbook commits with its revision; a deleted playbook commits with its `deleted` revision and with an `annotation` revision for every trade it unlinked |
| `apps/web/src/app/api/trades/[key]/route.ts`              | A written annotation commits with its `annotation` revision; a deleted trade commits with its `annotation` `deleted` revision                                      |
| `apps/web/src/app/api/trades/[key]/rules/route.ts`        | A rule check commits with its `rule_check` revision; `followed: null` records a `deleted` revision                                                                 |
| `apps/web/src/app/api/trades/bulk/route.ts`               | A bulk annotation change commits with one `annotation` revision per trade; a bulk delete commits with one `annotation` `deleted` revision per trade                |
| `apps/web/src/db/migrations/0006-knowledge-scheduling.ts` | The new migration                                                                                                                                                  |
| `apps/web/src/db/migrations.ts`                           | Registers migration `0006`                                                                                                                                         |
| `apps/web/src/db/schema.ts`                               | The four new typed tables                                                                                                                                          |
| `apps/web/src/db/bootstrap.ts`                            | Splices the same DDL constant into the final-schema snapshot                                                                                                       |
| `apps/web/src/db/migration-checksums.json`                | Regenerated artifact                                                                                                                                               |

Tests: `apps/web/tests/intelligence-knowledge-revisions.test.ts` (new, 26 tests).

Compatibility preserved: every route answers exactly the same body as before (`{ id }`,
`{ updated }`, `{ deleted }`, `{ saved }`, `{ updated: n }`); every provider, the encrypted
credentials, the cTrader sync, the financial hashes, keys and annotations and the existing import
and AI response contracts are untouched. No financial value is written by this phase.

## Migrations

One new forward-only migration, `0006-knowledge-scheduling`, additive only. It creates four tables
and never rewrites an existing one, so a legacy journal and a fresh journal converge on the same
schema.

| Table                    | Columns                                                                                                                                                                                                                                              | Keys / indexes                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge_sources`      | `id`, `kind`, `source_id`, `revision`, `account_id`, `status`, `correlation_id`, `recorded_at`                                                                                                                                                       | PK `id`, unique `(kind, source_id, revision)`, index `(kind, source_id, status)`, index `account_id`                                      |
| `knowledge_hypotheses`   | `id`, `subject_type`, `subject_id`, `version`, `status`, `payload_schema_version`, `payload_json`, `evidence_ids_json`, `evaluator_id`, `evaluator_version`, `source_kind`, `source_id`, `source_revision`, `account_id`, `created_at`, `updated_at` | PK `id`, unique `(subject_type, subject_id, version)`, index `(source_kind, source_id, account_id, status)`, index `(account_id, status)` |
| `knowledge_patterns`     | the hypothesis columns plus `evaluation_state`, `required_evidence`, `available_evidence`                                                                                                                                                            | as above                                                                                                                                  |
| `intelligence_schedules` | `id`, `definition_version`, `next_due_at`, `checkpoint_json`, `created_at`, `updated_at`                                                                                                                                                             | PK `id`, index `(next_due_at)`                                                                                                            |

Constraints and nullability:

- `knowledge_sources.kind` — `CHECK (kind IN ('annotation','rule_check','playbook','journal','note'))`.
- `knowledge_sources.revision` — `CHECK (revision > 0)`.
- `knowledge_sources.status` — `CHECK (status IN ('active','superseded','invalidated'))`.
- `knowledge_sources.account_id` — nullable, FK → `accounts(id)` `ON DELETE CASCADE`; null means a
  shared source.
- `knowledge_hypotheses.status` — `CHECK (status IN ('active','stale','pending','superseded','invalidated'))`.
- `knowledge_hypotheses.version` — `CHECK (version > 0)`; `source_revision` — `CHECK (source_revision > 0)`.
- `knowledge_hypotheses.evaluator_id` / `evaluator_version` — nullable: a hypothesis may be
  self-reported, and a pending row has not been evaluated.
- `knowledge_patterns.evaluation_state` — nullable, `CHECK (evaluation_state IS NULL OR evaluation_state IN ('evaluated','insufficient_evidence'))`; `required_evidence` / `available_evidence` — nullable, `CHECK (... IS NULL OR ... >= 0)`. A pattern that has not been evaluated yet carries no evaluator: a pending re-evaluation request is a question, not a conclusion.
- `knowledge_patterns.evaluator_id` / `evaluator_version` — nullable for the same reason.
- Both knowledge tables: `payload_schema_version` — `NOT NULL DEFAULT 1`; `payload_json` and
  `evidence_ids_json` — `NOT NULL`, capped at 16 KiB by the application.
- `knowledge_hypotheses.account_id` / `knowledge_patterns.account_id` — nullable, FK → `accounts(id)`
  `ON DELETE CASCADE`.
- `intelligence_schedules.definition_version` — `CHECK (definition_version > 0)`; `checkpoint_json` —
  nullable.

Upgrade results:

- Migrations `0001`–`0005` are untouched; their checksums stay valid.
- The checksum artifact was regenerated with `pnpm --filter web migrations:build` and verified with
  `pnpm --filter web migrations:check` ("migration-checksums.json is up to date").
- The phase test carries the `0006`-specific assertions: the four tables exist in the journal; the
  registered checksum of migration `0006` is the checksum of the migration source; the ledger row the
  runner applied holds that checksum; and a journal that is at `0005` (the four tables dropped, the
  ledger row for `6` removed) upgrades to `0006` with the same four tables.
- `apps/web/tests/intelligence-migrations.test.ts` (registry-driven) stays green: 17 tests, including
  the fresh/upgrade convergence, the byte-for-byte credential, hash and annotation check, the
  concurrent-start case and the failure-rollback case.

Rollback impact: additive tables only. Rollback means deploying the previous binary with the new
tables retained, or restoring a verified backup — no destructive down migration, no data rewrite, no
rewrite of any key, hash or credential. No backfill, no provider call and no historical engagement is
triggered by the migration.

## Commands actually run

| Command                                                                                                                                                                                                                                                                                                                                  | Result                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-knowledge-revisions.test.ts`                                                                                                                                                                                                                                                           | 1 file, **26 tests passed** (≈0.31 s)                   |
| `pnpm --filter web typecheck`                                                                                                                                                                                                                                                                                                            | clean (`next typegen` + `tsc --noEmit`, no diagnostics) |
| `pnpm --filter web migrations:build`                                                                                                                                                                                                                                                                                                     | artifact written                                        |
| `pnpm --filter web migrations:check`                                                                                                                                                                                                                                                                                                     | "migration-checksums.json is up to date"                |
| `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/journal-features.test.ts apps/web/tests/folder-delete.test.ts apps/web/tests/note-formatting.test.ts apps/web/tests/account-mutation-routes.test.ts apps/web/tests/intelligence-observations.test.ts` | **7 files, 72 tests passed**                            |
| `pnpm exec prettier --check` on every touched file                                                                                                                                                                                                                                                                                       | clean after the formatting pass                         |

The full `pnpm test` gate was **not** run here: the coordinator runs the destination gate once,
alone, after the merge.

## Review findings and resolutions

The phase had two reviewer runs: one on the plan, one on the implementation diff. Both are
recorded in `.omp/reviewer-report.md` at the implementation commit.

Plan review — 4 MAJOR and 18 MINOR/NIT findings, all resolved in the plan text before the
implementation started: the pending successor now only follows a correction (a deletion enqueues
nothing); a second correction supersedes the unevaluated request and binds the new one to the
newest source revision; the annotation-destroying trade deletes are in the write-path matrix; the
SQLite adapter lives in `infrastructure/` while the domain stays pure; the payloads are
schema-versioned and capped; the column list carries nullability, defaults and `CHECK`
constraints; the phase test must cover the `0005` → `0006` upgrade; the schedule table's checkpoint
and version are defined; the hypotheses carry the evaluator identity; the account scope is part of
the invalidation match; the source ids, the correlation id, the revision allocation and the
immediate transaction are specified; and the `SourceChange` union is discriminated.

Implementation review — 2 MAJOR and 8 MINOR/NIT findings, all resolved:

- **MAJOR** — a stale pattern's re-evaluation request became a hypothesis row, so the record kind
  was lost and the pattern stayed stale forever. `KnowledgeSuccessor` now carries `recordKind`, the
  subject key names the subject inside its table, and the adapter inserts the successor into the
  table the record came from; the pattern table's evaluation columns became nullable so a pending
  pattern can exist without an evaluator.
- **MAJOR** — the rollback case never called the new write path, so it proved nothing about
  atomicity. It now calls `recordSourceChanges` with a write callback that throws and asserts that
  no source revision, no invalidation and no content change survived.
- The remaining findings: successors keyed by subject only (fixed with the same record-kind keying),
  the pattern branch untested (a pattern fixture case now covers it), the successor payload copied
  with a bare `JSON.parse` and the evidence list uncapped (both now use the strict schema and the
  16 KiB cap), the version lookup scanning both tables (now scoped to the affected subjects), the
  moved notes and the referenced trades read outside the write transaction (both now read inside it),
  a write that changed nothing still emitting a revision (the write callback now returns no
  revision when nothing changed), five matrix rows without a route-level case (all five now have
  one), and two unused imports (removed).

## Phase 14 repair — journal write and source revision independence

A later review of the implementation diff raised four findings against this phase: one real
production regression and three findings about the proof and the documentation. All four are
resolved. The repair is a separate commit on top of the phase commits; the three phase commits
were not amended or rewritten.

### The four findings and their resolutions

1. **Production regression — the journal day write was skipped for an unchanged note.**
   `apps/web/src/app/api/journal/[date]/route.ts` guarded with `if (stored?.note === text) return [];`
   **before** the upsert, so an unchanged note skipped the whole write and
   `journal_days.updated_at` was no longer refreshed. The base route before Phase 14 always
   upserted. **Resolution:** the upsert now runs first and is byte-identical to the base route —
   it always refreshes `updated_at` with `nowIso()` — and the guard afterwards only decides
   whether a revision is emitted. The write and the revision decision are independent: an
   unchanged note still writes, and an unchanged note still produces no revision. There is no
   early return before the write.

2. **The atomicity case never applied the event.** The only atomicity case threw inside the
   write callback, so the source change was never attempted; the case would still pass if
   `recordSourceChanges` committed the source write in one transaction and applied the change in
   a second. **Resolution:** a new case, "undoes the source write when the event application
   fails", makes the source write succeed first (the trade annotation is written) and lets the
   event application fail afterwards — the source revision names an account that does not exist
   and the `knowledge_sources.account_id` foreign key refuses it (`foreign_keys = ON` on every
   journal connection). It asserts that the write was **undone** and that no revision survived.
   The existing rollback case is untouched and still proves the other direction.

3. **The no-revision case was never driven through the route.** The old case re-implemented the
   journal route's guard inside the test, so deleting the route's guard left every test green.
   **Resolution:** the case now drives `PUT /api/journal/[date]` twice with the same text and
   asserts exactly **one** revision in total, an unchanged note, and that the second write still
   refreshed `journal_days.updated_at`. The clock is controlled with fake timers scoped to `Date`
   and restored in a `finally`, so the timestamp assertion is exact rather than timing-dependent.

4. **The plan's column table contradicted the shipped migration.** The plan still specified
   `knowledge_patterns.evaluator_id` and `evaluator_version` as `NOT NULL`, and
   `evaluation_state` / `required_evidence` / `available_evidence` as pattern-only `NOT NULL`,
   while the shipped `0006` DDL and `schema.ts` make all five nullable. **Resolution:** the plan's
   column table now states the shipped shape — the two evaluator columns are nullable in both
   tables, the three evaluation columns are nullable and patterns-only with the exact
   `IS NULL OR ...` checks — and the paragraph above the table no longer claims that a pattern
   always names its evaluator. **The migration and the schema were not changed to match the
   plan**: the shipped shape is correct, because a pattern can exist before it has been
   evaluated.

### Proof of teeth

Every changed case was seen to fail against deliberately broken behaviour and to pass again after
the restore. The production files were restored exactly afterwards.

| Case                                                  | Deliberate break                                                                                                            | Result while broken                                                                                                             | Result after restore |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Finding 3 / Finding 1 — route-driven no-revision case | The journal route's guard moved back **before** the upsert, so an unchanged note skipped the write                          | **FAIL** — `expected '2026-09-01T00:00:00.000Z' to be '2026-09-02T00:00:00.000Z'` (the second PUT did not refresh `updated_at`) | **PASS**             |
| Finding 3 — route-driven no-revision case             | The route's no-revision guard deleted, so every PUT emits a revision                                                        | **FAIL** — `expected [ …(8), …(8) ] to have a length of 1 but got 2`                                                            | **PASS**             |
| Finding 2 — atomicity case                            | `recordSourceChanges` split into two transactions: the source write commits first, the source change is applied in a second | **FAIL** — `expected 'my review' to be null` (the source write was left applied)                                                | **PASS**             |

The Finding 2 case was re-proved against the final fixture (a trade annotation rather than a
note), because the reviewer pass changed the fixture.

### Repair verification commands

Run in this order, against the repair commit:

| Command                                                                        | Result                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-knowledge-revisions.test.ts` | **1 file, 27 tests passed** (exit code 0, ≈0.58 s of test time)                         |
| `pnpm --filter web typecheck`                                                  | **clean** (`next typegen` + `tsc --noEmit`, no diagnostics, exit code 0, 1 m 46 s wall) |
| `pnpm exec prettier --check` on the touched route and test files               | clean; the plan document was formatted with `prettier --write` on that single file      |

The whole-project `pnpm test` gate was deliberately **not** run here: the coordinator runs the
destination gate once, alone, after the merge.

### Repair scope

`git diff 1281bdb -- apps/web/src/` shows exactly one production file changed:
`apps/web/src/app/api/journal/[date]/route.ts`, and it differs only in the ordering of the upsert
and the revision decision. `apps/web/src/server/intelligence/composition.ts` and every other
production file are byte-unchanged. The repair adds no dependency, no schema change and no
migration, and touches no financial value, hash, key or annotation.

### Repair review

One reviewer run, on the implementation diff of the repair, as the repair brief allows. Its
verdict was **PASS** with four P3 nits and no P0–P2 defect. Two nits were resolved in the repair:
the production diff was reduced to the pure reorder (an explanatory comment was removed), and the
atomicity fixture was changed so the write and the change name one coherent source. One nit was
resolved in the plan: the three patterns-only rows now read `yes (patterns only)` in the Null
column, so the column answers nullability the way the other rows do. The fourth nit — the plan
lists the `source_kind` `CHECK` constraint as `—` while the shipped DDL declares one — predates
the repair, is not one of the four findings, and is recorded here rather than changed.

## Deviations

- **The pure knowledge contracts live in `intelligence/contracts/knowledge.ts`, not in a
  `intelligence/knowledge/` directory.** The plan named a `knowledge/` domain directory. The enforced
  import-boundary rule 5 forbids `infrastructure/` importing a sibling domain's private file, and
  the contract review §2 puts SQLite adapters in `infrastructure/`, so the pure decisions the
  adapter needs must live in `contracts/` — where `contracts/observations.ts` already holds the pure
  trade-projection evaluator. The plan text was corrected before the implementation commit.
- **`knowledge_patterns.evaluator_id`, `evaluator_version`, `evaluation_state`,
  `required_evidence` and `available_evidence` are nullable.** The plan first listed them as
  `NOT NULL`. A pending re-evaluation request has not been evaluated, so it cannot name an
  evaluator; the pattern table would otherwise have no way to hold the request that the invalidation
  raises. Migration `0006` was never applied anywhere, so it was corrected in place before the
  first commit — no applied migration was edited.
- **`recordSourceChanges` takes a write callback that returns the revisions it caused**, instead of
  a write callback and a revision list. The callback reads what it needs inside the transaction, so
  a write that changes nothing returns no revision and a row that arrived concurrently is covered.
  The write path matrix and the plan were updated to match.
- The commit subject is the detailed plan's Task 10 subject, `feat: schedule bounded intelligence
and propagate source revisions`. **This phase implements only the source-revision and invalidation
  half of Task 10**; the scheduler half is Phase 15 and no scheduler behaviour exists here.

## Compatibility and preserved behaviour

- Every provider, the encrypted credentials, the cTrader sync, the financial hashes, keys and
  annotations and the existing import and AI response contracts are unchanged. No file outside the
  phase's ownership was edited, no dependency was added (therefore no new ADR), and no financial
  value is written.
- The trade row, its fills and its annotations survive a source write and a rebuild: the rebuild
  recomputes the financial facts and the user's annotation values stay, while the knowledge revision
  of the annotation advances on its own counter.

## Risks and what they block

- **No evaluator exists yet.** The phase ships the lifecycle and the contracts, not the evaluator:
  a pending re-evaluation request is durable, but nothing drains it yet. This is the intended
  hand-off to the phase that owns the evaluator; it does not block the destination merge.
- **The knowledge tables are written by fixtures only.** Nothing in production produces findings
  yet, so the phase test seeds the dependent rows explicitly — without them the invalidation
  assertions would pass vacuously. That is stated in the test's own header.
- **The `intelligence_schedules` table is empty.** Phase 15 writes into it. No scheduler behaviour,
  no tick, no catch-up and no DST handling exists in this phase.

Neither risk blocks the next phase or the release gate.

## Next-phase handoff

Phase 15 (durable time and condition scheduling) needs:

- the `intelligence_schedules` table this phase created: `id`, `definition_version`, `next_due_at`
  (indexed), `checkpoint_json`, `created_at`, `updated_at`;
- the durable source-change log this phase created: `knowledge_sources` holds one row per source
  revision with its kind, id, revision, account scope, status and correlation id — the condition
  trigger consumes it;
- the pending re-evaluation requests this phase raises: the `pending` rows of
  `knowledge_hypotheses` and `knowledge_patterns`, each bound to the source revision it must be
  re-derived from, with its subject and version;
- `SourceChange` and `parseSourceChange` from `server/domain-events.ts`, and the shared knowledge
  contracts from `server/intelligence/contracts/knowledge.ts`;
- `nextSourceRevision` and `currentSourceRevision` from
  `server/intelligence/infrastructure/knowledge-revisions.ts`.

Phase 15 owns the scheduler behaviour: `scheduleDue(now)`, duplicate ticks, restart after a due
time, the DST gap and fold, the long-offline coalescing, and the unique
`(scheduleId, dueAt, version)` job key. Nothing in this phase implements or blocks that.
