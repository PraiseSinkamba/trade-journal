# Integration, quality and recovery

## Ownership and placement

Parent OMP owns native task/dispatch mapping, authorization record, dependency eligibility, integration lock, reviews and evidence acceptance. Workers own implementation and fixes in their assigned worktrees. Parent must not switch into a worker checkout to implement its feature. Parent may perform mechanical Git integration and orchestration documentation; alternatively dispatch one integration worker with explicit ownership. Conflict resolution that changes code goes back to the relevant worker. The Phase 11 packet and manifest define Phase 11 scope, and Phase 21 owns the Tauri packaging subset under ADR 0009; the re-sequencing changed no ownership conflict rule, no dependency edge and no gate threshold.

One top-level feature worktree starts from the resolved handoff commit on codex/ai-native-journal. Each Phase NN gets a distinct Orca child worktree and branch codex/ai-native-journal-pNN, starting from the current verified feature SHA after predecessor integration. Child task worktrees, if justified, branch from the committed phase contract SHA and merge into the phase, never directly into feature. Use exact returned full Orca repoId::path IDs and explicit Git base; lineage does not select ancestry. Discover actual branch names and rename only newly owned branches if needed, never overwrite existing refs.

All tasks share one repository, so committed source docs are inherited. Verify with git cat-file before dispatch; future phase plans and predecessor reports must be committed before dependent branching. No cross-repository synchronization/submodule update is needed. If topology changes, freeze dispatch and prepare separate context packets pinned to each repository SHA; an Orca parent relationship does not transfer files or commits.

## Conflict controls

Across phases, overlaps are intentional and serialized. Within a phase, one owner edits db/schema.ts, bootstrap.ts, migrations.ts, migration-checksums.json, common contracts, composition.ts, root/web package.json and lockfile. T-005 establishes transaction adapters used by T-006/007. T-008 updates projection evidence only after their mutation coverage. T-010 establishes IPC before T-021 Rust integration. T-012 establishes runtime ports before T-013 provider wiring. T-014 owns source schema before T-015 scheduler. T-016 owns experience schema before T-017 policy; T-018 establishes APIs before T-019 UI. T-020/021 serialize operational scripts/build/CI edits. These dependencies prevent conflicting file ownership; worktree isolation alone would not.

Conditional subtask allocation must list exact files (including tests/docs), interface SHA, native task IDs and merge order in the phase plan. Same-file writers are sequential. No generic permission to edit a whole directory in parallel. Reviews use immutable base/tip commits; fixes invalidate review evidence for changed code.

## Review and merge gates

1. G-BOOTSTRAP: resolve handoff SHA, verify committed source hashes, inspect current Git/Orca topology, record authorization and starting refs. Run baseline checks in disposable environment; classify pre-existing failures with evidence, without unrelated fixes.
2. Worker materializes and commits phase-only plan. Shared interfaces/schema land before child branching. Superpowers implementation and spec-compliance/code-quality reviews run within worker scope using native Orca-managed implementation sessions where delegated. No hidden Codex implementation.
3. Each worker commits targeted tests and passing results. Parent verifies actual commits and report rather than trusting summary. Review authorization, privacy, migration parity, transaction/effect idempotency and compatibility for the touched scope.
4. Designated phase verification owner runs full pnpm test and pnpm typecheck at phase boundary, plus phase-specific migration/build/process gates. Do not run project-wide suites in every child subagent. Use plan-prescribed extra regression commands. Unavailable required Docker/Tauri checks block their phase; passing unit mocks cannot replace them.
5. Commit phase report with baseline/tip, owned changes, migration versions/indexes, exact commands/results/runtime and review evidence. Parent reserves sole integration ownership. Confirm clean source/destination, correct branches, verified predecessor ancestry and no missing commits. Merge updated feature into source if feature moved; worker resolves conflicts, tests/reviews again. Never force-reset/rebase shared history.
6. Perform serialized local non-fast-forward phase→feature merge in the actual feature checkout. Do not blindly pull, switch main, push or publish. Run full tests on merged feature plus checks affected by integration; inspect recorded merge parents. Commit integration report with destination-before, candidate and merge SHAs, postmerge commands and outcomes. If failure occurs, feature is not a verified base; dispatch repair and block successors.
7. Stop after the assigned phase. Only explicit authorization for a further phase opens the next wave. Native worker success is candidate completion, not integration acceptance; map native task ID to stable ID and separate integration state. A native ready view alone does not authorize dependent start.

## Existing checks and feature release gates

