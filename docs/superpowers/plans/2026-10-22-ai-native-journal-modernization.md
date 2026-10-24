# AI-Native Journal Modernization Implementation Plan

> **For agentic workers:** The user selected superpowers:subagent-driven-development with Orca task/phase worktrees. Execute only the assigned phase-specific plan, not this whole umbrella plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable trade-change intelligence without a provider, then incrementally add scoped AI capabilities and durable interaction.

**Architecture:** Preserve the core engine, derived trade keys and existing routes. Introduce explicit transaction ownership, immutable projection evidence, SQLite outbox/jobs and a supervised worker. Compose internal knowledge/runtime/experience domains through typed ports and migrate existing AI via adapters.

**Tech Stack:** TypeScript strict, Node ≥22, pnpm 11.0.8, Next.js 15.5.23, Drizzle/better-sqlite3, Zod, existing AI SDK adapters, Vitest, tsup, Docker and Tauri.

**Spec:** [Architecture design](../specs/2026-10-22-ai-native-journal-architecture-design.md), amended by the normative [Architecture Contract Review](../specs/2026-10-22-ai-native-journal-architecture-contract-review.md). Read both before execution.

**Status:** Ready for review; not approved for production implementation. Baseline HEAD `e45707b158d21f2e63439c20f25c550f51079b17`. Existing uncommitted discovery work must be preserved. Proposed ADRs 0006–0008 accompany this plan.

**Handoff revision — 2026-10-23:** Implementation belongs to another agent, one explicitly
assigned phase at a time. Start with the [phase execution guide](2026-10-23-ai-native-journal-phases.md).
That guide is authoritative for execution order, task subdivisions and migration filenames;
the 13 tasks below remain the detailed behavior/test contracts. Do not execute an entire
multi-phase task in one run. Phase completion does not authorize starting the next phase.

**2026-10-24 execution selection:** Follow the
[handoff prompt sheet](2026-10-24-ai-native-journal-handoff-prompts.md) for feature setup,
phase-specific planning, subagent task worktrees, reviews and authorized local merge back to
`codex/ai-native-journal`. Stop after each verified integration; do not merge the feature to main.

## Global Constraints

- Do not integrate _The Mental Game of Trading_ or any book-derived systems.
- Do not introduce unrelated product features.
- Do not replace the pure trading calculation engine without compelling evidence.
- Do not break Pepperstone cTrader synchronization.
- Do not remove OpenAI-compatible provider support.
- Do not expose cTrader MCP operations automatically as agent tools.
- Do not use external network operations inside database write transactions.
- Do not create circular module dependencies.
- Do not add mandatory Redis, Postgres, or cloud infrastructure.
- Do not introduce complex multi-agent systems unnecessarily.
- Do not assume AI calls are reliable, resumable, or idempotent.
- Do not place unrestricted database access behind model tools.
- Do not publish intelligence modules accidentally through the monorepo's public package release workflow.
- Do not modify live trader data during experiments or testing.
- Preserve current API success shapes, encrypted credentials, execution hashes, trade keys, import review and hosted-only AI import policy.
- No new runtime dependency is planned. Use installed tsup/Zod/SQLite; a new dependency requires its own ADR.

## Review Focus

- A deleted account while an AI call is running must never regain observations or interactions (Tasks 5, 9, 12).
- An older event arriving after a correction/removal must not become active knowledge (Tasks 6–7).
- Crossing-flat fills and account transfers must not misassign identity or annotations (Tasks 3, 5).
- A compatible provider URL/model changed while queued must not send data to an unapproved endpoint (Task 9).
- Desktop hard kill/restart and installed paths without the checkout must not orphan workers or lose committed work (Tasks 8, 13).

## Scope, ownership and file layout

This is an ordered umbrella plan with three release slices: A (M0–M3), B (M4–M5), and hardening
(M6). Do not combine them into one refactor. Each task includes an independent failing-test /
implementation / verification cycle. Commit only task-owned files after passing its gate.
The phase guide splits the larger tasks, including migrations, mutation integration, deployment,
AI policy and interaction, into separately reviewed units. Its migration checklist is mandatory
for every schema-changing phase, including future maintenance after this modernization.

| Area                 | Exact root / files                                                                                                                          | Owner and exclusions                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Trading              | `apps/web/src/server/trading/{reconcile,projection,identity,commands}.ts`                                                                   | Financial mutation/reconstruction; no model calls       |
| Event contract/store | `apps/web/src/server/{domain-events,domain-event-store}.ts`                                                                                 | Strict domain envelope and transaction-only append      |
| DB seams             | `apps/web/src/db/{connection,transaction,migrations}.ts`, `db/migrations/0001-legacy-baseline.ts` onward                                    | Connection, synchronous tx type, ordered schema changes |
| Shared intelligence  | `apps/web/src/server/intelligence/contracts/{events,jobs,knowledge,execution,capabilities,tools,experience}.ts`                             | DTOs/schemas/ports only                                 |
| Infrastructure       | `apps/web/src/server/intelligence/infrastructure/{outbox,jobs,worker,scheduler,knowledge-store,experience-store,policy-store,retention}.ts` | SQLite adapters and worker mechanics                    |
| Knowledge            | `apps/web/src/server/intelligence/knowledge/{trade-observation,evidence-lifecycle,patterns}.ts`                                             | Pure evaluators and invalidation rules                  |
| Runtime              | `apps/web/src/server/intelligence/runtime/{registry,dispatcher,tool-gateway,ai-sdk-tools,model-policy}.ts`                                  | Bounded capabilities; supplied query/model ports        |
| Experience           | `apps/web/src/server/intelligence/experience/{workflows,engagement,interactions}.ts`                                                        | Deterministic state transitions and intents             |
| Composition          | `apps/web/src/server/intelligence/{composition,worker-entry}.ts`                                                                            | Wires ports; only explicit entry starts worker          |
| Process/build        | `apps/web/scripts/{run-journal,http-child,build-worker}.mjs`, `apps/web/worker.config.ts`                                                   | Supervisor, HTTP lifecycle, independent bundle          |
| Presentation         | `apps/web/src/lib/intelligence-interactions.ts`, `apps/web/src/components/intelligence/`                                                    | Safe DTOs and native UI                                 |

