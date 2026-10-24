# AI-Native Journal Phased Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the single assigned phase.
> Steps use checkbox (`- [ ]`) syntax. Do not automatically advance to another phase.

**2026-10-24 worktree amendment:** Use the
[copyable handoff prompt sheet](2026-10-24-ai-native-journal-handoff-prompts.md).
The user selected Orca-managed feature, phase and independent-task worktrees, subagent
implementation/reviews, and local merge of each tested phase into `codex/ai-native-journal`
through superpowers:finishing-a-development-branch. Complete the phase report and verified
merge, then stop. This supersedes the earlier report-before-merge stop instruction.
Phase-specific plans are materialized under `plans/ai-native-journal/phase-NN.md` before SDD.
Parallel tasks require committed interfaces and exclusive ownership; dependent phases remain ordered.

**Goal:** Implement the modernization in small reviewable increments, with a maintainable
versioned migration system established before any intelligence schema is added.

**Architecture:** Retain the modular monolith and existing financial engine. Deliver the
no-provider pipeline first, then scoped AI, then durable interactions. Keep partially integrated
features disabled until their release gate passes.

**Tech Stack:** Existing TypeScript, Node ≥22, pnpm 11.0.8, Next.js, Drizzle/better-sqlite3,
Zod, Vitest, tsup, Docker and Tauri; no additional dependency is required for migrations.

**Spec:** [Amended design](../specs/2026-10-22-ai-native-journal-architecture-design.md),
[contract review](../specs/2026-10-22-ai-native-journal-architecture-contract-review.md),
and [detailed tasks](2026-10-22-ai-native-journal-modernization.md).

**Owner:** A separate implementing agent. This guide is the 2026-10-23 execution amendment:
its phase boundaries and migration numbering supersede the original plan's bundled task order.
All behavior contracts, exclusions and compatibility requirements remain in force.

## Global constraints

- Read repository `AGENTS.md`, the spec, review, relevant ADRs and assigned detailed task first.
- Implement only the assigned phase. Do not treat the whole plan as one assignment.
- Preserve execution hashes, derived keys, annotations, cTrader sync and all AI provider categories.
- No live trader data, external operations inside write transactions, public intelligence package,
  mandatory external infrastructure, book-derived features or unrelated UI work.
- Schema changes require a migration, matching typed schema, upgrade tests and rollback notes.
- Record actual checks and results; an unrun packaging or recovery test is not a passing gate.
- Check current HEAD/working tree before work; the source baseline was inspected on 2026-10-22.
  Reconcile intervening changes without reverting other work.

## Review focus

- A fresh install and an upgraded legacy journal must converge on the same schema (Phase 02 onward).
- Applied migrations must never be edited to make new databases work (every schema phase).
- Intermediate trading integration must not emit an incomplete production event stream (Phases 05–09).
- A phase must not quietly include another phase's route, provider or deployment refactor.
- Each handoff must distinguish implemented, tested, and deployable behavior.

## Execution sequence and stop points

Each row is one assignment and one review boundary. Dependencies are serial by default: complete
and review the preceding phase before starting the next. Task numbers refer to the detailed plan,
whose exact files, signatures, failing tests and commands remain required for the indicated subset.

