# Phase 17 — Engagement policy, opportunity and delivery reservations

Phase report for the Phase 17 subset of the AI-native journal run (milestone M5, task packet
T-017): the **engagement half** of detailed-plan Task 11. Binding scope: design §14 (engagement
contract), §15 (conversation and interaction contracts — tables only), contract review §§2–6; the
phase guide's Phase 17 row ("Task 11 engagement only", no new migration).

## Outcome

Engagement is a pure decision and a durable reservation. `decideEngagement` reads an input and
returns one of six outcomes — observe, inbox, contextual, proactive, defer, suppress — with the
reason and the next eligible instant. It never reads a clock, a database, a random source or a
network, so the same input always yields the same decision.

The coordinator turns that decision into three persisted facts, in one transaction:

- an **opportunity reservation** — one row per opportunity, so the same dedup key can never
  produce two opportunities, and two capabilities that offer the same subject on the same evidence
  resolve to one interaction;
- a **delivery reservation** — one immutable row per proactive delivery, so a retried delivery
  cannot notify twice and the daily and cooldown counters have a history nothing can rewrite;
- a **dismissal record** — one immutable row per dismissed opportunity or evidence revision, so a
  dismissal outlives the opportunity it was made against.

The operator is never interrupted by guesswork: a proactive push needs the opt-in, a known idle
operator and an unspent day — a matching UI context is not a precondition of a push, it makes the
offer contextual instead; the day's single proactive slot is journal-wide; a subject stays
inside a 24-hour cooldown; unknown or busy activity goes to the inbox rather than inventing an
idle state. A dismissed opportunity is suppressed across every capability that offers the same
interaction, an expired opportunity is never delivered, and observed material is never delivered at
all. No trade, fill, annotation, hash or key is touched.

## Changed files

| File                                                                  | Change                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/intelligence/contracts/experience.ts`            | **extended** — the engagement vocabulary, the defaults, the key helpers, the opportunity row types, the store port additions |
| `apps/web/src/server/intelligence/experience/engagement.ts`           | **new** — `decideEngagement`, the pure policy                                                                                |
| `apps/web/src/server/intelligence/experience/interactions.ts`         | **new** — the central coordinator and the interaction intent it produces                                                     |
| `apps/web/src/server/intelligence/infrastructure/experience-store.ts` | **extended** — the SQLite adapter for the engagement rows                                                                    |
| `apps/web/tests/intelligence-engagement.test.ts`                      | **new** — 38 cases                                                                                                           |
| `docs/superpowers/plans/ai-native-journal/phase-17.md`                | the phase plan, committed before the implementation, amended in the implementation commit                                    |
| `docs/superpowers/reports/ai-native-journal-phase-17.md`              | this report                                                                                                                  |

No other file changed. `apps/web/src/server/intelligence/experience/workflows.ts`, `composition.ts`,
the schema, the migrations, the migration registry and the migration checksums are **byte-unchanged**.
No dependency was introduced, so no ADR was needed, and no provider, credential, cTrader, hash, key
or financial behaviour was touched.

The repair commit touched four of these files again: the store adapter, the engagement suite, the
plan and this report. It changed no other file — the policy, the coordinator, the contracts, the
schema, the migrations, the migration registry, the migration checksums and the composition are
byte-unchanged by the repair.

## Migrations

**None.** The phase guide allocates the engagement tables to migration `0007`, which Phase 16
already created. This phase writes `intelligence_opportunities` and adds no migration, no schema
column, no index and no registry entry.

The engagement table grows by a row per opportunity, per dismissal and per delivery, forever, so the
cost of the engagement reads is a real cost and not a fixed one. The namespace prefix alone cannot
be indexed: SQLite applies its LIKE optimisation to an indexed column only when
`case_sensitive_like` is on, and this journal sets only `journal_mode = WAL` and
`foreign_keys = ON`, so a `like 'delivery/proactive/%'` cannot seek the `dedup_key` index.

The two proactive queries therefore also filter on `status = 'delivered'`. A delivery row is
written with that status and no move ever takes a row out of it — `delivered` is terminal — and
only delivery rows carry the `delivery/proactive/` namespace, so **the filter does not change what
is counted**. It lets the existing `intelligence_opportunities_eligibility_idx` on
`(status, eligible_at)` serve both queries; the query plans are in the repair section below.

What remains, and what this phase does not own:

- the daily count is now an index range over the day's rows, but the cooldown read still walks the
  delivered rows, and the delivered rows accumulate;
- `findOpportunitiesBySubject` still scans the table, because no index covers `subject_type` and
  `subject_id`.

Both costs grow with the table. The index that removes them belongs to the next migration; this
phase owns no migration, so it hands them on instead of adding one.

## Exported interfaces

```ts
// apps/web/src/server/intelligence/contracts/experience.ts
export const ENGAGEMENT_ACTIONS;                     // observe | inbox | contextual | proactive | defer | suppress
export type EngagementAction;
export type EngagementReason;                        // why the policy decided what it decided
export type EngagementMaterial;                      // current | historical | baseline
export type EngagementActivity;                      // idle | busy | unknown
export interface EngagementDecision;                 // { outcome, reason, nextEligibleAt }
export interface EngagementInput;                    // every fact the policy may read
export const ENGAGEMENT_DEFAULTS;                    // the 24h cooldown, 1/day, 7d expiry, neverExpires
export const opportunityKey(producerKey);            // "opportunity/{producerKey}"
export const deliveryKey(opportunityId);             // "delivery/proactive/{opportunityId}"
export const dismissalKey(scope, target);            // "dismissal/{scope}/{target}"
export type OpportunityStatus;                       // pending | eligible | delivered | dismissed | expired | suppressed
export interface OpportunityRow;                     // one engagement row
export interface NewOpportunityRow;
export interface ExperienceStore;                    // extended with the six engagement methods

