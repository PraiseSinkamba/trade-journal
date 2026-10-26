# AI-native journal — Phase 03 integration report

**Phase:** 03 — Projection identity, fingerprints and immutable revisions, not wired to routes
**Stable task:** T-003 · **native task:** `task_f9e9b7567e6c` · **dispatch:** `ctx_9a33af924baf`
**Source branch:** `codex/ai-native-journal-p03`
**Destination branch:** `codex/ai-native-journal` (local feature branch; no main merge, no push, no PR)
**Destination SHA before merge:** `5e3651be54b1adb27962847bc1543f6485fb77b7`
**Source tip before merge:** `2d62c57b3a22357b7d54d0e4950adcffc65dd626`
**Merge commit:** `349c06157e694503c9c5230070c2a202c61683d3`
**Merge parents:** `5e3651be54b1adb27962847bc1543f6485fb77b7` (destination) + `2d62c57b3a22357b7d54d0e4950adcffc65dd626` (source)
**Merge base:** `2e818946022b777e3f62f35b3a05fc1613e91fcf` (the verified feature HEAD after the Phase 02 integration)
**Phase plan:** `docs/superpowers/plans/ai-native-journal/phase-03.md` · **Phase report:** `docs/superpowers/reports/ai-native-journal-phase-03.md`

---

## 1. What was integrated

| Phase commit | Subject                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `ed02b57`    | docs: add Phase 03 projection identity plan (committed before implementation, as the packet requires) |
| `e0f84d2`    | feat: version trade projection evidence without changing keys — the implementation                    |
| `2d62c57`    | docs: record the Phase 03 implementation commit in the phase report                                   |

14 files changed, +2406 / −116. Schema allocation exactly `0002` plus the five projection tables. No new dependency, no lockfile change, and **no change to core key generation**.

**Delivered behaviour**

- `apps/web/src/server/trading/projection.ts` — `fingerprintProjection(input: ProjectionInput): string`, `canonicalJson`, `canonicalProjectionJson`, `projectionSnapshotJson`, and a bounded, versioned snapshot.
- `apps/web/src/server/trading/identity.ts` — `resolveIdentity(tx: JournalTx, input: IdentityInput): IdentityResolution`, `recordProjectionRevision`, `recordIdentityLink`, `retireIdentity`.
- `apps/web/src/db/migrations/0002-trade-projections.ts` — `trade_identities`, `trade_projection_revisions`, `trade_revision_executions`, `trade_identity_links`, `execution_evidence`.
- `apps/web/src/db/migrations.ts` — the registry appends `0002` after `0001`.
- `apps/web/src/db/bootstrap.ts` — the final-schema snapshot reuses `TRADE_PROJECTION_SQL`, so a migrated journal and the declared schema cannot drift apart.
- `apps/web/src/server/ids.ts` — adds `newUuid()` for durable entity identifiers. Additive only; no existing behaviour changed.
- `apps/web/tests/trade-projection-identity.test.ts` — the new identity and fingerprint suite.

## 2. Review outcome

**PASS.** Reviewed by the coordinator against the exact commits, ADR 0006, the detailed plan's Task 3 and the phase guide's Phase 03 row — not against the worker's summary.

Confirmed:

- **Core key generation is untouched.** `git diff --name-only 2e81894..HEAD -- packages/core/` is empty, so ADR 0006's "preserve derived trade keys" and the plan's "no change to core key generation" both hold.
- **The fingerprint covers an explicit computed-field list.** `annotations` is accepted on `ProjectionInput` but is absent from `fingerprintPayload`, so a label or note change leaves the fingerprint equal, while a changed fee, `avgExit` or exit attribution changes it. `executionIds` are sorted and exits are ordered by execution id, then P&L, then quantity.
- **Canonical JSON is genuinely canonical.** Object keys sorted, `undefined` dropped, numbers written unambiguously (`-0` as `0`, `NaN` and infinities as their canonical spellings) and a total order for numbers. A canonical JSON reorder is therefore equal.
- **Ambiguity never resolves to a winner.** The `ambiguous` variant of `IdentityResolution` carries `candidateIds` and no `tradeId`.
- **Transfers require proof.** An explicit transfer requires an exact set match of execution membership, scoped to the claimed source's account. A shared execution proves nothing: crossing-flat fills return the candidates instead of continuity, exactly as ADR 0006 requires.
- **A foreign key is never adopted.** A key owned by another account resolves to `ambiguous` rather than moving the trade between accounts.
- **Revisions are append-only.** `recordProjectionRevision` requires the revision to be exactly `identity.revision + 1`, and only a proven explicit transfer may move an identity to another account.
- **Tombstones work.** `retireIdentity` sets `state: 'tombstoned'` and releases `current_key`, so the partial unique index admits a new active key and a removed key that reappears gets a new identity.
- **Migration 0002 is correct.** A partial unique index on the active key, a unique `(trade_id, revision)` pair making revisions immutable, the required account and operation indexes, and a primary key on execution evidence. `trade_revision_executions` deliberately has **no** foreign key to `executions`, so revision membership survives the deletion of source fills.

**Deviations recorded by the worker, reviewed and accepted:**

1. Timestamps are UTC epoch milliseconds rather than ISO-8601 text, following the contract review's durable-storage rule and the `journal_migrations.applied_at` precedent. Source and event ISO dates are untouched.
2. `execution_evidence` is created but has no writer yet. The table is allocated to this phase by the phase guide and its schema is in place, but the evidence sidecar is produced where source quality is observed — the later cTrader and importer mapping work. Creating the table without a writer keeps the allocation honest without inventing a producer for it.
3. Two review-driven tightenings beyond the literal plan text, both pinned by tests.

