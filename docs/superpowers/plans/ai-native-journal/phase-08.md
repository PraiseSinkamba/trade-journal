# Phase 08 — Factual observations and explicit cTrader evidence quality

> **For agentic workers:** implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> Implement only this phase. Do not begin Phase 09.

**Goal:** The journal keeps **facts**, not conclusions. A trade projection becomes a persistent
**observation** — a derived, factual statement about a trade that the journal can supersede,
invalidate and never silently revive. Alongside it, the source quality of every cTrader fill is
**explicit**: the journal says whether a fill's time was reported by the source, reconstructed from
other source records, or unknown. The quality is resolved **before** the projection fingerprint is
computed, so a projection never gains a revision and a domain event because the journal learned
something it already knew.

**Architecture:** Phase 03 shipped the projection identity chain and the `execution_evidence`
sidecar. Phase 04 shipped the outbox, the durable jobs and the fenced worker. Phase 05–07 shipped
the one-transaction reconciliation and every mutation path. Phase 08 adds three things and changes
exactly two existing behaviours:

1. **A pure evaluator** (`evaluateTradeProjection`) that turns an immutable projection revision into
   a factual observation, or into an explicit refusal.
2. **A fenced persistence path** (`persistObservationInTx`) that stores the observation, supersedes
   or invalidates it against the **current** revision, and acknowledges the job and the delivery in
   **one** transaction.
3. **Explicit source quality for cTrader** (`classifyExecutionEvidence`): the cTrader sync
   classifies each fill it produces and writes the `execution_evidence` sidecar row **before** the
   reconciliation fingerprints the projection.

The ordering is the heart of this phase:

```
fetch / parse (outside the transaction)
   → classify the source quality of every fill
   → ONE immediate transaction:
        insert the fills
        write the execution_evidence rows          ← the quality lands here
        reconcile → fingerprint → revision + event  ← the fingerprint sees the quality
   → later, in a job:
        read the immutable revision
        evaluate the observation
        persist it against the CURRENT revision (fence)
```

If the quality were resolved _after_ the fingerprint, the fingerprint would change and the journal
would manufacture a spurious revision and a spurious domain event. The quality therefore reaches
reconciliation **before** the fingerprint is computed, inside the same transaction.

**Tech Stack:** existing TypeScript (strict, `noUncheckedIndexedAccess`), Next.js 15, Drizzle +
better-sqlite3, Zod, Vitest. **No new dependency.** **Schema allocation: 0004**
(`intelligence_observations`, `observation_evidence`, `intelligence_seed_checkpoints`).

