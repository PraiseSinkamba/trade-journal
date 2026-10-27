# Phase 05 — Transaction-aware reconciliation for manual and generic ingestion

> **For agentic workers:** implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> Implement only this phase. Do not begin Phase 06.

**Goal:** A committed manual or generic-import change leaves its fills, its reconstructed trade
projections, its immutable projection evidence and its durable domain event in **one** transaction.
An identical retry is silent.

**Architecture:** `apps/web/src/server/trading/reconcile.ts` is the reconciliation boundary and the
**only** writer of projection rows, projection revisions and domain events. It compares the prior
persisted projections with the reconstructed ones, so a projection that did not change produces no
revision and no event. `apps/web/src/server/trading/commands.ts` is the command layer the API
routes call. `apps/web/src/server/executions.ts` gains the transaction-taking `insertExecutionsInTx`
and keeps its public adapters (`insertExecutions`, `deleteExecutionsForTrades`) with unchanged
signatures and results. `apps/web/src/server/rebuild.ts` keeps its public `rebuildAccount` as a
thin adapter over the same boundary, so there is one writer and one comparison, not two.

**Tech Stack:** existing TypeScript (strict, `noUncheckedIndexedAccess`), Next.js 15, Drizzle +
better-sqlite3, Zod, Vitest, `node:crypto` UUIDs. **No new dependency. Schema allocation: none**
(no table, no migration, no checksum change).

