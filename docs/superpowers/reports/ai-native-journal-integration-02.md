# AI-native journal — Phase 02 integration report

**Phase:** 02 — Versioned migration runner and legacy baseline
**Stable task:** T-002 · **native task:** `task_4424551d3c6c` · **dispatch:** `ctx_07e3d196e0d4`
**Source branch:** `codex/ai-native-journal-p02`
**Destination branch:** `codex/ai-native-journal` (local feature branch; no main merge, no push, no PR)
**Destination SHA before merge:** `ff3173f3dbce1dda5e7a2e8e7bfa3ec71e4fb6f7`
**Source tip before merge:** `1a93a469d20917e37ab681e9bf95587853cf44c4`
**Merge commit:** `3047fe3e4163afe09c1b1802380719efeb6a4068`
**Merge parents:** `ff3173f3dbce1dda5e7a2e8e7bfa3ec71e4fb6f7` (destination) + `1a93a469d20917e37ab681e9bf95587853cf44c4` (source)
**Merge base:** `e5352acd39c1d03f240b4b797c9ca021d97679f0` (the verified feature HEAD after the Phase 01 integration)
**Phase plan:** `docs/superpowers/plans/ai-native-journal/phase-02.md` · **Phase report:** `docs/superpowers/reports/ai-native-journal-phase-02.md`

---

## 1. What was integrated

| Phase commit | Subject                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `919a9f4`    | docs: add Phase 02 migration runner plan (committed before implementation, as the packet requires) |
| `cf51fe8`    | feat: add versioned intelligence storage migrations — the implementation                           |
| `1a93a46`    | docs: record the Phase 02 migration runner phase report                                            |

14 files changed, +2132 / −104. Schema allocation was exactly `0001` plus the ledger. No new dependency, no lockfile change, no identity, event, job, observation, AI or workflow table.

**Delivered behaviour**

- `apps/web/src/db/migrations.ts` — `JournalMigration`, `MigrationStatus`, `inspectMigrations(sqlite)`, `applyMigrations(sqlite)`, `MigrationError` with machine-readable reasons (`future-version`, `noncontiguous-history`, `checksum-mismatch`, `name-mismatch`, `registry-invalid`, `missing-manifest`).
- `apps/web/src/db/migrations/0001-legacy-baseline.ts` — the frozen baseline DDL and the legacy repairs, a copy independent of `BOOTSTRAP_SQL`.
- `apps/web/src/db/migration-checksums.json` + `apps/web/scripts/build-migration-manifest.mjs` — the deterministic checksum artifact and its generator, exposed as `pnpm --filter web migrations:build` and `migrations:check`.
- `apps/web/src/db/bootstrap.ts` — `migrate()` is **deleted**; startup now calls the runner.
- `apps/web/src/db/schema.ts` — a typed `journal_migrations` mirror.
- `apps/web/tests/intelligence-migrations.test.ts` — 14 runner invariant tests.

## 2. Review outcome

**PASS.** Reviewed by the coordinator against the exact commits, the phase guide's contract list and the phase's own plan — not against the worker's summary.

Confirmed against the authoritative contract:

- **No second competing startup mechanism.** `migrate()` no longer exists and nothing calls it. `openJournalDatabase` now runs the runner inside one immediate transaction with the existing busy-retry preserved. `BOOTSTRAP_SQL` survives as the final-schema snapshot, explicitly re-documented as _not_ what startup runs, and is still consumed by four existing test suites.
- **Checksum provenance is correct.** The checksum is a SHA-256 of the canonical migration source text, read from the build artifact at runtime. It is never derived from `Function.prototype.toString()`.
- **The runner owns the ledger.** `LEDGER_TABLE_SQL` is executed by the runner only when the table is absent; no migration creates it.
- **History is validated before any write.** `applyMigrations` runs a read-only pre-flight over the applied history, then re-reads and re-validates the ledger _inside_ the write lock, because a concurrent process may have applied migrations while this one waited.
- **A pre-ledger journal is not "already migrated".** The runner executes the baseline's idempotent legacy convergence first and only then records version 1. An empty journal runs the same baseline.
- **The ledger never advances on failure.** Each migration's `up(sqlite)` and its ledger row are written in the same immediate transaction, so a failure rolls back both.
- **Unsupported history is refused without writing** — a future version, a tampered name, a tampered checksum, a missing applied version, a non-contiguous history and a non-contiguous registry each raise a distinct `MigrationError`.

**One finding raised by the coordinator, and withdrawn after verification.** The coordinator observed that the new relative imports carry explicit `.ts` extensions and that `apps/web/tsconfig.json` gained `allowImportingTsExtensions`, while the repository contains zero `.ts`-extension imports elsewhere and `apps/web/tsconfig.json` is not in the phase guide's modify list. On checking the worker's stated reason, the coordinator confirmed it: `apps/web/tests/db-concurrent-init.test.ts` spawns child Node processes with `--experimental-strip-types` that `await import(url)` the real TypeScript modules, and Node's ESM resolver does not search for extensions — so the explicit specifier is functionally required for the concurrency test to work. The option is legal because `tsconfig.base.json` already sets `noEmit: true`. The worker had already recorded this as deviation 1 in the phase report and amended the plan's design decisions before the implementation commit. **No defect; the observation was wrong and is withdrawn.**

