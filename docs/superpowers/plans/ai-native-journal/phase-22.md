# Phase 22 — Persist a revision-bound AI insight

Plan of record for Phase A of the optional-AI feature (the three-phase plan lives outside the
repository). Scope: the storage only. No provider call, no job enqueue, no change to the scoped
GET, no UI. Schema allocation: **one forward migration, `0008`**.

This phase closes the gap Phase 19 recorded: _"The optional-AI node of the design chain is not
wired. The chain's AI leg has no persisted home in the current schema (an opportunity carries no
text) and a provider call may not happen inside a write transaction."_ The persisted home is
created here; Phase B connects it to a fenced provider job and Phase C shows it.

## Objective

1. **A dedicated table** for the generated review question: the question text, the source and
   scope references, the capability version, the producing run reference and the creation time.
   Nothing else. No prompt, no credential, no raw provider response.
2. **One business key** for the capability version and the source revision within the account, used
   unchanged by the run enqueue, the job deduplication and the stored row, so Phase B cannot drift
   from this phase.
3. **The derived data is wired into the deletion guarantees**: an account purge takes its insights,
   a reset takes them, a restore re-applies the ledger so a purged question cannot come back, and
   the retention prune cannot take a question a live record still names.
4. **A source correction hides the older question immediately**: the read resolves the _current_
   projection revision of the subject, not the revision the question was generated from.

## Ownership

| File                                                               | Change                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `apps/web/src/db/migrations/0008-ai-insights.ts`                   | new: the additive DDL and the migration source                     |
| `apps/web/src/db/schema.ts`                                        | the typed Drizzle table                                            |
| `apps/web/src/db/migrations.ts`                                    | the registry entry                                                 |
| `apps/web/src/db/migration-checksums.json`                         | the regenerated checksum artifact                                  |
| `apps/web/src/db/bootstrap.ts`                                     | the final-schema snapshot                                          |
| `apps/web/src/server/intelligence/contracts/insights.ts`           | new: the capability version, the business key and the store port   |
| `apps/web/src/server/intelligence/infrastructure/insight-store.ts` | new: the SQLite adapter of the port                                |
| `apps/web/src/server/intelligence/infrastructure/retention.ts`     | the purge, the reset and the knowledge prune take the insights     |
| `apps/web/tests/intelligence-insights.test.ts`                     | new: the store, the purge, the reset, the cascade and the prune    |
| `apps/web/tests/intelligence-migrations.test.ts`                   | extend: the upgrade from `0007`                                    |
| `apps/web/tests/intelligence-backup.test.ts`                       | extend: the restore of a purged question                           |
| `docs/intelligence-operations.md`                                  | extend: the table, the retention class and the deletion guarantees |
| `docs/database-migrations.md`                                      | extend: the `0008` row of the history table                        |
| `docs/superpowers/plans/ai-native-journal/phase-22.md`             | this plan                                                          |
| `docs/superpowers/reports/ai-native-journal-phase-22.md`           | the phase report                                                   |

No other file changes. `apps/web/src/app/**`, `apps/web/src/components/**`, the AI runtime, the
model policy, the worker, the scoped GET and every component stay untouched: Phase B owns the
provider leg and Phase C owns the display leg.

## The table

`intelligence_insights` — one row per generated question.

| Column               | SQL                  | Type    | Notes                                                          |
| -------------------- | -------------------- | ------- | -------------------------------------------------------------- |
| `id`                 | `id`                 | TEXT PK | a `newUuid()`                                                  |
| `business_key`       | `business_key`       | TEXT    | NOT NULL, unique — the deduplication identity                  |
| `account_id`         | `account_id`         | TEXT    | NOT NULL, FK `accounts(id)` ON DELETE CASCADE                  |
| `subject_id`         | `subject_id`         | TEXT    | NOT NULL — the trade identity the question is about            |
| `observation_id`     | `observation_id`     | TEXT    | NOT NULL, FK `intelligence_observations(id)` ON DELETE CASCADE |
| `source_revision`    | `source_revision`    | TEXT    | NOT NULL — the projection revision the question was made from  |
| `capability_version` | `capability_version` | TEXT    | NOT NULL — the version of the capability that produced it      |
| `question`           | `question`           | TEXT    | NOT NULL — the validated question text                         |
| `run_id`             | `run_id`             | TEXT    | nullable, FK `intelligence_runs(id)` ON DELETE SET NULL        |
| `created_at`         | `created_at`         | INTEGER | NOT NULL — epoch milliseconds                                  |

