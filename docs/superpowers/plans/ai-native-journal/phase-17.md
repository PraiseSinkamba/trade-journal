# Phase 17 — Engagement and opportunity coordination

Implements the Phase 17 subset of the AI-native journal run (milestone M5, task packet T-017):
the **engagement half** of detailed-plan Task 11. Binding scope: design §14 (adaptive engagement
contract) and §15 (interaction contracts), contract review §§2–6; the phase guide's Phase 17 row
("Task 11 engagement only", schema allocation `Uses opportunities in 0007`).

Phase 16 delivered the workflow half of Task 11: the workflow command/transition engine, its
compare-and-set, its command digest, its transaction seam, the versioned workflow definitions keyed
by `(definitionKey, definitionVersion)`, and migration `0007` with the seven experience tables.
Migration `0007` also created `intelligence_opportunities` — the engagement queue this phase fills.

**This phase adds no schema.** The phase guide allocates this phase to the opportunities table of
`0007`; migrations `0001`–`0007` stay byte-unchanged, and their checksums in
`migration-checksums.json` do not change. No new dependency, therefore no new ADR.

## Objective and outcome

Deliver:

- `decideEngagement(input)` as a **pure** policy: no database, no clock, no network, no random
  source. Every fact it decides on arrives in the input.
- the six engagement outcomes with a reason and the next eligibility: `observe | inbox |
contextual | proactive | defer | suppress`.
- a **central coordinator** that owns the reservations the contract needs:
  - an **opportunity reservation** — one row per opportunity, so the same dedup key can never
    produce two opportunities;
  - a **delivery reservation** — one immutable row per proactive delivery, so a retried delivery
    cannot notify twice and the daily and cooldown counters have a history nothing can rewrite;
  - a **dismissal record** — one immutable row per dismissed opportunity or evidence revision, so
    a dismissal outlives the opportunity it was made against.

## Scope in

Owned files (only these may be edited):

- `apps/web/src/server/intelligence/contracts/experience.ts` (extend — engagement vocabulary,
  defaults, opportunity row types, store port)
- `apps/web/src/server/intelligence/experience/engagement.ts` (new — the pure policy)
- `apps/web/src/server/intelligence/experience/interactions.ts` (new — the central coordinator and
  the interaction intent it produces)
- `apps/web/src/server/intelligence/infrastructure/experience-store.ts` (extend — the SQLite
  adapter for the engagement rows)
- `apps/web/tests/intelligence-engagement.test.ts` (new — the only test file)
- this plan and the phase report

Out of scope: every other phase; the interaction routes and the native UI (Phase 18/19); the
financial engine; the provider adapters; the book methodology; the workflow engine's own state
machine (Phase 16's `experience/workflows.ts` stays untouched — an opportunity exists independently of
a workflow, and no Phase 17 contract changes a workflow).

## Storage model (no migration)

Phase 17 writes one table: `intelligence_opportunities` (created by `0007`). Its columns are fixed:
`id`, `dedup_key` (unique), `subject_type`, `subject_id`, `account_id`, `status`, `eligible_at`,
`expires_at`, `evidence_ids_json`, `created_at`, `updated_at`.

Because the phase may not add a migration, the table carries **three row kinds**, separated by the
`dedup_key` namespace. The namespace is part of the key the coordinator writes, so a producer key
can never collide with a reserved one: every key this phase writes starts with `opportunity/`,
`delivery/` or `dismissal/`, and a producer key is always stored **inside** `opportunity/`.

| Kind        | `dedup_key`                          | `status`                                                                 | Meaning                                                           |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Opportunity | `opportunity/{producerKey}`          | `pending \| eligible \| delivered \| dismissed \| expired \| suppressed` | one engagement opportunity; the unique key is the dedup guarantee |
| Delivery    | `delivery/proactive/{opportunityId}` | `delivered`                                                              | one proactive delivery; the immutable push record                 |
| Dismissal   | `dismissal/{scope}/{target}`         | `dismissed`                                                              | the operator dismissed an opportunity or an evidence revision     |

`dismissed`, `expired` and `delivered` are **terminal** opportunity statuses: nothing moves a row
out of them, and a row that does not move keeps the status the store holds. `pending`, `eligible`
and `suppressed` are the states an engagement may still move away from.

