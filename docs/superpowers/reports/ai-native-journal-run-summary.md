# AI-native journal — the 21-phase run, in one document

Between 2026-10-25 and 2026-11-18 the AI-native journal modernization ran as 21 phases on the branch
`codex/ai-native-journal`. Every phase was reviewed, proved and verified by a destination gate run
alone on the host, on the destination branch, after the merge; twenty of them were merged with
`--no-ff`, and Phase 11 produced no production code change, so its gate ran against the verified
feature HEAD and the coordinator committed the package re-sequencing and the reports directly on the
feature branch. All 21 phases are integrated and verified; `main` was never touched — no phase
pushed, opened a pull request or merged into `main`, and the coordinator index records `main`
unchanged at `4ae868d`.

This document is the map. It says what each phase built, what it touched, what the review and the
gate caught, and where the detail lives. The detail is not repeated here: every phase has its own
plan, its own phase report and its own integration record, and the gate table of a phase is in that
phase's integration record, not in this file.

## The run at a glance

| Measure                                                         | Value                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Phases                                                          | 21                                                                                                                 |
| Integration records                                             | 21                                                                                                                 |
| Dispatches                                                      | 37                                                                                                                 |
| Phase commits listed in the integration records                 | 115 (the sum of the per-phase `commits` lists in the coordinator index)                                            |
| Files changed, insertions, deletions                            | 253 files changed, 59968 insertions(+), 1612 deletions(-) — the scale the coordinator index records for the branch |
| Migrations                                                      | 7 (`0001-legacy-baseline` … `0007-intelligence-experience`)                                                        |
| Tests at the final release gate                                 | `pnpm test` 1375 passed in 116 files; `cargo test` 5 passed; the icon generator's own header test 1 passed         |
| Whole-project suite, first phase to last                        | 850 passed / 1 skipped in 86 files (Phase 01) → 1375 passed in 116 files (Phase 21)                                |
| Destination-gate command rows across the 21 integration records | 183 (counted from the gate tables)                                                                                 |

The shape of the work: the run turned a single-user journal into a governed runtime. A committed
trade change leaves a durable event in the same transaction as the change; a single fenced worker
turns those events into idempotent jobs, claims them under a write lock and commits the effect with
its acknowledgement; a projection carries a stable identity, a fingerprint and an append-only revision
chain; facts become observations that can be superseded and invalidated but never silently revived.
On top of that sits an intelligence slice with a deterministic capability registry and a
scope-, budget- and output-validating tool gateway; a workflow engine with compare-and-swap and
command-digest idempotency; an engagement policy with opportunity, delivery and dismissal
reservations; retention, a deletion ledger, a quiescent backup and a verified restore; and a
packaged desktop app that is supervised, restartable and leaves nothing behind.

## How each phase was verified

Four rules held for every phase, and they are the part of this run that should not be taken on trust.

1. **One implementation-diff review per phase, against the exact commits, with a budget of two
   reviewer runs.** The reviewer read the commits and the contract, not the worker's summary. The
   rule was not always kept: Phase 17 spent a third run to confirm its fixes, and Phase 21's gate
   repair went through four review rounds because the document under review is the acceptance
   record.
2. **A coordinator teeth proof.** The coordinator mutated the production code on purpose — dropping
   the abort signal, moving a reservation after the provider call, removing the compare-and-swap
   check — and watched the named test fail, then restored the file and watched it pass again. A
   behaviour with no test that can fail has no proof. The proofs are recorded per phase, with the
   number of mutations the coordinator applied: three for Phase 13, three for Phase 14, six for
   Phase 15, four for Phase 16, six for Phase 17, eight for Phase 18, five for Phase 19 and nine for
   Phase 20; Phase 12 proved its two new regression tests fail against the pre-fix code, and each
   Phase 21 finding that carries one carries its own proof.
3. **A destination gate, alone on the host, on the destination branch, after the merge.** Install,
   typechecks, `migrations:check`, the licence check, prettier over the merged files, the build and
   the whole-project suite — run sequentially, never in parallel with another gate run, and every
   exit code is the exit code of the command itself and not of a pipe.
4. **A phase could not be integrated until its gate passed.** A red gate made the feature branch an
   unverified base, and the successors were blocked while a repair was dispatched.

What the gate and the review caught across the run, in the phases that found it:

- **The workflow pairing defect that leaked a row per review cycle** (Phase 19). The observations
  GET paired the _first_ workflow of a subject instead of the actionable one, and the POST started a
  second review while one was live, so the served intent vanished after an acknowledgement and a
  workflow row leaked on every review cycle. The worker found it in its own review; the coordinator
  granted the two Phase 18 route files and a repair dispatch closed it.
- **The backup and restore had no operator entry point at all** (Phase 20). `backupJournal` and
  `restoreJournal` were exported, tested and documented, and nothing outside the two test files
  called them. The coordinator verified this in the code before granting the operator command.
- **The operations runbook promising procedures no operator could perform** (Phase 20). The runbook
  opened by claiming every command in it was one an operator can run, and
  `docs/database-migrations.md` named a journal backup command that did not exist. An operator
  following it would have believed their journal was backed up when nothing had been taken.
- **The architecture test the phase's own command omitted** (Phase 20). The phase's verification
  command ran only the three Phase 20 suites and never ran
  `apps/web/tests/intelligence-boundaries.test.ts` — the test that caught its two import-graph
  violations. The lesson recorded in the phase brief is that every later phase must run the
  boundary test as part of its targeted command.
- **The opportunity producer that made a complete gate a fiction** (Phase 19). Nothing in the
  committed code called `engage()` outside the tests, so the producer Phase 18 had named as the
  Phase 19 Slice B did not exist and the Slice B chain was not a running path. The coordinator
  granted the producer module, its wiring and the controls route.