| Phase | Bounded deliverable                                                            | Detailed task subset                                                                 | Schema change                | Exit evidence                                                                             |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------- |
| 01    | Safe connection/transaction seams; separate request errors from Next           | Task 1 only                                                                          | None                         | Connection lifecycle, async-tx rejection, existing rollback/scope tests                   |
| 02    | Versioned migration runner and legacy baseline                                 | Task 2 runner only; migration contract below                                         | 0001 + ledger                | Fresh/legacy/concurrent/failure/checksum/future-version tests                             |
| 03    | Projection identity, fingerprints and immutable revisions, not wired to routes | Task 3 + projection part of Task 2                                                   | 0002                         | Key stability, reappearance, split/merge ambiguity tests                                  |
| 04    | Outbox, durable jobs and fenced worker mechanics, exercised in tests only      | Task 4 + transport part of Task 2                                                    | 0003                         | Two-connection claims, duplicate fanout, expired/stale owner tests                        |
| 05    | Transaction-aware reconciliation for manual and generic ingestion              | Task 5: `executions`, `rebuild`, trading services, manual/generic import adapters    | None                         | Failure injection rolls back fills/projections/events/notes; identical retry silent       |
| 06    | All broker and specialized import paths                                        | Task 5: SDK/cTrader, NinjaTrader, XTB, IBKR and demo                                 | None                         | Existing broker/import tests plus atomic snapshot/batch/event failures                    |
| 07    | Remaining mutation commands and settings-driven rebuilds                       | Task 5: single/bulk delete, account clear/delete/transfer, method/multiplier changes | None                         | Exhaustive mutation matrix; ambiguous transfer rejected atomically                        |
| 08    | Factual observations and explicit cTrader evidence quality                     | Task 6 + observation part of Task 2                                                  | 0004                         | Duplicate/reordered event, invalidation, unknown timing tests                             |
| 09    | Historical seed/replay and no-provider recovery                                | Task 7                                                                               | Uses seed checkpoint in 0004 | Real DB reopen/kill recovery; baseline never a live closure                               |
| 10    | Node supervisor, worker bundle and Docker startup                              | Task 8 excluding Rust/Tauri edits                                                    | None                         | Packaged clean-directory smoke, shutdown, parent disconnect, Docker scratch volume        |
| 11    | Tauri lifecycle and packaging; Slice A review                                  | Task 8 Rust/Tauri integration and complete Slice A gate                              | None                         | Actual sidecar ABI, collision/restart/quit tests, full financial regression               |
| 12    | Execution contexts, deterministic capability registry and tool gateway         | Task 9 contracts/gateway only; existing AI adapters remain in place                  | None                         | Scope/allowlist/budget/output tests; legacy AI parity                                     |
| 13    | Background AI policies, reservations and provider adapter integration          | Remainder of Task 9                                                                  | 0005                         | URL/model change, no fallback, cancellation, daily reservation and provider parity tests  |
| 14    | Knowledge-source revisions and invalidation                                    | Task 10 source events and knowledge only                                             | 0006                         | Note/rule/journal/playbook corrections and source deletion invalidate dependent knowledge |
| 15    | Durable time/condition scheduling                                              | Task 10 scheduler only                                                               | Uses schedules in 0006       | Duplicate ticks, restart, DST and catch-up coalescing                                     |
| 16    | Persistent workflow command/transition engine                                  | Task 11 workflows only                                                               | 0007                         | CAS, duplicate command, crash-before-effect, waiting releases job                         |
| 17    | Engagement and opportunity coordination                                        | Task 11 engagement only                                                              | Uses opportunities in 0007   | Cooldown, dismissal, expiry, dedup and unknown activity policy                            |
| 18    | Authenticated interaction/control APIs                                         | Task 12 backend routes/origin checks only                                            | None                         | Auth, origin, scope, stale actions, corrections and account-purge races                   |
| 19    | Native inbox/control UI and Slice B review                                     | Task 12 UI and complete Slice B gate                                                 | None                         | Keyboard/privacy tests; restart-to-continuation; optional/no-provider paths               |
| 20    | Retention, backup/restore, deletion and operations documentation               | Task 13 storage/operations portion                                                   | No new schema expected       | Reference-safe prune, restore with synthetic credentials, no resurrection                 |
| 21    | Performance, complete packaging and CI release acceptance                      | Remainder of Task 13                                                                 | None                         | Recorded full CI, Docker/Windows smoke, benchmark and package-content results             |

Do not create unused implementation modules in anticipation of a later phase. Tables grouped
within a migration may be created together when their FKs/constraints form one coherent schema
(for example workflow, transition and command tables). This does not authorize implementing all
their consumers in the same phase.

Phases 05–09 keep production event capture/worker disabled by default; tests explicitly enable
them. Do not turn capture on for a subset of mutation paths. Before enabling Slice A, establish
the baseline and durable seed checkpoint, then record all subsequent supported changes.
Background AI stays off until its separate policy/opt-in phase; proactive delivery stays off
until the engagement/API/UI path is verified.

## Mandatory early migration phase

### What exists today

Re-inspected on 2026-10-23: `apps/web/src/db/` contains `index.ts`, `bootstrap.ts` and `schema.ts`.
`bootstrap.ts:migrate` executes idempotent DDL, guarded legacy ALTER statements and a CSV-bounds
repair. `openJournalDatabase` retries busy setup and runs migration inside an immediate
transaction. This is automatic upgrading, but there is no migration ledger, ordered version
registry or applied-migration checksum validation.

Phase 02 must add those maintainability features, reusing the existing SQLite bootstrap and
concurrent-init protections. It must not add a second competing startup migration mechanism.

### Phase 02 ownership and contracts

Create:

- `apps/web/src/db/migrations.ts` — registry, validation and application.
- `apps/web/src/db/migrations/0001-legacy-baseline.ts` — frozen current DDL and legacy repairs.
- `apps/web/tests/intelligence-migrations.test.ts` — runner invariants and legacy fixtures.
- `apps/web/scripts/build-migration-manifest.mjs` — deterministic checksums of migration source,
  producing `apps/web/src/db/migration-checksums.json`; CI checks regeneration has no diff.
- `docs/database-migrations.md` — authoring, commands, compatibility and recovery procedure.

