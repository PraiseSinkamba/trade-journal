# Phase 03 — Projection identity, fingerprints and immutable revisions

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Implement only this phase. Do not begin Phase 04.

**Goal:** Give every journal trade a stable _immutable identity_ beside its rebuild-stable key, a
deterministic _fingerprint_ of its computed projection, and an append-only _revision history_ with
normalized execution membership — without touching the public key, the routes, or the financial
engine.

**Architecture:** `apps/web/src/server/trading/projection.ts` owns the pure canonicalization and
fingerprint of a computed rebuild row. `apps/web/src/server/trading/identity.ts` owns identity
resolution (exact key, proven transfer, ambiguity) and the immutable revision/membership writes.
Both work on the Phase 01 transaction seam (`JournalTx`) and the Phase 02 migration runner; the
new tables arrive as forward migration `0002-trade-projections.ts`. Nothing is wired to a route in
this phase: the modules are the seam that Phase 05 (reconciliation) will call.

**Tech Stack:** Existing TypeScript (strict, `noUncheckedIndexedAccess`), Next.js 15, Drizzle +
better-sqlite3, Vitest, Node `node:crypto`. **No new dependency.** Schema allocation: **0002**
only.

**Authoritative references:** phase guide Phase 03 (`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`),
detailed plan Task 3 (`docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md`),
design §6/§7/§9, contract review §2–§6, ADR 0006/0007/0008.

---

## Global constraints

- **Schema allocation: `0002-trade-projections.ts` only.** Tables: `trade_identities`,
  `trade_projection_revisions`, `trade_revision_executions`, `trade_identity_links`,
  `execution_evidence`. No outbox, job, observation, knowledge or workflow table.
- **Forward-only, immutable migrations.** Never edit, renumber or delete `0001-legacy-baseline.ts`.
  Append `0002`; regenerate `migration-checksums.json` with `pnpm --filter web migrations:build`.
- **No new dependency** → no ADR change, no manifest change, no lockfile change.
- **No route wiring.** Nothing in `apps/web/src/app/**` changes; no `rebuildAccount` call site
  changes; `trades.key` and every existing public response stay byte-identical.
- **Preserve** execution hashes, derived trade keys, annotations, cTrader sync, all three AI
  provider categories, encrypted credentials and every import/AI response contract.
- **No fuzzy identity matching.** No matching by symbol, time, P&L or shared execution overlap.
  Continuity needs the same active key or a proven, unique, full execution-membership match.
- **Ambiguity is never a guess.** An unresolved mapping returns candidate IDs and writes nothing.
- **No network call, promise or provider call inside a write transaction.**
- **Node ≥ 22, pnpm 11.0.8, frozen lockfile.** `pnpm install` is already done; do not reinstall.
- Disposable absolute `JOURNAL_DATA_DIR` and scratch DB files under the OS temp dir. Never use ports
  3000/3001. Never touch live trader data.

---

## Contracts (authoritative — implement exactly)

### `apps/web/src/server/trading/projection.ts`

```ts
export type TimingQuality = "source_reported" | "reconstructed" | "unknown";

export interface ProjectionInput {
  /* the computed rebuild row: accountId, key, symbol, assetClass, direction, status,
     openedAt, closedAt, quantity, openQuantity, avgEntry, avgExit, grossPnl, fees,
     netPnl, executionCount, executionIds, exits, durationMs */
  /* plus currency + timingQuality */
  /* plus optional annotations — accepted, never fingerprinted */
}

export declare function canonicalProjectionJson(input: ProjectionInput): string;
export declare function projectionSnapshotJson(input: ProjectionInput): string;
export declare function fingerprintProjection(input: ProjectionInput): string;
```

Fingerprint rules (contract review §4, verbatim intent):

- Fingerprint **every computed field currently persisted by rebuild**, including normalized exit
  attribution and execution membership; include evidence quality and currency where intelligence
  semantics change.
- **Exclude** labels, balance, notes, formatting, fetch timestamps and sync snapshots. Annotations
  are accepted on the input and never reach the fingerprint.
