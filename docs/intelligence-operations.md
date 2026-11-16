# Intelligence operations

The runbook for the journal's intelligence runtime: the worker, the backlog, the failures, the
backup, the restore and the rollback. Every command here is one an operator can run against a
journal they own.

> **Never operate on live trader data to test a procedure.** Use a scratch journal
> (`JOURNAL_DATA_DIR` pointing at a disposable directory) and synthetic credentials.

## What the runtime is made of

| Part                    | Where it lives                                                                       | What it holds                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| the **worker**          | a separate process, supervised by the web process                                    | claims jobs, runs the handlers, acknowledges the effects                         |
| the **backlog**         | `intelligence_jobs`                                                                  | durable work: observations, seeds, schedule triggers                             |
| the **outbox**          | `domain_outbox` and `event_deliveries`                                               | the committed change events and what each handler did with them                  |
| the **observations**    | `intelligence_observations` and `observation_evidence`                               | what the journal concluded about a trade, and the revisions it rests on          |
| the **knowledge**       | `knowledge_sources`, `knowledge_hypotheses`, `knowledge_patterns`                    | what the journal concluded about the operator's own notes and rules              |
| the **experience**      | `intelligence_workflows`, `intelligence_opportunities`, `intelligence_conversations` | the interactions the operator still has open                                     |
| the **background runs** | `intelligence_runs` and `intelligence_budget_reservations`                           | the background AI attempts, their pinned configuration and their daily allowance |

## The worker

The worker is one process that holds a single lease (`intelligence_worker_lease`, named
`journal-worker`). Only one worker may hold it, so a second launch is blocked rather than
competing.

| The worker status | What it means                                          | What to do                                                                     |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `disabled`        | the worker was started with `JOURNAL_WORKER_ENABLED=0` | expected while you work by hand; start it when you want the backlog to move    |
| `idle`            | it holds the lease and has no work                     | nothing; this is the healthy idle state                                        |
| `working`         | it holds the lease and is running a job                | nothing; a job takes a moment                                                  |
| `blocked`         | it cannot take the lease                               | another worker holds it, or the lease expired mid-run — see **lease recovery** |

The web process cannot observe the worker: it serves `worker: null`. Read the worker's own health
record, or the journal itself, to know its state.

### The backlog

The backlog is the `intelligence_jobs` table. Read it in SQL:

```sql
-- What is waiting, and how old is it?
SELECT type, status, count(*) AS rows, min(created_at) AS oldest
FROM intelligence_jobs
GROUP BY type, status
ORDER BY oldest;

-- The jobs that are waiting for their turn.
SELECT id, type, status, attempts, available_at, last_error
FROM intelligence_jobs
WHERE status IN ('pending', 'retry_wait')
ORDER BY available_at;

-- The jobs a worker is holding right now.
SELECT id, type, status, owner, lease_until, fence
FROM intelligence_jobs
WHERE status = 'running';
```

A job that stays `pending` with a far-future `available_at` is waiting for its retry window, not
stuck. A job that keeps moving between `pending` and `retry_wait` is failing: read `last_error`.

### The dead letter

A job is dead when it has used up its attempts (`MAX_JOB_ATTEMPTS`, five). It stays in the table
with status `failed` and the error code that killed it, so the failure stays inspectable.

```sql
-- The dead letters and why they died.
SELECT id, type, idempotency_key, attempts, last_error, updated_at
FROM intelligence_jobs
WHERE status = 'failed'
ORDER BY updated_at DESC;
```

**A failed job is never deleted by the retention prune.** It stays until the failure is
acknowledged — which happens when a later attempt for the same
`(event, handler, handlerVersion)` succeeds, because that attempt updates the same rows.

To retry a dead letter, replay its event:

```sql
-- The event and the handler of a dead job.
SELECT id, type, idempotency_key, payload_json FROM intelligence_jobs
WHERE status = 'failed';
```

The replay seam (`createReplayService`) re-queues the work of a stored event and refuses an event
whose account was reset or purged. Replaying an event whose handler already delivered it is a
no-op for the delivery but re-runs the handler's effect — which is what you want when the handler
itself was at fault.

### An unsupported event schema

The journal stores events with a `schemaVersion`. A handler that does not understand the version
refuses the event: the delivery stays `pending` and the job waits. Nothing is lost, and nothing is
guessed.

