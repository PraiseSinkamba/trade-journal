# Phase 07 — Remaining mutation commands and settings-driven rebuilds

> Phase report for the AI-native journal modernization. Source of truth: the phase guide
> (`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), the phase plan
> (`docs/superpowers/plans/ai-native-journal/phase-07.md`), the contract review
> (`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md` §2–§6),
> the task packet (`docs/orchestration/ai-native-journal/tasks/T-007.md`), ADR 0006, ADR 0007 and
> ADR 0008.

## 1. Phase ID, baseline, scope

| Item                     | Value                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Phase                    | 07 — Remaining mutation commands and settings-driven rebuilds                         |
| Milestone                | M2                                                                                    |
| Stable task / native IDs | T-007 / `task_816b57885f53`                                                           |
| Dispatch ID              | `ctx_c108c1988ca7`                                                                    |
| Branch                   | `codex/ai-native-journal-p07` (child of the feature worktree)                         |
| Base SHA                 | `3e7346e2115be4b74d2b65594f9fe3e3ab3044b7` (feature HEAD after the T-006 integration) |
| Plan commit              | `7ef0a94` — `docs: add Phase 07 mutation-command plan`                                |
| Implementation tip       | `d9dc7d2` — `feat: reconcile trading mutations with atomic domain events`             |
| Report tip               | the report commit of this phase                                                       |
| Integration destination  | `codex/ai-native-journal` (merged by the coordinator, not by this worker)             |

**Scope completed.** Every remaining mutation of the journal now runs in **one** immediate
transaction that owns its change context. Deleting one trade, deleting many trades, emptying an
account, deleting an account, moving an account's history into another account, changing a profit
method and changing the global contract multipliers all leave their fills, their rebuilt
projections, their immutable projection revisions, their durable domain events, their annotations,
their settings and their account bookkeeping committed together — or not at all. The API routes are
thin dispatchers now: they validate, they hand over to a command, and they answer. No route opens
a transaction, writes a table or rebuilds an account any more.

An account move keeps a trade's identity **only** where a unique full execution-membership match
proves it, and an ambiguous move is refused before anything is written. Deleting an account takes
its intelligence with it: its events, their deliveries, their jobs and its evidence sidecar are
purged inside the deleting transaction, so queued work cannot resurrect private records.

**Scope remaining.** None for this phase. The financial engine, the trade-key format, the execution
hash, the book methodology, the AI adapters, the cTrader sync and the provider categories are
untouched. The broker and specialized import paths stay Phase 06's.

**Schema allocation used.** None, as the phase guide requires. No table, no migration, no
`migration-checksums.json` change, no `db/schema.ts` change, no `db/bootstrap.ts` change. Every
table this phase reads or writes (`executions`, `trades`, `accounts`, `settings`, `trade_identities`,
`trade_projection_revisions`, `trade_revision_executions`, `trade_identity_links`,
`execution_evidence`, `domain_outbox`, `event_deliveries`, `intelligence_jobs`) already existed
before this phase.

## 2. Changed files and exported interfaces

| File                                                           | Change                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/trading/commands.ts`                      | New commands: `deleteTrades(keys, context)`, `clearAccount(id, context)`, `deleteAccount(id, context)`, `transferAccount(sourceId, destinationId, context)`, `updateSettings(patch)`, `updateAccount(id, patch)`, `setAccountArchived(id, archived)`, plus the exported `SettingsPatch` and `AccountPatch`. Each command owns exactly one `withJournalTransaction` and reads and writes through `tx`. |
| `apps/web/src/server/trading/reconcile.ts`                     | `reconcileAccountInTx(tx, accountId, context, options?)` gained the optional `ReconcileOptions.transfers` map. A projection a proven transfer claims continues its identity (`explicit_transfer`) and is classified `revised`; every other projection keeps its classification. The three-argument callers are unchanged.                                                                             |
| `apps/web/src/server/trading/identity.ts`                      | New `executionMembershipKey(executionIds)`: the membership of a projection as one comparable key (de-duplicated, sorted, joined).                                                                                                                                                                                                                                                                     |
| `apps/web/src/server/executions.ts`                            | New `deleteExecutionsForTradesInTx(tx, accountId, executionIds)` (chunked below SQLite's bind-parameter limit) and `deleteAccountExecutionsInTx(tx, accountId)`. The public `deleteExecutionsForTrades(accountId, executionIds)` keeps its signature and behaviour and now delegates to the in-transaction form.                                                                                      |
| `apps/web/src/server/settings.ts`                              | New transaction-aware writers `setSettingInTx`, `deleteSettingInTx`, `getImportTimeZoneInTx`, `setCurrentAccountIdInTx`, `setAiKeyInTx`, `setCompatibleBaseUrlInTx`. The existing readers and writers keep their signatures; they now delegate to their in-transaction twins through the journal connection handle, so the semantics have one implementation.                                         |
| `apps/web/src/server/intelligence/infrastructure/retention.ts` | **New file.** `purgeAccountIntelligence(tx, accountId)`: the account's outbox rows (and, by cascade, their deliveries) go, the jobs those deliveries produced are cancelled first and deleted after (a worker that still holds one is fenced), and the evidence sidecar of the account's fills is deleted. Phase 20 (Task 13) extends this file with pruning and backup.                              |
| `apps/web/src/app/api/trades/[key]/route.ts`                   | `DELETE` hands the deletion to `deleteTrades([key], changeContext("user", "live"))`; the 404 `Trade not found` and the `{ deleted: true }` response are unchanged. `GET` and `PATCH` are unchanged.                                                                                                                                                                                                   |
| `apps/web/src/app/api/trades/bulk/route.ts`                    | The `delete` action hands the whole request to `deleteTrades(body.keys, changeContext("user", "live"))` — one transaction, every affected account rebuilt once — and keeps `{ deleted: <the number of matched trades> }`. The annotation actions are unchanged.                                                                                                                                       |
| `apps/web/src/app/api/accounts/[id]/route.ts`                  | `PATCH` hands the update to `updateAccount(id, patch)`; `DELETE` hands the deletion to `deleteAccount(id, changeContext("user", "live"))`. The 404 `Account not found`, the `{ updated: true }` and `{ deleted: true }` responses and the IBKR broker-change refusal are unchanged.                                                                                                                   |
| `apps/web/src/app/api/accounts/[id]/actions/route.ts`          | `archive`/`unarchive` go to `setAccountArchived`, `clear` to `clearAccount`, `transfer` to `transferAccount`. The request validation (`toAccountId is required`, `Choose a different destination account.`, the 404 `Destination account not found`) and every response shape are unchanged; `sync` still calls the broker outside any transaction.                                                   |
| `apps/web/src/app/api/settings/route.ts`                       | `PATCH` keeps every validation and its `{ saved: true }` response, and hands the writes and the rebuilds to `updateSettings(patch)`. The route writes no setting and opens no transaction.                                                                                                                                                                                                            |
| `apps/web/tests/trade-mutation-commands.test.ts`               | **New.** 19 tests over the mutation matrix: single delete, crossing-flat delete, bulk delete across two accounts, account clear, account delete (with the purge and a leased job), the proven / ambiguous / crossing-flat transfer, a move whose fill the destination already holds, the multiplier change, a failed multiplier rebuild, the profit-method change and the archive rules.              |
| `apps/web/tests/trade-delete-routes.test.ts`                   | **New.** 9 tests: the single-delete route (404, deletion, the untouched sibling trades) and the bulk route (two accounts, the matched count, a key that names nothing, the unchanged annotation actions).                                                                                                                                                                                             |
| `apps/web/tests/account-mutation-routes.test.ts`               | **New.** 12 tests: the account PATCH and DELETE, archive and unarchive, clear, the proven transfer with its annotations, the ambiguous transfer answered 400 with nothing changed, the transfer validation and the refusals.                                                                                                                                                                          |
| `apps/web/tests/settings-mutation-routes.test.ts`              | **New.** 6 tests: the multiplier change and its rebuild, the display-zone change and the pinned legacy import default, clearing the persisted default, and the three refused settings (multiplier, time zone, missing conversion rate).                                                                                                                                                               |

**Compatibility preserved.** The public `insertExecutions`, `rebuildAccount`,
`deleteExecutionsForTrades`, `SyncOutcome` and `InsertResult` keep their signatures and results.
Every route keeps its response shape, its status codes and its user-facing messages. The trade-key
format (`accountId|symbol|direction|openedAt[|importGroup][|N]`), the execution hashes, the
annotations, the encrypted credentials, the OpenAI-compatible endpoint, the AI import policy and
the cTrader sync are untouched. `packages/core` was not modified.

## 3. Migrations, upgrade results, backup and rollback impact

**No migration.** The phase guide allocates no schema change to Phase 07, and none was made: no
table, no column, no index, no registry entry, no checksum. `pnpm --filter web migrations:check`
reports `migration-checksums.json is up to date.` — the applied history is exactly the one Phase 02
froze and Phases 03 and 04 extended.

**Upgrade and backup impact: none.** The phase adds no persisted state of its own; it writes the
rows the schema already holds. A journal upgraded from any earlier build needs no repair, and a
backup taken before this phase restores into a journal this phase reads unchanged.

**Rollback.** The phase is additive in behaviour only: the old routes wrote the same rows through
`db.transaction(...)`, so rolling back to the previous application restores the previous behaviour
over the same data. The one thing a rollback cannot undo is the _evidence_ the new paths write
(`trade_identities`, `trade_projection_revisions`, `domain_outbox`) — those rows are additive and
stay behind, exactly as in Phases 05 and 06, and the Phase 09 baseline reconcile is the documented
way to re-establish a continuous event stream after an interval without capture.

## 4. Commands actually run

All commands ran in the phase checkout with a disposable absolute `JOURNAL_DATA_DIR` (the test
files create their own scratch directory under the OS temp dir). Node v24.20.0, pnpm 11.0.8. No
port was used; no long-running server was started.

| Command                                                                                                                                                                                                                                                                                             | Exit | Result                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/trade-mutation-commands.test.ts apps/web/tests/trade-delete-routes.test.ts apps/web/tests/account-mutation-routes.test.ts apps/web/tests/settings-mutation-routes.test.ts`                                                                                     | 0    | 4 files, 46 tests passed                     |
| `pnpm exec vitest run apps/web/tests/trade-reconciliation.test.ts apps/web/tests/trade-mutation-events.test.ts apps/web/tests/execution-storage.test.ts apps/web/tests/ibkr-sync-timezone.test.ts apps/web/tests/account-default.test.ts apps/web/tests/ai-settings.test.ts` (+ the four new files) | 0    | 10 files, 138 tests passed                   |
| `pnpm exec vitest run apps/web/tests/trade-projection-identity.test.ts apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-worker.test.ts`                                                                                              | 0    | 4 files, 62 tests passed                     |
| `pnpm --filter web typecheck`                                                                                                                                                                                                                                                                       | 0    | `next typegen` + `tsc --noEmit` clean        |
| `pnpm exec prettier --check` (the 15 changed files)                                                                                                                                                                                                                                                 | 0    | "All matched files use Prettier code style!" |
| `node scripts/check-licenses.mjs`                                                                                                                                                                                                                                                                   | 0    | "Dependency licenses OK."                    |
| `pnpm --filter web migrations:check`                                                                                                                                                                                                                                                                | 0    | "migration-checksums.json is up to date."    |
| `pnpm test` (full workspace)                                                                                                                                                                                                                                                                        | 0    | 98 files, 1014 tests passed (216.96 s)       |

**Environment-limited checks.** The root `pnpm typecheck` is not this phase's gate: it fails in the
`desktop` workspace on a pre-existing tooling defect (RC2175 icon generation) that is outside this
phase's ownership and is the coordinator's to schedule. `pnpm --filter web typecheck` is the gate
here and it passes. No Docker, Tauri, packaging or benchmark check belongs to this phase; the
benchmark gate is Phase 21 (T-021). Production event capture stays off (`JOURNAL_EVENT_CAPTURE`),
exactly as the phase guide requires — the tests turn it on explicitly.

**Review.** One reviewer run on the implementation diff (base `7ef0a94`, tip the staged index of
`d9dc7d2`): `.omp/reviewer-report.md` records `## Verdict: PASS` — 6/6 verification steps passed,
0 findings, 0 hard blocks. The reviewer confirmed, from the diff, that every mutation runs in one
immediate transaction, that the routes own no transaction and no table write, that the purge fences
a leased job, that the transfer keeps an identity only on a proven membership match, that the
multiplier write precedes the reconciliations in the same transaction, and that no schema,
migration, dependency, chart, importer or telemetry path changed.

## 5. Deviations, evidence and unresolved risks

**Deviations from the phase plan, with the evidence for each.**

1. **`deleteAccount` writes no `removed` event.** The purge removes the account's outbox rows in the
   same transaction, so an event about the deletion could not survive it. The contract's rule is
   "removal/purge" for a deletion and "removal tombstones" for a clear: the clear writes the
   tombstones and the `removed` events, the delete purges. The command keeps the plan's signature;
   the unused context is documented in the code.
2. **The bulk route's annotation actions keep their current un-transacted per-row writes.** They are
   annotation writes, not financial mutations; the plan and the detailed plan give them their own
   versioned source-change events in a later phase (Phase 14). This phase changed the delete path
   only.
3. **The non-transactional settings readers and writers now delegate to their in-transaction
   twins** through the journal connection handle, instead of repeating their statements. Drizzle's
   better-sqlite3 driver runs every statement on one connection, so the semantics are unchanged and
   there is one implementation of them.
4. **`apps/web/src/server/intelligence/infrastructure/retention.ts` is created in this phase.** The
   detailed plan names that file in Task 13 (Phase 20) but requires the account purge to be
   integrated in Task 5 (this phase). It holds the account purge only; Phase 20 extends it with the
   retention pruning and the backup procedure.
5. **The AI model's setting key.** The route passes the effective provider it already resolved
   (`body.aiProvider ?? getAiProvider()`) as `aiModelProvider`; the command falls back to the
   stored provider and then to Anthropic. The route's "OpenAI-only setup" fallback is not
   reproduced inside the transaction, because the route resolves it before the command runs.
6. **Two transfer refusals instead of one generic message.** A move whose fills merge with what the
   destination holds is refused with "The moved history merges with fills the destination account
   already holds. Move or delete those fills first, or choose a different destination account."; a
   move whose identity cannot be matched is refused with "The moved trade could not be matched to
   its history in the destination account. Nothing was changed." Both are `requireValue` failures
   inside the transaction, so the route answers 400 and nothing was written.

**Defect found and fixed inside the phase.** A move into an account that already held an identical
fill tripped the unique index over `(account_id, content_hash)` and answered 500. The command now
detects the collision before the move and refuses it with an actionable message
(`apps/web/tests/trade-mutation-commands.test.ts` and
`apps/web/tests/account-mutation-routes.test.ts` cover it). The transaction rolled back in the
broken case as well, so no data was ever at risk.

**Unresolved risks.**

- **The write lock of a multiplier change grows with the journal.** A multiplier change rebuilds
  every account inside one transaction, as the contract requires ("setting and all affected
  reconciliations atomic"). The contract review keeps large-account rebuilding synchronous and
  defers the measurement to the release gate (Phase 21, T-021's 1k/10k/100k benchmark). This does
  not block Phase 08; it is a release gate.
- **A transfer is refused when the moved fills merge with the destination's.** This is the
  conservative reading of "may retain identity only when a unique full execution-membership match
  is established": the user must move or delete the conflicting fills first. It is deliberate, and
  it is what keeps an annotation from being attached to the wrong trade.
- **The purge covers the intelligence that exists today.** The observation tables arrive with
  migration 0004 in Phase 08, and the purge must be extended to them; the knowledge, workflow and
  opportunity tables arrive in Phases 14–17. Until then, deleting an account removes its events,
  deliveries, jobs and evidence, and the tables that do not exist yet cannot leak.
- **A queued `seed_account` job for a deleted account is not cancelled by this phase's purge.** The
  purge finds the account's work through the outbox's account column and deliberately does not parse
  job payloads. Phase 09 owns the seed job and must make it tolerate a missing account.

## 6. Next-phase handoff (Phase 08)

Required inputs, none of them started here:

1. `reconcileAccountInTx` now takes an optional fourth argument, `ReconcileOptions`. Phase 08's
   evidence work must keep the three-argument call sites working and must not lose the transfer
   hints when it changes the reconciliation.
2. `purgeAccountIntelligence(tx, accountId)` must be extended to the observation tables that
   migration 0004 adds, so that deleting an account still purges everything the account owns.
3. `execution_evidence` exists and is written by nothing yet; Phase 08 owns the first writer. The
   account deletion already removes those rows, so the new writer only has to keep filling them.
4. The event capture switch (`JOURNAL_EVENT_CAPTURE`) is still off in production and the phase
   guide keeps it off through Phase 09; the historical baseline and the seed checkpoint are Phase
   09's precondition for enabling it.
5. The trade-key format, the execution hashes and the annotations are unchanged, so Phase 08's
   evidence sidecar must not touch them.

**Not started here:** Phase 08's observations and evidence quality, Phase 09's seed and replay,
Phase 18's interaction APIs, Phase 20's retention and backup. The coordinator owns the merge of
this phase into `codex/ai-native-journal` and the integration report.
