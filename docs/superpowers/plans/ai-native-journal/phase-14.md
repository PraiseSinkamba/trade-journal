# Phase 14 — Knowledge-source revisions and invalidation

Implements the Phase 14 subset of the AI-native journal run (milestone M4, task packet T-014): the
**source half** of detailed-plan Task 10. Binding scope: design §§9, 16; contract review §§2–6; the
phase guide's Phase 14 row ("Task 10 source events and knowledge only", schema allocation `0006`).

Phase 13 delivered the background policy, the pinned provider/model/endpoint and the daily attempt
reservation. This phase delivers the other half of the same milestone: the **source revision
contract**, the **write paths that emit it**, and the **knowledge lifecycle that survives a source
correction or deletion**.

The scheduler half of Task 10 is **Phase 15** and is not implemented here. This phase creates the
`intelligence_schedules` table and nothing else: no `scheduleDue`, no duplicate-tick handling, no
DST gap or fold behaviour, no offline coalescing, no scheduler test file.

## Objective and outcome

Deliver:

- the `SourceChange` contract — a strict union over five source kinds and two actions, carrying the
  source kind, the source id, the account scope where one applies, the revision and the correlation
  id;
- `applySourceChange(tx, change)` — one durable, atomic source revision: the versioned source row,
  the invalidation of the knowledge that depends on it, and the durable re-evaluation request that
  follows;
- the write-path matrix below: every user-authored source write commits its source revision in the
  same transaction as the write itself;
- migration `0006` with `knowledge_sources`, `knowledge_hypotheses`, `knowledge_patterns` and
  `intelligence_schedules`;
- `apps/web/tests/intelligence-knowledge-revisions.test.ts`.

## Scope in

Owned files (only these may be edited):

- `apps/web/src/server/domain-events.ts` (the `SourceChange` contract and its strict schema)
- `apps/web/src/server/intelligence/knowledge/` (new, **pure**: `patterns.ts`, `revisions.ts`)
- `apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts` (new, the SQLite adapter)
- `apps/web/src/server/intelligence/composition.ts` (wiring only)
- `apps/web/src/app/api/journal/`, `apps/web/src/app/api/playbooks/`, `apps/web/src/app/api/notes/`,
  `apps/web/src/app/api/folders/`, `apps/web/src/app/api/trades/[key]/`,
  `apps/web/src/app/api/trades/bulk/` (the write paths listed in the matrix below)
- `apps/web/src/db/migrations/0006-knowledge-scheduling.ts` (new)
- `apps/web/src/db/migrations.ts` (registry), `apps/web/src/db/schema.ts` (typed tables),
  `apps/web/src/db/bootstrap.ts` (final-schema snapshot),
  `apps/web/src/db/migration-checksums.json` (regenerated artifact)
- `apps/web/tests/intelligence-knowledge-revisions.test.ts` (new)
- this plan and the phase report