**Authoritative references:** phase guide Phase 08
(`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), detailed plan Task 6 + the
observation part of Task 2 (`docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md`),
design §7/§9 (`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-design.md`),
contract review §2–§6 (`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md`),
ADR 0006, ADR 0007, ADR 0008.

**Base SHA (the merged Phase 07 work this phase builds on):**
`259c89441d4689bfb888b03196dad6113e1e70b4` (feature HEAD after the T-007 integration).

---

## Global constraints

- **Schema allocation: 0004 only.** One new forward migration. `0001`, `0002` and `0003` are not
  edited, renumbered or deleted. The registry, the checksum artifact, the typed schema and the
  final-schema snapshot change together.
- **No new dependency** → no ADR change, no manifest change, no lockfile change.
- **No network call, promise or provider call inside a write transaction.** The cTrader history and
  deal fetches stay outside the transaction; the classification happens outside it too.
- **Preserve** execution hashes, derived trade keys, annotations, cTrader sync, all three AI
  provider categories, encrypted credentials and every import/AI response contract. The public
  `insertExecutions`, `rebuildAccount` and `SyncOutcome` keep their signatures and results. The
  trade-key format is not touched. The cTrader import metadata is **not** changed: the quality
  lives in the `execution_evidence` sidecar, never in the metadata and never in a hash.
- **Production event capture stays off.** One global switch (`JOURNAL_EVENT_CAPTURE`), never a
  per-path switch. The tests turn it on explicitly.
- **No model-driven financial write.** The evaluator is deterministic and pure.
- **Node ≥ 22, pnpm 11.0.8, frozen lockfile.** `pnpm install` is already done; do not reinstall.
- Disposable absolute `JOURNAL_DATA_DIR` and scratch DB files under the OS temp dir. Never use
  ports 3000/3001. Never touch live trader data.

---

## The contracts (fixed by this plan)

The names, the parameters and the behaviour below are fixed. A writer that needs a different shape
changes this plan first.

### 1. The observation contract — `apps/web/src/server/intelligence/contracts/observations.ts`

Pure. No database, no driver, no Next.

```ts
import { z } from "zod";
import type { TimingQuality } from "@/server/trading/projection";

/** The lifecycle of a stored observation. */
export type ObservationStatus = "active" | "superseded" | "invalidated";

/** How the identity of the observed trade was resolved. */
export type IdentityResolution = "exact_key" | "explicit_transfer" | "new" | "ambiguous";

/** The factual evidence of one immutable projection revision. */
export interface TradeProjectionEvidence {
  readonly revisionId: string;
  readonly tradeId: string;
  readonly revision: number;
  readonly accountId: string;
  readonly tradeKey: string;
  readonly currency: string;
  readonly status: "open" | "win" | "loss" | "breakeven";
  readonly netPnl: number;
  readonly fees: number;
  readonly openQuantity: number;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly timingQuality: TimingQuality;
  readonly durationMs: number | null;
  readonly identityResolution: IdentityResolution;
}

/** What the evaluator concluded about a projection. */
export type ObservationResult =
  | { readonly kind: "trade_projection"; readonly evidence: TradeProjectionEvidence }
  | {
      readonly kind: "insufficient_evidence";
      readonly reason: "ambiguous_identity" | "source_removed";
    };

/** The evaluator that owns every observation this phase writes. */
export const OBSERVATION_EVALUATOR_ID = "trade.projection-observed";
export const OBSERVATION_EVALUATOR_VERSION = "1";
/** The type of every observation this phase writes. */
export const OBSERVATION_TYPE = "trade_projection";

/** Strict schemas for both payloads. */
export const tradeProjectionEvidenceSchema: z.ZodType<TradeProjectionEvidence>;
export const observationResultSchema: z.ZodType<ObservationResult>;

/**
 * The pure evaluator.
 *
 * An ambiguous identity is never observed: the journal does not know which trade it is
 * talking about, so it states that instead of guessing. A source-reported timing keeps its
 * duration; a reconstructed or unknown timing stores a null duration, because a duration the
 * source never stated is not a fact.
 */
export const evaluateTradeProjection = (
  source: TradeProjectionEvidence,
): ObservationResult;
```

The evaluator is the only place the duration rule lives:

- `timingQuality === "source_reported"` → the duration is kept.
- `timingQuality === "reconstructed" | "unknown"` → `durationMs` is `null`. The quality value is
  the explicit reason there is no duration.

### 2. The evidence classifier — `apps/web/src/server/trading/projection.ts`

The trading projection module owns the quality vocabulary; it stays pure.

```ts
/** The id prefix a source uses for a fill the journal invented. */
export const SYNTHETIC_EXECUTION_ID_PREFIX = "synthetic:open:";

/** Whether an id marks a fill the journal invented rather than a source record. */
export const isSyntheticExecutionId = (id: string | null | undefined): boolean;

/** What the source can prove about one fill. */
export interface ExecutionEvidenceContext {
  /** The source the fill came from, e.g. `ctrader_deal`. */
  readonly sourceKind: string;
  /** The source stated the fill's own time. */
  readonly sourceReportedTime: boolean;
  /** The fill's time was derived from other records of the same source. */
  readonly reconstructedTime: boolean;
  /** The fill is a placeholder the journal invented, not a source record. */
  readonly synthetic: boolean;
}

/** The fill the classifier judges. */
export interface ExecutionEvidenceFill {
  /** The source's own id of the fill. */
  readonly sourceId?: string | null;
}

/** The classification of one fill. */
export interface ClassifiedExecutionEvidence {
  readonly timingQuality: TimingQuality;
  readonly sourceKind: string;
}

/**
 * Classifies the timing evidence of one fill.
 *
 * The rules, in order:
 * 1. a synthetic fill is never `source_reported`. It is `reconstructed` when the source's own
 *    records supplied the time, and `unknown` otherwise;
 * 2. a fill whose time was derived from other source records is `reconstructed`;
 * 3. a fill whose own time the source stated is `source_reported`;
 * 4. anything else is `unknown`.
 *
 * The classifier never looks at a duration: a synthetic entry with a zero duration and a synthetic
 * entry with a nonzero duration are classified the same way, so a nonzero duration can never
 * upgrade a synthetic entry into source-reported timing.
 */
export const classifyExecutionEvidence = (
  fill: ExecutionEvidenceFill,
  context: ExecutionEvidenceContext,
): ClassifiedExecutionEvidence;
```

### 3. The persistence contract — `apps/web/src/server/intelligence/infrastructure/knowledge-store.ts`

```ts
/**
 * Persists the observation of one trade change, in the caller's transaction.
 *
 * The current-revision check happens INSIDE this transaction, never before it: a worker that
 * read the revision outside the transaction may act on a revision that is no longer current.
 *
 * - a stale source (the event names a revision that is no longer the current one) cancels the
 *   output: nothing is written;
 * - a removed source invalidates the active observation of that trade;
 * - a deleted account cancels the output: nothing is written;
 * - an insufficient result writes nothing.
 */
export const persistObservationInTx = (
  tx: JournalTx,
  claim: JobClaim,
  event: TradeChanged,
  result: ObservationResult,
  now: number,
): void;
```

`persistObservationInTx` writes:

- `intelligence_observations` — one row per (subject, source revision, evaluator, version, type).
  The unique key makes a repeated delivery idempotent: one observation, one evidence link.
- `observation_evidence` — the link from the observation to the projection revision it was derived
  from. The primary key `(observation_id, revision_id)` makes the link idempotent too.

A newly stored observation supersedes the **other** active observations of the same subject for
the same evaluator (`source_revision` is not the new one). It never supersedes itself, so a repeated
delivery leaves the observation active.

### 4. The composition — `apps/web/src/server/intelligence/composition.ts`

```ts
/** The handler that subscribes to the outbox. */
export const OBSERVATION_HANDLER_ID = "trade-observation";
export const OBSERVATION_HANDLER_VERSION = "1";

/**
 * Creates the job handler that turns a committed trade change into a persistent observation.
 */
export const createTradeObservationHandler = (
  deps?: { readonly clock?: () => number },
): JobHandler;

/** Every handler this phase registers with the worker and the outbox. */
export const observationHandlers: readonly JobHandler[];
export const observationOutboxHandlers: readonly OutboxHandler[];
```

The handler, inside the worker's transaction:

1. reads the domain event the job names and parses it with `parseTradeChanged`;
2. for a `removed` event it calls `persistObservationInTx` with
   `{ kind: "insufficient_evidence", reason: "source_removed" }` — the removal invalidates;
3. otherwise it reads the projection revision the event names. A missing revision is a
   `source_removed` result;
4. it builds the `TradeProjectionEvidence` from the revision and its snapshot, calls
   `evaluateTradeProjection` and calls `persistObservationInTx`.

The evidence is built from the **immutable revision**, never from whatever the trade happens to be
now. `status` is the snapshot's trade status mapped to the observation's union; `durationMs` comes
from the snapshot and is nulled by the evaluator when the timing is not source-reported.

### 5. The quality hook — `apps/web/src/server/executions.ts`

```ts
/** The source quality of one fill. */
export interface ExecutionSourceQuality {
  readonly timingQuality: TimingQuality;
  readonly sourceKind: string;
}

/**
 * `insertExecutionsInTx` gains one optional option:
 *
 *   quality?: (row: ImportedExecution) => ExecutionSourceQuality | null;
 *
 * It is called for every usable row **after** the fill is stored and **before** the
 * reconciliation runs, so the projection fingerprint sees the resolved quality. The sidecar row
 * is written idempotently and never downgrades a known quality: an `unknown` quality is
 * upgraded to a known one, a known quality is kept.
 */
```

The public `insertExecutions` keeps its signature; the option is additive and defaults to `undefined`
(no behaviour change for the paths that do not use it).

### 6. The quality derivation — `apps/web/src/server/trading/reconcile.ts`

The reconciliation stops asserting `source_reported` for every fill. It derives the quality of a
projection and compares it with the quality the journal last recorded.

- **Derived quality**: the weakest quality among the projection's fills. `unknown` wins over
  `reconstructed`, which wins over `source_reported`. A fill with an `execution_evidence` row uses
  that row's quality. A fill without one is `unknown` when the journal invented it (its import
  metadata id starts with `synthetic:open:`) and `source_reported` otherwise — the assumption the
  journal already made for every ordinary source fill.
- **Recorded quality**: the `timingQuality` of the identity's current revision snapshot. It is the
  quality the journal actually recorded, so a quality upgrade produces a new revision (a quality
  change is a change of the facts) and an unchanged quality produces none.

The comparison is therefore _recorded against derived_: an unchanged projection still compares
equal, and a corrected quality creates exactly one revision — never two.

---

## The schema (migration 0004)

`apps/web/src/db/migrations/0004-observations.ts` creates three tables. The DDL is shared with the
final-schema snapshot in `apps/web/src/db/bootstrap.ts`, so a migrated journal and the declared
schema cannot drift.

```sql
CREATE TABLE IF NOT EXISTS intelligence_observations (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  evaluator_id TEXT NOT NULL,
  evaluator_version TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'invalidated')),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  net_pnl REAL NOT NULL,
  fees REAL NOT NULL,
  trade_status TEXT NOT NULL CHECK (trade_status IN ('open', 'win', 'loss', 'breakeven')),
  timing_quality TEXT NOT NULL CHECK (timing_quality IN ('source_reported', 'reconstructed', 'unknown')),
  duration_ms INTEGER,
  direct_facts_json TEXT NOT NULL,
  observation_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_observations_subject_unique
  ON intelligence_observations (subject_id, source_revision, evaluator_id, evaluator_version, type);
