# AI-native journal — Phase 09 integration report

**Phase:** 09 — Historical seed/replay and no-provider recovery
**Stable task:** T-009 · **native task:** `task_5b7ff94b51b9` · **dispatch:** `ctx_9d8af8f668f6`
**Source branch:** `codex/ai-native-journal-p09` — **shared with Phase 10**, which is dispatched into this same worktree
**Destination branch:** `codex/ai-native-journal` (local feature branch; no main merge, no push, no PR)
**Destination SHA before merge:** `b22276509ce3f604ea7c6ad5eee3845027c8f62b`
**Source tip before merge:** `5093db1068715aa104f342c5b8bd0eaa3a554d4f`
**Merge commit:** `0915173ce42baecfa59434f2361af92fa5f02436`
**Merge parents:** `b22276509ce3f604ea7c6ad5eee3845027c8f62b` (destination) + `5093db1068715aa104f342c5b8bd0eaa3a554d4f` (source)
**Merge base:** `db56d3671b1e6fbfdc92e4cdc039b45cff001386` (the verified feature HEAD after the Phase 08 integration)
**Phase plan:** `docs/superpowers/plans/ai-native-journal/phase-09.md` · **Phase report:** `docs/superpowers/reports/ai-native-journal-phase-09.md`

---

## 1. What was integrated

| Commit    | Subject                                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| `a3cbda0` | docs: plan restartable historical intelligence recovery (the compact ownership map) |
| `b6c8a83` | feat: recover and seed deterministic intelligence safely — the implementation       |
| `5093db1` | docs: record verified historical intelligence recovery                              |

**Delivered behaviour**

Historical seed, durable replay, suppression fencing and provider-free SIGKILL/reopen recovery. `seedAccount` and `requestReplay` are exported from `apps/web/src/server/intelligence/composition.ts`; the replay service is constructed with the **outbox** handler registry. New files: `apps/web/src/server/intelligence/infrastructure/backfill.ts`, `apps/web/tests/intelligence-slice-a.test.ts`, `apps/web/tests/intelligence-recovery.test.ts`. Extended: `infrastructure/{jobs,knowledge-store,worker}.ts`, `trading/reconcile.ts`, `intelligence-observations.test.ts`.

**No schema change** — `git diff --name-only db56d36..HEAD -- apps/web/src/db/migrations/` is empty. This phase uses the `intelligence_seed_checkpoints` table migration 0004 already created.

## 2. Review outcome

**PASS.** Reviewed by the coordinator against the exact commits, the detailed plan's Task 7 and the phase guide's Phase 09 row.

Confirmed:

- **The replay allowlist is the outbox handler registry.** `composition.ts:165` builds `outboxHandlers` and `:168` passes it to the replay service, so a replay naming a worker-only handler is refused. This was the worker's own review finding, fixed before acceptance and pinned by a test.
- **`seed_account` is routed.** `worker.ts:214` handles it, so the seed jobs are not failed as `unhandled_job`. This was the first coordinator-approved scope extension.
- **`derivedQualityOf(tx, rows)` is exported from `reconcile.ts:155`** and the source-only derived-quality closure is reused by `qualityContextOf` and the backfill, so the seed runs the quality scan **once per account batch** instead of once per unmapped trade. This was the second coordinator-approved extension, and it removed a quadratic rescan of the account's identity and revision history.
- **No schema, payload or financial-rule change**, and `operationId` stays in the checkpoint's `baselineOperationId`.

## 3. Two escalations, both verified before answering

**Scope extension.** The worker asked to add `infrastructure/worker.ts` and `trading/reconcile.ts`. The coordinator verified both claims against the merged feature branch before approving: `worker.ts:214` rejects every payload whose type is not `evaluate_trade` and `:243` then fails the job with `unhandled_job`, and `qualityContextOf` / `projectionOfRow` already existed as module-private helpers. Both files belong to completed, merged phases; T-009 was the only active writer and no concurrent writer existed.

**The over-specified assertion.** The first targeted gate ran 27 tests with 26 passing, including all three real child SIGKILL-and-reopen scenarios. The one failure was a seed deletion assertion comparing `dispatchedAt` before versus after the outbox drain. The coordinator verified the production mechanic — `domain-event-store.ts:54` appends with `dispatchedAt: null`, `:76` selects pending events by `isNull(dispatchedAt)`, `:85` sets it on dispatch — so that timestamp is dispatch bookkeeping that legitimately transitions across a drain, and the old assertion asserted the wrong thing.