Modify `apps/web/src/db/bootstrap.ts`, `apps/web/src/db/schema.ts`, and
`apps/web/tests/db-concurrent-init.test.ts` and `apps/web/package.json` to expose the manifest
generation/check command; use Phase 01's connection seam. Do not introduce
identity, events, jobs, observations, AI or workflow tables yet.

```ts
interface JournalMigration {
  version: number; // positive, unique, monotonically ordered
  name: string;
  checksum: string; // deterministic SHA-256 of immutable migration content
  up(sqlite: Database.Database): void;
}

type MigrationStatus = Readonly<{
  currentVersion: number;
  pendingVersions: readonly number[];
}>;

declare function inspectMigrations(sqlite: Database.Database): MigrationStatus;
declare function applyMigrations(sqlite: Database.Database): void;
```

`JournalMigration` is the migration descriptor already required by Task 2. Store its checksum
from canonical migration source content as a build artifact; do not hash `Function.toString()`
because bundling/transpilation can change it. Test checksum stability across source/bundled
execution. The release registry must include every historical migration and its checksum.

Ledger DDL:

```sql
CREATE TABLE journal_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
```

- [ ] Write failing tests: empty database, pre-ledger current database, older missing-column
      database, twice-applied no-op, concurrent processes, rollback after injected failure, tampered
      checksum/name, missing applied version, noncontiguous history and unknown future version.
- [ ] Run `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts`; observe the
      missing-runner failure before implementation.
- [ ] Inspect an existing ledger before application-schema writes; reject unsupported history
      without running current bootstrap DDL. Inside the immediate lock, re-read and validate the
      ledger to prevent concurrent starts from using stale pending lists.
- [ ] For a pre-ledger database, create the ledger and execute baseline 0001's idempotent legacy
      convergence before recording 0001. Do not mark a baseline merely because a database exists.
      For an empty database, execute the same baseline migration.
- [ ] Apply ordered pending migrations and insert each ledger row in the same transaction as
      its changes. Keep the existing all-or-nothing startup transaction initially; never advance
      the ledger on failure. All callbacks are synchronous; no external work inside the lock.
- [ ] Freeze baseline SQL independently of the evolving final `BOOTSTRAP_SQL`. Startup must
      use migrations, not execute latest bootstrap DDL before migration validation. Retain the
      final-schema snapshot for fresh-schema parity tests if existing consumers need it.
- [ ] Compare synthetic financial/annotation/credential rows byte-for-byte before/after upgrade;
      assert integrity and FK checks pass and no legacy key/hash is rewritten.
- [ ] Run `pnpm exec vitest run apps/web/tests/intelligence-migrations.test.ts apps/web/tests/db-concurrent-init.test.ts apps/web/tests/db-connection-lifecycle.test.ts apps/web/tests/execution-storage.test.ts`;
      expect green. Run the web typecheck. Document commands and actual results, then stop.

Do not build intelligence schema into this phase to avoid a second migration later. A small,
proven runner plus one legacy baseline is the intended independently reviewable deliverable.

## Schema allocation and required indexes

The original plan's proposed migration files have not been implemented. Replace their numbering
with this sequence; do not generate both old and new variants. If the implementing agent finds
an intervening implementation, inspect its ledger and append forward migrations instead of
renumbering already-applied files.

All filenames below are under `apps/web/src/db/migrations/`. For each, update the registry,
Drizzle schema and final-schema snapshot in the same phase.