- **The desktop build that only worked on the machine that built it** (Phase 21). The bundle icons
  and the Node sidecar are generated and gitignored, so a merge cannot carry them. The desktop
  scripts did not generate the icons the cargo steps need, so the destination gate failed at
  `pnpm typecheck` with `RC2175` on a stale icon — the build worked only in the tree that had
  produced the icon.

## Phase by phase

### Phase 01 — Safe connection and transaction seams

**Delivered** — `openConnection(directory)` and the app journal singleton moved into
`apps/web/src/db/connection.ts`, with the manual WAL/SHM unlink removed; a synchronous-only
transaction seam `withJournalTransaction(fn)` in `apps/web/src/db/transaction.ts`; `RequestError` and
`requireValue` extracted to `apps/web/src/server/request-error.ts` and re-exported unchanged from
`server/api.ts`. **Changed** — 20 files, +1574 / −176; `db/connection.ts`, `db/transaction.ts`,
`db/index.ts` as the `@/db` barrel, `server/request-error.ts`, ten server modules repointed, two new
test files. No schema allocation. Merge `40011b4`. **What was caught** — the phase plan failed
`prettier --check` and the phase report claimed the format gate was clean; the defect was routed to
a replacement attempt and fixed at `477b102`, the false claim corrected at `f0edcc3`. The first
dispatch was revoked by an Orca runtime restart, not by a worker failure. **Detail** —
[integration](./ai-native-journal-integration-01.md) ·
[phase report](./ai-native-journal-phase-01.md) ·
[plan](../plans/ai-native-journal/phase-01.md)

### Phase 02 — Versioned migration runner and legacy baseline

**Delivered** — an ordered, checksummed migration runner that owns the `journal_migrations` ledger,
validates the applied history before it writes anything, and refuses a journal whose history it
cannot validate; startup runs the runner and `BOOTSTRAP_SQL` survives only as the final-schema
snapshot. **Changed** — 14 files, +2132 / −104; `db/migrations.ts`, `db/migrations/0001-legacy-baseline.ts`,
the `migration-checksums.json` artifact and its generator, `db/bootstrap.ts`, the typed
`journal_migrations` mirror, 14 runner invariant tests. Schema allocation: `0001` plus the ledger.
Merge `3047fe3`. **What was caught** — the coordinator raised one finding (explicit `.ts` import
specifiers plus an added `allowImportingTsExtensions`) and withdrew it after verification: the
concurrency test spawns child Node processes with `--experimental-strip-types` that import the real
TypeScript modules, so the explicit specifier is required. The worker's own two reviews fixed five
things, among them a duplicate-version drop in the manifest generator and an unenforced manifest
name. **Detail** —
[integration](./ai-native-journal-integration-02.md) ·
[phase report](./ai-native-journal-phase-02.md) ·
[plan](../plans/ai-native-journal/phase-02.md)

### Phase 03 — Projection identity, fingerprints and immutable revisions

**Delivered** — `fingerprintProjection` over an explicit computed-field list, canonical JSON, and
`resolveIdentity` with an append-only revision chain: the same active key keeps its identity, an
unproven mapping returns candidates and never a winner, a transfer needs an exact
execution-membership match inside the account, and a shared execution proves nothing. **Changed** —
14 files, +2406 / −116; `server/trading/projection.ts`, `server/trading/identity.ts`,
`db/migrations/0002-trade-projections.ts`, the typed mirrors, the registry entry, the regenerated
checksum artifact, `server/ids.ts`, 22 identity cases. Schema allocation: `0002` with
`trade_identities`, `trade_projection_revisions`, `trade_revision_executions`,
`trade_identity_links`, `execution_evidence`. No change to core key generation. Merge `349c061`.
**What was caught** — the worker's own second review found the two phase markdown files were not
Prettier-formatted while the evidence table recorded the formatting check as passing when it had
failed. The provider outage was recorded: the first sixteen model calls failed with HTTP 402
`insufficient_balance_error` and then HTTP 401 `invalid api key`, exhausting the retry budget at
15:02Z; the worker recovered and completed the phase on its own once the balance was restored.
**Detail** —
[integration](./ai-native-journal-integration-03.md) ·
[phase report](./ai-native-journal-phase-03.md) ·
[plan](../plans/ai-native-journal/phase-03.md)

### Phase 04 — Outbox, durable jobs and fenced worker mechanics

**Delivered** — `appendDomainEvent(tx, event)` writes into the caller's transaction; the fanout
enqueues one job per handler under the key `eventId:handlerId:handlerVersion`; claims carry an
incremented fence and every completion calls `assertClaim` inside the effect transaction, so a
worker whose lease was taken over cannot acknowledge the work it started. **Changed** — 19 files,
+3435 / −214, plus a four-file repair merge; `server/domain-events.ts`,
`server/domain-event-store.ts`, `intelligence/contracts/jobs.ts`, the `outbox`, `jobs` and `worker`
adapters, `db/migrations/0003-durable-jobs.ts`. Schema allocation: `0003` with `domain_outbox`,
`event_deliveries`, `intelligence_jobs`, `intelligence_worker_lease`. Two merges: the phase merge `6541c10`, whose destination gate was
red, and then the repair merge `f6ea10c`, whose gate passed. **What was caught** — the destination
gate was red on two points only the whole-project gate exposed: a prettier violation introduced by
the post-review fix commit `af43482`, and a Phase 03 test that pinned the applied-migration ledger
to exactly two versions and broke on the legitimate forward migration `0003`. Both were routed back
to an implementation worker; no production semantics changed. The initial attempt lost DNS access to
`api.minimax.io` mid-phase and still completed, and the coordinator's supervisor aborted on a single
transient error, which was a false alarm.
**Detail** —
[integration](./ai-native-journal-integration-04.md) ·
[phase report](./ai-native-journal-phase-04.md) ·
[plan](../plans/ai-native-journal/phase-04.md)

