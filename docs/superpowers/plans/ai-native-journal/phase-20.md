# Phase 20 — Retention, backup/restore, deletion and operations documentation

Plan of record for T-020. Scope: the phase guide's Phase 20 row — "Task 13 storage/operations
portion" — with schema allocation **None**. No migration, no `schema.ts` change, no registry or
checksum change. `0001`–`0007` stay byte-unchanged.

## Objective

1. **Reference-aware retention.** The journal keeps what is still referenced and drops what is
   finished, in bounded batches, without breaking a live reference and without deleting a failure
   nobody has looked at yet.
2. **Deletion and reset.** Deleting an account takes its whole intelligence with it and leaves a
   deletion ledger behind, so a restore cannot bring it back. An explicit reset purges the
   intelligence and suppresses the automatic reseed until the operator asks for a rebuild.
3. **Quiescent backup and restore.** The backup takes an explicit source, an explicit destination
   and an explicit quiescence acknowledgement. The restore lands in scratch storage, is verified
   there before anything migrates it, and never overwrites a live journal.
4. **Operations documentation.** A runbook an operator can act on: the backlog, the dead letter,
   the unsupported event schema, the disabled and unhealthy worker, lease recovery, the no-provider
   behaviour, the opt-in budgets, and the complete backup, restore and rollback procedure.

## Ownership

| File                                                                  | Change                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/web/src/server/intelligence/infrastructure/retention.ts`        | extend: the prune, the purge, the backup and the restore                      |
| `apps/web/src/server/intelligence/infrastructure/knowledge-store.ts`  | extend: the knowledge prune and the observation prune                         |
| `apps/web/src/server/intelligence/infrastructure/experience-store.ts` | extend: the live-reference index the prune reads                              |
| `apps/web/src/server/intelligence/infrastructure/jobs.ts`             | extend: the job-table prune the transport prune uses                          |
| `apps/web/src/server/trading/commands.ts`                             | extend: the account purge, the reset, the rebuild, the clear-history evidence |
| `docs/database-migrations.md`                                         | extend: what the migrations mean to an operator                               |
| `docs/intelligence-operations.md`                                     | new: the operations runbook                                                   |
| `apps/web/tests/intelligence-retention.test.ts`                       | new: the retention, purge and reset invariants                                |
| `apps/web/tests/intelligence-backup.test.ts`                          | new: the backup and restore invariants                                        |
| `apps/web/tests/intelligence-acceptance.test.ts`                      | new: the phase acceptance evidence                                            |
| `docs/superpowers/plans/ai-native-journal/phase-20.md`                | this plan                                                                     |
| `docs/superpowers/reports/ai-native-journal-phase-20.md`              | the phase report                                                              |

No other file changes. `composition.ts` (the worker's handler registry), `worker.ts` (the job kind
resolver), the route handlers, the contracts under `intelligence/contracts/`, `db/schema.ts`,
`db/migrations.ts` and the checksum artifact stay untouched: this phase deletes and retains rows,
it does not add one.

The coordinator granted three of those areas after the candidate was committed — **The granted
repair** below records the grant and what was wired there. Nothing else moved.

## Required interfaces

```ts
// apps/web/src/server/intelligence/infrastructure/retention.ts
export const pruneIntelligence = (before: number, limit: number): { removed: number };
export const purgeAccountIntelligence = (tx: JournalTx, accountId: string): void;
```

`purgeAccountIntelligence` already exists at `retention.ts:43` with that signature; this phase
extends what it removes. `pruneIntelligence` is new: `before` is the cutoff instant (nothing newer
than it is ever touched), `limit` bounds the rows one call may remove, and `removed` counts the
rows the call deleted or emptied.

The transaction-scoped core is the same function with the transaction in front of it, so a caller
that already holds a transaction prunes on it:

```ts
export const pruneIntelligenceInTx = (tx: JournalTx, before: number, limit: number): { removed: number };
```

The knowledge class has its own cutoff, so it has its own entry point (the windows differ; see
below):

```ts
export const pruneSupersededKnowledge = (before: number, limit: number): { removed: number };
```

The backup and the restore take explicit inputs and nothing else:

```ts
export interface BackupRequest {
  /** Absolute path of the journal data directory to copy. */
  readonly source: string;
  /** Absolute path of the backup directory to write. */
  readonly destination: string;
  /** The operator's acknowledgement that the journal is quiescent. */
  readonly quiesced: boolean;
}
export interface BackupResult {
  readonly database: string;
  readonly keyFile: string | null;
  readonly purgedAccounts: readonly string[];
}
export const backupJournal = (request: BackupRequest): BackupResult;

