# Phase 07 — Remaining mutation commands and settings-driven rebuilds

> **For agentic workers:** implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> Implement only this phase. Do not begin Phase 08.

**Goal:** Every remaining mutation of the journal — deleting one trade, deleting many trades,
emptying an account, deleting an account, moving an account's history to another account, and
changing a profit method or a global multiplier — happens in **one** immediate transaction that
owns its own change context. The fills, the rebuilt projections, the immutable projection
revisions, the durable domain events, the annotations, the settings and the account bookkeeping
commit together or not at all. A transfer keeps a trade's identity **only** where a unique full
execution-membership match proves it, and an ambiguous transfer is rejected before anything is
written.

**Architecture:** Phase 05 shipped the reconciliation boundary
(`apps/web/src/server/trading/reconcile.ts`), the command layer
(`apps/web/src/server/trading/commands.ts`) and the transaction-taking ingest port
(`insertExecutionsInTx` in `apps/web/src/server/executions.ts`). Phase 06 moved every broker and
specialized import path onto that seam. Phase 07 does **not** add a second writer and does **not**
add a second reconciliation path. It extends the command layer with the mutations the API routes
still perform themselves, and the routes become thin dispatchers:

1. the route validates the request (pure checks only);
2. the route hands the request to **one** command;
3. the command opens **one** immediate transaction (`withJournalTransaction`) and does every read
   and every write through that transaction's `tx` handle;
4. the command writes its own bookkeeping (the account row, the settings, the current-account
   default) in the **same** transaction.

A route never opens a transaction, never writes a table and never rebuilds an account itself.

**Tech Stack:** existing TypeScript (strict, `noUncheckedIndexedAccess`), Next.js 15, Drizzle +
better-sqlite3, Zod, Vitest, `node:crypto` UUIDs. **No new dependency. Schema allocation: none**
(no table, no migration, no checksum change, no `db/schema.ts` change, no `db/bootstrap.ts`
change).