**Authoritative references:** phase guide Phase 05
(`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), detailed plan Task 5
(`docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md`), design §6/§7, contract
review §2–§6, ADR 0006.

---

## Global constraints

- **Schema allocation: none.** No table, no migration, no `migration-checksums.json` change, no
  `db/schema.ts` change, no `db/bootstrap.ts` change. The tables this phase reads and writes
  (`trade_identities`, `trade_projection_revisions`, `trade_revision_executions`,
  `trade_identity_links`, `domain_outbox`) already exist from Phase 03 and Phase 04.
- **Forward-only migrations are untouched.** `0001`, `0002`, `0003` are not edited, renumbered or
  deleted.
- **No new dependency** → no ADR change, no manifest change, no lockfile change.
- **Production event capture stays off** (phase guide: "Phases 05–09 keep production event
  capture/worker disabled by default; tests explicitly enable them"). Capture is one global
  switch, never a per-path switch, so the event stream can never be partial.
- **Preserve** execution hashes, derived trade keys, annotations, cTrader sync, all three AI
  provider categories, encrypted credentials and every import/AI response contract. The public
  `insertExecutions`, `rebuildAccount`, `deleteExecutionsForTrades` and `SyncOutcome` keep their
  signatures and results.
- **No network call, promise or provider call inside a write transaction.** Fetch and parse stay
  outside; the transaction is synchronous by contract (`db/transaction.ts` enforces this).
- **One implementation writer.** The coordinator has not committed an exact disjoint split, so
  the shared ingestion/rebuild code and the two new test files are written by one owner (this
  phase's worker). Reviews are read-only and delegated to the reviewer agent.
- **Node ≥ 22, pnpm 11.0.8, frozen lockfile.** `pnpm install` is already done; do not reinstall.
- Disposable absolute `JOURNAL_DATA_DIR` and scratch DB files under the OS temp dir. Never use
  ports 3000/3001. Never touch live trader data.

---

## The call graph (one writer, no double write)

```
app/api/executions/route.ts ──► trading/commands.ts ──► server/executions.ts
app/api/import/route.ts     ──►        │                       │  insertExecutionsInTx
                                            │                       ▼
                                            │            trading/reconcile.ts ◄── the only writer of
                                            │            reconcileAccountInTx        projection rows,
                                            │                                      revisions, events
                                            ▼
server/rebuild.ts ── rebuildAccount(accountId) ──► reconcileAccountInTx  (same boundary)
```

Rules that follow from the graph:

1. **`insertExecutionsInTx` calls `reconcileAccountInTx`. It never calls `rebuildAccount`.** The
   projection rows are written exactly once, by the reconciliation boundary.
2. **`rebuildAccount` is an adapter over the same boundary**, not a second writer. It opens one
   immediate transaction and calls `reconcileAccountInTx` with a maintenance context. A rebuild
   therefore updates the projection rows, the revision chain and — when capture is on — the
   events, in one transaction. The Phase 06 and Phase 07 paths that call `rebuildAccount` or
   `insertExecutions` inherit that behaviour without changing a line.
3. **`deleteExecutionsForTrades` deletes the fills and reconciles in the same transaction.** The
   projections that disappear are retired and reported as `removed`.
4. **There is no `rebuildAccountInTx` and no `deleteExecutionsForTradesInTx`.** A later phase that
   needs a rebuild inside its own transaction calls `reconcileAccountInTx(tx, accountId, context)`
   — that is the transaction-taking form, and it exists. A second unused variant is not created.

---

## Contracts (authoritative — implement exactly)

### `apps/web/src/server/trading/reconcile.ts` (new)

```ts
export type { ChangeContext } from "../domain-events"; // operationId, origin, mode, recordedAt

export interface ReconcileResult {
  discovered: number;
  opened: number;
  closed: number;
  revised: number;
  removed: number;
  unchanged: number;
  ambiguous: number;
}

export declare function reconcileAccountInTx(
  tx: JournalTx,
  accountId: string,
  context: ChangeContext,
): ReconcileResult;

export declare function isEventCaptureEnabled(): boolean;
```

`reconcileAccountInTx` does, in this order, inside the caller's transaction:

1. **Read the prior persisted projections.** The account's `trades` rows, read before they are
   overwritten, and the account's own `currency`. The prior row is the projection the journal
   holds today; its fingerprint is computed from that row with the same function used for the new
   projection, so the two are comparable.
2. **Reconstruct** the projections from the account's executions through the existing round-trip
   engine (`buildRoundTrips`, the account's profit method, the journal's multipliers read through
   the transaction).
3. **Write the projection rows**: upsert the computed columns by the rebuild-stable key, delete
   the keys that no longer exist (batched below SQLite's bind-parameter limit). The upsert writes
   computed columns only, so annotations are never overwritten.
4. **Compare against the prior persisted row.** A projection whose fingerprint equals the prior
   row's fingerprint did not change: no revision, no event, counted as `unchanged`. This is the
   journal's own state that decides, not the identity chain: a journal that predates the evidence
   layer still knows what it holds, so its unchanged projections stay unchanged.
5. **Record the evidence** of every changed projection through the Phase 03 identity module
   (`resolveIdentity`, `recordProjectionRevision`) and **append one `trade.projection_changed`
   event** through `appendDomainEvent(tx, event)` — in the same transaction.
6. **Retire what disappeared.** A projection whose key is gone is reported as `removed`. When it
   has an identity, that identity is retired (`retireIdentity`) and the removal is announced; when
   it has none — a journal that predates the evidence layer — there is nothing to end and no
   revision to announce, but the disappearance is still counted.

`isEventCaptureEnabled()` reads one global switch, `JOURNAL_EVENT_CAPTURE` (`1`, `true` or `on`
enable it). When it is off, step 5 still writes the revision chain — that is factual evidence,
not notification — but **no event is appended**. This is what "production event capture stays
off" means: one switch, all paths, so the stream can never be half-written.

**Change classification** (contract review §4 "Classification and evidence"), driven by the
prior persisted row and the mode:

| Situation                                                                                                            | Kind                             |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| New projection (no prior row), already closed                                                                        | `discovered`                     |
| New projection (no prior row), still open, `mode: "live"`                                                            | `opened`                         |
| New projection (no prior row), still open, `mode: "historical"`/`"maintenance"`                                      | `discovered`                     |
| Prior row was open, the projection is now closed                                                                     | `closed`                         |
| Prior row existed and the projection changed in any other way (fee, method, multiplier, exit attribution, reopening) | `revised`                        |
| A prior projection disappeared                                                                                       | `removed`                        |
| A prior projection is byte-identical                                                                                 | no event, counted as `unchanged` |

`mode` travels in the event payload, so a historical upload can never read as a live closure.
A projection whose identity cannot be resolved without a guess is counted as `ambiguous`: its
projection row is still written (the financial fact is not in doubt), but no revision and no event
claim an identity that the evidence does not prove.

### `apps/web/src/server/trading/commands.ts` (new)

```ts
export type { ChangeContext } from "../domain-events";
export declare function recordManualTrades(
  accountId: string,
  rows: ImportedExecution[],
  manualNotes?: string,
): InsertResult;
export declare function importGenericExecutions(
  accountId: string,
  rows: ImportedExecution[],
  options?: { preserveFees?: boolean },
): InsertResult;
```

Both open one immediate transaction, build the context and call `insertExecutionsInTx`:

- manual → `origin: "user"`, `mode: "live"`
- generic import → `origin: "import"`, `mode: "historical"`

The context factory `changeContext(origin, mode)` lives in `trading/reconcile.ts` beside the
`ChangeContext` contract it builds, so the execution module and the command module both reach it
without importing each other. Its values are `operationId: newUuid()` and `recordedAt` — the
commit time, never a broker close time.

### `apps/web/src/server/executions.ts` (modified)

```ts
export declare function insertExecutionsInTx(
  tx: JournalTx,
  accountId: string,
  rows: ImportedExecution[],
  source: ExecutionSource,
  context: ChangeContext,
  manualNotes?: string,
  options?: { preserveFees?: boolean },
): InsertResult;
// unchanged public adapters
export declare function insertExecutions(
  accountId: string,
  rows: ImportedExecution[],
  source: ExecutionSource,
  manualNotes?: string,
  options?: { preserveFees?: boolean },
): InsertResult;
export declare function deleteExecutionsForTrades(accountId: string, executionIds: string[]): void;
```

`insertExecutionsInTx` keeps every existing rule: the manual batch is strict, sync/import skip
unusable rows and report up to five reasons, the import dedup check refuses a fill whose
timestamp only differs from a saved one, NinjaTrader fills are refused here, the notes rules
append a note at most once and preserve prior annotations. Its order inside the transaction is
fixed:

1. re-check that the account exists (inside the transaction);
2. insert the fills, counting inserted and duplicate rows;
3. **when at least one fill was inserted**, call `reconcileAccountInTx(tx, accountId, context)` —
   this is what writes the projection rows, the revisions and the events. Nothing changed when no
   fill was inserted, so there is nothing to reconcile;
4. apply the manual notes to the affected trades, reading the projection rows the reconciliation
   just wrote.

The public `insertExecutions` keeps its signature and its `InsertResult`. It opens one
**immediate** transaction (the `withJournalTransaction` seam) and derives the context from the
source, so no existing caller changes:

| `source` | origin         | mode          |
| -------- | -------------- | ------------- |
| `manual` | `user`         | `live`        |
| `import` | `import`       | `historical`  |
| `sync`   | `broker_sync`  | `live`        |

The public `deleteExecutionsForTrades` keeps its signature and returns `void`. It opens one
immediate transaction: it deletes the fills and then calls
`reconcileAccountInTx(tx, accountId, context)`, so the fill deletion and the rebuilt cycles are
atomic and the vanished projections are reported as `removed`.

### `apps/web/src/server/rebuild.ts` (modified)

```ts
export declare function rebuildAccount(accountId: string): void; // unchanged signature
```

`rebuildAccount` becomes the public adapter over the reconciliation boundary: it opens one
immediate transaction and calls `reconcileAccountInTx(tx, accountId, context)` with
`origin: "system"`, `mode: "maintenance"`. The account, its executions and the journal's
multipliers are read **inside** that transaction (contract review §4: "A direct `rebuildAccount`
wrapper opens the full transaction before reads"). The projection computation itself moves into
the reconciliation module, so there is exactly one implementation of it.

### `apps/web/src/server/settings.ts` (modified)

```ts
export declare function getSettingInTx(tx: JournalTx, key: string): string | null;
export declare function getJournalDefaultsInTx(tx: JournalTx): JournalDefaults;
export declare function getMultipliersInTx(tx: JournalTx): Record<string, number>;
```

Transaction-aware settings readers: the multipliers and the journal defaults that shape a
projection must be read through the transaction, not through the global connection. The existing
readers stay as they are for their other callers.

### `apps/web/src/server/position-import.ts` (modified)

```ts
export declare function positionImportErrors(
  tx: JournalTx,
  accountId: string,
  incoming: ImportedExecution[],
): string[];
```

The combined-history validation reads the saved executions through the transaction. The rules and
the messages are unchanged.

### `apps/web/src/app/api/executions/route.ts` and `apps/web/src/app/api/import/route.ts` (modified)

Both keep their response shapes. The manual route calls `recordManualTrades`; the generic commit
branch of the import route calls `importGenericExecutions`. The NinjaTrader branch, the XTB
holdings reconciliation, the IBKR Flex XML branch and the AI branches are **not** touched — they
belong to Phase 06.

---

## Domain event shape

One event per changed projection, appended through `appendDomainEvent(tx, event)` in the same
transaction as the change:

```ts
{
  id: newUuid(),
  type: "trade.projection_changed",
  schemaVersion: 1,
  aggregate: { type: "trade", id: tradeId, revision: revisionNumber },
  correlationId: context.operationId,
  origin: context.origin,
  recordedAt: context.recordedAt,
  occurredAt: closedAt,                       // only for an observed closure
  payload: {
    accountId,
    tradeKey,
    kind,                                     // discovered | opened | closed | revised | removed
    mode: context.mode,
    projectionRevisionId,                     // the immutable revision row
  },
}
```

The outbox unique key `(aggregate_type, aggregate_id, aggregate_revision, type)` makes the append
idempotent: one aggregate revision never produces two events. The revision number of an event is
the revision the change recorded, so it always names an existing revision row.

A removal is the one case with no new projection row. The identity's last revision row
(revision *N*) is the projection that disappeared, so:

- `aggregate.revision` is **N + 1** — the next number in the identity's chain. It must not
  reuse *N*: revision *N* already has its own event, and the outbox unique key would swallow the
  removal. *N + 1* has no revision row, and that is deliberate — a removal records no projection,
  it retires one.
- `payload.projectionRevisionId` is the **id of revision N**, the projection being removed. A
  consumer reads that row to learn which projection disappeared, and it is immutable.

---

## File ownership (exclusive)

| Path                                                     | Action                                                |
| -------------------------------------------------------- | ----------------------------------------------------- |
| `apps/web/src/server/trading/reconcile.ts`               | create — reconciliation boundary                      |
| `apps/web/src/server/trading/commands.ts`                | create — command layer for the routes                 |
| `apps/web/src/server/executions.ts`                      | modify — `insertExecutionsInTx`, unchanged public API |
| `apps/web/src/server/rebuild.ts`                         | modify — public adapter over the boundary             |
| `apps/web/src/server/settings.ts`                        | modify — transaction-aware readers                    |
| `apps/web/src/server/position-import.ts`                 | modify — transaction-aware validation                 |
| `apps/web/src/app/api/executions/route.ts`               | modify — manual command                               |
| `apps/web/src/app/api/import/route.ts`                   | modify — generic import command                       |
| `apps/web/tests/trade-reconciliation.test.ts`            | create — reconciliation invariants                    |
| `apps/web/tests/trade-mutation-events.test.ts`           | create — event semantics and rollback                 |
| `docs/superpowers/plans/ai-native-journal/phase-05.md`   | this file                                             |
| `docs/superpowers/reports/ai-native-journal-phase-05.md` | phase report                                          |

Read-only for this phase: `packages/**`, `apps/web/src/db/**`, `apps/web/src/server/{sync,demo,
ninjatrader-import,xtb-import,ibkr-flex-xml-import,ai-import,domain-events,domain-event-store}.ts`,
`apps/web/src/server/ctrader-mcp/**`, `apps/web/src/app/api/accounts/**`,
`apps/web/src/app/api/trades/**`, `apps/web/src/app/api/settings/route.ts`, `AGENTS.md`,
`docs/decisions/**`.

The broker importers, the account and trade routes and the settings route belong to Phase 06 and
Phase 07. This phase does not edit them. If a shared change appears to force one, it is described
in the phase report instead of being made here.

---

## Execution order

```
commit plan → write the failing test files → RED RUN (one command) → implement → GREEN RUN → gates → review → report
```

0. **Commit this plan first**:
   `git add docs/superpowers/plans/ai-native-journal/phase-05.md && git commit -m "docs: add Phase 05 reconciliation plan"`.
1. Write the two failing test files. No production file is touched yet.
2. Run the single red command and record its output as the phase's red evidence.
3. Implement `reconcile.ts`, `commands.ts`, and the changes to `executions.ts`, `rebuild.ts`,
   `settings.ts`, `position-import.ts` and the two routes.
4. Re-run the targeted command and the typecheck.

---

## Step 1 — The failing test files

### `apps/web/tests/trade-reconciliation.test.ts`

1. A manual entry writes the fills, the trade projection, the identity, the revision and one
   domain event, all in one transaction.
2. The same manual entry a second time inserts nothing and writes **no** second event.
3. A rebuild that changes nothing leaves the projection rows untouched and writes no revision.
4. A note written by the user survives a rebuild (annotations are never overwritten).
5. A changed fee revises the projection (`revised`) instead of reopening or closing it.
6. A trade that was observed open and then closes is reported as `closed`.
7. A historical import of a closed trade is reported as `discovered`, not `closed`.
8. A projection that disappears is reported as `removed` and its identity is retired.
9. With production capture off, an insertion writes the projection rows and the revision but no
   event.
10. A failure inside the transaction rolls back the fills, the projections, the revisions, the
    events **and the notes** together.

### `apps/web/tests/trade-mutation-events.test.ts`

1. The event envelope carries the account, the trade key, the kind, the mode and the projection
   revision id, and no raw broker payload.
2. One changed projection produces exactly one event; the same projection changed twice produces
   one event per revision.
3. An identical retry produces no event at all.
4. A historical import produces `mode: "historical"` events, so a historical close can never be
   read as a live closure.
5. A failure after the fill insert (an aborting SQLite trigger) leaves no fill, no projection, no
   revision, no event **and no note**.
6. A failure after the event append leaves no event.
7. The outbox row is pending (not dispatched) — the worker is not part of this phase.

---

## Red run (binding — the ONLY pre-implementation red run)

- [ ] Run:
      `pnpm exec vitest run apps/web/tests/trade-reconciliation.test.ts apps/web/tests/trade-mutation-events.test.ts`
      Expected: FAIL — the modules do not exist yet. Record the exact output.

---

## Verification (record exact output in the phase report)

```bash
pnpm exec vitest run apps/web/tests/trade-reconciliation.test.ts apps/web/tests/trade-mutation-events.test.ts apps/web/tests/execution-storage.test.ts apps/web/tests/history-import.test.ts
pnpm exec vitest run apps/web/tests/trade-projection-identity.test.ts apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-worker.test.ts
pnpm exec vitest run apps/web/tests/sync-resilience.test.ts apps/web/tests/ctrader-mcp/sync.test.ts apps/web/tests/import-account.test.ts apps/web/tests/ibkr-flex-xml-import.test.ts apps/web/tests/ninjatrader-import.test.ts apps/web/tests/xtb-import.test.ts
pnpm --filter web typecheck
pnpm exec prettier --check <every file this phase touched>
node scripts/check-licenses.mjs
pnpm --filter web migrations:check
pnpm test
```

The **root** `pnpm typecheck` is not this phase's gate and is not run here. Per the coordinator's
instruction it is replaced by `pnpm --filter web typecheck` plus the package filters. Its
remaining failures are pre-existing repository defects in the desktop workspace, diagnosed and
recorded by the coordinator in
`docs/superpowers/reports/ai-native-journal-worktrees.json` (`desktop/scripts/run-sidecar-setup.js`
uses CommonJS `require()` in an ESM package; `desktop/src-tauri/scripts/gen_icons/src/main.rs`
emits an invalid ICO). They are outside this phase's ownership, block the CI typecheck step and
the G-FINAL whole-project gate, and are the coordinator's to schedule. The RC2175 icon error that
earlier phases recorded was a stale shared cargo artifact and is already resolved; it is not the
current cause.

---

## Stop condition

Phase 05 is done when **all** of the following hold.

**Implementation and tests**

- [ ] The red run was executed before any production edit and its failure output is recorded.
- [ ] `apps/web/tests/trade-reconciliation.test.ts` passes.
- [ ] `apps/web/tests/trade-mutation-events.test.ts` passes.
- [ ] `apps/web/tests/execution-storage.test.ts` and `apps/web/tests/history-import.test.ts` pass.
- [ ] The Phase 03 and Phase 04 suites still pass.
- [ ] `pnpm --filter web typecheck` passes.
- [ ] `pnpm exec prettier --check` reports no violation in the files this phase touched.
- [ ] `node scripts/check-licenses.mjs` reports OK (no new dependency).
- [ ] `pnpm --filter web migrations:check` exits 0 (no migration changed).
- [ ] `pnpm test` passes.

**Review**

- [ ] A fresh spec-compliance and code-quality review of this phase's diff has run, and every
      Critical or Important finding is fixed.
- [ ] The repo's reviewer gate is satisfied: `.omp/reviewer-report.md` records this phase's
      verdict as `## Verdict: PASS`.

**Report**

- [ ] `docs/superpowers/reports/ai-native-journal-phase-05.md` is written and committed, with the
      six items the phase guide requires.
- [ ] The report states the base SHA and the tip SHA of this phase's commits.
- [ ] The report records the gates that remain with the coordinator: the merged-feature merge,
      the destination verification and
      `docs/superpowers/reports/ai-native-journal-integration-05.md`.

**Then stop.** Phase 06 (broker and specialized import paths) is a separate assignment. Do not
merge to `codex/ai-native-journal`, push, or open a PR — the coordinator owns the integration
lock.

---

## Accepted deviations from the letter of the source documents

1. **`ChangeContext` is reused from `server/domain-events.ts`.** The contract review sketches it
   next to `JournalTx` in `db/transaction.ts`, but Phase 04 already shipped the identical
   `Readonly<{operationId, origin, mode, recordedAt}>` contract in the domain-event module, which
   is where the contract review §2 puts event types. A second definition of the same contract
   would be a second source of truth, so the existing one is imported and re-exported.
2. **`insertExecutionsInTx` lives in `server/executions.ts`, not in `server/trading/commands.ts`.**
   It needs the execution row validation and the row insert, which are the execution module's
   own code; moving them would either create an import cycle or split one command across two
   files. `commands.ts` owns the command layer the API routes call and re-exports the contract.
3. **`rebuildAccount` is an adapter, not a second writer.** The contract review asks for the
   direct `rebuildAccount` wrapper to open the full transaction before its reads
   (contract review §4). Routing it through `reconcileAccountInTx` satisfies that and keeps one
   comparison and one writer, so the Phase 06 and Phase 07 paths that already call it inherit the
   transaction-aware behaviour. This phase does not wire the account or trade routes.
4. **Production event capture is off by default and switched by one environment variable.**
   The phase guide requires capture to stay off through Phase 09 and forbids enabling it for a
   subset of mutation paths. One global switch is the only shape that satisfies both: the tests
   turn it on explicitly, and Phase 09 turns it on for real once the baseline exists. The
   variable's operator documentation is a coordinator-owned follow-up: `AGENTS.md`'s environment
   list is read-only for this phase, so the variable is recorded in this plan and in the phase
   report's next-phase handoff.
5. **A removal event names the revision it removes.** The outbox unique key forbids a second
   event for the same aggregate revision, so a removal advances the aggregate revision to _N + 1_
   while its payload points at revision _N_, the projection that disappeared. A removal records no
   projection, so there is no revision row _N + 1_ to point at.
