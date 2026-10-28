# Phase 08 — Factual observations and explicit cTrader evidence quality

## 1. Phase, scope and baseline

|                       |                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Phase                 | 08 — Factual observations and explicit cTrader evidence quality (milestone M3, wave 8)                                           |
| Packet                | `docs/orchestration/ai-native-journal/tasks/T-008.md` (stable id T-008)                                                          |
| Base SHA              | `259c89441d4689bfb888b03196dad6113e1e70b4` — the feature HEAD after the Phase 07 integration                                     |
| Plan commit           | `27dd6f7` — `docs: add Phase 08 observation plan`                                                                                |
| Schema commit         | `392461d` — `feat: add the observation storage schema and the observation contract`                                              |
| Implementation commit | see §6                                                                                                                           |
| Branch                | `codex/ai-native-journal-p08`                                                                                                    |
| Destination           | `codex/ai-native-journal`, local non-fast-forward merge only — **not** performed here; the coordinator owns the integration lock |

**Scope completed.** The journal now keeps facts, not conclusions: a trade projection becomes a
persistent observation that it can supersede, invalidate and never silently revive; and the source
quality of every cTrader fill is explicit — source-reported, reconstructed or unknown — resolved
**before** the projection fingerprint is computed.

**Scope left.** None of this phase's scope is outstanding. Phase 09 (historical seed and replay),
Phase 12 (capability contracts), Phase 14 (knowledge sources), Phase 18 (interaction APIs) and
Phase 20 (retention and backup) are untouched and remain out of scope.

**Note for the coordinator.** This phase was completed by a worker whose dispatch was revoked by
the orchestration recovery ("the assigned worker terminal is no longer live") before it could send
its `worker_done`. The work, the verification and this report are complete and committed on
`codex/ai-native-journal-p08`; the dispatch was left untouched, so no completion message was sent
from the revoked attempt. The three phase commits above are the whole phase.

## 2. Changed files and exported interfaces

