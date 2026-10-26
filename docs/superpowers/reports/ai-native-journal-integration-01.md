# AI-native journal — Phase 01 integration report

**Phase:** 01 — Safe connection/transaction seams; separate request errors from Next
**Stable task:** T-001 · **native task:** `task_2acef5be58ee`
**Source branch:** `codex/ai-native-journal-p01`
**Destination branch:** `codex/ai-native-journal` (local feature branch; no main merge, no push, no PR)
**Destination SHA before merge:** `912948536ab8094bfb6aa792f15796ab36ebe665`
**Source tip before merge:** `f0edcc3963fafcc726dfc3d649301e1891451c2c`
**Merge commit:** `40011b47fdd57396b7097847fac4fdce3dbe42f2`
**Merge parents:** `912948536ab8094bfb6aa792f15796ab36ebe665` (destination) + `f0edcc3963fafcc726dfc3d649301e1891451c2c` (source)
**Merge base:** `0a278503fd67c0f9e82138dfecb744f4bfd307ad` (the verified feature bootstrap)
**Phase report:** `docs/superpowers/reports/ai-native-journal-phase-01.md`
**Phase plan:** `docs/superpowers/plans/ai-native-journal/phase-01.md`

---

## 1. What was integrated

| Phase commit | Subject                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `e3b4df3`    | docs: add Phase 01 journal seam plan (committed before implementation, as the packet requires) |
| `4b361d3`    | refactor: expose safe journal transaction boundaries — the implementation                      |
| `f3575ee`    | docs: record Phase 01 journal seam results — the phase report                                  |
| `477b102`    | Fix the Phase 01 plan formatting so the repository format gate passes                          |
| `fdde475`    | Record the Phase 01 formatting-gate finding and its resolution in the reviewer report          |
| `f0edcc3`    | Correct the Phase 01 report's formatting-gate claim and record the repair                      |

20 files changed, +1574 / −176. No schema change, no migration, no dependency change, no lockfile change.

**Delivered behaviour**

- `apps/web/src/db/connection.ts` — `openConnection(directory)`, `JournalDb`, and the app singleton. The manual `-wal`/`-shm` unlink is **removed**: ADR 0007 line 40 lists "deleting live WAL sidecars" as forbidden, and the old unlink could destroy a second live connection's WAL. The singleton's cached directory moved onto `globalThis`, which also removes the `join(currentDataDir!, …)` `TypeError` the module-scoped tracking produced on re-evaluation.
- `apps/web/src/db/transaction.ts` — `JournalTx` and `withJournalTransaction(fn)`, synchronous-only by conditional type and by a runtime thenable guard that rolls back and consumes the discarded promise's rejection.
- `apps/web/src/server/request-error.ts` — `RequestError` / `requireValue`, re-exported unchanged from `server/api.ts`. Exactly one class definition exists, so `instanceof` and the 400/500 mapping are unchanged, including `PropConflict extends RequestError`.
- `apps/web/src/db/index.ts` is now a barrel re-exporting `./connection`, `./transaction` and `./schema`; every existing `import { db, accounts } from "@/db"` call site is unchanged.
- Two new test files; ten server modules repointed from `"./api"` to `"./request-error"`.

## 2. Review outcome

Coordinator review was run against the exact commits, not against the worker's summary.

**Passed**

- The new tests are non-vacuous. `unlinkSync` is spied so the ADR 0007 sidecar rule is asserted platform-independently; the callable-thenable guard is mutation-proved; the `@ts-expect-error` directive makes the compile-time async rejection a typecheck-gated assertion.
- The import-graph guard resolves `@/db` through the directory barrel rather than dropping it from the graph, so the rules cannot pass vacuously. Rule 5's detector has a live violating-fixture self-test; only its application to the not-yet-existing `server/intelligence/` tree is skipped.
- Boundary result confirmed independently: server modules reaching Next went **16 → 0**; only `server/api.ts` remains, the one permitted request boundary.
- Compatibility preserved: no change to the financial engine, trade keys, hashes, annotations, providers (including compatible endpoints), encrypted credentials, cTrader sync, or any API response contract.

**Found and fixed before acceptance — one defect**

`docs/superpowers/plans/ai-native-journal/phase-01.md` failed `prettier --check` (exit 1). Every other phase file was prettier-clean and the other 75 repo-wide violations are pre-existing. This violated the phase stop condition ("`pnpm format:check` reports no new violation in the files this phase touched") and would have failed the repository's `format:check` CI gate.

The defect was **not** fixed by the coordinator. It was routed to a replacement implementation attempt (`ctx_aefaf725742a`) with an explicit brief, which normalised the file at `477b102`, recorded the finding and its resolution in the reviewer report at `fdde475` (verdict `PASS`, 13 PASS / 0 FAIL / 0 BLOCK), and corrected the phase report's false "format gate clean" claim at `f0edcc3`. The formatting change was verified content-neutral: 470 insertions / 471 deletions, differing only in CRLF→LF, `*emphasis*` → `_emphasis_`, and table-column padding.

## 3. Merge

Serialized local non-fast-forward merge in the feature checkout.

- Pre-check: `git merge-tree --write-tree codex/ai-native-journal codex/ai-native-journal-p01` returned a single clean tree (exit 0). The merge itself reported no conflicts.
- `git merge-base --is-ancestor codex/ai-native-journal-p01 HEAD` → true.
- `git merge-base --is-ancestor 0a27850 HEAD` → true.
- The destination advanced from `9129485` to `40011b4`; the source tip `f0edcc3` is a parent of the merge commit.
- No history rewrite, no force, no reset, no worktree deletion, no main merge, no push, no PR.

