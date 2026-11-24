# Phase 22 — Persist a revision-bound AI insight

Phase A of the optional-AI feature · schema allocation: **one forward migration, `0008`**

|                       |                                                                          |
| --------------------- | ------------------------------------------------------------------------ |
| Branch                | `codex/ai-native-journal-p22` (child of the feature worktree)            |
| Base                  | `3340519c02a46cbac406c240c78d6b8809ccc73e` (verified feature HEAD)       |
| Plan commit           | `97f0899e72` — _docs: plan the revision-bound insight storage_           |
| Implementation commit | _feat: persist a revision-bound AI insight_                              |
| Report commit         | _docs: record the Phase A insight storage evidence_                      |
| Migrations            | `0008` (`ai-insights`), additive only. `0001`–`0007` are byte-unchanged. |

## What was built

The optional-AI leg of the design chain now has a persisted home. The journal can store one
generated review question per source revision, bound to the revision it was made from, and it can
forget that question on the same terms it forgets everything else it derived.

This phase is **storage only**. Nothing calls a provider, nothing enqueues a provider job, the
scoped GET is untouched and no component changed. Phase B owns the provider leg, Phase C the
display leg.

### The table

`apps/web/src/db/migrations/0008-ai-insights.ts` — the additive DDL, exported as `INSIGHTS_SQL` so
`bootstrap.ts` reuses the same text and the migrated schema cannot drift from the declared
snapshot. Every statement carries `IF NOT EXISTS`, exactly as `0007` does: the migration tests
build legacy journals by running `BOOTSTRAP_SQL` and then re-applying the migrations, so an
unguarded `CREATE TABLE` would abort the upgrade and roll it back.

```
intelligence_insights
  id                 TEXT PRIMARY KEY
  business_key       TEXT NOT NULL UNIQUE      -- insight:<version>:<accountId>:<sourceRevision>
  account_id         TEXT NOT NULL  FK accounts(id) ON DELETE CASCADE
  subject_id         TEXT NOT NULL             -- the trade identity, deliberately without a foreign key
  observation_id     TEXT NOT NULL  FK intelligence_observations(id) ON DELETE CASCADE
  source_revision    TEXT NOT NULL             -- trade_projection_revisions.id
  capability_version TEXT NOT NULL
  question           TEXT NOT NULL
  run_id             TEXT      NULL FK intelligence_runs(id) ON DELETE SET NULL
  created_at         INTEGER NOT NULL
```

Five indexes: the unique one over `business_key`, and one each over `account_id`, `subject_id`,
`source_revision` and `created_at` — the last two serve the prune, which looks a row up by the
revision it was made from and tests its age on `created_at`.

What is **not** stored: the prompt, the provider response, the model envelope, the endpoint, the
credentials, the raw evidence. `question` holds the validated question text and nothing else.

### The store

`apps/web/src/server/intelligence/contracts/insights.ts` — the pure contract: the capability
version (`AI_INSIGHT_CAPABILITY_VERSION = "1"`), the question length bound
(`MAX_INSIGHT_QUESTION_LENGTH = 2000`), the business-key builder and the `InsightStore` port. It
imports nothing but the `JournalTx` type, so it is the only surface a sibling domain may reach.

`apps/web/src/server/intelligence/infrastructure/insight-store.ts` — the Drizzle adapter, exposed
through `createInsightStore(): InsightStore`, the factory the repo's other stores use
(`createExperienceStore`, `createJobStore`).

- `persistInsightInTx(tx, input): string | null` — validates the question (trimmed, non-empty,
  within the length bound); an invalid question stores nothing and returns null. The insert uses
  `onConflictDoNothing` on the `business_key` unique index and then reads the row back by its
  business key, so **a repeated write yields one row and one id**, and the id always names a row
  that exists.
- `readCurrentInsightInTx(tx, query): InsightRow | null` — the question is visible only when its
  `source_revision` is the subject's **current** projection revision (resolved inside the
  caller's transaction through `trade_identities.revision` →
  `trade_projection_revisions`), its observation is still `active`, and it is the current
  capability version. The read names one capability version: a newer version is a new question,
  not a revision of the old one, so both rows may exist and the read must not return whichever it
  finds first.