### Phase 05 — Transaction-aware reconciliation for manual and generic ingestion

**Delivered** — one reconciliation boundary (`server/trading/reconcile.ts`) that compares the prior
persisted projections with the reconstructed ones and writes fills, projection rows, immutable
revisions and the durable event in one transaction; an unchanged projection writes no revision and
raises no event, so an identical retry is silent; classification is exact — a first sight is
`opened` in live mode and `discovered` otherwise, an observed open cycle that closed is `closed`,
everything else is `revised`. **Changed** — 12 files, +1894 / −191; `trading/reconcile.ts`,
`trading/commands.ts`, `executions.ts` (`insertExecutionsInTx`), `rebuild.ts`, `position-import.ts`,
`settings.ts`, two routes, two new test files. No schema allocation. Merge `5d1bf55`. **What was
caught** — the coordinator's review raised no finding of its own; the worker's own three review
rounds found and fixed five, among them two public adapters that opened _deferred_ transactions,
which can fail the WAL deferred-to-write upgrade with `SQLITE_BUSY_SNAPSHOT`, an unconditional
reconciliation that rewrote every projection on a zero-insert broker poll, and a vacuous rollback
assertion whose two injected failures both happened before the note write.
**Detail** —
[integration](./ai-native-journal-integration-05.md) ·
[phase report](./ai-native-journal-phase-05.md) ·
[plan](../plans/ai-native-journal/phase-05.md)

### Phase 06 — All broker and specialized import paths

**Delivered** — the six broker and specialized adapters — SDK sync, cTrader MCP sync, XTB workbook
upload, IBKR Flex XML upload, NinjaTrader reviewed import, demo loader — commit through the
ingestion and reconciliation ports in one immediate transaction, and the source-specific decision
(which XTB holding is matched, which statement timezone an IBKR upload may use) is taken inside that
transaction under the write lock. Fetch and parse stay outside. **Changed** — 15 files, +1370 / −146;
`server/sync.ts`, `ctrader-mcp/sync.ts`, `xtb-import.ts`, `ibkr-flex-xml-import.ts`,
`ninjatrader-import.ts`, `demo.ts`, `app/api/import/route.ts` and six test suites. No schema
allocation. Merge `3f672c7`. **What was caught** — the worker's own two reviewer rounds found two
real contract defects: the import route could still decide from a stale pre-transaction check, because
the XTB holdings reconciliation and the IBKR timezone check were computed outside any transaction on
both the preview and the commit path, and the XTB commit response exposed a new `matched` key,
changing the import response contract. **Detail** —
[integration](./ai-native-journal-integration-06.md) ·
[phase report](./ai-native-journal-phase-06.md) ·
[plan](../plans/ai-native-journal/phase-06.md)

### Phase 07 — Remaining mutation commands and settings-driven rebuilds

**Delivered** — single and bulk trade delete, account clear, account delete, account transfer, and
the profit-method and global-multiplier changes all run as commands that own one immediate
transaction and one change context; the routes became thin dispatchers that validate, hand over and
answer. A transfer keeps a trade's identity only where a unique full execution-membership match
proves it, and an ambiguous transfer is refused before anything is written. **Changed** — 18 files,
+2615 / −326; `trading/commands.ts`, `trading/reconcile.ts`, `trading/identity.ts`, `executions.ts`,
`settings.ts`, the new `intelligence/infrastructure/retention.ts`, five routes, the mutation-command
suite. No schema allocation. Merge `9345287`. **What was caught** — the worker's own review found a
real defect: a transfer into an account that already held an identical fill answered **500 instead
of refusing the move**, which is exactly the ambiguous-transfer case this phase exists to handle.
Three risks were handed forward and accepted: the write lock of a multiplier change grows with the
journal and is measured at the Phase 21 release gate; a transfer is refused when the moved fills
merge with the destination's, deliberately; and the purge must be extended to the observation tables
when migration `0004` arrives. **Detail** —
[integration](./ai-native-journal-integration-07.md) ·
[phase report](./ai-native-journal-phase-07.md) ·
[plan](../plans/ai-native-journal/phase-07.md)

### Phase 08 — Factual observations and explicit cTrader evidence quality

**Delivered** — a trade projection becomes a persistent observation the journal can supersede and
invalidate and never silently revive, and the source quality of every cTrader fill is explicit —
source-reported, reconstructed or unknown — resolved and written to the `execution_evidence` sidecar
_before_ the projection fingerprint is computed, so learning something the journal already knew
cannot manufacture a revision or an event. **Changed** — `db/migrations/0004-observations.ts`, the
typed schema, the final-schema snapshot, the registry entry, the regenerated checksum artifact, the
new `intelligence/contracts/observations.ts` with `evaluateTradeProjection`, the new
`infrastructure/knowledge-store.ts` with `persistObservationInTx`, the new `composition.ts` wiring,
the account purge, `trading/projection.ts` with `classifyExecutionEvidence`, `trading/reconcile.ts`,
`executions.ts`, the cTrader MCP `deals.ts` and `sync.ts`, four test files. Schema allocation:
`0004` with `intelligence_observations`, `observation_evidence`,
`intelligence_seed_checkpoints`; migrations `0001`–`0003` byte-unchanged. Merge `c8a6fdc`.
**What was caught** — the closure attempt found exactly two real violations, both Prettier drift in
the phase's own files (a three-line wrapped evaluator signature and a six-space nested-list indent
in the plan). The dispatch was revoked by an Orca runtime restart at 2026-10-28T20:04:12Z: the worker
survived the revocation, completed and verified the implementation, and composed its summary at
22:31Z, but could no longer send its `worker_done`. **Detail** —
[integration](./ai-native-journal-integration-08.md) ·
[phase report](./ai-native-journal-phase-08.md) ·
[plan](../plans/ai-native-journal/phase-08.md)

