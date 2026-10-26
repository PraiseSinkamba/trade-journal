# Phase 03 — Projection identity, fingerprints and immutable revisions

> Phase report for the AI-native journal modernization. Source of truth: the phase guide
> (`docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md`), the phase plan
> (`docs/superpowers/plans/ai-native-journal/phase-03.md`), the contract review
> (`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md` §2–§6)
> and ADR 0006.

## 1. Phase ID, baseline, scope

| Item                     | Value                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Phase                    | 03 — Projection identity, fingerprints and immutable revisions, not wired to routes   |
| Milestone                | M1                                                                                    |
| Stable task / native IDs | T-003 / `task_f9e9b7567e6c` (`ctx_9a33af924baf`)                                      |
| Branch                   | `codex/ai-native-journal-p03` (child of the feature worktree)                         |
| Base SHA                 | `2e818946022b777e3f62f35b3a05fc1613e91fcf` (feature HEAD after the T-002 integration) |
| Plan commit              | `ed02b57` — `docs: add Phase 03 projection identity plan`                             |
| Implementation tip       | see §5 — `feat: version trade projection evidence without changing keys`              |
| Integration destination  | `codex/ai-native-journal` (not merged by this worker)                                 |

**Scope completed.** A computed projection can now be fingerprinted, and a projection can be
resolved to an immutable identity with a monotonic revision history. The same active key keeps
its identity; a removed key that reappears gets a **new** identity and the old conclusions never
revive; an explicit transfer is retained only on a unique, full execution-membership match
inside the account; anything unproven returns candidate identities and never a guessed winner.
Every revision is append-only, its execution membership is normalized into its own rows, and
that membership survives the deletion of the source fills.

**Scope remaining.** None for this phase. Nothing is wired to a route: no reconcile, command or
mutation path calls this code yet, which is exactly what the phase asks for.

**Schema allocation used.** `0002-trade-projections.ts` with the five tables the phase guide
allocates to phase 03: `trade_identities`, `trade_projection_revisions`,
`trade_revision_executions`, `trade_identity_links`, `execution_evidence`. No outbox, job,
observation, lease or evidence-lifecycle table was created — those belong to later phases.

## 2. Changed files and exported interfaces

| File                                                     | Change                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/web/src/server/trading/projection.ts`              | **new** — canonical serialization, fingerprint, bounded snapshot                       |
| `apps/web/src/server/trading/identity.ts`                | **new** — identity resolution, immutable revisions, provenance, tombstones             |
| `apps/web/src/db/migrations/0002-trade-projections.ts`   | **new** — forward-only migration with the five projection tables                       |
| `apps/web/src/db/schema.ts`                              | typed mirrors of the five tables                                                       |
| `apps/web/src/db/migrations.ts`                          | migration 0002 registered in the registry                                              |
| `apps/web/src/db/bootstrap.ts`                           | final-schema snapshot includes the 0002 DDL                                            |
| `apps/web/src/db/migration-checksums.json`               | regenerated — adds the 0002 entry                                                      |
| `apps/web/src/server/ids.ts`                             | added `newUuid()` (UUIDs identify new durable entities)                                |
| `apps/web/tests/trade-projection-identity.test.ts`       | **new** — 22 invariant cases                                                           |
| `apps/web/tests/intelligence-migrations.test.ts`         | registry-driven expectations, Phase-02 upgrade fixture, per-migration checksum binding |
| `apps/web/tests/db-concurrent-init.test.ts`              | registry-driven ledger expectation                                                     |
| `docs/superpowers/plans/ai-native-journal/phase-03.md`   | phase plan (committed before the implementation)                                       |
| `docs/superpowers/reports/ai-native-journal-phase-03.md` | this report                                                                            |

**Exported interfaces** (the phase's required contracts):

```ts
// apps/web/src/server/trading/projection.ts
export declare function fingerprintProjection(input: ProjectionInput): string;
export declare function canonicalProjectionJson(input: ProjectionInput): string;
export declare function projectionSnapshotJson(input: ProjectionInput): string;

// apps/web/src/server/trading/identity.ts
export declare function resolveIdentity(tx: JournalTx, input: IdentityInput): IdentityResolution;
export declare function recordProjectionRevision(
  tx: JournalTx,
  input: ProjectionRevisionInput,
): RecordedRevision;
export declare function recordIdentityLink(tx: JournalTx, input: IdentityLinkInput): void;
export declare function retireIdentity(tx: JournalTx, input: { tradeId: string }): void;

export type IdentityResolution =
  | Readonly<{ kind: "exact_key"; tradeId: string; nextRevision: number }>
  | Readonly<{ kind: "explicit_transfer"; tradeId: string; nextRevision: number }>
  | Readonly<{ kind: "new"; tradeId: string; nextRevision: number }>
  | Readonly<{ kind: "ambiguous"; candidateIds: readonly string[] }>;