**Authoritative references:** phase guide Phase 07
(`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), detailed plan Task 5
(`docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md`), design §6/§7/§16,
contract review §2–§6, ADR 0006, ADR 0007, ADR 0008.

**Base SHA (the merged reconciliation, command and ingestion interfaces this phase builds on):**
`3e7346e2115be4b74d2b65594f9fe3e3ab3044b7` (feature HEAD after the T-006 integration).

---

## Global constraints

- **Schema allocation: none.** No table, no migration, no `migration-checksums.json` change, no
  `db/schema.ts` change, no `db/bootstrap.ts` change. Every table this phase reads or writes
  (`executions`, `trades`, `accounts`, `settings`, `trade_identities`,
  `trade_projection_revisions`, `trade_revision_executions`, `trade_identity_links`,
  `execution_evidence`, `domain_outbox`, `event_deliveries`, `intelligence_jobs`) already exists.
- **Forward-only migrations are untouched.** `0001`, `0002`, `0003` are not edited, renumbered or
  deleted.
- **No new dependency** → no ADR change, no manifest change, no lockfile change.
- **Production event capture stays off.** One global switch (`JOURNAL_EVENT_CAPTURE`), never a
  per-path switch. The tests turn it on explicitly.
- **No network call, promise or provider call inside a write transaction.** The transaction is
  synchronous by contract (`db/transaction.ts` enforces this). The broker sync action keeps its
  network call outside any transaction.
- **Preserve** execution hashes, derived trade keys, annotations, cTrader sync, all three AI
  provider categories, encrypted credentials and every import/AI response contract. The public
  `insertExecutions`, `rebuildAccount`, `deleteExecutionsForTrades` and `SyncOutcome` keep their
  signatures and results. The trade-key format is not touched.
- **Preserve the existing API success shapes** of every route this phase changes, and every
  user-facing message (the IBKR refusals included).
- **Node ≥ 22, pnpm 11.0.8, frozen lockfile.** `pnpm install` is already done; do not reinstall.
- Disposable absolute `JOURNAL_DATA_DIR` and scratch DB files under the OS temp dir. Never use
  ports 3000/3001. Never touch live trader data.

---

## The shared seam (every task below uses exactly this shape)

```ts
import { withJournalTransaction } from "@/db/transaction";
import { changeContext, reconcileAccountInTx } from "@/server/trading/reconcile";

withJournalTransaction((tx) => {
  // 1. revalidate the preconditions, reading through `tx`
  // 2. mutate the source rows through `tx`
  // 3. reconcileAccountInTx(tx, accountId, context) — projections, revisions, events
  // 4. write the path's own bookkeeping through `tx`
});
```

`reconcileAccountInTx` already writes the projection rows, the projection revisions and the domain
events inside the caller's transaction. A task must **not** call `rebuildAccount` and must **not**
call the public `insertExecutions` from inside a transaction.

### Change contexts (fixed by this phase)

| Path                                              | `origin` | `mode`        |
| ------------------------------------------------- | -------- | ------------- |
| Single trade delete (`DELETE /api/trades/[key]`)  | `user`   | `live`        |
| Bulk trade delete (`POST /api/trades/bulk`)       | `user`   | `live`        |
| Account clear (`action: "clear"`)                 | `user`   | `live`        |
| Account delete (`DELETE /api/accounts/[id]`)      | `user`   | `live`        |
| Account transfer (`action: "transfer"`)           | `user`   | `live`        |
| Profit-method change (`PATCH /api/accounts/[id]`) | `user`   | `maintenance` |
| Multiplier change (`PATCH /api/settings`)         | `user`   | `maintenance` |

A deletion is a live statement by the user about the journal's present state; a method or
multiplier change is a recomputation of the same facts under a new rule, so it is `maintenance`.
The **classification** Phase 05 shipped is preserved unchanged: a first sight is `discovered`, a
first sight that is still open in `live` mode is `opened`, an observed open cycle that is now
closed is `closed`, every other change to a known projection is `revised`, and a projection that
disappeared is `removed`.

---

## The command layer (the contract every task below codes against)

`apps/web/src/server/trading/commands.ts` gains these exports. The names, the parameters and the
behaviour are fixed by this plan; a task that needs a different shape changes this plan first.

```ts
export type { ChangeContext } from "../domain-events";

/** Deletes the fills of the given trades and rebuilds every affected account. */
export const deleteTrades = (keys: readonly string[], context: ChangeContext): void;

/** Empties one account: its fills go, its projections become removal tombstones. */
export const clearAccount = (id: string, context: ChangeContext): void;

/** Deletes one account and purges its intelligence in the same transaction. */
export const deleteAccount = (id: string, context: ChangeContext): void;

/** Moves one account's history into another, keeping identity only where it is proven. */
export const transferAccount = (
  sourceId: string,
  destinationId: string,
  context: ChangeContext,
): void;

/** Applies the journal settings and rebuilds every affected account in one transaction. */
export const updateSettings = (patch: SettingsPatch): void;

/** Updates one account, rebuilding it when the profit method changed. */
export const updateAccount = (id: string, patch: AccountPatch): void;

/** Archives or unarchives one account and keeps the persisted default consistent. */
export const setAccountArchived = (id: string, archived: boolean): void;
```

`SettingsPatch` and `AccountPatch` live in `commands.ts` and carry only what the route already
validated:

```ts
export interface SettingsPatch {
  timeZone?: string;
  importTimeZone?: string;
  multipliers?: Record<string, number>;
  currencyConversion?: CurrencyConversion;
  /** `null` clears the persisted single-account default. */
  currentAccountId?: string | null;
  /** Written only when the request carried a provider. */
  aiProvider?: AiProvider;
  /** The provider whose model setting `aiModel` belongs to. */
  aiModelProvider?: AiProvider;
  aiModel?: string;
  /** `null` clears the saved key of that provider. */
  aiKeys?: { anthropic?: string | null; openai?: string | null; compatible?: string | null };
  compatibleBaseUrl?: string;
}

export interface AccountPatch {
  name?: string;
  broker?: string;
  currency?: string;
  initialBalance?: number;
  autoSync?: boolean;
  profitCalcMethod?: "fifo" | "lifo" | "wavg";
}
```

### Supporting seams the commands need

| File                                                           | Change                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/trading/reconcile.ts`                     | `reconcileAccountInTx(tx, accountId, context, options?)` gains an optional `ReconcileOptions.transfers` map (see below). The signature stays backward compatible.                                                                                                                                                                                                                                                    |
| `apps/web/src/server/trading/identity.ts`                      | New export `executionMembershipKey(executionIds: readonly string[]): string` — the membership of a projection as one comparable key (sorted, de-duplicated, joined).                                                                                                                                                                                                                                                 |
| `apps/web/src/server/executions.ts`                            | New exports `deleteExecutionsForTradesInTx(tx, accountId, executionIds)` (deletes the given fills of one account, chunked below SQLite's bind limit) and `deleteAccountExecutionsInTx(tx, accountId)` (deletes every fill of one account). The public `deleteExecutionsForTrades(accountId, executionIds)` keeps its signature and keeps deleting **and** reconciling, now by delegating to the in-transaction form. |
| `apps/web/src/server/settings.ts`                              | New transaction-aware writers: `setSettingInTx(tx, key, value)`, `deleteSettingInTx(tx, key)`, `getImportTimeZoneInTx(tx)`, `setCurrentAccountIdInTx(tx, id)`, `setAiKeyInTx(tx, provider, key)`, `setCompatibleBaseUrlInTx(tx, url, keepKey)`. The existing non-transactional writers keep their signatures.                                                                                                        |
| `apps/web/src/server/intelligence/infrastructure/retention.ts` | **New file.** Exports `purgeAccountIntelligence(tx: JournalTx, accountId: string): void`. Phase 20 (Task 13) extends this file with pruning and backup; it is created here because the account deletion needs it.                                                                                                                                                                                                    |

### The transfer contract (the heart of this phase)

The contract review (§4) is explicit: _"Explicit account transfer may retain identity only when a
unique full execution-membership match is established within that transaction. No fuzzy matching by
symbol/time/P&L or shared execution overlap: crossing-flat fills make that unsound. … On ambiguous
transfer, reject the transfer before any write with an actionable conflict; do not silently drop or
overwrite annotations."_

**The membership key.** A projection's membership is the set of fill ids that make it up.
`executionMembershipKey` turns that set into one comparable string.

**The transfer hints.** `ReconcileOptions` is:

```ts
export interface ReconcileOptions {
  /**
   * The identities a proven transfer continues, keyed by the execution
   * membership of the projection (`executionMembershipKey`).
   */
  readonly transfers?: ReadonlyMap<string, string>;
}
```

`reconcileAccountInTx` looks the trip's membership up in that map. A hit is passed to
`resolveIdentity` as `explicitTransferSourceId`, so the identity is **continued** and the revision
records the resolution `explicit_transfer`. A projection that a transfer claims is classified
`revised` (its facts are the same, its account changed), not `discovered`.

**The command.** `transferAccount(sourceId, destinationId, context)` runs, in one transaction:

1. `requireValue(sourceId !== destinationId, "Choose a different destination account.")`.
2. Read the source and the destination account through `tx`; `requireValue(…, "Account not found.")`.
3. Read the source's trades (with their annotations) and the **active identity** of each of them
   (an identity whose `current_key` is the trade key and whose state is `active`). Build the
   transfer hints: `executionMembershipKey(trade.executionIds) → identity.id`.
4. Apply the existing IBKR provenance rule under the lock: `ibkrTransferTimeZone(source,
destination)`; when it returns a zone, write it to the destination. The refusals and their
   messages are unchanged.
5. Move the fills: `UPDATE executions SET account_id = destination WHERE account_id = source`.
6. `reconcileAccountInTx(tx, destinationId, context, { transfers })` — the destination's
   projections, revisions and events are written, and the proven identities move to the
   destination.
7. **Prove every moved trade.** For each source trade, find the destination trades whose
   execution membership equals the source trade's membership:
   - exactly one → the trade moved;
   - zero or more than one → **reject**: the fills merged with other fills or split, so the
     annotations would be dropped or misattached. `requireValue` with a plain-language message.
   - when the source trade had an active identity, that identity must now point at the
     destination account and the destination key. If it does not, the identity could not be
     matched unambiguously → **reject**.
8. Copy the annotations of each source trade onto its counterpart: `notes`, `tagsJson`,
   `mistakesJson`, `playbookId`, `rating`, `stopLoss`, `profitTarget`, `reviewedAt`. The copy
   happens **after** the destination reconcile (the counterpart exists then) and **before** the
   source reconcile (the source rows still exist then).
9. `reconcileAccountInTx(tx, sourceId, context)` — the source's projections disappear, so its
   identities are retired and `removed` events are written for the identities that stayed in the
   source. An identity that a proven transfer continued is **not** retired: it holds the
   destination key now.
10. Clear the source's `ibkrSyncTimeZone`.

Every rejection is a `requireValue` failure inside the transaction: the transaction rolls back, so
nothing is written, and the route answers `400` with the message. The transfer never half-applies.

### The purge contract

`purgeAccountIntelligence(tx, accountId)` removes what belongs to one account, in the caller's
transaction:

1. The account's outbox rows (`domain_outbox.account_id = accountId`) are the committed change
   events; their payloads carry the account's trade keys. They are deleted, which cascades their
   `event_deliveries`.
2. The jobs those deliveries produced are **cancelled** first (`cancel_requested = true`,
   `status = 'cancelled'`, the owner and the lease released) and then deleted. A worker that
   still holds such a job is fenced: its completion finds no job row and fails.
3. The account's `execution_evidence` rows (the sidecar of its fills) are deleted — they have no
   foreign key, so they would otherwise survive their fills.

The account's identities, revisions, membership rows and identity links are removed by the
existing `ON DELETE CASCADE` from the account row. The purge runs **before** the account's fills
are deleted, because it finds the evidence rows through them.

---

## Tasks

### T-07.1 — The command layer (single and bulk trade deletion, clear, delete, transfer)

**Target:** `apps/web/src/server/trading/commands.ts` (modify), `apps/web/src/server/trading/reconcile.ts`
(modify), `apps/web/src/server/trading/identity.ts` (modify), `apps/web/src/server/executions.ts`
(modify), `apps/web/src/server/intelligence/infrastructure/retention.ts` (create).
**Tests:** `apps/web/tests/trade-mutation-commands.test.ts` (create).

- [ ] Add `executionMembershipKey` to `identity.ts` and the `ReconcileOptions` / `transfers`
      support to `reconcile.ts`, exactly as the contract above describes. A projection a transfer
      claims is classified `revised`.
- [ ] Add `deleteExecutionsForTradesInTx` and `deleteAccountExecutionsInTx` to `executions.ts`;
      the fill deletion is chunked below SQLite's bind-parameter limit, exactly like the vanished
      keys in `reconcile.ts`. The public `deleteExecutionsForTrades` keeps its signature and its
      behaviour (delete **and** reconcile) by delegating to the in-transaction form.
- [ ] Add `deleteTrades(keys, context)`: one transaction; the trades are read through `tx` (the
      key lookup is chunked); the execution ids are grouped per account; each account's fills are
      deleted and each account is reconciled **once**. A key that names no trade is ignored.
- [ ] Add `clearAccount(id, context)`: one transaction; every fill of the account is deleted; the
      account is reconciled, so its projections disappear, its identities are retired and `removed`
      events are written; the account's `ibkrSyncTimeZone` is cleared. The account itself and its
      annotations on other objects survive.
- [ ] Add `deleteAccount(id, context)`: one transaction; the account's intelligence is purged
      first; the account's trades, fills and account row are deleted; the persisted
      `currentAccountId` is cleared when it pointed at this account. Deleting an account that does
      not exist is a no-op, exactly as the route behaves today.
- [ ] Add `transferAccount(sourceId, destinationId, context)` exactly as the transfer contract
      above describes.
- [ ] Create `apps/web/src/server/intelligence/infrastructure/retention.ts` with
      `purgeAccountIntelligence(tx, accountId)` exactly as the purge contract above describes.
- [ ] Write `apps/web/tests/trade-mutation-commands.test.ts`: the mutation matrix below.

### T-07.2 — The settings-driven rebuilds and the profit-method change

**Target:** `apps/web/src/server/settings.ts` (modify), `apps/web/src/server/trading/commands.ts`
(modify — `updateSettings`, `updateAccount`). **Tests:**
`apps/web/tests/trade-mutation-commands.test.ts` (the settings and method rows of the matrix).

- [ ] Add the transaction-aware settings writers to `settings.ts` exactly as the table above
      describes. The existing readers and writers keep their signatures and their behaviour.
- [ ] Add `updateSettings(patch)`: **one** transaction for every setting write and for every
      affected account's rebuild. The multipliers are written through `tx` **before** the rebuilds
      read them, so the rebuild sees the new multipliers. A multiplier change rebuilds **every**
      account, in the same transaction, with `changeContext("user", "maintenance")`. The other
      settings (time zones, currency conversion, the persisted default, the AI provider, the AI
      model, the AI keys, the compatible server URL) keep the exact order and the exact
      semantics the route has today — including the rule that a display-timezone change pins the
      legacy import default to its current effective value.
- [ ] Add `updateAccount(id, patch)`: one transaction; the account is read through `tx`; the IBKR
      broker-change refusal keeps its message; the account row is written; a changed
      `profitCalcMethod` rebuilds that account in the same transaction with
      `changeContext("user", "maintenance")`.
- [ ] Add `setAccountArchived(id, archived)`: one transaction; the account row is written and the
      persisted `currentAccountId` is cleared when it pointed at an account that is now archived.

### T-07.3 — The trade routes

**Target:** `apps/web/src/app/api/trades/[key]/route.ts` (modify),
`apps/web/src/app/api/trades/bulk/route.ts` (modify). **Tests:**
`apps/web/tests/trade-delete-routes.test.ts` (create).

- [ ] `DELETE /api/trades/[key]` reads the trade (404 `Trade not found` when it is gone) and hands
      the deletion to `deleteTrades([key], changeContext("user", "live"))`. The response stays
      `{ deleted: true }`.
- [ ] `POST /api/trades/bulk` with `action: "delete"` hands the deletion to
      `deleteTrades(body.keys, changeContext("user", "live"))` and keeps the response
      `{ deleted: <the number of trades that matched the keys> }`.
- [ ] The other bulk actions (`review`, `unreview`, `tag`, `untag`, `playbook`) keep their current
      behaviour and their current response shape. They are annotation writes, not financial
      mutations: this phase does not change them.
- [ ] `GET` and `PATCH /api/trades/[key]` keep their current behaviour and their current response
      shapes.

### T-07.4 — The account routes

**Target:** `apps/web/src/app/api/accounts/[id]/route.ts` (modify),
`apps/web/src/app/api/accounts/[id]/actions/route.ts` (modify). **Tests:**
`apps/web/tests/account-mutation-routes.test.ts` (create).

- [ ] `PATCH /api/accounts/[id]` hands the account update to `updateAccount(id, patch)` and keeps
      the response `{ updated: true }` and the 404 `Account not found`.
- [ ] `DELETE /api/accounts/[id]` hands the deletion to
      `deleteAccount(id, changeContext("user", "live"))` and keeps the response `{ deleted: true }`.
- [ ] `action: "archive"` / `"unarchive"` hand the change to `setAccountArchived(id, archived)`
      and keep the responses `{ archived: true }` / `{ archived: false }`.
- [ ] `action: "clear"` hands the emptying to `clearAccount(id, changeContext("user", "live"))` and
      keeps the response `{ cleared: true }`.
- [ ] `action: "transfer"` keeps its request validation (`toAccountId is required`,
      `Choose a different destination account.`, the 404 `Destination account not found`) and hands
      the move to `transferAccount(id, destinationId, changeContext("user", "live"))`. The response
      stays `{ transferred: true }`.
- [ ] `action: "sync"` is unchanged: the broker call stays outside any transaction.

### T-07.5 — The settings route

**Target:** `apps/web/src/app/api/settings/route.ts` (modify). **Tests:**
`apps/web/tests/settings-mutation-routes.test.ts` (create).

- [ ] `PATCH /api/settings` keeps every validation it has today (the currency-conversion rates,
      the provider, the compatible server URL, the model id, the API keys, the time zones, the
      multipliers) and keeps its response `{ saved: true }`.
- [ ] The writes and the rebuilds are handed to `updateSettings(patch)`. The route writes no
      setting and opens no transaction.

---

## The mutation matrix (the phase's exit evidence)

Every row is covered by a test in this phase. "One transaction" means the operation leaves
nothing behind when it fails: no fill, no projection, no revision, no event, no annotation
change, no setting write and no account bookkeeping.

| Mutation                                      | Expected                                                                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single trade delete                           | The fills go; the projection goes; the identity is retired; a `removed` event is written; the other trades of the account survive and are rebuilt.                                                            |
| Single trade delete of a crossing-flat pair   | The shared fill is deleted with the trade; the sibling cycle is rebuilt from the remaining fills; both the removal and the revision commit together.                                                          |
| Bulk trade delete across two accounts         | One transaction; both accounts are rebuilt once; the count is the number of matched trades.                                                                                                                   |
| Bulk trade delete of a key that names nothing | No change, no event.                                                                                                                                                                                          |
| Account clear                                 | The fills go; the projections go; the identities are tombstoned; `removed` events are written; the account survives; `ibkrSyncTimeZone` is null.                                                              |
| Account delete                                | The trades, fills, identities, revisions, membership, evidence, outbox rows, deliveries and jobs of the account are gone; the account row is gone; the persisted default is cleared.                          |
| Account delete with a leased job              | The job is cancelled and removed; a stale completion against it fails.                                                                                                                                        |
| Account transfer (proven)                     | The fills move; the destination's projection exists; the identity is continued (`explicit_transfer`); the annotations are copied; the source's projections are gone; the source's identity is not tombstoned. |
| Account transfer (ambiguous)                  | `400` with an actionable message; the fills, trades, annotations, identities and events are unchanged.                                                                                                        |
| Account transfer (crossing-flat)              | Both cycles keep their own identity; neither is guessed from the other.                                                                                                                                       |
| Multiplier change                             | The setting is stored; every account is rebuilt in the same transaction; a changed projection raises `revised`; the annotations survive.                                                                      |
| Multiplier change that fails                  | The setting is not stored and no projection changed.                                                                                                                                                          |
| Profit-method change                          | The account's projections are recomputed; the exit attribution changes; `revised` events are written; the annotations survive.                                                                                |

---

## Writer split (recorded before any implementation)

The children are omp task agents inside this phase. They share one repository, so the file sets are
disjoint and every child builds on the committed plan.

| Child (omp task agent) | Tasks          | Owned files (exclusive)                                                                                                                                                                                                                                                  | Tests it owns                                     |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `CommandLayer`         | T-07.1, T-07.2 | `apps/web/src/server/trading/commands.ts`, `apps/web/src/server/trading/reconcile.ts`, `apps/web/src/server/trading/identity.ts`, `apps/web/src/server/executions.ts`, `apps/web/src/server/intelligence/infrastructure/retention.ts`, `apps/web/src/server/settings.ts` | `apps/web/tests/trade-mutation-commands.test.ts`  |
| `TradeRoutes`          | T-07.3         | `apps/web/src/app/api/trades/[key]/route.ts`, `apps/web/src/app/api/trades/bulk/route.ts`                                                                                                                                                                                | `apps/web/tests/trade-delete-routes.test.ts`      |
| `AccountRoutes`        | T-07.4         | `apps/web/src/app/api/accounts/[id]/route.ts`, `apps/web/src/app/api/accounts/[id]/actions/route.ts`                                                                                                                                                                     | `apps/web/tests/account-mutation-routes.test.ts`  |
| `SettingsRoute`        | T-07.5         | `apps/web/src/app/api/settings/route.ts`                                                                                                                                                                                                                                 | `apps/web/tests/settings-mutation-routes.test.ts` |

- **Interface SHA:** `3e7346e2115be4b74d2b65594f9fe3e3ab3044b7` plus this plan. The route children
  code against the command signatures in this plan; the command child implements exactly those
  signatures.
- **Dependencies:** the route children depend on the command child's exports. They are written in
  the same batch and are verified together after the batch lands; a route child must not change a
  command signature to make its own code compile.
- **Merge order:** the command child first (the routes import its exports), then the three route
  children (their file sets are disjoint).
- **Neither child commits.** The orchestrator owns the commit and the integration lock.

---

## Execution order

```
commit plan → children write the failing tests and the implementation → orchestrator integrates → gates → review → report
```

0. **Commit this plan first**:
   `git add docs/superpowers/plans/ai-native-journal/phase-07.md && git commit -m "docs: add Phase 07 mutation-command plan"`.
1. Each child writes its failing test cases first and then implements.
2. The orchestrator runs the targeted suites, the typecheck, the format check, the license check
   and the migration check.
3. The orchestrator runs the full `pnpm test` before the implementation commit.

---

## Verification (record exact output in the phase report)

```bash
pnpm exec vitest run apps/web/tests/trade-mutation-commands.test.ts apps/web/tests/trade-delete-routes.test.ts apps/web/tests/account-mutation-routes.test.ts apps/web/tests/settings-mutation-routes.test.ts
pnpm exec vitest run apps/web/tests/trade-reconciliation.test.ts apps/web/tests/trade-mutation-events.test.ts apps/web/tests/execution-storage.test.ts
pnpm exec vitest run apps/web/tests/ibkr-sync-timezone.test.ts apps/web/tests/account-default.test.ts apps/web/tests/ninjatrader-reconciliation.test.ts apps/web/tests/history-import.test.ts apps/web/tests/ctrader-mcp/sync.test.ts
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

Phase 07 is done when **all** of the following hold.

**Implementation and tests**

- [ ] Every task above is implemented against the shared seam.
- [ ] The four named suites pass, plus the Phase 05 suites and the account/IBKR/history suites.
- [ ] Every row of the mutation matrix is covered by a test.
- [ ] An ambiguous transfer is rejected atomically: nothing is written and the route answers `400`.
- [ ] The account deletion purges the account's outbox rows, deliveries and jobs and fences a
      leased job.
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

- [ ] `docs/superpowers/reports/ai-native-journal-phase-07.md` is written and committed, with the
      six items the phase guide requires.
- [ ] The report states the base SHA and the tip SHA of this phase's commits.

**Not in this phase**

- Phase 08's observations and evidence quality, Phase 09's seed and replay, Phase 18's
  interaction APIs, Phase 20's retention and backup. This phase creates
  `apps/web/src/server/intelligence/infrastructure/retention.ts` with the account purge only;
  Phase 20 extends that file.