Keep current `ai*.ts` modules as compatibility adapters until parity tests pass. Test files live
under `apps/web/tests/`; no `src/**/*.test.ts` files that Vitest would miss.

## Contracts shared between tasks

Review §3 defines `JournalTx`, `ChangeContext`, `ReconcileResult`, `TradeChanged`,
`TradeProjectionEvidence`, `ObservationResult`, `JobClaim`, `WorkerService` and `WorkerHandle`.
Use those names/signatures verbatim. Add the following concrete interfaces in the designated
contracts files; imports refer to existing types where named.

```ts
// contracts/jobs.ts
type JobPayload =
  | { type: "evaluate_trade"; eventId: string; handlerVersion: "1" }
  | { type: "seed_account"; accountId: string }
  | { type: "run_capability"; runId: string }
  | { type: "workflow_effect"; workflowId: string; transitionRevision: number }
  | { type: "retention"; before: number };
type JobStatus = "pending" | "running" | "completed" | "retry_wait" | "failed" | "cancelled";
interface JobStore {
  enqueue(tx: JournalTx, key: string, payload: JobPayload, availableAt: number): string;
  claim(owner: string, now: number): JobClaim | null;
  renew(claim: JobClaim, now: number): boolean;
  cancel(jobId: string): void;
  fail(claim: JobClaim, code: string, now: number, retryable: boolean): boolean;
}
// Completion is transaction-only; assertClaim rejects stale owner/fence/lease/cancellation.
interface EffectStore {
  assertClaim(tx: JournalTx, claim: JobClaim, now: number): void;
  complete(tx: JournalTx, claim: JobClaim, now: number): void;
}

// contracts/execution.ts
type AuthorizedScope = Readonly<{
  accountIds: readonly string[];
  filters: Readonly<Record<string, string>>;
  timeZone: string;
  dataSource: DataSource; // existing ai-scope union, moved/re-exported without widening
}>;
type ExecutionContext = Readonly<{
  executionId: string;
  correlationId: string;
  principal: { kind: "interactive" } | { kind: "system"; policyRevision: number };
  trigger: "interactive" | "event" | "schedule" | "workflow";
  scope: AuthorizedScope;
  capabilityIds: readonly string[];
  toolIds: readonly string[];
  budgets: { timeoutMs: number; maxSteps: number; maxToolCalls: number; maxOutputTokens: number };
  signal: AbortSignal;
}>;
type ModelFeatures = Readonly<{
  tools: boolean;
  structuredOutput: boolean;
  images: boolean;
  documents: boolean;
  streaming: boolean;
  maxInputCharacters: number;
}>;
type Eligibility =
  { kind: "eligible" } | { kind: "defer"; until: number } | { kind: "ineligible"; reason: string };
type Outcome<T> =
  | { kind: "completed"; value: T }
  | { kind: "insufficient_evidence" | "unavailable" | "cancelled" | "failed"; code: string };
// contracts/capabilities.ts; schemas are z.ZodType<T> from existing Zod.
interface Capability<I, O> {
  id: string;
  version: string;
  mode: "deterministic" | "ai-assisted";
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  triggers: readonly string[];
  dependencies: readonly string[];
  toolIds: readonly string[];
  requiredModelFeatures: readonly (keyof Omit<ModelFeatures, "maxInputCharacters">)[];
  loadInstructions(): Promise<string>; // application-authored only, lazy
  evaluate(context: ExecutionContext): Promise<Eligibility>;
  execute(input: I, context: ExecutionContext): Promise<Outcome<O>>;
}
// contracts/tools.ts
interface ToolDefinition<I, O> {
  id: string;
  access: "read" | "propose" | "write";
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  execute(input: I, context: ExecutionContext): Promise<O>;
}
```

`JournalTx` appears only in repository interfaces used by infrastructure/composition, not in
pure knowledge/runtime/experience functions. Separate repository ports from pure payload files
where necessary to enforce this. No runtime domain receives `JobStore` or a DB handle directly.

## M0 — Safe seams and compatibility baseline

### Task 1: Establish explicit DB and error boundaries

**Depends on:** Approval of design, plan and ADRs.  
**Files:** Create `apps/web/src/db/{connection,transaction}.ts`, `apps/web/src/server/request-error.ts`,
`apps/web/tests/intelligence-boundaries.test.ts`, `apps/web/tests/db-connection-lifecycle.test.ts`.
Modify `apps/web/src/db/index.ts`, `apps/web/src/server/api.ts`, and domain imports of
`requireValue` in `executions.ts`, `position-import.ts`, `ibkr-sync-timezone.ts`,
`ninjatrader-import.ts`, `xtb-import.ts`, `ai-scope.ts`, `ai-capabilities.ts`,
`ai-import.ts` and any remaining worker-reachable helper found by the import graph.