The corrected assertion compares event `id` **and** `payloadJson` on both sides and excludes only the timestamp, so it **re-targets the invariant rather than weakening it**: it still fails if an event id or payload changed, if observations leaked, or if a checkpoint survived a deleted account. No production change was permitted to make the test pass.

**The `NODE_ENV` fixture.** The web typecheck flagged the new recovery fixture for a missing required `NODE_ENV`, because Next's `ProcessEnv` typing makes it mandatory and no other suite in the repository sets it. The fix at `intelligence-recovery.test.ts:287` is `{ NODE_ENV: "test", JOURNAL_DATA_DIR: directory }` — test-only, no production behaviour change. The worker was told explicitly that it did not need to re-run the whole-project suite, because the only change since it passed was an environment variable handed to a child process, and to record that reasoning so the suite figure is not read as stale.

## 4. Merge

A serialized local non-fast-forward merge in the feature checkout.

- Pre-check: `git merge-tree --write-tree` returned a clean tree (exit 0). The merge reported no conflicts.
- `git merge-base --is-ancestor codex/ai-native-journal-p09 HEAD` → true.
- The destination advanced `b222765` → `0915173`; the source tip `5093db1` is a parent of the merge commit.
- No history rewrite, no force, no reset, no main merge, no push, no PR.

## 5. Post-merge verification on the destination branch

All commands ran in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal` at `0915173`, Node v24.20.0, pnpm 11.0.8, disposable `JOURNAL_DATA_DIR`.

| Check                                                              | Exit | Result                                            |
| ------------------------------------------------------------------ | ---- | ------------------------------------------------- |
| `pnpm exec vitest run` (slice-a, recovery, observations)           | 0    | 3 files, **31 passed**                            |
| `pnpm test` (whole project)                                        | 0    | 101 files, **1052 passed**                        |
| `pnpm --filter web typecheck`                                      | 0    | clean                                             |
| `pnpm --filter @luxalgo/journal-core typecheck`                    | 0    | clean                                             |
| `pnpm --filter @luxalgo/journal-importers typecheck`               | 0    | clean                                             |
| `pnpm exec prettier --check` on every file changed `b222765..HEAD` | 0    | all matched files use Prettier code style         |
| `pnpm --filter web migrations:check`                               | 0    | migration-checksums.json is up to date            |
| `node scripts/check-licenses.mjs`                                  | 0    | Dependency licenses OK                            |
| `pnpm -r --filter "./packages/*" build`                            | 0    | core and importers built                          |
| `pnpm build` (Next production build)                               | 0    | static build ready at `apps/web/.next/tauri-dist` |

The coordinator reproduced the worker's reported counts exactly: 31 targeted tests and a whole-project run of 101 files and 1052 tests.

## 6. Environment-limited check: the root `pnpm typecheck`

The root typecheck still fails only in the `desktop` workspace, for the two pre-existing repository defects diagnosed during Phase 03 and recorded in `ai-native-journal-worktrees.json` under `toolingGaps`. They are desktop-tooling defects owned by a later operational phase, pre-existing on `main`, and do not affect this phase.

## 7. State

| Dimension   | State                                                                          |
| ----------- | ------------------------------------------------------------------------------ |
| Native task | `task_5b7ff94b51b9` — completed by a valid `worker_done` (outcome `succeeded`) |
| Dispatch    | `ctx_9d8af8f668f6` — settled                                                   |
| Candidate   | complete and committed                                                         |
| Reviewed    | yes — coordinator review against the exact commits and the phase guide         |
| Integrated  | yes — `0915173`                                                                |
| Verified    | yes — the full CI sequence is green on the destination branch                  |

## 8. Next

**Phase 10 (Node supervisor, worker bundle and Docker startup) is dispatched into this same `codex/ai-native-journal-p09` worktree**, on the same branch, with base = the Phase 09 tip `5093db1`. The branch is then merged once to cover both phases.

The reason for sharing the worktree is specific, not convenience: Phase 09 and Phase 10 both own `apps/web/src/server/intelligence/composition.ts`, and Phase 10's native dependency is Phase 09. In separate worktrees that is a guaranteed merge conflict and an out-of-order dependency; in one worktree Phase 10 simply continues on top.

Phase 10 inherits the fenced worker it must supervise, the composition module where the worker is registered, and the Phase 09 seed and recovery work already committed on the branch. It adds no table and no migration, and it explicitly excludes the Rust and Tauri edits.