Two notes on the layout, both required by the binding contract review §2 ("infrastructure owns
SQLite adapters for every domain's storage port", ADR 0008 "typed ports at an explicit composition
root"):

- `server/intelligence/knowledge/` holds **pure** code only: the pattern-evaluation contract, the
  pure evaluator and the pure invalidation decisions. It imports no database, no Next and no AI SDK.
- The SQLite adapter lives in `server/intelligence/infrastructure/knowledge-revisions.ts`, beside
  the Phase 08 store that already lives there, and is exposed through `composition.ts`. The file is
  new and uniquely named, so it collides with no other phase's file.

Schema allocation: `0006` only. Migrations `0001`–`0005` are applied and stay byte-unchanged. No new
dependency (therefore no new ADR), no new package, no model-driven financial write, no network call
inside a write transaction, no unrestricted SQL or HTTP tool, no change to any provider.

## Contracts

### `SourceChange` (`apps/web/src/server/domain-events.ts`)

A strict union over the five source kinds and the two actions — ten permitted combinations. Every
member carries the source kind, the source id, the revision, the correlation id, and — where a scope
applies — the account id. The TypeScript type discriminates on `kind`; the Zod wire schema is a
strict discriminated union whose `action` is a literal per member, so an unpaired kind/action
combination cannot be constructed or parsed.

| Kind          | Scope          | Written by                                                               |
| ------------- | -------------- | ------------------------------------------------------------------------ |
| `annotation`  | account-scoped | trade annotation write (`/api/trades/[key]`, `/api/trades/bulk`)           |
| `rule_check`  | account-scoped | trade rule-check write (`/api/trades/[key]/rules`)                         |
| `playbook`    | shared         | playbook create, edit, delete (`/api/playbooks`)                            |
| `journal`     | shared         | journal day note write (`/api/journal/[date]`)                             |
| `note`        | shared         | note create, edit, delete (`/api/notes`), folder delete (visibility change) |

`revision` is the **knowledge revision** of that source: a per-`(kind, source id)` counter that
advances independently of any financial or projection revision. The account scope is `null` for the
shared kinds: the journal's shared notes, notes and playbooks keep their existing cross-account
semantics. A narrowed account scope therefore never exposes the knowledge derived from a shared
source; only the unscoped view does.

```ts
export type SourceKind = "annotation" | "rule_check" | "playbook" | "journal" | "note";
export type SourceAction = "revised" | "deleted";

export type SourceChange =
  | { readonly kind: "annotation"; readonly action: SourceAction; readonly sourceId: string;
      readonly revision: number; readonly correlationId: string; readonly accountId: string }
  | { readonly kind: "rule_check"; readonly action: SourceAction; readonly sourceId: string;
      readonly revision: number; readonly correlationId: string; readonly accountId: string }
  | { readonly kind: "playbook" | "journal" | "note"; readonly action: SourceAction;
      readonly sourceId: string; readonly revision: number; readonly correlationId: string;
      readonly accountId: null };
```

The wire form is parsed by `parseSourceChange` from a strict Zod discriminated union. Unknown keys
are rejected, so a caller cannot smuggle extra data into the contract.

**Source ids.** `annotation` uses the trade key — the annotation lives on the trade row. `rule_check`
uses the rule-check row id, `JSON.stringify([tradeKey, playbookId, rule])`, which is the identity the
row already has, so the write and the delete name the same source. `playbook` uses the playbook id,
`journal` the journal day (`YYYY-MM-DD`) and `note` the note id.

**Correlation id.** One id per request, generated with `newUuid()`, shared by every source change
that request emits. A request that writes several sources is therefore one operation in the source
log.

### `applySourceChange(tx, change)` (pure decisions in `knowledge/revisions.ts`, adapter in `infrastructure/knowledge-revisions.ts`)

One call, inside the caller's transaction, in this order:

1. **Record the source revision.** A `knowledge_sources` row for `(kind, source id, revision)`:
   `active` for a revision, `invalidated` for a deletion. The previous active revision of the same
   source becomes `superseded`. The unique key over `(kind, source id, revision)` makes a repeated
   call a no-op: an already recorded revision returns without invalidating anything twice.
2. **Invalidate the dependent knowledge.** Every `active` hypothesis and pattern derived from that
   source becomes `stale` on a revision and `invalidated` on a deletion — a deleted source cannot
   be re-derived. The match is scoped: for the account-scoped kinds the dependent row must carry the
   same `account_id`, for the shared kinds it must carry `account_id IS NULL`. Other accounts'
   knowledge and unrelated sources are untouched.
3. **Enqueue the re-evaluation — only for a revision.** Each row that moved to `stale` gets a
   **pending successor**: the same subject at `version + 1`, status `pending`, bound to the newest
   source revision, carrying the previous payload as the last known state. The pending row is the
   durable re-evaluation request; it is the queue a later phase drains when it owns an evaluator. A
   **deletion enqueues nothing** — there is nothing left to re-derive.
4. **Supersede an older pending request.** When a second correction arrives before the pending
   successor was evaluated, that older pending row becomes `superseded` and the new successor is
   bound to the newest source revision, so a later evaluator never re-derives from superseded
   content.

The knowledge lifecycle is therefore: `active` (current) → `stale` (the source moved, a
re-evaluation is pending) → the pending successor becomes the current `active` version when it is
evaluated, or `invalidated` when the source was deleted.

### `PatternEvaluation` (`apps/web/src/server/intelligence/knowledge/patterns.ts`)

```ts
export type PatternEvaluation =
  | { readonly kind: "insufficient_evidence"; readonly required: number; readonly available: number }
  | {
      readonly kind: "evaluated";
      readonly evaluatorId: string;
      readonly version: string;
      readonly evidenceIds: readonly string[];
    };
```

A pure, strict Zod union plus a pure evaluator:

```ts
export const evaluatePattern = (input: {
  readonly required: number;
  readonly evidenceIds: readonly string[];
}): PatternEvaluation;
```

`required` is the evidence count the caller declares the pattern needs; `available` is
`evidenceIds.length`. Fewer evidence ids than required gives `insufficient_evidence` with both
counts; otherwise the evaluation names the evaluator, its version and the evidence it used. It
encodes evidence sufficiency only — **no behavioural or book rule is implemented in this phase**, and
no evaluator is registered. A pattern that cannot be evaluated is represented as insufficient
evidence, never guessed.

## Write-path matrix

Every row below wraps the write and its source revision in **one** immediate transaction
(`withJournalTransaction`, `behavior: "immediate"`): either both commit or neither does. A
rolled-back write leaves no source revision and invalidates no knowledge. The source revision is
allocated **inside** that transaction, so two concurrent writers cannot allocate the same revision.

| Write path                    | Write                                              | Source kind    | Action    |
| ----------------------------- | -------------------------------------------------- | -------------- | --------- |
| `POST /api/notes`             | create a note                                      | `note`         | `revised` |
| `PATCH /api/notes/[id]`       | edit a note                                        | `note`         | `revised` |
| `DELETE /api/notes/[id]`      | delete a note                                      | `note`         | `deleted` |
| `DELETE /api/folders/[id]`     | folder deleted; **each** note it held moves to `my-notes` (visibility change) | `note` | `revised`, one change per note id |
| `PUT /api/journal/[date]`      | write the journal day note                         | `journal`      | `revised` |
| `POST /api/playbooks`          | create a playbook                                  | `playbook`     | `revised` |
| `PATCH /api/playbooks/[id]`    | edit a playbook                                    | `playbook`     | `revised` |
| `DELETE /api/playbooks/[id]`   | delete a playbook                                  | `playbook`     | `deleted` |
| `PATCH /api/trades/[key]`      | write the trade annotations                        | `annotation`   | `revised` |
| `POST /api/trades/[key]/rules` | write a trade rule check (`followed: null` deletes it) | `rule_check` | `revised` / `deleted` |
| `POST /api/trades/bulk`        | review, unreview, tag, untag, playbook             | `annotation`   | `revised` |
| `DELETE /api/trades/[key]`     | delete the trade — **its annotations go with it**  | `annotation`   | `deleted` |
| `POST /api/trades/bulk` (`action: "delete"`) | delete the trades — **their annotations go with them** | `annotation` | `deleted` |

Two writes destroy annotations that a user authored, and both are covered above: deleting a trade
removes its annotation row, and a bulk delete removes several. Without a `deleted` change the
knowledge derived from those annotations would stay `active` after the annotation is gone, so the
deletion emits an `annotation` `deleted` change for every trade it removes.

`DELETE /api/playbooks/[id]` also clears the playbook from the trades that referenced it; that
annotation write emits an `annotation` `revised` change for each affected trade, in the same
transaction as the playbook deletion.

The journal day note, the notes and the playbooks are **shared** sources: they carry no account
scope, exactly like the tables they live in today. The trade annotation and the trade rule check are
**account-scoped**: they carry the account of the trade.

The trade-delete paths call the existing `deleteTrades` command, which opens its own transaction.
The route runs that command inside the same immediate transaction as the source change; the nested
transaction is a savepoint, so the source change and the deletion still commit or roll back
together.

## Schema allocation and migration checklist (0006)

`apps/web/src/db/migrations/0006-knowledge-scheduling.ts` creates, forward-only and additive:

### `knowledge_sources` — the self-report register

One row per source revision the user authored. It records **that** the user wrote, edited or removed
a source, in which account scope, and at which revision — never the user's words: those stay in the
journal's own tables (notes, journal days, playbooks, trade annotations).

| Column          | Null | Default | Constraint                                                          |
| --------------- | ---- | ------- | ------------------------------------------------------------------- |
| `id`            | no   | —       | PRIMARY KEY                                                          |
| `kind`          | no   | —       | `CHECK (kind IN ('annotation','rule_check','playbook','journal','note'))` |
| `source_id`     | no   | —       | —                                                                   |
| `revision`      | no   | —       | `CHECK (revision > 0)`                                               |
| `account_id`    | yes  | `NULL`  | FK → `accounts(id)` `ON DELETE CASCADE` (null = shared source)      |
| `status`        | no   | —       | `CHECK (status IN ('active','superseded','invalidated'))`           |
| `correlation_id`| no   | —       | —                                                                   |
| `recorded_at`   | no   | —       | —                                                                   |

Keys: PK `id`; unique `(kind, source_id, revision)`; index `(kind, source_id, status)`; index
`(account_id)`.

### `knowledge_hypotheses` and `knowledge_patterns` — the derived findings

Versioned payload, evidence and status. Both carry the source revision they were derived from, so an
invalidation can find them. The two tables differ only in the evaluation columns: a hypothesis is a
tentative interpretation (its evaluator may be absent — a hypothesis can be self-reported), a
pattern is the result of a pattern evaluation and therefore always names its evaluator.

| Column                 | Null | Default | Constraint                                                       |
| ---------------------- | ---- | ------- | ---------------------------------------------------------------- |
| `id`                   | no   | —       | PRIMARY KEY                                                       |
| `subject_type`         | no   | —       | —                                                                |
| `subject_id`           | no   | —       | —                                                                |
| `version`              | no   | —       | `CHECK (version > 0)`                                            |
| `status`               | no   | —       | `CHECK (status IN ('active','stale','pending','superseded','invalidated'))` |
| `payload_schema_version` | no | `1`     | —                                                                |
| `payload_json`         | no   | —       | strict payload, at most 16 KiB                                   |
| `evidence_ids_json`    | no   | —       | JSON array of evidence ids, at most 16 KiB                       |
| `evaluator_id`         | yes  | `NULL`  | hypotheses: nullable; patterns: `NOT NULL`                      |
| `evaluator_version`    | yes  | `NULL`  | hypotheses: nullable; patterns: `NOT NULL`                      |
| `evaluation_state`     | patterns only | — | `CHECK (evaluation_state IN ('evaluated','insufficient_evidence'))` |
| `required_evidence`    | patterns only | — | `CHECK (required_evidence >= 0)`                                 |
| `available_evidence`   | patterns only | — | `CHECK (available_evidence >= 0)`                                |
| `source_kind`          | no   | —       | —                                                                |
| `source_id`            | no   | —       | —                                                                |
| `source_revision`      | no   | —       | `CHECK (source_revision > 0)`                                     |
| `account_id`           | yes  | `NULL`  | FK → `accounts(id)` `ON DELETE CASCADE`                          |
| `created_at`           | no   | —       | —                                                                |
| `updated_at`           | no   | —       | —                                                                |

Keys: PK `id`; unique `(subject_type, subject_id, version)`; index
`(source_kind, source_id, account_id, status)`; index `(account_id, status)`.

The payload and the evidence list are schema-versioned, strict and capped at 16 KiB, exactly like
the event and job payloads of contract review §4 — a later phase cannot repair a missing version
column without a new migration, so the version travels with the row.

`knowledge_sources` (self-reports) and `knowledge_hypotheses` / `knowledge_patterns` (derived
findings) are separate tables and never share a row.

### `intelligence_schedules` — schema only

Phase 15 owns the scheduler behaviour; this phase creates the table and writes nothing into it.

| Column              | Null | Default | Constraint              |
| ------------------- | ---- | ------- | ----------------------- |
| `id`                | no   | —       | PRIMARY KEY             |
| `definition_version`| no   | —       | `CHECK (definition_version > 0)` |
| `next_due_at`       | no   | —       | —                       |
| `checkpoint_json`   | yes  | `NULL`  | JSON object, at most 16 KiB |
| `created_at`        | no   | —       | —                       |
| `updated_at`        | no   | —       | —                       |

Keys: PK `id`; index `(next_due_at)`. `definition_version` is the version Phase 15 keys its
`(scheduleId, dueAt, version)` job from; `checkpoint_json` is the durable condition cursor Phase 15
consumes.

Checklist:

- [x] New numbered migration; `0001`–`0005` are untouched and their checksums stay valid.
- [x] Column list, nullability, defaults, `CHECK` constraints, indexes and FK actions are listed
      above and repeated in the phase report.
- [x] Strict application payload schemas (`sourceChangeSchema`, `patternEvaluationSchema`) beside the
      SQL constraints, with the 16 KiB payload cap.
- [x] Upgrade from the previous phase and from baseline `0001`, fresh database, repeated startup,
      injected failure and concurrent startup — the existing migration suite is registry-driven, so
      the new migration is covered by it; the phase test adds the `0006`-specific assertions: the
      four tables exist in the journal with their columns, indexes and constraints, the registered
      checksum of migration `0006` matches both the migration source and the ledger row the runner
      applied, and a journal that is at `0005` upgrades to `0006` with the same four tables.
- [x] Snapshot parity: `BOOTSTRAP_SQL` splices the same DDL constant the migration applies.
- [x] Checksum artifact regenerated with `pnpm --filter web migrations:build`.
- [x] Rollback: additive tables only. Rollback means deploying the previous binary with the new
      tables retained, or restoring a verified backup — no destructive down migration, no data
      rewrite.
- [x] No backfill, no provider call, no historical engagement triggered by the migration.

## Steps

1. Commit this plan (`docs: plan the knowledge source revisions and invalidation`).
2. Write the failing test `apps/web/tests/intelligence-knowledge-revisions.test.ts` first. The test
   seeds dependent knowledge rows explicitly, so the invalidation assertions cannot pass vacuously.
3. Add the `SourceChange` contract and its strict schema to `apps/web/src/server/domain-events.ts`.
4. Add `apps/web/src/server/intelligence/knowledge/patterns.ts` (the `PatternEvaluation` contract and
   the pure evaluator) and `apps/web/src/server/intelligence/knowledge/revisions.ts` (the pure
   invalidation decisions).
5. Add `apps/web/src/db/migrations/0006-knowledge-scheduling.ts`, register it, mirror it in
   `schema.ts` and `bootstrap.ts`, regenerate the checksum artifact.
6. Add `apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts`: the SQLite adapter
   for `nextSourceRevision`, `applySourceChange` and `listKnowledgeInScope`.
7. Wire the knowledge service through `apps/web/src/server/intelligence/composition.ts` so the write
   paths reach one adapter instance.
8. Wrap the write paths of the matrix in one immediate transaction each and emit their source
   revision.
9. Run the targeted command and the typecheck; record the results.
10. Review the diff (one reviewer run), resolve the findings, commit the implementation and write the
    phase report.

## Verification commands

Targeted:

```
pnpm exec vitest run apps/web/tests/intelligence-knowledge-revisions.test.ts
```

Phase gate:

```
pnpm typecheck
```

Supporting checks: `apps/web/tests/intelligence-migrations.test.ts` (registry-driven, covers `0006`),
`apps/web/tests/intelligence-boundaries.test.ts` (import direction), and the legacy route suites that
the wrapped write paths touch (`apps/web/tests/journal-features.test.ts`,
`apps/web/tests/folder-delete.test.ts`, `apps/web/tests/note-formatting.test.ts`,
`apps/web/tests/account-mutation-routes.test.ts`).

The full `pnpm test` gate is run by the coordinator on the destination branch, once, after the merge.

## Acceptance

- **Source revision:** a note, rule check, journal day note, playbook, trade annotation and bulk
  annotation write each commit a source revision in the same transaction as the write. A rolled-back
  write leaves no revision.
- **Correction invalidates:** a corrected source marks the knowledge derived from it `stale` and
  enqueues the re-evaluation as a pending successor version bound to the newest source revision.
  A second correction before evaluation supersedes the older pending request. Other subjects and
  other accounts are untouched.
- **Deletion invalidates:** a deleted source — a note, a playbook, a deleted trade's annotation —
  marks the knowledge derived from it `invalidated` and enqueues nothing.
- **Independent lifecycle:** a trade annotation write advances the knowledge revision of that
  annotation while a rebuild of the same account advances the financial revision; the user's
  annotation values survive the rebuild and the two revisions never share a counter.
- **Explicit insufficiency:** a pattern that cannot be evaluated is represented as
  `insufficient_evidence` with the required and available counts; no behaviour is guessed and no LLM
  is involved.
- **Shared semantics:** the journal day note, the notes and the playbooks stay cross-account; a
  narrowed account scope does not expose the knowledge derived from them.
- **Compatibility:** every provider, the encrypted credentials, the cTrader sync, the financial
  hashes, keys and annotations, and the existing import and AI response contracts are unchanged.

## Stop condition

Stop when the targeted test, the typecheck and the supporting regressions have been run and recorded,
the review findings are resolved, the implementation and this phase's report are committed. Any real
failure stops the phase: report it honestly, never weaken an expectation, never widen the scope and
never start Phase 15.

## Out of scope

The coordinator owns the reviewed, non-fast-forward merge into `codex/ai-native-journal`. No push, no
PR, no merge to `main`. The scheduler behaviour (Phase 15), the workflow engine (Phase 16), the
engagement policy (Phase 17), the interaction APIs (Phase 18) and the interaction UI (Phase 19) are
other phases. No behavioural or book-derived rule is implemented in this phase.