**Interfaces:** `openConnection(directory: string): JournalDb`, `JournalTx`,
`withJournalTransaction<T>(fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T): T`;
`api.ts` re-exports the same `RequestError` class and `requireValue` function.

- [ ] Add tests proving two independently opened connections see committed state and closing one
      never deletes the other's WAL/SHM files; Promise-returning transactions are rejected.
- [ ] Add import-graph tests resolving aliases, relative imports, re-exports and type imports:
      core/importers cannot import intelligence; domains cannot import sibling private adapters;
      worker cannot reach Next/React/routes; only composition wires concrete implementations.
- [ ] Run `pnpm exec vitest run apps/web/tests/db-connection-lifecycle.test.ts apps/web/tests/intelligence-boundaries.test.ts`;
      expect failure for missing seams/current singleton cleanup.
- [ ] Implement connection/transaction seams; remove manual WAL/SHM unlink on singleton reset;
      move request-error helpers without changing route response behavior. Add typecheck coverage
      (`@ts-expect-error`) for async callbacks plus the runtime thenable guard.
- [ ] Re-run targeted tests and `pnpm exec vitest run apps/web/tests/execution-storage.test.ts apps/web/tests/ai-scope.test.ts`;
      expect green. Commit these files as `refactor: expose safe journal transaction boundaries`.

### Task 2: Add ordered additive migrations and schemas

**Execute in separate phases:** Phase 02 adds the migration system and legacy baseline only.
Phases 03, 04 and 08 add projection, transport and observation schemas respectively, immediately
before their consumers. The schema inventory below is the final Slice A inventory, not permission
to create every table in Phase 02. Use the phase guide's 0001–0007 migration allocation.

**Depends on:** Task 1.  
**Files:** Create `apps/web/src/db/migrations.ts`, `apps/web/src/db/migrations/0001-legacy-baseline.ts`,
`apps/web/tests/intelligence-migrations.test.ts`. Modify `apps/web/src/db/{bootstrap,schema}.ts`,
`apps/web/tests/db-concurrent-init.test.ts`. Create contracts `events.ts`, `jobs.ts`, `knowledge.ts`
under `apps/web/src/server/intelligence/contracts/` and `apps/web/src/server/domain-events.ts`.

**Interfaces:** `applyMigrations(sqlite: Database.Database): void`; strict version-1 event/job/
evidence schemas from the review; migration descriptor `{version,name,checksum,up(sqlite):void}`.

- [ ] Test fresh/legacy schema equivalence, repeat migration no-op, concurrent opens, injected
      migration failure rollback, checksum mismatch, and future-version rejection before writes.
      Verify credentials/hash/key/annotation bytes are unchanged in a synthetic legacy fixture.
- [ ] Run `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts`; expect missing runner/schema failures.
- [ ] In each owning schema phase, implement its Slice A tables and indexes from review §4, including partial unique
      current-key index and unique observation/effect keys. Use SQL CHECKs for states/revisions,
      nonnegative attempts and finite bounded counters; validate JSON at application boundaries.
      Account-owned records use account cascade where appropriate; membership has no source-fill FK
      because evidence must survive source removal. Outbox aggregate references are logical.
- [ ] Run migration and concurrent-init tests; expect no SQLITE_BUSY leaks or partial version advance.
      Commit as `feat: add versioned intelligence storage migrations`.

## M1 — Durable transport and processing mechanics

### Task 3: Version financial projections and resolve identity conservatively

**Depends on:** Task 2.  
**Files:** Create `apps/web/src/server/trading/{projection,identity}.ts`,
`apps/web/tests/trade-projection-identity.test.ts`.

**Interfaces:** `fingerprintProjection(input: ProjectionInput): string`;
`resolveIdentity(tx: JournalTx, input: IdentityInput): IdentityResolution`.
`ProjectionInput` is the full computed rebuild row plus currency/evidence quality;
`IdentityInput` contains account, new key, execution IDs, operation ID and optional explicit
transfer source ID. `IdentityResolution` returns trade ID, next revision, and the review's
resolution union; ambiguity includes candidate IDs, never a guessed winner.

- [ ] Pin invariants: annotation/label change leaves fingerprint equal; changed fee or exit
      attribution differs; canonical JSON reorder is equal; same active key retains ID; removed key
      reappearance gets new ID; shared crossing-flat execution cannot establish continuity.
- [ ] Run `pnpm exec vitest run apps/web/tests/trade-projection-identity.test.ts`; expect missing functions.
- [ ] Implement canonical serialization from an explicit computed-field list and exact-key mapping.
      Allow explicit transfer only for unique full membership/account-qualified matching; store
      ambiguous links and immutable revision/membership rows. No change to core key generation.
- [ ] Run identity tests and `pnpm exec vitest run packages/core/tests/round-trips.test.ts`;
      expect green. Commit as `feat: version trade projection evidence without changing keys`.

### Task 4: Implement transactional fanout, jobs and fencing

**Depends on:** Task 2 (Task 3 may be reviewed independently).  
**Files:** Create `apps/web/src/server/domain-event-store.ts`,
`apps/web/src/server/intelligence/infrastructure/{outbox,jobs,worker}.ts`,
`apps/web/tests/intelligence-{outbox,jobs,worker}.test.ts`.