CREATE INDEX IF NOT EXISTS intelligence_observations_subject_status_idx
  ON intelligence_observations (subject_id, status);

CREATE TABLE IF NOT EXISTS observation_evidence (
  observation_id TEXT NOT NULL REFERENCES intelligence_observations(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  PRIMARY KEY (observation_id, revision_id)
);
CREATE INDEX IF NOT EXISTS observation_evidence_revision_idx ON observation_evidence (revision_id);

CREATE TABLE IF NOT EXISTS intelligence_seed_checkpoints (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'suppressed')),
  last_trade_key TEXT,
  baseline_operation_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- The unique key is _subject / source revision / evaluator / evaluator version / type_ — the phase
  guide's minimum, which is also what makes a repeated delivery idempotent.
- `subject_id` is the trade identity id. It carries no foreign key: an observation outlives the
  identity it observed, exactly like the execution membership does.
- `direct_facts_json` holds the **direct fact** — the projection revision's snapshot, verbatim.
  `observation_json` holds the **derived observation** — what the evaluator concluded. The two are
  stored separately and are never merged into one blob.
- `intelligence_seed_checkpoints` is created here (phase guide allocation) and consumed by Phase 09.
  This phase writes no checkpoint.

---

## Tasks

### T-08.1 — The schema (migration 0004)

