# Intelligence operations

The runbook for the journal's intelligence runtime: the worker, the backlog, the failures, the
backup, the restore and the rollback. Every command here is one an operator can run against a
journal they own — except where a section says plainly that the operator has no surface for it
yet, and names what is missing.

> **Never operate on live trader data to test a procedure.** Use a scratch journal
> (`JOURNAL_DATA_DIR` pointing at a disposable directory) and synthetic credentials.

## What the runtime is made of

| Part                    | Where it lives                                                                       | What it holds                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| the **worker**          | a separate process, forked by the journal supervisor                                 | claims jobs, runs the handlers, acknowledges the effects                               |
| the **backlog**         | `intelligence_jobs`                                                                  | durable work: observations, seeds, schedule triggers, retention runs, workflow effects |
| the **outbox**          | `domain_outbox` and `event_deliveries`                                               | the committed change events and what each handler did with them                        |
| the **observations**    | `intelligence_observations` and `observation_evidence`                               | what the journal concluded about a trade, and the revisions it rests on                |
| the **insights**        | `intelligence_insights`                                                              | one generated review question per source revision                                      |
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

The web process cannot observe the worker: it serves `worker: null`. The supervisor prints the
worker's health record on its own standard output, and the journal itself shows the lease.

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

> **No operator surface for the replay yet.** The seam exists and refuses an account that was
> reset or purged, but no command or route calls it. Until one does, a dead letter can be
> inspected, not replayed.

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

> **No operator surface for the cancel yet.** The job store can cancel a job, but no command or
> route calls it. Until one does, leave the row alone and let it fail: a dead letter stays
> inspectable, which is what the section above needs it for.

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

| Class       | What it removes                                                                                           | Window  |
| ----------- | --------------------------------------------------------------------------------------------------------- | ------- |
| transport   | outbox events whose whole subtree is finished, and the finished retention jobs                            | 30 days |
| diagnostics | the diagnostic payload of a finished background run                                                       | 30 days |
| knowledge   | superseded and invalidated knowledge and observations nobody names, and the review questions nobody names | 90 days |

The review questions are knowledge class too. A question goes only when all three hold: it is older
than the 90-day window, it is no longer the current one — the trade it was made from was
corrected, or the observation it rests on is no longer active — and nothing live still names it. A
question is bound to the revision it was made from, so a correction hides the older question at
once: the row stays in the table, but it is no longer the current question for that trade.

Nothing generates a question yet — the table holds the storage, and no provider call writes to it.

The prune is bounded: one call removes at most the number of rows you give it, so a retention run
cannot hold the write lock for an unbounded time.

The same work runs inside the worker. A retention job — `type: "retention"`, payload
`{"type": "retention", "before": <epoch ms>}` — is claimed by the worker and runs inside the
**worker's** transaction: the transport and the diagnostics class at the cutoff the payload names,
the knowledge class at its own 90-day window, and the whole run inside one bound of 500 rows. The
windows are 30 days for the transport and the diagnostics class and 90 days for the knowledge
class.

Nothing in the journal enqueues that job by itself, so an operator puts one in the backlog and the
worker claims it on its next tick:

```sql
-- A retention job for the worker to claim. The idempotency key is unique, so a
-- second run of the same key is refused by the index. The payload carries the
-- "type" the worker's payload schema discriminates on: a payload without it
-- is not read, and the job dies as an unhandled job.
INSERT INTO intelligence_jobs
  (id, idempotency_key, type, payload_json, status, attempts, available_at, fence,
   cancel_requested, created_at, updated_at)
VALUES
  ('<uuid>', 'retention:<epoch ms>', 'retention',
   '{"type":"retention","before":<epoch ms>}', 'pending', 0,
   <epoch ms>, 0, 0, <epoch ms>, <epoch ms>);
```

The dedup keys outlive the work they describe, so nothing is raised twice. The prune is what
leaves them alone — a purge of an account takes that account's rows with it:

- a delivery row stays as long as its event, so a handler never runs twice for one event;
- the prune never removes a background run row, so an effect is never queued twice;
- the prune never removes an opportunity row, so a dismissal outlives the thing it dismisses.

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
  -b 'journal_session=<your session cookie>' \
  -d '{"before": 1760000000000}'
```

A journal with no password set answers `401` only when it has one; on a journal without a
password the cookie is not needed.

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
the evidence of its fills, its observations, its review questions, its knowledge, its workflows, its
opportunities, its conversations and the background runs scoped to it. A run scoped to several
accounts loses only the deleted account; a run scoped to the deleted account alone goes with it,
and its budget reservations with it.

The operator deletes an account with `DELETE /api/accounts/{id}`.

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

The review questions go with the account. A purge takes them, the reset takes them, and a restore
cannot bring a purged account's question back, because the ledger is applied again.

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

The operator clears it with `POST /api/accounts/{id}/actions` and the body `{"action": "clear"}`.

## Backup

**A backup is only valid on a quiescent journal.** The command refuses anything it cannot vouch
for, among others: a missing or relative path, a source and a destination that are the same, a
destination that already holds a journal, a journal whose worker lease is still live, a journal
whose key comes from `JOURNAL_SECRET` (that key cannot travel with a backup), a source that does
not hold the journal's own key material (the key probe is sealed under the journal's live key, so a
stale copy would verify against the wrong key), a source that does not hold a journal at all, a
source whose encrypted settings the live key cannot open, and a source that holds encrypted
material no key can travel with.

The backup is taken by the journal's own operations command, from the repository root:

```sh
JOURNAL_DATA_DIR=/data/trade-journal \
pnpm --filter web intelligence:operations backup \
  --source /data/trade-journal \
  --destination /backups/journal-2026-11-16 \
  --acknowledge-quiescence
```

Every input is typed: the **source** (the journal's own data directory), the **destination** (the
directory to write the backup into — it is created if it does not exist, and refused if it
already holds a journal) and the **acknowledgement** that the journal is quiescent. Nothing is
defaulted, and the command refuses an input it cannot vouch for rather than guessing one.

The operator acknowledges the quiescence. Two writers must be stopped:

1. the **HTTP writer** — stop the web process, so no request writes to the journal;
2. the **worker** — stop the worker process, so no job writes to the journal.

Stop the journal supervisor, which owns both: it forks the web process and the worker, and it
restarts a worker that dies on its own. In production that is the `pnpm start` command; in
development it is `pnpm --filter web dev:journal`, which starts the web process but no worker
unless `--worker enabled` is passed.

**Wait for the lease to expire.** The command refuses a source journal whose worker lease is still
live, and the lease row outlives the stopped worker: nothing deletes it, and it stays valid for up
to `WORKER_LEASE_MS` (30 seconds) after the worker stops. So a backup run immediately after
stopping the supervisor is refused with "The journal still holds a worker lease". Wait until
`intelligence_worker_lease.lease_until` is in the past and run it again. Never delete the lease row
to make the refusal go away — a live lease is the journal's own record of who was writing to it.

The command checks that lease in the source journal's own database. The HTTP writer is on you.

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
3. verifies the key: the manifest's probe must open under the restored key material;
4. verifies the copy **before anything migrates it** — `PRAGMA integrity_check` and
   `PRAGMA foreign_key_check` judge the backup, not a migrated version of it;
5. applies the deletion ledger again — a purged account stays purged;
6. verifies the restored journal once more, after the restore has migrated it to the current schema.

The restore is run by the same command, from the repository root:

```sh
pnpm --filter web intelligence:operations restore \
  --source /backups/journal-2026-11-16 \
  --destination /scratch/journal-restore-2026-11-16
