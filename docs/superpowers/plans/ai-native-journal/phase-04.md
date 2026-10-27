# Phase 04 — Outbox, durable jobs and fenced worker mechanics

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Implement only this phase. Do not begin Phase 05.

**Goal:** Make a committed trade change _durable_ — it lands in a transactional outbox, fans out
into per-handler deliveries and idempotent jobs, and is executed by a single fenced worker that
cannot commit after its lease or claim was taken away.

**Architecture:** `apps/web/src/server/domain-events.ts` owns the strict event contract.
`apps/web/src/server/domain-event-store.ts` appends an event to the `domain_outbox` table inside
the caller's transaction. `apps/web/src/server/intelligence/contracts/jobs.ts` owns the job
vocabulary and the `JobStore` / `EffectStore` / `WorkerService` ports.
`apps/web/src/server/intelligence/infrastructure/{outbox,jobs,worker}.ts` are the SQLite
adapters: fanout, atomic claims with fencing tokens, and the worker loop. The new tables arrive
as forward migration `0003-durable-jobs.ts`.

**Tech Stack:** Existing TypeScript (strict, `noUncheckedIndexedAccess`), Next.js 15, Drizzle +
better-sqlite3, Zod, Vitest, `node:crypto` UUIDs. **No new dependency.** Schema allocation:
**0003** only.