```

**What the fingerprint covers.** Every computed field of the rebuild row, the normalized exit
attribution, the execution membership, the currency and the evidence quality. It deliberately
**excludes** labels, notes, ratings, tags, balance, formatting, fetch timestamps and sync
snapshots, so an annotation change leaves the fingerprint equal while a changed fee, a changed
exit split or changed timing quality changes it. The canonical form sorts object keys and orders
the exit entries by a total order (execution id, then P&L, then quantity), so two
same-meaning projections serialize identically and hash identically.

**What the snapshot covers.** The scalar computed facts plus the schema version — no execution
membership and no exit arrays, so it stays inside the 16 KiB cap. A snapshot that would exceed
the cap is refused with an error rather than silently truncated.

**Compatibility preserved.** The diff touches no route, no component, no import path and no
provider. `packages/core/src/round-trips.ts` is **unchanged**: trade-key construction
(`accountId|symbol|direction|openedAt[|import:group][|N]`) is untouched, and the core key
regression suite passes unchanged (14/14). Execution hashes, financial keys, annotations,
encrypted credentials, cTrader sync and every import/AI response contract are untouched.
`trades.key` and every current URL stay exactly as they were — the new identity is a separate,
immutable ID that sits beside the derived key.

## 3. Migration, schema and rollback impact

**Migration 0002 — `trade-projections`** (forward-only, additive; checksum
`693b07369d6b51a83a230be85c5d6f602482bb632ca311bc26652ee7450e3078`, authoritative value in
`apps/web/src/db/migration-checksums.json`). Migration 0001 is **not** edited and its checksum is
unchanged.

**Column-level changes — five new tables, no existing table touched.**

| Table                        | Columns                                                                                                              | Nullability / defaults                                                                                  | Keys, indexes and FK actions                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trade_identities`           | `id`, `account_id`, `current_key`, `revision`, `state`, `created_at`, `updated_at`                                   | `id` PK; `account_id`, `revision`, `state`, `created_at`, `updated_at` NOT NULL; `current_key` nullable | `UNIQUE (current_key) WHERE current_key IS NOT NULL`; index on `account_id`; `account_id → accounts(id) ON DELETE CASCADE`; `state IN ('active','tombstoned')`; `revision` default 0                                          |
| `trade_projection_revisions` | `id`, `trade_id`, `account_id`, `revision`, `trade_key`, `fingerprint`, `resolution`, `snapshot_json`, `recorded_at` | all NOT NULL except the implicit PK                                                                     | `UNIQUE (trade_id, revision)`; index on `account_id`; `trade_id → trade_identities(id) ON DELETE CASCADE`; `account_id → accounts(id) ON DELETE CASCADE`; `resolution IN ('exact_key','explicit_transfer','new','ambiguous')` |
| `trade_revision_executions`  | `revision_id`, `execution_id`                                                                                        | both NOT NULL                                                                                           | `PRIMARY KEY (revision_id, execution_id)`; index on `execution_id`; `revision_id → trade_projection_revisions(id) ON DELETE CASCADE`; **no FK to `executions`**                                                               |
| `trade_identity_links`       | `old_id`, `new_id`, `operation_id`, `reason`, `recorded_at`                                                          | all NOT NULL                                                                                            | `PRIMARY KEY (old_id, new_id, operation_id)`; index on `new_id`; both FKs → `trade_identities(id) ON DELETE CASCADE`; `reason IN ('superseded','ambiguous')`                                                                  |
| `execution_evidence`         | `execution_id`, `timing_quality`, `source_kind`, `evidence_version`, `recorded_at`                                   | all NOT NULL; `evidence_version` default 1                                                              | `PRIMARY KEY (execution_id)`; `timing_quality IN ('source_reported','reconstructed','unknown')`; **no FK to `executions`**                                                                                                    |

Two constraints carry the product rules directly:

- The **partial unique index** on `trade_identities(current_key)` covers exactly the _active_
  key mappings, because retiring an identity releases its key (`current_key` becomes `NULL`).
  That is what lets a removed key reappear with a new identity.
- `trade_revision_executions` and `execution_evidence` deliberately have **no foreign key to
  `executions`**: membership evidence must survive ordinary source-fill deletion until an
  explicit purge, and it must not alter ingestion dedup.

**Timestamps.** All new operational timestamps are **UTC epoch milliseconds**, per the contract
review's durable-storage rule (and the existing `journal_migrations.applied_at` precedent).
Event and source ISO dates keep their existing representation; nothing in this phase changes a
source date.

**Upgrade results.**

- A **fresh** journal runs 0001 then 0002 and reaches the projection schema.
- A **journal from the immediately preceding phase** (ledger at version 1, no projection tables)
  upgrades in place: 0002 creates the five tables and advances the ledger to version 2, and the
  pre-existing rows survive untouched. This path is now covered by its own test.