**Target:** `apps/web/src/db/migrations/0004-observations.ts` (create),
`apps/web/src/db/schema.ts` (modify), `apps/web/src/db/bootstrap.ts` (modify),
`apps/web/src/db/migrations.ts` (modify), `apps/web/src/db/migration-checksums.json` (regenerate).

- [ ] Create the migration with the DDL above and register it in the registry **after** 0003.
- [ ] Mirror the tables in the typed schema (`intelligenceObservations`, `observationEvidence`,
      `intelligenceSeedCheckpoints`) and in the final-schema snapshot.
- [ ] Regenerate the checksum artifact with `pnpm --filter web migrations:build`.
- [ ] Extend `apps/web/tests/intelligence-migrations.test.ts` with a journal from the previous
      phase (ledger at version 3) that is upgraded onto the observation schema, and with the
      fresh-versus-upgraded equivalence the runner already checks.

### T-08.2 — The classifier and the cTrader quality path

**Target:** `apps/web/src/server/trading/projection.ts` (modify),
`apps/web/src/server/ctrader-mcp/deals.ts` (modify), `apps/web/src/server/ctrader-mcp/sync.ts`
(modify).
**Tests:** `apps/web/tests/ctrader-mcp/deals.test.ts` (modify),
`apps/web/tests/ctrader-mcp/sync.test.ts` (modify).