```

The restore never reads, decrypts or writes a credential. To prove the key material travels, set
a **synthetic** provider key in a scratch journal, back it up, restore it and decrypt the
synthetic value with the restored key. Never use a real key for a rehearsal.

### Promoting a restored journal

The live `purge-ledger.json` is newer than the backup's copy, and it is what keeps a purge that
happened after the backup from being undone. It must reach the restore **before** the restore
runs, because the restore applies the ledger it finds in its destination.

1. Stop the journal supervisor, which owns the web process and the worker.
2. Copy the live `purge-ledger.json` into the **restore destination**. Do this before the
   restore: a restore that ran without it would bring a purged account back.
3. Run the restore into that destination:

   ```sh
   pnpm --filter web intelligence:operations restore \
     --source /backups/journal-2026-11-16 \
     --destination /scratch/journal-restore-2026-11-16
   ```

   It applies the ledger it finds there, so the purged account stays purged.

4. Replace the journal's data directory with the restored one.
5. Start the journal supervisor, which starts the web process and then the worker.
6. Confirm the journal opens, the ledger is present, and the backlog is what you expect.

## Rollback

| Situation                                 | What to do                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a migration failed to apply               | Stop. The journal stays at the version it fully applied; the runner rolled the failed migration back with its ledger row. Fix forward — never edit an applied migration, never delete a ledger row. |
| a migration's checksum does not match     | The journal was migrated from a different source. Restore the original source and rebuild the checksum artifact, or restore the journal from a backup.                                              |
| the journal was migrated by a newer build | Deploy the newer build, or restore a backup. Do not run the older build against it.                                                                                                                 |
| the journal is corrupt                    | Stop the writers, restore the verified backup into scratch storage with the restore command, verify it, then promote it.                                                                            |
| the wrong data was written                | Roll back to the last verified backup and reconcile the difference. Do not edit rows by hand.                                                                                                       |

An older binary lacks the new version guards, so it must not write to a newer journal. Never
downgrade a journal by dropping tables: restore instead.

See also: [Database migrations](./database-migrations.md) and
[ADR 0007 — durable SQLite worker and migrations](../decisions/0007-durable-sqlite-worker-and-migrations.md).

## Release

This section is the release acceptance record for the intelligence runtime: what the benchmark
measures, what the packaged tree must contain, which gates CI runs, and what the Phase 21 run
actually observed.

### The benchmark

`scripts/benchmark-intelligence.mjs` measures the real path. It ingests synthetic fills over HTTP
into a disposable journal and reads the journal back over HTTP. Nothing is mocked and no number
is estimated: a counter that cannot be read is reported as `null`, and the gate it belongs to
fails.

```sh
# A disposable scratch root, and a machine-readable result. The baseline build
# is measured alongside the candidate build, so the p95 gate has something to
# compare against; without it the run exits non-zero.
node scripts/benchmark-intelligence.mjs \
  --volumes 1000,10000,100000 \
  --label candidate --compare-label baseline \
  --compare-supervisor /path/to/baseline/apps/web/.next/standalone/apps/web/scripts/run-journal.mjs \
  --data-dir /tmp/journal-benchmark \
  --out /tmp/journal-benchmark.json

