# Intelligence operations

The runbook for the journal's intelligence runtime: the worker, the backlog, the failures, the
backup, the restore and the rollback. Every command here is one an operator can run against a
journal they own.

> **Never operate on live trader data to test a procedure.** Use a scratch journal
> (`JOURNAL_DATA_DIR` pointing at a disposable directory) and synthetic credentials.

## What the runtime is made of

| Part                    | Where it lives                                                                       | What it holds                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| the **worker**          | a separate process, supervised by the web process                                    | claims jobs, runs the handlers, acknowledges the effects                               |
| the **backlog**         | `intelligence_jobs`                                                                  | durable work: observations, seeds, schedule triggers, retention runs, workflow effects |
| the **outbox**          | `domain_outbox` and `event_deliveries`                                               | the committed change events and what each handler did with them                        |
| the **observations**    | `intelligence_observations` and `observation_evidence`                               | what the journal concluded about a trade, and the revisions it rests on                |
| the **knowledge**       | `knowledge_sources`, `knowledge_hypotheses`, `knowledge_patterns`                    | what the journal concluded about the operator's own notes and rules                    |
| the **experience**      | `intelligence_workflows`, `intelligence_opportunities`, `intelligence_conversations` | the interactions the operator still has open                                           |
| the **background runs** | `intelligence_runs` and `intelligence_budget_reservations`                           | the background AI attempts, their pinned configuration and their daily allowance       |

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
| `stopped`         | it was asked to stop, or its loop broke on a fault     | start it again to move the backlog                                             |

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

### Retrying a dead letter

A dead letter can be retried only when its work belongs to a **committed event** — a trade
observation. Then replay its event:

```sql
-- The event and the handler of a dead job.
SELECT id, type, idempotency_key, payload_json FROM intelligence_jobs
WHERE status = 'failed';
```

The replay seam (`createReplayService`) re-queues the work of a stored event and refuses an event
whose account was reset or purged. Replaying an event whose handler already delivered it is a
no-op for the delivery but re-runs the handler's effect — which is what you want when the handler
itself was at fault.

**A workflow effect job has no event to replay.** Its payload names a workflow and a transition
revision — `{"type": "workflow_effect", "workflowId": "...", "transitionRevision": n}` — and its
handler is `workflow-effect` (version 1). The worker resolves that handler, so a deferred workflow
resumes by itself: a workflow that waits for you comes back when the worker wakes it, without the
operator doing anything.

A workflow effect job that is dead therefore failed for another reason. Read `last_error`:
`validation_failed` will never succeed on a retry, `handler_failed` may. The job row stays
inspectable and the workflow stays where it was — a user command is legal only from
`waiting_for_user`, so a workflow that never presented itself cannot be pushed forward by a
command. To have the effect run again, the workflow must record a new transition: from
`waiting_for_user`, a `defer` command schedules it again and enqueues a fresh effect job, which the
worker runs when the workflow wakes.

A dead letter whose `last_error` is `unhandled_job` is a deployment problem, not an operator
problem: the worker did not know the job's kind. Deploy the build that resolves it.

### An unsupported event schema

The journal stores events with a `schemaVersion`. The write path validates an event against the
strict contract, so an event of a version the journal does not know never enters the outbox at
all: the change that would have carried it is refused before it is committed.

A row that got in another way — a restored backup from a newer build, a row written by hand — is
refused by the handler that reads it: the strict contract rejects it, the job ends `failed` with
the code `validation_failed`, and the delivery of that event ends `failed` with the same code.
Nothing is guessed, and nothing is lost: the event stays in the outbox and the failure stays
inspectable.

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

The same work runs on the worker's schedule. A retention job — `type: "retention"`, payload
`{"before": <epoch ms>}` — is claimed by the worker and runs inside the **worker's** transaction:
the transport and the diagnostics class at the cutoff the payload names, the knowledge class at its
own 90-day window, and the whole run inside one bound of 500 rows. The windows are 30 days for the
transport and the diagnostics class and 90 days for the knowledge class.

Nothing in the journal enqueues that job by itself, so an operator puts one in the backlog and the
worker claims it on its next tick:

```sql
-- A retention job for the worker to claim. The idempotency key is unique, so a
-- second run of the same key is refused by the index.
INSERT INTO intelligence_jobs
  (id, idempotency_key, type, payload_json, status, attempts, available_at, fence,
   cancel_requested, created_at, updated_at)
VALUES
  ('<uuid>', 'retention:<epoch ms>', 'retention', '{"before":<epoch ms>}', 'pending', 0,
   <epoch ms>, 0, 0, <epoch ms>, <epoch ms>);
```

The dedup keys outlive the work they describe, so nothing is raised twice:

- a delivery row stays as long as its event, so a handler never runs twice for one event;
- a background run row stays forever, so an effect is never queued twice;
- an opportunity row is never removed, so a dismissal outlives the thing it dismisses.

### Running the prune, the reset and the rebuild

The prune and the account commands are server functions, so the operator drives them through the
journal's own routes. Every one of them obeys the same gate:

| The request                                                           | The answer                |
| --------------------------------------------------------------------- | ------------------------- |
| no session, while the journal has a password                          | `401`                     |
| a foreign origin                                                      | `403` (`origin_denied`)   |
| a body that is not JSON, or carries a field the route does not accept | `400` (`invalid_request`) |
| an account the journal does not know (the reset and the rebuild only) | `403` (`scope_denied`)    |

The session is the `journal_session` cookie. A request that carries no origin at all is not a
browser request, so it is allowed: a `curl` from the operator's own machine needs no origin
header.

#### `POST /api/intelligence/retention` — run the prune now

The body is `{"before": <epoch ms>, "limit": <rows>}`. Both fields are optional, and both must be
whole numbers when they are there.

- `before` — the cutoff instant, in epoch milliseconds. It must not be negative. Nothing newer
  than it is touched. The default is 30 days ago.
- `limit` — the largest number of rows the run may remove, between 1 and 10 000. The default is
  500, and a limit outside that range is refused.

The answer is `{"removed": n, "knowledgeRemoved": m, "before": <cutoff>}`: the rows the transport
and the diagnostics class removed, the rows the knowledge class removed, and the cutoff the run
used. The knowledge class keeps its own 90-day window whatever the body names, and the two
classes share the one bound.

```sh
curl -X POST http://localhost:3000/api/intelligence/retention \
  -H 'content-type: application/json' \
  -d '{"before": 1760000000000}'
```

#### `GET /api/intelligence/retention` — read the current state

The answer is `{"retention": {...}}`:

```jsonc
{
  "retention": {
    "windows": { "transportDays": 30, "knowledgeDays": 90 },
    "limit": 500,
    "purgedAccounts": [{ "accountId": "…", "kind": "deleted" }],
    "accounts": [{ "id": "…", "checkpoint": "suppressed" }],
  },
}
```

`windows.transportDays` covers the transport and the diagnostics class, which share one window. A
`checkpoint` of `null` means the account has never been seeded — not that its seed is suppressed.

#### `POST /api/intelligence/retention/reset` — reset one account

The body is `{"accountId": "..."}`. It purges the intelligence of that account, writes its seed
checkpoint as `suppressed` so the historical seed does not re-derive what was deleted, and records
the reset in the deletion ledger with kind `reset`. The account itself survives. The answer is
`{"accountId": "...", "checkpoint": "suppressed"}`.

#### `POST /api/intelligence/retention/rebuild` — ask for a rebuild

The body is `{"accountId": "..."}`. It moves the seed checkpoint back to `pending`, enqueues the
seed job so the worker seeds the account again, and drops the reset from the deletion ledger: the
reset has been undone. The answer is `{"accountId": "...", "checkpoint": "pending"}`.

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

The operator's own levers on the intelligence of an account are the two routes of
[Running the prune, the reset and the rebuild](#running-the-prune-the-reset-and-the-rebuild): the
reset, and the rebuild that undoes it.

### An explicit reset

A reset purges the intelligence of an account that **survives**. The seed checkpoint of that
account becomes `suppressed`, so the historical seed does not re-derive what was deleted and the
replay seam refuses the account. The reset is recorded in the ledger with kind `reset`.

A rebuild request moves the checkpoint back to `pending`, so the seed runs again, and the ledger
forgets the reset — the reset has been undone.

The operator does both through the journal's own routes: `POST /api/intelligence/retention/reset`
with `{"accountId": "..."}` resets the account, and `POST /api/intelligence/retention/rebuild` with
the same body asks for the rebuild. The rebuild enqueues the seed job, so the worker seeds the
account again.

### Clear history

Clearing an account's fills leaves the account in place. The evidence of the deleted fills is
**invalidated**: its timing quality becomes `unknown`, because the source no longer proves
anything about a fill that is gone. The membership evidence survives — it must survive ordinary
source-fill deletion.

## Backup

**A backup is only valid on a quiescent journal.** The command refuses anything it cannot vouch
for: a missing or relative path, a source and a destination that are the same, a destination that
already holds a journal, a journal whose worker lease is still live, a journal whose key comes
from `JOURNAL_SECRET` (that key cannot travel with a backup), and a source that does not hold the
journal's own key material (the key probe is sealed under the journal's live key, so a stale copy
would verify against the wrong key).

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

The live `purge-ledger.json` is newer than the backup's copy, and it is what keeps a purge that
happened after the backup from being undone. It must reach the restore **before** the restore
runs, because the restore applies the ledger it finds in its destination.

1. Stop the web process and the worker.
2. Copy the live `purge-ledger.json` into the **restore destination**, beside the backup's
   `journal.db`. Do this before the restore: a restore that ran without it would bring a purged
   account back.
3. Run the restore into that destination. It applies the ledger it finds there, so the purged
   account stays purged.
4. Replace the journal's data directory with the restored one.
5. Start the web process, then the worker.
6. Confirm the journal opens, the ledger is present, and the backlog is what you expect.

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
