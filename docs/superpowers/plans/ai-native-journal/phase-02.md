# Phase 02 — Versioned migration runner and legacy baseline

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Implement only this phase. Do not begin Phase 03.

**Goal:** Replace the "run the latest DDL and hope" startup schema setup with an ordered,
checksummed migration runner that owns a `journal_migrations` ledger, converges an old journal
onto exactly the same schema as a fresh one, and refuses to touch a database whose history it
cannot validate.

**Architecture:** `apps/web/src/db/migrations.ts` owns the registry, the history validation and the
application loop; `apps/web/src/db/migrations/0001-legacy-baseline.ts` owns the frozen legacy DDL
and the guarded legacy repairs; `apps/web/src/db/migration-checksums.json` is the build artifact
that carries the immutable source checksum of every applied migration;
`apps/web/scripts/build-migration-manifest.mjs` generates that artifact deterministically.
`apps/web/src/db/bootstrap.ts` keeps `BOOTSTRAP_SQL` as the _final-schema snapshot_ used by
parity tests and by the existing legacy fixtures, but **startup no longer executes it** — startup
executes the runner.

**Tech Stack:** Existing TypeScript (strict, `noUncheckedIndexedAccess`), Next.js 15, Drizzle +
better-sqlite3, Vitest, Node `node:crypto`. **No new dependency.** Schema allocation: **0001 +
ledger** only. No identity, event, job, observation, AI or workflow table is created here.

---

## Global Constraints

These bind every task in this phase. Copy them verbatim into any review dispatch.

- **Schema allocation: `0001-legacy-baseline.ts` + the `journal_migrations` ledger.** Nothing
  else. No `trade_identities`, `domain_outbox`, `intelligence_jobs`, `intelligence_observations`,
  `knowledge_*`, `intelligence_workflows` or any other Phase 03+ table may appear.
- **The ledger is owned by the runner**, not by migration 0001. Its DDL is the phase guide's,
  verbatim.
- **Migrations are immutable and forward-only.** Once a migration is applied, its source file and
  its checksum are frozen. Never renumber, never edit, never delete an applied migration. There is
  no automatic destructive down migration.
- **Baseline SQL is frozen independently of `BOOTSTRAP_SQL`.** `BOOTSTRAP_SQL` is the evolving
  final-schema snapshot; `0001-legacy-baseline.ts` is the frozen baseline. A parity test proves
  they still agree.
- **No new dependency.** No manifest dependency change and no `pnpm-lock.yaml` change;
  `node scripts/check-licenses.mjs` must still report OK. No ADR is required because nothing is
  added to the dependency tree.
- **All migration callbacks are synchronous.** No network call, no Promise, no worker invocation,
  no provider call inside a write transaction.
- **Startup must not run the latest bootstrap DDL before migration validation.** An unsupported
  history fails before any application-schema write.
- **Preserve** execution hashes, derived trade keys, annotations, cTrader sync, all three AI
  provider categories (Anthropic, OpenAI, OpenAI-compatible), encrypted credentials, and every
  existing import and AI response contract.
- **Do not weaken an expected behaviour to make a test pass.** Do not delete or relax an existing
  assertion to accommodate this phase.
- **Node ≥ 22, pnpm 11.0.8, frozen lockfile.** `pnpm install` is already done; do not reinstall.
- Use a disposable absolute `JOURNAL_DATA_DIR` and scratch databases under the OS temp dir.
  Never use ports 3000/3001. Never touch live trader data.

---

## Contracts (authoritative — implement exactly, do not paraphrase)