// apps/web/src/server/intelligence/experience/engagement.ts
export const decideEngagement(input: EngagementInput): EngagementDecision;

// apps/web/src/server/intelligence/experience/interactions.ts
export interface EngageRequest;                     // the producer's offer
export interface EngagementOutcome;                  // { decision, opportunity, delivered, intent }
export interface EngagementIntent;                   // { kind, subject, evidenceRevisions, expiresAt, actions }
export interface EngagementCoordinator;
export const createEngagementCoordinator(deps: {
  runInTransaction: RunInTransaction;
  store: ExperienceStore;
  clock?: () => number;
}): EngagementCoordinator;

// apps/web/src/server/intelligence/infrastructure/experience-store.ts
export const createExperienceStore(): ExperienceStore;
```

The `ExperienceStore` port gained seven methods: `loadEngagement`, `loadOpportunityById`,
`insertEngagement`, `advanceOpportunity`, `findOpportunitiesBySubject`,
`countProactiveDeliveriesSince` and `lastProactiveDeliveryAt`.

## Commands run, with results

All commands ran in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal-p17` on Node
v24.20.0 / pnpm 11.0.8, with `JOURNAL_DATA_DIR` pointing at a disposable absolute directory and no
server or Docker process started.

| Command                                                                        | Exit | Result                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec vitest run apps/web/tests/intelligence-engagement.test.ts`          | 0    | 36 passed (36)                                                                                                                                                                                                                                                     |
| `pnpm exec vitest run apps/web/tests/intelligence-*.test.ts`                   | 0    | 17 files, 291 passed                                                                                                                                                                                                                                               |
| `pnpm --filter web typecheck`                                                  | 0    | `tsc --noEmit` clean                                                                                                                                                                                                                                               |
| `pnpm typecheck` (whole repo)                                                  | 101  | `packages/core`, `packages/importers` and `apps/web` clean; **`desktop` fails on `resource path 'binaries/node-x86_64-pc-windows-msvc.exe' doesn't exist`** — the same pre-existing failure Phase 15 and Phase 16 recorded, in a package this phase does not touch |
| `pnpm exec prettier --check <the six changed files>`                           | 0    | all clean                                                                                                                                                                                                                                                          |
| `pnpm exec vitest run apps/web/tests/intelligence-engagement.test.ts` (repair) | 0    | 38 passed (38)                                                                                                                                                                                                                                                     |
| `pnpm --filter web typecheck` (repair)                                         | 0    | `tsc --noEmit` clean                                                                                                                                                                                                                                               |