export interface RestoreRequest {
  /** Absolute path of the backup directory. */
  readonly source: string;
  /** Absolute path of the scratch directory to restore into. */
  readonly destination: string;
}
export interface RestoreResult {
  readonly database: string;
  readonly keyVerified: boolean;
  readonly purgedAccounts: readonly string[];
}
export const restoreJournal = (request: RestoreRequest): RestoreResult;
```

## The reference graph

A row may only be removed when nothing live points at it. The prune reads this graph inside the
caller's transaction, before it removes anything. The id spaces are named, because the tables hold
different kinds of id:

| Row                                            | Kind of id it holds                                   |
| ---------------------------------------------- | ----------------------------------------------------- |
| `intelligence_workflows.subject_id`            | an **observation** id (the review workflow's subject) |
| `intelligence_workflows.evidence_ids_json`     | **projection revision** ids                           |
| `intelligence_opportunities.subject_id`        | an **observation** id (the producer's subject)        |
| `intelligence_opportunities.evidence_ids_json` | **projection revision** ids                           |
| `intelligence_conversations.subject_id`        | an **observation** id                                 |
| `intelligence_opportunities.dedup_key`         | one of four namespaces — see below                    |
| `observation_evidence.observation_id`          | an **observation** id                                 |
| `observation_evidence.revision_id`             | a **projection revision** id                          |

The four `dedup_key` namespaces (`contracts/experience.ts:394-401`):

| Namespace                    | What it names                       | Deduplicates                     |
| ---------------------------- | ----------------------------------- | -------------------------------- |
| `opportunity/<producerKey>`  | an opportunity                      | one opportunity per producer key |
| `delivery/proactive/<id>`    | a proactive delivery reservation    | one push per opportunity         |
| `dismissal/opportunity/<id>` | a dismissed opportunity             | one dismissal per target         |
| `dismissal/evidence/<id>`    | a dismissed **projection revision** | one dismissal per revision       |

The producer key inside `opportunity/<producerKey>` is `observation/<observationId>`
(`producer.ts:61`), so it names an **observation id**.

The **live** sets are the ones the product already treats as live:

| Row                          | Live while                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `intelligence_workflows`     | status is `running`, `waiting_for_user` or `scheduled`                               |
| `intelligence_opportunities` | status is `pending`, `eligible` or `suppressed` (`queries.ts:163`)                   |
| `intelligence_conversations` | status is `open` (`queries.ts:196-206`)                                              |
| `event_deliveries`           | state is `pending`                                                                   |
| `intelligence_jobs`          | status is `pending`, `running` or `retry_wait`                                       |
| `intelligence_observations`  | status is `active`                                                                   |
| a knowledge record           | status is `active`, `stale` or `pending`, or it is the newest version of its subject |

A **failure is not live and not finished**: a delivery in state `failed` and a job in status
`failed` are **unacknowledged failures**. They are kept, and everything they point at is kept, until
a later attempt for the same `(event, handler, version)` moves them on — the delivery row is
updated in place (`jobs.ts:310-324`), so a failure that was superseded is no longer a failure. A
background run in status `failed` is an unacknowledged failure in the same sense.

A **deletion ledger** records every account whose intelligence was purged. It is a file
`purge-ledger.json` beside the database, in the journal data directory, holding a JSON array of
`{ accountId, kind }` entries, where `kind` is `"deleted"` or `"reset"`.

The ledger lives **beside** the database rather than inside it, because the database is what a
restore replaces: a ledger inside the database would be rolled back with it, and the purged account
would come back. The settings table stays empty after a purge — the journal holds no row that
outlives the account it describes.

The entry is written **before** the purge runs, so a journal that was purged is never restored
without the ledger that says so. A purge that then fails takes its entry back.

The two kinds mean different things on a restore:

| Kind      | What the purge did                             | What a restore does to it                                                                                                           |
| --------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `deleted` | the account and its intelligence are gone      | delete the account row again — its cascade takes its intelligence and its checkpoint with it, and the seed finds no account to seed |
| `reset`   | the account survives, its intelligence is gone | purge its intelligence again and write its seed checkpoint as `suppressed`, so the seed does not re-derive it                       |

## The retention classes, their windows and their terminal sets

The contract review fixes the windows: unreferenced terminal jobs, deliveries and outbox events
after 30 days, diagnostics after 30 days, superseded or invalidated unreferenced knowledge after 90
days. One call prunes one class, so each class has its own cutoff and its own entry point.

| Class       | Entry point                | Cutoff  | Terminal set — a row in this state may be pruned                                             |
| ----------- | -------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| transport   | `pruneIntelligence`        | 30 days | a job: `completed`, `cancelled`; a delivery: `delivered`, `cancelled`                        |
| diagnostics | `pruneIntelligence`        | 30 days | a run: `completed`, `cancelled`, `unavailable`                                               |
| knowledge   | `pruneSupersededKnowledge` | 90 days | a knowledge record: `superseded`, `invalidated`; an observation: `superseded`, `invalidated` |

**`failed` is in no terminal set.** An unacknowledged failure is never pruned.

The **prune order** is fixed, because the tables cascade:

1. the transport class deletes an event's jobs first, then the event itself; deleting the event
   cascades its deliveries (`schema.ts:588`);
2. the diagnostics class empties the diagnostic payload of a finished run and keeps the row: the
   row carries the effect dedup key and its budget reservations;
3. the knowledge class deletes the knowledge records and the observations.

**The timestamps** each class is measured against:

| Row                                  | Timestamp column |
| ------------------------------------ | ---------------- |
| `domain_outbox`                      | `recordedAt`     |
| `event_deliveries`                   | `updatedAt`      |
| `intelligence_jobs`                  | `updatedAt`      |
| `intelligence_runs`                  | `updatedAt`      |
| `knowledge_hypotheses` / `_patterns` | `updatedAt`      |
| `knowledge_sources`                  | `recordedAt`     |
| `intelligence_observations`          | `updatedAt`      |

**Compact dedup preservation.** Four keys keep an effect from happening twice, and the prune never
breaks any of them while its source survives:

- the delivery row `(eventId, handlerId, handlerVersion)` is the dedup of a fanout, so a delivery is
  removed only with its event, and an event is removed only when every one of its deliveries is
  terminal;
- `intelligence_jobs.idempotency_key` is the dedup of a job, so a job is removed only when its
  delivery is removed with its event, or when it is an orphaned `evaluate_trade` job whose event is
  already gone, or a finished `retention` job of this phase;
- `intelligence_runs.effect_key` is the dedup of a background effect, so a run row is never deleted
  — only its diagnostic payload is emptied;
- `intelligence_opportunities.dedup_key` is the dedup of an interaction and of a dismissal, so an
  opportunity row is never deleted by the prune. A dismissal outlives the thing it dismisses.

## Cancellation fencing

A purge and a leased completion race each other. The fence is the job's own fence:

1. the purge cancels the job first (`cancelRequested`, status `cancelled`, owner and lease
   cleared) and only then deletes it;
2. a worker that still holds the claim finds no job row, or a cancelled one, and its completion
   throws `StaleClaimError` — `cancelled` when the row says so, `stale` when the row is gone
   (`jobs.ts:410-443`);
3. the effect and the acknowledgement commit in one transaction, so a fenced completion writes
   nothing at all.

## Deletion, reset and the reseed suppression

The seed checkpoint's own status carries the suppression, and the three paths already honour it:
the historical seed returns on a suppressed checkpoint (`backfill.ts:57`), the observation write
path refuses a suppressed account (`knowledge-store.ts:87`) and the replay seam refuses it
(`jobs.ts:310-324`).

**Account deletion** (`deleteAccount` in `trading/commands.ts`): the account's intelligence is
purged in the caller's transaction and the account row is deleted, which cascades the checkpoint.
The deleted account id goes into the ledger with kind `deleted`.

**Account reset** (`resetAccountIntelligence` in `trading/commands.ts`): the account survives, its
intelligence is purged, and its seed checkpoint is written as `suppressed` — so the seed does not
re-derive what was deleted, and a replay of that account is refused. The checkpoint is _not_
deleted here: the account still exists, and the checkpoint is what suppresses the reseed. The
checkpoint row is written with every column it requires: `status` `suppressed`, `baselineOperationId`
the operation id the checkpoint already carried (or a fresh one when the account has no checkpoint),
`lastTradeKey` null, and `updatedAt` the instant of the reset.

**Rebuild request** (`requestAccountIntelligenceRebuild` in `trading/commands.ts`): the checkpoint
moves back to `pending`, and only then does the seed run again. The ledger entry of a reset account
is dropped at the same time, because the reset has been undone.

The purge removes, for the account:

- its outbox events, their deliveries and their jobs (the jobs are cancelled first);
- the evidence sidecar of its fills (`execution_evidence` has no foreign key to the fill);
- its observations and their evidence links;
- its knowledge records and its sources (`knowledge_hypotheses`, `knowledge_patterns`,
  `knowledge_sources`);
- its workflows, their transitions, their commands and their conversation links;
- its opportunities, its conversations and their messages;
- the rows whose subject is one of the account's observations even when they are not account bound:
  a workflow, an opportunity or a conversation about an observation of that account goes with the
  observation;
- the account's background runs: a run of a deleted account is cancelled and the account id is
  removed from its scope's `accountIds`. A run that covered other accounts keeps them, its effect
  key and its budget reservations. A run whose scope held only the deleted account has no account
  left to read, so it is deleted with its reservations — its effect key has no replay source left to
  protect, and a run whose scope is empty is not a scope (`backgroundScopeSchema` requires at least
  one account, `policy.ts:179`).

**A failure is not resurrected** by a retry or a backfill: a cancelled job's completion is fenced,
a suppressed account is neither re-seeded nor replayed, and a deleted account has no account row
for either to find.

**Clear history** (`clearAccount` in `trading/commands.ts`): the fills go and the account survives.
The evidence of the deleted fills is **invalidated**, not deleted — `execution_evidence` has no
foreign key to the fill, so the rows would otherwise survive and claim a source quality for a fill
that no longer exists. Their `timingQuality` becomes `unknown`. The membership evidence
(`trade_revision_executions`) is untouched: it must survive ordinary source-fill deletion.

## The quiescent backup and the restore

The review's rule: never copy only a live WAL database file, and copy the key material with it.

**Quiescence** is two things, and the command is honest about which it can check:

- the operator acknowledges that the **HTTP writer** is stopped — the command cannot see it;
- the command checks that no **worker lease** is live (`intelligence_worker_lease.leaseUntil` is in
  the future), because a live lease means a worker is writing.

The backup:

- refuses a missing, relative or equal source/destination, a missing acknowledgement, a live worker
  lease, a destination that already holds a journal, a journal whose key cannot travel, and a
  source that does not hold the journal's **own** key material — the probe is sealed under the
  journal's live key, so a copy with a stale or missing `.secret` would verify against the wrong key
  and the restored journal could not read its own encrypted settings;
- writes a **consistent snapshot** with SQLite's `VACUUM INTO` — never a copy of a live WAL file;
- copies the `.secret` key material beside it when the journal has a key file;
- writes a manifest beside it:

```jsonc
{
  "version": 1,
  "createdAt": 1800000000000,
  "source": "/absolute/path",
  "database": "journal.db",
  "keyFile": ".secret",
  "keyProbe": "<the journal's key, encrypted over a fixed label>",
  "purgedAccounts": [{ "accountId": "…", "kind": "deleted" }],
}
```

The `keyProbe` is an `encryptJson` envelope over a fixed label, encrypted under the journal's own
key. It is a key _check_, not a credential: it never reveals the key and never carries account
data. The restore decrypts it with the restored key material; if it does not decrypt, the restore
refuses, because the restored journal would not be able to read its own encrypted settings.

The restore takes an explicit `source` (the backup directory) and an explicit `destination` (the
scratch directory) and, in this order:

1. refuses a destination that already holds a journal database file, so it never overwrites a live
   journal;
2. copies the database file and the key material;
3. **verifies the copy before anything migrates it**: `PRAGMA integrity_check` and
   `PRAGMA foreign_key_check` are run against the copied file directly, so the verification judges
   the backup and not a migrated version of it;
4. verifies the key: the manifest's `keyProbe` must decrypt under the restored key material;
5. **re-applies the deletion ledger**: every account the ledger names — the manifest's and the
   destination directory's `purge-ledger.json` — is applied again in the restored journal, each by
   its kind. A `deleted` account gets **the same purge the delete path runs** — its events, their
   deliveries and jobs, its observations, its knowledge and the rows that are not account bound but
   name its observations — and then its account row goes, so nothing of it is left behind. A
   `reset` account has its intelligence purged again and its seed checkpoint written as
   `suppressed`;
6. verifies the restored journal again, after the ledger was applied.

The restore never reads, decrypts or writes a credential. The operator's real keys are never
touched; the credential round trip is proven in the test with **synthetic** credentials — a
synthetic provider key written into a scratch journal — so the test proves that the key material
travels without ever meeting a real key.

## The migration failure path

A failed migration is a stop-and-report situation, not something to repair by hand. The runner rolls
the failed migration back with its ledger row, so the journal stays at the last version it fully
applied (`migrations.ts:272-295`), and the reasons are machine-readable (`migrations.ts:51-58`). The
operations runbook and `docs/database-migrations.md` record the procedure: read the reason, take a
backup, fix forward — never edit an applied migration, never delete a ledger row, never downgrade.

## The tests

### `apps/web/tests/intelligence-retention.test.ts`

1. **Reference-safe prune.** A pending delivery keeps its event; a failed delivery keeps its event
   and its `last_error`; a pending job keeps its event; a live workflow keeps the observation it
   names; a live opportunity keeps the observation it names; an open conversation keeps the
   observation it names; a dismissed evidence revision keeps the observation that carries that
   revision. Each case breaks the reference and asserts the row survived.
2. **Failures stay inspectable.** A failed job, a failed delivery and a failed run survive every
   prune.
3. **Compact dedup survives.** After a prune, the delivery of a surviving event is still there, the
   run row with its effect key is still there, and an opportunity with its dedup key is still
   there.
4. **Bounded and windowed.** The prune removes at most `limit` rows; the transport prune removes a
   31-day-old terminal event and keeps a 10-day-old one; the knowledge prune removes a 91-day-old
   superseded record and keeps a 10-day-old one; the diagnostics prune empties the diagnostic payload
   of a 31-day-old finished run and keeps the run row.
5. **Purge, reset and rebuild.** A deleted account leaves no intelligence behind and is in the
   ledger with kind `deleted`; a reset purges the intelligence and leaves a suppressed checkpoint, so
   the seed writes nothing; a replay of a suppressed account is refused; a rebuild request moves the
   checkpoint back to `pending` and the seed writes again.
6. **Cancellation fencing.** A purge that races a leased completion leaves the completion fenced
   (`StaleClaimError`), writes nothing and leaves the journal consistent.
7. **Clear history.** Clearing an account's fills leaves the evidence of the deleted fills in place
   with an `unknown` timing quality.

### `apps/web/tests/intelligence-backup.test.ts`

1. **Explicit inputs only.** A backup without a source, without a destination, with a relative
   path, with the same source and destination, or without the quiescence acknowledgement is
   refused.
2. **A live journal is refused.** A held worker lease refuses the backup.
3. **The key travels.** The backup carries the key material and its manifest; the restore verifies
   the `keyProbe` under the restored key, and a restored journal decrypts a **synthetic** provider
   credential written into the source journal.
4. **Restore verifies.** The restored journal passes `integrity_check` and `foreign_key_check`.
5. **No resurrection.** A restore refuses a destination that already holds a journal, and a
   restored journal does not contain an account the ledger names as `deleted`.

### `apps/web/tests/intelligence-acceptance.test.ts`

1. **The phase gate.** A reference-safe prune, a restore with synthetic credentials and no
   resurrection, end to end on one journal.
2. **Migration failure recovery.** Two cases, kept apart: a migration that **fails** rolls back
   with its ledger row, so the journal still opens at the version it had; a journal whose history
   cannot be vouched for is **refused** with a machine-readable reason and is left untouched.

## Test-first steps

Small steps, each one runnable on its own:

1. the deletion ledger: the purge writes it, the reset suppresses the checkpoint — run
   `intelligence-retention.test.ts`;
2. the reference graph: the live sets keep their rows — same file;
3. the prune: the windows, the bound and the `removed` count — same file;
4. the cancellation fence and the clear-history evidence — same file;
5. the backup: the refusals, the snapshot, the key travel and the manifest — `intelligence-backup.test.ts`;
6. the restore: the verification, the ledger re-application and the refusal — same file;
7. the phase gate and the migration cases — `intelligence-acceptance.test.ts`;
8. the runbooks — `docs/intelligence-operations.md` and `docs/database-migrations.md`.

## Verification

```
pnpm exec vitest run apps/web/tests/intelligence-retention.test.ts \
  apps/web/tests/intelligence-backup.test.ts \
  apps/web/tests/intelligence-acceptance.test.ts
