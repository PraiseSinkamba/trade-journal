# Phase 09 — Historical seed, replay and no-provider recovery

## Outcome and commit identity

Implemented restartable historical discovery, durable replay and provider-free recovery. Real SQLite child-process kills prove rollback and same-job recovery at event dispatch, observation acknowledgement and seed continuation boundaries.

- Branch: `codex/ai-native-journal-p09`.
- Base: `db56d3671b1e6fbfdc92e4cdc039b45cff001386`.
- Plan committed before implementation: `a3cbda0`.
- Reviewed implementation: `b6c8a83dd7aff54f1951a29e94e6a3f09004196d`.
- Native task: `task_5b7ff94b51b9`; dispatch: `ctx_9d8af8f668f6`; stable packet: T-009.
- This report is a documentation-only successor to the implementation commit. The coordinator owns the final local non-fast-forward integration and integration report.

## Changed files and ownership

Four micro-agents worked in the same existing checkout, with no overlapping writable paths. No micro-agent ran Git, installs, builds, tests, formatters or migrations. The parent became the sole writer after all four joined.

- SeedBaseline: `apps/web/src/server/intelligence/infrastructure/backfill.ts`; `apps/web/tests/intelligence-slice-a.test.ts`.
- ReplayEffects: `apps/web/src/server/intelligence/infrastructure/jobs.ts`; `apps/web/src/server/intelligence/infrastructure/knowledge-store.ts`; `apps/web/tests/intelligence-observations.test.ts`.
- WireSeed: `apps/web/src/server/intelligence/composition.ts`; `apps/web/src/server/intelligence/infrastructure/worker.ts`; `apps/web/src/server/trading/reconcile.ts`.
- KillRecovery: `apps/web/tests/intelligence-recovery.test.ts`.
- Parent: phase plan, consolidation corrections, this report and verification. Independent reviewer wrote `.omp/reviewer-report.md`, committed with the implementation.

Coordinator approval `msg_1610c80bc753` authorized worker routing and existing reconcile helper exports. Approval `msg_8f459a7454f3` additionally authorized behavior-preserving extraction of source-only timing quality.

## Delivered behavior

- `seedAccount(accountId, operationId): ReconcileResult` processes one bounded account batch, default 100 trades. It reads persisted projections, current revisions and checkpoint inside one immediate transaction. Events, cursor advancement and continuation jobs commit together.
- Existing running checkpoints retain their original baseline operation. Completed and explicitly suppressed checkpoints do not restart. Missing accounts produce no output. Account deletion removes the checkpoint through the existing foreign key.
- Mapped current revisions are reused, not rewritten. Capture-off mapped state without an event gets historical discovery against its existing revision. Existing mutation events remain unchanged. Baseline open and closed trades are `discovered`, never live closure announcements.
- Source-only timing classification runs once per account batch, outside the trade loop. Reconciliation retains its previous recorded-quality comparison and financial behavior. Fingerprint/snapshot equivalence tests cover source-reported, reconstructed and unknown quality.
- `requestReplay(eventId, handlerId, handlerVersion): string` is a trusted operational service seam, not a route or model tool. It validates the outbox handler registry, event and account. Worker-only seed handlers, cancelled work, deleted accounts and suppressed accounts are rejected.
- Replay uses the original event/handler/version job key, job ID and delivery triple. Pending/running/retry work coalesces. Failed/completed work restarts under the same ID with an incremented fence. Existing observation and evidence uniqueness keys prevent duplicate business effects.
- Observation persistence rejects suppressed accounts inside the effect transaction, alongside current-revision and account fences. Stale correction/removal events cannot revive prior observations.
- Injected `createIntelligenceServices` binds independent database connections; default named exports remain synchronous. Existing strict seed payload is unchanged. Imports start no worker. No provider access or network calls occur inside write transactions.

## Runtime smoke and recovery evidence

All data was synthetic and stored in disposable absolute temporary directories. No live trader data or keys were read. Child environments retain only OS plumbing, `NODE_ENV=test` and their isolated `JOURNAL_DATA_DIR`; they inherit no provider keys or runtime hooks.

The recovery suite bundles the real application using the already-installed transitive esbuild dependency. A provider resolver guard throws on any access; a deliberate probe proves the guard is armed, then each recovery path asserts zero accesses. SQLite triggers synchronously pause the real worker at its transaction boundary; the parent waits for a readiness record, sends SIGKILL, waits for process exit, reopens the same file and resumes the real worker.

1. Kill after trade/event commit, before dispatch commit: the event survives, uncommitted job insertion rolls back, and reopened worker creates the observation/evidence.
2. Kill after real observation/evidence writes, before acknowledgement: uncommitted effects roll back; reopened worker reclaims the same job at a higher fence and commits exactly one effect.
3. Kill during the next seed batch, before acknowledgement: the first committed cursor/event/continuation survives; interrupted cursor/effects roll back; reopened worker resumes the same continuation and discovers all historical trades.
4. Another reopen and explicit duplicate replay preserve the same observation/evidence identities, events, revisions and financial rows.