From the phase guide (`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`, "Mandatory
early migration phase"), the detailed plan
(`docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md` Task 2) and the contract
review (`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md` §3
and §6):

```ts
// apps/web/src/db/migrations.ts
export interface JournalMigration {
  version: number; // positive, unique, monotonically ordered
  name: string;
  checksum: string; // deterministic SHA-256 of immutable migration content
  up(sqlite: Database.Database): void;
}

export type MigrationStatus = Readonly<{
  currentVersion: number;
  pendingVersions: readonly number[];
}>;

export declare function inspectMigrations(sqlite: Database.Database): MigrationStatus;
export declare function applyMigrations(sqlite: Database.Database): void;
```

Ledger DDL — verbatim from the phase guide:

```sql
CREATE TABLE journal_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
```

**Checksum provenance.** The checksum is a SHA-256 of the _canonical migration source text_,
stored as a build artifact in `apps/web/src/db/migration-checksums.json`. It is **never** derived
from `Function.prototype.toString()`: bundling and transpilation change that text, so a bundled
build would compute a different checksum than the source tree. The runtime reads the artifact; the
build script computes it from the file on disk; CI proves the artifact is not stale.

**Additive exports** (the three required contracts above are unchanged; these are additional and
exist so the history rules are testable without a second migration):

```ts
export type MigrationFailure =
  | "future-version"
  | "noncontiguous-history"
  | "checksum-mismatch"
  | "name-mismatch"
  | "registry-invalid"
  | "missing-manifest";

export class MigrationError extends Error {
  readonly reason: MigrationFailure;
}

export type AppliedMigrationRow = Readonly<{
  version: number;
  name: string;
  checksum: string;
  applied_at: number;
}>;

/** Pure history validation; exported so every rejection branch is directly testable. */
export declare function validateMigrationHistory(
  applied: readonly AppliedMigrationRow[],
  registry: readonly JournalMigration[],
): void;
```

`inspectMigrations` **throws** `MigrationError` for an unsupported history instead of reporting a
misleading status: a future version, a tampered checksum or name, a non-contiguous history or an
invalid registry must fail _before_ writes, not after.

---

## Design decisions (binding — do not reopen)

1. **One immediate transaction for all pending migrations.** Each migration's changes and its
   ledger row commit together; the whole set is one all-or-nothing startup transaction, matching
   the existing `openJournalDatabase` behaviour. A failure never advances the ledger and never
   leaves partial schema behind.
2. **Validate twice: read-only pre-flight, then again inside the immediate lock.** The pre-flight
   rejects an unsupported history without writing anything. Inside the lock the ledger is re-read,
   because a concurrent process may have applied migrations while this process was waiting for the
   write lock; a stale pending list would double-apply.
3. **The runner creates the ledger table itself**, inside the transaction, with
   `CREATE TABLE IF NOT EXISTS`. It is never part of migration 0001.
4. **A pre-ledger database is not "already migrated".** The runner executes baseline 0001's
   idempotent convergence (create tables, guarded `ALTER TABLE` repairs, the CSV-bounds repair) and
   only then records version 1. A database merely _existing_ is never a reason to mark 0001
   applied.
5. **An empty database runs the same baseline migration** as a pre-ledger database, so a fresh
   install and an upgraded install converge on the same schema.
6. **`BOOTSTRAP_SQL` stays as the final-schema snapshot** and keeps working as a standalone
   script for the four existing fixtures (`db-concurrent-init`, `folder-delete`, `history-import`,
   `ibkr-timezone-migration`). It gains the ledger DDL at the end so the fresh-vs-snapshot parity
   check is exact. Startup does **not** execute it.
7. **The baseline SQL is a frozen copy**, not an import of `BOOTSTRAP_SQL`. The baseline must stay
   byte-stable while `BOOTSTRAP_SQL` evolves with later phases. A parity test is the guard
   against drift.
8. **The registry binds checksums from the artifact**, not from the source at runtime. The runtime
   never reads the migration source file: a packaged build has no source tree.

---

## File ownership (exclusive — this phase has one implementation writer)

| Path                                                     | Action                |
| -------------------------------------------------------- | --------------------- |
| `apps/web/src/db/migrations.ts`                          | create                |
| `apps/web/src/db/migrations/0001-legacy-baseline.ts`     | create                |
| `apps/web/src/db/migration-checksums.json`               | create (generated)    |
| `apps/web/scripts/build-migration-manifest.mjs`          | create                |
| `apps/web/src/db/bootstrap.ts`                           | modify                |
| `apps/web/src/db/schema.ts`                              | modify                |
| `apps/web/tests/intelligence-migrations.test.ts`         | create                |
| `apps/web/tests/db-concurrent-init.test.ts`              | modify                |
| `apps/web/package.json`                                  | modify (scripts only) |
| `docs/database-migrations.md`                            | create                |
| `docs/superpowers/plans/ai-native-journal/phase-02.md`   | this file             |
| `docs/superpowers/reports/ai-native-journal-phase-02.md` | phase report          |

**Parallel candidate, conditional only.** The phase guide allows a documentation writer to run
independently once the migration contract is fixed. The coordinator has **not** committed an exact
disjoint split (child IDs, paths, interface SHA, dependencies, tests, merge order), so this phase
runs with **one implementation writer**. Reviews are read-only and may be delegated.

Read-only for this phase: `packages/**`, `apps/web/src/server/**`, `apps/web/src/app/**`,
`apps/web/src/db/{connection,transaction,index}.ts`, `apps/web/src/db/connection.ts`'s public
surface, `docs/decisions/**`, `.github/workflows/**` (CI edits belong to T-020/T-021).

---

## Execution order (the plan's test-first sequence is binding)

```
commit plan ─→ write the failing test file ─→ RED RUN (one command) ─→ implement ─→ GREEN RUN ─→ gates ─→ docs ─→ reviews ─→ report
```

0. **Commit this plan first**, before any implementation:
   `git add docs/superpowers/plans/ai-native-journal/phase-02.md && git commit -m "docs: add Phase 02 migration runner plan"`.
1. Write the failing test file. No production file is touched yet.
2. Run the single red command and record its output as the phase's red evidence.
3. Implement the runner, the baseline, the manifest script and the artifact.
4. Wire `bootstrap.ts`, `schema.ts`, `apps/web/package.json` and `db-concurrent-init.test.ts`.
5. Re-run the targeted command and the typecheck.

---

## Step 1 — The failing test file

Create `apps/web/tests/intelligence-migrations.test.ts`. It must cover every case the phase guide
lists. Use `mkdtempSync` scratch files under the OS temp dir; never a live journal directory.

**Fixtures.** Build legacy databases from `BOOTSTRAP_SQL` and then shape them with `ALTER TABLE` /
`DROP TABLE`, instead of string surgery:

- _empty_ — a fresh file, no tables.
- _pre-ledger current_ — `BOOTSTRAP_SQL` then `DROP TABLE journal_migrations`.
- _older missing-column_ — `BOOTSTRAP_SQL` then
  `ALTER TABLE accounts DROP COLUMN ibkr_sync_time_zone`,
  `ALTER TABLE executions DROP COLUMN import_metadata_json`,
  `ALTER TABLE market_csv_datasets DROP COLUMN bar_count`,
  and `DROP TABLE journal_migrations`.

**Cases.**

1. _Empty database_ — `applyMigrations` creates every journal table and writes exactly one ledger
   row (`version 1`, the registry name, the registry checksum, an integer `applied_at`).
2. _Pre-ledger current database_ — the baseline converges and the ledger records version 1.
3. _Older missing-column database_ — the guarded repairs restore `ibkr_sync_time_zone`,
   `import_metadata_json`, `bar_count`, `first_time` and `last_time`, and the ledger records
   version 1.
4. _Twice-applied is a no-op_ — a second `applyMigrations` changes nothing: the ledger still has
   exactly one row, and `inspectMigrations` reports `{ currentVersion: 1, pendingVersions: [] }`.
5. _Inspect before applying_ — `inspectMigrations` on an empty database reports
   `{ currentVersion: 0, pendingVersions: [1] }` and writes nothing.
6. _Concurrent processes_ — spawn several child processes that all open the same fresh database at
   the same instant; every child must succeed, and the ledger must contain exactly one row. (The
   existing `db-concurrent-init.test.ts` covers the same ground through the real bootstrap; this
   case covers the runner directly.)
7. _Rollback after injected failure_ — pre-create the ledger table and a trigger that aborts the
   insert of version 1. `applyMigrations` must throw, the ledger must still be empty, and none of
   the baseline's tables may exist afterwards: the schema changes roll back with the ledger row.
8. _Tampered checksum_ — rewrite the ledger row's `checksum`; `applyMigrations` must throw a
   `MigrationError` with reason `checksum-mismatch` and must not change the schema.
9. _Tampered name_ — rewrite the ledger row's `name`; reason `name-mismatch`.
10. _Missing applied version / non-contiguous history_ — `validateMigrationHistory` with a
    synthetic registry of three migrations and an applied history of `{1, 3}` must throw
    `noncontiguous-history`.
11. _Unknown future version_ — a ledger row with a version above the registry maximum must throw
    `future-version`, and the database must be unchanged (no new tables, ledger untouched).
12. _Registry integrity_ — `validateMigrationHistory` rejects a registry whose versions are not
    positive, unique and contiguous from 1 (`registry-invalid`).
13. _Fresh and legacy parity_ — the schema fingerprint of the upgraded legacy database equals the
    schema fingerprint of the freshly migrated database, and both equal the fingerprint of a
    database built from `BOOTSTRAP_SQL`. The fingerprint lists every user table with its columns
    (name, type, not-null, default) and every index (name, table, unique, columns).
14. _Financial, credential and annotation bytes are unchanged_ — seed a legacy database with an
    account (including `credentials_enc`), executions (including `content_hash`), a trade (including
    `notes`, `tags_json`, `rating`, `playbook_id`) and a note; capture every row byte-for-byte
    before the upgrade and assert the rows are identical afterwards. No legacy key or hash is
    rewritten.
15. _Integrity and foreign keys_ — after the upgrade, `PRAGMA integrity_check` is `ok` and
    `PRAGMA foreign_key_check` returns no rows.
16. _Checksum stability_ — the registry checksum for version 1 equals the SHA-256 of the
    canonical source text of `apps/web/src/db/migrations/0001-legacy-baseline.ts`, and equals the
    checksum recorded in `apps/web/src/db/migration-checksums.json`. The canonical form is the
    source with CRLF normalised to LF, trailing whitespace stripped per line and exactly one
    trailing newline — the same rule the build script applies, so the value cannot drift with the
    checkout's line endings.

Do **not** run this file before the implementation lands; the single red run happens once, after
the file exists (see "Red run").

---

## Step 2 — The frozen baseline

Create `apps/web/src/db/migrations/0001-legacy-baseline.ts`.

- Export the baseline DDL as a frozen string (`BASELINE_SQL`) that is a copy of the current
  `BOOTSTRAP_SQL` **without** the ledger DDL (the ledger is runner-owned).
- Export a `JournalMigration`-shaped object with `version: 1`, `name: "legacy-baseline"` and an
  `up(sqlite)` that, in this order:
  1. executes `BASELINE_SQL`;
  2. applies the guarded legacy repairs, in the order the current `migrate()` uses:
     `folders.deleted_at`, `accounts.ibkr_sync_time_zone`,
     `executions.import_metadata_json`, then `market_csv_datasets.bar_count`,
     `first_time`, `last_time` (each `NOT NULL DEFAULT 0`);
  3. materialises the CSV bounds with the existing
     `UPDATE market_csv_datasets SET bar_count = json_array_length(bars_json), first_time = …,
last_time = … WHERE bar_count = 0` repair.
- The `hasColumn` helper moves here. It is the only place that may inspect `table_info`.
- The file must not import from `../bootstrap` — the baseline is frozen and independent.

---

## Step 3 — The runner

Create `apps/web/src/db/migrations.ts`.

- Import the baseline migration module and the checksum artifact
  (`import checksumManifest from "./migration-checksums.json"`). `resolveJsonModule` is already
  enabled in `tsconfig.base.json`.
- Build the registry lazily and memoised, so a stale artifact surfaces as a `MigrationError` from
  `applyMigrations`/`inspectMigrations` with an actionable message — not as a module-load crash.
  The registry binds each migration's `checksum` from the artifact and fails with
  `missing-manifest` when an artifact entry is absent.
- `readLedger(sqlite)` — read-only. Returns `[]` when `journal_migrations` does not exist.
- `validateMigrationHistory(applied, registry)` — the pure rules described above.
- `inspectMigrations(sqlite)` — read-only; returns `{ currentVersion, pendingVersions }`.
- `applyMigrations(sqlite)` — read-only pre-flight validation, then
  `sqlite.transaction(() => { … }).immediate()` that re-reads and re-validates the ledger inside
  the lock, creates the ledger table if missing, and applies each pending migration with its
  ledger insert inside the same transaction.
- The ledger insert writes `applied_at` as epoch milliseconds.

---

## Step 4 — The manifest script and artifact

Create `apps/web/scripts/build-migration-manifest.mjs` and generate
`apps/web/src/db/migration-checksums.json`.

- The script scans `apps/web/src/db/migrations/*.ts`, parses the version and name from the
  `NNNN-name.ts` file name, canonicalises the source text and writes the SHA-256 hex.
- Output is deterministic: sorted by version, `JSON.stringify(manifest, null, 2)` plus a trailing
  newline.
- `--check` regenerates in memory and exits non-zero when the committed artifact differs. It
  prints the file names whose checksum changed.
- `apps/web/package.json` gains two scripts:
  `"migrations:build": "node scripts/build-migration-manifest.mjs"` and
  `"migrations:check": "node scripts/build-migration-manifest.mjs --check"`.
- Run `pnpm --filter web migrations:build` once after the baseline file is final, and commit the
  generated artifact.

---

## Step 5 — Wiring

- `apps/web/src/db/bootstrap.ts`: keep `BOOTSTRAP_SQL` (append the ledger DDL at the end, imported
  from the runner module so both spellings are identical), delete `migrate()` and `hasColumn()`,
  and make `openJournalDatabase` call `applyMigrations(sqlite)` inside the existing
  `retryWhileBusy` guard. The WAL pragma, `foreign_keys = ON` and the busy-retry policy are
  unchanged.
- `apps/web/src/db/schema.ts`: add the typed `journalMigrations` table (`version`, `name`,
  `checksum`, `appliedAt`). It is a mirror of the raw DDL for typed access; the runner owns the
  table.
- `apps/web/tests/db-concurrent-init.test.ts`: after the concurrent open, assert the ledger holds
  exactly one row for version 1 with the registry checksum, and that the legacy round still
  converges.

---

## Red run (binding — the ONLY pre-implementation red run)

- [ ] Run: `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts`
      Expected: FAIL — the runner module does not exist yet. Record the exact output.

---

## Verification (record exact output in the phase report)

```bash
pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts \
  apps/web/tests/db-concurrent-init.test.ts \
  apps/web/tests/db-connection-lifecycle.test.ts \
  apps/web/tests/execution-storage.test.ts
pnpm --filter web typecheck
pnpm --filter web migrations:check
node scripts/check-licenses.mjs
pnpm exec prettier --check <every file this phase touched>
```

The regression targets `apps/web/tests/{folder-delete,history-import,ibkr-timezone-migration}.test.ts`
use `BOOTSTRAP_SQL` to build legacy fixtures and must also pass unchanged — run them as part of the
targeted command above or in a second command, and record which.

Do not run the full `pnpm test` suite: the coordinator appoints the phase verification owner for
that gate.

---

## Stop condition

Phase 02 is done when **all** of the following hold.

**Implementation and tests**

- [ ] The red run was executed before any production edit and its failure output is recorded.
- [ ] The four targeted test files pass.
- [ ] The three `BOOTSTRAP_SQL` fixture regression files pass unchanged.
- [ ] `pnpm --filter web typecheck` passes.
- [ ] `pnpm --filter web migrations:check` exits 0 (the committed artifact matches the sources).
- [ ] `node scripts/check-licenses.mjs` reports OK (no new dependency).
- [ ] `pnpm exec prettier --check` reports no violation in the files this phase touched.
- [ ] `docs/database-migrations.md` documents authoring, the commands, compatibility and recovery.

**Review**

- [ ] A fresh spec-compliance review and a fresh code-quality review of this phase's diff have
      run, and every Critical or Important finding is fixed and re-reviewed clean.
- [ ] The repo's reviewer gate is satisfied: `.omp/reviewer-report.md` records this phase's
      verdict as `## Verdict: PASS`.

**Report**

- [ ] `docs/superpowers/reports/ai-native-journal-phase-02.md` is written and committed, with the
      six items the phase guide requires.
- [ ] The report states the source/base SHA and the tip SHA of this phase's commits.
- [ ] The report records the gates that remain with the coordinator: the full `pnpm test` phase
      gate, the serialized phase→feature merge, and
      `docs/superpowers/reports/ai-native-journal-integration-02.md`.

**Then stop.** Phase 03 (projection identity) is a separate assignment. Do not merge to
`codex/ai-native-journal`, push, or open a PR — the coordinator owns the integration lock.