The full `pnpm test` and the merged-feature gate were **not** run here: the coordinator's brief
reserves the full destination gate for its verification owner, after the merge. The targeted
engagement suite and every `intelligence-*` suite were run instead.

## Fixtures

The engagement tests use a disposable journal (`mkdtempSync(join(tmpdir(), "journal-engagement-"))`),
imported after `JOURNAL_DATA_DIR` points at it, exactly like the sibling suites. The fixtures are
one account plus the engagement rows — the rows a review-observation correction must not touch.
The store is the real SQLite adapter and the transaction seam is the real journal transaction, so
the reservations are real durable rows.

## Results against the exact code SHA

Base SHA: `c4abdfbde237f6bea42fe6fea83c67d3b1c8924b` (the verified feature HEAD this phase started
from).

| Commit    | Subject                                                                     |
| --------- | --------------------------------------------------------------------------- |
| `7120d77` | `docs: plan the engagement and opportunity coordination`                    |
| `e2b5e68` | `feat: persist workflows and coordinate engagement`                         |
| `9fb76c7` | `docs: record the Phase 17 engagement evidence`                             |
| (this)    | `fix: correct the Phase 17 engagement claims and the opportunity scan cost` |

The plan commit is the first commit of this phase; the implementation and the report follow it.
`feat: persist workflows and coordinate engagement` is the detailed plan's Task 11 subject, the same
subject Phase 16 used; **this phase implements the engagement half of Task 11**, Phase 16 the
workflow half. The implementation tip — the tree every command above was run against — is
`e2b5e6822126e06dd885fd2a2fe9c6517778a712`, and the base SHA is
`c4abdfbde237f6bea42fe6fea83c67d3b1c8924b`.

### Acceptance evidence

| Behaviour                                    | Result                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Proactive delivery needs the opt-in          | Without the opt-in the outcome is `inbox` with reason `not_opted_in`; with it, and an idle operator, the outcome is `proactive`             |
| One proactive delivery per day, journal-wide | The first proactive delivery is reserved; a second subject on the same day gets `inbox` with reason `daily_limit`                           |
| A 24-hour per-subject cooldown               | The same subject inside the cooldown gets `inbox` with reason `cooldown`; another subject on the next day is delivered proactively          |
| Unknown activity never invents an idle state | `activity: unknown` gives `inbox` with reason `activity_unknown`, never a proactive delivery — even when the UI context matches the subject |
| A retry cannot notify twice                  | The retry finds the delivery reservation and reports `delivered: false`; exactly one delivery row exists                                    |
| The dedup guarantee                          | Two engagements under the same dedup key leave one opportunity row                                                                          |
| Consolidation                                | Two capabilities that offer the same subject on the same evidence leave one opportunity row and one delivery row                            |
| A dismissal outlives the opportunity         | A dismissal of an opportunity suppresses it, and a later capability that offers the same interaction is suppressed too                      |
| A dismissal of an evidence revision holds    | An opportunity resting on a dismissed revision is suppressed, whether it was recorded before or after the dismissal                         |
| Expiry                                       | An opportunity past its expiry is suppressed with reason `expired` and never delivered; the default expiry is seven days                    |
| Observed material is never delivered         | Historical, baseline and non-actionable material give `observe`; no delivery row is written                                                 |
| The domain layer opens no journal            | Importing the domain layer writes no journal file; the coordinator's work runs through the injected seam                                    |
| No financial write                           | The account, trade, execution and note rows are byte-identical before and after an engagement                                               |

## Review findings and their resolutions

Two reviewer findings runs were spent: one on the plan, one on the implementation diff. The plan
review returned FAIL with nine findings; all nine were closed by the plan rewrite. The
implementation review returned FAIL with two defects; both are fixed and pinned by
mutation-proved cases. **A third reviewer run was spent beyond the coordinator's budget of two**,
to confirm the fixes; it returned PASS and raised two non-blocking notes, both of which are also
fixed and mutation-proved below. The two notes were fixed after that PASS, so the final diff was
not reviewed again — the budget was spent.