- **Canonicalize JSON ordering**: object keys sorted recursively, so the same logical projection
  hashes identically whatever order it was built in.
- Normalize membership (`executionIds` sorted) and exit attribution (sorted by `executionId`).
- Same fingerprint ⇒ no revision and no event.

`projectionSnapshotJson` is the **bounded** factual projection stored on a revision row: the
computed fields, currency and timing quality, **without** membership and exits (membership is
normalized into rows). Capped at 16 KiB; over the cap is an error, never a silent truncation.

### `apps/web/src/server/trading/identity.ts`

```ts
export type IdentityResolutionKind = "exact_key" | "explicit_transfer" | "new" | "ambiguous";

export interface IdentityInput {
  accountId: string;
  tradeKey: string;
  executionIds: readonly string[];
  operationId: string;
  explicitTransferSourceId?: string | null;
}

export type IdentityResolution =
  | Readonly<{ kind: "exact_key"; tradeId: string; nextRevision: number }>
  | Readonly<{ kind: "explicit_transfer"; tradeId: string; nextRevision: number }>
  | Readonly<{ kind: "new"; tradeId: string; nextRevision: number }>
  | Readonly<{ kind: "ambiguous"; candidateIds: readonly string[] }>;

export declare function resolveIdentity(tx: JournalTx, input: IdentityInput): IdentityResolution;
```

Resolution rules:

1. **Exact key** — an _active_ identity already maps this key: it keeps its ID
   (`kind: "exact_key"`, `nextRevision = revision + 1`).
2. **Proven explicit transfer** — the caller names `explicitTransferSourceId`; the source identity's
   _current_ execution membership must equal the projection's membership **exactly**, and no other
   identity in that account may share that membership. Then the identity is retained
   (`kind: "explicit_transfer"`). This is the only way an identity survives a key change.
3. **Ambiguity** — a claimed transfer that cannot be proven (membership differs, or more than one
   identity matches): return `kind: "ambiguous"` with the **candidate IDs** and **no** trade ID.
   A claimed transfer whose source shares no execution at all is an actionable conflict, not a
   silent fallback.
4. **New** — no active key mapping and no proven transfer: a fresh identity ID
   (`kind: "new"`, `nextRevision = 1`). Shared execution overlap is _never_ continuity: it only
   produces candidate evidence.

Supporting seams (same module):

```ts
export declare function recordProjectionRevision(tx, input): RecordedRevision;
export declare function recordIdentityLink(tx, input): void;
export declare function retireIdentity(tx, input): void;
```

- `recordProjectionRevision` appends the immutable revision row (fingerprint, bounded snapshot,
  resolution) plus normalized membership rows, and advances the identity's revision. It never
  updates a revision row.
- `recordIdentityLink` stores provenance between two identities (old → new, operation, reason).
- `retireIdentity` ends a mapping: the identity becomes `tombstoned` and its current key is
  released, so a later reappearance of the same key gets a **new** ID and old conclusions do not
  revive silently.

---

## Schema (migration 0002)

The DDL lives in `apps/web/src/db/migrations/0002-trade-projections.ts` as an exported constant and
is reused verbatim by the final-schema snapshot in `bootstrap.ts`, so the migrated schema and the
declared schema cannot drift.

| Table                        | Columns                                                                                                                                                                           | Keys / indexes                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `trade_identities`           | `id` PK, `account_id` → accounts (cascade), `current_key` (nullable), `revision`, `state` (`active`/`tombstoned`), `created_at`, `updated_at`                                     | unique `current_key` where not null; index `account_id` |
| `trade_projection_revisions` | `id` PK, `trade_id` → trade_identities (cascade), `account_id` → accounts (cascade), `revision`, `trade_key`, `fingerprint`, `resolution` (check), `snapshot_json`, `recorded_at` | unique `(trade_id, revision)`; index `account_id`       |
| `trade_revision_executions`  | `revision_id` → trade_projection_revisions (cascade), `execution_id`                                                                                                              | PK `(revision_id, execution_id)`; index `execution_id`  |
| `trade_identity_links`       | `old_id`, `new_id` → trade_identities (cascade), `operation_id`, `reason`, `recorded_at`                                                                                          | PK `(old_id, new_id, operation_id)`; index `new_id`     |
| `execution_evidence`         | `execution_id` PK, `timing_quality` (check), `source_kind`, `evidence_version`, `recorded_at`                                                                                     | —                                                       |