```sql
-- The event versions the journal holds.
SELECT schema_version, type, count(*) AS events
FROM domain_outbox
GROUP BY schema_version, type;
```

An event whose version no handler knows is a deployment problem, not an operator problem: deploy
the application that understands that version. Do not edit the stored event — the journal's
history is append-only, and the event is the record of what the trading change actually was.

### Lease recovery

The lease expires 30 seconds after its last renewal (`WORKER_LEASE_MS`). A worker that dies
without releasing it leaves a lease that runs out; the next worker takes it over at a higher
fence.

```sql
-- The lease and its fence.
SELECT name, owner, fence, lease_until, heartbeat_at
FROM intelligence_worker_lease;
```

If `lease_until` is in the past and no worker is running, the lease is free: start the worker. If
`lease_until` is in the future and no worker is running, the holder died mid-run — wait for the
lease to expire rather than deleting the row. Deleting the row does not release the claim: the
fence lives on the job, so a job the dead worker held is reclaimed by the next worker at a higher
fence, and the dead worker's completion is refused.

**Never delete a job row to "unstick" the queue.** A job whose row is gone cannot be
acknowledged, and its effect would be lost. Cancel it through the job store instead: a cancelled
job is fenced, and the worker that holds it fails its completion cleanly.

## The no-provider behaviour

The journal works with no AI provider configured. The observation path — the facts the journal
derives from your own trades — never calls a provider. The background AI path does, and it is off
by default.

| The journal does                            | The journal needs                                   |
| ------------------------------------------- | --------------------------------------------------- |
| derives observations from committed changes | nothing                                             |
| keeps knowledge of your own notes and rules | nothing                                             |
| raises opportunities for you to look at     | nothing                                             |
| runs a background AI pass                   | a configured provider, a key and an explicit opt-in |

A provider that is missing, unreachable or refuses the request leaves the journal intact: the
run ends as `failed` or `unavailable`, with the reason in its diagnostics, and no partial result
is stored. The daily allowance is reserved before the call, so a crashed attempt still consumes
its slot.

### The opt-in budgets

| Budget                      | Where it lives                                                   | The default            |
| --------------------------- | ---------------------------------------------------------------- | ---------------------- |
| background attempts per day | `intelligence_budget_reservations`                               | 10 per journal per day |
| the daily background policy | `intelligence_policy` (revisioned)                               | opt-in, off by default |
| the operator's own switches | `intelligenceProactiveOptIn`, `intelligencePaused` in `settings` | opt-in on, pause off   |

```sql
-- The attempts reserved today.
SELECT day, count(*) AS reserved FROM intelligence_budget_reservations
GROUP BY day ORDER BY day DESC LIMIT 7;

-- The policy the runs were approved under.
SELECT id, revision, settings_json, recorded_at FROM intelligence_policy;
```

A change to the provider, the model or the endpoint invalidates the runs that were approved under
the old configuration: they become `unavailable` and must be rescheduled explicitly. The journal
never silently reroutes a run to a different model or endpoint.

## Retention

Retention removes what is finished and unreferenced. It never removes a live reference — a
workflow that waits for you, an opportunity you can still act on, an open conversation, a pending
delivery, or a failure nobody has acknowledged.

| Class       | What it removes                                                                | Window  |
| ----------- | ------------------------------------------------------------------------------ | ------- |
| transport   | outbox events whose whole subtree is finished, and the finished retention jobs | 30 days |
| diagnostics | the diagnostic payload of a finished background run                            | 30 days |
| knowledge   | superseded and invalidated knowledge and observations nobody names             | 90 days |

The prune is bounded: one call removes at most the number of rows you give it, so a retention run
cannot hold the write lock for an unbounded time.

The dedup keys outlive the work they describe, so nothing is raised twice:

- a delivery row stays as long as its event, so a handler never runs twice for one event;
- a background run row stays forever, so an effect is never queued twice;
- an opportunity row is never removed, so a dismissal outlives the thing it dismisses.

## Deletion

Deleting an account takes its whole intelligence with it: its events, their deliveries and jobs,
the evidence of its fills, its observations, its knowledge, its workflows, its opportunities and
its conversations.

Every purge is recorded in the **deletion ledger**: a file `purge-ledger.json` beside the database,
holding the account ids that were purged and the kind of purge.