# The gate: it fails when a measured threshold is missed.
python3 scripts/verify-features.py --benchmark-result /tmp/journal-benchmark.json
```

| Volume | What it holds                                       |
| ------ | --------------------------------------------------- |
| 1k     | one thousand synthetic fills in one account         |
| 10k    | ten thousand synthetic fills in one account         |
| 100k   | one hundred thousand synthetic fills in one account |

Each volume runs in both worker modes against a fresh journal, several times over:

- **idle** — the supervisor with the worker disabled;
- **active** — the supervisor with the worker enabled, so the worker has real work and the queue
  latency is measurable.

Both modes capture events, so both modes hold the same data and write the same WAL: the only
difference between them is the worker. The difference between the two modes is reported as the
**worker's overhead**.

The read latency is measured at every ingest batch boundary, so both modes read the same sequence
of journal sizes. A wall-clock sampler would compare one mode's early journal against the other's
late journal, and the result would depend on how fast the ingest happened to run.

Each mode's number is the **median of its repetitions**: a single latency measurement on a shared
machine is noisy, and the threshold is not adjusted to accommodate it.

| The gate               | The threshold                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| SQLITE_BUSY escapes    | zero: no busy error in a job row, a delivery row, a failed request, or the worker's own health stream |
| lost effects           | zero: every requested fill is in the journal, and every accepted fill is still there                  |
| failed ingest requests | zero: a batch that failed is a failure, not a rounding error                                          |
| queue drained          | the active worker consumed its own backlog                                                            |

These gates are absolute: they hold for any build.

### The p95 regression gate

The p95 regression is a comparison between two **builds**: the baseline build the release replaces
and the candidate build being released. The two are measured **back to back** — the baseline's run
is immediately followed by the candidate's run for the same volume, mode and repetition — so both
face the same host conditions and the difference is the build's rather than the machine's. Two
builds measured hours apart on a shared machine differ by the machine.

```sh
node scripts/benchmark-intelligence.mjs \
  --label candidate --compare-label baseline \
  --compare-supervisor <baseline>/apps/web/.next/standalone/apps/web/scripts/run-journal.mjs \
  --volumes 1000,10000,100000 --data-dir /tmp/bench \
  --out /tmp/benchmark.json