pnpm typecheck
```

The whole-project `pnpm test` and the destination gate are the coordinator's.

## Stop condition

The plan is implemented, the three targeted test files and the typecheck are green, one
implementation review has passed, and the phase report is committed. The candidate stops there; the
merge into `codex/ai-native-journal` is the coordinator's job.

## The granted repair

The phase candidate was committed (`test: harden intelligence recovery packaging and operations`).
After that, the coordinator granted three areas that **Ownership** above declared out of scope:

| The granted area                                            | What the repair does there                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/web/src/server/intelligence/infrastructure/worker.ts` | resolves the handler of a `retention` and a `workflow_effect` job   |
| `apps/web/src/server/intelligence/composition.ts`           | registers the retention handler and the workflow effect handler     |
| `apps/web/src/app/api/intelligence/`                        | the operator routes of the retention run, the reset and the rebuild |

The repair is wiring, not a new capability: the prune, the purge, the reset and the rebuild were
already this phase's work in `retention.ts` and `trading/commands.ts`. What was missing was the
registration that lets the worker run the work and the surface that lets the operator ask for it.

**The retention handler.** `worker.ts` names the handler of a retention job — `RETENTION_HANDLER_ID`
`retention` and `RETENTION_HANDLER_VERSION` `1` — and `composition.ts` registers it. Its `run`
calls `pruneIntelligenceInTx(tx, job.payload.before, RETENTION_PRUNE_LIMIT)` and then
`pruneSupersededKnowledgeInTx(tx, clock() - KNOWLEDGE_RETENTION_WINDOW_MS, RETENTION_PRUNE_LIMIT -
removed.removed)`: the transport and the diagnostics class at the cutoff the payload names, the
knowledge class at its own 90-day window, and the whole run inside one bound of 500 rows. The
entry points `pruneIntelligence(before, limit)` and `pruneSupersededKnowledge(before, limit)` stay
the seam the operator route uses.