The ledger lives beside the database rather than inside it, because the database is what a restore
replaces: a ledger inside the database would be rolled back with it. The entry is written before
the purge runs, so a journal that was purged is never restored without the ledger that says so; a
purge that then fails takes its entry back.

A restore applies the ledger again, so **a restore cannot bring a purged account back**.

### An explicit reset

A reset purges the intelligence of an account that **survives**. The seed checkpoint of that
account becomes `suppressed`, so the historical seed does not re-derive what was deleted and the
replay seam refuses the account. The reset is recorded in the ledger with kind `reset`.

A rebuild request moves the checkpoint back to `pending`, so the seed runs again, and the ledger
forgets the reset — the reset has been undone.

### Clear history

Clearing an account's fills leaves the account in place. The evidence of the deleted fills is
**invalidated**: its timing quality becomes `unknown`, because the source no longer proves
anything about a fill that is gone. The membership evidence survives — it must survive ordinary
source-fill deletion.

## Backup

**A backup is only valid on a quiescent journal.** The command refuses anything it cannot vouch
for: a missing or relative path, a source and a destination that are the same, a destination that
already holds a journal, a journal whose worker lease is still live, and a journal whose key comes
from `JOURNAL_SECRET` (that key cannot travel with a backup).

The operator acknowledges the quiescence. Two writers must be stopped:

1. the **HTTP writer** — stop the web process, so no request writes to the journal;
2. the **worker** — stop the worker process, so no job writes to the journal.

The command checks the worker lease itself; the HTTP writer is on you.

The snapshot is written with SQLite's `VACUUM INTO`, so it is a consistent copy of the whole
journal — never a copy of a live WAL file. The key material (`.secret`) is copied beside it, and
the manifest carries a **key probe**: an envelope encrypted under the journal's own key over a
fixed label. The probe is a key _check_, not a credential: it never reveals the key and never
carries account data.

A backup directory holds:

```
journal.db        the consistent snapshot
.secret           the key material, when the journal has a key file
manifest.json     the key probe and the deletion ledger at the time of the backup
```

## Restore

Restore into **scratch storage** first. The restore:

1. refuses a destination that already holds a journal, so it never overwrites a live journal;
2. copies the snapshot and the key material;
3. verifies the copy **before anything migrates it** — `PRAGMA integrity_check` and
   `PRAGMA foreign_key_check` judge the backup, not a migrated version of it;
4. verifies the key: the manifest's probe must open under the restored key material;
5. applies the deletion ledger again — a purged account stays purged;
6. verifies the restored journal once more.

The restore never reads, decrypts or writes a credential. To prove the key material travels, set
a **synthetic** provider key in a scratch journal, back it up, restore it and decrypt the
synthetic value with the restored key. Never use a real key for a rehearsal.

### Promoting a restored journal

1. Stop the web process and the worker.
2. Keep the live `purge-ledger.json` beside the restored journal: it is newer than the backup's
   copy, and it is what keeps a purge that happened after the backup from being undone.
3. Replace the journal's data directory with the restored one.
4. Start the web process, then the worker.
5. Confirm the journal opens, the ledger is present, and the backlog is what you expect.

## Rollback

| Situation                                 | What to do                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a migration failed to apply               | Stop. The journal stays at the version it fully applied; the runner rolled the failed migration back with its ledger row. Fix forward — never edit an applied migration, never delete a ledger row. |
| a migration's checksum does not match     | The journal was migrated from a different source. Restore the original source and rebuild the checksum artifact, or restore the journal from a backup.                                              |
| the journal was migrated by a newer build | Deploy the newer build, or restore a backup. Do not run the older build against it.                                                                                                                 |
| the journal is corrupt                    | Stop the writers, restore the verified backup into scratch storage, verify it, then promote it.                                                                                                     |
| the wrong data was written                | Roll back to the last verified backup and reconcile the difference. Do not edit rows by hand.                                                                                                       |

An older binary lacks the new version guards, so it must not write to a newer journal. Never
downgrade a journal by dropping tables: restore instead.

See also: [Database migrations](./database-migrations.md) and
[ADR 0007 — durable SQLite worker and migrations](../decisions/0007-durable-sqlite-worker-and-migrations.md).