Column-level notes (the phase report repeats them):

- `trade_identities.current_key` is nullable: a retired identity releases its key, which is what
  makes "same key reappears ⇒ new ID" enforceable by the partial unique index.
- `trade_identities.revision` is the identity's latest revision number; revision rows are numbered
  from 1 and are unique per `(trade_id, revision)`.
- `trade_projection_revisions.trade_key` is the key the revision was computed for. It is needed to
  find the predecessor of a reappearing key and to read the evidence without parsing the snapshot.
- `trade_revision_executions.execution_id` has **no** FK to `executions`: membership evidence must
  survive ordinary source-fill deletion until an explicit purge.
- `execution_evidence` is a sidecar: it does not touch execution hashes or import metadata.
- All new operational timestamps are UTC epoch milliseconds (contract review §4).

---

## File ownership (exclusive — this phase has one implementation writer)

| Path                                                     | Action                                  |
| -------------------------------------------------------- | --------------------------------------- |
| `apps/web/src/server/trading/projection.ts`              | create                                  |
| `apps/web/src/server/trading/identity.ts`                | create                                  |
| `apps/web/tests/trade-projection-identity.test.ts`       | create                                  |
| `apps/web/src/db/migrations/0002-trade-projections.ts`   | create                                  |
| `apps/web/src/db/migrations.ts`                          | modify (registry append)                |
| `apps/web/src/db/migration-checksums.json`               | regenerate                              |
| `apps/web/src/db/schema.ts`                              | modify (typed mirror)                   |
| `apps/web/src/db/bootstrap.ts`                           | modify (final-schema snapshot)          |
| `apps/web/src/server/ids.ts`                             | modify (`newUuid` for durable entities) |
| `apps/web/tests/intelligence-migrations.test.ts`         | modify (registry-driven expectations)   |
| `apps/web/tests/db-concurrent-init.test.ts`              | modify (registry-driven expectations)   |
| `docs/superpowers/plans/ai-native-journal/phase-03.md`   | this file                               |
| `docs/superpowers/reports/ai-native-journal-phase-03.md` | phase report                            |

Read-only for this phase: `packages/**`, `apps/web/src/server/{rebuild,executions,sync,ai*}.ts`,
`apps/web/src/app/**`, `apps/web/src/db/{connection,transaction,index}.ts`,
`docs/decisions/**`, `.github/workflows/**`.

**Parallel candidate, conditional only.** The phase guide allows a split after the types are
committed. The coordinator has **not** committed an exact disjoint split (child IDs, paths,
interface SHA, dependencies, tests, merge order), so this phase runs with **one implementation
writer**. Reviews are read-only and may be delegated.

---

## Execution order

```
commit plan ─→ write the failing test file ─→ RED RUN (one command) ─→ implement ─→ GREEN RUN ─→ gates ─→ reviews ─→ report
```

0. **Commit this plan first**:
   `git add docs/superpowers/plans/ai-native-journal/phase-03.md && git commit -m "docs: add Phase 03 projection identity plan"`.
1. Write the failing test file. No production file is touched yet.
2. Run the single red command and record its output as the phase's red evidence.
3. Implement the two trading modules, the migration, the typed schema, the snapshot, the registry
   entry and the checksum artifact.
4. Update the two migration test files whose expectations are registry-driven.
5. Re-run the targeted command and the typecheck.

---

## Step 1 — The failing test file

