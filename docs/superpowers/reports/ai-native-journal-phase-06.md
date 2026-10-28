# Phase 06 — All broker and specialized import paths

> Phase report for the AI-native journal modernization. Source of truth: the phase guide
> (`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), the phase plan
> (`docs/superpowers/plans/ai-native-journal/phase-06.md`), the contract review
> (`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md` §2–§6),
> the task packet (`docs/orchestration/ai-native-journal/tasks/T-006.md`), ADR 0001, ADR 0002 and
> ADR 0006.

## 1. Phase ID, baseline, scope

| Item                     | Value                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Phase                    | 06 — All broker and specialized import paths                                                                 |
| Milestone                | M2                                                                                                           |
| Stable task / native IDs | T-006 / `task_756e02a00efc`                                                                                  |
| Dispatch ID              | `ctx_f72d0a118d1b`                                                                                           |
| Branch                   | `codex/ai-native-journal-p06` (child of the feature worktree)                                                |
| Base SHA                 | `5d1bf55` (feature HEAD after the T-005 integration)                                                         |
| Plan commit              | `be43b52` — `docs: add Phase 06 broker-path plan`                                                            |
| Implementation tip       | `5bc48a7` — `feat: broker syncs and specialized imports commit their fills, projections and events together` |
| Report tip               | the report commit of this phase                                                                              |
| Integration destination  | `codex/ai-native-journal` (merged by the coordinator, not by this worker)                                    |

**Scope completed.** Every broker sync and every specialized import path now writes through the
committed ingestion/reconciliation ports Phase 05 shipped. A broker change or a statement import
leaves its fills, its rebuilt projections, its immutable projection revisions, its durable domain
events **and** its own bookkeeping — the broker snapshot, the import batch, the source aliases,
the approved fee corrections, the demo account row — in **one** immediate transaction. Fetch and
parse stay outside the transaction. The source-specific decision (which XTB holding is matched,
which statement timezone the IBKR upload may use) is now taken inside the transaction that
writes, so the check and the write share one lock. A repeated identical sync is silent, and a
failed write leaves nothing behind.

**Scope remaining.** None for this phase. The account clear/delete/transfer actions, the single
and bulk trade delete routes and the settings-driven rebuilds are **Phase 07** work per the phase
guide, and this phase did not edit them. The financial engine, the trade-key format, the
execution hash, the book methodology and the AI adapters are untouched.

**Schema allocation used.** None, as the phase guide requires. No table, no migration, no
`migration-checksums.json` change, no `db/schema.ts` change, no `db/bootstrap.ts` change. Every
table this phase reads or writes (`executions`, `trades`, `trade_identities`,
`trade_projection_revisions`, `domain_outbox`, `import_sources`, `import_source_aliases`,
`import_batches`, `accounts`) already existed before this phase.

## 2. Changed files and exported interfaces

| File                                                   | Change                                                                                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/sync.ts`                          | SDK broker sync writes through one `withJournalTransaction`: fills via `insertExecutionsInTx(tx, …, changeContext("broker_sync", "live"))`, the IBKR guard and the account snapshot read and written through `tx`.  |
| `apps/web/src/server/ctrader-mcp/sync.ts`              | The same seam for the cTrader MCP sync; every MCP call stays outside the transaction.                                                                                                                               |
| `apps/web/src/server/xtb-import.ts`                    | `reconcileXtbHoldingsInTx(tx, accountId, incoming)` and `commitXtbImport(accountId, incoming, options)` are new; `reconcileXtbHoldings(accountId, incoming)` keeps its signature as the read-only preview adapter.  |
| `apps/web/src/server/ibkr-flex-xml-import.ts`          | `flexUploadSyncProblemInTx(tx, accountId, zone)` and `commitIbkrFlexImport(accountId, rows, zone, options)` are new; `flexUploadSyncProblem(accountId, zone)` keeps its signature as the read-only preview adapter. |
| `apps/web/src/server/ninjatrader-import.ts`            | The plan reads through the transaction handle; the reviewed import calls `reconcileAccountInTx(tx, accountId, changeContext("import", "historical"))` instead of `rebuildAccount`.                                  |
| `apps/web/src/server/demo.ts`                          | The demo account row and the demo fills are written in one transaction, in historical mode.                                                                                                                         |
| `apps/web/src/app/api/import/route.ts`                 | The commit branch dispatches to the XTB and IBKR commands; the preview branch is unchanged.                                                                                                                         |
| `apps/web/tests/sync-resilience.test.ts`               | New: broker sync atomicity, snapshot rollback, silent repeat, no revision for an unchanged projection.                                                                                                              |
| `apps/web/tests/ctrader-mcp/sync.test.ts`              | The module mock also exports `insertExecutionsInTx`; new: snapshot/event rollback and a silent repeat.                                                                                                              |
| `apps/web/tests/xtb-import.test.ts`                    | New: the close commits with its events or not at all; the command itself refuses a changed holding.                                                                                                                 |
| `apps/web/tests/ibkr-flex-xml-import.test.ts`          | New: the upload commits with its projections and events or not at all.                                                                                                                                              |
| `apps/web/tests/ninjatrader-import.test.ts`            | New: the batch, the sources, the aliases, the corrections and the events commit together; historical origin; an approved fee correction revises the projection.                                                     |
| `apps/web/tests/demo-import.test.ts`                   | New file: the demo loads once, records a historical import, leaves no empty account on failure.                                                                                                                     |
| `docs/superpowers/plans/ai-native-journal/phase-06.md` | The phase plan, committed before implementation and reformatted by the repository formatter in the implementation commit.                                                                                           |

**Compatibility preserved.** The public `insertExecutions`, `rebuildAccount`,
`deleteExecutionsForTrades`, `syncAccount`, `syncCTraderMcpAccount`, `loadDemoData`,
`previewNinjaTraderImport`, `commitNinjaTraderImport`, `reconcileXtbHoldings` and
`flexUploadSyncProblem` keep their signatures and their results. The import response keys are
exactly what they were (`detected`, `inserted`, `duplicates`, `skipped`, `skippedReasons`,
`warnings`); the XTB matched-holding count is reported as `duplicates` and is not a new key.
Every user-facing message, count, warning and refusal is unchanged — the XTB "Nothing was
saved." refusal, the IBKR timezone refusals, the NinjaTrader conflict list and the preview
warnings all read exactly as before. Execution hashes, derived trade keys, annotations, the fee
policy, the encrypted credentials, the cTrader sync behaviour and the AI provider categories are
untouched.

## 3. Migrations, upgrade results, backup and rollback impact

**None.** This phase's schema allocation is none: no migration file, no registry entry, no
checksum change, no typed-schema change, no bootstrap-snapshot change. `pnpm --filter web
migrations:check` exits 0 and reports `migration-checksums.json is up to date.`, which proves
the applied migration history is byte-identical to the base commit's. The ledger, the forward-only
migrations `0001`–`0003` and the applied-migration checksums were not touched.

**Upgrade impact:** none. A journal on this branch and a journal on the base commit hold the same
schema and the same data.

**Backup and rollback impact:** none. The phase writes only rows that already existed, inside
transactions that either commit completely or roll back completely. Reverting the phase's
commits leaves the data as it was; no destructive statement, no table rewrite and no ledger
change is involved.

## 4. Commands actually run

All commands ran in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal-p06` on
branch `codex/ai-native-journal-p06` at implementation tip `5bc48a7`, Node v24.20.0, pnpm
11.0.8, with the disposable absolute `JOURNAL_DATA_DIR` `<checkout>/.journal-data` and scratch
databases under the OS temp dir.

| Command                                                                                                                                                                                                                                                                                                                        | Result                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `pnpm exec vitest run apps/web/tests/sync-resilience.test.ts apps/web/tests/ninjatrader-import.test.ts apps/web/tests/xtb-import.test.ts apps/web/tests/ibkr-flex-xml-import.test.ts`                                                                                                                                          | exit 0 — 4 files, **46 tests passed** (8 + 13 + 7 + 18)      |
| `pnpm exec vitest run apps/web/tests/ctrader-mcp/deals.test.ts apps/web/tests/ctrader-mcp/sync.test.ts apps/web/tests/trade-reconciliation.test.ts apps/web/tests/trade-mutation-events.test.ts apps/web/tests/demo-import.test.ts`                                                                                            | exit 0 — 5 files, **52 tests passed** (13 + 12 + 16 + 8 + 3) |
| `pnpm exec vitest run apps/web/tests/import-account.test.ts apps/web/tests/history-import.test.ts apps/web/tests/import-formats-regression.test.ts apps/web/tests/ninjatrader-reconciliation.test.ts apps/web/tests/execution-storage.test.ts apps/web/tests/ibkr-sync-timezone.test.ts apps/web/tests/broker-connect.test.ts` | exit 0 — 7 files, **122 tests passed**                       |
| `pnpm --filter web typecheck`                                                                                                                                                                                                                                                                                                  | exit 0 — no diagnostics                                      |
| `pnpm exec prettier --check <the 13 files this phase touched>`                                                                                                                                                                                                                                                                 | exit 0 — `All matched files use Prettier code style!`        |
| `node scripts/check-licenses.mjs`                                                                                                                                                                                                                                                                                              | exit 0 — `Dependency licenses OK.`                           |
| `pnpm --filter web migrations:check`                                                                                                                                                                                                                                                                                           | exit 0 — `migration-checksums.json is up to date.`           |
| `pnpm test`                                                                                                                                                                                                                                                                                                                    | exit 0 — **94 files, 968 tests passed**                      |

**Environment-limited check.** The root `pnpm typecheck` is not this phase's gate and was not
run as one: it fails in the `desktop` workspace on the pre-existing RC2175 icon-generation
defect, which predates this phase and is outside its ownership. `pnpm --filter web typecheck`
and the package filters are the applicable gate, and they pass. No other check was skipped, and
no unavailable deployment test was simulated.

**The red run.** This phase had no single red run: its evidence is the _failure injection_ in
the new tests, not a missing module. Each new atomicity case installs a failing SQLite trigger
(`RAISE(FAIL)`) on the table that must not be half-written — `domain_outbox` for the event, the
`executions` for the demo — and asserts that the whole operation rolls back. Those cases fail
against the pre-phase behaviour and pass against this phase's behaviour.

## 5. Review findings, resolutions, deviations and risks

### 5.1 Review rounds

Two reviewer rounds ran against the implementation diff, the maximum the phase budget allows.

**Round 1 — FAIL.** Two findings, both real and both about the contract:

1. `apps/web/src/app/api/import/route.ts` — the commit path could still decide from a stale
   pre-transaction check. The route computed the XTB holdings reconciliation and the IBKR
   timezone check outside any transaction on both the preview and the commit path.
2. `apps/web/src/app/api/import/route.ts` — the XTB commit response exposed a new `matched` key,
   which changed the import response contract.

**Round 2 — PASS.** Both findings were fixed and verified:

1. The XTB and IBKR source-specific checks are now computed **only** when
   `body.mode === "preview"`; the commit path dispatches to `commitXtbImport` and
   `commitIbkrFlexImport`, which revalidate inside the transaction that writes.
2. The route destructures the count out of the result
   (`const { matched = 0, ...outcome } = imported;`) and reports it only as `duplicates`, so the
   response keys are unchanged.

The repository's reviewer gate is satisfied: `.omp/reviewer-report.md` records
`## Verdict: PASS` for this phase's diff.

### 5.2 Deviations from the letter of the source documents

1. **The NinjaTrader and demo paths change their event provenance** from
   `origin: "system"` / `mode: "maintenance"` to `origin: "import"` / `mode: "historical"`. They
   previously reached the reconciliation boundary through `rebuildAccount`, the generic
   maintenance rebuild. Routing them through the ingestion port is what this phase asks for, and a
   statement import is an `import`, not a maintenance rebuild. The **classification** Phase 05
   shipped is unchanged — a first sight is `discovered` in both modes — so no trade is
   reclassified by this change.
2. **The XTB and IBKR upload checks moved from the route into the transaction.** The route used to
   compute both source-specific problems before the write, and the write then happened in a
   different transaction, so the decision and the write were never taken under one lock. The
   preview still computes both read-only, so the preview output and every message are unchanged.
3. **The single and bulk trade delete are not touched.** The phase guide assigns them to Phase
   07, and Phase 05 already made `deleteExecutionsForTrades` atomic. This phase did not widen
   the scope to the delete routes.
4. **No ADR change.** ADR 0001 and ADR 0002 govern broker connectivity, and this phase adds no
   connectivity, no HTTP call, no credential handling and no dependency.
5. **The broker snapshot is written before the fill insert** in the two sync paths. Both writes
   are in the same transaction, so the committed result is identical; the order is recorded so a
   reader is not surprised by it.
6. **The implementation was split across two writers**, as the phase plan recorded before any
   implementation: a first child took the SDK and cTrader sync paths and landed them; a second
   child took the XTB, IBKR, NinjaTrader, demo and route work and ran out of its budget after
   one internal refactor, leaving `xtb-import.ts` mid-edit. The orchestrator completed that
   child's scope. The file sets were disjoint, so nothing was lost or duplicated.

### 5.3 Unresolved risks

None that block the next phase or the release.

- The **root `pnpm typecheck`** still fails in the `desktop` workspace (RC2175). It predates this
  phase, is outside this phase's ownership and blocks the CI typecheck step and the G-FINAL
  whole-project gate. It is the coordinator's to schedule.
- **Production event capture remains off by default.** The phase guide keeps it off through Phase 09. The event behaviour is proved by the tests, which enable the one global switch explicitly.
- The **decision-under-the-lock** property is proved by construction (the check is inside the
  write transaction) and by a failure-injection test that shows the rollback, not by a
  concurrency test with two writers racing. A true interleaving test would need a second
  connection and a deterministic hook; the phase does not add one.

## 6. Next-phase handoff

Phase 07 — _Remaining mutation commands and settings-driven rebuilds_ — owns the mutation-matrix
rows this phase deliberately left alone. It starts from this branch's state and needs:

1. **The committed ports this phase routes through**, unchanged:
   `reconcileAccountInTx(tx, accountId, context)` and `changeContext(origin, mode)` in
   `apps/web/src/server/trading/reconcile.ts`; `insertExecutionsInTx(tx, …)` in
   `apps/web/src/server/executions.ts`; the transaction seam
   `withJournalTransaction((tx) => …)` in `apps/web/src/db/transaction.ts`.
2. **The Phase 07 scope**, unchanged from the phase guide: the single and bulk trade delete
   routes, the account clear / delete / transfer actions, and the method- and multiplier-driven
   rebuilds in the settings route. `deleteExecutionsForTrades` is already atomic (Phase 05); what
   remains is one command transaction across accounts and account batching below SQLite's bind
   limit.
3. **The account-existence recheck after a broker fetch** — the SDK sync already re-reads the
   account inside its transaction, so a transfer that happens during a fetch is refused rather
   than written into the wrong account.
4. **The phase guide's migration allocation for Phase 07: none.**
5. **The gates this phase ran** — the same targeted suites plus `pnpm --filter web typecheck`,
   `pnpm exec prettier --check`, `node scripts/check-licenses.mjs`,
   `pnpm --filter web migrations:check` and the full `pnpm test`.
6. **The coordinator's remaining work for this phase**: the verified local merge into
   `codex/ai-native-journal`, the destination verification and
   `docs/superpowers/reports/ai-native-journal-integration-06.md`. This worker did not merge,
   push or open a PR.