**Interfaces:** `appendDomainEvent(tx: JournalTx, event: TradeChanged): void`;
`dispatchOutbox(limit: number, now: number): number`; review `WorkerService`/`JobClaim` and
plan `JobStore`/`EffectStore`. Clock and handler registration are injected, not global timers.

- [ ] Write tests for event rollback, fanout crash before/after commit, duplicate dispatch,
      competing claimants on two SQLite connections, expired worker/job leases, cancelled work,
      stale completion and unknown schema terminal failure. Example assertions:
      `expect(observationCount).toBe(1); expect(oldOwnerComplete()).toThrow();`.
- [ ] Run `pnpm exec vitest run apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-worker.test.ts`;
      expect missing infrastructure failures.
- [ ] Implement SQL guarded claims/fences and unique delivery keys; enforce review §5 constants
      (single worker/job, 30s worker lease, 60s job lease, five attempts, 1/5/30/120s retry delays).
      Atomically insert delivery/job and mark fanout; completion uses `assertClaim` inside effect tx.
      Preserve pending work when the worker is disabled; expose sanitized state/last heartbeat.
- [ ] Re-run tests with injected time, plus real-connection contention test. Expect one owner
      and no duplicate effect. Commit as `feat: add durable outbox and fenced SQLite jobs`.

## M2 — Integrate every trading mutation

### Task 5: Reconcile changes atomically across all paths

**Depends on:** Tasks 1–4.  
**Files:** Create `apps/web/src/server/trading/{reconcile,commands}.ts`,
`apps/web/tests/trade-reconciliation.test.ts`, `apps/web/tests/trade-mutation-events.test.ts`.
Modify `server/{executions,rebuild,sync,ninjatrader-import,xtb-import,ibkr-flex-xml-import,demo,settings}.ts`,
`server/ctrader-mcp/sync.ts`, `app/api/{import,settings}/route.ts`,
`app/api/accounts/[id]/route.ts`, `app/api/accounts/[id]/actions/route.ts`,
`app/api/trades/[key]/route.ts`, `app/api/trades/bulk/route.ts` (all under `apps/web/src`).

**Interfaces:** Review `reconcileAccountInTx` and `insertExecutionsInTx`; preserve public
`insertExecutions`, `rebuildAccount`, `deleteExecutionsForTrades` and `SyncOutcome`.
Add command functions `clearAccount(id, context): void`, `deleteAccount(id, context): void`,
`transferAccount(sourceId, destinationId, context): void` and transaction-aware settings readers.

- [ ] Add parameterized fixture coverage for every row in the mutation matrix below. Inject
      failures after fill mutation, projection write and event append; assert entire operation
      rolls back, including notes, import batch and sync status.
- [ ] Run `pnpm exec vitest run apps/web/tests/trade-reconciliation.test.ts apps/web/tests/trade-mutation-events.test.ts`;
      expect no events/partial-boundary failures.
- [ ] Implement prior-state reads and all projection writes inside a single immediate transaction.
      Keep external fetch/parsing outside. Re-run XTB holding and IBKR checks within commit, keep
      NinjaTrader reviewed token recomputation, and preserve all result counts/warnings.
- [ ] Integrate clear/delete/transfer and both-account reconciliation. Recheck account existence
      after broker fetch. Delete cancels/purges intelligence under the same transaction; clear writes
      tombstones. Transfer reattaches annotations only on proven unique mapping, otherwise rejects.
      Bulk delete uses account batching below SQLite bind limits and one command transaction.
- [ ] Verify no-op resync gives zero events; historical close gives `discovered`; observed open-to-
      closed gives `closed`; fee-only correction gives `revised`; multiplier/method changes preserve
      annotation values. Run the two new files plus execution-storage, sync-resilience, NinjaTrader,
      XTB, IBKR timezone/Flex XML, import-account, history-import and all cTrader tests.
- [ ] Commit as `feat: reconcile trading mutations with atomic domain events`.

| Mutation                                      | Event/consistency expectation                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Manual fills / manual notes / duplicate retry | Existing validation and note dedup; events only for computed changes                   |
| Generic, position-history, AI-reviewed import | Preserve preview/fee policy; historical classification                                 |
| XTB open holding then closed workbook         | No phantom open; revalidate matched entry under lock                                   |
| IBKR Flex XML and SDK sync                    | Preserve timezone locks and import/sync agreement                                      |
| NinjaTrader insert/correction/retry           | Batch/source aliases, approved fee corrections and events commit together              |
| SDK and cTrader MCP sync                      | Fetch outside tx; snapshot and event rollback together; repeated identical sync silent |
| Single and bulk trade delete                  | Fill deletion and rebuilt affected cycles atomic, including crossing-flat shared fills |
| Account clear/delete/transfer                 | Removal/purge or explicit identity transfer; no partial financial/annotation state     |
| Method and global multiplier settings         | Setting and all affected reconciliations atomic; measured lock gate                    |
| Demo loading                                  | Historical mode, same ingestion boundary, no proactive flood                           |

## M3 — Evidence and deterministic vertical slice

### Task 6: Persist factual observations and source quality

