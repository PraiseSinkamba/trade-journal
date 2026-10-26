## Verdict: PASS

## Reviewer Report — Phase 02 versioned migration runner

Target: the Phase 02 diff in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal-p02`
(base `e5352ac`, phase branch `codex/ai-native-journal-p02`).

Two independent read-only reviews were run against the phase diff: a **specification-compliance
review** (phase guide, phase plan, contract review §3/§6, ADR 0007) and a **code-quality,
correctness and durability review** (algorithm, concurrency, failure modes, baseline fidelity,
manifest determinism, test quality, style). Both were run before the fixes below; the fixes were
then re-verified with the phase's full gate set.

### Findings and resolutions

- [PASS] **Ledger DDL — resolved.** The runner shipped `CREATE TABLE IF NOT EXISTS journal_migrations (…)`
  where the phase guide requires the DDL verbatim. `apps/web/src/db/migrations.ts` now exports the
  guide's verbatim `LEDGER_TABLE_SQL` (used by the runner, which creates the table only when it is
  absent) and a separate `LEDGER_TABLE_SQL_SNAPSHOT` with the `IF NOT EXISTS` guard for
  `BOOTSTRAP_SQL`, which may be executed against a journal that already has the ledger. The
  column definitions, types and `CHECK (version > 0)` are unchanged.
- [PASS] **Duplicate migration version — fixed.** `apps/web/scripts/build-migration-manifest.mjs`
  keyed the artifact by version, so two files with the same `NNNN` prefix silently overwrote each
  other. The generator now throws on a duplicate version instead of dropping a migration.
- [PASS] **Manifest name not enforced — fixed.** The manifest's `name` was never read, so a
  renamed migration file was invisible. `buildRegistry` now rejects a manifest entry whose name
  differs from the registered migration (`registry-invalid`).
- [PASS] **Manifest format version — fixed.** `formatVersion` is now validated against the
  supported version and fails with `registry-invalid` instead of being silently mis-parsed.
- [PASS] **Stale-artifact check — fixed.** `--check` parsed the committed artifact inside a
  per-entry filter, so a malformed artifact raised a raw `SyntaxError`; it is now parsed once,
  guarded, and reports the usual "out of date" message.
- [PASS] **Parity contract — fixed.** The parity test compared column defaults for a fixture whose
  upgraded journal necessarily carries `DEFAULT 0` on the `NOT NULL` bounds columns (SQLite cannot
  add a `NOT NULL` column to a populated table without a default). The test now compares the
  freshly migrated schema with the declared final schema **exactly**, compares the upgraded
  journals without column defaults, and asserts the one tolerated difference explicitly. The plan
  and `docs/database-migrations.md` state the same contract.
- [PASS] **Canonicalisation rule — fixed.** The test re-implemented the generator's canonical
  rule. The rule is now exported from `build-migration-manifest.mjs` and imported by the test, so
  the artifact is pinned to the source by the same rule the generator uses.
- [PASS] **Leaked connection handle — fixed.** `openJournalDatabase` now closes the SQLite handle
  when the runner refuses the journal, instead of leaving it to the garbage collector.
- [PASS] **Legacy concurrency fixture — fixed.** The `db-concurrent-init.test.ts` legacy fixture
  now drops the migration ledger and the `folders.deleted_at` column, so it is a genuine
  pre-ledger journal and exercises the folders repair under concurrency.
- [PASS] **Documentation claims — fixed.** `docs/database-migrations.md` no longer claims CI runs
  `migrations:check` (the continuous-integration wiring lands with the release-gate phase,
  T-021) and the `checksum-mismatch` recovery now says the checksum artifact must be rebuilt
  from the restored source, not only the source restored.
- [PASS] **Missing migration artifact — addressed.** `apps/web/src/db/migration-checksums.json`
  is a hard runtime dependency and is committed with the phase. The module comment no longer
  claims a missing *file* surfaces as a `MigrationError`: a missing file fails at module
  resolution, a missing *entry* fails with `missing-manifest`.
- [PASS] **CSV-bounds self-healing — verified, no change.** The materialisation
  (`UPDATE market_csv_datasets … WHERE bar_count = 0`) now runs once, inside migration 0001,
  instead of on every startup. The only writer of that table,
  `apps/web/src/server/market-data/csv.ts:87-89`, always sets `barCount`, `firstTime` and
  `lastTime` explicitly, so the one-time backfill covers every row that can exist.

### Accepted, with reasons

- [PASS] **`inspectMigrations` has no production consumer.** It is a required contract of the
  phase guide, so it stays exported; the phase report lists it as a diagnostic seam for the
  later phases.
- [PASS] **The root `pnpm typecheck` was not run.** It reaches the `desktop` workspace and fails
  with a pre-existing, host-only error on a git-ignored generated icon. The application
  typecheck (`pnpm --filter web typecheck`) and both package typechecks pass.

### Evidence after the fixes

| Check | Result |
| --- | --- |
| `pnpm exec vitest run` (9 files: the 4 required + 4 `BOOTSTRAP_SQL` fixture regressions + the import-graph guard) | 9 files passed, 60 tests passed, 1 skipped |
| `pnpm --filter web typecheck` | exit 0 |
| `pnpm --filter @luxalgo/journal-core typecheck` / `… journal-importers typecheck` | exit 0 |
| `pnpm --filter web migrations:check` | `migration-checksums.json is up to date.` |
| `node scripts/check-licenses.mjs` | `Dependency licenses OK.` |
| `pnpm exec prettier --check` (every file this phase touched) | `All matched files use Prettier code style!` |
| `pnpm --filter web build` (webpack) | exit 0 — the `with { type: "json" }` import and the `.ts`-extension imports bundle correctly |
| `git diff --check` | clean |

### Summary

13 PASS, 0 FAIL, 0 BLOCK

Every Critical and Important finding raised against this phase is fixed and re-verified. The
phase's formatting, type, licence, manifest and test gates are green, and the frozen baseline is
byte-identical to the bootstrap DDL it replaces.