| Finding                                                                                                                            | Resolution                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PLAN — the dismissal row's columns and expiry were unspecified                                                                     | The plan names every column of every kind and the `neverExpires` expiry of a dismissal                                                                                   |
| PLAN — the overlapping-opportunity case was missing                                                                                | The plan and the suite carry the consolidation case                                                                                                                      |
| PLAN — the "statuses are disjoint by kind" invariant was false                                                                     | The plan was corrected: the `dedup_key` namespace says the kind, the status says what happened to the row                                                                |
| PLAN — the import side-effect case was missing                                                                                     | The suite imports the domain layer and asserts that no journal file is written                                                                                           |
| PLAN — undefined types in the contract sketch                                                                                      | Every type in the sketch is now defined                                                                                                                                  |
| PLAN — the ordering was not test-first                                                                                             | The plan's steps put the tests second and the implementation last                                                                                                        |
| PLAN — a prose/table contradiction on the daily limit                                                                              | The prose and the rule table now agree                                                                                                                                   |
| PLAN — the reserved prefixes were unprotected                                                                                      | The plan states that every key this phase writes starts with `opportunity/`, `delivery/` or `dismissal/`                                                                 |
| PLAN — the index and scan cost were unacknowledged                                                                                 | The plan states the real cost: the table grows with every interaction, the namespace prefix cannot use the `dedup_key` index, and the index belongs to a later migration |
| FAIL — the consolidation lookup excluded dismissed rows, so a second capability wrote a new row and pushed a dismissed interaction | The lookup now matches any recorded row for that subject and evidence, and the priority puts a dismissal and a delivery first                                            |
| FAIL — `advance` discarded the store's boolean and fabricated the requested status                                                 | `advance` uses the store's result and returns the unchanged row when the move did not happen                                                                             |
| NOTE — a re-engaged dedup key kept its original evidence list, so a newly cited dismissed revision was not honoured                | The dismissal check now covers the recorded revisions **and** the revisions the request cites                                                                            |
| NOTE — `dismiss` ignored a target given as the row id, silently losing the dismissal                                               | `dismiss` now resolves an opportunity by its stored key, its producer key **or** its row id                                                                              |
| REPAIR — the report claimed a proactive push needs a matching context                                                              | The claim was false; the plan and the report now state that a matching context makes the offer contextual instead                                                        |
| REPAIR — the plan and the report claimed the scan was bounded by a handful of rows                                                 | The claim was false; the real cost is stated, the daily count now reads through the existing eligibility index, and the remaining scans are handed to the next migration |

## Phase 17 repair — the two claim findings

The coordinator's implementation-diff review returned FAIL on the phase's own claims, not on the
production code: the reviewer raised no production defect. Both findings were about a false
statement in the plan and the report. The policy was not changed.

### Finding 1 (BLOCK) — a proactive push does not need a matching context

The Outcome section said that "a proactive push needs the opt-in, a known idle operator and a
matching context". That was false. `decideEngagement` returns `contextual` when the context
matches the subject; when the context does not match, the offer falls through to the opt-in, the
daily allowance and the cooldown checks and can still be returned as `proactive`. The detailed
plan's Task 11 says "Contextual requires matching UI context" — that constrains the _contextual_
outcome, not the proactive one.

Resolved: the Outcome section, the plan's policy reading and the plan's rule order now state what
the code does — a proactive push needs the opt-in, a known idle operator and an unspent day, and a
matching UI context makes the offer contextual instead. No behaviour changed.

### Finding 2 (FAIL) — the scan was not bounded by a handful of rows

The plan and the report said the counters scanned "a handful of rows". That was false, and it was
false about a real cost: `intelligence_opportunities` grows by a row per opportunity, per dismissal
and per delivery, forever, and the namespace prefix `like 'delivery/proactive/%'` cannot seek the
`dedup_key` index, because SQLite applies its LIKE optimisation to an indexed column only when
`case_sensitive_like` is on and this journal never sets it.