**Depends on:** Task 5.  
**Files:** Create `apps/web/src/server/intelligence/knowledge/{trade-observation,evidence-lifecycle}.ts`,
`apps/web/src/server/intelligence/infrastructure/knowledge-store.ts`,
`apps/web/src/server/intelligence/composition.ts`, `apps/web/tests/intelligence-observations.test.ts`.
Modify `apps/web/src/server/ctrader-mcp/{deals,sync}.ts`; extend `apps/web/tests/ctrader-mcp/{deals,sync}.test.ts`.

**Interfaces:** `evaluateTradeProjection(source): ObservationResult` from review;
`persistObservationInTx(tx: JournalTx, claim: JobClaim, event: TradeChanged, result: ObservationResult, now: number): void`.
Add `classifyExecutionEvidence(fill, sourceContext): { timingQuality: TimingQuality; sourceKind: string }`
in trading projection module; sourceContext includes explicit synthetic/history provenance.

- [ ] Test duplicate delivery produces exactly one observation/evidence link; correction supersedes;
      removal invalidates; reverse event order cannot revive old truth; synthetic entry with either
      zero or nonzero duration never implies source-reported timing; legacy quality stays unknown.
- [ ] Run `pnpm exec vitest run apps/web/tests/intelligence-observations.test.ts`; expect missing evaluator/store failures.
- [ ] Implement `trade.projection-observed` evaluator version `1`, storing net P&L/fees/status
      with evidence/currency and null unsupported duration. Keep direct fact vs derived observation
      explicit. Store quality outside import hashes; allow idempotent quality enrichment.
- [ ] In one fenced transaction, persist observation, supersede/invalidate based on current
      revision, and acknowledge job/delivery. Account deletion or stale source cancels output.
- [ ] Run new observations and cTrader tests; expect existing monetary/hash fixtures unchanged.
      Commit as `feat: derive persistent factual trade observations`.

### Task 7: Historical seed, replay and no-provider recovery gate

**Depends on:** Task 6.  
**Files:** Create `apps/web/src/server/intelligence/infrastructure/backfill.ts`,
`apps/web/tests/intelligence-slice-a.test.ts`, `apps/web/tests/intelligence-recovery.test.ts`.
Modify composition and jobs to register `seed_account`.

**Interfaces:** `seedAccount(accountId: string, operationId: string): ReconcileResult`;
`requestReplay(eventId: string, handlerId: string, handlerVersion: string): string` is an
authenticated operational command, never a model tool. Persist seed checkpoint in migration 0004.

- [ ] Test restart midway through historical seed, new mutation before seed, duplicate replay,
      correction/removal before a prior event is processed, and failure between effect and acknowledgement.
      Use real file DB and child-process kill/reopen; no live accounts or providers.
- [ ] Run `pnpm exec vitest run apps/web/tests/intelligence-slice-a.test.ts apps/web/tests/intelligence-recovery.test.ts`;
      expect missing backfill/replay behavior.
- [ ] Implement per-account historical seed and durable checkpoint; skip already-mapped state.
      Explicit replay reuses business dedup keys; retry failed delivery does not mint a new effect key.
      Do not use old import batches as a complete event history.
- [ ] Run with provider resolver set to throw on any access: trade change → event → worker →
      persistent observation must succeed. Reopen DB and assert the same evidence and observation.
      Commit as `feat: recover and seed deterministic intelligence safely`.

### Task 8: Package and supervise the worker on every deployment target

**Depends on:** Tasks 4, 6–7; required before Slice A release.  
**Files:** Create `apps/web/src/server/intelligence/worker-entry.ts`,
`apps/web/scripts/{run-journal,http-child,build-worker}.mjs`, `apps/web/worker.config.ts`,
`apps/web/tests/intelligence-supervisor.test.ts`, `apps/web/tests/intelligence-packaging.test.ts`.
Modify `apps/web/package.json`, root `package.json`, `apps/web/scripts/copy-static-build.js`,
`apps/web/next.config.ts`, `Dockerfile`, `desktop/src-tauri/src/{server,lib}.rs`,
`desktop/src-tauri/tauri.conf.json`, `desktop/README.md`.

**Interfaces:** Supervisor accepts `--mode dev|production`, absolute `JOURNAL_DATA_DIR`, explicit
port/host and worker enable flag; child IPC messages `ready`, `health`, `shutdown`, `stopped`.
Only `worker-entry.ts:main()` starts `WorkerService`. Rust `start_server` receives and fills the
existing `SharedServerState` rather than allocating a disconnected state.

- [ ] Test no worker startup on import/build, duplicate launch elects one worker, worker crash
      recovery, bounded restart storm, parent disconnect, graceful stop and forced kill. Test HTTP
      failure stops worker; worker failure leaves HTTP usable with unhealthy diagnostics.
- [ ] Run supervisor/packaging tests before implementation; expect missing entries/assets.
- [ ] Bundle worker with existing tsup, resolving workspace aliases and excluding native
      better-sqlite3; explicitly copy runtime dependencies and entry files into standalone/Tauri
      outputs. Add `build:worker`, `dev:journal`, and supervisor-backed production startup scripts.
      HTTP child wraps existing Next startup; IPC disconnect cleanup is registered before startup.
- [ ] Implement review §5 shutdown/restart defaults and Rust child ownership. Desktop binds
      loopback with explicit nonzero port, retries three collisions, and parses structured readiness.
      Never assume parsing arbitrary Next stdout establishes readiness or a valid actual port.
