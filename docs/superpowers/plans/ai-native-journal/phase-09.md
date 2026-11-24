# Phase 09: Historical seed, replay and no-provider recovery

**Goal:** Restart historical discovery and replay without duplicate effects or providers.
**Base:** `db56d3671b1e6fbfdc92e4cdc039b45cff001386`, branch `codex/ai-native-journal-p09`.
**Authority:** T-009; detailed Task 7; phase-guide checkpoint allocation; coordinator approvals `msg_1610c80bc753` (worker routing and helper exports) and `msg_8f459a7454f3` (behavior-preserving source-quality extraction).

## Exclusive shared-worktree ownership

| Micro-agent   | Exact writable paths                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SeedBaseline  | `apps/web/src/server/intelligence/infrastructure/backfill.ts`; `apps/web/tests/intelligence-slice-a.test.ts`                                                                        |
| ReplayEffects | `apps/web/src/server/intelligence/infrastructure/jobs.ts`; `apps/web/src/server/intelligence/infrastructure/knowledge-store.ts`; `apps/web/tests/intelligence-observations.test.ts` |
| WireSeed      | `apps/web/src/server/intelligence/composition.ts`; `apps/web/src/server/intelligence/infrastructure/worker.ts`; `apps/web/src/server/trading/reconcile.ts`                          |
| KillRecovery  | `apps/web/tests/intelligence-recovery.test.ts`                                                                                                                                      |

One owner per path, maximum three files each. All agents share this existing checkout; no Git, builds, tests, migrations, installs, formatting, extra worktrees or nested agents during the wave. Parent owns this plan, completion report, consolidated corrections and all verification. No schema, common-contract, manifest, dependency or migration changes.

## Frozen interfaces and behavior

- `createBackfillService({ db, jobs, clock?, batchSize? })` in backfill exports `seedAccount(accountId: string, operationId: string): ReconcileResult` and `seedAccountInTx(tx: JournalTx, accountId: string, operationId: string): ReconcileResult`. Default batch size 100. Each call processes one bounded batch; continuation jobs use existing strict `{ type: "seed_account", accountId }` payload and stable account/operation/cursor keys. Existing checkpoint operation wins when resuming.
- Seed reads persisted trades, current revisions and checkpoint under one immediate transaction. Reuse existing `projectionOfRow` and extracted source-only `derivedQualityOf` from reconcile, and existing identity/revision/event helpers. Derive batch account-fill quality once outside the trade loop; reconciliation composes the same helper with unchanged recorded-quality lookup. Never write financial trade rows. Reuse mapped current revisions; never manufacture another revision for already-mapped facts. If mapped state has no captured event, publish historical discovery against its existing revision; existing events remain unchanged. Cursor, historical events and continuation jobs commit together. Missing account cancels output. Completed/suppressed checkpoints do not restart; running checkpoints resume. No reset API or automatic suppression override.
- `createReplayService({ db, jobs, handlers, clock? })` in jobs exports `requestReplay(eventId: string, handlerId: string, handlerVersion: string): string`. Validate registered handler/version and durable event/account; reject suppressed/deleted account. Reuse `eventId:handlerId:handlerVersion` job/delivery identity. Pending/running/retry work coalesces; terminal non-cancelled jobs can restart under same ID with fenced generation. Never revive cancelled work. Replay is an operational service seam, not a model tool or new route.
- Observation persistence checks suppressed checkpoints inside the effect transaction, in addition to current-revision/account checks. Replay and retries retain observation/evidence business keys.
- `createIntelligenceServices({ db, clock?, seedBatchSize? })` in composition returns `{ seedAccount, requestReplay, handlers, outboxHandlers }`; preserve existing observation exports. Register seed handler ID `seed-account`, version `1`; handler calls `seedAccountInTx(tx, payload.accountId, job.id)`. Worker routes existing seed payload to that registered handler. Outbox subscribes observation handler only. Named `seedAccount` and `requestReplay` exports bind default DB services. No worker starts on import.

## Execution and verification

- [x] Commit this plan before implementation (`a3cbda0`).
- [x] Dispatch all four disjoint owners together against interfaces above; write behavior and named contract scenarios without per-assertion test iterations.
- [x] Join all writers; inspect ownership/diff once and resolve interface disagreements.
- [x] Prove historical discovery, seed continuation/restart, mutation-before-seed, duplicate/failed replay, stale correction/removal, account deletion, explicit suppression versus incomplete seed, and atomic effect/ack rollback.
- [x] Real file SQLite child-process kill/reopen fixtures exercise committed event recovery, interrupted worker effect rollback and seed continuation. Provider resolver throws on any access; same persistent observation and evidence survive reopen.
- [x] Consolidation-only gates: targeted three intelligence suites (31 tests); web/core/importers typechecks (root desktop RC2175 excluded per coordinator); Prettier changed files; license check; web migrations check; full `pnpm test` once (101 files, 1052 tests). Final recovery rerun (3 tests) covers the child environment typing correction. Exact commands, exit codes and runtimes are recorded in the phase report. No long-running server: hub unavailable.
- [x] Fresh spec/compliance and quality review resolved both material findings; final reviewer verdict PASS. Implementation uses `feat: recover and seed deterministic intelligence safely`; completion evidence lives in the phase report.

**Stop:** All named scenarios and gates have observed evidence, report committed, one native worker_done sent. Coordinator owns integration; no push, PR, feature merge, Phase 10 work or worktree deletion. Rollback stops worker and retains additive tables and durable checkpoints; no downgrade/schema edits.
