# Database migrations

The journal keeps its schema in one SQLite file. Every schema change goes through an
**ordered, checksummed migration** applied by the runner in `apps/web/src/db/migrations.ts`.
There is no second mechanism: startup applies migrations, it does not run "the latest DDL".

> **A migration that has been applied is frozen.** Never edit it, never renumber it, never
> delete it. A journal records the checksum of the source it was migrated from; changing that
> source makes the journal unopenable by design.

## How a journal is opened

```
openJournalDatabase(file)
  ├── journal_mode = WAL, foreign_keys = ON          (unchanged)
  └── applyMigrations(sqlite)
        ├── validate the applied history (read-only, before any write)
        └── BEGIN IMMEDIATE
              ├── re-read and re-validate the history   (a concurrent process may have moved on)
              ├── create the ledger table if it is missing
              └── for each pending migration:
                    apply it, then record it in the ledger
        COMMIT
```

Everything happens in **one immediate transaction**. If a migration fails, its schema changes
roll back with its ledger row, so the journal never advances a version it did not fully apply.
All migration callbacks are synchronous: no network call, no promise, no provider call happens
inside the lock.

## The ledger

```sql
CREATE TABLE journal_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
```

The runner owns this table; no migration creates it. `applied_at` is epoch milliseconds.

## When the runner refuses a journal

The journal is **not** touched when the history cannot be vouched for. Startup fails with a
`MigrationError` whose `reason` says why:

| Reason                  | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `future-version`        | The journal was migrated by a newer application. Do not open it here. |
| `noncontiguous-history` | An applied version is missing from the middle of the history.         |
| `checksum-mismatch`     | An applied migration was edited or swapped after it was applied.      |
| `name-mismatch`         | An applied migration was renamed after it was applied.                |
| `registry-invalid`      | The build's own registry is inconsistent.                             |
| `missing-manifest`      | The checksum artifact does not cover a registered migration.          |

A journal that fails validation is a **stop and report** situation, not something to repair by
hand. Do not delete ledger rows to "unstick" it: read the error, then write a forward repair
migration (see below).

## Writing a migration

1. **Create the file** `apps/web/src/db/migrations/NNNN-name.ts`, where `NNNN` is the next
   version and `name` is a short kebab-case description. The file name and the migration's
   `name` field must agree.
2. **Write the migration.** It exports a `JournalMigrationSource`:

   ```ts
   import type { JournalMigrationSource } from "../migrations.ts";

   export const myChange: JournalMigrationSource = {
     version: 2,
     name: "my-change",
     up(sqlite) {
       sqlite.exec("CREATE TABLE ... ");
     },
   };
   ```

   `up` must be **idempotent in spirit and safe for a fresh journal**: the runner applies every
   pending migration to a brand-new database too, so migration 2 runs on a journal that migration
   1 just created.

3. **Register it** in `apps/web/src/db/migrations.ts` by adding it to `SOURCES`, in version order.
4. **Mirror the schema** in `apps/web/src/db/schema.ts` (typed Drizzle tables) and in
   `BOOTSTRAP_SQL` (`apps/web/src/db/bootstrap.ts`, the final-schema snapshot). The snapshot parity
   test fails when the two drift apart.
5. **Regenerate the checksum artifact**: `pnpm --filter web migrations:build`.
6. **Add tests** in `apps/web/tests/intelligence-migrations.test.ts`: upgrade from the previous
   version, upgrade from baseline 0001, a fresh database, repeated startup, an injected failure,
   and concurrent startup.

### Rules

- **Additive only.** New tables, new columns with defaults or nullability, new indexes. Never
  rewrite a key, a hash, a credential or imported financial data.
- **No destructive down migration.** Rollback means deploying the previous binary with the new
  tables retained, or restoring a verified backup. Additive tables are harmless to an older
  binary.
- **No provider calls, no network, no promises** inside `up`.
- **Never renumber.** If migration 2 was applied anywhere, 2 is taken forever.

## The checksum artifact

`apps/web/src/db/migration-checksums.json` holds the SHA-256 of every migration's **canonical
source text** (LF line endings, no trailing whitespace, exactly one trailing newline). It is a
build artifact, not hand-written:

```bash
pnpm --filter web migrations:build   # regenerate the artifact
pnpm --filter web migrations:check   # fail when the artifact is stale (CI gate)
```

The runtime reads the artifact rather than hashing the source at runtime: a packaged build ships
no migration sources, and `Function.prototype.toString()` changes under bundling and
transpilation, so it can never be the checksum.

`migrations:check` is the stale-artifact gate. The continuous-integration workflow starts running
it with the release-gate phase (T-021); until then, run it before every commit that touches a
migration. A stale artifact means either a migration source was edited after it was applied (a
hard error — restore the original source **and** rebuild the artifact) or a new migration was not
registered (regenerate the artifact).

## Compatibility

- The runner **never** rewrites an execution hash, a derived trade key, an annotation, an
  encrypted credential or imported financial data. The migration tests assert this byte for byte.
- A journal with **no ledger** is a pre-ledger journal: the runner runs the baseline migration
  and then records version 1. A journal is never marked migrated merely because it exists.
- A **fresh** journal and an **upgraded** journal converge on the same tables, columns, indexes
  and foreign keys. The one documented exception is a `NOT NULL` column that SQLite can only add
  with a default value: an upgraded journal carries `DEFAULT 0` where a fresh one carries none.

## Recovery