- [ ] Verify clean-directory startup with only packaged assets and synthetic data on Node 22
      and the actual sidecar executable; build and run Docker against a scratch volume; build
      desktop and exercise repeated restart/quit with no leftover processes. Run Rust tests/check.
      Ports must exclude 3000/3001 used by the user's working app.
- [ ] Commit as `feat: supervise and package journal intelligence worker`.

**Slice A gate:** Tasks 1–8 green, targeted financial regression and full `pnpm test` pass,
no-provider kill/restart recovery and packaged smoke pass. Record measured results. Do not begin
general AI execution until this coherent slice is verified; failures are fixed within the slice.

## M4 — Generalize existing AI through scoped adapters

### Task 9: Execution policy, registry and tool gateway

**Depends on:** Slice A gate.  
**Files:** Create contracts `{execution,capabilities,tools}.ts`, runtime
`{registry,dispatcher,tool-gateway,ai-sdk-tools,model-policy}.ts`, infrastructure `policy-store.ts`
under `apps/web/src/server/intelligence/`; create `apps/web/src/db/migrations/0005-intelligence-runtime.ts`;
create `apps/web/tests/intelligence-{runtime,scope,provider-policy}.test.ts`.
Modify `server/{ai,ai-runtime,ai-contracts,ai-scope,ai-capabilities,settings}.ts`,
`app/api/settings/route.ts`, `components/ai-settings.tsx`, and composition.

**Interfaces:** Contracts above; `createInteractiveContext(scope: FrozenApprovedScope, signal: AbortSignal): ExecutionContext`;
`authorizeBackgroundRun(runId: string, now: number, signal: AbortSignal): Outcome<ExecutionContext>`;
`reserveBackgroundAttempt(tx: JournalTx, runId: string, now: number): boolean`;
`ToolGateway.execute(id, input: unknown, context): Promise<Outcome<JsonValue>>` validates at boundary.
`JsonValue` is recursive serializable JSON, narrowed immediately by each registered schema.

- [ ] Test unknown input fields, out-of-scope keys, deleted accounts, forged principals, denied
      tools, exhausted/cancelled runs and invalid tool outputs. Keep existing 3+1 tool exposure.
      Test no key, keyless compatible, unsupported tools, provider timeout, and URL/model change
      after enqueue without any fallback request. Pin hosted-only import compatibility separately.
- [ ] Run new runtime/scope/provider-policy tests; expect missing gateway/policy behavior.
- [ ] Implement deterministic registry/eligibility; skills are registered capability descriptors
      with lazy application-authored instructions and validated dependency IDs. No dynamic external code.
      Supply existing read queries through composition; preserve filtered trade-detail access rather
      than replacing it with unrestricted `getTradeByKey`.
- [ ] Add migration 0005: `intelligence_runs` (PK id, unique effect_key, status/provider/model/
      endpoint_fingerprint/policy_revision/scope_json, sanitized meta), `intelligence_policy` (PK id,
      revision, settings JSON), `intelligence_budget_reservations` (PK run_id/attempt, day index).
      Reserve daily attempts atomically; crashes retain reservations. Review §6 fixes caps and defaults.
- [ ] Add optional abort signal/deadline to existing AI request adapters, preserving all legacy
      call sites and interactive constants. Explicit model capability settings gate background
      tools/structured output; no live probe without user action. Bound context to configured
      `maxInputCharacters`; unknown capacity is unavailable for background runs.
- [ ] Run new tests plus `ai-runtime`, `ai-settings`, `ai-scope`, `ai-ask-agent`, `ai-reports-route`,
      `ai-capability`, `ai-import` and `ai-feedback` suites. Assert unchanged JSON response keys,
      hosted OpenAI `store:false`, compatible key binding and no prompt/credential diagnostics.
      Commit as `feat: execute scoped intelligence through compatible AI adapters`.

### Task 10: Source invalidation, scheduler and knowledge extension contracts

**Depends on:** Task 9.  
**Files:** Create `apps/web/src/server/intelligence/infrastructure/scheduler.ts`,
`apps/web/src/server/intelligence/knowledge/patterns.ts`, `apps/web/src/db/migrations/0006-knowledge-scheduling.ts`,
`apps/web/tests/intelligence-{scheduler,knowledge-revisions}.test.ts`.
Modify `server/domain-events.ts`, composition, and routes
`app/api/trades/[key]/{route,rules/route}.ts`, `app/api/trades/bulk/route.ts`,
`app/api/journal/[date]/route.ts`, `app/api/playbooks/route.ts`, `app/api/playbooks/[id]/route.ts`,
`app/api/notes/route.ts`, `app/api/notes/[id]/route.ts` and
`app/api/folders/[id]/route.ts` where those source writes occur (including note creation
and folder deletion that changes note visibility).

**Interfaces:** `scheduleDue(now: number): number`; `applySourceChange(tx, change: SourceChange): void`.
`SourceChange` is a strict union of annotation/rule-check/playbook/journal/note revision or deletion,
with source kind, ID, account scope where applicable, revision and correlation ID. Shared journal
notes retain their existing cross-account semantics; narrowed scopes must not expose them.
`PatternEvaluation = {kind:"insufficient_evidence"; required:number; available:number} |
{kind:"evaluated"; evaluatorId:string; version:string; evidenceIds:string[]}`.

- [ ] Test schedule duplicate ticks, restart after due time, DST gap/fold, long offline coalescing,
      source correction/delete, and insufficient evidence. Test concurrent annotation and rebuild
      preserves user values while knowledge revisions advance independently.