Every column of every kind, and the rules that keep them apart:

- **The `dedup_key` namespace says which kind a row is; its status says what
  happened to that row.** The kind is never inferred from the status, and
  every query filters on the namespace.
- **Opportunity rows** carry the producer's subject (`subject_type`, `subject_id`), its account
  (`account_id`), the instant it may be surfaced (`eligible_at`), the instant it expires
  (`expires_at`, default: seven days after it was recorded) and the evidence revisions it rests on
  (`evidence_ids_json`). `subject_type` is the producer's own subject kind; the producer never sees
  the namespace, only the key it supplies.
- **Delivery rows** copy the opportunity's subject, account and evidence, and carry the push instant
  in `eligible_at` and `created_at`. They are **immutable**: no later dismissal, expiry or
  acknowledgement rewrites them, so the daily allowance and the cooldown always read the true
  history.
- **Dismissal rows** name their scope in `subject_type` (`opportunity` or `evidence`) and the target
  in `subject_id`; `expires_at` is `neverExpires`, because a dismissal does not expire — it holds
  until the journal is reset. A dismissal therefore suppresses opportunities that do not exist yet.
- **The counters read the delivery rows through the eligibility index, and the table still grows.**
  The table gains a row per opportunity, per dismissal and per delivery, forever, so the cost of the
  engagement reads grows with the table. The namespace prefix alone cannot be indexed: SQLite
  applies its LIKE optimisation to an indexed column only when `case_sensitive_like` is on, and the
  journal sets only `journal_mode = WAL` and `foreign_keys = ON`, so the `like` on `dedup_key`
  cannot seek the `dedup_key` index. The two proactive queries therefore also filter on
  `status = 'delivered'`: a delivery row is written with that status and no move ever takes a row
  out of it, so the filter does not change what is counted and it lets the existing
  `intelligence_opportunities_eligibility_idx` on `(status, eligible_at)` serve them. The daily
  count is then an index range over the day's rows. What remains: the cooldown read still walks the
  delivered rows, and the subject lookup (`findOpportunitiesBySubject`) still scans the table,
  because no index covers `subject_type` and `subject_id`. Both costs grow with the table; the
  index that removes them belongs to the next migration, because this phase owns no migration. The
  `EXPLAIN QUERY PLAN` output is recorded in the phase report.

## Contracts

### `contracts/experience.ts`

```ts
/** What engagement can do with an opportunity. */
export const ENGAGEMENT_ACTIONS = [
  "observe",
  "inbox",
  "contextual",
  "proactive",
  "defer",
  "suppress",
] as const;
export type EngagementAction = (typeof ENGAGEMENT_ACTIONS)[number];

/** Why the policy decided what it decided. */
export type EngagementReason =
  | "dismissed_opportunity"
  | "dismissed_evidence"
  | "expired"
  | "already_delivered"
  | "historical_material"
  | "baseline_material"
  | "not_actionable"
  | "not_yet_eligible"
  | "activity_unknown"
  | "activity_busy"
  | "context_match"
  | "not_opted_in"
  | "daily_limit"
  | "cooldown"
  | "proactive_allowed";

/** The material an opportunity rests on. */
export type EngagementMaterial = "historical" | "baseline" | "current";

/** The operator's trading activity, when it is reliably known. */
export type EngagementActivity = "idle" | "busy" | "unknown";

export interface EngagementDecision {
  /** What happens to the opportunity. */
  readonly outcome: EngagementAction;
  /** Why the policy decided that. */
  readonly reason: EngagementReason;
  /** The instant the opportunity may next be engaged, or null. */
  readonly nextEligibleAt: number | null;
}

/** Everything the policy decides on. The policy reads nothing else. */
export interface EngagementInput {
  /** The instant the decision is made. */
  readonly now: number;
  /** The material the opportunity rests on. */
  readonly material: EngagementMaterial;
  /** Whether a current observation carries an action the operator can take. */
  readonly actionable: boolean;
  /** The subject the opportunity is about. */
  readonly subject: { readonly type: string; readonly id: string };
  /** The instant the opportunity may be surfaced. */
  readonly eligibleAt: number;
  /** The instant the opportunity expires. */
  readonly expiresAt: number;
  /** Whether the operator opted in to proactive delivery. */
  readonly proactiveOptIn: boolean;
  /** The operator's trading activity, when it is reliably known. */
  readonly activity: EngagementActivity;
  /** The UI context the operator has open, if any. */
  readonly context: { readonly subjectType: string; readonly subjectId: string } | null;
  /** Whether the opportunity itself was dismissed. */
  readonly dismissedOpportunity: boolean;
  /** Whether one of the opportunity's evidence revisions was dismissed. */
  readonly dismissedEvidence: boolean;
  /** Whether this opportunity was already delivered. */
  readonly alreadyDelivered: boolean;
  /** The proactive deliveries already made on the UTC day of `now`. */
  readonly proactiveDeliveriesToday: number;
  /** The instant of the last proactive delivery for this subject, if any. */
  readonly lastProactiveDeliveryAt: number | null;
}

/** The central engagement defaults. */
export const ENGAGEMENT_DEFAULTS = {
  /** The per-subject cooldown between proactive deliveries: 24 hours. */
  proactiveCooldownMs: 86_400_000,
  /** The proactive deliveries a journal may make in one day. */
  proactivePerDay: 1,
  /** The default lifetime of an opportunity: seven days. */
  opportunityExpiryMs: 604_800_000,
  /** The expiry of a record that does not expire. */
  neverExpires: 9_007_199_254_740_991,
} as const;

/** The stored key of an opportunity. */
export const opportunityKey = (producerKey: string): string => `opportunity/${producerKey}`;
/** The stored key of a proactive delivery. */
export const deliveryKey = (opportunityId: string): string => `delivery/proactive/${opportunityId}`;
/** The stored key of a dismissal. */
export const dismissalKey = (scope: "opportunity" | "evidence", target: string): string =>
  `dismissal/${scope}/${target}`;
```