Indexes: the unique index over `business_key`
(`intelligence_insights_business_key_unique`), an index over `account_id`
(`intelligence_insights_account_idx`), an index over `subject_id`
(`intelligence_insights_subject_idx`), an index over `source_revision`
(`intelligence_insights_source_revision_idx`) and an index over `created_at`
(`intelligence_insights_created_at_idx`). The last two serve the prune: the rule looks a row up by
the revision it was made from, and the 90-day test reads `created_at`.

**Why these foreign keys.** The account cascades, so deleting the account takes its questions. The
observation cascades, so a question never outlives the observation it was generated from. The run
reference is `SET NULL`, never `CASCADE`: the run is operational metadata that the retention prune
empties and the account purge deletes, and the question must survive the loss of its producer. The
reference becomes null; the question stays.

**No foreign key on `subject_id`.** The subject is a trade identity, and the question must not
disappear because the identity was re-keyed; the row is bound to the _revision_, not to the
identity's row. This mirrors `intelligence_observations.subject_id`, which carries no foreign key
for the same reason.

**What is not stored.** The prompt, the provider response, the model output envelope, the endpoint,
the credentials and the raw evidence stay outside the journal. `question` holds the validated
question text and nothing else.

## The capability version

No `capabilityVersion` symbol exists in `apps/web/src/server/intelligence` today, so this phase
mints one in `contracts/insights.ts`:

```ts
export const AI_INSIGHT_CAPABILITY_VERSION = "1";
```

The constant is exported from `contracts/` — the only surface sibling domains may import — so the
run enqueue, the job key and this store can all reach it without crossing a boundary.

**No capability id is minted here.** `JOURNAL_CAPABILITY_IDS`
(`apps/web/src/server/intelligence/contracts/capabilities.ts`) is the single list of capability
ids, and `ai-scope.ts` maps every id to the scopes it may read. A second id constant would be a
second registry. Phase B adds `"journal.review-insight"` to `JOURNAL_CAPABILITY_IDS` and gives it
this version; until then the version constant is the only thing this phase needs, because the
business key is built from the version, not from the id.

## The business key

One key for the capability version and the source revision within the account:

```
insight:<capabilityVersion>:<accountId>:<sourceRevision>
```

```ts
export const insightBusinessKey = (input: {
  accountId: string;
  sourceRevision: string;
  capabilityVersion?: string;
}): string =>
  `insight:${input.capabilityVersion ?? AI_INSIGHT_CAPABILITY_VERSION}:${input.accountId}:${input.sourceRevision}`;
```

The same string is the run's effect key, the job's idempotency key and the row's `business_key`.
Phase B therefore imports this function rather than rebuilding the string, and a duplicate write
is one row: the insert conflicts on the unique index and nothing else is written.

The key carries the account because a source revision belongs to one account, and the capability
version because a new capability version is a new question, not a revision of the old one.

**`source_revision` holds the projection revision id, not the revision ordinal.**
`intelligence_observations.source_revision` is TEXT and holds `trade_projection_revisions.id` — the
UUID of the revision row — and the insight follows the observation it was generated from, so it
holds the same UUID. (The knowledge tables' `source_revision` is an INTEGER ordinal of a
_knowledge_ source revision; that is a different chain and is not used here.) The UUID matters:
the ordinal is only unique inside one trade, so two trades of one account at the same ordinal would
collide on the unique index and silently drop the second question.