- A **pre-ledger legacy** journal and an **older** journal (before the nullable columns and the
  CSV-bounds columns) still converge on the same schema.
- The migrated schema and the declared final schema agree — the same `TRADE_PROJECTION_SQL`
  constant feeds both the migration and the final-schema snapshot, so they cannot drift.

**Backup and rollback impact.** The migration is purely additive: no table, column, key, hash or
credential is dropped or rewritten. Rollback means deploying the previous binary with the five
extra tables retained (the old binary ignores them), or restoring a verified full backup of the
data directory — database **and** WAL/SHM sidecars **and** the key file. There is no automatic
destructive down migration. The journal must not be copied while live without coordinating the
WAL backup, exactly as documented in `docs/database-migrations.md`.

## 4. Commands actually run

All commands were run in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal-p03` on
Node v24.20.0, pnpm 11.0.8, against the implementation tip of this report.

| Command                                                                                                               | Exit | Result                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/trade-projection-identity.test.ts` (red run, before any production file existed) | 1    | `Error: Cannot find module '../src/server/trading/projection'` — the missing-implementation failure recorded as the phase's red evidence       |
| `pnpm exec vitest run apps/web/tests/trade-projection-identity.test.ts`                                               | 0    | 22 tests passed                                                                                                                                |
| `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/db-concurrent-init.test.ts`       | 0    | 2 files, 19 tests passed                                                                                                                       |
| `pnpm exec vitest run packages/core/tests/round-trips.test.ts`                                                        | 0    | 14 tests passed — core key construction unchanged                                                                                              |
| `pnpm --filter web typecheck`                                                                                         | 0    | `next typegen` + `tsc --noEmit` clean                                                                                                          |
| `pnpm --filter @luxalgo/journal-core typecheck`                                                                       | 0    | clean                                                                                                                                          |
| `pnpm --filter web migrations:build`                                                                                  | 0    | artifact regenerated deterministically                                                                                                         |
| `pnpm --filter web migrations:check`                                                                                  | 0    | `migration-checksums.json is up to date.`                                                                                                      |
| `node scripts/check-licenses.mjs`                                                                                     | 0    | `Dependency licenses OK.`                                                                                                                      |
| `pnpm exec prettier --check` (every file this phase touched)                                                          | 0    | `All matched files use Prettier code style!` — first run failed on the two phase markdown files, fixed with `prettier --write` and re-verified |
| `pnpm test` (full root suite, re-run after the review fixes)                                                          | 0    | 88 files, 887 passed, 1 skipped                                                                                                                |
| `grep -rn "from ['\"]apps/web\|from ['\"]@luxalgo/journal-importers" packages/core/src --include="*.ts"`              | 1    | no matches — core purity intact                                                                                                                |
| `grep -rn "from ['\"]apps/web\|fetch(\|axios\|http\." packages/importers/src --include="*.ts"`                        | 1    | no matches — importer purity intact                                                                                                            |

**Not run, and why.**

- The root `pnpm typecheck` was **not** run: it reaches the `desktop` workspace and fails with a
  pre-existing, host-only RC2175 error on a generated icon. The dispatch explicitly excludes it.
  The application and both package typechecks pass, which covers every file this phase touched.
- The full `pnpm test` suite was run once during implementation but the **coordinator** is the
  designated phase verification owner for the final gate; it is re-run after the review fixes.
- No Docker, Tauri or packaged-deployment check was run: this phase changes no deployment
  target, and those gates belong to later phases.

## 5. Deviations, review findings and unresolved risks

**Deviations.**

1. **Timestamps are UTC epoch milliseconds**, not the ISO-8601 text the rest of the journal uses
   for source dates. The contract review's durable-storage rule states this explicitly for new
   operational timestamps, and `journal_migrations.applied_at` already sets the precedent. Source
   and event ISO dates are untouched.
2. **`execution_evidence` is created but not yet written.** The table is allocated to phase 03 by
   the phase guide, and its schema is in place, but nothing populates it yet: the evidence
   sidecar is written where source quality is observed — the cTrader and importer mapping work
   that belongs to a later phase. Creating the table without a writer keeps the allocation
   honest without inventing a producer for it.
3. **Two review-driven behaviour tightenings beyond the literal plan text**, both now pinned by
   tests: a key owned by another account is never adopted (it resolves to `ambiguous` rather than
   moving the trade between accounts), and a refused transfer always names the claimed identity in
   its candidate evidence, so the conflict is actionable.
4. **The `execution_evidence` primary key is `execution_id` alone**, matching the contract
   review's table ("PK execution_id, timing quality, source kind, evidence version"), with
   `timing_quality`, `source_kind` and `evidence_version` as columns.