Create `apps/web/tests/trade-projection-identity.test.ts`. It runs against a disposable journal
(`JOURNAL_DATA_DIR` scratch dir, like the other web tests) and pins **product invariants**, not
implementation details.

**Cases.**

Fingerprint:

1. An annotation or label change leaves the fingerprint **equal**.
2. A changed fee makes the fingerprint **differ**.
3. A changed exit attribution makes the fingerprint **differ** (same total P&L, different split).
4. The same logical projection serialized in a different JSON key order yields an **equal**
   fingerprint.
5. The snapshot is bounded (≤ 16 KiB) and carries no execution membership.

Identity:

6. The same active key retains its ID and advances the revision counter.
7. A removed key that reappears gets a **new** ID, the old identity stays retired, and a
   supersession link records the succession.
8. A shared crossing-flat execution **cannot** establish continuity: the resolution is ambiguous
   with candidate IDs and no trade ID.
9. A proven explicit transfer (unique, full membership match) retains the identity.
10. A transfer whose membership matches more than one identity is ambiguous with candidate IDs.

Revisions:

11. A recorded revision is immutable: its fingerprint, snapshot, resolution and membership rows
    survive; a second write for the same `(trade_id, revision)` is refused by the schema.
12. Membership survives source-fill deletion (the membership rows carry no FK to `executions`).

Schema:

13. Migration 0002 is registered, applied and checksummed; the five tables exist with the
    documented keys; a fresh journal and the declared final schema agree.

---

## Red run (binding — the ONLY pre-implementation red run)

- [ ] Run: `pnpm exec vitest run apps/web/tests/trade-projection-identity.test.ts`
      Expected: FAIL — the trading modules do not exist yet. Record the exact output.

---

## Verification (record exact output in the phase report)

```bash
pnpm exec vitest run apps/web/tests/trade-projection-identity.test.ts
pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/db-concurrent-init.test.ts
pnpm exec vitest run packages/core/tests/round-trips.test.ts
pnpm --filter web typecheck
pnpm --filter @luxalgo/journal-core typecheck
pnpm --filter web migrations:check
node scripts/check-licenses.mjs
pnpm exec prettier --check <every file this phase touched>
```

The full `pnpm test` suite is the coordinator's phase gate, not this worker's. The root
`pnpm typecheck` reaches the desktop workspace and fails with RC2175 on a git-ignored generated
icon — pre-existing host tooling, recorded as blocked evidence, not a phase failure.

---

## Stop condition

Phase 03 is done when **all** of the following hold.

**Implementation and tests**

- [ ] The red run was executed before any production edit and its failure output is recorded.
- [ ] `apps/web/tests/trade-projection-identity.test.ts` passes.
- [ ] The two migration test files pass with registry-driven expectations.
- [ ] `packages/core/tests/round-trips.test.ts` passes unchanged (the financial engine did not move).
- [ ] `pnpm --filter web typecheck` passes.
- [ ] `pnpm --filter web migrations:check` exits 0 (the committed artifact matches the sources).
- [ ] `node scripts/check-licenses.mjs` reports OK (no new dependency).
- [ ] `pnpm exec prettier --check` reports no violation in the files this phase touched.

**Review**

- [ ] A fresh spec-compliance and code-quality review of this phase's diff has run, and every
      Critical or Important finding is fixed.
- [ ] The repo's reviewer gate is satisfied: `.omp/reviewer-report.md` records this phase's
      verdict as `## Verdict: PASS`.

**Report**

- [ ] `docs/superpowers/reports/ai-native-journal-phase-03.md` is written and committed, with the
      six items the phase guide requires.
- [ ] The report states the base SHA and the tip SHA of this phase's commits.
- [ ] The report records the gates that remain with the coordinator: the full `pnpm test` phase
      gate, the serialized phase→feature merge, and
      `docs/superpowers/reports/ai-native-journal-integration-03.md`.

**Then stop.** Phase 04 (outbox and durable jobs) is a separate assignment. Do not merge to
`codex/ai-native-journal`, push, or open a PR — the coordinator owns the integration lock.