### Phase 09 — Historical seed, replay and no-provider recovery

**Delivered** — `seedAccount` processes one bounded account batch (default 100) inside one immediate
transaction, with the cursor, the historical events and the continuation job committing together;
`requestReplay` validates the outbox handler registry, so a replay naming a worker-only handler is
refused, and pending or running work coalesces under the original
`eventId:handlerId:handlerVersion` key. Observation persistence refuses a suppressed checkpoint
inside the effect transaction. **Changed** — the new `intelligence/infrastructure/backfill.ts`, the
new `intelligence-slice-a.test.ts` and `intelligence-recovery.test.ts`, and extensions to
`infrastructure/{jobs,knowledge-store,worker}.ts`, `trading/reconcile.ts` and
`composition.ts`. No schema allocation: the phase uses the `intelligence_seed_checkpoints` table
migration `0004` created. Merge `0915173`. **What was caught** — one defect, found by the worker
itself: a seed deletion assertion compared `dispatchedAt` before versus after the outbox drain. The
coordinator verified the production mechanic and the corrected assertion re-targets the invariant —
event id and payloadJson on both sides — rather than weakening it, and no production change was
permitted to make the test pass. Two scope extensions were granted after verification on the merged
branch: the worker routing path, and the source-only derived-quality extraction that removed a
quadratic rescan. **Detail** —
[integration](./ai-native-journal-integration-09.md) ·
[phase report](./ai-native-journal-phase-09.md) ·
[plan](../plans/ai-native-journal/phase-09.md)

### Phase 10 — Node supervisor, worker bundle and Docker startup

**Delivered** — one resolved configuration handed to both children, so the HTTP child and the worker
never disagree about mode, host, port, data directory or worker enablement; readiness published only
after a real HTTP answer; one shared ten-second shutdown deadline (SIGTERM over IPC, then SIGKILL);
a worker crash keeps HTTP alive and restarts under a bounded exponential policy, reporting
`unhealthy` after five crashes in ten minutes; the worker entry bundled independently, with
`better-sqlite3` externalised and its native module copied, and no Next, route or React code in it.
**Changed** — 14 files; `apps/web/scripts/run-journal.mjs`, `http-child.mjs`, `build-worker.mjs`,
`copy-static-build.js`, the new `repair-links.mjs`, `intelligence/composition.ts`,
`intelligence/worker-entry.ts`, `apps/web/package.json`, `next.config.ts`, the `Dockerfile`, two test
files. No schema allocation. Merge `54463d7`. **What was caught** — the first destination gate
attempt failed with one test, and the immediate cause was the coordinator's own mistake: two gate
runs were executing at once, and two `next build` processes wrote the same `.next` directory. The
isolated re-run still failed with four tests, which proved three genuine test defects: an await
helper with a six-second budget, a fixture startup budget of four seconds against a production
sixty, and a test that read the worker's start event without waiting for it. The fix was in the test
file only; no production deadline, timeout or assertion changed. The Docker scratch-volume gate is
blocked host evidence: the daemon is stopped and was not started. Two dispatches were revoked by the
orchestration, and the MiniMax balance hit zero during the repair with repeated HTTP 402 responses.
**Detail** —
[integration](./ai-native-journal-integration-10.md) ·
[phase report](./ai-native-journal-phase-10.md) ·
[plan](../plans/ai-native-journal/phase-10.md)

### Phase 11 — Slice A integrated gate and financial regression

**Delivered** — the ten design §18 Vertical Slice A scenarios proven as one coherent no-provider
slice: trade changed, reconciliation, durable domain event, worker processing, deterministic
observation, persistent evidence, with no AI provider configured — plus the targeted financial
regression and the full suite, all recorded with exit codes and runtimes. **Changed** — no
production code change; the phase re-sequenced the package, moving the Tauri desktop subset from
Phase 11 to Phase 21 under ADR 0009, and updated `execution-manifest.json`, the T-011 and T-021
packets, `dependency-graph.md`, `traceability.md`, `integration-plan.md`,
`orca-execution-prompt.md`, the orchestration README and the new ADR. No candidate branch and no
worker merge: the coordinator committed the re-sequencing, the plan and the reports on the feature
branch (commits `6c030d6`, `58209ba`). **What was caught** — an independent review of the package
diff raised 11 findings, one BLOCK and ten FAIL, all resolved. The BLOCK: G-A still required the
Docker scratch-volume smoke, which cannot run on this host, so the Docker and Tauri ABI evidence
moved from G-A to G-FINAL. The root `pnpm typecheck` exited 101 on the `desktop` workspace's
`cargo check`, blocked host evidence from the pre-existing sidecar defect, never mocked.
**Detail** —
[integration](./ai-native-journal-integration-11.md) ·
[phase report](./ai-native-journal-phase-11.md) ·
[plan](../plans/ai-native-journal/phase-11.md)

### Phase 12 — Execution contexts, capability registry and tool gateway