| Migration                         | Phase | Tables / changes                                                                                                                                                                        | Required keys and indexes                                                                                                                                                     |
| --------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001-legacy-baseline.ts`         | 02    | Existing journal schema and current guarded legacy repairs; ledger managed by runner                                                                                                    | Preserve all existing indexes, credentials and financial identities                                                                                                           |
| `0002-trade-projections.ts`       | 03    | `trade_identities`, `trade_projection_revisions`, `trade_revision_executions`, `trade_identity_links`, `execution_evidence`                                                             | Unique active current key; unique trade/revision; account index; PK revision/execution; PK old/new/operation link; PK execution evidence                                      |
| `0003-durable-jobs.ts`            | 04    | `domain_outbox`, `event_deliveries`, `intelligence_jobs`, `intelligence_worker_lease`                                                                                                   | Unique aggregate/type/revision; pending-dispatch index; PK event/handler/version; unique job idempotency key; status/available and status/lease indexes; singleton lease name |
| `0004-observations.ts`            | 08    | `intelligence_observations`, `observation_evidence`, `intelligence_seed_checkpoints`                                                                                                    | Unique subject/source revision/evaluator/version/type; subject/status index; PK observation/revision; checkpoint PK account ID                                                |
| `0005-intelligence-runtime.ts`    | 13    | `intelligence_runs`, `intelligence_policy`, `intelligence_budget_reservations`                                                                                                          | Unique run effect key; policy PK/revision; reservation PK run/attempt; daily-budget lookup index                                                                              |
| `0006-knowledge-scheduling.ts`    | 14    | `knowledge_sources`, `knowledge_hypotheses`, `knowledge_patterns`, `intelligence_schedules`                                                                                             | Unique source kind/ID/revision; subject/status indexes; schedule next-due index and persisted checkpoint                                                                      |
| `0007-intelligence-experience.ts` | 16    | `intelligence_workflows`, `workflow_transitions`, `interaction_commands`, `intelligence_opportunities`, `intelligence_conversations`, `intelligence_messages`, `workflow_conversations` | Unique workflow/revision and command ID; unique opportunity dedup key; eligibility/expiry indexes; conversation/message ordering index; unique workflow/conversation pair     |

Checkpoint fields: `account_id`, `status` (`pending|running|completed|suppressed`),
`last_trade_key` nullable, `baseline_operation_id`, `updated_at`; account FK cascades on deletion.
Per-account batches read current revisions under the same transaction; cursor advancement and
created observations/jobs commit together. `suppressed` implements explicit intelligence reset
without automatic reseeding. Resuming requires an explicit rebuild command.

The contract review remains authoritative for payloads, evidence provenance and lifecycle.
Membership evidence must survive ordinary source-fill deletion, so it cannot cascade from
`executions`. Account purge deliberately removes account-owned evidence and cancels outstanding
work. Outbox account references must remain sufficient for transactional purge; do not rely
on parsing an arbitrary payload to find private data. Workflow/conversation multi-account scope
must be explicit so purge can remove any record containing the deleted account's data.

### Checklist for every schema-changing phase

- [ ] Add a new numbered migration; never edit an applied migration or its checksum.
- [ ] List added/changed columns, nullability, defaults, indexes, uniqueness and FK actions in the
      phase report. The table above is minimum coverage, not a substitute for column-level review.
- [ ] Implement strict application payload schemas and SQL constraints for states/revisions.
- [ ] Test upgrade from the immediately preceding phase and from baseline 0001; test a fresh
      database reaches equivalent tables, columns, indexes, constraints and seed data.
- [ ] Test repeated startup, injected failure rollback and concurrent startup using scratch files.
- [ ] Inspect native SQLite compatibility in the bundled runtime when using new SQL features.
- [ ] Record backup and rollback impact. Prefer additive forward repair; no automatic destructive
      down migration. Never copy just a live WAL database without coordinating its backup.
- [ ] Document any data backfill separately: restartable checkpoints, bounded batches and no
      provider calls. Schema migrations must not silently trigger historical engagement.

Future maintainability rule for `docs/database-migrations.md`: every persisted schema change
after baseline goes through this runner, including non-intelligence features. Provide a CI test
that compares the migrated schema with the declared final schema, validates registry ordering
and checksums, and exercises a retained legacy fixture. Keep migration code/assets in standalone,
Docker and Tauri artifacts. Only the migration system evolves the production schema at startup.

## Phase report and review protocol

At the end of the assigned phase, create
`docs/superpowers/reports/ai-native-journal-phase-NN.md` with:

1. Phase ID, start/end commit or working-tree baseline, exact scope completed and remaining.
2. Changed files and exported interfaces; compatibility behavior preserved.
3. Migration version/table/column/index changes, upgrade results and backup/rollback impact.
4. Commands actually run, counts/results, and any environment-limited checks.
5. Deviations and evidence; unresolved risks and whether they block the next phase or release.
6. A next-phase handoff listing required inputs without beginning that phase.

After the phase report, perform the authorized, verified local merge and integration report
from the handoff sheet, then stop. Do not combine another phase to use spare time or context. Fix
defects within the assigned phase; if fixing them requires changing an approved contract or
another phase's scope, describe the concrete conflict for review. Do not mark incomplete tasks
or release gates complete. Update checkboxes only for the subset actually implemented.

## Copyable assignment for the implementing agent

```text
Use Prompt 01 from:
docs/superpowers/plans/2026-10-24-ai-native-journal-handoff-prompts.md

Implement Phase 01 only from:
docs/superpowers/plans/2026-10-23-ai-native-journal-phases.md

Read its linked design, contract review, detailed plan and applicable AGENTS.md first.
Preserve existing working-tree changes. Follow the phase's file ownership and tests.
Use disposable databases; do not modify live trader data. Do not implement Phase 02 or
any later phase. Use Orca child worktrees and superpowers:subagent-driven-development.
At completion write the required phase report, use superpowers:finishing-a-development-branch
to merge locally into the feature branch after tests, verify/report the integrated result,
and stop. Run Prompt 00 first if the feature worktree/documentation baseline does not exist.
```

For later assignments replace `01` and the explicitly excluded next phase. Phase 02 must be
assigned separately even if Phase 01 finishes quickly. The no-provider Slice A gate occurs
after Phase 11; Slice B after Phase 19; deployment completion after Phase 21.
