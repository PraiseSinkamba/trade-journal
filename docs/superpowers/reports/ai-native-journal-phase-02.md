# Phase 02 — Versioned migration runner and legacy baseline

> Phase report for the AI-native journal modernization. Source of truth: the phase guide
> (`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), the phase plan
> (`docs/superpowers/plans/ai-native-journal/phase-02.md`), the contract review
> (`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md` §3, §6)
> and ADR 0007.

## 1. Phase ID, baseline, scope

| Item                     | Value                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Phase                    | 02 — Versioned migration runner and legacy baseline                                                |
| Milestone                | M0                                                                                                 |
| Stable task / native IDs | T-002 / `task_4424551d3c6c` (`ctx_07e3d196e0d4`)                                                   |
| Branch                   | `codex/ai-native-journal-p02` (child of the feature worktree)                                      |
| Base SHA                 | `e5352acd39c1d03f240b4b797c9ca021d97679f0` (feature HEAD after Phase 01)                           |
| Plan commit              | `919a9f4` — `docs: add Phase 02 migration runner plan`                                             |
| Implementation tip       | `cf51fe8cb1f83986a9bbbfd8f13e52bdc6e80658` — `feat: add versioned intelligence storage migrations` |
| Integration destination  | `codex/ai-native-journal` (not merged by this worker)                                              |

**Scope completed.** A versioned, checksummed migration runner with one frozen legacy baseline
migration replaces the "run the latest DDL at startup" schema setup. Startup now applies
migrations through the runner, records every applied migration in a `journal_migrations` ledger
with the SHA-256 of its immutable source, and refuses a journal whose history it cannot validate
**before** writing anything. A fresh journal and an upgraded legacy journal converge on the same
schema.

**Scope remaining.** None for this phase. Phase 03 (projection identity, migration 0002) is a
separate assignment and was not started.

**Schema allocation used.** `0001-legacy-baseline.ts` plus the `journal_migrations` ledger. No
identity, event, job, observation, AI or workflow table was created.

## 2. Changed files and exported interfaces

| File                                                   | Change                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `apps/web/src/db/migrations.ts`                        | **new** — registry, history validation, application                           |
| `apps/web/src/db/migrations/0001-legacy-baseline.ts`   | **new** — frozen baseline DDL and the guarded legacy repairs                  |
| `apps/web/src/db/migration-checksums.json`             | **new** — generated checksum artifact (committed)                             |
| `apps/web/scripts/build-migration-manifest.mjs`        | **new** — deterministic manifest generator with `--check`                     |
| `apps/web/src/db/bootstrap.ts`                         | startup applies migrations; `BOOTSTRAP_SQL` kept as the final-schema snapshot |
| `apps/web/src/db/schema.ts`                            | typed `journalMigrations` mirror                                              |
| `apps/web/tests/intelligence-migrations.test.ts`       | **new** — 14 runner invariant cases                                           |
| `apps/web/tests/db-concurrent-init.test.ts`            | asserts the ledger after concurrent startup                                   |
| `apps/web/package.json`                                | `migrations:build` and `migrations:check` scripts                             |
| `apps/web/tsconfig.json`                               | `allowImportingTsExtensions: true` (see deviation 2)                          |
| `docs/database-migrations.md`                          | **new** — authoring, commands, compatibility, recovery                        |
| `docs/superpowers/plans/ai-native-journal/phase-02.md` | phase plan (committed first, amended with the implementation)                 |
| `.omp/reviewer-report.md`                              | Phase 02 reviewer verdict                                                     |

**Exported interfaces** (`apps/web/src/db/migrations.ts`):

```ts
export interface JournalMigration {
  version: number;
  name: string;
  checksum: string; // deterministic SHA-256 of immutable migration content
  up(sqlite: Database.Database): void;
}
export type MigrationStatus = Readonly<{
  currentVersion: number;
  pendingVersions: readonly number[];
}>;
export function inspectMigrations(sqlite: Database.Database): MigrationStatus;
export function applyMigrations(sqlite: Database.Database): void;
```

Additive exports required by the phase plan: `MigrationFailure`, `MigrationError` (with a
machine-readable `reason`), `AppliedMigrationRow`, `JournalMigrationSource`,
`validateMigrationHistory` (pure, exported so every rejection branch is directly testable),
`LEDGER_TABLE_SQL` (the phase guide's verbatim DDL) and `LEDGER_TABLE_SQL_SNAPSHOT` (the
re-runnable copy used by the final-schema snapshot).

**Compatibility preserved.** The diff touches no file under `apps/web/src/server/`,
`apps/web/src/app/`, `apps/web/src/components/` or `packages/`. Execution hashing, trade-key
construction, annotations, encrypted credentials, cTrader sync and every import/AI response
contract are untouched. The frozen baseline DDL is **byte-identical** to the bootstrap DDL it
replaces (verified by comparing `BASELINE_SQL` with `git show e5352ac:apps/web/src/db/bootstrap.ts`),
and the guarded legacy repairs run in the same order with the same SQL, so a live journal sees
exactly the schema it saw before.

## 3. Migration, schema and rollback impact

**Migration 0001 — `legacy-baseline`** (frozen, checksum
`f9d7d16ebbd535833124a0782ab3b6ebced8b23f19d3c0199f0b57463cf66e25` at the time of writing; the
authoritative value is `apps/web/src/db/migration-checksums.json`).

- Creates every journal table that existed before the runner (`accounts`, `executions`, `trades`,
  `market_csv_datasets`, `trade_excursions`, `journal_days`, `folders`, `notes`, `playbooks`,
  `settings`, `attachments`, `note_templates`, `trade_rule_checks`, `progress_rules`,
  `progress_checks`, `missed_trades`, `prop_accounts`, `prop_entries`, `prop_receipts`,
  `prop_audit`, `import_sources`, `import_source_aliases`, `import_batches`) and the five system
  folder seeds.
- Applies the guarded legacy repairs, in the pre-existing order: `folders.deleted_at`,
  `accounts.ibkr_sync_time_zone`, `executions.import_metadata_json`, then
  `market_csv_datasets.bar_count` / `first_time` / `last_time`, then the CSV-bounds
  materialisation.
- **New table (runner-owned):** `journal_migrations` — `version INTEGER PRIMARY KEY CHECK (version > 0)`,
  `name TEXT NOT NULL`, `checksum TEXT NOT NULL`, `applied_at INTEGER NOT NULL`. No other table,
  column, index or constraint changed.

**Upgrade results.** An empty journal and a pre-ledger journal both run the baseline and record
version 1. An older journal that predates the nullable columns and the CSV-bounds columns
converges on the same tables, columns, foreign keys and indexes as a fresh journal. The one
documented difference: SQLite can only add a `NOT NULL` column to a populated table when the
column carries a default, so an upgraded journal that predates the CSV-bounds columns carries
`DEFAULT 0` on those three columns where a fresh journal carries none. The test asserts that
difference explicitly instead of hiding it.

**Backup and rollback impact.** The migration is additive: no table, column, key, hash or
credential is dropped or rewritten. Rollback means deploying the previous binary with the extra
`journal_migrations` table retained, or restoring a verified full backup of the data directory
(database **and** WAL/SHM sidecars **and** the key file) — the old binary simply ignores the extra
table. There is no automatic destructive down migration. The procedure is documented in
`docs/database-migrations.md`.

## 4. Commands actually run

All commands were run in
`E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal-p02` on Node v24.20.0, pnpm 11.0.8,
against the implementation tip `cf51fe8` (the test runs below were re-run after the review fixes
on the same tree; the tree state was identical apart from the fixes themselves).

| Command                                                                                                                                                                                                 | Exit | Result                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts` (red run, before any production file existed)                                                                                     | 1    | `Error: Cannot find module '../src/db/migrations'` — the missing-runner failure. Recorded as the phase's red evidence.          |
| `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/db-concurrent-init.test.ts apps/web/tests/db-connection-lifecycle.test.ts apps/web/tests/execution-storage.test.ts` | 0    | 4 files, 35 tests passed (18.1 s)                                                                                               |
| `pnpm exec vitest run` (the 4 required files + `folder-delete`, `history-import`, `ibkr-timezone-migration`, `market-csv-migration`, `intelligence-boundaries`)                                         | 0    | 9 files, 60 tests passed, 1 skipped (19.6 s)                                                                                    |
| `pnpm --filter web typecheck`                                                                                                                                                                           | 0    | `next typegen` + `tsc --noEmit` clean (35.2 s)                                                                                  |
| `pnpm --filter @luxalgo/journal-core typecheck`                                                                                                                                                         | 0    | clean                                                                                                                           |
| `pnpm --filter @luxalgo/journal-importers typecheck`                                                                                                                                                    | 0    | clean                                                                                                                           |
| `pnpm --filter web migrations:check`                                                                                                                                                                    | 0    | `migration-checksums.json is up to date.`                                                                                       |
| `pnpm --filter web migrations:build`                                                                                                                                                                    | 0    | artifact regenerated deterministically                                                                                          |
| `node scripts/check-licenses.mjs`                                                                                                                                                                       | 0    | `Dependency licenses OK.`                                                                                                       |
| `pnpm exec prettier --check` (every file this phase touched)                                                                                                                                            | 0    | `All matched files use Prettier code style!`                                                                                    |
| `pnpm --filter web build` (webpack, `JOURNAL_DATA_DIR` pointed at a disposable directory)                                                                                                               | 0    | production build succeeded (716 s) — proves the `with { type: "json" }` import and the `.ts`-extension imports bundle correctly |
| `git diff --check`                                                                                                                                                                                      | 0    | clean                                                                                                                           |

**Not run, and why.**

- The root `pnpm typecheck` was not run: it reaches the `desktop` workspace and fails with a
  pre-existing, host-only error on a git-ignored generated icon. It is blocked evidence for the
  phase verification owner, never a Phase 02 finding. The application and both package
  typechecks pass.
- The full `pnpm test` suite was not run: the coordinator is the designated phase verification
  owner for that gate.
- No Docker, Tauri or packaged-deployment check was run: this phase changes no deployment
  target, and those gates belong to later phases.

## 5. Deviations, review findings and unresolved risks

**Deviations.**

1. `apps/web/tsconfig.json` is outside the phase guide's file list. It gained one compiler
   option, `allowImportingTsExtensions: true`, because the new relative imports inside
   `apps/web/src/db/` carry an explicit `.ts` extension: `apps/web/tests/db-concurrent-init.test.ts`
   spawns child processes that load the real TypeScript modules with Node's own type stripping,
   and Node's ESM resolver does not search for extensions. The option changes no runtime
   behaviour. The plan was amended (design decisions 9 and 10) before the implementation commit.
2. The phase guide's ledger DDL is used **verbatim** by the runner, which creates the table only
   when it is absent. The final-schema snapshot embeds a second, re-runnable copy with the
   `IF NOT EXISTS` guard, because `BOOTSTRAP_SQL` may be executed against a journal that already
   has the ledger (`apps/web/tests/folder-delete.test.ts` does exactly that).
3. The one-time CSV-bounds materialisation replaced a repair that used to run on **every**
   startup. The only writer of that table (`apps/web/src/server/market-data/csv.ts:87-89`) always
   sets `barCount`, `firstTime` and `lastTime`, so the one-time backfill covers every row that
   can exist.

**Review findings raised against this phase and how they were resolved.** Two independent
read-only reviews were run: a specification-compliance review (phase guide, phase plan, contract
review §3/§6, ADR 0007) and a code-quality/correctness/durability review. The full list is in
`.omp/reviewer-report.md`. Every Critical and Important finding is fixed and re-verified:

- _Critical — the ledger DDL was not the phase guide's verbatim DDL._ Fixed: the runner now uses
  the verbatim DDL and creates the table only when absent.
- _Important — the manifest generator silently dropped a migration when two files claimed the
  same version._ Fixed: the generator throws on a duplicate version.
- _Important — the manifest's `name` was never read, so a renamed migration file was invisible._
  Fixed: the registry rejects a manifest entry whose name differs from the registered migration.
- _Important — `migrations:check` was not wired into CI while the documentation claimed it was._
  Fixed by correcting the documentation: the continuous-integration wiring belongs to the
  release-gate phase (T-021), and the command is exposed for it. `.github/workflows/ci.yml` was
  not edited, because the integration plan reserves CI edits for T-020/T-021.
- _Important — the parity test contradicted the documented default exception._ Fixed: the fresh
  schema is compared with the declared final schema exactly, the upgraded journals are compared
  without column defaults, and the one tolerated difference is asserted explicitly.
- _Minor findings fixed:_ the manifest format version is validated; a malformed artifact no
  longer crashes `--check` with a raw `SyntaxError`; the canonicalisation rule is shared between
  the generator and the test instead of duplicated; the SQLite handle is closed when the runner
  refuses a journal; the `db-concurrent-init` legacy fixture is a genuine pre-ledger journal that
  also exercises the folders repair; the `checksum-mismatch` recovery runbook now says the
  artifact must be rebuilt from the restored source.
- _Accepted with reasons:_ `inspectMigrations` has no production consumer yet (it is a required
  contract of the phase guide and a diagnostic seam for later phases); the root `pnpm typecheck`
  was not run (pre-existing host failure, out of scope).

**Unresolved risks.**

- The continuous-integration stale-artifact gate lands with T-021. Until then, a migration
  edited after it was applied could merge without the artifact check firing. The runtime still
  refuses such a journal with `checksum-mismatch`, so the failure is loud at startup, not silent
  data loss. **Does not block Phase 03**, which does not apply a migration to a live journal.
- The phase's own reviewer verdict was written by the implementer from the two independent
  reviews plus the post-fix gate results; the fixes themselves were not re-reviewed by a third
  independent reviewer. **Does not block Phase 03.**
- A journal migrated by a newer application cannot be opened by an older binary. This is the
  intended forward-only behaviour, but it means a rollback needs the backup procedure in
  `docs/database-migrations.md`, not a binary swap alone. **Does not block Phase 03.**

## 6. Next-phase handoff (Phase 03 inputs)

Phase 03 needs, and does not yet have:

- A committed, validated migration 0001 and a working registry/checksum pipeline: migration 0002
  is a new file in `apps/web/src/db/migrations/`, a new entry in `SOURCES`
  (`apps/web/src/db/migrations.ts`), a typed mirror in `apps/web/src/db/schema.ts`, an entry in the
  final-schema snapshot in `apps/web/src/db/bootstrap.ts`, and a regenerated
  `apps/web/src/db/migration-checksums.json` (`pnpm --filter web migrations:build`).
- The frozen baseline is in place: a Phase 03 migration may assume the journal schema is exactly
  `apps/web/src/db/migrations/0001-legacy-baseline.ts` plus the ledger.
- The phase's verification evidence: `docs/superpowers/reports/ai-native-journal-phase-02.md` and
  the reviewer verdict in `.omp/reviewer-report.md`.
- Still with the coordinator, not claimed by this phase: the full `pnpm test` phase gate, the
  serialized phase→feature merge into `codex/ai-native-journal`, and
  `docs/superpowers/reports/ai-native-journal-integration-02.md`.

**Not started here:** Phase 03 (projection identity, migration 0002), and the continuous-
integration wiring of `migrations:check` (T-021).