## The retention class

The insights are **knowledge class**: the 90-day window, pruned by `pruneSupersededKnowledge`.
They are derived content about a trade, not transport and not diagnostics, and they must not
disappear with the 30-day transport sweep.

**The prune rule.** An insight is prunable when all three hold:

1. it is older than the knowledge window, measured on `created_at` — the row has no `updated_at`,
   and the knowledge class prunes on the row's own age;
2. it is no longer current — the observation it was generated from is no longer `active`, or its
   `source_revision` is no longer the current projection revision of its subject;
3. nothing live names it — the live reference index names neither the observation id nor the
   revision id of the insight.

Rule 2 mirrors the knowledge rule ("a record is prunable when it is not the newest version of
its subject"), and rule 3 is the existing live-reference guard: a live workflow, opportunity or
conversation that names the observation or the revision keeps the question alive.

The insight does **not** add ids to the live reference index. The index names observation ids and
projection revision ids, and those are the two id spaces the insight's own ids live in, so the
guard is two checks in the same space: the index must not hold the insight's observation id, and
it must not hold the insight's source revision.

## How a source correction hides an older question

The read resolves the current revision inside the caller's transaction:

```sql
-- the current projection revision of the subject
SELECT r.id FROM trade_identities t
JOIN trade_projection_revisions r ON r.trade_id = t.id AND r.revision = t.revision
WHERE t.id = :subjectId
```

A question is visible only when its `source_revision` is that current revision **and** its
observation is still `active`.

**The revision check is what hides the older question.** A correction produces a new projection
revision, so the old revision is no longer the current one and the question bound to it stops being
readable at once — without a delete and without a status column. The observation's `active` status
is a secondary signal, not the mechanism: `persistObservationInTx` marks the older observations
`superseded` only when a successor observation is written for the same subject, evaluator and type,
so a correction whose evaluation is `insufficient_evidence` leaves the old observation `active`
while the revision check still hides its question.

The knowledge source revision is not consulted: the question is grounded in the trade's projection,
and that is the revision it is bound to.

## The store port

`contracts/insights.ts` holds the port so no sibling domain has to import the infrastructure:

```ts
export interface InsightStore {
  /** The id of the stored insight, or null when nothing was stored. */
  persistInsightInTx(tx: JournalTx, input: InsightInput): string | null;
  /** The current question of a subject, or null when it has none. */
  readCurrentInsightInTx(tx: JournalTx, query: InsightQuery): InsightRow | null;
}
```

`infrastructure/insight-store.ts` implements it over Drizzle and exposes it through
`createInsightStore(): InsightStore`, the factory the repo's other stores use
(`createExperienceStore`, `createJobStore`). The factory is the only public surface of the
adapter: a sibling domain injects the port and never reaches the implementation, so the boundary
rule holds and the compiler catches drift between the port and the adapter.

The validation lives at the store boundary: the question is trimmed, must not be empty and must
not exceed `MAX_INSIGHT_QUESTION_LENGTH` (2000 characters). **An invalid question stores nothing
and the port returns null** — the caller can tell "not stored" from "stored".

**A repeated write returns the id of the row that is already there.** The insert uses
`onConflictDoNothing` on the `business_key` unique index, and the row is then read back by its
business key — the same shape `infrastructure/jobs.ts` uses for an `idempotency_key` conflict. So a
duplicate write yields one row and one id, and the id always names a row that exists.

**The read names one capability version.** The query takes an optional `capabilityVersion` and
defaults to the current one. A new capability version is a new question, not a revision of the
old one, so both rows are legitimate and the read must not return whichever one it finds first.

## The deletion guarantees

| Path             | What happens to the insights                                                    |
| ---------------- | ------------------------------------------------------------------------------- |
| account purge    | the account's insights are deleted with the account's other intelligence        |
| account reset    | the reset calls the purge, so the insights go with it                           |
| restore          | the restore re-applies the ledger, so a purged account's question cannot return |
| knowledge prune  | only an insight older than 90 days, no longer current and named by nothing live |
| account deletion | the `accounts` cascade takes them                                               |

The purge deletes the insights by their account id, because the purge does not delete the account
row and the cascade therefore does not fire. The insights of the account's observations go with
the observations themselves: their foreign key cascades.

## The migration

`apps/web/src/db/migrations/0008-ai-insights.ts`, name `ai-insights`, version 8. Additive only:
it creates one table and five indexes and touches nothing else.

**Every statement carries `IF NOT EXISTS`**, exactly as `0007-intelligence-experience.ts` does.
`BOOTSTRAP_SQL` embeds the same text, and the migration tests build legacy journals by running
`BOOTSTRAP_SQL` and then re-applying the migrations; without the guards the `0008` step would
abort with "table intelligence_insights already exists" and roll the upgrade back. The DDL is:

```sql
CREATE TABLE IF NOT EXISTS intelligence_insights (
  id TEXT PRIMARY KEY,
  business_key TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  observation_id TEXT NOT NULL REFERENCES intelligence_observations(id) ON DELETE CASCADE,
  source_revision TEXT NOT NULL,
  capability_version TEXT NOT NULL,
  question TEXT NOT NULL,
  run_id TEXT REFERENCES intelligence_runs(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_insights_business_key_unique
  ON intelligence_insights (business_key);
CREATE INDEX IF NOT EXISTS intelligence_insights_account_idx ON intelligence_insights (account_id);
CREATE INDEX IF NOT EXISTS intelligence_insights_subject_idx ON intelligence_insights (subject_id);
CREATE INDEX IF NOT EXISTS intelligence_insights_source_revision_idx
  ON intelligence_insights (source_revision);
CREATE INDEX IF NOT EXISTS intelligence_insights_created_at_idx ON intelligence_insights (created_at);
```

The file exports its DDL as `INSIGHTS_SQL` so `bootstrap.ts` reuses the same text, which is what
keeps the migrated schema and the declared snapshot identical.

The registry gains the entry, the checksum artifact is regenerated with
`pnpm --filter web migrations:build`, and `BOOTSTRAP_SQL` embeds `INSIGHTS_SQL`.

## The tests

`apps/web/tests/intelligence-insights.test.ts` drives the real store against a disposable journal:

- a duplicate write yields one row and the same id;
- a read returns the question of the current revision;
- a correction hides the older question at once;
- the purge takes the account's questions;
- the reset takes them;
- deleting the account takes them (the `accounts` cascade);
- the knowledge prune keeps a question a live workflow names, and takes a stale one;
- a question that is invalid is not stored.

`apps/web/tests/intelligence-backup.test.ts` gains the restore case: a question that was purged
before the backup does not come back when the backup is restored, because the restore re-applies
the deletion ledger.

`apps/web/tests/intelligence-migrations.test.ts` gains the upgrade case: a journal that has
`0007` applied and no `intelligence_insights` table converges onto the new schema, and the rows it
already held survive unchanged. The generic cases of that file — fresh database, baseline
upgrade, repeated startup, injected failure, concurrent startup — are derived from the manifest
and pick the new version up by themselves.

## The checks

```
pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-retention.test.ts apps/web/tests/intelligence-backup.test.ts apps/web/tests/intelligence-insights.test.ts apps/web/tests/intelligence-boundaries.test.ts
pnpm --filter web typecheck
pnpm --filter web migrations:check
```

The boundary test (`apps/web/tests/intelligence-boundaries.test.ts`) is part of the gate: the
contracts module imports nothing but the transaction type, and the infrastructure module imports
the contracts and the schema.

## The stop condition

This phase stops when the table, the store and the deletion guarantees exist and are proven. It
does not call a provider, does not enqueue a job, does not change the scoped GET and does not
touch the UI. Phase B owns the provider leg; Phase C owns the display leg.
