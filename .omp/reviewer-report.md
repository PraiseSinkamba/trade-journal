## Verdict: PASS

## Reviewer Report — Phase 09 re-review (second run, after the two material fixes)

Scope: only the two previously reported material findings, their fixes, and regression
checking around those fixes. No style-guide reread, no repo-wide exploration, no builds,
tests, linters or formatters executed by this reviewer.

### Previous findings — resolution

- [RESOLVED] Fresh spec/compliance — replay registry widened to the worker handler list.
  Previous report: `composition.ts:168` handed `handlers` (observation **plus** `seed-account`)
  to `createReplayService`, whose contract is `readonly OutboxHandler[]`
  (`jobs.ts:290`); `OutboxHandler` is only `{ id, version }` (`outbox.ts:16-19`), so the wider
  `JobHandler[]` was structurally assignable and `requestReplay` accepted a handler that
  cannot consume the replayed payload (`jobs.ts:352-368` always enqueues
  `{ type: "evaluate_trade", eventId, handlerId, handlerVersion }`, while the seed handler
  only runs `payload.type === "seed_account"`).
  Now: `apps/web/src/server/intelligence/composition.ts:165-168` builds a dedicated
  `outboxHandlers` list containing only `{ id: OBSERVATION_HANDLER_ID, version:
  OBSERVATION_HANDLER_VERSION }` and passes **that** to
  `createReplayService({ db, jobs, handlers: outboxHandlers, clock })`; the worker handler
  list (observation + `seed-account`) is returned separately as `handlers`
  (`composition.ts:164`, `composition.ts:171-173`) and used for worker routing only.
  `requestReplay` therefore rejects any worker-only handler at the validation step
  (`jobs.ts:300-305`, `"Replay handler and version are not registered."`) before any job or
  delivery row is written.
  Covered by `apps/web/tests/intelligence-slice-a.test.ts:199-208`
  ("rejects replay addressed to a worker-only seed handler"): the call throws `"not
  registered"`, and `intelligenceJobs` and `eventDeliveries` are both empty afterwards.

- [RESOLVED] Code quality/scale — per-trade account-wide quality scan made the seed
  quadratic. Previous report: `backfill.ts:118` called
  `qualityContextOf(tx, accountId, sourceRows)` inside the per-trade loop, and that helper
  read every `tradeIdentities` row of the account plus every `tradeProjectionRevisions`
  row and JSON-parsed each current snapshot (`reconcile.ts:189-220`), while the seed only
  ever used `quality.derivedOf(executionIds)` (`recordedOf` was unused).
  Now: `apps/web/src/server/trading/reconcile.ts:155-196` exports a source-only
  `derivedQualityOf(tx, rows)` that contains the evidence-sidecar lookup (chunked at 500)
  and the synthetic-execution classification and nothing else; the private
  `qualityContextOf` (`reconcile.ts:199-244`) now composes it
  (`reconcile.ts:204`) and keeps only the recorded-projection side, so the reconcile path's
  behaviour is unchanged (`reconcile.ts:401` still calls `qualityContextOf(tx, accountId,
  rows)`, `reconcile.ts:455-457` still compares `recordedOf` against `derivedOf`).
  `apps/web/src/server/intelligence/infrastructure/backfill.ts:73-92` loads the batch's
  account-scoped fill rows once (`executionIdsByKey` -> `sourceIds` -> chunked
  `executions` read filtered by `accountId` + `inArray`) and calls
  `derivedQualityOf(tx, sourceRows)` exactly once, **outside** the trade loop; the loop
  body only calls the returned closure (`backfill.ts:137`,
  `projectionOfRow(account, row, derivedQuality(executionIds))`). No identity/revision
  scan and no snapshot parse remains on the seed path — cost is O(batch fills), not
  O(trades x account history).

### Regression checking around the fixes

- [PASS] Replay is still able to reach the observation handler end to end: the replay job
  payload is `evaluate_trade` with `handlerId`/`handlerVersion`
  (`jobs.ts:352-368`), and the worker's `findHandler` resolves `evaluate_trade` by
  `payload.handlerId`/`payload.handlerVersion` against the worker handler list
  (`worker.ts:206-215`), which contains the observation handler with the same id/version
  (`composition.ts:156-164`). The job/delivery identity stays
  `eventId:handlerId:handlerVersion` (`jobs.ts:333`), matching the outbox dispatcher key
  (`outbox.ts:33`), so replay and fanout coalesce on one job.