- [ ] Run scheduler/knowledge-revisions tests; expect missing scheduler and invalidation events.
- [ ] Add `intelligence_schedules` (PK id, definition_version, next_due_at index, checkpoint),
      `knowledge_sources` (unique kind/id/revision), `knowledge_hypotheses` and `knowledge_patterns`
      (versioned payload/evidence/status). Persist self-reports separately from derived findings.
      No behavioral/book rule is implemented; use a synthetic evaluator fixture to prove contracts.
- [ ] Wrap relevant source writes and their events atomically; source invalidation marks dependent
      active knowledge stale and enqueues reevaluation. Condition triggers use durable checkpoints;
      time triggers use unique schedule/due/version keys. Neither invokes an LLM for scheduling.
- [ ] Run new tests and applicable journal/playbook/note/rule-check regressions. Commit as
      `feat: schedule bounded intelligence and propagate source revisions`.

## M5 — Durable experience and controlled interaction

### Task 11: Workflow transitions and engagement policy

**Depends on:** Tasks 9–10.  
**Files:** Create `apps/web/src/server/intelligence/contracts/experience.ts`,
`experience/{workflows,engagement,interactions}.ts`, `infrastructure/experience-store.ts`,
`apps/web/src/db/migrations/0007-intelligence-experience.ts`,
`apps/web/tests/intelligence-{workflows,engagement}.test.ts`.

**Interfaces:** `transitionWorkflow(command: WorkflowCommand, context: ExecutionContext): WorkflowResult`;
`decideEngagement(input: EngagementInput): EngagementDecision` (pure);
`WorkflowCommand = {commandId:string; workflowId:string; expectedRevision:number;
action:"acknowledge"|"correct"|"defer"|"cancel"; correction?:string; deferUntil?:number}`.
`WorkflowResult` is `applied(newRevision) | duplicate(priorResult) | conflict(currentRevision)`.
`EngagementDecision` carries `observe|inbox|contextual|proactive|defer|suppress`, reason and next eligibility.

- [ ] Test duplicate/stale commands, crash after transition before effect, waiting without leased
      job, deferred restart, dismissal, expiry and overlapping opportunities. Test unknown trading
      activity suppresses unsolicited interruption rather than inventing an idle state.
- [ ] Run workflow/engagement tests; expect missing state machine and policy.
- [ ] Add tables `intelligence_workflows` (PK id, definition/version, revision/status),
      `workflow_transitions` (unique workflow/revision), `interaction_commands` (unique command_id,
      payload digest/result), `intelligence_opportunities` (unique dedup_key, eligibility/expiry index),
      `intelligence_conversations`, `intelligence_messages`, `workflow_conversations` (join table).
      Conversation/workflow are independent; all knowledge links remain explicit.
- [ ] Implement a single neutral review-observation workflow: running → waiting_for_user →
      completed/cancelled or scheduled → waiting_for_user. Correction records self-report/evidence,
      not a financial write. Validate versioned transitions; effect jobs enqueue in the same tx.
      Different payload with same command ID conflicts; exact retry returns stored outcome.
- [ ] Implement central engagement defaults: observe historical/baseline, inbox for actionable
      current observation, proactive only opt-in; at most one proactive delivery per day and 24h
      per-subject cooldown. Dismissal suppresses that opportunity/evidence revision; default expiry
      seven days. Contextual requires matching UI context; unknown activity uses inbox. Persist
      delivery reservations so retries cannot double-notify.
- [ ] Run new suites with fake time and real SQLite. Commit as `feat: persist workflows and coordinate engagement`.

### Task 12: Native interaction, user controls and Slice B

**Depends on:** Task 11.  
**Files:** Create `apps/web/src/lib/intelligence-interactions.ts`,
`apps/web/src/app/api/intelligence/{observations,opportunities,commands,conversations,status}/route.ts`,
`apps/web/src/components/intelligence/{inbox,interaction-card,controls}.tsx`,
`apps/web/tests/intelligence-{routes,ui,slice-b}.test.ts`.
Modify `apps/web/src/components/shell.tsx`, `apps/web/src/app/settings/page.tsx`, composition,
and `apps/web/src/server/request-origin.ts` (create).

**Interfaces:** `InteractionIntent` strict union of observation-review, status and input-request;
server supplies action IDs, expected revision, text/evidence references and input constraints.
POST commands returns `WorkflowResult`; use 409 for stale revision, 400 invalid input, 401 auth,
403 denied origin/scope. GET returns only active scoped data and authorized action descriptors.

- [ ] Test authenticated/unauthenticated requests, malicious origins, stale/duplicate UI action,
      revoked scope, account deletion during AI, correction, dismiss/defer, provider timeout and
      no-provider deterministic route. UI tests cover keyboard use, privacy masking and loading/error states.
- [ ] Run new routes/UI/Slice B tests; expect missing routes/components.
- [ ] Implement thin `handler(...)` routes with strict schemas and sanitized unexpected errors.
      New mutating routes/settings require same-origin validation; missing Origin uses explicit
      trusted nonbrowser policy rather than accepting arbitrary cross-site requests. No UI command
      is authorized by its presence in a generated payload alone.
- [ ] Render native components using existing primitives; expose background AI and proactive
      opt-ins, inspect evidence, correction, pause/resume, worker status and intelligence deletion.
      Keep Ask/Reports/Recap/Critique/Import JSON contracts unchanged; no streaming prerequisite.
