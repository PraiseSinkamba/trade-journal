## Verdict: PASS

## Reviewer Report — Phase 04 (T-004): durable outbox, durable jobs and fenced worker

**Diff reviewed:** `git diff a0e9897..af43482` (base = plan commit `a0e9897`, tip = the phase's
implementation and fix commits), 18 files.

**Post-review repairs (not a new review round).** After this review passed, the coordinator
verified the merged destination and found two defects; both were repaired on the phase branch and
recorded in `docs/superpowers/reports/ai-native-journal-phase-04.md` §4.1:

- `d6df314` — `jobs.ts` failed `prettier --check`. The violation was introduced by `af43482`,
  which landed after this review had read the file, so this review could not have seen it. The
  repair changes one line's wrapping and nothing else.
- `9ca2a55` — `apps/web/tests/trade-projection-identity.test.ts` pinned the applied-migration
  ledger to exactly `[1, 2]`, which this phase's own migration 0003 legitimately makes three. The
  assertion now states the invariant the test names (versions 1 and 2 present, 0001 applied no
  later than 0002, version 2 named `trade-projections`) and no longer pins a count. No production
  code changed.

Neither repair touches a lease, fence, claim, retry, cancellation or completion rule, the job
key, the handler registry, a payload cap or the schema, so the findings above still hold. The
repair's verification: 6 files / 82 tests on the targeted command, 91 files / 929 tests on the
full `pnpm test`, web workspace typecheck, prettier, license and migration-checksum gates — all
PASS.

**Authorities checked:** `docs/orchestration/ai-native-journal/tasks/T-004.md`;
`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md` §2–§6;
`docs/superpowers/plans/ai-native-journal/phase-04.md`; `AGENTS.md`; `.omp/AGENTS.md`;
`.omp/agents/reviewer.md`; `docs/decisions/0007-durable-sqlite-worker-and-migrations.md`.

### PASS / FAIL

**PASS.** The concurrency core is sound: an atomic fenced claim prevents two connections from
winning one job; owner/fence/live-lease guards prevent a stale owner from committing; the effect
and the acknowledgement share one transaction; the outbox append and fanout are transactional and
idempotent; migration 0003 is forward-only and the earlier migration checksums are unchanged. No
reviewer hard block is triggered.

Both earlier review rounds' findings were fixed and re-verified. The second round's three
acceptance issues are resolved: `complete()` now reports the real reason (`expired` included),
the unreachable job-lease renewal branch was removed in favour of judging the acknowledgement
against the time the work actually finished, and the phase plan and the phase report pass the
formatting gate. The phase report now exists.

### Findings

#### PASS — verified against the diff and the authorities

- [PASS] `apps/web/src/server/intelligence/infrastructure/jobs.ts:196-216` and
  `apps/web/tests/intelligence-jobs.test.ts:204-214` — `cancel()` moves the matching
  `event_deliveries` row to `"cancelled"` in the same immediate transaction as the job. The
  regression test fails without the fix because the delivery stays `"pending"`.
- [PASS] `apps/web/src/server/intelligence/infrastructure/worker.ts:249-273` and
  `apps/web/src/server/intelligence/infrastructure/jobs.ts:306-354` — a `StaleClaimError` keeps
  its real reason and is not counted as a handler failure. `complete()` distinguishes cancelled,
  taken-over and expired claims, and the expired case now selects `leaseUntil` so the reason is
  `"expired"` rather than `"stale"`, matching `assertClaim`. Tests assert `failed: 0`,
  `lastErrorCode: "cancelled"` and the `expired` reason for a refused completion.
- [PASS] `apps/web/src/server/intelligence/contracts/jobs.ts:21` and
  `apps/web/src/server/intelligence/infrastructure/jobs.ts:86-95` — the 16 KiB job-payload cap is
  enforced before insertion. The test fails without the fix because the oversized row is stored.
- [PASS] `apps/web/src/server/intelligence/infrastructure/jobs.ts:118-176` — the claim is one
  guarded update inside one `BEGIN IMMEDIATE` transaction and rechecks the candidate predicate.
  The fence increments on every claim, so two real connections cannot win the same job; a
  two-connection test proves it. The five-attempt budget now bounds the reclaim path as well, so
  a worker that keeps crashing cannot reclaim a job for ever.