python3 scripts/verify-features.py --benchmark-result /tmp/benchmark.json
```

The candidate's p95 must be at most 20% above the baseline's, per volume and per worker mode.

The counters are read from the journal's own records and from its own output: the busy errors from
the `last_error` columns of `intelligence_jobs` and `event_deliveries`, from the response body of a
failed request, and from the worker's own health stream — a busy journal is classified in the
worker's memory and never reaches a row, because the work stays pending and is retried. The lost
effects come from the `executions` table, the queue latency from `domain_outbox` and
`intelligence_jobs`. The rebuild lock duration is reported as the observed maximum duration of an
ingest request, because that transaction is what holds the write lock.

### The package-content audit

Two trees are audited, and their rules differ.

**The runtime tree** — the web image and the desktop bundle. It must carry the standalone server
entry point, the worker entry point with its native SQLite module, the supervisor, the static
assets and the public assets. It must not carry a journal database, key material, a credential or
an environment file.

**The published tarballs** — `@luxalgo/journal-core` and `@luxalgo/journal-importers`, packed
without publishing. Each tarball carries its `dist` output and its metadata, and nothing else.

### The CI gates

| Job         | Runner           | What it proves                                                                                                                    |
| ----------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `quality`   | `ubuntu-latest`  | format, typecheck, tests, licences, package builds, app build                                                                     |
| `desktop`   | `windows-latest` | the sidecar, the icons, `cargo check`, `cargo test`, the Tauri build, the packaged-tree audit, the native ABI, the packaged smoke |
| `benchmark` | `ubuntu-latest`  | the benchmark's own reporting rules, the 1k/10k/100k benchmark and its gate counters                                              |
| `audit`     | `ubuntu-latest`  | the published tarball content, without publishing                                                                                 |
| `docker`    | `ubuntu-latest`  | the image build and the scratch-volume smoke                                                                                      |

The root `pnpm typecheck` recurses into the desktop workspace, whose typecheck script generates the
bundle icons and then runs `cargo check`. A `cargo check` cannot run on a Linux runner without the
webview system libraries and a Linux sidecar binary, so the desktop's Rust gate lives in the
`desktop` job on a Windows runner, and the quality job runs the typecheck of the TypeScript
workspaces. No workspace loses a gate.

**Two desktop artifacts are generated and gitignored, and every cargo path needs them.** The Node
sidecar (`desktop/src-tauri/binaries/node-x86_64-pc-windows-msvc.exe`) and the bundle icons
(`desktop/src-tauri/icons/icon.ico` and the PNG and ICNS files beside it) are produced by
`pnpm --filter desktop setup:sidecar` and `pnpm --filter desktop setup:icons`; neither is in git,
so no merge can carry them. The icons are a build input of the Windows resource — `cargo check`,
`cargo test` and `tauri build` all compile `icon.ico` into the binary — so a checkout that has none
of them, or that still holds an icon from an older generator, fails with `RC2175`. Every desktop
script that runs cargo generates the icons first — `pnpm --filter desktop typecheck`,
`pnpm --filter desktop build:app` and `pnpm --filter desktop build:debug` — so an operator who
checks out the repository and runs those scripts never hits that error. A **direct** `cargo check`
or `cargo test` does not go through them and needs `pnpm --filter desktop setup:icons` once
before it.

The `desktop` job builds the web app with Node 24, because the sidecar is Node 24.11.0 (ABI 137)
and `better-sqlite3` is a V8 addon bound to one `NODE_MODULE_VERSION`. The job then loads the
built native module with the sidecar binary itself: that is the ABI evidence, and it fails the job
if the sidecar cannot load the module.

That same job audits the **packaged runtime tree** it just built. The audit runs with
`JOURNAL_REQUIRE_PACKAGED_TREE=1`, which turns a missing tree from a skip into a failure, so the
job cannot pass without the tree it built. The `quality` job's own `pnpm test` keeps the skip,
because it runs before the build and has no packaged tree.

The packaged smoke lives in `desktop/scripts/packaged-smoke.ps1` and the CI job calls that script.
It asserts that the journal listens on a nonzero loopback port, that it answers over HTTP, that
the app published the **readiness signal** on exactly that port, and that no `node.exe` descendant
survived the quit.

### The Phase 21 release record

Every item below was run and observed. The blocked items are stated separately from the passed
ones.

| Check                                                                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| targeted tests (`intelligence-acceptance`, `intelligence-packaging`, `intelligence-supervisor`) | passed: 3 files, 35 tests                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm typecheck`                                                                                | passed, including the desktop `cargo check`                                                                                                                                                                                                                                                                                                                                                                                            |
| `cargo check` / `cargo test` (`desktop/src-tauri`)                                              | passed                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `cargo test` (`gen_icons`)                                                                      | passed: the icon writer's own header test                                                                                                                                                                                                                                                                                                                                                                                              |
| the desktop build                                                                               | built; the packaged app opened the journal on a nonzero loopback port and answered HTTP                                                                                                                                                                                                                                                                                                                                                |
| the Windows packaged smoke                                                                      | passed: the journal answered over HTTP, the **readiness signal was published on the same port**, and **no `node.exe` survived the quit**                                                                                                                                                                                                                                                                                               |
| the Docker scratch-volume smoke                                                                 | **blocked host evidence**: the Docker daemon is not running on this host (`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`). The job exists in CI; it was not run here and is not claimed as passed.                                                                                                                                                                                                 |
| the 1k/10k/100k benchmark                                                                       | the absolute gates passed at every volume (zero busy escapes, zero lost effects, zero failed requests, a drained queue); the **p95 regression gate passed** in the paired run against the baseline build (worst row +8.6 %, no row over the 20 % limit) — see the phase report for the measured numbers and for the host-sensitivity caveat                                                                                            |
| the published tarball audit                                                                     | passed: both tarballs carry only `dist` and their metadata                                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm format:check`                                                                             | **FAILED (exit 1): the format check is red.** 73 files tracked in the base commit fail it and 70 do now — three fewer, none added. The raw repository-wide count is 74 because four gitignored Tauri-generated schema files under `desktop/src-tauri/gen/` exist in a built tree and not in a fresh checkout. This is a pre-existing condition, not a regression. The gate is red and is recorded as red; it is not claimed as passed. |

The phase report for this run is
[docs/superpowers/reports/ai-native-journal-phase-21.md](../superpowers/reports/ai-native-journal-phase-21.md).