- `pruneInsightsInTx(tx, before, limit, live)` — the knowledge class (90-day window). An insight
  is prunable when it is older than the window, when it is no longer current (its observation is
  not `active`, or its revision is not the subject's current one) and when nothing live names it.

### The business key

```
insight:<capabilityVersion>:<accountId>:<sourceRevision>
```

One key for the capability version and the source revision within the account, built by
`insightBusinessKey(...)` and used unchanged as the run's effect key, the job's idempotency key
and the row's `business_key`. Phase B imports the function rather than rebuilding the string, so
the three uses cannot drift.

`source_revision` holds the projection revision **id** (the UUID), exactly as
`intelligence_observations.source_revision` does — not the revision ordinal. The ordinal is only
unique inside one trade, so two trades of one account at the same ordinal would collide on the
unique index and silently drop the second question.

### The deletion guarantees

`apps/web/src/server/intelligence/infrastructure/retention.ts` (extended):

| Path             | What happens to the insights                                                    |
| ---------------- | ------------------------------------------------------------------------------- |
| account purge    | the account's insights are deleted by their account id                          |
| account reset    | the reset calls the purge, so the insights go with it                           |
| restore          | the restore re-applies the deletion ledger, so a purged question cannot return  |
| knowledge prune  | only an insight older than 90 days, no longer current and named by nothing live |
| account deletion | the `accounts` cascade takes them                                               |

The purge deletes by account id because the purge does not delete the account row, so the
cascade does not fire. The insights of the account's **observations** go with the observations
themselves: `observation_id` cascades.

### The live-reference guard

The insight does **not** add ids to the live reference index. The index holds observation ids and
projection revision ids, and those are the two id spaces the insight's own ids live in, so the
guard is two same-space checks: the index must not hold the insight's observation id, and it must
not hold its source revision.

## The plan review

One reviewer run on the plan returned **REVISE** with three MAJOR and six MINOR findings. All
were addressed before any implementation:

- the `0008` DDL lacked the `IF NOT EXISTS` guards — it would have aborted every legacy-journal
  upgrade;
- the business key's rationale was wrong about what `source_revision` holds — the ordinal would
  have collided across two trades of one account;
- the port promised an id while also promising that an invalid question writes nothing — it now
  returns `string | null` and a duplicate write returns the id of the row that is already there;
- and the MINORs: `null` instead of `undefined` for a missing row, the boundary test added to the
  check list, the restore and account-deletion guarantees added to the exit evidence, no second
  capability-id registry, the prune's indexes added, the `run_id` rationale corrected, and the
  correction-hiding mechanism stated accurately (the revision check hides the older question; the
  observation's `superseded` status is a secondary signal, because a correction whose evaluation
  is `insufficient_evidence` leaves the old observation `active`).

## The implementation review

One reviewer run on the implementation diff returned **FAIL** with one MAJOR and five MINOR
findings. All were addressed:

- **MAJOR — the port was never bound.** Nothing satisfied `InsightStore`, so the adapter's two
  free functions were not tied to it, the compiler could not catch drift, and Phase B would have
  had to import the infrastructure directly and failed the boundary test. The adapter now exposes
  `createInsightStore(): InsightStore`, and the typecheck is the guard: removing
  `readCurrentInsightInTx` from the factory fails `pnpm --filter web typecheck` with
  `TS2741: Property 'readCurrentInsightInTx' is missing`.
- **MINOR — two live-reference checks compared ids across disjoint spaces** and could never be
  true. They are gone; the two same-space checks remain.
- **MINOR — the purge's chunked delete by observation id was unreachable.** The observations were
  already deleted, and `observation_id` cascades, so the statement matched zero rows. It is gone.
- **MINOR — the prune test only exercised the observation half of the live guard.** A live workflow
  with an empty evidence list left `live.revisionIds` empty, so the revision check was never
  exercised by any test. A new case gives the workflow an evidence list naming the insight's
  revision and a subject that is _not_ the insight's observation, so only the revision check can
  keep the question alive.
- **MINOR — the read ignored `capability_version`**, so two rows for the same subject and revision
  with different versions both satisfied the `WHERE` clause and the read returned an arbitrary one.
  The read now names one capability version, and a new case covers the two-version case.
- **MINOR — the plan's ownership table listed the phase report, which did not exist yet.** It
  exists now: this file.

## The checks

Run once, in the order the dispatch named.

| Command                                                                                                                                                                                                                                                    | Exit                                          | Runtime |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------- |
| `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-retention.test.ts apps/web/tests/intelligence-backup.test.ts apps/web/tests/intelligence-insights.test.ts apps/web/tests/intelligence-boundaries.test.ts` | 0 — 5 files, 100 tests passed                 | 25 s    |
| `pnpm --filter web typecheck`                                                                                                                                                                                                                              | 0                                             | 17 s    |
| `pnpm --filter web migrations:check`                                                                                                                                                                                                                       | 0 — "migration-checksums.json is up to date." | 3 s     |

The whole app suite was also run once, as the regression gate: `pnpm exec vitest run apps/web/tests`
— 105 files, 1223 passed, 1 skipped, 0 failed.

`pnpm exec prettier --check` passes on every touched file.

## The teeth

A test that has never been seen to fail is not a test. Every behaviour this phase claims was
broken on purpose, and the failure was observed before the code was restored.

| #   | The break                                                          | The result                                                                                                                                                               |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | the `onConflictDoNothing` on the business key removed              | `stores a repeated write once and answers with the same id` **FAILED** (a unique-constraint violation)                                                                   |
| 2   | the current-revision condition removed from the read               | `hides the question of a corrected revision without deleting it` **FAILED**                                                                                              |
| 3   | the live-reference guard removed from the prune                    | `keeps the question a live workflow names and takes the stale one` **FAILED**                                                                                            |
| 4   | the purge's insight deletes **and** the observation delete removed | `takes the questions of a purged account…` and `takes the questions of a reset account` **FAILED** (2 tests)                                                             |
| 5   | the restore's ledger re-application disabled                       | `keeps a purged question out of the restored journal` **FAILED**, with 4 more cases in the same file failing                                                             |
| 6   | the migration's `up` emptied                                       | 11 tests **FAILED** across the migration and insight suites                                                                                                              |
| 7   | the question validation disabled                                   | `stores nothing when the question is invalid` **FAILED**                                                                                                                 |
| 8   | the capability-version filter removed from the read                | `reads the question of the current capability version` **FAILED**                                                                                                        |
| 9   | the revision half of the live guard removed from the prune         | `keeps the question a live workflow rests on a revision of` **FAILED**                                                                                                   |
| 10  | `readCurrentInsightInTx` removed from the store factory            | `pnpm --filter web typecheck` **FAILED**: `TS2741: Property 'readCurrentInsightInTx' is missing in type '{ persistInsightInTx: … }' but required in type 'InsightStore'` |

Every mutation was restored and the affected suite re-verified green before the next one. No
mutation marker is left in the tree (`grep -rn "MUTATION" apps/web/src apps/web/tests` is empty).

**Two mutations taught the tests something.** Break 4 exposed that the purge case did not
discriminate the guarantee on its own: with only the account-id delete removed, the observation
cascade still took the questions, so the case passed for the wrong reason. Break 9 exposed that
the new revision case did not isolate the revision half either — the live workflow's subject was
the insight's observation, so the observation check protected it. The fixture now decouples the
workflow's subject from the insight's observation, and the case fails without the revision check.

## The exit evidence

| Claim                                                                  | How it is proven                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a fresh install and an upgrade from `0007` converge on the same schema | `converges a fresh and an upgraded journal on the same schema` (the schema fingerprint compares tables, columns, foreign keys and indexes) and `upgrades a journal from the previous phase onto the insight schema`         |
| legacy journal rows survive the upgrade unchanged                      | `keeps credentials, hashes and annotations byte-for-byte unchanged` and the 0008 upgrade case, which re-reads the account and observation rows                                                                              |
| repeated startup is a no-op                                            | `is a no-op when the same journal is opened again` (the file's generic case, derived from the manifest)                                                                                                                     |
| duplicate writes yield ONE result                                      | `stores a repeated write once and answers with the same id`                                                                                                                                                                 |
| delete, reset and restore cannot expose a removed question             | `takes the questions of a purged account and leaves the other account's alone`, `takes the questions of a reset account`, `takes the questions with the account row`, `keeps a purged question out of the restored journal` |
| a retention prune cannot remove a question a live record still names   | `keeps the question a live workflow names and takes the stale one` and `keeps the question a live workflow rests on a revision of`                                                                                          |

## Deviations from the plan

1. **The plan's live-reference guard was stated in the wrong id spaces.** The plan said the index
   must name "no observation id and no revision id of the insight", which reads as four checks.
   Two of them compared an observation id against the revision set and a revision id against the
   observation set, and could never be true. The guard is two same-space checks.
2. **The plan did not say which capability version the read returns.** A newer capability version
   is a new question, not a revision of the old one, so both rows are legitimate and the read
   must name one. The query takes an optional `capabilityVersion` and defaults to the current one.
3. **The plan did not mention the store factory.** The plan said the infrastructure module
   "implements" the port; the implementation review found that nothing was bound to it. The
   adapter now exposes `createInsightStore()`, the factory the repo's other stores use.
4. **The plan's purge step named a delete that cannot match.** The plan wanted the purge to
   delete the insights of the account's observations by observation id. The observations are
   deleted first and `observation_id` cascades, so that statement matched zero rows. The insights
   of those observations go with their observations; the account-id delete is the one that does
   the work.

## A note for the next phase

Phase B must use `insightBusinessKey(...)` — not a rebuilt string — for the run's effect key, the
job's idempotency key and the stored row, and it must add `"journal.review-insight"` to
`JOURNAL_CAPABILITY_IDS` (`contracts/capabilities.ts`), which is the single registry of capability
ids. This phase deliberately mints no capability id of its own.

The store's read takes an optional `capabilityVersion`. Phase C's scoped GET should read the
current version by default, and must never trigger a provider call while reading.

## The stop condition

This phase stops here. It does not call a provider, does not enqueue a provider job, does not
change the scoped GET and does not touch the UI. The integration into `codex/ai-native-journal` is
the coordinator's work.
