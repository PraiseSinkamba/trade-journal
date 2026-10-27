# Phase 06 — Transaction-aware broker and specialized import paths

> **For agentic workers:** implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> Implement only this phase. Do not begin Phase 07.

**Goal:** Every broker sync and every specialized import writes through the **committed
ingestion/reconciliation ports**. One change leaves its fills, its rebuilt projections, its
immutable projection revisions, its durable domain events **and** its own bookkeeping (broker
snapshot, import batch, source aliases, approved fee corrections) in **one** transaction. Fetch
and parse stay outside the transaction. A repeated identical sync is silent.

**Architecture:** Phase 05 shipped the reconciliation boundary
(`apps/web/src/server/trading/reconcile.ts`), the command layer
(`apps/web/src/server/trading/commands.ts`) and the transaction-taking ingest port
(`insertExecutionsInTx` in `apps/web/src/server/executions.ts`). Phase 06 does **not** add a
second writer and does **not** add a second reconciliation path. It changes the six broker and
specialized import paths so that each of them:

1. fetches and parses **outside** the transaction (unchanged — this is already true);
2. opens **one** immediate transaction through `withJournalTransaction`;
3. validates its **source-specific** rules reading through that transaction's `tx` handle;
4. writes its fills through `insertExecutionsInTx(tx, …)` (NinjaTrader keeps its own reviewed
   insert and calls `reconcileAccountInTx(tx, …)` directly — `insertExecutionsInTx` refuses
   NinjaTrader fills by design);
5. writes its own bookkeeping (broker snapshot, import batch, source aliases, fee corrections,
   demo account) in the **same** transaction.

**Tech Stack:** existing TypeScript (strict, `noUncheckedIndexedAccess`), Next.js 15, Drizzle +
better-sqlite3, Zod, Vitest, `node:crypto` UUIDs. **No new dependency. Schema allocation: none**
(no table, no migration, no checksum change, no `db/schema.ts` change, no `db/bootstrap.ts`
change).