- [ ] Add the classifier to the trading projection module, exactly as the contract above.
- [ ] The cTrader mapper marks the synthetic opening fill it invents, so the sync knows which
      fills are synthetic. The **import metadata and the execution hash do not change**.
- [ ] The cTrader sync classifies every fill it produces:
  - a real deal → `source_reported`, source kind `ctrader_deal`;
  - a synthetic opening fill whose time came from the order history → `reconstructed`, source
    kind `ctrader_synthetic_open`;
  - a synthetic opening fill without a recovered opening time → `unknown`, source kind
    `ctrader_synthetic_open`.
- [ ] The sync passes the classifications to `insertExecutionsInTx` through the `quality` option, so
      the sidecar rows are written before the reconciliation fingerprints the projection.

### T-08.3 — The quality derivation and the ingestion hook

**Target:** `apps/web/src/server/trading/reconcile.ts` (modify),
`apps/web/src/server/executions.ts` (modify).

- [ ] Add the `quality` option to `insertExecutionsInTx`, exactly as the contract above. The
      sidecar row is written after the fill is stored and before the reconciliation, and it never
      downgrades a known quality.
- [ ] Replace the hardcoded `source_reported` in `reconcile.ts` with the derived quality of the
      projection's fills, and compare it with the quality the journal last recorded.

### T-08.4 — The evaluator, the store and the composition

**Target:** `apps/web/src/server/intelligence/contracts/observations.ts` (create),
`apps/web/src/server/intelligence/infrastructure/knowledge-store.ts` (create),
`apps/web/src/server/intelligence/composition.ts` (create),
`apps/web/src/server/intelligence/infrastructure/retention.ts` (modify).

- [ ] Create the pure contracts and the evaluator.
- [ ] Create the store: the current-revision fence inside the transaction, the idempotent
      insert, the supersede, the invalidation and the refusals.
- [ ] Create the composition: the handler, the outbox subscription.
- [ ] Extend `purgeAccountIntelligence` with the observation tables: the observations of the
      account's trades are removed, and the seed checkpoints of the account go with it.

### T-08.5 — The observation suite

**Target:** `apps/web/tests/intelligence-observations.test.ts` (create).

Every case below is exit evidence.

| Case                        | Expected                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------- |
| A duplicate delivery        | Exactly one observation and exactly one evidence link.                                  |
| A correction                | The earlier observation is superseded; the new one is active.                           |
| A removal                   | The active observation is invalidated; no new observation is written.                   |
| A reversed event order      | The old event cannot revive the old truth: it is refused by the current-revision fence. |
| A synthetic entry           | Never source-reported timing, with either a zero or a nonzero duration.                 |
| A legacy quality            | Stays unknown; it is never guessed from a duration.                                     |
| A stale or cancelled source | No observation is written.                                                              |
| A deleted account           | No observation is written.                                                              |

---

## Writer split (recorded before any implementation)

The children are omp task agents inside this phase. They share **one** worktree. Each child owns at
most **three** files. No child commits, and no child runs a shared build, a formatter, a migration
or the full test suite — the orchestrator does that at the consolidation barrier.