- [ ] Exercise observation → optional AI → opportunity → policy → user command → persisted
      knowledge/workflow, restarting before continuation. Assert completed effect unique and
      no-provider path usable. Run full `pnpm test` and typecheck. Commit as
      `feat: expose controlled intelligence interactions and user settings`.

## M6 — Release gates and operations

### Task 13: Retention, backup, performance and deployment acceptance

**Depends on:** Slice B gate (Tasks 9–12); reuse Task 8 packaging tests.  
**Files:** Create `apps/web/src/server/intelligence/infrastructure/retention.ts`,
`apps/web/tests/intelligence-{retention,backup,acceptance}.test.ts`,
`scripts/benchmark-intelligence.mjs`, `docs/intelligence-operations.md`.
Modify `.github/workflows/ci.yml`, `Dockerfile`, desktop runtime tests/README, root README and
`scripts/verify-features.py`; preserve public `.github/workflows/release.yml` publish targets.

**Interfaces:** `pruneIntelligence(before: number, limit: number): {removed:number}`;
`purgeAccountIntelligence(tx: JournalTx, accountId: string): void` integrated in Task 5;
backup command accepts only explicit source/destination and quiescence acknowledgement.

- [ ] Test reference-aware retention and compact dedup preservation, cancel/purge racing a leased
      completion, reset without reseed, restore with synthetic encrypted settings, and migration
      failure recovery. Keep pending/unacknowledged failures inspectable; apply review §6 retention.
- [ ] Run retention/backup/acceptance tests; expect missing pruning/backup tooling.
- [ ] Implement bounded retention jobs and operational diagnostics. Document backlog, dead-letter
      retry, unsupported event schema, worker disabled/unhealthy, lease recovery, no-provider behavior,
      opt-in budgets, and complete backup/restore/rollback procedure from review §6.
- [ ] Benchmark 1k/10k/100k synthetic fills in explicit scratch directories, idle versus active
      worker, reporting rebuild lock duration, p50/p95 HTTP latency and queue latency. Release gate:
      zero SQLITE_BUSY escapes, no lost effects, and p95 HTTP regression ≤20% against the same-machine
      baseline under the defined fixture load. If failed, stop rollout and record results; do not
      silently weaken transaction consistency or adjust the threshold to pass.
- [ ] Run CI sequence: `pnpm format:check`, `pnpm typecheck`, `pnpm test`,
      `node scripts/check-licenses.mjs`, `pnpm -r --filter "./packages/*" build`, `pnpm build`.
      Set disposable `JOURNAL_DATA_DIR` for builds (route imports initialize storage). Run Docker
      and Windows packaged smoke/restart/kill tests; archive fixture-only results and runtime versions.
- [ ] Inspect public package tarball file lists without publishing; no intelligence source,
      credentials, database or runtime assets may be included. Verify worker assets are present in
      web/desktop artifacts and native SQLite matches each target runtime.
- [ ] Commit as `test: harden intelligence recovery packaging and operations`; update ADR status
      only to reflect actual approval and update design deviations with evidence.

## Verification and completion policy

Every task uses the exact targeted commands above. `pnpm exec vitest run` is the canonical command;
if Corepack cannot download pnpm in this environment, the already installed
`node node_modules/vitest/vitest.mjs run ...` is an equivalent documented test fallback.
Do not install packages or run live broker/provider calls simply to obtain a baseline.
Use `hub` for long-running dev/smoke servers according to AGENTS.md; finite tests need no watcher.

The 2026-10-22 review baseline passed 18 files / 220 tests, documented in review §9. It is not
a full CI, Node 22, Docker or Tauri acceptance result. All new-task checkboxes remain unchecked.

Completion requires both vertical slices, all acceptance scenarios in design §18, no-provider
operation, safe identity/invalidation/deletion, compatible providers, verified process recovery,
unchanged financial/import regressions and tested deployment artifacts. No claim of completion
may substitute code review or mocked tests for the named process/packaging gates.

## Coverage and approval

| Design sections                                              | Owning tasks                              |
| ------------------------------------------------------------ | ----------------------------------------- |
| 1–5 principles/modules                                       | 1, 3, 9, boundary checks throughout       |
| 6 events / 7 reconciliation                                  | 2–7                                       |
| 8 jobs/scheduler/deployment                                  | 4, 7–8, 10, 13                            |
| 9 evidence/knowledge/memory                                  | 3, 6–7, 10–13                             |
| 10 capabilities/skills / 11 tools / 12 models                | 9                                         |
| 13 workflows / 14 engagement / 15 interactions               | 11–12                                     |
| 16 security / 17 migration                                   | 1–2, 5, 8–9, 12–13                        |
| 18 acceptance / 19 exclusions / 20 questions / 21 completion | Slice gates, review decisions and Task 13 |

Self-review: source paths and named interfaces checked; every target section has an owning task;
five Review Focus failure modes have explicit tests. Runtime behavior not experimentally verified
is retained as a release gate. This plan does not authorize production edits.

**Execution handoff:** Another agent will implement the assigned phase using the
[phase guide](2026-10-23-ai-native-journal-phases.md). Supply the phase ID in its assignment.
The implementing agent completes that phase, records verification and deviations, performs
the authorized tested feature-branch merge from the prompt sheet, and stops.
This documentation revision neither starts production implementation in this chat
nor authorizes batching later phases together.