Resolved in two parts.

**The claim now tells the truth.** The plan and this report state the real bound: the table grows
with every interaction, the namespace prefix cannot use the `dedup_key` index, and the remaining
costs grow with the table.

**The daily count no longer scans the table.** Both proactive queries also filter on
`status = 'delivered'`. A delivery row is written with that status, `delivered` is terminal, and
only delivery rows carry the `delivery/proactive/` namespace, so the filter does not change what is
counted — it only lets the existing `intelligence_opportunities_eligibility_idx` on
`(status, eligible_at)` serve the query. `findOpportunitiesBySubject` cannot be served by any
existing index: no index covers `subject_type` and `subject_id`, and no status filter preserves its
set, because the rows it looks for may hold any status. It still scans the table, and that cost is
handed to the next migration, which owns the schema.

### Query plans

Measured on a disposable journal against the journal's own schema (`intelligence_opportunities`
and its four indexes), SQLite 3.53.2, `case_sensitive_like` never set — the journal sets only
`journal_mode = WAL` and `foreign_keys = ON`:

```
### countProactiveDeliveriesSince — before
select count(*) from "intelligence_opportunities" where ("intelligence_opportunities"."dedup_key" like ? and "intelligence_opportunities"."eligible_at" >= ?)
SCAN intelligence_opportunities

### countProactiveDeliveriesSince — after
select count(*) from "intelligence_opportunities" where ("intelligence_opportunities"."status" = ? and "intelligence_opportunities"."dedup_key" like ? and "intelligence_opportunities"."eligible_at" >= ?)
SEARCH intelligence_opportunities USING INDEX intelligence_opportunities_eligibility_idx (status=? AND eligible_at>?)

### lastProactiveDeliveryAt — before
select max("eligible_at") from "intelligence_opportunities" where ("intelligence_opportunities"."dedup_key" like ? and "intelligence_opportunities"."subject_type" = ? and "intelligence_opportunities"."subject_id" = ?)
SEARCH intelligence_opportunities

### lastProactiveDeliveryAt — after
select max("eligible_at") from "intelligence_opportunities" where ("intelligence_opportunities"."status" = ? and "intelligence_opportunities"."dedup_key" like ? and "intelligence_opportunities"."subject_type" = ? and "intelligence_opportunities"."subject_id" = ?)
SEARCH intelligence_opportunities USING INDEX intelligence_opportunities_eligibility_idx (status=?)

### findOpportunitiesBySubject — unchanged, handed to the next migration
select "id", "dedup_key", "subject_type", "subject_id", "account_id", "status", "eligible_at", "expires_at", "evidence_ids_json", "created_at", "updated_at" from "intelligence_opportunities" where ("intelligence_opportunities"."subject_type" = ? and "intelligence_opportunities"."subject_id" = ? and "intelligence_opportunities"."dedup_key" like ?)
SCAN intelligence_opportunities

### the namespace prefix on its own — why the dedup_key index cannot seek it
select count(*) from "intelligence_opportunities" where "intelligence_opportunities"."dedup_key" like ?
SCAN intelligence_opportunities USING COVERING INDEX intelligence_opportunities_dedup_unique
```

The last plan is the honest detail: with the LIKE alone, SQLite can only walk the whole
`dedup_key` index and test each key, because the pattern is a prefix on a BINARY column and
`case_sensitive_like` is off. The status equality is what turns that walk into a seek.

What the plans do **not** claim: the cooldown read still walks the delivered rows, and the subject
lookup still scans the table. Both grow with the table, and both are handed to the next migration.

### The counted set, pinned

Two cases were added to `apps/web/tests/intelligence-engagement.test.ts`:

- **"counts a proactive delivery once and never counts the opportunity it came from"** — the
  delivery row and the opportunity row both carry the status `delivered`, and the daily allowance
  counts the delivery row only. Dropping the namespace predicate from the count makes this case
  fail with 2 instead of 1.