The store port gains the reads and writes the coordinator needs:

```ts
/** An opportunity row. */
export type OpportunityRow = typeof intelligenceOpportunities.$inferSelect;
/** A row to store. */
export type NewOpportunityRow = typeof intelligenceOpportunities.$inferInsert;
/** The engagement statuses. */
export type OpportunityStatus = OpportunityRow["status"];

export interface ExperienceStore {
  // … the Phase 16 workflow methods, unchanged …

  /** Reads an engagement row by its stored key. */
  loadEngagement(tx: JournalTx, dedupKey: string): OpportunityRow | null;
  /**
   * Stores an engagement row. A repeated key keeps the first row.
   * `created` is false when the row already existed.
   */
  insertEngagement(
    tx: JournalTx,
    row: NewOpportunityRow,
  ): { row: OpportunityRow; created: boolean };
  /**
   * Moves an opportunity to a new status, but only from one of `from`.
   * Returns whether the row moved.
   */
  advanceOpportunity(
    tx: JournalTx,
    dedupKey: string,
    from: readonly OpportunityStatus[],
    to: OpportunityStatus,
    now: number,
  ): boolean;
  /** The opportunities already recorded for a subject. */
  findOpportunitiesBySubject(
    tx: JournalTx,
    subjectType: string,
    subjectId: string,
  ): OpportunityRow[];
  /** The proactive deliveries made since an instant, journal-wide. */
  countProactiveDeliveriesSince(tx: JournalTx, since: number): number;
  /** The instant of the last proactive delivery for a subject, or null. */
  lastProactiveDeliveryAt(tx: JournalTx, subjectType: string, subjectId: string): number | null;
}
```

### `experience/engagement.ts` — the pure policy

```ts
export const decideEngagement = (input: EngagementInput): EngagementDecision => ...
```

No import of the database, no clock, no random source, no `Date.now()`. The decision order is fixed
and documented in the module docstring.

### `experience/interactions.ts` — the central coordinator