## 4. Post-merge verification on the destination branch

All commands were run in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal` at merge commit `40011b4`, Node v24.20.0, pnpm 11.0.8, disposable `JOURNAL_DATA_DIR`.

| Check                                                                                                                                                                                         | Exit | Result                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/db-connection-lifecycle.test.ts apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/execution-storage.test.ts apps/web/tests/ai-scope.test.ts` | 0    | 4 files, **62 passed \| 1 skipped** (63)    |
| `pnpm test` (whole project)                                                                                                                                                                   | 0    | 86 files, **850 passed \| 1 skipped** (851) |
| `pnpm --filter web typecheck`                                                                                                                                                                 | 0    | clean                                       |
| `pnpm --filter @luxalgo/journal-core typecheck`                                                                                                                                               | 0    | clean                                       |
| `pnpm --filter @luxalgo/journal-importers typecheck`                                                                                                                                          | 0    | clean                                       |
| `pnpm exec prettier --check` on every file changed `0a27850..HEAD`                                                                                                                            | 0    | all matched files use Prettier code style   |
| `node scripts/check-licenses.mjs`                                                                                                                                                             | 0    | Dependency licenses OK                      |
| `pnpm typecheck` (root, includes `desktop`)                                                                                                                                                   | 101  | **blocked host evidence — see §5**          |

The coordinator acted as the designated phase verification owner; the whole-project suite was run once, on the destination branch, and not duplicated across child workers.

**Dependency isolation.** Each worktree owns its own `node_modules` and its own pnpm virtual store (`better-sqlite3@12.11.1` is physically present in each worktree, with no junction or symlink between them). Only the pnpm download cache at `E:\.pnpm-store\v10` is shared, which the contract permits. Writable database directories are per-worktree via `JOURNAL_DATA_DIR`.

## 5. Environment-limited check: the root `pnpm typecheck`

The root typecheck reaches the `desktop` workspace and fails:

```text
desktop typecheck: E:\build-cache\target\debug\build\trade-journal-desktop-119a88e22edbe3fa\out\resource.rc(26) : error RC2175 : resource file ...\desktop\src-tauri\icons\icon.ico is not in 3.00 format
desktop typecheck: thread 'main' panicked at ...\tauri-winres-0.3.6\src\lib.rs:543:14
desktop typecheck: called `Result::unwrap()` on an `Err` value: Failed("RC.EXE failed to compile specified resource file")
```

This is **pre-existing host tooling, not a Phase 01 failure**:

- `git diff --name-only 0a27850..HEAD -- desktop/` is **empty** — the phase changed no desktop file, so it cannot be the cause.
- `desktop/src-tauri/icons/icon.ico` is git-ignored (`desktop/src-tauri/.gitignore:20: *.ico`) and host-generated; the error is a Windows resource-compiler gate on a generated artifact.
- The worker reproduced the byte-identical error on the untouched base tree.

Classification: **blocked host evidence.** It was not mocked, not worked around, and no threshold was lowered. It blocks the root-typecheck element of the whole-project gate at G-FINAL until the desktop toolchain (Windows SDK resource compiler, generated icons, Tauri sidecar binary) is provisioned on the host. The three package typechecks that the phase actually touches are clean.

## 6. State

| Dimension   | State                                                             |
| ----------- | ----------------------------------------------------------------- |
| Native task | `task_2acef5be58ee` — completed, settled by a valid `worker_done` |
| Dispatch    | `ctx_aefaf725742a` — settled, outcome `succeeded`                 |
| Candidate   | complete and committed                                            |
| Reviewed    | yes — coordinator review against the exact commits                |
| Integrated  | yes — `40011b4`                                                   |
| Verified    | yes — post-merge gate green on the destination branch             |

**Lifecycle anomaly, recorded for audit.** The first attempt (`ctx_c398a01cfc05`) had its capability revoked at `2026-10-25T22:27:29Z` by an Orca runtime restart — `last_failure: "The assigned worker terminal is no longer live after orchestration recovery"`, worker state `abandoned`, stage `terminal_missing`. The worker process survived the revocation and completed the phase, but could not send `worker_done`: its `orchestration check` addressed the coordinator's inbox instead of its own Dispatch mailbox and returned `consumer_fenced`, which it correctly obeyed by stopping rather than retrying. The failed attempt was recorded with `task-update --status failed` carrying the full evidence, which is what authorised the `--retry-of` replacement. No work was lost and no duplicate writer was ever active.

## 7. Next

T-002 (Phase 02 — versioned migration runner and legacy baseline) is the only phase whose dependency is now satisfied. Its native task `task_4424551d3c6c` exists and is unblocked natively; **it has not been dispatched**, because Phase 02 requires an explicit continuation instruction from the user. Phase 02 has not been started.

Phase 02 inherits: the `openConnection(directory)` seam with the shared bootstrap already applied, the synchronous `withJournalTransaction(fn)` seam, a singleton that resets only on a real data-directory change, and the installed import-graph boundary guard. It must commit its own plan and migration-ledger design first, and it owns `db/schema.ts` and `db/bootstrap.ts` for schema and migration-registry changes.