**Delivered** — the pure runtime contracts (`ExecutionContext`, `Capability`, `Eligibility`,
`Outcome`, `ToolDefinition`), a deterministic capability registry, a scope-, budget- and
output-validating tool gateway, and the execution-context factory the existing Ask and Reports AI
routes use without changing any observable response; the runtime reaches the journal only through
typed query ports and never touches the database. **Changed** — 20 files, +2665 / −327; the new
`intelligence/contracts/{execution,capabilities,tools}.ts`, the new
`intelligence/runtime/{execution,registry,dispatcher,tool-gateway,journal-capabilities,ai-sdk-tools}.ts`,
`ai-scope.ts`, `ai-capabilities.ts`, `ai-contracts.ts`, `ai.ts`, the ADR 0008 implementation note and
two new test files. No schema allocation. Merge `9553de3`. **What was caught** — the
implementation-diff review found one real defect and two documentation claims that followed from it:
`createExecutionContext` short-circuited at the declared tool-call ceiling without consulting the
runtime hook, so the legacy request-level budget error became unreachable and a model that exceeded
`maxToolCalls` received a normal answer instead. The repair made the context always consult the
hook while its own ceiling stays authoritative, and the coordinator proved the new regression tests
fail against the pre-fix code. **Detail** —
[integration](./ai-native-journal-integration-12.md) ·
[phase report](./ai-native-journal-phase-12.md) ·
[plan](../plans/ai-native-journal/phase-12.md)

### Phase 13 — Background AI policies, reservations and provider adapters

**Delivered** — a revisioned background policy, the pinned provider/model/endpoint a run is
approved against, a transactional daily attempt reservation taken before any network use and kept
when the attempt dies, a provider adapter that never falls back to another provider and stops on
cancellation, and the per-account opt-in in Settings. Background AI is off until the operator turns
it on, and a configuration change never silently reroutes a queued run. **Changed** — 18 files,
+3068 / −159; the new `intelligence/contracts/policy.ts`, the new `runtime/model-policy.ts` and
`infrastructure/policy-store.ts`, `composition.ts`, `server/ai-runtime.ts`, `server/settings.ts`, the
settings route, the AI settings card, `db/migrations/0005-intelligence-runtime.ts`, the typed
schema, the registry entry, the regenerated checksum artifact and a new provider-policy suite of
33 tests. Schema allocation: `0005` with `intelligence_runs`, `intelligence_policy` and
`intelligence_budget_reservations`; migrations `0001`–`0004` byte-unchanged. Merge `bf15f30`.
**What was caught** — the implementation-diff review raised four findings: two cancellation cases
that could not fail for the reason they claimed, because their fetch stub aborted its own
controller; a reservation case that checked the row only after the call returned and had no
concurrent-writer case; and a false `0005`-coverage claim in the plan and the report. The repair
touched no production file. The destination gate failed once at `prettier --check` on seven
never-formatted candidate files; the formatting was applied at `1df91a2`, proven formatting-only, and
the whole gate was re-run alone on the host. **Detail** —
[integration](./ai-native-journal-integration-13.md) ·
[phase report](./ai-native-journal-phase-13.md) ·
[plan](../plans/ai-native-journal/phase-13.md)

### Phase 14 — Knowledge-source revisions and invalidation

**Delivered** — the `SourceChange` contract and `applySourceChange(tx, change)`: a user-authored
source — a trade annotation, a rule check, a playbook, a journal day note or a note — now changes in
one immediate transaction with the revision that describes it; a correction marks the knowledge
derived from the old content `stale` and raises a re-evaluation request bound to the newest source
revision; a deletion invalidates that knowledge and raises nothing, because a source that no longer
exists cannot be re-derived. **Changed** — 22 files, +3231 / −208; the new
`intelligence/contracts/knowledge.ts`, the extended `server/domain-events.ts`, the new
`infrastructure/knowledge-revisions.ts`, `composition.ts`, the route files that write a source,
`db/migrations/0006-knowledge-scheduling.ts`, the typed schema, the registry entry, the regenerated
checksum artifact and a new revision suite of 26 tests. Schema allocation: `0006` with
`knowledge_sources`, `knowledge_hypotheses`, `knowledge_patterns` and `intelligence_schedules` (the
schedule table only — the scheduler is Phase 15); migrations `0001`–`0005` byte-unchanged. Merge
`4fa0cb0`. **What was caught** — a later review found one real production regression: the journal
day route guarded with an early return before the upsert, so an unchanged note skipped the whole
write and `journal_days.updated_at` was no longer refreshed. Two cases could not fail for the reason
they claimed, and the plan's column table contradicted the shipped migration. The coordinator also
found two defects in its own integration script — the schema verdict regex could never match, and
the migration path was built with a doubled prefix — before the merge, and corrected the plan's
`source_kind` CHECK row. **Detail** —
[integration](./ai-native-journal-integration-14.md) ·
[phase report](./ai-native-journal-phase-14.md) ·
[plan](../plans/ai-native-journal/phase-14.md)

### Phase 15 — Durable time and condition scheduling

**Delivered** — `scheduleDue(now)` turns due schedules into durable jobs whose key names the
schedule, the due instant and the definition version, so the same occurrence can never be enqueued
twice — not by a repeated tick, not by a restart; time triggers resolve local wall-clock times with
explicit daylight-saving rules; condition triggers consume the durable source-change log against a
persisted checkpoint that only moves forward. The scheduling path selects no provider and no model.
**Changed** — 9 files, +2028 / −54; the new `intelligence/infrastructure/scheduler.ts`, one new
`schedule_trigger` payload variant in `intelligence/contracts/jobs.ts`, the worker routing branch,
`composition.ts`, the pure local-time helpers in `packages/core/src/time.ts`, a new 17-case
scheduler suite. No schema allocation: the phase uses the `intelligence_schedules` table migration
`0006` created. Merge `fc1f61c`. **What was caught** — the coordinator's review found three ways a
schedule could stop making progress without ever reporting an error, all silent stalls: a damaged
checkpoint replayed what it had already consumed, a dead condition occurrence reselected the same
change forever, and a dead time occurrence stalled the schedule on a key it could never use again.
The repair re-anchors a damaged cursor from the job ledger, burns dead occurrences and advances
`next_due_at`. Six-mutation teeth proof. **Detail** —
[integration](./ai-native-journal-integration-15.md) ·
[phase report](./ai-native-journal-phase-15.md) ·
[plan](../plans/ai-native-journal/phase-15.md)