**Authoritative references:** phase guide Phase 04
(`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), detailed plan Task 4
(`docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md`), design §6/§8, contract
review §2–§6, ADR 0006/0007/0008.

---

## Global constraints

- **Schema allocation: `0003-durable-jobs.ts` only.** Tables: `domain_outbox`,
  `event_deliveries`, `intelligence_jobs`, `intelligence_worker_lease`. No observation,
  knowledge, runtime, workflow or experience table.
- **Forward-only, immutable migrations.** Never edit, renumber or delete `0001-legacy-baseline.ts`
  or `0002-trade-projections.ts`. Append `0003`; regenerate `migration-checksums.json` with
  `pnpm --filter web migrations:build`.
- **No new dependency** → no ADR change, no manifest change, no lockfile change.
- **No route wiring.** Nothing in `apps/web/src/app/**` changes; no mutation path calls this code
  yet. Phase 05 (reconciliation) is the first consumer.
- **Preserve** execution hashes, derived trade keys, annotations, cTrader sync, all three AI
  provider categories, encrypted credentials and every import/AI response contract.
- **No network call, promise or provider call inside a write transaction.** Worker handlers are
  deterministic and DB-only.
- **One implementation writer.** The coordinator has not committed an exact disjoint split, so
  this phase is written by one owner. Reviews are read-only and delegated.
- **Node ≥ 22, pnpm 11.0.8, frozen lockfile.** `pnpm install` is already done; do not reinstall.
- Disposable absolute `JOURNAL_DATA_DIR` and scratch DB files under the OS temp dir. Never use
  ports 3000/3001. Never touch live trader data.

---

## Contracts (authoritative — implement exactly)

### `apps/web/src/server/domain-events.ts` (event contract, no DB imports)

```ts
export type ChangeOrigin = "user" | "broker_sync" | "import" | "system" | "workflow";
export type ChangeMode = "live" | "historical" | "maintenance";
export type TradeChangedKind = "discovered" | "opened" | "closed" | "revised" | "removed";

export interface TradeChanged {
  readonly id: string;
  readonly type: "trade.projection_changed";
  readonly schemaVersion: 1;
  readonly aggregate: { readonly type: "trade"; readonly id: string; readonly revision: number };
  readonly correlationId: string;
  readonly causationId?: string;
  readonly origin: ChangeOrigin;
  readonly recordedAt: string;
  readonly occurredAt?: string;
  readonly payload: {
    readonly accountId: string;
    readonly tradeKey: string;
    readonly kind: TradeChangedKind;
    readonly mode: ChangeMode;
    readonly projectionRevisionId: string;
  };
}

export declare const tradeChangedSchema: z.ZodType<TradeChanged>;
export declare function parseTradeChanged(raw: unknown): TradeChanged;
export declare const MAX_EVENT_PAYLOAD_BYTES: number; // 16 KiB
```

Rules: strict Zod object, `schemaVersion` pinned to `1`, payload capped at 16 KiB of JSON
(contract review §4). The outbox row stores the **envelope columns** (aggregate, correlation,
causation, origin, account) plus the payload JSON — never a blob that must be parsed to find an
account (contract review §6, transactional purge).

### `apps/web/src/server/domain-event-store.ts` (transaction-only append)

```ts
export declare function appendDomainEvent(tx: JournalTx, event: TradeChanged): void;
export declare function listPendingEvents(tx: JournalTx, limit: number): PendingEvent[];
export declare function markEventDispatched(tx: JournalTx, eventId: string, now: number): void;
```

- `appendDomainEvent` validates the event, enforces the payload cap and inserts one
  `domain_outbox` row **inside the caller's transaction** — a rolled-back transaction leaves no
  event (contract review §6: "A failed transaction must not produce a deliverable event").
- The unique key `(aggregate_type, aggregate_id, aggregate_revision, type)` makes the append
  idempotent: one aggregate revision never produces two events ("Events must not be published
  for unchanged trade projections").
- `listPendingEvents` / `markEventDispatched` live here because the event store owns the
  `domain_outbox` table (contract review §2: "persistence to `server/domain-event-store.ts`").
  The fanout adapter in `infrastructure/outbox.ts` calls them, so the arrow from infrastructure
  to the event domain stays one-way.

### `apps/web/src/server/intelligence/contracts/jobs.ts` (ports + vocabulary)

```ts
export type JobStatus = "pending" | "running" | "completed" | "retry_wait" | "failed" | "cancelled";

export type JobPayload =
  | {
      readonly type: "evaluate_trade";
      readonly eventId: string;
      readonly handlerId: string;
      readonly handlerVersion: string;
    }
  | { readonly type: "seed_account"; readonly accountId: string }
  | { readonly type: "run_capability"; readonly runId: string }
  | {
      readonly type: "workflow_effect";
      readonly workflowId: string;
      readonly transitionRevision: number;
    }
  | { readonly type: "retention"; readonly before: number };

export type JobClaim = Readonly<{
  jobId: string;
  owner: string;
  fence: number;
  leaseUntil: number;
}>;

export interface JobRecord {
  readonly id: string;
  readonly type: string;
  readonly payload: JobPayload;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly availableAt: number;
  readonly owner: string | null;
  readonly fence: number;
  readonly leaseUntil: number | null;
  readonly cancelRequested: boolean;
  readonly lastError: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface JobStore {
  enqueue(tx: JournalTx, key: string, payload: JobPayload, availableAt: number): string;
  claim(owner: string, now: number): JobClaim | null;
  renew(claim: JobClaim, now: number): boolean;
  cancel(jobId: string): void;
  fail(claim: JobClaim, code: string, now: number, retryable: boolean): boolean;
  load(jobId: string): JobRecord | null; // additive: JobClaim carries no payload
}

export interface EffectStore {
  assertClaim(tx: JournalTx, claim: JobClaim, now: number): void;
  complete(tx: JournalTx, claim: JobClaim, now: number): void;
}

export interface WorkerHandle {
  stop(): Promise<void>;
}
export interface WorkerService {
  start(signal: AbortSignal): Promise<WorkerHandle>;
}
```

`load` is an **additive** extension of the plan's `JobStore` list: the authoritative `JobClaim`
carries no payload, so a worker cannot dispatch a claimed job without reading it. No listed
signature changes.

### `apps/web/src/server/intelligence/infrastructure/outbox.ts` (fanout)

```ts
export interface OutboxHandler {
  readonly id: string;
  readonly version: string;
}
export interface OutboxDispatcher {
  dispatchOutbox(limit: number, now: number): number;
}
export declare function createOutboxDispatcher(deps: {
  db: JournalDb;
  jobs: JobStore;
  handlers: readonly OutboxHandler[];
}): OutboxDispatcher;
```

`dispatchOutbox(limit, now)` returns the number of events marked dispatched in this call. It
creates one delivery and one job per (event, handler) in **one** immediate transaction.

### `apps/web/src/server/intelligence/infrastructure/jobs.ts` (SQLite adapters)

```ts
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
```

### `apps/web/src/server/intelligence/infrastructure/worker.ts` (worker loop)

```ts
export interface JobHandler {
  readonly id: string; // handler id, e.g. "evaluate_trade"
  readonly version: string;
  run(tx: JournalTx, job: JobRecord): void; // deterministic, DB-only, inside the effect tx
}
export type WorkerState = "disabled" | "idle" | "working" | "blocked" | "stopped";
export interface WorkerStatus {
  readonly state: WorkerState;
  readonly owner: string;
  readonly leaseHeld: boolean;
  readonly leaseUntil: number | null;
  readonly lastHeartbeatAt: number | null;
  readonly processed: number;
  readonly failed: number;
  readonly lastErrorCode: string | null; // sanitized code only
}
export declare function createWorkerService(deps: {
  db: JournalDb;
  jobs: JobStore;
  effects: EffectStore;
  dispatcher: OutboxDispatcher;
  handlers: readonly JobHandler[];
  clock: () => number;
  owner?: string;
  enabled?: boolean;
  pollIntervalMs?: number;
  dispatchLimit?: number;
}): WorkerService & {
  tick(now: number): Promise<boolean>;
  status(): WorkerStatus;
  stop(): Promise<void>;
};
```

The clock and the handler registry are **injected** — no module-level timer, no global clock.

---

## Schema (migration 0003)

The DDL lives in `apps/web/src/db/migrations/0003-durable-jobs.ts` as an exported constant and is
reused verbatim by the final-schema snapshot in `bootstrap.ts`, so the migrated schema and the
declared schema cannot drift.

| Table                       | Columns                                                                                                                                                                                                            | Keys / indexes / constraints                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain_outbox`             | `id` PK, `type`, `schema_version`, `aggregate_type`, `aggregate_id`, `aggregate_revision`, `correlation_id`, `causation_id`, `origin`, `account_id`, `payload_json`, `recorded_at`, `occurred_at`, `dispatched_at` | UNIQUE `(aggregate_type, aggregate_id, aggregate_revision, type)`; index `(dispatched_at, recorded_at, id)`; index `(account_id)`; `origin IN (…)`; `schema_version >= 1` |
| `intelligence_jobs`         | `id` PK, `idempotency_key`, `type`, `payload_json`, `status`, `attempts`, `available_at`, `owner`, `fence`, `lease_until`, `cancel_requested`, `last_error`, `created_at`, `updated_at`                            | UNIQUE `idempotency_key`; index `(status, available_at, id)`; index `(status, lease_until)`; `status IN (…)`; `attempts >= 0`; `fence >= 0`                               |
| `event_deliveries`          | `event_id` → domain_outbox (cascade), `handler_id`, `handler_version`, `state`, `job_id` → intelligence_jobs (set null), `last_error`, `created_at`, `updated_at`                                                  | PRIMARY KEY `(event_id, handler_id, handler_version)`; index `(job_id)`; `state IN ('pending','delivered','failed','cancelled')`                                          |
| `intelligence_worker_lease` | `name` PK, `owner`, `fence`, `lease_until`, `heartbeat_at`                                                                                                                                                         | `name = 'journal-worker'` (CHECK) → exactly one lease row per journal; `fence >= 0`                                                                                       |

Column notes: all new operational timestamps are **UTC epoch milliseconds**; `status`/`state`
values are constrained in SQL; `attempts` and `fence` are non-negative. `event_deliveries.job_id`
is `ON DELETE SET NULL` so pruning a job never erases the delivery diagnostics, and
`domain_outbox.account_id` is a plain indexed column (a logical reference, like the aggregate
reference) so a purge can find the rows without parsing a payload.

---

## Concurrency plan (claim SQL, lease/fence semantics, completion, cancellation, crash)

### 1. Append (same transaction as the authoritative mutation)

```
BEGIN IMMEDIATE
  … the trade mutation, the projection write …
  INSERT INTO domain_outbox (...) ON CONFLICT DO NOTHING   -- unique aggregate/revision/type
COMMIT
```

A crash before commit loses the event with the mutation (correct). A crash after commit leaves a
durable event that a later dispatch picks up.

### 2. Fanout (`dispatchOutbox`)

One immediate transaction per batch:

```
BEGIN IMMEDIATE
  SELECT * FROM domain_outbox WHERE dispatched_at IS NULL ORDER BY recorded_at, id LIMIT :limit
  for each event × handler:
      INSERT INTO intelligence_jobs (id, idempotency_key = eventId:handlerId:handlerVersion, …)
        ON CONFLICT (idempotency_key) DO NOTHING
      INSERT INTO event_deliveries (event_id, handler_id, handler_version, state='pending', job_id)
        ON CONFLICT DO NOTHING
  UPDATE domain_outbox SET dispatched_at = :now WHERE id = :eventId
COMMIT
```

- **Crash before commit** → nothing persisted, the event stays pending, the next dispatch repeats
  the fanout safely (idempotency keys).
- **Crash after commit** → the job exists; a repeated dispatch finds `dispatched_at` set and does
  nothing, so **duplicate dispatch never creates a second job**.
- The `idempotency_key` uniqueness is the durable dedup: the same event delivered to the same
  handler version maps to exactly one job, forever.

### 3. Claim (atomic, fenced)

One guarded statement inside one immediate transaction, so the candidate is selected and claimed
under the same write lock:

```
BEGIN IMMEDIATE
  UPDATE intelligence_jobs
     SET status='running', owner=:owner, fence = fence + 1,
         lease_until = :now + 60_000, attempts = attempts + 1, updated_at = :now
   WHERE id = ( SELECT id FROM intelligence_jobs
                 WHERE cancel_requested = 0
                   AND ( (status IN ('pending','retry_wait') AND available_at <= :now)
                      OR (status = 'running' AND lease_until IS NOT NULL AND lease_until <= :now) )
                 ORDER BY available_at, id LIMIT 1 )
     AND cancel_requested = 0
     AND ( (status IN ('pending','retry_wait') AND available_at <= :now)
        OR (status = 'running' AND lease_until IS NOT NULL AND lease_until <= :now) )
COMMIT
```

- The `BEGIN IMMEDIATE` write lock serializes claimants; the guarded `WHERE` (the same status and
  lease conditions) is the second line of defence, so **two connections can never win the same
  job**.
- The **fence** increments on every claim. It is the generation number of the claim.
- A job whose lease expired (crashed worker) is reclaimable; the new owner gets a **higher
  fence**, so the old owner's later completion is rejected.

### 4. Effect + completion (one transaction)

```
BEGIN IMMEDIATE
  assertClaim(tx, claim, now)   -- owner, fence, status='running', lease_until > now, not cancelled
  handler.run(tx, job)          -- deterministic effect, DB-only, no network
  complete(tx, claim, now)      -- guarded UPDATE … WHERE owner AND fence AND status='running' AND lease_until > now
  UPDATE event_deliveries SET state='delivered' WHERE job_id = :jobId
COMMIT
```

The effect and the acknowledgement commit **together**; a stale worker cannot commit because
`assertClaim`/`complete` re-check owner, fence and lease inside the same transaction.

### 5. Lease and fence constants (contract review §5)

| Constant                   | Value        | Meaning                                                  |
| -------------------------- | ------------ | -------------------------------------------------------- |
| `WORKER_LEASE_MS`          | 30 s         | one worker lease per journal; a second launch is blocked |
| `WORKER_RENEW_INTERVAL_MS` | 10 s         | heartbeat / lease renewal                                |
| `JOB_LEASE_MS`             | 60 s         | a claimed job's lease                                    |
| `JOB_RENEW_INTERVAL_MS`    | 15 s         | renewal for long cancellable work                        |
| `POLL_INTERVAL_MS`         | 1 s          | idle poll                                                |
| `DISPATCH_LIMIT`           | 100          | events per dispatch transaction                          |
| `MAX_JOB_ATTEMPTS`         | 5            | attempts before a job fails terminally                   |
| `JOB_RETRY_DELAYS_MS`      | 1/5/30/120 s | backoff after attempts 1–4; the 5th failure is terminal  |

### 6. Worker lease acquisition (singleton, fenced)

The lease is one row. A worker reads it and then acts on what it read, so the fence moves on with
every takeover:

```
BEGIN IMMEDIATE
  SELECT owner, fence, lease_until FROM intelligence_worker_lease WHERE name = 'journal-worker'
  -- no row            -> INSERT (name, owner, fence=1, lease_until=:now+30_000, heartbeat_at=:now)
  -- own live lease   -> UPDATE ... SET lease_until=:now+30_000, heartbeat_at=:now
  --                     WHERE name AND owner=:owner AND fence=:observed_fence
  -- expired lease    -> UPDATE ... SET owner=:owner, fence=:observed_fence+1,
  --                     lease_until=:now+30_000, heartbeat_at=:now
  --                     WHERE name AND fence=:observed_fence AND lease_until <= :now
COMMIT
```

A live lease owned by somebody else is **not** taken: the second worker stays `blocked` and does
no work. Renewal is guarded by `owner` **and** `fence**, so a worker that lost the lease cannot
heartbeat it back; a takeover moves the fence on, so the old holder's renewal fails.

### 7. Failure, retry and cancellation

- `fail(claim, code, now, retryable)`: guarded by owner + fence + `status='running'`.
  Retryable and `attempts < 5` → `retry_wait` with `available_at = now + backoff(attempts)`;
  otherwise → `failed` (terminal, inspectable via `last_error`). The delivery row moves to
  `failed`.
- Validation/schema errors are **not** retryable → terminal on the first attempt.
- `cancel(jobId)` sets `cancel_requested = 1` and `status='cancelled'`. A worker holding that
  job fails its next `assertClaim` with reason `cancelled` and must not overwrite the
  cancellation; its effect transaction rolls back.
- **Unknown schema** (no registered handler, or a handler version this build does not know) is a
  terminal failure, not a retry loop: the job stays inspectable with a sanitized error code.

### 8. Crash boundaries

| Crash point                          | Result                                                        |
| ------------------------------------ | ------------------------------------------------------------- |
| before the mutation transaction ends | no event, no job — the mutation rolled back                   |
| after commit, before fanout          | the event stays pending and is dispatched later               |
| during fanout, before commit         | nothing persisted; the repeat is safe (idempotency keys)      |
| after fanout commit                  | the job exists exactly once; a repeated dispatch is a no-op   |
| while a job is running               | the lease expires; another owner reclaims with a higher fence |
| after the effect, before the ack     | the whole effect transaction rolls back — no partial effect   |

### 9. What is _not_ built here

No observation table, no knowledge rules, no capability runtime, no scheduler, no supervisor
process, no route wiring, no retention job. Those belong to later phases.

---

## File ownership (exclusive — this phase has one implementation writer)

| Path                                                        | Action                                  |
| ----------------------------------------------------------- | --------------------------------------- |
| `apps/web/src/server/domain-events.ts`                      | create — event contract + strict schema |
| `apps/web/src/server/domain-event-store.ts`                 | create — transactional append + reads   |
| `apps/web/src/server/intelligence/contracts/jobs.ts`        | create — job vocabulary + ports         |
| `apps/web/src/server/intelligence/infrastructure/outbox.ts` | create — fanout dispatcher              |
| `apps/web/src/server/intelligence/infrastructure/jobs.ts`   | create — job/effect SQLite adapters     |
| `apps/web/src/server/intelligence/infrastructure/worker.ts` | create — worker loop + lease            |
| `apps/web/src/db/migrations/0003-durable-jobs.ts`           | create — forward-only migration         |
| `apps/web/src/db/migrations.ts`                             | modify (registry append)                |
| `apps/web/src/db/migration-checksums.json`                  | regenerate                              |
| `apps/web/src/db/schema.ts`                                 | modify (typed mirrors)                  |
| `apps/web/src/db/bootstrap.ts`                              | modify (final-schema snapshot)          |
| `apps/web/src/db/transaction.ts`                            | modify (connection-scoped transaction)  |
| `apps/web/tests/intelligence-outbox.test.ts`                | create — fanout invariants              |
| `apps/web/tests/intelligence-jobs.test.ts`                  | create — claim/fence/retry invariants   |
| `apps/web/tests/intelligence-worker.test.ts`                | create — worker/lease invariants        |
| `apps/web/tests/intelligence-migrations.test.ts`            | modify (phase-03 upgrade fixture)       |
| `docs/superpowers/plans/ai-native-journal/phase-04.md`      | this file                               |
| `docs/superpowers/reports/ai-native-journal-phase-04.md`    | phase report                            |

Read-only for this phase: `packages/**`, `apps/web/src/server/{rebuild,executions,sync,ai*}.ts`,
`apps/web/src/app/**`, `apps/web/src/db/{connection,index}.ts`, `docs/decisions/**`.

`apps/web/src/db/connection.ts` needs no change: `openConnection(directory)` already opens an
independent connection to the same journal file, which is what the worker and the second
connection in the tests need.

---

## Execution order

```
commit plan ─→ write the failing test files ─→ RED RUN (one command) ─→ implement ─→ GREEN RUN ─→ gates ─→ review ─→ report
```

0. **Commit this plan first**:
   `git add docs/superpowers/plans/ai-native-journal/phase-04.md && git commit -m "docs: add Phase 04 outbox and durable job plan"`.
1. Write the three failing test files. No production file is touched yet.
2. Run the single red command and record its output as the phase's red evidence.
3. Implement the event contract, the event store, the job contracts, the three infrastructure
   adapters, the migration, the typed schema, the snapshot, the registry entry and the checksum
   artifact.
4. Update the migration test with the phase-03 upgrade fixture.
5. Re-run the targeted command and the typecheck.

---

## Step 1 — The failing test files

### `apps/web/tests/intelligence-outbox.test.ts`

1. `appendDomainEvent` writes one outbox row with the envelope columns and the payload.
2. A transaction that appends an event and then throws leaves **no** outbox row.
3. Appending the same aggregate revision twice keeps **one** row (idempotent append).
4. An event whose payload exceeds 16 KiB is rejected.
5. An event that fails the strict schema is rejected.
6. `dispatchOutbox` creates one delivery and one job per (event, handler) and marks the event
   dispatched.
7. A **fanout crash before commit** (an aborting SQLite trigger on `intelligence_jobs`) persists
   nothing and leaves the event pending; after the trigger is dropped the same dispatch succeeds
   exactly once.
8. **Duplicate dispatch** creates no second job and no second delivery.
9. The job key is `eventId:handlerId:handlerVersion`.

### `apps/web/tests/intelligence-jobs.test.ts`

1. `enqueue` stores the job and returns its id; the same idempotency key twice returns the same
   id and keeps one row.
2. A claim returns a claim with `fence = 1`; a second claim finds nothing.
3. **Two connections**: connection A claims the job, connection B (a second connection to the
   same file) cannot claim it.
4. An **expired job lease** is reclaimable by another owner with a **higher fence**.
5. The old owner's `complete` throws `StaleClaimError` after the takeover.
6. `renew` extends the lease for the current owner and returns `false` for a stale fence.
7. `assertClaim` rejects a stale owner, a stale fence, an expired lease and a cancelled job.
8. A retryable failure schedules the next attempt with the 1/5/30/120 s backoff; the fifth
   failure is terminal (`failed`).
9. A non-retryable failure is terminal on the first attempt.
10. `cancel` marks the job cancelled; it is not claimable and the delivery records it.

### `apps/web/tests/intelligence-worker.test.ts`

1. The worker acquires the singleton lease and reports its state and heartbeat.
2. A second worker is **blocked** while the lease is live; after the lease expires it takes over
   with a higher fence.
3. A claimed job runs its handler **once**: exactly one effect row is written and the job ends
   `completed` with the delivery `delivered`.
4. A **stale owner's completion throws** — the effect is not written by the old owner.
5. A handler that throws fails the job with the retry backoff; after five attempts the job is
   `failed` and inspectable.
6. An **unknown job type** fails terminally on the first attempt (no retry loop).
7. A cancelled job is not executed and stays `cancelled`.
8. With the worker disabled, the pending job **survives** (the backlog is preserved).
9. `status()` exposes a sanitized state: owner, lease, heartbeat and counters — never a payload.

---

## Red run (binding — the ONLY pre-implementation red run)

- [ ] Run:
      `pnpm exec vitest run apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-worker.test.ts`
      Expected: FAIL — the modules do not exist yet. Record the exact output.

---

## Verification (record exact output in the phase report)

```bash
pnpm exec vitest run apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-worker.test.ts
pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/db-concurrent-init.test.ts
pnpm exec vitest run apps/web/tests/intelligence-boundaries.test.ts
pnpm --filter web typecheck
pnpm --filter web migrations:check
node scripts/check-licenses.mjs
pnpm exec prettier --check <every file this phase touched>
```

The full `pnpm test` suite is the coordinator's phase gate, not this worker's. The root
`pnpm typecheck` reaches the desktop workspace and fails with RC2175 on a git-ignored generated
icon — pre-existing host tooling, recorded as blocked evidence, not a phase failure.

---

## Stop condition

Phase 04 is done when **all** of the following hold.

**Implementation and tests**

- [ ] The red run was executed before any production edit and its failure output is recorded.
- [ ] `apps/web/tests/intelligence-outbox.test.ts` passes.
- [ ] `apps/web/tests/intelligence-jobs.test.ts` passes.
- [ ] `apps/web/tests/intelligence-worker.test.ts` passes.
- [ ] `apps/web/tests/intelligence-migrations.test.ts` and `apps/web/tests/db-concurrent-init.test.ts` pass.
- [ ] `apps/web/tests/intelligence-boundaries.test.ts` passes (the new intelligence tree is legal).
- [ ] `pnpm --filter web typecheck` passes.
- [ ] `pnpm --filter web migrations:check` exits 0 (the committed artifact matches the sources).
- [ ] `node scripts/check-licenses.mjs` reports OK (no new dependency).
- [ ] `pnpm exec prettier --check` reports no violation in the files this phase touched.

**Review**

- [ ] A fresh spec-compliance and code-quality review of this phase's diff has run, and every
      Critical or Important finding is fixed.
- [ ] The repo's reviewer gate is satisfied: `.omp/reviewer-report.md` records this phase's
      verdict as `## Verdict: PASS`.

**Report**

- [ ] `docs/superpowers/reports/ai-native-journal-phase-04.md` is written and committed, with the
      six items the phase guide requires.
- [ ] The report states the base SHA and the tip SHA of this phase's commits.
- [ ] The report records the gates that remain with the coordinator: the full `pnpm test` phase
      gate, the serialized phase→feature merge, and
      `docs/superpowers/reports/ai-native-journal-integration-04.md`.

**Then stop.** Phase 05 (transaction-aware reconciliation) is a separate assignment. Do not merge
to `codex/ai-native-journal`, push, or open a PR — the coordinator owns the integration lock.

---

## Accepted deviations from the letter of the source documents

1. **The job payload carries `handlerId`.** The detailed plan's `evaluate_trade` payload has
   `eventId` + `handlerVersion`; the contract review §4 requires the job key
   `eventId:handlerId:handlerVersion` and a per-handler delivery. Without the handler id in the
   payload a worker cannot route a claimed job to a handler, and the delivery row cannot be
   filled. `handlerVersion` is typed `string` (not the plan's literal `"1"`) because the review
   requires new handler versions to exist and be replayed explicitly.
2. **`JobStore.load` is additive.** The authoritative `JobClaim` has no payload, so a worker
   cannot dispatch a claimed job without reading it. No listed signature changed.
3. **The other four `JobPayload` variants are declared but not produced.** They are the shared
   vocabulary of the plan's job contract; Phase 04 only produces `evaluate_trade`. No handler,
   job type or table is implemented for them.
4. **Two domain-event files, as the coordinator asked.** The packet's area list names
   `server/domain-events.ts`; the detailed plan's Task 4 file list names
   `server/domain-event-store.ts`. Both exist, and each has one job:
   `domain-events.ts` owns the strict event contract (types + Zod schema, no DB import), and
   `domain-event-store.ts` owns the `domain_outbox` table's persistence (the transactional
   append plus the pending/dispatched reads the fanout needs). The contract review §2 puts event
   types in `server/domain-events.ts` and event persistence in
   `server/domain-event-store.ts`, so this split satisfies both source documents.
5. **`db/transaction.ts` gains a connection-scoped seam.** `withJournalTransaction` is bound to
   the app singleton, but a worker claims and acknowledges on its own connection. The new
   `withConnectionTransaction(journal, fn)` takes the connection as an argument; the singleton
   helper now delegates to it, so the synchronous-only contract and the runtime thenable guard
   stay in one place.
6. **A job payload's schema version is its `type` discriminator.** Contract review §4 asks for
   "JSON payloads [that are] schema-versioned, strict, and capped at 16 KiB per event/job". The
   job payload is a strict Zod discriminated union, so the literal `type` pins the shape, and
   `enqueue` refuses a payload over 16 KiB (`MAX_JOB_PAYLOAD_BYTES`). `intelligence_jobs`
   therefore carries no separate `schema_version` column — the plan's schema table lists the
   columns it has, and an always-`1` column would be ceremony.
7. **The job store's audit timestamps use the wall clock.** The plan's `JobStore` port fixes
   `enqueue(tx, key, payload, availableAt)` and `cancel(jobId)` — neither takes a `now` — so
   `created_at` / `updated_at` (audit fields of the write) come from `Date.now()`. Every
   behavioural timestamp (`available_at`, `lease_until`, the retry backoff) uses the injected
   time the caller passes in.