Canonical targeted command is pnpm exec vitest run with the task's paths. Installed local Vitest CLI may be used if pinned pnpm cannot bootstrap, as already permitted by the detailed plan; record the deviation. All fixture data is disposable. New tests belong in apps/web/tests or package test directories discovered by root vitest.config.ts.

Existing CI sequence (T-021 mandatory): pnpm format:check; pnpm typecheck; pnpm test; node scripts/check-licenses.mjs; pnpm -r --filter "./packages/*" build; pnpm build. Use disposable JOURNAL_DATA_DIR during builds too. Migration phases additionally require fresh/legacy parity, checksum/history guards, concurrent startup, failure rollback, FK/integrity and unchanged financial/credential bytes. T-002 adds deterministic migration-manifest generation/check; later schema owners use it.

G-A after T-011: all mutations, evidence/replay/fencing, no-provider kill/reopen recovery, packaged Node smoke and targeted financial regression with the full pnpm test passing, recorded as one integrated no-provider slice. Docker scratch-volume smoke and actual Tauri lifecycle and ABI evidence are produced by the Phase 21 Tauri packaging subset and are required at G-FINAL. Keep production event capture disabled through partial mutation integration; establish seed checkpoint before enabling complete Slice A.

G-B after T-019: registry/gateway authority, provider/endpoint drift, cancellation/budgets, source invalidation/scheduler, workflow CAS/dedup, engagement, origin/auth, UI accessibility/privacy and no-provider/restart continuation. Background AI and proactive delivery retain specified off-by-default opt-ins.

G-FINAL after T-021: full CI, actual packaged clean-directory Docker/Windows smoke, forced shutdown/restart, native SQLite ABI, actual Tauri sidecar ABI with desktop restart and quit leaving no orphan processes, public tarball content audit (no publish), safe backup/deletion/retention, and same-machine 1k/10k/100k benchmark. Required threshold is zero escaped SQLITE_BUSY, zero lost effects and <=20% p95 HTTP regression; never weaken atomicity or threshold to pass. scripts/verify-features.py runs against isolated loopback data/port. No additional speculative product testing requirements are introduced here.

Phase 21 (T-021) produces the G-FINAL evidence on branch `codex/ai-native-journal-p21`. Its recorded results are in `docs/superpowers/reports/ai-native-journal-phase-21.md` and the release section of `docs/intelligence-operations.md`: the Windows packaged smoke passed with no orphaned `node.exe`, the Docker scratch-volume smoke is recorded as blocked host evidence because the daemon is not running on this host, and the benchmark's counters are read from the journal's own rows rather than from an assumption.

## Recovery and decisions

- Failed/partial worker: retain commits and dirty file inventory; mark candidate incomplete, do not merge or unlock dependents. Send precise fixes to that owner or a replacement after proven settlement/exit. New attempt starts from recorded partial tip, not guessed main.
- Interrupted parent: recover the same native Run, read manifest/phase plans, native Task/Dispatch state and committed integration reports. Inspect branches/merge parents and pending messages before any retry. Runtime mapping is coordinator-owned and separate from static manifest.
- Timeout/lost receipt: outcome is unknown, not failed. Use native request/dispatch inspection and retry token from receipt. Never launch a second writer because terminal output is silent. Follow version-matched recovery guide; unverifiable is not exited.
- Changed branch/source: compare expected refs and source hashes, record drift, stop affected dispatch. Integrate legitimate changes without reverting others; rerun appropriate contracts/review. If scope/semantics changes, get an explicit decision.
- Conflict: resolve on task/phase source through implementation worker; repeat review/tests. No automatic ours/theirs strategy for schema, identity or transaction code.
- Merged gate failure: record feature unverified and block dispatch. Prefer an assigned forward repair; no history rewrite or destructive DB downgrade. Preserve failure artifacts and use scratch backups.
- Database incompatibility: stop startup before schema writes; never edit applied migrations. Account purges, replay and reset must retain cancellation/dedup guarantees.

Routine native task creation, isolated worktrees, tests, commits and tested local task/phase merges may be automated once execution is authorized. Material design changes, new dependency ADR, external repository work, live-data operations, publishing/push/main merge and lowering release gates are outside that authorization. Retain Orca branches/worktrees as requested. Release settled agent terminals via native worker lifecycle; this does not remove worktrees. No forced cleanup.

Whole feature done means all 21 accepted integration records, G-A/G-B/G-FINAL evidence, no unresolved blocking review or required test, documented operation/rollback and intact compatibility. This package itself makes no implementation-completion claim.