### Phase 16 — Persistent workflow command and transition engine

**Delivered** — a durable, versioned workflow with recorded transition history: every applied
transition writes a row, advances the workflow's own revision and enqueues its durable effect _in
the same transaction_, so a crash can neither lose the effect nor apply it twice. A command that
does not apply changes nothing — a stale expected revision conflicts, the same command id with the
same payload replays the stored result, the same command id with a different payload is a conflict.
A workflow that waits for the user holds no job and releases the jobs of the state it leaves, and a
correction is a self-report that never writes a financial value. **Changed** — 13 files, +2764 / −32;
the new `intelligence/contracts/experience.ts`, the new `intelligence/experience/workflows.ts`, the
new `infrastructure/experience-store.ts`, `db/migrations/0007-intelligence-experience.ts`, the seven
typed tables, the registry entry, the regenerated checksum artifact, a new 19-case workflow suite
and an 11-line fixture extension to the Phase 14 suite. Schema allocation: `0007` — the whole
table set of Task 11, because Phase 17 allocates the opportunities table to it and Phase 18 owns no
schema. Merge `a305aba`. **What was caught** — the implementation-diff review raised a BLOCK: the
domain layer imported `withConnectionTransaction` as a runtime value, and that module opens the
journal and runs the migration runner at import time, so importing the domain performed a database
side effect. It also raised a FAIL: `definition_version` was written on every workflow and never
read, so a workflow under a different definition was still advanced by the current rules. The repair
made the transaction an injected seam with type-only database imports and made the legal-transition
source keyed by (definition, version). **Detail** —
[integration](./ai-native-journal-integration-16.md) ·
[phase report](./ai-native-journal-phase-16.md) ·
[plan](../plans/ai-native-journal/phase-16.md)

### Phase 17 — Engagement and opportunity coordination

**Delivered** — `decideEngagement` as a pure policy with no clock, database, network or random
source, returning one of six outcomes — observe, inbox, contextual, proactive, defer, suppress —
with the reason and the next eligibility; and a central coordinator that owns three persisted facts
in one transaction: an opportunity reservation, so the same dedup key can never produce two
opportunities; a delivery reservation, so a retried delivery cannot notify twice; and a dismissal
record, so a dismissal outlives the opportunity it was made against. **Changed** — 8 files, +2582 /
−55; the extended `intelligence/contracts/experience.ts`, the new
`intelligence/experience/engagement.ts` and `experience/interactions.ts`, the extended
`infrastructure/experience-store.ts`, a new 38-case engagement suite. No schema allocation: the phase
writes `intelligence_opportunities` from migration `0007`. Merge `ca1db69`. **What was caught** — the
coordinator's implementation-diff review returned FAIL on the phase's own claims, not on the
production code: a proactive push does not need a matching context, and the scan was not bounded by
a handful of rows. Both claims were false and the plan and report were corrected. The daily count
and the last-proactive read moved from a full table scan to an index search, verified independently
with `EXPLAIN QUERY PLAN`; the subject query still scans and its cost is handed to the next
migration, which owns the schema. A third reviewer run was spent beyond the budget of two, to
confirm the fixes. **Detail** —
[integration](./ai-native-journal-integration-17.md) ·
[phase report](./ai-native-journal-phase-17.md) ·
[plan](../plans/ai-native-journal/phase-17.md)

### Phase 18 — Authenticated interaction and control APIs

**Delivered** — the operator can be told what to do over HTTP and what they say is applied to
durable state: the public DTOs and strict request schemas in
`apps/web/src/lib/intelligence-interactions.ts`, the same-origin policy in
`apps/web/src/server/request-origin.ts`, the command service that resolves every decision before the
engine opens its transaction, and the routes for observations, opportunities, commands,
conversations and status. **Changed** — 17 files, +2805 / −251; the new
`lib/intelligence-interactions.ts`, the new `server/request-origin.ts`, `server/api.ts`, the new
`intelligence/experience/intents.ts` and `experience/commands.ts`, `composition.ts`, five routes
under `app/api/intelligence/` plus `queries.ts`, a new route suite. No schema allocation;
migrations `0001`–`0007` byte-unchanged. Merge `d5a230e`. **What was caught** — the
implementation review found a real bug and a missing proof. The bug: `POST
/api/intelligence/observations` selected the observation by id with no status predicate, so an
invalidated or superseded observation could still be put into review. The missing proof: the
revoked-scope refusal had no independent teeth, because the suite's only unknown-account case named
an account-bound workflow, where the workflow-scope check refuses with the same body. The first
destination gate run failed at `prettier --check` on two never-formatted candidate documents; the
formatting was applied at `2783ab4` and the whole gate was re-run alone. **Detail** —
[integration](./ai-native-journal-integration-18.md) ·
[phase report](./ai-native-journal-phase-18.md) ·
[plan](../plans/ai-native-journal/phase-18.md)

### Phase 19 — Native inbox and control UI, and the complete Slice B gate