```ts
/** What the coordinator is asked to engage. */
export interface EngageRequest {
  /** The producer's dedup key. The same key is the same opportunity. */
  readonly dedupKey: string;
  /** The subject the opportunity is about. */
  readonly subject: { readonly type: string; readonly id: string };
  /** The account the opportunity belongs to. */
  readonly accountId: string | null;
  /** The evidence revisions the opportunity rests on. */
  readonly evidenceRevisions: readonly string[];
  /** The material the opportunity rests on. */
  readonly material: EngagementMaterial;
  /** Whether a current observation carries an action the operator can take. */
  readonly actionable: boolean;
  /** The instant the opportunity may be surfaced; defaults to now. */
  readonly eligibleAt?: number;
  /** The instant the opportunity expires; defaults to now plus seven days. */
  readonly expiresAt?: number;
  /** Whether the operator opted in to proactive delivery. */
  readonly proactiveOptIn: boolean;
  /** The operator's trading activity, when it is reliably known. */
  readonly activity: EngagementActivity;
  /** The UI context the operator has open, if any. */
  readonly context?: { readonly subjectType: string; readonly subjectId: string } | null;
}

/** What the coordinator decided. */
export interface EngagementOutcome {
  /** The policy decision. */
  readonly decision: EngagementDecision;
  /** The opportunity the decision is about. */
  readonly opportunity: OpportunityRow;
  /**
   * True only when this call reserved the proactive delivery. A retry of the
   * same delivery finds the reservation and gets false, so it must not notify.
   */
  readonly delivered: boolean;
  /** The interaction the operator is offered, or null when none is. */
  readonly intent: InteractionIntent | null;
}

/** A structured interaction intent (design §15). */
export interface InteractionIntent {
  /** The surface the interaction is offered on. */
  readonly kind: "inbox" | "contextual" | "proactive";
  /** The subject the interaction is about. */
  readonly subject: { readonly type: string; readonly id: string };
  /** The evidence the interaction rests on. */
  readonly evidenceRevisions: readonly string[];
  /** The instant the interaction stops being valid. */
  readonly expiresAt: number;
  /** The actions the operator may take. */
  readonly actions: readonly ["dismiss"];
}

export interface EngagementCoordinator {
  /** Records the opportunity, decides, and reserves a proactive delivery when the policy allows it. */
  engage(request: EngageRequest): EngagementOutcome;
  /** Records the dismissal of an opportunity or an evidence revision. */
  dismiss(scope: "opportunity" | "evidence", target: string): void;
}

export const createEngagementCoordinator = (deps: {
  runInTransaction: RunInTransaction;
  store: ExperienceStore;
  clock?: () => number;
}): EngagementCoordinator => ...
```

The coordinator depends on the **injected** store port and transaction seam, exactly like Phase 16's
workflow engine: it opens no connection of its own and imports nothing that opens the journal.

## The engagement policy

Rules, in the order they are evaluated. The table is authoritative; the prose below explains it.

| #   | Condition                                   | Outcome      | Reason                  | Next eligibility              |
| --- | ------------------------------------------- | ------------ | ----------------------- | ----------------------------- |
| 1   | the opportunity was dismissed               | `suppress`   | `dismissed_opportunity` | null                          |
| 2   | one of its evidence revisions was dismissed | `suppress`   | `dismissed_evidence`    | null                          |
| 3   | `now >= expiresAt`                          | `suppress`   | `expired`               | null                          |
| 4   | the opportunity was already delivered       | `suppress`   | `already_delivered`     | null                          |
| 5   | the material is historical                  | `observe`    | `historical_material`   | null                          |
| 6   | the material is baseline                    | `observe`    | `baseline_material`     | null                          |
| 7   | a current observation carries no action     | `observe`    | `not_actionable`        | null                          |
| 8   | `now < eligibleAt`                          | `defer`      | `not_yet_eligible`      | `eligibleAt`                  |
| 9   | the trading activity is unknown             | `inbox`      | `activity_unknown`      | null                          |
| 10  | the operator is busy trading                | `inbox`      | `activity_busy`         | null                          |
| 11  | the UI context matches the subject          | `contextual` | `context_match`         | null                          |
| 12  | the operator did not opt in                 | `inbox`      | `not_opted_in`          | null                          |
| 13  | today's proactive allowance is spent        | `inbox`      | `daily_limit`           | the start of the next UTC day |
| 14  | the subject is inside its cooldown          | `inbox`      | `cooldown`              | the end of the cooldown       |
| 15  | otherwise                                   | `proactive`  | `proactive_allowed`     | null                          |

Reading of the contract, stated so the reviewer can check it:

- **Historical and baseline material is observed, never delivered** (rules 5–7). The review's
  baseline is a seed, not a live closure, and a historical replay must not flood the operator.
- **An actionable current observation goes to the inbox** (rules 9–10 and 12–14 are the inbox
  fallback).