The worker's own two independent reviews (spec-compliance and code-quality) ran against the diff, and every Critical and Important finding it raised was fixed: verbatim ledger DDL, a duplicate-version drop in the manifest generator, an unenforced manifest name, a stale-artifact check crash, and a parity-contract mismatch against the documented default.

## 3. Merge

Serialized local non-fast-forward merge in the feature checkout.

- Pre-check: `git merge-tree --write-tree` returned a single clean tree (exit 0). The merge itself reported no conflicts.
- `git merge-base --is-ancestor codex/ai-native-journal-p02 HEAD` → true.
- `git merge-base --is-ancestor e5352ac HEAD` → true.
- The destination advanced from `ff3173f` to `3047fe3`; the source tip `1a93a46` is a parent of the merge commit.
- No history rewrite, no force, no reset, no main merge, no push, no PR.

## 4. Post-merge verification on the destination branch

All commands ran in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal` at merge commit `3047fe3`, Node v24.20.0, pnpm 11.0.8, disposable `JOURNAL_DATA_DIR`. This is the repository's CI sequence.

| Check                                                                                                            | Exit | Result                                            |
| ---------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------- |
| `pnpm exec prettier --check` on every file changed `e5352ac..HEAD`                                               | 0    | all matched files use Prettier code style         |
| `pnpm --filter web typecheck`                                                                                    | 0    | clean                                             |
| `pnpm --filter @luxalgo/journal-core typecheck`                                                                  | 0    | clean                                             |
| `pnpm --filter @luxalgo/journal-importers typecheck`                                                             | 0    | clean                                             |
| `pnpm exec vitest run` (Phase 02 targeted: migrations, concurrent-init, connection-lifecycle, execution-storage) | 0    | 4 files, **35 passed**                            |
| `pnpm test` (whole project)                                                                                      | 0    | 87 files, **864 passed \| 1 skipped** (865)       |
| `node scripts/check-licenses.mjs`                                                                                | 0    | Dependency licenses OK                            |
| `pnpm --filter web migrations:check`                                                                             | 0    | migration-checksums.json is up to date            |
| `pnpm -r --filter "./packages/*" build`                                                                          | 0    | core and importers built                          |
| `pnpm build` (Next production build)                                                                             | 0    | static build ready at `apps/web/.next/tauri-dist` |

The whole-project suite was run once by the coordinator as the designated phase verification owner, on the destination branch, and not duplicated across child workers. The same suite also passed on the candidate before the merge (87 files, 864 passed | 1 skipped).

## 5. Environment-limited check: the root `pnpm typecheck`

The root typecheck still fails only in the `desktop` workspace, with the identical pre-existing host error:

```text
desktop typecheck: error RC2175 : resource file ...\desktop\src-tauri\icons\icon.ico is not in 3.00 format
desktop typecheck: called `Result::unwrap()` on an `Err` value: Failed("RC.EXE failed to compile specified resource file")
```

Unchanged by this phase: `git diff --name-only e5352ac..HEAD -- desktop/` is empty, the icon is git-ignored and host-generated, and the three package typechecks the phase actually touches are clean. This remains **blocked host evidence** — not mocked, not worked around, no threshold lowered — and it continues to block the root-typecheck element of the whole-project gate at G-FINAL until the desktop toolchain is provisioned on this host.

## 6. State

| Dimension   | State                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------- |
| Native task | `task_4424551d3c6c` — **completed**, settled by a valid `worker_done` (outcome `succeeded`) |
| Dispatch    | `ctx_07e3d196e0d4` — settled                                                                |
| Candidate   | complete and committed                                                                      |
| Reviewed    | yes — coordinator review against the exact commits and the phase guide contract             |
| Integrated  | yes — `3047fe3`                                                                             |
| Verified    | yes — the full CI sequence is green on the destination branch                               |

## 7. Next

T-003 (Phase 03 — projection identity, fingerprints and immutable revisions) is the only phase whose dependency is now satisfied. Its native task `task_f9e9b7567e6c` exists and is natively `ready`; **it has not been dispatched**, because a later phase requires an explicit continuation instruction from the user. Phase 03 has not been started.

Phase 03 inherits: the migration runner and its ledger, the frozen baseline, the deterministic checksum artifact with a CI no-diff check, the typed `journal_migrations` mirror, and the Phase 01 connection and transaction seams. It owns the `0002-trade-projections.ts` migration and must append forward — never renumber — to the registry, and it must keep `BOOTSTRAP_SQL` as the evolving final-schema snapshot while the baseline stays frozen.