| File                                                                       | Change                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/db/migrations/0004-observations.ts` (new)                    | Migration 0004: `intelligence_observations`, `observation_evidence`, `intelligence_seed_checkpoints`.                                                                                                                                                                      |
| `apps/web/src/db/schema.ts`                                                | The typed Drizzle tables `intelligenceObservations`, `observationEvidence`, `intelligenceSeedCheckpoints`.                                                                                                                                                                 |
| `apps/web/src/db/bootstrap.ts`                                             | The final-schema snapshot carries the same DDL, so a migrated and a fresh journal cannot drift.                                                                                                                                                                            |
| `apps/web/src/db/migrations.ts`                                            | Migration 0004 registered after 0003.                                                                                                                                                                                                                                      |
| `apps/web/src/db/migration-checksums.json`                                 | Regenerated with `pnpm --filter web migrations:build`.                                                                                                                                                                                                                     |
| `apps/web/src/server/intelligence/contracts/observations.ts` (new)         | The observation contract: `TradeProjectionEvidence`, `ObservationResult`, `evaluateTradeProjection`, `OBSERVATION_EVALUATOR_ID` (`trade.projection-observed`), `OBSERVATION_EVALUATOR_VERSION` (`1`), `OBSERVATION_TYPE` (`trade_projection`), and the strict Zod schemas. |
| `apps/web/src/server/intelligence/infrastructure/knowledge-store.ts` (new) | `persistObservationInTx(tx, claim, event, result, now)` — the current-revision fence, the idempotent insert, the supersede, the invalidation and the refusals.                                                                                                             |
| `apps/web/src/server/intelligence/composition.ts` (new)                    | `createTradeObservationHandler`, `observationHandlers`, `observationOutboxHandlers`, `OBSERVATION_HANDLER_ID` (`trade-observation`), `OBSERVATION_HANDLER_VERSION` (`1`). The single wiring point of the observation path.                                                 |
| `apps/web/src/server/intelligence/infrastructure/retention.ts`             | The account purge also removes the account's observations and its seed checkpoint.                                                                                                                                                                                         |
| `apps/web/src/server/trading/projection.ts`                                | `SYNTHETIC_EXECUTION_ID_PREFIX`, `isSyntheticExecutionId`, `ExecutionEvidenceContext`, `ExecutionEvidenceFill`, `ClassifiedExecutionEvidence`, `classifyExecutionEvidence`.                                                                                                |
| `apps/web/src/server/trading/reconcile.ts`                                 | The hardcoded `source_reported` becomes the **derived** quality of the projection's fills, compared against the quality the journal **recorded**.                                                                                                                          |
| `apps/web/src/server/executions.ts`                                        | `ExecutionSourceQuality` and one optional `quality` option on `insertExecutionsInTx`: the sidecar row is written inside the transaction, before the reconciliation, and a changed quality reconciles even when no fill was inserted.                                       |
| `apps/web/src/server/ctrader-mcp/deals.ts`                                 | The synthetic opening fill's id is built from the shared `SYNTHETIC_EXECUTION_ID_PREFIX` instead of a literal. The id format itself is byte-identical.                                                                                                                     |
| `apps/web/src/server/ctrader-mcp/sync.ts`                                  | Every produced fill is classified (`ctrader_deal` → source-reported, `ctrader_synthetic_open` → reconstructed or unknown) and handed to the ingestion seam through the `quality` option.                                                                                   |
| `apps/web/tests/intelligence-observations.test.ts` (new)                   | The observation suite: nine cases, one per exit-evidence row.                                                                                                                                                                                                              |
| `apps/web/tests/ctrader-mcp/deals.test.ts`                                 | The classifier cases.                                                                                                                                                                                                                                                      |
| `apps/web/tests/ctrader-mcp/sync.test.ts`                                  | The quality-reaches-the-fingerprint case.                                                                                                                                                                                                                                  |
| `apps/web/tests/intelligence-migrations.test.ts`                           | The upgrade from a version-3 journal onto the observation schema.                                                                                                                                                                                                          |
| `docs/superpowers/plans/ai-native-journal/phase-08.md`                     | The phase plan, committed before the implementation.                                                                                                                                                                                                                       |
| `.omp/reviewer-report.md`                                                  | The reviewer's verdict for this phase's diff.                                                                                                                                                                                                                              |

**Compatibility preserved.** No execution hash, import metadata, fee, price, quantity, timestamp,
trade key, annotation, credential, provider or import/AI response contract changed. The public
`insertExecutions`, `rebuildAccount`, `deleteExecutionsForTrades` and `SyncOutcome` keep their
signatures and results. The cTrader import metadata is untouched: the quality lives in the
`execution_evidence` sidecar, never in the metadata and never in a hash. The only additions to an
existing signature are optional: one `quality` option on `insertExecutionsInTx`.

**The ordering guarantee.** The source quality of a fill is resolved and written to the sidecar
_inside the same transaction_ and _before_ `reconcileAccountInTx` fingerprints the projection. If
the quality were resolved after the fingerprint, the fingerprint would change later and the journal
would manufacture a spurious revision and a spurious domain event. The regression test
`a quality the source proves later > corrects the projection and the observation exactly once`
proves it: a duplicate delivery whose quality is upgraded produces exactly one more revision, one
more committed event and one corrected observation, and a further identical delivery produces none.

## 3. Migration 0004 — tables, columns and indexes

`apps/web/src/db/migrations/0004-observations.ts` creates three tables. Forward-only and additive:
it creates new tables and never rewrites an existing one, so a legacy journal and a fresh journal
converge on the same schema. `0001`, `0002` and `0003` were not edited, renumbered or deleted.

**`intelligence_observations`**

| Column                      | Type    | Null | Notes                                                                                 |
| --------------------------- | ------- | ---- | ------------------------------------------------------------------------------------- |
| `id`                        | TEXT    | no   | Primary key.                                                                          |
| `subject_id`                | TEXT    | no   | The trade identity. No foreign key: an observation outlives the identity it observed. |
| `source_revision`           | TEXT    | no   | The projection revision the observation was derived from.                             |
| `evaluator_id`              | TEXT    | no   | `trade.projection-observed`.                                                          |
| `evaluator_version`         | TEXT    | no   | `1`.                                                                                  |
| `type`                      | TEXT    | no   | `trade_projection`.                                                                   |
| `status`                    | TEXT    | no   | CHECK `active \| superseded \| invalidated`.                                          |
| `account_id`                | TEXT    | no   | REFERENCES `accounts(id)` ON DELETE CASCADE.                                          |
| `currency`                  | TEXT    | no   |                                                                                       |
| `net_pnl`                   | REAL    | no   |                                                                                       |
| `fees`                      | REAL    | no   |                                                                                       |
| `trade_status`              | TEXT    | no   | CHECK `open \| win \| loss \| breakeven`.                                             |
| `timing_quality`            | TEXT    | no   | CHECK `source_reported \| reconstructed \| unknown`.                                  |
| `duration_ms`               | INTEGER | yes  | Null unless the timing is source-reported.                                            |
| `direct_facts_json`         | TEXT    | no   | The **direct fact**: the projection revision's snapshot, verbatim.                    |
| `observation_json`          | TEXT    | no   | The **derived observation**: what the evaluator concluded.                            |
| `recorded_at`, `updated_at` | INTEGER | no   | Epoch milliseconds.                                                                   |

Indexes: the unique key
`intelligence_observations_subject_unique (subject_id, source_revision, evaluator_id, evaluator_version, type)`
and the index `intelligence_observations_subject_status_idx (subject_id, status)`.

**`observation_evidence`** — `observation_id` (REFERENCES `intelligence_observations(id)` ON DELETE
CASCADE), `revision_id`, primary key `(observation_id, revision_id)`, index on `revision_id`.

**`intelligence_seed_checkpoints`** — `account_id` primary key (REFERENCES `accounts(id)` ON DELETE
CASCADE), `status` CHECK `pending | running | completed | suppressed`, `last_trade_key`,
`baseline_operation_id`, `updated_at`. Created with the phase allocation and consumed by Phase 09;
this phase writes no checkpoint.

**Upgrade results.** `apps/web/tests/intelligence-migrations.test.ts` covers the upgrade from a
version-3 journal (the ledger holds 0001–0003, the observation tables do not exist) onto the
observation schema, the fresh-versus-upgraded schema equivalence the runner already checks,
repeated startup as a no-op, injected failure rollback, concurrent startup on one fresh journal and
the byte-for-byte survival of credentials, hashes and annotations.

**Backup and rollback impact.** Additive only: three new tables, no column changed, no key, hash
or financial row rewritten. Rollback means deploying the prior binary with the new tables retained
(they are unused by it) or restoring the verified full backup; no destructive down migration
exists and none is needed. The observation rows are removed with their account, and the seed
checkpoint cascades with the account row.

## 4. Commands actually run

Every command ran in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal-p08` on Node
v24.20.0 / pnpm 11.0.8, against disposable scratch databases under the OS temp directory. No live
journal, no credentials and no port was touched.

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Result                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-observations.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **9 passed / 9**                                                                                            |
| `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-worker.test.ts apps/web/tests/trade-projection-identity.test.ts apps/web/tests/ctrader-mcp/deals.test.ts apps/web/tests/ctrader-mcp/sync.test.ts apps/web/tests/trade-reconciliation.test.ts apps/web/tests/execution-storage.test.ts apps/web/tests/sync-resilience.test.ts apps/web/tests/trade-mutation-events.test.ts apps/web/tests/intelligence-boundaries.test.ts` (13 files, one run) | **169 passed / 169**                                                                                        |
| `pnpm --filter web typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **clean** (`next typegen` + `tsc --noEmit`, no diagnostics)                                                 |
| `pnpm exec prettier --check <every file this phase touched>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **All matched files use Prettier code style!**                                                              |
| `node scripts/check-licenses.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Dependency licenses OK.**                                                                                 |
| `pnpm --filter web migrations:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **migration-checksums.json is up to date.**                                                                 |
| `pnpm test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **99 files passed / 1030 tests passed** (the run before the review fix passed 1029; the fix added one case) |
| `pnpm exec vitest run apps/web/tests/intelligence-observations.test.ts apps/web/tests/ctrader-mcp/sync.test.ts` (after the review fix)                                                                                                                                                                                                                                                                                                                                                                                                                                             | **9 + 13 passed**                                                                                           |

The **root** `pnpm typecheck` was not run as a gate: it fails in the `desktop` workspace on a
pre-existing tooling defect (RC2175) that is outside this phase's ownership. The web package
typecheck and the package filters are the gate here.

## 5. Review findings and resolutions

Two review runs were spent on this phase, as the coordinator allowed: one on the implementation
diff, one after the fix.

**Run 1 — `## Verdict: FAIL`, one Important finding.**