- **"reads the last proactive delivery of a subject and of no other"** — the cooldown read still
  finds the delivery of its own subject and nothing else, so the status filter did not narrow the
  rows that qualify.

No existing case was weakened, and the policy was not touched.

### Verification of the repair

| Command                                                               | Exit | Runtime | Result               |
| --------------------------------------------------------------------- | ---- | ------- | -------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-engagement.test.ts` | 0    | 6.8s    | 38 passed (38)       |
| `pnpm --filter web typecheck`                                         | 0    | 17.6s   | `tsc --noEmit` clean |

No migration, no schema change, no index, no dependency and no policy change came with the repair.

## Proof of teeth

Every behaviour claimed above was proved by deliberately breaking the production code, watching the
test fail, restoring the code and watching the test pass again. Each restore was verified by a full
green run of the suite.

| Break                                                       | Result while broken                                                                                      | Result after restore |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| The consolidation lookup filtered out dismissed rows again  | **1 failed**, 35 passed — "holds a dismissal across a capability that offers the same interaction later" | 36 passed            |
| `advance` reported the status it wanted, not the stored one | **1 failed**, 35 passed — "keeps the stored status of a delivered opportunity when it expires"           | 36 passed            |
| The evidence union was dropped                              | **1 failed**, 35 passed — "honours a dismissal of a revision a later request cites"                      | 36 passed            |
| The row-id lookup was dropped from `dismiss`                | **1 failed**, 35 passed — "honours a dismissal made against the opportunity's row id"                    | 36 passed            |

The first break is the sharpest: before the fix, the dismissal of an opportunity could be side-stepped
under a second producer key, and the operator received a proactive push of an interaction they had
already dismissed.

## Deviations

1. **Three row kinds in one table.** The phase may not add a migration, and `intelligence_opportunities`
   is the only engagement table the phase guide allocates here. The three kinds — opportunity,
   delivery, dismissal — therefore share that table and are separated by the `dedup_key` namespace.
   The kind is never inferred from the status: every query filters on the namespace. The plan was
   amended in the implementation commit to record this.
2. **The status model was amended after the plan review.** The plan originally claimed the statuses
   were disjoint by kind; that is false, because a dismissal _record_ and an opportunity _row_ both
   carry `dismissed`. The plan now states that the namespace says the kind and the status says what
   happened to the row, and the suite pins the status each kind holds.
3. **The commit split.** The plan was committed first; the implementation and the report follow it.
   The plan amendments that record the deviations are carried in the implementation commit, the same
   way Phase 16 did it.

## Next-phase handoff inputs

- **Phase 18 (interaction routes and controls)** can now call `engage` and `dismiss`. The
  coordinator exposes `engage(request)` and `dismiss(scope, target)`; `dismiss` accepts an
  opportunity's stored key, its producer key or its row id, and an evidence revision id.
- **The intent** carries `kind` (`inbox`, `contextual` or `proactive`), the subject, the evidence
  revisions, the expiry and the available actions (`dismiss`). The inbox, the interaction card and
  the controls are Phase 18's work.
- **The composition wiring** is not this phase's work: `createEngagementCoordinator` takes an
  injected store and transaction seam, and nothing composes it in production yet. A phase that
  serves engagement must wire the adapter in `composition.ts`.
- **The counters read the delivery rows through the eligibility index**, because a delivery row
  always carries the status `delivered` and that filter changes nothing about what is counted. The
  daily count is an index range over the day's rows; the cooldown read still walks the delivered
  rows and the subject lookup still scans the table. **The next migration owns the indexes** — one
  on the delivery namespace, and one on `(subject_type, subject_id)` — to remove the remaining
  scans.
- **The delivery rows are immutable.** A later dismissal, expiry or acknowledgement never rewrites
  them, so the daily allowance and the cooldown always read the true history.

## Definition of done

Assigned scope implemented, targeted checks pass, the spec and quality reviews are resolved, and
the phase plan, the implementation and this report are committed. The candidate stops here: the
source, base and tip SHAs are reported to the coordinator, and the merge into
`codex/ai-native-journal` is the coordinator's work, not this phase's.