**Delivered** — the operator can open the journal's inbox, see what it noticed, inspect the
evidence, correct it, defer it, dismiss it and control the two journal switches; and behind that
surface the observation becomes an engagement opportunity in the running code. The opportunity
producer is a pure module that runs on the transaction the caller already owns, because the worker
holds the write lock on its own connection and a second connection would deadlock the journal
instead of committing the observation and its opportunity together. The switches persist in the
existing settings key/value table, so a crash cannot leave a half-applied operator decision.
**Changed** — 20 files, +3397 / −133; the new `components/intelligence/{inbox,interaction-card,controls}.tsx`,
`components/shell.tsx`, `app/settings/page.tsx`, the new
`intelligence/experience/producer.ts`, `composition.ts`, `server/settings.ts`, the new
`app/api/intelligence/controls/route.ts`, the observations route and its query model, the extended
`lib/intelligence-interactions.ts`, `lib/use-api.ts`, the new Slice B gate suite and the new UI
suite. No schema allocation. Merge `4cab43c`. **What was caught** — the MAJOR: the observations GET
paired the first workflow of a subject instead of the actionable one and the POST started a second
workflow while one was live, so the served intent vanished after an acknowledgement and a workflow
row leaked on every review cycle. The implementation dispatch was abandoned by the orchestration after
it committed, so the coordinator's decision to grant the two Phase 18 route files could not reach
that worker; a repair dispatch paired the actionable workflow, served the observation review state
and refused a duplicate review start with `409 review_already_started`. The coordinator also found
that the proactive opt-in had nothing persisting it, that the deletion of persistent intelligence
was named in the brief although the contract review assigns it to Phase 20, and that nothing called
`engage()` outside the tests — so the Slice B chain was not a running path. **Detail** —
[integration](./ai-native-journal-integration-19.md) ·
[phase report](./ai-native-journal-phase-19.md) ·
[plan](../plans/ai-native-journal/phase-19.md)

### Phase 20 — Retention, backup/restore, deletion and operations documentation

**Delivered** — reference-aware retention in bounded batches that keeps what is still referenced and
drops what is finished, without breaking a live reference and without deleting a failure nobody has
looked at; an account purge that takes the account's whole intelligence with it and leaves a
deletion ledger behind, so a restore cannot bring it back; an explicit reset that suppresses the
automatic reseed until the operator asks for a rebuild; and a quiescent backup and restore — the
backup takes an explicit source, destination and quiescence acknowledgement and writes a
consistent snapshot with `VACUUM INTO`, never a copy of a live WAL file, and the restore lands in
scratch storage and verifies the copy _before_ anything migrates it. **Changed** — the phase extended
`infrastructure/{retention,knowledge-store,experience-store,jobs}.ts` and `trading/commands.ts`,
added `apps/web/src/db/journal-file.ts`, `apps/web/scripts/intelligence-operations.mjs` with the
`intelligence:operations` script entry, three routes under `app/api/intelligence/retention/`,
`docs/intelligence-operations.md` and `docs/database-migrations.md`, and three test suites
(`intelligence-retention`, `intelligence-backup`, `intelligence-acceptance`). The final merge's
diff against its candidate base was eight files, +416 / −175. No schema allocation; migrations
`0001`–`0007` byte-unchanged. **What was caught** — the review found that the delivered behaviour
was not wired (no retention job handler registered, no operator route, the deferred workflow resume
still broken) and that the backup and restore had no operator entry point at all, while the runbook
promised procedures no operator could perform. The destination gate then FAILED: every command before
`pnpm test` exited 0 and the suite failed 2 of 1372 tests, both in the repository's own
architecture test — the retention module wired the concrete `better-sqlite3` driver outside
`apps/web/src/db/`, and the infrastructure worker imported two handler constants from a sibling
domain's private file. The phase's own verification command had run only the three Phase 20 suites
and omitted the boundary test that caught them; every later phase runs it. Two merges followed: the
phase's first merge, whose gate failed, and then the boundary repair commits `73930f9` and `5f2793c`
merged in `33e1fce`, whose gate passed. **Detail** —
[integration](./ai-native-journal-integration-20.md) ·
[phase report](./ai-native-journal-phase-20.md) ·
[plan](../plans/ai-native-journal/phase-20.md)

### Phase 21 — Performance, complete packaging and the CI release acceptance

