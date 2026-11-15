# Phase 16 — Persistent workflow command/transition engine

Implements the Phase 16 subset of the AI-native journal run (milestone M5, task packet T-016): the
**workflow half** of detailed-plan Task 11. Binding scope: design §13 (workflow contract), §15
(conversation and interaction contracts — tables only), contract review §§2–6; the phase guide's
Phase 16 row ("Task 11 workflows only", schema allocation `0007`).

Phase 15 delivered the durable scheduler, the source-change condition checkpoints and the
DST-correct occurrence arithmetic. Phase 14 delivered the source-revision contract and its ten
atomic write paths. Neither produced a workflow: a long-lived review process had nowhere to live.
This phase gives it one.

**Engagement is not in this phase.** The detailed plan's Task 11 names `decideEngagement` beside
`transitionWorkflow`, but the phase guide allocates engagement to Phase 17 and the coordinator's
brief says "no engagement implementation yet". This phase creates the engagement storage the later
phase consumes (`intelligence_opportunities`) and implements no engagement policy, no cooldown, no
dismissal, no expiry and no opportunity behaviour.

## Objective and outcome

Deliver:

- a persistent, versioned workflow with recorded transition history;
- `transitionWorkflow(command, context): WorkflowResult` with compare-and-swap on the expected
  revision, exact-retry idempotency by command digest, and a conflict that mutates nothing;
- the transition and its durable effect enqueued in **one** transaction, so a crash can neither lose
  the effect nor apply it twice;
- a workflow that waits for the user without holding a job, and releases its job when the waiting
  condition clears;
- a correction that records a self-report and its evidence and never writes a financial value, a
  hash or a key;
- migration `0007` with the whole workflow/experience table set.

## Scope in

Owned files (only these may be edited):

- `apps/web/src/server/intelligence/contracts/experience.ts` (new — the command, the result and the
  workflow vocabulary)
- `apps/web/src/server/intelligence/experience/workflows.ts` (new — the state machine and the
  engine)
- `apps/web/src/server/intelligence/infrastructure/experience-store.ts` (new — the SQLite adapter)
- `apps/web/src/server/intelligence/infrastructure/jobs.ts` (only if the job store needs a change)
- `apps/web/src/db/schema.ts`, `apps/web/src/db/migrations.ts`, `apps/web/src/db/bootstrap.ts`,
  `apps/web/src/db/migration-checksums.json`, `apps/web/src/db/migrations/0007-intelligence-experience.ts`
- `apps/web/tests/intelligence-workflows.test.ts` (new — the only test file)
- this plan and the phase report

Schema allocation: **0007**, the whole table set below. Migrations `0001`–`0006` stay
byte-unchanged; their checksums in `migration-checksums.json` do not change. No new dependency,
therefore no new ADR.

Out of scope: every other phase, engagement policy, the interaction routes and the UI, the
financial engine, the provider adapters, the book methodology.

## Storage model (migration 0007)

`0007` creates the tables the phase guide allocates to this phase. The tables grouped here form one
coherent schema, which is what the phase guide allows; their consumers arrive in later phases.

| Table                        | Purpose                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `intelligence_workflows`     | the durable workflow: definition, version, current revision, status, subject, scope    |
| `workflow_transitions`       | the transition history: one row per applied revision, unique over (workflow, revision) |
| `interaction_commands`       | the command ledger: unique command id, payload digest, stored result                   |
| `intelligence_opportunities` | the engagement queue for Phase 17: unique dedup key, eligibility and expiry indexes    |
| `intelligence_conversations` | a conversation, independent of any workflow                                            |
| `intelligence_messages`      | the messages of a conversation, ordered by (conversation, created_at)                  |
| `workflow_conversations`     | the join between a workflow and a conversation, unique over the pair                   |

Notes on the constraints:

- `intelligence_workflows.revision` is the **workflow** revision. It is independent of any financial
  or projection revision: a workflow counts its own transitions and nothing else.
- `status` is checked against the workflow statuses: `running`, `waiting_for_user`, `scheduled`,
  `completed`, `cancelled`, `failed`.
- `effect_revision` records the last transition whose effect was applied. It is what makes the
  effect application idempotent.
- `self_report_json` holds the user's correction. It is a **self-report**, stored next to the
  workflow, never mixed into a financial table.
- `account_id` is explicit on every account-owned row and cascades from `accounts`, so an account
  purge removes every record that contains the deleted account's data. A null `account_id` means a
  shared (account-independent) workflow or conversation.
- `workflow_conversations` is a join table: a conversation is not owned by a workflow, and a
  workflow may be linked to several conversations.

The exact DDL is in `apps/web/src/db/migrations/0007-intelligence-experience.ts`; the same DDL is
reused by the final-schema snapshot in `apps/web/src/db/bootstrap.ts`, so a migrated journal and
the declared schema cannot drift. The typed schema in `apps/web/src/db/schema.ts` mirrors it
column for column.

## Contracts

### `contracts/experience.ts`

