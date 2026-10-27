# Phase 05 — Transaction-aware reconciliation for manual and generic ingestion

> Phase report for the AI-native journal modernization. Source of truth: the phase guide
> (`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), the phase plan
> (`docs/superpowers/plans/ai-native-journal/phase-05.md`), the contract review
> (`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md` §2–§6),
> the task packet (`docs/orchestration/ai-native-journal/tasks/T-005.md`) and ADR 0006.

## 1. Phase ID, baseline, scope

| Item                     | Value                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| Phase                    | 05 — Transaction-aware reconciliation for manual and generic ingestion    |
| Milestone                | M2                                                                        |
| Stable task / native IDs | T-005 / `task_a871bc6be4cd`                                               |
| Branch                   | `codex/ai-native-journal-p05` (child of the feature worktree)             |
| Base SHA                 | `926f9d5` (feature HEAD after the T-004 integration)                      |
| Plan commit              | `2438139` — `docs: add Phase 05 reconciliation plan`                      |
| Implementation tip       | `5737691` — `feat: reconcile trading mutations with atomic domain events` |
| Report tip               | the report commit of this phase                                           |
| Integration destination  | `codex/ai-native-journal` (merged by the coordinator, not by this worker) |

**Scope completed.** A manual or generic-import change now leaves its fills, its reconstructed
trade projections, its immutable projection evidence and its durable domain event in **one**
immediate transaction. The reconciliation compares the journal's own prior persisted projection
with the reconstructed one, so a projection that did not change writes no revision and raises no
event, and an identical retry is completely silent. The trade reconstruction moved into a single
boundary (`server/trading/reconcile.ts`) that both the ingestion commands and the rebuild adapter
call, so there is exactly one writer of projection rows, revisions and events.

**Scope remaining.** None for this phase. The broker-specific importers (XTB, IBKR Flex XML, SDK
and cTrader MCP sync, NinjaTrader), the demo loader, the account clear/delete/transfer actions,
the single and bulk trade delete routes and the settings-driven rebuilds are **Phase 06 and
Phase 07** work per the phase guide, and this phase did not edit them.

**Schema allocation used.** None, as the phase guide requires. No table, no migration, no
`migration-checksums.json` change, no `db/schema.ts` change, no `db/bootstrap.ts` change. Every
table this phase reads or writes (`trade_identities`, `trade_projection_revisions`,
`trade_revision_executions`, `trade_identity_links`, `domain_outbox`) already existed from
Phase 03 and Phase 04.

## 2. Changed files and exported interfaces

| File                                                   | Change                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/trading/reconcile.ts`             | **new** — the reconciliation boundary: prior-state read, reconstruction, comparison, projection rows, revisions, events, retirement |
| `apps/web/src/server/trading/commands.ts`              | **new** — the command layer the API routes call: `recordManualTrades`, `importGenericExecutions`                                    |
| `apps/web/src/server/executions.ts`                    | modified — `insertExecutionsInTx`; the public adapters keep their signature and results and now open one immediate transaction      |
| `apps/web/src/server/rebuild.ts`                       | modified — `rebuildAccount` is now the public adapter over the reconciliation boundary                                              |
| `apps/web/src/server/settings.ts`                      | modified — transaction-aware readers: `getSettingInTx`, `getJournalDefaultsInTx`, `getMultipliersInTx`                              |
| `apps/web/src/server/position-import.ts`               | modified — the combined-history validation reads the saved executions through the transaction                                       |
| `apps/web/src/app/api/executions/route.ts`             | modified — the manual route calls `recordManualTrades`; the response shape is unchanged                                             |
| `apps/web/src/app/api/import/route.ts`                 | modified — the generic commit branch calls `importGenericExecutions`; the response shape is unchanged                               |
| `apps/web/tests/trade-reconciliation.test.ts`          | **new** — 16 reconciliation and rollback invariants                                                                                 |
| `apps/web/tests/trade-mutation-events.test.ts`         | **new** — 8 event-semantics and rollback invariants                                                                                 |
| `docs/superpowers/plans/ai-native-journal/phase-05.md` | the phase plan, committed before the implementation                                                                                 |

**Exported interfaces** (the phase's required contracts):

```ts
// apps/web/src/server/trading/reconcile.ts
export type { ChangeContext } from "../domain-events"; // operationId, origin, mode, recordedAt
export declare function changeContext(
  origin: ChangeContext["origin"],
  mode: ChangeContext["mode"],
): ChangeContext;
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

// apps/web/src/server/trading/commands.ts
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

// apps/web/src/server/executions.ts
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

// apps/web/src/server/settings.ts
export declare function getSettingInTx(tx: JournalTx, key: string): string | null;
export declare function getJournalDefaultsInTx(tx: JournalTx): JournalDefaults;
export declare function getMultipliersInTx(tx: JournalTx): Record<string, number>;

// apps/web/src/server/position-import.ts
export declare function positionImportErrors(
  tx: JournalTx,
  accountId: string,
  incoming: ImportedExecution[],
): string[];
```

**The one writer.** `reconcileAccountInTx` is the only place that writes projection rows,
projection revisions and domain events. `insertExecutionsInTx` calls it; `rebuildAccount` calls it
through the same boundary; the two API routes reach it through the command layer. Nothing writes
a projection row anywhere else.

**What the comparison is against.** The journal's own prior persisted projection — the `trades`
row read before it is overwritten — not the identity chain. The prior row's fingerprint is
computed with the same function used for the reconstructed projection, so the two are directly
comparable. This matters for a journal that predates the evidence layer: it still knows what it
holds, so its unchanged projections stay unchanged instead of every historical trade being
reported as discovered on the first reconciliation.

**Event semantics** (contract review §4), as implemented and asserted:

| Situation                                                        | Kind                             |
| ---------------------------------------------------------------- | -------------------------------- |
| New projection, already closed                                   | `discovered`                     |
| New projection, still open, `mode: "live"`                       | `opened`                         |
| New projection, still open, `mode: "historical"`/`"maintenance"` | `discovered`                     |
| Prior row was open, the projection is now closed                 | `closed`                         |
| Prior row existed and the projection changed in any other way    | `revised`                        |
| A prior projection disappeared                                   | `removed`                        |
| A prior projection is byte-identical                             | no event, counted as `unchanged` |

`mode` travels in the event payload, so a historical import can never read as a live closure.
A removal event names the revision it removes: its `aggregate.revision` is _N + 1_ (the outbox
unique key allows one event per aggregate revision, and revision _N_ already has its own event),
and its `payload.projectionRevisionId` is the id of revision _N_, the projection that
disappeared.

**Compatibility preserved.** `insertExecutions`, `rebuildAccount`, `deleteExecutionsForTrades`,
`SyncOutcome` and `InsertResult` keep their signatures and their results. The API routes keep
their response shapes. Execution hashes, derived trade keys, the annotation columns, the
encrypted credentials, cTrader sync and all three AI provider categories are untouched. The
manual batch is still strict, sync and import still skip unusable rows and report up to five
reasons, the import dedup check still refuses a fill whose timestamp only differs from a saved
one, NinjaTrader fills are still refused here, and the note rules still append a note at most
once and preserve prior annotations.

## 3. Migration version, table, column, index changes

**None.** No migration file was added, edited, renumbered or deleted; `0001`, `0002` and `0003`
are untouched. `migration-checksums.json` is unchanged and `pnpm --filter web migrations:check`
reports it up to date. No column, nullability, default, index, uniqueness or foreign-key change
was made, so there is no upgrade, backup or rollback impact to record.

## 4. Commands actually run, and their results

All commands ran in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal-p05` against
the phase's final tree, with `JOURNAL_DATA_DIR` pointing at a disposable scratch directory.

| #   | Command                                                                                                                                                                                                                             | Result                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec vitest run apps/web/tests/trade-reconciliation.test.ts apps/web/tests/trade-mutation-events.test.ts` (red run, before any production edit)                                                                               | **FAIL as expected** — the modules did not exist yet. Record: `Failed to load url ./src/server/trading/reconcile` and `Failed to load url ./src/server/trading/commands`. |
| 2   | `pnpm exec vitest run apps/web/tests/trade-reconciliation.test.ts apps/web/tests/trade-mutation-events.test.ts`                                                                                                                     | **PASS** — 2 files, 24 tests (16 + 8)                                                                                                                                     |
| 3   | `pnpm exec vitest run apps/web/tests/execution-storage.test.ts apps/web/tests/history-import.test.ts apps/web/tests/sync-resilience.test.ts apps/web/tests/import-account.test.ts apps/web/tests/trade-projection-identity.test.ts` | **PASS** — 5 files, 44 tests                                                                                                                                              |
| 4   | `pnpm --filter web typecheck`                                                                                                                                                                                                       | **PASS** — exit 0 (`next typegen` + `tsc --noEmit`)                                                                                                                       |
| 5   | `pnpm exec prettier --check <every file this phase touched>`                                                                                                                                                                        | **PASS** — no violation                                                                                                                                                   |
| 6   | `node scripts/check-licenses.mjs`                                                                                                                                                                                                   | **PASS** — "Dependency licenses OK." (no new dependency)                                                                                                                  |
| 7   | `pnpm --filter web migrations:check`                                                                                                                                                                                                | **PASS** — "migration-checksums.json is up to date."                                                                                                                      |
| 8   | `pnpm test`                                                                                                                                                                                                                         | **PASS** — 93 files, 953 tests, 0 failures                                                                                                                                |

The root `pnpm typecheck` was not run, per the coordinator's instruction. Its remaining failures
are pre-existing repository defects in the desktop workspace, diagnosed and recorded by the
coordinator in `docs/superpowers/reports/ai-native-journal-worktrees.json`
(`desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` in an ESM package;
`desktop/src-tauri/scripts/gen_icons/src/main.rs` emits an invalid ICO). They are outside this
phase's ownership, block the CI typecheck step and the G-FINAL whole-project gate, and are the
coordinator's to schedule. The RC2175 icon error earlier phases recorded was a stale shared cargo
artifact and is already resolved; it is not the current cause.

**The fixtures.** Both new test files run against a disposable journal created with `mkdtempSync`
under the OS temp directory, with `JOURNAL_DATA_DIR` pointed at it before the database module is
evaluated. Event capture is switched on explicitly in the tests
(`JOURNAL_EVENT_CAPTURE=1`) and one test switches it off to prove the production default.

## 5. Review findings and their resolutions

The phase ran the two authorized reviews: one on the plan, one on the implementation diff. Both
were delegated to the read-only reviewer agent, which writes `.omp/reviewer-report.md`.

**Review 1 — the plan.** The reviewer returned FAIL with one Critical, three Important and two
Minor findings. All were fixed in the plan before the implementation started:

| Finding                                                                                                                                                                                                                            | Resolution                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical** — the plan never wired `reconcileAccountInTx` into any caller, and the two possible readings diverged materially (a double write of the projection rows, or a public `insertExecutions` that stops populating trades) | The plan gained an explicit call graph and the "one writer" rules: `insertExecutionsInTx` calls `reconcileAccountInTx` and never `rebuildAccount`; `rebuildAccount` is an adapter over the same boundary; there is no second writer and no second `*InTx` variant.   |
| **Important** — `deleteExecutionsForTradesInTx` was declared but the public delete's reconciling behaviour was unstated, and reconciling would pull Phase 07's delete matrix row through Phase 07-owned routes                     | The variant was dropped. The public `deleteExecutionsForTrades` keeps its signature, opens one immediate transaction and reconciles inside it, so the fill deletion and the rebuilt cycles are atomic; the Phase 07 routes are unchanged and not edited.             |
| **Important** — the removal event's revision reference was undefined (`retireIdentity` writes no revision row, so `aggregate.revision = N+1` named no row)                                                                         | The plan now states it exactly: `aggregate.revision` is _N + 1_ so the outbox unique key cannot swallow the removal, and `payload.projectionRevisionId` is the id of revision _N_, the projection that disappeared. A removal records no projection, it retires one. |
| **Important** — the root `pnpm typecheck` blocker was misattributed to host tooling                                                                                                                                                | The plan now repeats the repository's own diagnosis: the RC2175 was a stale cargo artifact and is resolved; the remaining failures are two identified repository defects in the desktop workspace that block the CI typecheck step and the G-FINAL gate.             |
| **Minor** — the rollback assertion omitted the notes                                                                                                                                                                               | The plan's exit evidence and the test list now name the notes, and a dedicated test asserts them.                                                                                                                                                                    |
| **Minor** — `JOURNAL_EVENT_CAPTURE` had no documentation surface                                                                                                                                                                   | The plan records the switch and the phase report's next-phase handoff names it; `AGENTS.md` is read-only for this phase, so the operator-facing note is a coordinator-owned follow-up.                                                                               |

**Review 2 — the implementation diff.** The reviewer returned FAIL with one Critical, two
Important and two Minor findings. All were fixed:

| Finding                                                                                                                                                                                                                          | Resolution                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Critical** — change detection was keyed on the identity chain, not on the prior persisted projection row, so the first reconciliation of a journal that predates the evidence layer raised an event for every historical trade | The comparison now uses the prior persisted `trades` row: its fingerprint is computed with the same function used for the reconstructed projection, and an equal fingerprint means "unchanged" — no revision, no event, counted as `unchanged`. The identity chain is written for the projections that actually changed. |
| **Important** — the two public adapters opened DEFERRED transactions, which can fail the WAL deferred-to-write upgrade with `SQLITE_BUSY_SNAPSHOT` that `busy_timeout` cannot retry                                              | Both adapters now open one **immediate** transaction through the existing `withJournalTransaction` seam.                                                                                                                                                                                                                 |
| **Important** — the reconciliation ran unconditionally, re-writing every projection of the account on a zero-insert broker poll                                                                                                  | The reconciliation is called only when at least one fill was inserted, which is the rule the previous code used for its rebuild.                                                                                                                                                                                         |
| **Minor** — the notes-rollback assertion was vacuous: both injected failures happened before the note write, so a regression moving the note write out of the transaction would still pass                                       | A third failure-injection case fails on the note write itself (a trigger on `UPDATE OF notes`). The fills, the projections, the revisions and the events must all be gone afterwards, which is only true when the note write shares the transaction.                                                                     |
| **Minor** — `executions.ts` and `trading/commands.ts` imported each other                                                                                                                                                        | The `changeContext` factory moved next to the `ChangeContext` contract it builds, in `trading/reconcile.ts`. The command module and the execution module now both reach it through that module, and neither imports the other.                                                                                           |

**Review 3 — a focused verification of the five fixes.** The reviewer confirmed all five
findings were resolved, with the fingerprint equivalence of the prior row and the reconstructed
projection proved empirically, and raised one new Important finding: a projection that vanished
**without an identity** was deleted from `trades` but neither retired nor reported, so
`result.removed` stayed 0. The cause was the change-detection fix: identities are now written only
for the projections that actually changed, so a projection the journal never recorded evidence for
has no identity to retire. Fixed: the removal is counted for every vanished projection, and the
identity is retired and the event appended only when there is an identity to end. Two tests cover
the case: a journal that predates the evidence layer reports an unchanged projection as
`unchanged` with no event, and a vanished projection is reported as `removed`.

## 6. Deviations, risks and the next-phase handoff

**Deviations from the letter of the source documents** (each is recorded in the phase plan):

1. `ChangeContext` is reused from `server/domain-events.ts` rather than re-declared in
   `db/transaction.ts`, because Phase 04 already shipped the identical contract there. A second
   definition would be a second source of truth.
2. `insertExecutionsInTx` lives in `server/executions.ts`, beside the execution row validation and
   insert it needs; `trading/commands.ts` owns the command layer the routes call and re-exports
   the contract.
3. `rebuildAccount` is an adapter over the reconciliation boundary rather than a second writer,
   so the Phase 06 and Phase 07 paths that already call it inherit the transaction-aware
   behaviour without a change.
4. Production event capture is off by default and switched by one environment variable
   (`JOURNAL_EVENT_CAPTURE`). The phase guide requires capture to stay off through Phase 09 and
   forbids enabling it for a subset of mutation paths; one global switch is the only shape that
   satisfies both.
5. A removal event names the revision it removes, as described in §2.

**Risks and what they mean for the next phase.**

- _The identity chain is written for changed projections only._ A projection that never changes
  gets no identity and no revision from this phase. Phase 09's historical baseline is what
  establishes identities for pre-existing trades, and it must treat a projection that already
  carries a revision as already mapped rather than seeding it twice.
- _The evidence layer is not backfilled._ A journal that predates this phase has no identities
  until a projection of it actually changes. Phase 09's baseline reconcile is the intended
  backfill, and it should run with capture still off.
- _The account `clear` and `transfer` actions delete or move trade rows without retiring the
  identities this phase now creates._ Those actions belong to Phase 07, which must retire the
  identity of every projection it removes. This is recorded here so Phase 07 does not inherit a
  stale mapping.
- _The bulk-delete route deletes fills per account, one account per transaction._ Phase 07 owns
  the account batching below the SQLite bind limit and the single command transaction; this phase
  did not touch the route.

**Next-phase inputs (Phase 06 — broker and specialized import integration).**

- The reconciliation boundary is available and is the only writer: `reconcileAccountInTx(tx,
accountId, context)` and `insertExecutionsInTx(tx, accountId, rows, source, context,
manualNotes?, options?)`. A broker path that must record changes calls these inside its own
  transaction.
- The context factory is `changeContext(origin, mode)` in `server/trading/reconcile.ts`.
  A broker sync uses `origin: "broker_sync"`, `mode: "live"`; a broker import that reconstructs
  history uses `origin: "import"`, `mode: "historical"`.
- The public `insertExecutions(accountId, rows, source, ...)` already derives that context from
  the source, so a broker path that keeps calling it inherits the right classification.
- Event capture is off in production. Phase 06 must not enable it for a subset of paths: the
  switch is global, and the baseline that makes it safe to switch on is Phase 09's.
- The broker-specific matrix rows are untouched and remain open: the XTB open holding, the IBKR
  Flex XML and SDK sync, the NinjaTrader insert/correction/retry, and the SDK and cTrader MCP
  sync, each with its own revalidation inside the lock.
- The demo loader is untouched and stays a historical import through the same boundary.
