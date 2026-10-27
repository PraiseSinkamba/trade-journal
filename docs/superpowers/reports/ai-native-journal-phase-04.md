# Phase 04 — Transactional outbox, durable jobs and fenced worker mechanics

> Phase report for the AI-native journal modernization. Source of truth: the phase guide
> (`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), the phase plan
> (`docs/superpowers/plans/ai-native-journal/phase-04.md`), the contract review
> (`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md` §2–§6),
> the task packet (`docs/orchestration/ai-native-journal/tasks/T-004.md`) and ADR 0007.

## 1. Phase ID, baseline, scope

| Item                     | Value                                                                           |
| ------------------------ | ------------------------------------------------------------------------------- |
| Phase                    | 04 — Transactional outbox, durable jobs and fenced worker mechanics, tests only |
| Milestone                | M1                                                                              |
| Stable task / native IDs | T-004 / `task_6bda9ef55d84`                                                     |
| Branch                   | `codex/ai-native-journal-p04` (child of the feature worktree)                   |
| Base SHA                 | `52ccb52` (feature HEAD after the T-003 integration)                            |
| Plan commit              | `a0e9897` — `docs: add Phase 04 outbox and durable job plan`                    |
| Implementation tip       | `9fa3ffc` — `feat: add durable outbox and fenced SQLite jobs`                   |
| Review-fix tip           | `af43482` — the follow-up commit that resolves the review findings              |
| Repair tip               | `9ca2a55` — the two destination-verification repairs (see §4.1)                 |
| Integration destination  | `codex/ai-native-journal` (merged at `6541c10` by the coordinator)              |

**Scope completed.** A committed trade change can now leave a durable domain event in the same
transaction as the change that caused it. A worker turns those events into per-handler deliveries
and jobs exactly once, claims a job atomically under a write lock, and commits the effect
together with its acknowledgement. Every claim carries a fencing token, and every completion is
guarded by that token, so a worker whose lease was taken over can no longer acknowledge the work
it started. One worker holds the journal's lease at a time; a second launch stays blocked until
that lease expires.

**Scope remaining.** None for this phase. Nothing is wired to a route: no reconcile, command or
mutation path calls this code yet, and no composition root assembles the worker — exactly what
the phase asks for ("exercised in tests only").

**Schema allocation used.** `0003-durable-jobs.ts` with the four tables the phase guide
allocates to phase 04: `domain_outbox`, `event_deliveries`, `intelligence_jobs`,
`intelligence_worker_lease`. No observation, knowledge, capability, workflow or retention table
was created — those belong to later phases.

## 2. Changed files and exported interfaces

| File                                                        | Change                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/web/src/server/domain-events.ts`                      | **new** — strict Zod event contract, 16 KiB payload cap                              |
| `apps/web/src/server/domain-event-store.ts`                 | **new** — transactional append + outbox reads                                        |
| `apps/web/src/server/intelligence/contracts/jobs.ts`        | **new** — job vocabulary and the `JobStore` / `EffectStore` / `WorkerService` ports  |
| `apps/web/src/server/intelligence/infrastructure/outbox.ts` | **new** — the fanout dispatcher                                                      |
| `apps/web/src/server/intelligence/infrastructure/jobs.ts`   | **new** — job and effect SQLite adapters                                             |
| `apps/web/src/server/intelligence/infrastructure/worker.ts` | **new** — the worker loop and the singleton lease                                    |
| `apps/web/src/db/migrations/0003-durable-jobs.ts`           | **new** — forward-only migration with the four tables                                |
| `apps/web/src/db/schema.ts`                                 | typed mirrors of the four tables                                                     |
| `apps/web/src/db/migrations.ts`                             | migration 0003 registered in the registry                                            |
| `apps/web/src/db/bootstrap.ts`                              | final-schema snapshot reuses the 0003 DDL verbatim                                   |
| `apps/web/src/db/migration-checksums.json`                  | regenerated — adds the 0003 entry; 0001/0002 unchanged                               |
| `apps/web/src/db/transaction.ts`                            | added `withConnectionTransaction(journal, fn)`; the singleton helper delegates to it |
| `apps/web/tests/intelligence-outbox.test.ts`                | **new** — 12 invariant cases                                                         |
| `apps/web/tests/intelligence-jobs.test.ts`                  | **new** — 17 invariant cases                                                         |
| `apps/web/tests/intelligence-worker.test.ts`                | **new** — 11 invariant cases                                                         |
| `apps/web/tests/intelligence-migrations.test.ts`            | Phase-03 upgrade fixture for the 0003 tables                                         |
| `apps/web/tests/trade-projection-identity.test.ts`          | repaired — the ledger assertion now names its invariant instead of the ledger's size |
| `docs/superpowers/plans/ai-native-journal/phase-04.md`      | phase plan (committed before the implementation), amended so plan and code agree     |
| `docs/superpowers/reports/ai-native-journal-phase-04.md`    | this report                                                                          |

**Exported interfaces** (the phase's required contracts):

```ts
// apps/web/src/server/domain-events.ts
export type TradeChanged = Readonly<{ … }>;
export declare const MAX_EVENT_PAYLOAD_BYTES: number; // 16 KiB
export declare function parseTradeChanged(raw: unknown): TradeChanged;

// apps/web/src/server/domain-event-store.ts
export declare function appendDomainEvent(tx: JournalTx, event: TradeChanged): void;
export declare function listPendingEvents(tx: JournalTx, limit: number): PendingEvent[];
export declare function markEventDispatched(tx: JournalTx, eventId: string, now: number): void;

// apps/web/src/server/intelligence/contracts/jobs.ts
export type JobStatus = "pending" | "running" | "completed" | "retry_wait" | "failed" | "cancelled";
export type JobPayload = /* strict discriminated union */;
export type JobClaim = Readonly<{ jobId: string; owner: string; fence: number; leaseUntil: number }>;
export interface JobStore {
  enqueue(tx: JournalTx, key: string, payload: JobPayload, availableAt: number): string;
  claim(owner: string, now: number): JobClaim | null;
  renew(claim: JobClaim, now: number): boolean;
  cancel(jobId: string): void;
  fail(claim: JobClaim, code: string, now: number, retryable: boolean): boolean;
  load(jobId: string): JobRecord | null;
}
export interface EffectStore {
  assertClaim(tx: JournalTx, claim: JobClaim, now: number): void;
  complete(tx: JournalTx, claim: JobClaim, now: number): void;
}
export interface WorkerService { start(signal: AbortSignal): Promise<WorkerHandle>; }

// apps/web/src/server/intelligence/infrastructure/jobs.ts
export declare function createJobStore(db: JournalDb): JobStore;
export declare function createEffectStore(): EffectStore;
export declare class StaleClaimError extends Error {
  readonly reason: "stale" | "expired" | "cancelled";
}
export declare const WORKER_LEASE_MS: number; // 30_000
export declare const WORKER_RENEW_INTERVAL_MS: number; // 10_000
export declare const JOB_LEASE_MS: number; // 60_000
export declare const JOB_RENEW_INTERVAL_MS: number; // 15_000
export declare const POLL_INTERVAL_MS: number; // 1_000
export declare const DISPATCH_LIMIT: number; // 100
export declare const MAX_JOB_ATTEMPTS: number; // 5
export declare const JOB_RETRY_DELAYS_MS: readonly number[]; // [1_000, 5_000, 30_000, 120_000]
export declare const WORKER_LEASE_NAME: string; // "journal-worker"

// apps/web/src/server/intelligence/infrastructure/outbox.ts
export interface OutboxHandler { readonly id: string; readonly version: string; }
export interface OutboxDispatcher { dispatchOutbox(limit: number, now: number): number; }
export declare function createOutboxDispatcher(deps: {
  db: JournalDb; jobs: JobStore; handlers: readonly OutboxHandler[];
}): OutboxDispatcher;

// apps/web/src/server/intelligence/infrastructure/worker.ts
export interface JobHandler {
  readonly id: string;
  readonly version: string;
  run(tx: JournalTx, job: JobRecord): void;
}
export declare function createWorkerService(deps: {
  db: JournalDb; jobs: JobStore; effects: EffectStore; dispatcher: OutboxDispatcher;
  handlers: readonly JobHandler[]; clock: () => number;
  owner?: string; enabled?: boolean; pollIntervalMs?: number; dispatchLimit?: number;
}): WorkerService & { tick(now: number): Promise<boolean>; status(): WorkerStatus; stop(): Promise<void> };
```

**The concurrency contract, as implemented.**

- **Append.** `appendDomainEvent` writes one `domain_outbox` row inside the caller's
  transaction. A rolled-back transaction leaves no event. The unique key
  `(aggregate_type, aggregate_id, aggregate_revision, type)` makes the append idempotent.
- **Fanout.** `dispatchOutbox` writes the job, the delivery and `dispatched_at` in **one**
  immediate transaction. The job key is `eventId:handlerId:handlerVersion`, so a repeated fanout
  lands on the same job. A crash before the commit persists nothing; the repeat is safe.
- **Claim.** One guarded `UPDATE` inside one `BEGIN IMMEDIATE` transaction: the candidate is
  selected and claimed under the same write lock, and the eligibility predicate is re-checked in
  the `WHERE`. The fence increments on every claim, so two connections can never win one job.
- **Effect and completion.** `assertClaim` → `handler.run` → `complete` share one transaction,
  so the effect and the acknowledgement commit together or not at all. The completion is guarded
  by owner + fence + `running` + not-cancelled + a live lease, and is judged against the time the
  work actually finished.
- **Worker lease.** One row, named by a `CHECK` constraint. A worker renews the lease it holds on
  the 10 s cadence; a worker that finds an expired lease takes it over at a higher fence; a live
  lease owned by somebody else is never taken, so the second worker stays `blocked`.
- **Retry.** A retryable failure schedules the next attempt with the 1/5/30/120 s backoff; the
  fifth attempt is terminal. A validation error is terminal on the first attempt. A job that used
  up its attempts is terminal however it got there — including a worker that kept crashing
  before it could report a failure.

**What is deliberately not built.** No observation table, no knowledge rules, no capability
runtime, no scheduler, no supervisor process, no route wiring, no retention job, no composition
root. Those belong to later phases.

## 3. Migration, schema and rollback impact

| Item            | Value                                                                                 |
| --------------- | ------------------------------------------------------------------------------------- |
| Migration       | `0003-durable-jobs.ts` — forward-only, additive, never renumbered                     |
| Tables          | `domain_outbox`, `event_deliveries`, `intelligence_jobs`, `intelligence_worker_lease` |
| Registry        | `SOURCES` in `db/migrations.ts` gains the 0003 entry                                  |
| Snapshot parity | `BOOTSTRAP_SQL` reuses `DURABLE_JOBS_SQL` verbatim, so the two cannot drift           |
| Checksums       | `migration-checksums.json` regenerated; 0001 and 0002 entries byte-identical          |
| Typed schema    | four mirrors added to `db/schema.ts`                                                  |
| Rollback        | additive tables only — an older binary keeps working, and no data is rewritten        |

**Upgrade paths are covered, not assumed.** The migration test now builds a **Phase-03 journal**
(ledger at version 2, no durable-job tables) and proves that 0003 creates the four tables,
advances the ledger to the latest version and leaves the existing rows untouched. The Phase-02
fixture drops the 0003 tables as well, so it really is a two-phase-old journal. The
fresh-versus-upgraded schema fingerprint comparison and the six-way concurrent-start test both
pass, so two processes racing to open a fresh journal still converge on one schema.

**Rollback** means stopping the worker and deploying the prior application with the additive
tables retained. Nothing in this phase rewrites keys, execution hashes, credentials or imported
financial data, so an older binary can still open the journal. The 0003 tables may be dropped
manually after the rollback if the operator chooses; nothing depends on them yet.

## 4. Commands actually run

Every command below was run in this worktree against the phase's code.

| #   | Command                                                                                                                                               | Result                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | `pnpm exec vitest run apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-worker.test.ts` | **PASS** — 3 files, 40 tests (4.75 s)                   |
| 2   | `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-boundaries.test.ts`                                  | **PASS** — 2 files, 24 tests (7.91 s)                   |
| 3   | `pnpm exec vitest run apps/web/tests/db-concurrent-init.test.ts`                                                                                      | **PASS** — 1 file, 4 tests (9.16 s)                     |
| 4   | `pnpm --filter web typecheck`                                                                                                                         | **PASS** — exit 0, `next typegen` + `tsc --noEmit`      |
| 5   | `pnpm --filter web migrations:check`                                                                                                                  | **PASS** — "migration-checksums.json is up to date."    |
| 6   | `node scripts/check-licenses.mjs`                                                                                                                     | **PASS** — "Dependency licenses OK."                    |
| 7   | `pnpm exec prettier --check <every file the phase touched>`                                                                                           | **PASS** — "All matched files use Prettier code style!" |

The red run is recorded too: before any production file existed, the three new test files failed
with "Cannot find module" for the modules they exercise. That is the phase's red evidence.

### 4.1 Destination verification and the two repairs

The coordinator merged this phase into `codex/ai-native-journal` at `6541c10` and then verified the
destination. That verification found two defects, both in the phase's own output rather than in
its behaviour, and both were repaired on this branch:

**Defect 1 — a formatting-gate violation in a file this phase owns.**
`apps/web/src/server/intelligence/infrastructure/jobs.ts` failed `prettier --check` with exit 1.
The violation was introduced by the post-review fix commit `af43482`, which landed after the
review pass had already read the file, so the review could not have caught it. The repair ran
prettier over the file and changed nothing but the line wrapping of the exhausted-job guard:
`d6df314` — `style: format the exhausted-job guard to match the repo prettier rules`. The file's
behaviour is unchanged; the gate now exits 0.

**Defect 2 — a test pinned the ledger's length instead of its contents.**
The full suite failed exactly one test:

```
apps/web/tests/trade-projection-identity.test.ts
  > projection schema > applies migration 0002 and creates the five projection tables
  AssertionError: expected [ 1, 2, 3 ] to deeply equal [ 1, 2 ]
```

The assertion compared the whole applied-migration ledger to exactly `[1, 2]`. This phase's own
migration `0003` legitimately makes it three, so the assertion was incidental over-specification,
not a broken invariant: the invariant the test names is that migration 0002 was applied and
created the five projection tables. The repair asserts what the test actually claims — that
versions 1 and 2 are present, that 0001 was applied no later than 0002, and that version 2 is
still named `trade-projections`. It no longer asserts the ledger's length and no longer
hard-codes a count, so the next phase's migration does not break a test that was never about it.
The test still fails if 0002 is missing, renamed or out of order, and the five table assertions
below it are unchanged: `9ca2a55` — `test: assert the projection migration ledger by what it
contains, not how many versions it holds`. No production code changed for this defect.

**The repair's verification** (run in this worktree against the repair tip `9ca2a55`, with a
disposable absolute `JOURNAL_DATA_DIR` under the checkout; the full suite was re-run once more
against the final tip `5ccd213` with the same result):

| #   | Command                                                                                                                                                                                                                                                                                         | Result                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| R1  | `pnpm exec vitest run apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-worker.test.ts apps/web/tests/intelligence-migrations.test.ts apps/web/tests/db-concurrent-init.test.ts apps/web/tests/trade-projection-identity.test.ts` | **PASS** — 6 files, 82 tests (16.11 s)                  |
| R2  | `pnpm test`                                                                                                                                                                                                                                                                                     | **PASS** — 91 files, 929 tests (125.86 s)               |
| R3  | `pnpm --filter web typecheck`                                                                                                                                                                                                                                                                   | **PASS** — exit 0                                       |
| R4  | `pnpm exec prettier --check <every file this repair changed>`                                                                                                                                                                                                                                   | **PASS** — "All matched files use Prettier code style!" |
| R5  | `node scripts/check-licenses.mjs`                                                                                                                                                                                                                                                               | **PASS** — "Dependency licenses OK."                    |
| R6  | `pnpm --filter web migrations:check`                                                                                                                                                                                                                                                            | **PASS** — "migration-checksums.json is up to date."    |

The repair's production diff is one line-wrap in `jobs.ts`; the only other source change is the
one assertion in `trade-projection-identity.test.ts`. No lease, fence, claim, retry, cancellation
or completion rule, no job key, no handler registry, no payload cap and no schema was touched.
The boundary and immutability sweeps still hold: `packages/core` and `packages/importers` import
nothing across the dependency direction and contain no raw HTTP call, migrations 0001 and 0002 and
their checksum entries are byte-identical, and `git diff --check` reports no whitespace error.

**Not run, and why.**

- The root `pnpm typecheck` fails in the `desktop` workspace, which this phase does not touch. The
  failure is desktop tooling, not phase code: the Tauri build script wants two git-ignored
  artifacts that a fresh checkout does not have — the Node sidecar binary
  (`desktop/src-tauri/binaries/node-x86_64-pc-windows-msvc.exe`) and the built web bundle the
  desktop resource path points at. The sidecar was fetched during the repair run; the desktop
  resource path still needs a packaged web build, and the icons are generated by
  `pnpm icons`. Neither belongs to this phase, and no file under `desktop/`, `packages/` or
  `apps/web/src/app/` changed in it. The web workspace — the workspace this phase changed —
  typechecks clean.
- No Docker, Tauri or packaged-deployment check was run: this phase changes no deployment
  artifact, and the deployment checks belong to the supervisor phase.
- The full root `pnpm test` suite is now recorded in §4.1 (R2). The coordinator still runs the
  full sequence once on the destination branch after this repair is merged.

## 5. Deviations, review findings and unresolved risks

**Deviations** (all recorded in the phase plan's "Accepted deviations" list).

1. **The job payload carries `handlerId`.** The detailed plan's `evaluate_trade` payload has
   `eventId` + `handlerVersion`; the contract review §4 requires the job key
   `eventId:handlerId:handlerVersion` and a per-handler delivery. Without the handler id a worker
   cannot route a claimed job, and the delivery row cannot be filled. `handlerVersion` is typed
   `string` (not the plan's literal `"1"`) because the review requires new handler versions to
   exist and be replayed explicitly.
2. **`JobStore.load` is additive.** The authoritative `JobClaim` has no payload, so a worker
   cannot dispatch a claimed job without reading it. No listed signature changed.
3. **The other four `JobPayload` variants are declared but not produced.** They are the shared
   vocabulary of the plan's job contract; Phase 04 only produces `evaluate_trade`. No handler,
   job type or table is implemented for them.
4. **Two domain-event files, as the coordinator asked.** The packet's area list names
   `server/domain-events.ts`; the detailed plan's Task 4 file list names
   `server/domain-event-store.ts`. Both exist and each has one job: `domain-events.ts` owns the
   strict event contract (types + Zod schema, no DB import), `domain-event-store.ts` owns the
   `domain_outbox` table's persistence. The contract review §2 puts event types in
   `server/domain-events.ts` and event persistence in `server/domain-event-store.ts`, so this
   split satisfies both source documents.
5. **`db/transaction.ts` gains a connection-scoped seam.** `withJournalTransaction` is bound to
   the app singleton, but a worker claims and acknowledges on its own connection. The new
   `withConnectionTransaction(journal, fn)` takes the connection as an argument; the singleton
   helper now delegates to it, so the synchronous-only contract and the runtime thenable guard
   stay in one place.
6. **A job payload's schema version is its `type` discriminator.** Contract review §4 asks for
   payloads that are "schema-versioned, strict, and capped at 16 KiB per event/job". The job
   payload is a strict Zod discriminated union, so the literal `type` pins the shape, and
   `enqueue` refuses a payload over 16 KiB. `intelligence_jobs` therefore carries no separate
   `schema_version` column — the plan's schema table lists the columns it has, and an
   always-`1` column would be ceremony.
7. **The job store's audit timestamps use the wall clock.** The plan's `JobStore` port fixes
   `enqueue(tx, key, payload, availableAt)` and `cancel(jobId)` — neither takes a `now` — so
   `created_at` / `updated_at` come from `Date.now()`. Every behavioural timestamp
   (`available_at`, `lease_until`, the retry backoff) uses the injected time.

**Review findings raised against this phase and how they were resolved.** Two independent
read-only reviews were run over the implementation diff, the maximum the dispatch allows. The
first returned **FAIL** with three findings; the second confirmed all three were genuinely fixed
and returned **FAIL** with three further findings. Every finding from both rounds was fixed and
re-verified; the full list is in `.omp/reviewer-report.md`.

First round:

- _A cancelled job left its delivery row looking undelivered forever._ Fixed: `cancel()` now
  moves the matching `event_deliveries` row to `cancelled` inside the same transaction as the
  job. A test asserts the delivery's state.
- _The worker reported a cancelled or taken-over claim as a handler failure._ Fixed: the worker
  keeps the claim's real reason and does not count it as a failure, and `complete()` now
  distinguishes cancelled, taken-over and expired. A test asserts `failed: 0` and
  `lastErrorCode: "cancelled"`.
- _A job payload over 16 KiB was stored instead of refused._ Fixed: `MAX_JOB_PAYLOAD_BYTES`
  (16 KiB) is enforced in `enqueue` before the insert. A test asserts the oversized payload is
  refused and that no row is written.

Second round:

- _`complete()` misclassified an expired claim as stale._ Fixed: the fallback diagnostic reads
  the lease expiry as well, so an expired claim is reported as `expired`, matching
  `assertClaim`. A test asserts the reason for a refused completion.
- _The job-lease renewal branch was unreachable._ Fixed by removing it. The branch could never
  fire — a claim always carries a full lease — so the code promised a protection it could not
  provide. The completion is now judged against the time the work actually finished, which makes
  the lease guard real: work that outlived its lease is refused rather than silently
  acknowledged. `JOB_RENEW_INTERVAL_MS` remains exported as the contract's constant for the
  cancellable asynchronous handlers of a later phase.
- _The phase plan failed the Prettier gate._ Fixed: the plan is formatted and the check now
  passes on every file the phase touched.

Notes from both rounds that were also addressed: the worker now renews its lease on the 10 s
cadence instead of on every poll, a busy journal no longer stops the worker loop, the plan's
schema table documents `occurred_at`, and the plan records the job-payload schema-version and
audit-timestamp decisions as deviations.

One note was resolved as a behaviour change rather than a note: a job whose worker kept crashing
before it could report a failure could be reclaimed without bound, because the five-attempt
budget was only enforced for handler failures. The attempt budget now applies to every path — a
job that used up its attempts is terminal however it got there — and a test proves it.

**Findings from the coordinator's destination verification.** After the phase was merged into
`codex/ai-native-journal` at `6541c10`, the coordinator verified the destination and found two
defects. Both were repaired in §4.1 and neither touched production behaviour:

- _A formatting-gate violation in `jobs.ts`._ The post-review fix commit landed after the
  review had read the file, so the review could not have caught it. Fixed by `d6df314`; the
  guard's line wrapping changed and nothing else.
- _A test pinned the applied-migration ledger's length._ The assertion `toEqual([1, 2])` broke
  the moment this phase's own migration 0003 made the ledger three versions long. Fixed by
  `9ca2a55`: the assertion now states the invariant the test names — versions 1 and 2 are
  present, 0001 was applied no later than 0002, and version 2 is still named `trade-projections`
  — and no longer pins a count. No production code changed.

The coordinator confirmed the phase's semantics against the contract review during the same
verification: the lease, fence, claim, retry, cancellation and completion rules, the job key,
the handler registry, the payload caps and the schema are correct and were not touched by the
repair.

**Unresolved risks.**

- The outbox, the job store and the worker are seams: no mutation path appends an event yet, and
  no composition root assembles a worker. The phase explicitly asks for the mechanics without
  wiring, and every rule they enforce is pinned by tests here. **Does not block the next phase.**
- The job-lease _renewal_ during a long-running job is not implemented: the handlers are
  synchronous and DB-only, so a job cannot outlive its 60 s lease inside one tick without the
  completion being refused. The renewal cadence belongs with the cancellable asynchronous
  handlers of a later phase, and `JobStore.renew` is already there for it. **Does not block the
  next phase.**
- A journal migrated by a newer application cannot be opened by an older binary — the intended
  forward-only behaviour. Rollback needs the backup procedure, not a binary swap alone. **Does
  not block the next phase.**
- The continuous-integration stale-artifact gate still lands with T-021. The runtime refuses a
  journal whose checksum no longer matches with a loud `checksum-mismatch`, so the failure is
  not silent. **Does not block the next phase.**

## 6. Next-phase handoff (Phase 05 inputs)

Phase 05 (transaction-aware reconciliation and the command layer) needs, and now has:

- A committed, checksummed migration 0003 and a working registry/checksum pipeline: phase 05's
  allocation follows the same pattern (a new file in `apps/web/src/db/migrations/`, an entry in
  `SOURCES`, a typed mirror in `apps/web/src/db/schema.ts`, an entry in the final-schema
  snapshot, and a regenerated checksum artifact).
- `appendDomainEvent(tx, event)` and the strict `TradeChanged` contract: the seam a reconcile
  path calls inside its mutation transaction, so an event is committed with the change that
  caused it.
- A transaction seam that works on any connection: `withJournalTransaction` for the app
  singleton, `withConnectionTransaction(journal, fn)` for a worker or a batch that owns its own
  connection.
- The phase's verification evidence: this report and the reviewer verdict in
  `.omp/reviewer-report.md`.

**Not started here:** Phase 05 (reconcile and the command layer that appends the events), the
composition root that assembles a worker, the supervisor process, and the
continuous-integration wiring of `migrations:check` (T-021).

**Still with the coordinator, not claimed by this phase:** the serialized phase→feature merge of
this repair into `codex/ai-native-journal` (the phase itself was merged at `6541c10`; the repair
commits `d6df314` and `9ca2a55` still need to land), the full CI sequence on the destination
branch, and `docs/superpowers/reports/ai-native-journal-integration-04.md`.