- **Proactive delivery needs the opt-in** (rule 12), a _known_ idle operator (rules 9–10) and both
  interruption limits (rules 13–14). A matching UI context is **not** one of the requirements: rule
  11 decides only that a matching context is served _contextually_. Without a matching context the
  offer falls through to the opt-in, the daily allowance and the cooldown checks, and can still be
  delivered proactively.
- **Unknown activity uses the inbox** (rule 9) and never invents an idle state: a proactive push
  needs a _known_ idle operator, so `busy` and `unknown` both fall back to the inbox. Rules 9–10
  precede rule 11 deliberately: an unknown activity yields the inbox even when the UI context
  matches the subject, because the packet states that outcome without exception.
- **Contextual delivery requires a matching UI context** (rule 11) and is never an interruption, so
  it is not gated by the opt-in or the interruption limits.
- **One proactive delivery per day is journal-wide**; the **24-hour cooldown is per subject**. The
  contract qualifies only the cooldown with "per subject", and a per-subject daily cap would be
  redundant with the cooldown. The count is an input, so a different reading is a one-line change.
- A blocked proactive delivery still reaches the **inbox** (the operator pulls it themselves);
  `defer` is reserved for an opportunity that is not eligible yet, and `suppress` for an
  opportunity that must never be delivered again.

## Persistence rules

- **Dedup.** The coordinator stores the opportunity under `opportunity/{producerKey}` with
  `onConflictDoNothing` on the unique `dedup_key` and reads the stored row back, so a repeated
  producer key returns the original row and never creates a second one. The same dedup key can
  never produce two opportunities.
- **Consolidation.** Two capabilities that offer the same subject on the same evidence resolve to
  one opportunity: the coordinator reuses the opportunity already recorded for that subject and
  evidence set instead of writing a second one. Overlapping capabilities therefore cannot flood the
  operator with the same interaction. The reuse holds whatever status the recorded row holds — a
  dismissed or a delivered row is reused too — so neither a dismissal nor a previous push can be
  side-stepped under another producer key. When more than one row matches, a dismissal and a
  delivery win over a merely open row, and an expired row comes last: its window closed, so a live
  row describes the interaction better.
- **Terminal statuses.** `dismissed`, `expired` and `delivered` are terminal: nothing moves an
  opportunity row out of them. A row that does not move keeps its status, and the coordinator
  reports the status the store holds — never a newer one it wanted.
- **Delivery reservation.** A proactive delivery stores `delivery/proactive/{opportunityId}` with
  `onConflictDoNothing`; the first insert owns the push and the caller may notify, a retry finds the
  row and is told `delivered: false`. The row is immutable, so neither a later dismissal nor a
  later expiry can rewrite the daily or cooldown history.
- **Atomicity.** `engage` runs in one immediate transaction: it resolves the opportunity, reads the
  dismissals, the daily count and the subject cooldown, decides, and reserves the delivery in the
  same transaction. Two concurrent engagements of different opportunities therefore cannot both
  spend the day's single proactive slot.
- **Dismissal.** `dismiss(scope, target)` stores `dismissal/{scope}/{target}` with
  `expires_at = neverExpires`, and additionally moves an existing opportunity to `dismissed` so the
  inbox drops it. An opportunity is named by its stored key, by the key that created it, or by its
  row id — all three resolve to the same opportunity, so no handle loses a dismissal. A dismissal of
  an evidence revision suppresses every opportunity that rests on it, including opportunities
  recorded later and the revisions a later request cites.
- **Expiry.** The default expiry is seven days from the moment the opportunity is recorded; an
  explicit `expiresAt` overrides it. An expired opportunity is suppressed and never delivered.
- **No financial writes.** The coordinator writes engagement rows only: no trade, execution,
  annotation, hash or key.

## Files and steps (test first)

1. **Plan** (this document) — committed first, before any implementation.
2. **Tests** — `apps/web/tests/intelligence-engagement.test.ts`, written against the contracts below
   and run before the implementation exists, so every case fails for the right reason.
3. **Contracts** — `contracts/experience.ts`: the engagement vocabulary, the defaults, the key
   helpers, the opportunity row types and the store port additions.
4. **Policy** — `experience/engagement.ts`: `decideEngagement`, pure.
5. **Coordinator** — `experience/interactions.ts`: `createEngagementCoordinator` — resolve,
   consolidate, decide, reserve, dismiss.