```ts
export const WORKFLOW_STATUSES = [
  "running",
  "waiting_for_user",
  "scheduled",
  "completed",
  "cancelled",
  "failed",
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_ACTIONS = ["acknowledge", "correct", "defer", "cancel"] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export const workflowCommandSchema = z
  .object({
    commandId: z.string().min(1).max(200),
    workflowId: z.string().min(1).max(200),
    expectedRevision: z.number().int().nonnegative(),
    action: z.enum(WORKFLOW_ACTIONS),
    correction: z.string().min(1).max(4000).optional(),
    deferUntil: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine(...); // correct requires correction; defer requires deferUntil; the other
                      // actions must not carry the field they do not use

export type WorkflowCommand = z.infer<typeof workflowCommandSchema>;

export const workflowResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("applied"), newRevision: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal("duplicate"),
      priorResult: z.object({ newRevision: z.number().int().positive() }).strict(),
    })
    .strict(),
  z.object({ kind: z.literal("conflict"), currentRevision: z.number().int().nonnegative() }).strict(),
]);
export type WorkflowResult = z.infer<typeof workflowResultSchema>;
```

The `ExecutionContext` is the one Phase 12 built at
`apps/web/src/server/intelligence/contracts/execution.ts`. It is **reused**, never redefined. The
engine uses its `executionId`, `correlationId` and `scope.accountIds`.

### `experience/workflows.ts`

```ts
export const REVIEW_OBSERVATION_DEFINITION = "review_observation";
export const REVIEW_OBSERVATION_VERSION = 1;

export interface WorkflowEngineDeps {
  db: JournalDb;
  jobs: JobStore;
  /** The experience store port, wired to the SQLite adapter at composition. */
  store: ExperienceStore;
  clock?: () => number;
}

export interface WorkflowEngine {
  /** Starts a workflow in `running` and enqueues its first effect. */
  startWorkflow(
    input: {
      subjectType: string;
      subjectId: string;
      accountId: string | null;
      evidenceIds?: readonly string[];
    },
    context: ExecutionContext,
  ): { workflowId: string; revision: number };
  /** Applies a user command. Never mutates on a conflict. */
  transitionWorkflow(command: WorkflowCommand, context: ExecutionContext): WorkflowResult;
  /** Applies the durable effect of a transition. Idempotent. */
  applyWorkflowEffect(workflowId: string, transitionRevision: number): void;
}

export const createWorkflowEngine = (deps: WorkflowEngineDeps): WorkflowEngine;
```

`transitionWorkflow` is the authority named by the detailed plan and the coordinator's brief. It
is bound to the journal, the job store and the experience store by the factory, exactly like
`createScheduler` and `createJobStore`.

**The store is a port, not an import.** The repository's own import-boundary rule (`rule 5` of
`apps/web/tests/intelligence-boundaries.test.ts`) allows a domain to reach a sibling's
`contracts/` and nothing else; only `composition.ts` may wire a concrete adapter. The engine
therefore depends on the `ExperienceStore` **port** declared in `contracts/experience.ts` and
receives the SQLite implementation (`createExperienceStore()` in
`infrastructure/experience-store.ts`) through its dependencies. The engine reaches no concrete
adapter, and the boundary rule stays intact without an exemption.

## The state machine

One neutral review-observation workflow. `running → waiting_for_user → completed | cancelled`, and
`scheduled → waiting_for_user`.

| From               | Action        | To                 | Notes                                                 |
| ------------------ | ------------- | ------------------ | ----------------------------------------------------- |
| `waiting_for_user` | `acknowledge` | `completed`        | the user accepted the observation                     |
| `waiting_for_user` | `correct`     | `completed`        | the self-report is recorded with the workflow         |
| `waiting_for_user` | `defer`       | `scheduled`        | `deferUntil` decides when the workflow wakes up again |
| `waiting_for_user` | `cancel`      | `cancelled`        | the user dismissed the workflow                       |
| `running`          | _(system)_    | `waiting_for_user` | the effect presented the observation to the user      |
| `scheduled`        | _(system)_    | `waiting_for_user` | the deferred condition cleared                        |

Any other action from any other status is refused: it is a conflict, and it mutates nothing.

## Command semantics

`transitionWorkflow` runs in one immediate transaction and, in this order:

1. **Parse** the command with `workflowCommandSchema`. An invalid command throws; it is a client
   error, not a conflict.
2. **Digest** the payload — `workflowId`, `expectedRevision`, `action`, `correction`,
   `deferUntil` — with SHA-256 over the canonical JSON. The command id is the key, not part of the
   payload.
3. **Replay?** Look the command id up in `interaction_commands`.
   - same id, **same digest** → return the stored prior result (`duplicate`). Nothing is applied a
     second time.
   - same id, **different digest** → `conflict`. The command id is bound to its payload; a second
     meaning is not a second application.
4. **Compare-and-swap.** Load the workflow. If `workflow.revision !== command.expectedRevision` →
   `conflict(currentRevision)`. Nothing is written.
5. **Validate the transition.** If the action is not legal from the current status → `conflict`.
6. **Apply.** Insert the `workflow_transitions` row for `revision + 1`, update the workflow row
   (revision, status, and the correction or the deferral), release the workflow's stale jobs,
   enqueue the new effect job **in the same transaction**, and record the command with its digest
   and the result.

