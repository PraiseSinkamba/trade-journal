# AI-native journal — Phase 04 integration report

**Phase:** 04 — Outbox, durable jobs and fenced worker mechanics, exercised in tests only
**Stable task:** T-004 · **native task:** `task_6bda9ef55d84` · **dispatch:** `ctx_aa32f5a5ca09` (repair attempt) after `ctx_8e4bf88a2a92` (initial attempt)
**Source branch:** `codex/ai-native-journal-p04`
**Destination branch:** `codex/ai-native-journal` (local feature branch; no main merge, no push, no PR)
**Destination SHA before the phase:** `55315067640b6b0aa852af4b697f873666043216`
**Source tip before the phase merge:** `af434820f932ea3e10f536717bdd67211aca2441` → merge `6541c10c546932032b3944d652ab7ddf0cf172ca`
**Repair tip:** `206beaa7efb1b9776884eccd0d9b5d9467ff2fa0` → merge `f6ea10cfa408a8357c1c51073e8ba68c9d91186d`
**Merge parents:** `6541c10c546932032b3944d652ab7ddf0cf172ca` + `206beaa7efb1b9776884eccd0d9b5d9467ff2fa0`
**Merge base:** `52ccb529227b250c75506431c2a210cb5ced57a8` (the verified feature HEAD after the Phase 03 integration)
**Phase plan:** `docs/superpowers/plans/ai-native-journal/phase-04.md` · **Phase report:** `docs/superpowers/reports/ai-native-journal-phase-04.md`

---

## 1. What was integrated

19 files, +3435 / −214, plus a 4-file repair merge. Schema allocation exactly `0003`. No new dependency, no lockfile change.

| Commit                          | Subject                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `a0e9897`                       | docs: add Phase 04 outbox and durable job plan (committed before implementation)                 |
| `9fa3ffc`                       | feat: add durable outbox and fenced SQLite jobs — the implementation                             |
| `af43482`                       | fix: report the real reason a job was refused and bound the attempt budget                       |
| `9ca2a55`                       | test: assert the projection migration ledger by what it contains, not how many versions it holds |
| `d6df314`                       | style: format the exhausted-job guard to match the repo prettier rules                           |
| `5ccd213`, `3c1dda7`, `206beaa` | docs: record the destination verification, the repairs and their verification                    |

**Delivered behaviour**

- `apps/web/src/server/domain-events.ts` — the `TradeChanged` event contract, no DB imports, `schemaVersion: z.literal(1)`, payload capped at 16 KiB.
- `apps/web/src/server/domain-event-store.ts` — `appendDomainEvent(tx, event)`, `listPendingEvents`, `markEventDispatched`.
- `apps/web/src/server/intelligence/contracts/jobs.ts` — `JobStore`, `EffectStore`, `JobClaim`, `WorkerService`, the payload vocabulary and `MAX_JOB_PAYLOAD_BYTES = 16 * 1024`.
- `apps/web/src/server/intelligence/infrastructure/{outbox,jobs,worker}.ts` — fanout, SQLite adapters, and the fenced worker loop.
- `apps/web/src/db/migrations/0003-durable-jobs.ts` — `domain_outbox`, `event_deliveries`, `intelligence_jobs`, `intelligence_worker_lease`.

## 2. Review outcome

**PASS**, after one repair round. Reviewed by the coordinator against the exact commits, the contract review §4 and §5, and ADR 0007.

Confirmed:

- **Dispatch is one immediate transaction.** `dispatchOutbox(limit, now)` runs a single `{ behavior: "immediate" }` transaction that, for each pending event and each handler, enqueues the job, inserts the delivery row with `onConflictDoNothing`, and marks the event dispatched.
- **The job key is `eventId:handlerId:handlerVersion`**, so a repeated fanout lands on the same job instead of creating a second one. `intelligence_jobs.idempotency_key` is unique.
- **`appendDomainEvent(tx, event)` writes into the caller's transaction**, so a committed trade change leaves its durable event in the same transaction as the change that caused it.
- **Fencing is real.** A reclaimed claim increments the fence (`fence + 1` in SQL for jobs, `current.fence + 1` for the worker lease), and completion calls `assertClaim(tx, claim, now)` inside the effect transaction. A stale owner cannot commit.
- **The constants match the contract review exactly**: `WORKER_LEASE_MS = 30_000`, `WORKER_RENEW_INTERVAL_MS = 10_000`, `JOB_LEASE_MS = 60_000`, `JOB_RENEW_INTERVAL_MS = 15_000`, `POLL_INTERVAL_MS = 1_000`, `JOB_RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000]`.
- **The schema carries the required constraints**: `domain_outbox` unique on `(aggregate_type, aggregate_id, aggregate_revision, type)` with a dispatch index on `(dispatched_at, recorded_at, id)`; `event_deliveries` primary key `(event_id, handler_id, handler_version)` with terminal state diagnostics; `intelligence_jobs` unique `idempotency_key` with indexes on `(status, available_at, id)` and `(status, lease_until)`; `intelligence_worker_lease` keyed by a single name constrained to `journal-worker`.
- **Payloads are strict, schema-versioned and capped** at 16 KiB for both events and jobs, with no raw prompts.
- **The clock and handler registry are injected.** The worker holds no module-level scheduler, and `worker.ts`'s only timer is an abortable backoff sleep inside the loop.

One minor observation, not a finding: `enqueue` and `cancel` stamp `updated_at` with `Date.now()` rather than an injected clock. No lease, fence, claim, retry or completion decision depends on it, so it does not affect correctness — but a test asserting `updated_at` after a cancel cannot use injected time.

### Defects found at destination verification, and their repair

The worker's own targeted gate passed, but the coordinator's destination run was red on two points that only the whole-project gate exposed:

1. **`apps/web/src/server/intelligence/infrastructure/jobs.ts` failed `prettier --check`** (exit 1). The violation was introduced by the worker's own post-review fix commit `af43482`, which landed after its review pass and was therefore never reviewed. Fixed at `d6df314` as a pure line-wrap with no behaviour change.
2. **`apps/web/tests/trade-projection-identity.test.ts` failed in the whole-project suite** — `expected [ 1, 2, 3 ] to deeply equal [ 1, 2 ]`. The assertion pinned the _entire_ applied-migration ledger to exactly two versions, which Phase 04's legitimate forward migration 0003 changed to three. The invariant the test names is that migration 0002 was applied and created the five projection tables, which the following assertions already prove. Fixed at `9ca2a55` so the assertion states its invariant — versions 1 and 2 present via `arrayContaining`, 0001 applied no later than 0002, and version 2 still named `trade-projections` — with no count pinned. It still fails if 0002 is missing, renamed or out of order, and the test was not deleted or weakened into a no-op.

Both defects were routed back to an implementation worker as a replacement attempt on the same native Task; no production semantics were changed.

**Provider resilience.** The initial attempt lost DNS access to `api.minimax.io` part-way through (9 × `ENOTFOUND` plus retry exhaustion) and still completed. The coordinator's supervisor aborted on the first transient error, which was a false alarm; it now counts only new errors and requires three consecutive checks before aborting.

## 3. Merge

Two serialized local non-fast-forward merges in the feature checkout.

- Pre-check: `git merge-tree --write-tree` returned a clean tree (exit 0) before the phase merge; neither merge reported a conflict.
- `git merge-base --is-ancestor codex/ai-native-journal-p04 HEAD` → true.
- The destination advanced `5531506` → `6541c10` (phase) → `f6ea10c` (repair).
- No history rewrite, no force, no reset, no main merge, no push, no PR.

## 4. Post-merge verification on the destination branch

All commands ran in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal` at `f6ea10c`, Node v24.20.0, pnpm 11.0.8, disposable `JOURNAL_DATA_DIR`. This is the repository's CI sequence.

| Check                                                              | Exit | Result                                            |
| ------------------------------------------------------------------ | ---- | ------------------------------------------------- |
| `pnpm exec vitest run` (projection identity, outbox, jobs, worker) | 0    | 4 files, **62 passed**                            |
| `pnpm test` (whole project)                                        | 0    | 91 files, **929 passed** (0 skipped)              |
| `pnpm --filter web typecheck`                                      | 0    | clean                                             |
| `pnpm --filter @luxalgo/journal-core typecheck`                    | 0    | clean                                             |
| `pnpm --filter @luxalgo/journal-importers typecheck`               | 0    | clean                                             |
| `pnpm exec prettier --check` on every file changed `52ccb52..HEAD` | 0    | all matched files use Prettier code style         |
| `pnpm --filter web migrations:check`                               | 0    | migration-checksums.json is up to date            |
| `node scripts/check-licenses.mjs`                                  | 0    | Dependency licenses OK                            |
| `pnpm -r --filter "./packages/*" build`                            | 0    | core and importers built                          |
| `pnpm build` (Next production build)                               | 0    | static build ready at `apps/web/.next/tauri-dist` |

The whole-project suite was run once by the coordinator as the designated phase verification owner, on the destination branch, and not duplicated across child workers. The pre-repair run failed exactly one test; the post-repair run is green.

## 5. Environment-limited check: the root `pnpm typecheck`

The root typecheck still fails only in the `desktop` workspace. The coordinator diagnosed this during Phase 03 and it is recorded in `ai-native-journal-worktrees.json` under `toolingGaps`: a stale shared cargo target artifact pointed at a deleted worktree's icon (now cleared), and two repository defects remain — `desktop/scripts/run-sidecar-setup.js` uses CommonJS `require` in an ESM package, and the icon generator emits an invalid ICO. Both are desktop-tooling defects owned by a later operational phase, they are pre-existing on `main`, and they do not affect this phase: the three package typechecks this phase touches are clean.

## 6. State

| Dimension   | State                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| Native task | `task_6bda9ef55d84` — completed after the repair attempt's valid `worker_done`                        |
| Dispatches  | `ctx_8e4bf88a2a92` (initial attempt, superseded) and `ctx_aa32f5a5ca09` (repair, settled `succeeded`) |
| Candidate   | complete and committed                                                                                |
| Reviewed    | yes — coordinator review against the exact commits, contract review §4/§5 and ADR 0007                |
| Integrated  | yes — `6541c10` then `f6ea10c`                                                                        |
| Verified    | yes — the full CI sequence is green on the destination branch                                         |

## 7. Next

T-005 (Phase 05 — transaction-aware reconciliation for manual and generic ingestion) is the only phase whose dependency is now satisfied. Its native task `task_9eb1b8b7ab2f` exists and is natively `ready`.

Phase 05 inherits: the migration runner with the `journal_migrations` ledger and migrations 0001–0003; the Phase 01 connection and transaction seams, extended by Phase 04 with `withConnectionTransaction`; Phase 04's transactional outbox (`domain-events.ts`, `domain-event-store.ts`, `appendDomainEvent`); and Phase 03's projection identity with its immutable revision chain.

Phase 05 has **no schema allocation** — it adds no table and no migration. It rewires the real mutation paths so that a committed trade change leaves its durable domain event in the same immediate transaction as the change, while external fetch and parsing stay outside it, and while every existing public shape (`insertExecutions`, `rebuildAccount`, `deleteExecutionsForTrades`, `SyncOutcome`, result counts, warnings and API responses) is preserved. The phase guide narrows it to manual and generic ingestion; the broker-specific matrix rows belong to later broker phases and the shared ingestion and rebuild ownership stays serial.