| Situation                             | What to do                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup fails with `MigrationError`   | Stop. Report the reason. Do not edit the journal, do not delete ledger rows.                                                                                                                              |
| `future-version`                      | The journal is newer than the binary. Deploy the newer application, or restore a backup.                                                                                                                  |
| `checksum-mismatch` / `name-mismatch` | A migration source changed after it was applied. Restore the original source, rebuild the artifact (`migrations:build`) and ship both; if the original source is gone, restore the journal from a backup. |
| `noncontiguous-history`               | The history was edited by hand. Restore from a backup.                                                                                                                                                    |
| A migration failed halfway            | Nothing was applied: the transaction rolled back. Fix the migration and start again.                                                                                                                      |
| The journal is corrupt                | Restore the full data directory from a verified backup (database **and** `-wal`/`-shm` sidecars, **and** the key file).                                                                                   |

### Backup before upgrading

See [Backing up before an upgrade](#backing-up-before-an-upgrade) below.

## What the migrations mean to an operator

The migration history is the journal's own record of how it got to its current shape. An operator
reads it to answer two questions: _what does this journal contain_ and _can I open it_.

| Version | Adds                                                                                 | What it means                                                                             |
| ------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `0001`  | the legacy baseline: the trading journal and its legacy repairs                      | every journal has it; it is the shape a fresh install starts from                         |
| `0002`  | trade projections: identities, revisions, memberships, evidence                      | the journal's own memory of how it grouped fills into trades                              |
| `0003`  | the durable runtime: outbox, deliveries, jobs, the worker lease                      | the journal can record a change and hand it to a worker                                   |
| `0004`  | observations, their evidence links and the seed checkpoints                          | the journal's own conclusions about the trades, and whether it may re-derive them         |
| `0005`  | the background runtime: runs, policies, budget reservations                          | the background AI attempts and the daily allowance they consume                           |
| `0006`  | knowledge and scheduling: sources, hypotheses, patterns, schedules                   | what the journal concluded about your own notes, and when a schedule is due               |
| `0007`  | the experience layer: workflows, transitions, commands, opportunities, conversations | the interactions you still have open                                                      |
| `0008`  | the revision-bound AI insight                                                        | one generated review question per source revision, bound to the revision it was made from |

```sql
-- The history of this journal.
SELECT version, name, applied_at FROM journal_migrations ORDER BY version;
```

The ledger holds the checksum of the source each migration was applied from. A row whose checksum
no longer matches the build's manifest means the journal was migrated by a **different** source:
stop and report it, never "fix" the journal.

## Backing up before an upgrade

Stop the writers first. Two of them write to the journal:

1. the **HTTP writer** — the web process;
2. the **worker** — the separate consumer process.

Stop the journal supervisor, which owns both: it forks the web process and the worker, and it
restarts a worker that dies on its own. In production that is the `pnpm start` command; in
development it is `pnpm --filter web dev:journal`, which starts the web process but no worker
unless `--worker enabled` is passed.

The worker's lease tells you whether it is running: `intelligence_worker_lease.lease_until` in the
future means a worker holds it. The lease row outlives the stopped worker — nothing deletes it,
and it stays valid for up to `WORKER_LEASE_MS` (30 seconds) — so the backup is refused until
`lease_until` is in the past. Wait and run it again; never delete the row.

The journal's own backup command takes the backup safely. From the repository root:

```bash
JOURNAL_DATA_DIR=/data/trade-journal \
pnpm --filter web intelligence:operations backup \
  --source /data/trade-journal \
  --destination /backups/journal-2026-11-16 \
  --acknowledge-quiescence
```

It writes a consistent snapshot with SQLite's `VACUUM INTO`, copies the key material beside it
and records a key probe in a manifest. It refuses a journal whose worker lease is still live, and
it refuses a journal whose key comes from `JOURNAL_SECRET`, because that key cannot travel with
the backup. The destination is created if it does not exist, and is refused if it already holds a
journal.

A copy of the **whole data directory** — the database, its WAL/SHM sidecars, the key file
(`.secret`) and the deletion ledger (`purge-ledger.json`) — is a manual copy, not a backup: it
carries no manifest, so the restore command below refuses it. Never copy only `journal.db` while
the WAL is live: the sidecar holds committed data that has not been checkpointed yet. Restore a
manual copy by hand, or take the backup with the command above.

Verify a restore in scratch storage before you need it: the restore command verifies the copy
before anything migrates it, and `PRAGMA integrity_check`, `PRAGMA foreign_key_check` and a
credential decryption with **synthetic** credentials — never the operator's real ones — prove the
key material travels.

See [Intelligence operations](./intelligence-operations.md) for the whole procedure, including how
a restored journal is promoted.

## Commands

```bash
pnpm --filter web migrations:build                  # regenerate the checksum artifact
pnpm --filter web migrations:check                  # fail when the artifact is stale
JOURNAL_DATA_DIR=<journal directory> \
pnpm --filter web intelligence:operations backup \
  --source <journal directory> --destination <backup directory> --acknowledge-quiescence
pnpm --filter web intelligence:operations restore \
  --source <backup directory> --destination <scratch directory>
pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts \
  apps/web/tests/db-concurrent-init.test.ts \
  apps/web/tests/db-connection-lifecycle.test.ts \
  apps/web/tests/execution-storage.test.ts
```

`JOURNAL_DATA_DIR` is required by the backup: it names the journal whose key material travels
with the backup. The restore does not need it.

See also: [ADR 0007 — durable SQLite worker and migrations](../decisions/0007-durable-sqlite-worker-and-migrations.md).