**Review findings raised against this phase and how they were resolved.** Two independent
read-only reviews were run over the implementation diff, the maximum the dispatch allows. The
first returned **FAIL** with ten findings; the second confirmed all ten were genuinely fixed and
returned **FAIL** with three findings that all had the same root cause — the two phase markdown
files were not Prettier-formatted, and the evidence table recorded the formatting check as
passing when it had failed. Every finding from both rounds was fixed and re-verified; the full
list is in `.omp/reviewer-report.md`.

- _The `exact_key` path did not keep an identity bound to its account._ Fixed: the key owner's
  account must equal the projection's account, and the revision writer refuses to move an
  identity to another account unless the resolution is a proven explicit transfer. A test proves
  that a foreign account cannot adopt a key and that the identity stays put.
- _Transfer uniqueness was not account-qualified._ Fixed: candidate and uniqueness matching are
  scoped to the claimed source's account, so an unrelated identity in another account no longer
  blocks a valid transfer. A test proves both directions.
- _The supersession link did not reliably record the immediate successor._ Fixed: the predecessor
  is the retired identity that **last held the key**, chosen by recency, whether or not the fill
  set changed. Tests cover the unchanged and the changed-fill reappearance.
- _A refused transfer could return no candidate IDs._ Fixed: the refused claim is always part of
  the candidate evidence, so an ambiguity always names something the caller can act on.
- _Exit-attribution canonicalization was not a total order._ Fixed: the comparator now falls
  back to P&L and quantity when two exits share an execution id, and a test proves that two
  reordered exits for one fill fingerprint identically.
- _The exit-attribution test changed the membership as well, so it did not pin the invariant._
  Fixed: the membership and the total are now held fixed and only the split changes.
- _The reappearance test covered only byte-identical membership._ Fixed: a changed-fill
  reappearance is now covered, including that the old identity stays tombstoned and the
  succession link is stored.
- _The legacy fixtures were built from the final-schema snapshot, which now contains the phase
  03 tables, so the 0002 upgrade path was never exercised._ Fixed: a dedicated Phase-02 fixture
  (ledger at version 1, no projection tables) now proves that 0002 creates the five tables,
  advances the ledger and leaves the existing rows untouched.
- _The checksum test only hashed migration 0001._ Fixed: every manifest entry is now bound to the
  file it names, so a migration whose source changed cannot keep its old checksum.
- _The phase report was absent._ Fixed: this document.

Second round, all three findings with one root cause:

- _The phase plan and the phase report failed `prettier --check`._ Fixed: both markdown files are
  formatted with `prettier --write` and the check now passes on every file this phase touched.
- _The evidence table recorded the formatting check as passing when it had failed._ Fixed: §4 now
  states the first run failed, what was changed, and that the check was re-verified. The phase
  guide requires recorded command results to be true.

**Unresolved risks.**

- The identity rules are not yet exercised by a real mutation path. `resolveIdentity` and
  `recordProjectionRevision` are seams; the reconcile and command layer (a later phase) is what
  will call them inside the mutation transaction. **Does not block the next phase** — the phase
  explicitly asks for the seams without route wiring, and every rule they enforce is pinned by
  tests here.
- The `execution_evidence` table has no producer yet (deviation 2). **Does not block the next
  phase**; the table is allocated to this phase and its writer belongs to the source-quality
  work.
- The continuous-integration stale-artifact gate still lands with T-021. The runtime refuses a
  journal whose checksum no longer matches with a loud `checksum-mismatch`, so the failure is
  not silent. **Does not block the next phase.**
- A journal migrated by a newer application cannot be opened by an older binary — the intended
  forward-only behaviour. Rollback needs the backup procedure, not a binary swap alone. **Does
  not block the next phase.**

## 6. Next-phase handoff (Phase 04 inputs)

Phase 04 (outbox, durable jobs and fenced worker mechanics) needs, and now has:

- A committed, checksummed migration 0002 and a working registry/checksum pipeline: phase 04's
  allocation is `0003`, following the same pattern (a new file in `apps/web/src/db/migrations/`,
  an entry in `SOURCES`, a typed mirror in `apps/web/src/db/schema.ts`, an entry in the
  final-schema snapshot, and a regenerated checksum artifact).
- A stable transaction seam to append domain events in: `withJournalTransaction` plus the
  `JournalTx` type, and the identity modules that already append immutable evidence rows inside
  the caller's transaction.
- The phase's verification evidence: this report and the reviewer verdict in
  `.omp/reviewer-report.md`.
- Still with the coordinator, not claimed by this phase: the full `pnpm test` phase gate, the
  serialized phase→feature merge into `codex/ai-native-journal`, and
  `docs/superpowers/reports/ai-native-journal-integration-03.md`.

**Not started here:** Phase 04 (outbox, durable jobs, fenced worker), the reconcile and command
layer that will call these seams, and the continuous-integration wiring of `migrations:check`
(T-021).