## Executed gates

Commands ran at the consolidation barrier. Node v24.20.0, pnpm 11.0.8, Vitest 3.2.7. No installation or lockfile change was needed. Durations below are observed runner times or tool wall times, as labeled.

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Exit | Result                                                                                         | Runtime                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| `pnpm exec vitest run apps/web/tests/intelligence-slice-a.test.ts apps/web/tests/intelligence-recovery.test.ts apps/web/tests/intelligence-observations.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                              | 0    | 3 files, 31 tests passed                                                                       | 11.59 s Vitest                 |
| `pnpm --filter web typecheck && pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 0    | Web route type generation/TypeScript, core and importers passed                                | 25.10 s wall                   |
| `node scripts/check-licenses.mjs && pnpm --filter web migrations:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 0    | Dependency licenses OK; migration checksums current                                            | 7.20 s combined wall           |
| `pnpm test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 0    | 101 files, 1052 tests passed, including financial, cTrader, AI/provider and import regressions | 126.46 s Vitest; 130.24 s wall |
| `pnpm exec vitest run apps/web/tests/intelligence-recovery.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 0    | Final child environment correction: 1 file, 3 real kill/reopen tests passed                    | 8.17 s Vitest; 12.82 s wall    |
| `pnpm exec prettier --check docs/superpowers/plans/ai-native-journal/phase-09.md apps/web/src/server/intelligence/infrastructure/backfill.ts apps/web/src/server/intelligence/infrastructure/jobs.ts apps/web/src/server/intelligence/infrastructure/knowledge-store.ts apps/web/src/server/intelligence/infrastructure/worker.ts apps/web/src/server/intelligence/composition.ts apps/web/src/server/trading/reconcile.ts apps/web/tests/intelligence-slice-a.test.ts apps/web/tests/intelligence-recovery.test.ts apps/web/tests/intelligence-observations.test.ts .omp/reviewer-report.md` | 0    | All matched files use Prettier style                                                           | 4.86 s wall                    |

Evidence association: all production code tested by the passing full suite is exactly the production code in `b6c8a83dd7aff54f1951a29e94e6a3f09004196d`. The single full-suite gate ran before a test-only environment typing correction (`NODE_ENV: "test"` in the child fixture). After that correction, the final recovery suite and all three typechecks passed. The full suite was not repeated, per the coordinator's single-full-gate requirement. The plan's final checklist and this report are documentation-only changes after the source checks.

Earlier failures, retained transparently:

- Initial targeted run: exit 1, 26/27 passed, 14.43 s Vitest. Deleted-account assertion incorrectly compared incidental `dispatchedAt` before versus after worker dispatch. The assertion now compares durable event identity/payload and still proves zero observations after deletion.
- Initial web typecheck: exit 2, 64.00 s wall. Recovery fixture omitted Next's required `ProcessEnv.NODE_ENV`. Set child `NODE_ENV=test`; final typecheck and child recovery rerun passed.
- Root `pnpm typecheck` was intentionally not run: coordinator identified desktop RC2175 as pre-existing and required web/core/importers filters instead.

## Review findings and resolutions

Fresh independent spec/compliance and code-quality review initially found two material defects:

1. Composition supplied all worker handlers to replay validation, allowing seed-handler replay to acknowledge without an observation. Replay now receives only the outbox registry. A regression proves worker-only seed replay is rejected before job/delivery writes.
2. Seed called the full quality context per unmapped trade, rescanning account revision history. The approved extraction separates source-only `derivedQualityOf`; backfill derives account-batch source quality once, and reconciliation composes the same helper with its unchanged recorded lookup. Equivalence cases preserve snapshots and fingerprints for all timing qualities.

Final independent resolution review: PASS, no remaining material findings. Reviewer ran no builds/tests; the parent supplied gate evidence. Non-blocking existing design notes remain: seed handler registration is explicit; ambiguous identity counts remain visible while the durable cursor advances without guessing identity; suppression assumes the explicit reset operation already purged its observations, and therefore blocks all subsequent output.

## Schema, compatibility and next inputs

- Migration allocation: none. Existing migration 0004 checkpoint is reused. No schema, bootstrap, registry, checksum or applied migration changes.
- No dependencies, payload contracts, execution hashes, trade keys, financial methodology, annotations, provider endpoints, encrypted credentials or cTrader connectivity changed.
- No reset/rebuild API, model tool, supervisor, Docker or Tauri packaging work was introduced. Operational service calls require a trusted authenticated caller; API exposure belongs to its assigned later phase.
- Rollback: stop worker; retain additive tables, evidence and durable checkpoints. Do not downgrade or rewrite migrations. An explicit reset remains suppressed until a separately authorized rebuild command changes that state.
- Remaining owner: coordinator verifies destination and records `ai-native-journal-integration-09.md` before advancing. Phase 10 owns supervisor/bundle/deployment work. No push, PR or feature merge was performed here.