> `apps/web/src/server/executions.ts` — a duplicate ingestion can update an existing
> `execution_evidence` row from `unknown` to a known quality, but reconciliation is skipped
> whenever no execution row was inserted. The current projection revision therefore retains the
> old `timingQuality`, so the promised quality correction emits no revised projection/event and
> no corrected observation.

**Resolution.** `writeExecutionQualityInTx` now reports whether it changed the sidecar; the insert
loop accumulates that; the reconciliation runs when `inserted > 0 || qualityChanged`. A corrected
quality is a change of the projection's facts, so it is reconciled like any other change. The
regression test `a quality the source proves later > corrects the projection and the observation
exactly once` proves that a duplicate delivery whose quality is upgraded produces exactly one more
revision, one more committed event and one corrected observation, and that a further identical
delivery produces none.

**Run 2 — `## Verdict: PASS`.** No Critical or Important finding remained. The report is
`.omp/reviewer-report.md`.

Two nits raised by the implementation review were accepted as designed, not as defects: the
account check inside `persistObservationInTx` is defensive (the account's cascade removes the
identity first, so the identity check fires earlier — the observable outcome, "no observation is
written", is the same either way), and the store's `claim` parameter is part of the fixed contract
while the job and the delivery are acknowledged by the worker's effect store in the same
transaction.

## 6. Deviations, evidence and unresolved risks

**Deliberate deviations from the packet's file list.** The coordinator's ordering requirement —
_the quality must reach reconciliation before the fingerprint_ — cannot be met without two
surgical changes to Phase 05 files. Both are additive and behaviour-preserving for every path that
does not use the new option:

- `apps/web/src/server/trading/reconcile.ts` — the hardcoded `source_reported` becomes the derived
  quality, compared against the recorded quality.
- `apps/web/src/server/executions.ts` — one optional `quality` option on `insertExecutionsInTx`.

Both are recorded in the phase plan's "Deviations from the packet's file list" section.

**A pre-existing cTrader behaviour the phase does not change.** When the order history becomes
available after a first sync, the invented opening fill's timestamp changes, so its content hash
changes and the next sync inserts a second opening fill rather than replacing the first. That is
the cTrader sync's own behaviour from Phase 06, not something this phase introduced, and it is out
of scope here: this phase does not change the cTrader fill identity, the hash or the sync's
transaction boundary. The quality of every fill the sync produces is still classified and stored.

**Unresolved risks.**

- The recorded quality of a projection is read from the snapshot of the identity's current
  revision. A projection whose identity was never recorded falls back to `source_reported`, the
  assumption the journal already made for every ordinary source fill.
- A legacy cTrader synthetic projection is corrected from `source_reported` to `unknown` on its
  next reconciliation, because the review requires a legacy synthetic entry's quality to stay
  unknown. That correction is one revision and one event per affected projection, and it is a
  quality correction rather than a financial one.
- The worker that consumes the observation jobs is not started by this phase: the production
  capture and the worker stay off until the historical baseline exists (Phase 09). The observation
  path is proved by tests that drive the worker explicitly.

## 7. Next-phase handoff

Phase 09 needs, and does not yet have:

- **The seed checkpoint.** `intelligence_seed_checkpoints` exists and is empty. Phase 09 writes
  `account_id`, `status`, `last_trade_key`, `baseline_operation_id` and `updated_at`, and reads it
  under the same transaction as the per-account batch.
- **A base to seed from.** The journal has no durable baseline yet: the historical seed must
  reconcile the existing trades as a historical baseline, never as a live closure, and must skip
  already-mapped identities.
- **A replay command.** `requestReplay(eventId, handlerId, handlerVersion)` is an authenticated
  operational command, never a model tool. The observation handler is registered as
  `trade-observation` version `1`, so a replay reuses the same business dedup key and never mints
  a second effect.
- **The observation path it builds on.** `evaluateTradeProjection`, `persistObservationInTx` and
  `createTradeObservationHandler` are committed and proven; Phase 09 registers `seed_account`
  beside them in `apps/web/src/server/intelligence/composition.ts`.
- **The current-revision fence, unchanged.** A seed that runs against a revision that is no longer
  current writes no observation, exactly like a delayed event does.

## 8. Definition of done

- [x] Every task of the phase plan is implemented against the contracts it fixed.
- [x] The observation suite passes: nine cases, one per exit-evidence row.
- [x] A duplicate delivery writes one observation and one evidence link; a correction supersedes; a
      removal invalidates; a reversed event order cannot revive the old truth.
- [x] A synthetic entry never carries source-reported timing, with either a zero or a nonzero
      duration; a legacy quality stays unknown.
- [x] The cTrader quality reaches the fingerprint before it is computed; one quality change
      produces exactly one revision and one event.
- [x] The observation tables are purged with the account.
- [x] `pnpm --filter web typecheck` passes.
- [x] `pnpm exec prettier --check` reports no violation in the files this phase touched.
- [x] `node scripts/check-licenses.mjs` reports OK (no new dependency).
- [x] `pnpm --filter web migrations:check` exits 0.
- [x] `pnpm test` passes.
- [x] The reviewer's verdict for this phase's diff is `## Verdict: PASS`.
- [x] This report is committed.
- [x] The phase-only plan was committed before the implementation.