| Child (omp task agent) | Tasks  | Owned files (exclusive)                                                                                                                                                                 |
| ---------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QualityPath`          | T-08.2 | `apps/web/src/server/trading/projection.ts`, `apps/web/src/server/ctrader-mcp/deals.ts`, `apps/web/src/server/ctrader-mcp/sync.ts`                                                      |
| `ObservationStore`     | T-08.4 | `apps/web/src/server/intelligence/infrastructure/knowledge-store.ts`, `apps/web/src/server/intelligence/composition.ts`, `apps/web/src/server/intelligence/infrastructure/retention.ts` |
| `QualityDerivation`    | T-08.3 | `apps/web/src/server/trading/reconcile.ts`, `apps/web/src/server/executions.ts`, `apps/web/tests/ctrader-mcp/sync.test.ts`                                                              |
| `ObservationSuite`     | T-08.5 | `apps/web/tests/intelligence-observations.test.ts`, `apps/web/tests/ctrader-mcp/deals.test.ts`                                                                                          |

The orchestrator owns the shared files: the migration, the typed schema, the snapshot, the registry,
the checksum artifact, the observation contracts, the migration tests and both documents.

- **Interface SHA:** `259c89441d4689bfb888b03196dad6113e1e70b4` plus this plan and the committed
  observation contract. The children code against the signatures in this plan; a child that cannot
  live with a signature reports it instead of changing the contract.
- **Dependencies:** every child depends on the committed contract, not on a sibling's file. The
  `QualityPath` child needs the `quality` option of `insertExecutionsInTx`, which this plan fixes.
- **Merge order:** the orchestrator's own files land first (the schema and the contracts), then the
  four children in one wave, then the consolidation barrier.

### Deviations from the packet's file list (recorded deliberately)

The packet's file list refines the scope, but the coordinator's ordering requirement — _the quality
must reach reconciliation before the fingerprint_ — cannot be met without two surgical changes to
Phase 05 files. Both are additive and behaviour-preserving for every path that does not use the new
option:

- `apps/web/src/server/trading/reconcile.ts` — the hardcoded `source_reported` becomes the derived
  quality, compared against the recorded quality.
- `apps/web/src/server/executions.ts` — one optional `quality` option on `insertExecutionsInTx`.

Both are recorded in the phase report.

---

## Execution order

```
commit plan → orchestrator writes the schema + the contracts → children write in one wave → consolidation barrier → gates → review → report
```

0. **Commit this plan first**:
   `git add docs/superpowers/plans/ai-native-journal/phase-08.md && git commit -m "docs: add Phase 08 observation plan"`.
1. The orchestrator writes the migration, the typed schema, the snapshot, the registry, the checksum
   artifact and the observation contracts, and commits them.
2. The four children write their files in one wave.
3. The orchestrator inspects the diff, resolves the contract drift, and runs the gates.
4. The orchestrator commits the implementation and writes the phase report.

---

## Verification (record exact output in the phase report)

```bash
pnpm exec vitest run apps/web/tests/intelligence-observations.test.ts
pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/intelligence-outbox.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-worker.test.ts apps/web/tests/trade-projection-identity.test.ts
pnpm exec vitest run apps/web/tests/ctrader-mcp/deals.test.ts apps/web/tests/ctrader-mcp/sync.test.ts apps/web/tests/trade-reconciliation.test.ts apps/web/tests/execution-storage.test.ts apps/web/tests/sync-resilience.test.ts
pnpm --filter web typecheck
pnpm exec prettier --check <every file this phase touched>
node scripts/check-licenses.mjs
pnpm --filter web migrations:check
pnpm test
```

The **root** `pnpm typecheck` is not this phase's gate: it fails in the `desktop` workspace on a
pre-existing tooling defect (RC2175) that is outside this phase's ownership.

---

## Stop condition

Phase 08 is done when **all** of the following hold.

**Implementation and tests**

- [ ] Every task above is implemented against the contracts above.
- [ ] `apps/web/tests/intelligence-observations.test.ts` passes, with every case of the observation
      suite covered.
- [ ] A duplicate delivery writes one observation and one evidence link; a correction supersedes; a
      removal invalidates; a reversed event order cannot revive the old truth.
- [ ] A synthetic entry never carries source-reported timing, with either a zero or a nonzero
      duration; a legacy quality stays unknown.
- [ ] The cTrader quality reaches the fingerprint before it is computed: one quality change
      produces exactly one revision and one event, never two.
- [ ] The observation tables are purged with the account.
- [ ] `pnpm --filter web typecheck` passes.
- [ ] `pnpm exec prettier --check` reports no violation in the files this phase touched.
- [ ] `node scripts/check-licenses.mjs` reports OK (no new dependency).
- [ ] `pnpm --filter web migrations:check` exits 0.
- [ ] `pnpm test` passes.

**Review**

- [ ] A fresh spec-compliance and code-quality review of this phase's diff has run, and every
      Critical or Important finding is fixed.
- [ ] The repo's reviewer gate is satisfied: `.omp/reviewer-report.md` records this phase's verdict
      as `## Verdict: PASS`.

**Report**

- [ ] `docs/superpowers/reports/ai-native-journal-phase-08.md` is written and committed, with the
      six items the phase guide requires.
- [ ] The report states the base SHA and the tip SHA of this phase's commits.

**Not in this phase**

- Phase 09's historical seed and replay (the checkpoint table is created here and written there),
  Phase 12's capability contracts, Phase 14's knowledge sources, Phase 18's interaction APIs and
  Phase 20's retention and backup.