**Delivered** — the desktop package actually runs and leaves nothing behind: the CommonJS
sidecar dispatcher in an ESM package and the invalid ICO writer that had blocked the desktop checks
since Phase 10 are fixed, along with the three supervision defects around them; a measured 1k/10k/100k
benchmark over the real HTTP path with p50 and p95, the absolute gates (zero busy escapes, zero lost
effects, zero failed ingest requests, a drained queue) and a p95 regression gate that compares two
builds measured back to back; a package-content audit of the runtime tree and of the published
tarballs; and CI and release workflows that carry this repository's gates. **Changed** — the phase
owned `.github/workflows/ci.yml`, `.github/workflows/release.yml`, the `Dockerfile`,
`scripts/benchmark-intelligence.mjs`, `scripts/verify-features.py`, `desktop/README.md`,
`desktop/package.json`, `desktop/scripts/run-sidecar-setup.js`,
`desktop/src-tauri/{src/server.rs,src/lib.rs,tauri.conf.json}`,
`desktop/src-tauri/scripts/gen_icons/src/main.rs`, `apps/web/scripts/{run-journal.mjs,http-child.mjs}`,
`docs/intelligence-operations.md`, `apps/web/tests/intelligence-packaging.test.ts` and the phase
plan and report; the final merge carried ten of them, +390 / −413. No schema allocation; migrations
`0001`–`0007` byte-unchanged. Merge `c7c49ad`.
**What was caught** — the implementation review returned three findings: the busy-escape counter
could not observe a busy escape, the release record pointed at a file that did not exist, and an
undrained queue was silently accepted. The repair review of the fixed diff returned five more, all
about the release record being true: the packaged runtime-tree audit was enforced by no gate (the CI
quality job runs `pnpm test` before `pnpm build`, and the desktop job ran no vitest), the command
table omitted the three commands that produced the evidence, the release record listed every gate
except the one that is red, the packaged smoke never asserted the readiness signal, and the
benchmark misreported its own workload (the idle run's capture flag and its `null` queue). Running
the command the second of those demanded surfaced a sixth defect: the desktop installer build failed
on the MSI bundling step because the worker artifact shipped an install-time-only dependency chain
that pushed the packaged paths past the Windows path limit. Then the destination gate failed at
`pnpm typecheck` (exit 101) because the desktop scripts did not generate the gitignored bundle icons
the cargo steps need — the build worked only on the machine that had produced the icon. Two merges
followed: the first merge, whose gate failed, and then the icon repair merged in `c7c49ad`, whose
gate was re-run green with the desktop workspace in scope. The Windows packaged smoke passed with
the readiness signal asserted and no orphaned `node.exe`; the Docker scratch-volume smoke was
attempted and recorded as blocked host evidence. **Detail** —
[integration](./ai-native-journal-integration-21.md) ·
[phase report](./ai-native-journal-phase-21.md) ·
[plan](../plans/ai-native-journal/phase-21.md)

## What remains open

Three items are open. None of them is a broken behaviour in the integrated code; each is recorded
with its own evidence.

1. **The Docker scratch-volume smoke — blocked host evidence, carried to G-FINAL.** The daemon is
   not running on this host, and starting it is the operator's call. The smoke was attempted in
   Phase 21 and the output recorded — `failed to connect to the docker API at
npipe:////./pipe/dockerDesktopLinuxEngine` — and it was never claimed as passed. The CI `docker`
   job exists and has a daemon, so G-FINAL is where the item lands. Recorded in
   [the Phase 21 phase report](./ai-native-journal-phase-21.md) under _The
   Docker scratch-volume smoke — blocked host evidence_, in
   [the operations release record](../../intelligence-operations.md) and in the coordinator index's
   open items.
2. **`pnpm format:check` is red.** The repository's format gate was already red at the base commit
   and is red now; the release acceptance record states it as red and does not claim it passed. The
   measured numbers, over the files tracked in the base commit, are 73 failing at the base commit
   and 70 in the tree Phase 21 leaves behind — three fewer, none added, and the three that left are
   the desktop files this phase formatted; the raw repository-wide count is 74 because four
   gitignored Tauri-generated schema files exist in a built tree and not in a fresh checkout. An
   earlier wording of this item — "77 files", "the failing set is identical" — was found false
   during the Phase 21 gate repair and corrected in the phase report, in the operations record and in
   the coordinator index, whose open item now carries the corrected numbers. Recorded
   in [the Phase 21 phase report](./ai-native-journal-phase-21.md) under
   _Three files this phase left unformatted_ and in
   [the operations release record](../../intelligence-operations.md).
3. **The persisted home for an AI-assisted insight — a next-milestone item.** The chain's AI leg has
   no table of its own: an opportunity carries no text, and a provider call may not happen inside a
   write transaction. No phase in this run owns the migration that would give it one, and the leg
   itself is optional, so this is a next-milestone item and not a hole in the Phase 20 or Phase 21
   gates. Recorded in [the Phase 20 plan](../plans/ai-native-journal/phase-20.md) and
   [the Phase 20 phase report](./ai-native-journal-phase-20.md) under _The next
   phase's inputs_.

Two further surfaces are named in the same place and are also next-milestone items rather than
defects: the replay seam and the job cancel exist in the code and neither has an operator surface,
which the runbook says plainly rather than implying otherwise.

## Where the evidence lives

| What                                                                                                                                                                                                                               | Where                                                          | Count             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------- |
| Integration record per phase: merge SHA and parents, the ownership, schema and boundary verdicts, the full gate table with every exit code, the review verdict, any recorded gate failure                                          | `docs/superpowers/reports/ai-native-journal-integration-NN.md` | 21 files          |
| Phase report per phase: what was built, the deviations, the commands the worker ran, the proof of teeth                                                                                                                            | `docs/superpowers/reports/ai-native-journal-phase-NN.md`       | 21 files          |
| Plan per phase, committed before its implementation                                                                                                                                                                                | `docs/superpowers/plans/ai-native-journal/phase-NN.md`         | 21 files          |
| Coordinator index: the run summary, the three open items, one entry per integration, and every dispatch including the revoked and abandoned ones                                                                                   | `docs/superpowers/reports/ai-native-journal-worktrees.json`    | 1 file            |
| Operator runbook: the worker, the backlog, the dead letter, lease recovery, the no-provider behaviour, the opt-in budgets, retention, deletion and reset, the backup, the restore, the rollback, and the release acceptance record | `docs/intelligence-operations.md`                              | 657 lines         |
| The G-A and G-FINAL gate definitions and the integration rules                                                                                                                                                                     | `docs/orchestration/ai-native-journal/integration-plan.md`     | 53 lines          |
| The package manifest: each task's ownership, its schema allocation and its gates                                                                                                                                                   | `docs/orchestration/ai-native-journal/execution-manifest.json` | 21 tasks, 4 gates |

## How to use this document

This is the map. When you need the gate table for a phase, the commands, their exit codes and the
review findings, open that phase's integration record — it is the acceptance record for the phase.
When you need the operator procedures, open `docs/intelligence-operations.md`; it was re-read line by
line against the shipped code, and where an action still cannot be performed it says so plainly.
When you need to know what a phase was supposed to do before it did it, open that phase's plan.
