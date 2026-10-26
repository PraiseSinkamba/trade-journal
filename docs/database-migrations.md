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

Stop the HTTP and worker writers first, then copy the **whole** data directory — the database,
its WAL/SHM sidecars, the key file and the attachments. Never copy only `journal.db` while the
WAL is live; the sidecar holds committed data that has not been checkpointed yet. Verify a
restore in scratch storage with `PRAGMA integrity_check`, `PRAGMA foreign_key_check` and a
credential decryption.

## Commands

```bash
pnpm --filter web migrations:build                  # regenerate the checksum artifact
pnpm --filter web migrations:check                  # fail when the artifact is stale
pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts \
  apps/web/tests/db-concurrent-init.test.ts \
  apps/web/tests/db-connection-lifecycle.test.ts \
  apps/web/tests/execution-storage.test.ts
```

See also: [ADR 0007 — durable SQLite worker and migrations](../decisions/0007-durable-sqlite-worker-and-migrations.md).