- [PASS] `apps/web/src/server/intelligence/infrastructure/jobs.ts:306-354` and
  `apps/web/tests/intelligence-jobs.test.ts:255-283` — completion is guarded by owner + fence +
  `running` + not-cancelled + a live lease, and is judged against the time the work actually
  finished. A stale owner cannot complete after a takeover, and a refused acknowledgement rolls
  the effect back with it.
- [PASS] `apps/web/src/server/intelligence/infrastructure/outbox.ts:37-74` — the fanout writes the
  job, the delivery and `dispatched_at` in one immediate transaction. The job key is
  `eventId:handlerId:handlerVersion`; the crash-before-commit and repeated-dispatch tests prove
  no partial and no duplicate fanout.
- [PASS] `apps/web/src/server/domain-event-store.ts:31-56` and
  `apps/web/tests/intelligence-outbox.test.ts:109-117` — the outbox row is appended in the
  caller's transaction; a rollback leaves no event; the aggregate/revision/type unique key makes
  the append idempotent.
- [PASS] `apps/web/src/server/intelligence/infrastructure/worker.ts:109-203` — the worker lease
  is a fenced singleton renewed on its own cadence. A live foreign lease blocks the second
  worker; a takeover increments the fence; the old holder's renewal then fails. A busy journal
  no longer stops the loop, and the worker's status reports a sanitized code only.
- [PASS] `apps/web/src/db/migrations/0003-durable-jobs.ts:25-101` — migration 0003 is
  forward-only and additive, and allocates exactly `domain_outbox`, `event_deliveries`,
  `intelligence_jobs` and `intelligence_worker_lease`. 0001/0002 are untouched and their checksum
  entries are byte-identical.
- [PASS] `apps/web/src/db/bootstrap.ts:209` — the final-schema snapshot reuses `DURABLE_JOBS_SQL`
  verbatim, so the migrated and the declared schema cannot drift. The fresh/upgrade parity test
  and the concurrent-start test pass.
- [PASS] `apps/web/src/server/intelligence/infrastructure/jobs.ts:26-47` — the constants match
  contract review §5 exactly: worker lease 30 s / renew 10 s, job lease 60 s / renew 15 s, poll
  1 s, dispatch 100, 5 attempts, backoff 1/5/30/120 s, lease name `journal-worker`.
- [PASS] `apps/web/src/server/intelligence/infrastructure/jobs.ts:218-252` and
  `apps/web/tests/intelligence-jobs.test.ts:311-341` — retryable failures use the 1/5/30/120 s
  backoff and the fifth failure is terminal; a validation failure is immediate.
- [PASS] `apps/web/src/server/domain-events.ts:70-96` — the event envelope is strict, its schema
  version is pinned and the payload cap is enforced.
- [PASS] boundary — `better-sqlite3` / `drizzle-orm/better-sqlite3` are imported only under
  `apps/web/src/db/**`; the intelligence tree imports a sibling domain only through `contracts/`;
  `packages/core` and `packages/importers` have no app imports and the importers have no raw
  HTTP; `@luxalgo/broker-sdk` is imported only from `apps/web`.
- [PASS] migration rules — 0003 is forward-only; the 0001/0002 sources and checksums are
  unchanged from the base; `pnpm --filter web migrations:check` reports the manifest is current.
- [PASS] no new dependency — the manifests, the lockfile and `docs/decisions/**` are untouched;
  `node scripts/check-licenses.mjs` reports "Dependency licenses OK."
- [PASS] scope and ownership — no route wiring, no composition root, and no file outside the
  phase's ownership table appears in the diff.
- [PASS] plan and code agree — the phase plan's claim SQL, worker lease SQL, schema table and
  accepted-deviations list were amended in the fix commit to match the implementation.
- [PASS] `docs/superpowers/reports/ai-native-journal-phase-04.md` — the phase report now exists
  with the base and tip SHAs, the changed files, the migration impact, the commands actually run,
  the deviations, the review findings and the coordinator-remaining gates.
- [PASS] commit messages — both commits state the solved outcome in plain language and match the
  plan's suggested subject.

### Previous findings — explicit verification