**Authoritative references:** phase guide Phase 06
(`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), detailed plan Task 5
(`docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md`), design §6/§7, contract
review §2–§6, ADR 0006, ADR 0001, ADR 0002.

**Base SHA (merged reconciliation interfaces this phase builds on):**
`5d1bf55cfc3d704d595e1a92df053c1d0592e083` (Phase 05 integrated on `codex/ai-native-journal-p06`).

---

## Global constraints

- **Schema allocation: none.** No table, no migration, no `migration-checksums.json` change, no
  `db/schema.ts` change, no `db/bootstrap.ts` change.
- **Forward-only migrations are untouched.** `0001`, `0002`, `0003` are not edited, renumbered or
  deleted.
- **No new dependency** → no ADR change, no manifest change, no lockfile change. ADR 0001 and
  ADR 0002 stay as they are: this phase adds no connectivity, no HTTP call and no credential
  handling.
- **Production event capture stays off.** One global switch (`JOURNAL_EVENT_CAPTURE`), never a
  per-path switch. The tests turn it on explicitly.
- **No network call, promise or provider call inside a write transaction.** Fetch and parse stay
  outside; the transaction is synchronous by contract (`db/transaction.ts` enforces this).
- **Preserve** execution hashes, derived trade keys, annotations, cTrader sync, all three AI
  provider categories, encrypted credentials and every import/AI response contract. The public
  `insertExecutions`, `rebuildAccount`, `deleteExecutionsForTrades` and `SyncOutcome` keep their
  signatures and results.
- **Preserve source-specific validation, result counts and warnings** for every adapter. The
  wording of every user-facing message is preserved, including the XTB "Nothing was saved."
  refusal and the IBKR timezone refusals.
- **Node ≥ 22, pnpm 11.0.8, frozen lockfile.** `pnpm install` is already done; do not reinstall.
- Disposable absolute `JOURNAL_DATA_DIR` and scratch DB files under the OS temp dir. Never use
  ports 3000/3001. Never touch live trader data.

---

## The shared seam (every adapter task uses exactly this shape)

```ts
import { withJournalTransaction } from "@/db/transaction";
import { insertExecutionsInTx } from "../executions";
import { changeContext } from "../trading/reconcile";

const result = withJournalTransaction((tx) => {
  // 1. source-specific validation, reading through `tx`
  // 2. insertExecutionsInTx(tx, accountId, rows, source, context, undefined, options)
  // 3. the path's own bookkeeping (snapshot / batch / aliases / account row), through `tx`
  return inserted;
});
```

`insertExecutionsInTx` already calls `reconcileAccountInTx` when at least one fill was inserted,
so the projections, the projection revisions and the domain events are written by the one
reconciliation boundary, inside this transaction. A path must **not** call `rebuildAccount` and
must **not** call the public `insertExecutions` (which opens its own transaction) from inside a
transaction.

### Change contexts (fixed by this phase)

| Path                                                            | `origin`      | `mode`        |
| --------------------------------------------------------------- | ------------- | ------------- |
| SDK broker sync (`server/sync.ts`)                              | `broker_sync` | `live`        |
| cTrader MCP sync (`server/ctrader-mcp/sync.ts`)                | `broker_sync` | `live`        |
| XTB workbook upload (`server/xtb-import.ts`)                    | `import`      | `historical`  |
| IBKR Flex XML upload (`server/ibkr-flex-xml-import.ts`)         | `import`      | `historical`  |
| NinjaTrader reviewed import (`server/ninjatrader-import.ts`)    | `import`      | `historical`  |
| Demo load (`server/demo.ts`)                                    | `import`      | `historical`  |

The **classification** Phase 05 shipped is preserved unchanged: a first sight is `discovered`,
a first sight that is still open in `live` mode is `opened`, an observed open cycle that is now
closed is `closed`, every other change to a known projection is `revised`, and a projection that
disappeared is `removed`. Switching NinjaTrader and the demo loader from the generic rebuild
(`origin: "system"`, `mode: "maintenance"`) to `origin: "import"`, `mode: "historical"` changes
the event's **provenance**, not the classification: a first sight is `discovered` in both modes.

---

## Adapter tasks (one distinct task per adapter)

### T-06.1 — SDK broker sync

**Target:** `apps/web/src/server/sync.ts` (modify). **Tests:** `apps/web/tests/sync-resilience.test.ts`
(modify).

- [ ] Replace the outer `db.transaction(…)` + public `insertExecutions(…)` with
      `withJournalTransaction((tx) => { insertExecutionsInTx(tx, accountId, timed, "sync",
      changeContext("broker_sync", "live")); … })`.
- [ ] The IBKR guard inside the transaction must read the account through `tx`, not through the
      global `db`, and must keep both checks: the credentials did not change during the fetch and
      `assertIbkrSyncTimeZone` still holds.
- [ ] The account update (`lastSyncAt`, `snapshotJson`, and `ibkrSyncTimeZone` when fills were
      inserted) is written through `tx` in the same transaction, so the snapshot and the fills
      commit together.
- [ ] `fetchSnapshot()` stays outside the transaction. `onCredentialsRotated` stays outside it
      too (it is a network callback).
- [ ] The `SyncOutcome` shape, the untimed-fill skip reason and the counts are unchanged.

### T-06.2 — cTrader MCP sync

**Target:** `apps/web/src/server/ctrader-mcp/sync.ts` (modify). **Tests:**
`apps/web/tests/ctrader-mcp/sync.test.ts` (modify).

- [ ] Same seam as T-06.1: `withJournalTransaction` + `insertExecutionsInTx(tx, …,
      changeContext("broker_sync", "live"))` + the account snapshot through `tx`.
- [ ] Every MCP call stays outside the transaction. The order-history fetch stays non-fatal.
- [ ] The existing test mocks `@/server/executions`; the mock must also export
      `insertExecutionsInTx` (real implementation) so the module keeps working.
- [ ] The `SyncOutcome` shape and the counts are unchanged.

### T-06.3 — XTB workbook upload

**Target:** `apps/web/src/server/xtb-import.ts` (modify),
`apps/web/src/app/api/import/route.ts` (modify). **Tests:** `apps/web/tests/xtb-import.test.ts`
(modify).

- [ ] Split `reconcileXtbHoldings` into a transaction-taking form that reads the stored entries
      through `tx`, and keep the public `reconcileXtbHoldings(accountId, incoming)` as the
      read-only adapter the preview uses. The stored-entry query, the `sameLot` comparison, the
      refusal message and the `matched` count are unchanged.
- [ ] Add the commit command: it opens one transaction, revalidates the matched entry **under the
      lock**, and only then inserts. A holding that changed (a partial close) is refused inside
      that transaction, so nothing is saved — the wording "Nothing was saved." is preserved.
- [ ] The command returns the `matched` count so the route can keep reporting
      `N open holding(s) imported earlier are closed by this file.` and keep counting the matched
      entries as duplicates.

### T-06.4 — IBKR Flex XML upload

**Target:** `apps/web/src/server/ibkr-flex-xml-import.ts` (modify),
`apps/web/src/app/api/import/route.ts` (modify). **Tests:**
`apps/web/tests/ibkr-flex-xml-import.test.ts` (modify).

- [ ] Split `flexUploadSyncProblem` into a transaction-taking form that reads the account through
      `tx`, and keep the public `flexUploadSyncProblem(accountId, zone)` as the read-only adapter
      the preview uses. The timezone messages are unchanged.
- [ ] Add the commit command: it opens one transaction, revalidates the import/sync timezone
      agreement **under the lock**, and only then inserts. A mismatched timezone is refused inside
      that transaction with the same message the preview shows.
- [ ] The SDK sync path keeps its own timezone lock; the upload path does not change the
      account's `ibkrSyncTimeZone`.

### T-06.5 — NinjaTrader reviewed import

**Target:** `apps/web/src/server/ninjatrader-import.ts` (modify). **Tests:**
`apps/web/tests/ninjatrader-import.test.ts` (modify).

- [ ] `planImport` reads through the transaction handle instead of the global `db`, so the plan
      and the write see the same state. `previewNinjaTraderImport` and `commitNinjaTraderImport`
      both run inside a transaction; the preview is read-only.
- [ ] Replace the `rebuildAccount(accountId)` call with
      `reconcileAccountInTx(tx, accountId, changeContext("import", "historical"))`, so the
      projection rows, the projection revisions and the domain events are written by the one
      reconciliation boundary inside the import's own transaction, next to the sources, the
      aliases, the fills, the approved fee corrections and the import batch.
- [ ] The preview token, the fee-correction approval, the conflict list, the warnings, the
      inserted/duplicates/corrected counts and the batch fingerprint are unchanged.

### T-06.6 — Demo loader

**Target:** `apps/web/src/server/demo.ts` (modify). **Tests:** new
`apps/web/tests/demo-import.test.ts`.

- [ ] The demo account row and the demo fills are written in **one** transaction, so a failed
      fill insert leaves no empty demo account behind.
- [ ] The demo fills go through `insertExecutionsInTx(tx, id, rows, "import",
      changeContext("import", "historical"))` — the same ingestion boundary as every other
      import, in historical mode. A demo trade is never a live opening.
- [ ] The loader stays idempotent: a second call returns the existing demo account untouched.
- [ ] The demo loads no provider, contacts no network and enqueues no proactive work.

### T-06.7 — The import route (shared by T-06.3 and T-06.4)

**Target:** `apps/web/src/app/api/import/route.ts` (modify).

- [ ] The preview path keeps computing the XTB and IBKR reconciliation read-only, so the preview
      still reports the problems and the "N open holding(s)" warning.
- [ ] The commit path stops pre-computing those two source-specific checks outside the
      transaction and dispatches to the XTB and IBKR commit commands instead, so the check that
      decides is the one taken **under the lock**.
- [ ] The generic import and the NinjaTrader branches keep their current commands and their
      current response shape. The response keys (`detected`, `inserted`, `duplicates`, `skipped`,
      `skippedReasons`, `warnings`) are unchanged.

---

## Writer split (recorded before any implementation)

The coordinator's dispatch permits a clean split when the exact child assignments, owned files,
interface SHA, dependencies, tests and merge order are recorded here. This phase has one.

| Child (omp task agent)   | Tasks     | Owned files (exclusive)                                                                                                                                        | Tests it owns                                        |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `BrokerSyncWrites`       | T-06.1, T-06.2 | `apps/web/src/server/sync.ts`, `apps/web/src/server/ctrader-mcp/sync.ts`                                                                             | `apps/web/tests/sync-resilience.test.ts`, `apps/web/tests/ctrader-mcp/sync.test.ts` |
| `SpecializedImportWrites` | T-06.3, T-06.4, T-06.5, T-06.6, T-06.7 | `apps/web/src/server/xtb-import.ts`, `apps/web/src/server/ibkr-flex-xml-import.ts`, `apps/web/src/server/ninjatrader-import.ts`, `apps/web/src/server/demo.ts`, `apps/web/src/app/api/import/route.ts` | `apps/web/tests/xtb-import.test.ts`, `apps/web/tests/ibkr-flex-xml-import.test.ts`, `apps/web/tests/ninjatrader-import.test.ts`, `apps/web/tests/demo-import.test.ts` |

- **Interface SHA:** `5d1bf55cfc3d704d595e1a92df053c1d0592e083`. Neither child edits
  `server/trading/reconcile.ts`, `server/trading/commands.ts`, `server/executions.ts`,
  `server/rebuild.ts`, `server/settings.ts`, `db/**` or any package manifest. They consume those
  ports as they are.
- **Dependencies:** none between the children. Both build on the same interface SHA.
- **Merge order:** irrelevant — the file sets are disjoint. The orchestrator integrates both,
  then runs the gates, the review and the report.
- **Neither child commits.** The orchestrator owns the commit and the integration lock.

---

## Execution order

```
commit plan → children write the failing tests and the implementation → orchestrator integrates → gates → review → report
```

0. **Commit this plan first**:
   `git add docs/superpowers/plans/ai-native-journal/phase-06.md && git commit -m "docs: add Phase 06 broker-path plan"`.
1. Each child writes its failing test cases first, runs them, and then implements.
2. The orchestrator runs the targeted suites, the typecheck, the format check, the license check
   and the migration check.
3. The orchestrator runs the full `pnpm test` before the implementation commit.

---

## Verification (record exact output in the phase report)

```bash
pnpm exec vitest run apps/web/tests/sync-resilience.test.ts apps/web/tests/ninjatrader-import.test.ts apps/web/tests/xtb-import.test.ts apps/web/tests/ibkr-flex-xml-import.test.ts
pnpm exec vitest run apps/web/tests/ctrader-mcp/deals.test.ts apps/web/tests/ctrader-mcp/sync.test.ts apps/web/tests/trade-reconciliation.test.ts apps/web/tests/trade-mutation-events.test.ts
pnpm exec vitest run apps/web/tests/demo-import.test.ts apps/web/tests/import-account.test.ts apps/web/tests/history-import.test.ts apps/web/tests/ninjatrader-reconciliation.test.ts
pnpm --filter web typecheck
pnpm exec prettier --check <every file this phase touched>
node scripts/check-licenses.mjs
pnpm --filter web migrations:check
pnpm test
```

The **root** `pnpm typecheck` is not this phase's gate: it fails in the `desktop` workspace on a
pre-existing tooling defect (RC2175 icon generation) that is outside this phase's ownership and
is the coordinator's to schedule. `pnpm --filter web typecheck` plus the package filters are the
gate here.

---

## Stop condition

Phase 06 is done when **all** of the following hold.

**Implementation and tests**

- [ ] Every adapter task above is implemented against the shared seam.
- [ ] The four named suites pass, plus the cTrader suites, the demo suite and the Phase 05
      suites.
- [ ] The new atomicity cases pass: a failing event append rolls back the fills, the
      projections, the revisions, the events **and** the path's own bookkeeping (broker snapshot,
      import batch, source aliases, approved fee corrections, demo account).
- [ ] The source-specific refusals still refuse, with the same messages, and nothing is saved.
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

- [ ] `docs/superpowers/reports/ai-native-journal-phase-06.md` is written and committed, with the
      six items the phase guide requires.
- [ ] The report states the base SHA and the tip SHA of this phase's commits.
- [ ] The report records the gates that remain with the coordinator: the merged-feature merge,
      the destination verification and
      `docs/superpowers/reports/ai-native-journal-integration-06.md`.

**Then stop.** Phase 07 (account clear/delete/transfer, settings-driven rebuilds) is a separate
assignment. Do not merge to `codex/ai-native-journal`, push, or open a PR — the coordinator owns
the integration lock.

---

## Accepted deviations from the letter of the source documents

1. **The NinjaTrader and demo paths change their event provenance from
   `origin: "system"`/`mode: "maintenance"` to `origin: "import"`/`mode: "historical"`.** They
   previously reached the reconciliation boundary through `rebuildAccount`, which is the generic
   maintenance rebuild. Routing them through the ingestion port is what this phase asks for, and
   a statement import is an `import`, not a maintenance rebuild. The **classification** Phase 05
   shipped is unchanged: a first sight is `discovered` in both modes, so no trade is reclassified
   by this change.
2. **The XTB and IBKR upload checks move from the route into the transaction.** The route used to
   compute both source-specific problems before the write; the write then happened in a different
   transaction, so the decision and the write were never taken under one lock. The preview still
   computes both read-only, so the preview output and every message are unchanged.
3. **The bulk and single trade delete are not touched.** The phase guide assigns them to Phase
   07, and Phase 05 already made `deleteExecutionsForTrades` atomic (the fills and the rebuilt
   cycles commit together). Phase 06 does not widen the scope to the delete routes.
4. **No ADR change.** ADR 0001 and ADR 0002 govern broker connectivity, and this phase adds no
   connectivity, no HTTP call, no credential handling and no dependency.