**The deferred workflow resume.** `worker.ts` resolves a `workflow_effect` payload to the
`workflow-effect` handler (version `1`) that the workflow engine hands out through `effectHandler()`,
and `composition.ts` registers it. A workflow that waits for you and was deferred now resumes when
the worker wakes it, instead of dying as an `unhandled_job` dead letter. This is the leg Phase 19
left open.

**The operator routes.** Three route files under `apps/web/src/app/api/intelligence/retention/`
answer four routes:

| The route                                  | What it does                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/intelligence/retention`         | runs a prune now: `{"before": <epoch ms>, "limit": <rows>}`, both optional                                                                       |
| `GET /api/intelligence/retention`          | the current state: the two windows, the bound, the deletion ledger and every account's seed checkpoint                                           |
| `POST /api/intelligence/retention/reset`   | resets one account: `{"accountId": "..."}` — the checkpoint becomes `suppressed`, the ledger records it                                          |
| `POST /api/intelligence/retention/rebuild` | asks for the rebuild: `{"accountId": "..."}` — the checkpoint moves back to `pending`, the seed job is enqueued and the ledger forgets the reset |

**Where the proof lives.** The worker's retention run and the deferred workflow resume are proven
in `apps/web/tests/intelligence-retention.test.ts`: the worker claims the job, the job ends
`completed` with no `last_error`, and no `unhandled_job` dead letter is written. The operator routes
are proven in `apps/web/tests/intelligence-acceptance.test.ts`: the gate (no session, a foreign
origin, a body the route cannot read), the prune the route runs, the reset and the rebuild.

## What this phase leaves to the next one

- **Nothing of the granted repair.** The retention job runs, the deferred workflow resumes and the
  operator has routes for the retention run, the reset and the rebuild: the coordinator granted
  `worker.ts`, `composition.ts` and the directory `apps/web/src/app/api/intelligence/` after the
  candidate was committed, and **The granted repair** above records what was wired there. The
  prune is no longer a directly callable server function only — it is the worker's job and the
  operator's route.
- **The persisted home of an AI-assisted insight.** The chain's AI leg has no table of its own: an
  opportunity carries no text, and a provider call may not happen inside a write transaction. No
  phase in this run owns the migration that would give it one, and the leg itself is optional, so
  this is a next-milestone item and not a hole in this gate. The gate of this phase is the
  retention, the deletion, the backup and the restore, and all four are proven.
- The benchmark, the full CI sequence, the Docker and Windows smoke and the package audit are
  Phase 21's release half.