6. **Adapter** — `infrastructure/experience-store.ts`: the SQLite reads and writes.

## Test plan (`apps/web/tests/intelligence-engagement.test.ts`)

Each case is listed with the behaviour it proves. Every case must be seen to fail when the
production behaviour is deliberately broken, and to pass again after the break is restored; the
phase report records both results.

| #   | Case                                                                                | Proves                                                   |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | the policy delivers proactively only with the opt-in                                | the opt-in gate                                          |
| 2   | the policy sends unknown and busy activity to the inbox                             | no invented idle state                                   |
| 3   | the policy observes historical and baseline material                                | the observe rule                                         |
| 4   | the policy suppresses a dismissal and an expiry                                     | dismissal and expiry                                     |
| 5   | the policy defers an opportunity that is not eligible yet                           | the defer rule and the next eligibility                  |
| 6   | the policy serves a matching UI context contextually                                | the contextual rule                                      |
| 7   | the policy allows one proactive delivery per day                                    | the journal-wide daily limit                             |
| 8   | the policy keeps a subject inside its 24-hour cooldown                              | the per-subject cooldown                                 |
| 9   | the policy decides only from its input                                              | purity: no clock, no database, no random                 |
| 10  | the coordinator records one opportunity per dedup key                               | the dedup guarantee                                      |
| 11  | the coordinator consolidates two capabilities on one subject                        | the consolidation of overlapping opportunities           |
| 12  | the coordinator reserves one proactive delivery and refuses the retry               | the delivery reservation                                 |
| 13  | the coordinator allows one proactive delivery per day                               | the journal-wide daily limit                             |
| 14  | the coordinator holds a subject in its cooldown                                     | the per-subject cooldown                                 |
| 15  | the coordinator suppresses a dismissed opportunity                                  | dismissal of an opportunity                              |
| 16  | the coordinator suppresses a dismissed evidence revision                            | dismissal of an evidence revision                        |
| 17  | the coordinator suppresses an opportunity recorded after its evidence was dismissed | dismissal outlives the opportunity                       |
| 18  | the coordinator never delivers an expired opportunity                               | the seven-day default expiry                             |
| 19  | the coordinator records the default expiry as seven days                            | the expiry default                                       |
| 20  | the coordinator defers an opportunity that is not eligible yet                      | the defer rule                                           |
| 21  | the coordinator sends unknown activity to the inbox                                 | no invented idle state                                   |
| 22  | the coordinator leaves the financial rows untouched                                 | no financial write                                       |
| 23  | importing the domain layer opens no journal                                         | the domain layer reaches nothing that opens the journal  |
| 24  | the coordinator runs its work through the injected seam                             | the transaction seam                                     |
| 25  | the three row kinds stay apart                                                      | the storage namespaces                                   |
| 26  | a producer key cannot collide with a reserved namespace                             | the namespace protection                                 |
| 27  | a delivery row reads back by its key                                                | the delivery record                                      |
| 28  | a dismissal holds across a capability that offers the same interaction later        | dismissal is not side-stepped under another producer key |
| 29  | the coordinator reports the status the store persisted                              | the report never claims an unpersisted status            |
| 30  | a delivered opportunity keeps its stored status when it expires                     | the terminal statuses hold                               |
| 31  | unknown activity reaches the inbox even when the context matches                    | the precedence of the activity rules                     |
| 32  | a dismissal made against the opportunity's row id is honoured                       | every handle on an opportunity names the same one        |
| 33  | a dismissal of a revision a later request cites is honoured                         | a dismissal cannot be slipped past the recorded row      |
| 34  | the daily allowance counts a proactive delivery once and never the opportunity row  | the counted set of the daily counter                     |
| 35  | the cooldown read finds the last proactive delivery of a subject and of no other    | the cooldown read still reads the delivery rows          |

## Checks and stop condition

```bash
pnpm exec vitest run apps/web/tests/intelligence-engagement.test.ts
pnpm typecheck
```

The coordinator owns the full destination gate. This phase stops at a reviewed candidate: the plan
committed, the implementation committed, the phase report committed, and the source/base/tip SHAs
reported. No push, no PR, no merge into `codex/ai-native-journal`, and no Phase 18 work.