1. **Cancelled delivery recorded.** Implementation
   `apps/web/src/server/intelligence/infrastructure/jobs.ts:196-216`; regression test
   `apps/web/tests/intelligence-jobs.test.ts:204-214`. The test fails without the fix because
   the delivery stays `"pending"`.
2. **The real claim reason is reported, and it is not a handler failure.** Implementation
   `apps/web/src/server/intelligence/infrastructure/worker.ts:249-273` and
   `apps/web/src/server/intelligence/infrastructure/jobs.ts:306-354`; regression tests
   `apps/web/tests/intelligence-worker.test.ts:179-207` and
   `apps/web/tests/intelligence-jobs.test.ts:247-265`. The worker test fails without the worker
   fix (`failed: 1`, `handler_failed`); the jobs test fails without the completion
   classification (the reason would be `"stale"` instead of `"expired"`).
3. **An oversized payload is refused with nothing stored.** Cap
   `apps/web/src/server/intelligence/contracts/jobs.ts:21`; enforcement
   `apps/web/src/server/intelligence/infrastructure/jobs.ts:86-95`; regression test
   `apps/web/tests/intelligence-jobs.test.ts:138-145`. The test fails without the fix because the
   oversized row is inserted.
4. **`complete()` preserves the expired reason.** Implementation
   `apps/web/src/server/intelligence/infrastructure/jobs.ts:320-354` selects `leaseUntil` in the
   fallback diagnostic; regression test
   `apps/web/tests/intelligence-jobs.test.ts:247-265` asserts `/expired/i` for a refused
   completion and `/cancel/i` for a cancelled one.
5. **The unreachable job-lease renewal branch is gone.** The branch was removed; the
   acknowledgement is now judged against `deps.clock()` after the handler returns
   (`apps/web/src/server/intelligence/infrastructure/worker.ts:249-259`), so the lease guard is
   real rather than promised. `JOB_RENEW_INTERVAL_MS` remains exported as the contract's
   constant for the cancellable asynchronous handlers of a later phase.
6. **The formatting gate passes.** `pnpm exec prettier --check` over every file the phase
   touched, including the phase plan and the phase report, reports "All matched files use
   Prettier code style!".

### Commands run

| #  | Exact command                                                                                                                                                                                                                   | Result                                                             |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1  | `pnpm exec vitest run apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-worker.test.ts`                                                                                     | **PASS** — 3 files, 40 tests (4.75 s)                              |
| 2  | `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-boundaries.test.ts`                                                                                                             | **PASS** — 2 files, 24 tests (7.91 s)                               |
| 3  | `pnpm exec vitest run apps/web/tests/db-concurrent-init.test.ts`                                                                                                                                                                 | **PASS** — 1 file, 4 tests (9.16 s)                                 |
| 4  | `pnpm --filter web typecheck`                                                                                                                                                                                                    | **PASS** — exit 0 (`next typegen` + `tsc --noEmit`)                |
| 5  | `pnpm --filter web migrations:check`                                                                                                                                                                                            | **PASS** — "migration-checksums.json is up to date."                |
| 6  | `node scripts/check-licenses.mjs`                                                                                                                                                                                                | **PASS** — "Dependency licenses OK."                                |
| 7  | `pnpm exec prettier --check <every file the phase touched, including the plan and the report>`                                                                                                                                   | **PASS** — "All matched files use Prettier code style!"             |
| 8  | `git diff --exit-code a0e9897..HEAD -- apps/web/src/db/migrations/0001-legacy-baseline.ts apps/web/src/db/migrations/0002-trade-projections.ts` and the checksum entries | **PASS** — migrations 0001/0002 and their checksums are unchanged |
| 9  | boundary sweeps for `better-sqlite3`, intelligence sibling imports, app imports and raw HTTP in `packages/core` / `packages/importers`, and `@luxalgo/broker-sdk` importers                                          | **PASS** — no boundary violation                                    |
| 10 | `git diff --check a0e9897..HEAD`                                                                                                                                                                                                  | **PASS** — no whitespace error                                      |

Not run, by instruction and coordinator ownership: the root `pnpm typecheck` (known unrelated
git-ignored icon failure) and the full root `pnpm test` suite.

### Summary

38 PASS, 0 FAIL, 0 BLOCK.