- [PASS] Seed continuation still routes. The continuation job is enqueued with payload
  `{ type: "seed_account", accountId }` (`backfill.ts:193-199`, strict schema
  `contracts/jobs.ts:32-36`), and the worker resolves `seed_account` to the registered
  `seed-account`/`1` handler (`worker.ts:212-217`, registered at `composition.ts:156-163`),
  which calls `seedAccountInTx(tx, payload.accountId, job.id)` (`composition.ts:159-162`).
  Resume state comes from the durable checkpoint row, not the job payload
  (`backfill.ts:50-58`, `backfill.ts:176-192`).
- [PASS] `createIntelligenceServices` returns the plan's shape
  `{ seedAccount, requestReplay, handlers, outboxHandlers }` (`composition.ts:169-174`)
  and the existing named exports are preserved (`composition.ts:177-189`:
  `seedAccount`, `requestReplay`, `observationHandlers`, `observationOutboxHandlers`).
  `observationHandlers` now also carries the seed handler, which is the intended worker
  registration; the only consumers are the worker/dispatcher wiring in the three
  intelligence suites, where the dispatcher is bound to `outboxHandlers` (observation
  only) and the seed handler is selected by payload type, not by id
  (`intelligence-slice-a.test.ts:83-96`, `intelligence-recovery.test.ts:164-172`).
- [PASS] No financial-rule change: the reconcile diff is a helper extraction plus two
  `export` keywords (`reconcile.ts:155`, `reconcile.ts:287`); trade-key format, P&L,
  fingerprint payload and snapshot payload are untouched. The seed's recorded projection
  is still built by the pre-existing `projectionOfRow` (`reconcile.ts:287-313`).
- [PASS] Source-quality equivalence between the reconcile path and the seed path is
  pinned by `intelligence-slice-a.test.ts:211-232`: for `source_reported`, `reconstructed`
  and `unknown` the seed-produced revision must have the same `fingerprint` and the same
  `snapshotJson` as the reconcile-produced revision. Both paths now read the quality from
  the same shared helper, so the comparison is between one implementation and itself.
- [PASS] Suppression, cancellation, account-deletion and stale-replay semantics of the
  replay service are unchanged by the narrowing (`jobs.ts:306-345`; covered by
  `intelligence-observations.test.ts:691-763`).

### Minor notes (unchanged, non-blocking, carried from the previous report)

- `apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:82-87` — the
  suppressed-checkpoint guard returns before the removal branch, so a removal event for a
  suppressed account leaves an existing active observation active. Defensible as
  "suppressed means frozen", but the ordering should be deliberate.
- `apps/web/src/server/intelligence/infrastructure/worker.ts:212-217` — the seed handler
  id/version are hardcoded (`"seed-account"`, `"1"`) and must be kept in step with
  `composition.ts:157-158` by hand.
- `apps/web/src/server/intelligence/infrastructure/backfill.ts:128-131` and `:177` — an
  `ambiguous` resolution is skipped with `continue` while the cursor still advances to
  `rows.at(-1)?.key`, so such a trade is never revisited and the checkpoint can still
  reach `completed`. Practically unreachable today (trade keys embed `accountId`).

None of these is introduced by the two fixes and none is verdict-driving.

### Observed evidence vs checks not run by this reviewer

Observed parent gate evidence (from `.omp/.reviewer-log`, timestamps in the log):

- `2026-10-29T15:34:10.831Z exit=0  node scripts/check-licenses.mjs && pnpm --filter web
  migrations:check`
- `2026-10-29T15:36:23.793Z exit=0  pnpm test` — full suite, run after the fix edits
  (working-tree mtimes of `composition.ts` and `intelligence-slice-a.test.ts` are
  2026-10-29 15:33-15:34 UTC).

Parent-reported but not independently observed by this reviewer: the fresh targeted gate
over the three intelligence suites (3 files, 31/31 passed, including the three real
child-process kill/reopen scenarios). The count is consistent with the source:
`intelligence-slice-a.test.ts` 12 cases (9 plain + one `it.each` over three qualities),
`intelligence-observations.test.ts` 16 cases (12 plain + two `it.each` over two cases
each), `intelligence-recovery.test.ts` 3 cases — 31 in total.

Not run by this reviewer, and not yet evidenced here: the web/core/importers typechecks
(parent reported as running). This reviewer ran no test, typecheck, lint, formatter or
build, and edited no source file; the findings above are derived from reading the changed
sources and their diffs only.

### Summary

2 previous material findings — both resolved with the fixes cited above
(`composition.ts:165-168` for the replay registry, `reconcile.ts:155-196` +
`backfill.ts:73-92` for the scan); 0 new material findings; 3 pre-existing minor notes
carried unchanged. Verdict: PASS.