**The worker's own reviews found real defects.** The first read-only review of the implementation diff returned FAIL with ten findings, including that the `exact_key` path did not keep an identity bound to its account, that transfer uniqueness was not account-qualified, and that the supersession link did not reliably record the immediate successor. The second confirmed the ten were genuinely fixed and returned FAIL with three findings sharing one root cause: the two phase markdown files were not Prettier-formatted and the evidence table recorded the formatting check as passing when it had failed. All were fixed and re-verified. This phase ran two diff reviews, within the dispatch's bound.

**Provider outage, recorded for audit.** The first sixteen model calls from this worker failed with HTTP 402 `insufficient_balance_error` followed by HTTP 401 `invalid api key`, exhausting the retry budget at `15:02Z` and leaving the worker unable to act for roughly 7.5 hours. The coordinator diagnosed this from the worker's own session transcript rather than by inference, and did not need to intervene: the worker recovered and completed the phase on its own once the provider balance was restored, delivering `worker_done` at `22:33Z`. The earlier bounded-review rules applied to the work itself.

## 3. Merge

Serialized local non-fast-forward merge in the feature checkout.

- Pre-check: `git merge-tree --write-tree` returned a single clean tree (exit 0). The merge itself reported no conflicts.
- `git merge-base --is-ancestor codex/ai-native-journal-p03 HEAD` → true.
- `git merge-base --is-ancestor 2e81894 HEAD` → true.
- The destination advanced from `5e3651b` to `349c061`; the source tip `2d62c57` is a parent of the merge commit.
- No history rewrite, no force, no reset, no main merge, no push, no PR.

## 4. Post-merge verification on the destination branch

All commands ran in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal` at merge commit `349c061`, Node v24.20.0, pnpm 11.0.8, disposable `JOURNAL_DATA_DIR`. This is the repository's CI sequence.

| Check                                                                                                             | Exit | Result                                            |
| ----------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------- |
| `pnpm exec vitest run` (projection identity, core round-trips, migrations, concurrent-init, connection-lifecycle) | 0    | 5 files, **62 passed**                            |
| `pnpm test` (whole project)                                                                                       | 0    | 88 files, **887 passed \| 1 skipped** (888)       |
| `pnpm --filter web typecheck`                                                                                     | 0    | clean                                             |
| `pnpm --filter @luxalgo/journal-core typecheck`                                                                   | 0    | clean                                             |
| `pnpm --filter @luxalgo/journal-importers typecheck`                                                              | 0    | clean                                             |
| `pnpm exec prettier --check` on every file changed `2e81894..HEAD`                                                | 0    | all matched files use Prettier code style         |
| `pnpm --filter web migrations:check`                                                                              | 0    | migration-checksums.json is up to date            |
| `node scripts/check-licenses.mjs`                                                                                 | 0    | Dependency licenses OK                            |
| `pnpm -r --filter "./packages/*" build`                                                                           | 0    | core and importers built                          |
| `pnpm build` (Next production build)                                                                              | 0    | static build ready at `apps/web/.next/tauri-dist` |

The whole-project suite was run by the coordinator as the designated phase verification owner, on both the candidate before the merge and the destination after it, and not duplicated across child workers. Both runs are green with identical counts — 88 files, 887 passed | 1 skipped.

## 5. Environment-limited check: the root `pnpm typecheck`

The root typecheck still fails only in the `desktop` workspace, with the identical pre-existing host error:

```text
desktop typecheck: error RC2175 : resource file ...\desktop\src-tauri\icons\icon.ico is not in 3.00 format
desktop typecheck: called `Result::unwrap()` on an `Err` value: Failed("RC.EXE failed to compile specified resource file")
```

Unchanged by this phase: `git diff --name-only 2e81894..HEAD -- desktop/` is empty, the icon is git-ignored and host-generated, and the three package typechecks the phase actually touches are clean. This remains **blocked host evidence** — not mocked, not worked around, no threshold lowered — and it continues to block the root-typecheck element of the whole-project gate at G-FINAL until the desktop toolchain is provisioned on this host.

## 6. State

| Dimension   | State                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------- |
| Native task | `task_f9e9b7567e6c` — **completed**, settled by a valid `worker_done` (outcome `succeeded`) |
| Dispatch    | `ctx_9a33af924baf` — settled                                                                |
| Candidate   | complete and committed                                                                      |
| Reviewed    | yes — coordinator review against the exact commits, ADR 0006 and the detailed plan          |
| Integrated  | yes — `349c061`                                                                             |
| Verified    | yes — the full CI sequence is green on the destination branch                               |

## 7. Next

T-004 (Phase 04 — durable outbox, jobs and fencing) is the only phase whose dependency is now satisfied. Its native task `task_6bda9ef55d84` exists and is natively `ready`; **it has not been dispatched**, because a later phase requires an explicit continuation instruction from the user. Phase 04 has not been started.

Phase 04 inherits: the migration runner and its ledger, the frozen 0001 baseline and the new 0002 projection baseline, the deterministic checksum artifact with a CI no-diff check, the Phase 01 connection and transaction seams, and the Phase 03 projection identity with its immutable revision chain. It must append `0003-durable-jobs.ts` forward — never renumber — and it owns the outbox and job tables (`domain_outbox`, `event_deliveries`, `intelligence_jobs`, `intelligence_worker_lease`), which the contract review's mutation-path matrix requires to commit in the same immediate transaction as the financial change they describe.