The command ledger row is written in the same transaction as the transition, so a command that
half-applied cannot exist: either the transition and its ledger row are both there, or neither is.

### Scope

A workflow whose `account_id` is not in `context.scope.accountIds` (and whose scope is not empty)
is a conflict. A command never widens the scope of the workflow it addresses.

## The durable effect

The effect of a transition is a durable job, so it survives a restart and cannot be lost by a
crash:

- the job key is `workflow-effect:{workflowId}:{revision}` — one job per transition, and the
  unique `intelligence_jobs.idempotency_key` makes a repeated enqueue a no-op;
- the payload is the existing strict `workflow_effect` variant:
  `{ type: "workflow_effect", workflowId, transitionRevision }`;
- the transition and the enqueue commit together, so a crash between them cannot leave a
  transition without its effect.

| Target status      | Effect job                                                 |
| ------------------ | ---------------------------------------------------------- |
| `running`          | enqueued, available now                                    |
| `scheduled`        | enqueued, available at `deferUntil`                        |
| `waiting_for_user` | **none** — the workflow waits for a human and holds no job |
| `completed`        | none — terminal                                            |
| `cancelled`        | none — terminal                                            |

Every transition **releases** the workflow's pending jobs first: a job left pending from an
earlier state is cancelled in the same transaction. A job that is currently _running_ is not
touched — the worker that owns it finishes it.

`applyWorkflowEffect(workflowId, transitionRevision)` applies the effect:

- it is **idempotent**: `effect_revision` only moves forward, so a retry applies nothing twice;
- it moves a `running` or `scheduled` workflow to `waiting_for_user` (the system transition), which
  is recorded in the transition history like any other transition;
- it changes nothing else.

A crash between the transition and the effect is therefore safe in both directions: before the
commit neither happened, and after the commit the job is still pending and will be applied exactly
once.

## The correction

A correction is a **self-report**: the user's own words plus the evidence the workflow already
carries. It is written to `intelligence_workflows.self_report_json` and to the transition row. It
never writes a trade, a fill, an annotation, a hash, a key or a financial revision — the engine has
no access to those tables at all, and the test asserts that the financial rows are untouched.

## Files and steps (test first)

1. **Plan** (this document) — committed first, before any implementation.
2. **Migration 0007** — the DDL, the registry entry, the checksum artifact, the typed schema and
   the bootstrap snapshot. The generic migration suite (fresh, legacy, concurrent, failure) must
   stay green; the new test file adds a 0006 → 0007 upgrade case and a checksum-binding case.
3. **Contracts** — `contracts/experience.ts`: the strict command schema, the result union, the
   statuses, the actions and the transition table.
4. **Store** — `infrastructure/experience-store.ts`: the SQLite adapter for the workflows, the
   transitions, the commands and the job release.
5. **Engine** — `experience/workflows.ts`: the state machine, the CAS, the digest, the duplicate
   path, the conflict path and the effect application.
6. **Tests** — `apps/web/tests/intelligence-workflows.test.ts`.

## Test plan (`apps/web/tests/intelligence-workflows.test.ts`)

Each case is listed with the behaviour it proves. Every case must be seen to fail when the
production behaviour is deliberately broken, and to pass again after the break is restored; the
phase report records both results.

| #   | Case                                                                          | Proves                                                      |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | creates the seven tables the phase owns                                       | the migration runs                                          |
| 2   | binds the registered checksum of 0007 to the migration source and the ledger  | the manifest is not stale                                   |
| 3   | upgrades a journal that is at 0006 to the same seven tables                   | the upgrade path                                            |
| 4   | applies a command and records the transition                                  | the happy path                                              |
| 5   | refuses a command whose expected revision is stale and changes nothing        | the CAS                                                     |
| 6   | returns the stored prior result for the same command id and the same payload  | the exact retry                                             |
| 7   | refuses the same command id with a different payload and changes nothing      | the digest                                                  |
| 8   | applies the transition and the effect enqueue in one transaction              | no half state (a failing enqueue rolls the transition back) |
| 9   | keeps the effect pending when the worker crashes and applies it exactly once  | the crash-before-effect case                                |
| 10  | holds no job while the workflow waits for the user                            | the waiting workflow is not busy                            |
| 11  | releases the workflow's job when the waiting condition clears                 | the release                                                 |
| 12  | returns a deferred workflow to the user when the deferred job fires           | scheduled → waiting_for_user                                |
| 13  | records a correction as a self-report and leaves the financial rows untouched | the correction is not a financial write                     |
| 14  | refuses a command for a workflow outside the commander's scope                | the scope rule                                              |

## Checks and stop condition

```bash
pnpm exec vitest run apps/web/tests/intelligence-workflows.test.ts
pnpm typecheck
```

The coordinator owns the full destination gate. This phase stops at a reviewed candidate: the plan
committed, the implementation committed, the phase report committed, and the source/base/tip SHAs
reported. No push, no PR, no merge into `codex/ai-native-journal`, and no Phase 17 work.
