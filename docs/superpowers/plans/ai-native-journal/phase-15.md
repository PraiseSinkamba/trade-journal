# Phase 15 — Durable time and condition scheduling

Implements the Phase 15 subset of the AI-native journal run (milestone M4, task packet T-015): the
**scheduler half** of detailed-plan Task 10. Binding scope: design §8 (§9 knowledge invariants
apply to whatever a schedule produces); contract review §§2–6; the phase guide's Phase 15 row
("Task 10 scheduler only", schema allocation `0006`).

Phase 14 delivered the source-revision contract, the ten atomic source write paths and migration
`0006` with `knowledge_sources`, `knowledge_hypotheses`, `knowledge_patterns` and
`intelligence_schedules`. It wrote **no scheduler logic** against `intelligence_schedules`. This
phase does.

## Objective and outcome

Deliver:

- `scheduleDue(now: number): number` — the deterministic tick that turns due schedules into durable
  jobs;
- time triggers keyed uniquely by `(scheduleId, dueAt, version)`;
- condition triggers that consume durable source changes against a persisted checkpoint;
- duplicate ticks that never fire twice;
- a restart after a due time that fires the missed occurrence exactly once;
- an explicit DST gap and DST fold resolution, each yielding exactly one occurrence;
- long-offline coalescing: missed occurrences collapse into one catch-up fire;
- **no model selection and no LLM call anywhere in the scheduling path**.

## Scope in

Owned files (only these may be edited):

- `apps/web/src/server/intelligence/infrastructure/scheduler.ts` (new — the scheduler, the schedule
  definitions and the trigger handler)
- `apps/web/src/server/intelligence/contracts/jobs.ts` (one new strict job payload variant)
- `apps/web/src/server/intelligence/infrastructure/worker.ts` (one routing branch for the new
  payload)
- `apps/web/src/server/intelligence/infrastructure/jobs.ts` (only if the store needs a change)
- `apps/web/src/server/intelligence/infrastructure/outbox.ts` (only if the fanout needs a change)
- `apps/web/src/server/intelligence/composition.ts` (wiring only)
- `packages/core/src/time.ts` (the pure local-time and DST arithmetic)
- `apps/web/tests/intelligence-scheduler.test.ts` (new — the only test file; it also unit-tests the
  core time helpers)
- this plan and the phase report

Schema allocation: **none**. `intelligence_schedules` from `0006` is used as it is. Migrations
`0001`–`0006` stay byte-unchanged; `schema.ts`, the bootstrap snapshot, the migration registry and
the checksum artifact are not touched. No new dependency, therefore no new ADR.

## Storage model

`intelligence_schedules` holds the durable _state_ of a schedule, not its definition:

| Column               | Meaning in this phase                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`                 | the schedule id; the same id as the code-defined schedule                                                       |
| `definition_version` | the version of the code definition the row is currently anchored to                                             |
| `next_due_at`        | epoch milliseconds: for a time schedule the next occurrence, for a condition schedule the next evaluation point |
| `checkpoint_json`    | the durable cursor a condition schedule consumes (≤ 16 KiB JSON object)                                         |

The **definition** (when it fires and under which condition) is code, not data: the scheduler is
given a registry of definitions and the table holds only the cursor and the version. This is forced
by the phase allocation — `0006` has no column for a trigger specification — and it keeps the
schedule definition reviewable in the same diff as the code that acts on it.

## Contracts

### Schedule definition (`infrastructure/scheduler.ts`)

```ts
export type ScheduleDefinition =
  | {
      readonly id: string;
      readonly version: number;
      readonly kind: "time";
      readonly cadence: "daily";
      readonly timeZone: string;
      readonly hour: number; // 0-23 local
      readonly minute: number; // 0-59 local
    }
  | {
      readonly id: string;
      readonly version: number;
      readonly kind: "time";
      readonly cadence: "interval";
      readonly everyMs: number;
    }
  | {
      readonly id: string;
      readonly version: number;
      readonly kind: "condition";
      readonly sourceKind?: SourceKind;
      readonly threshold?: number; // default 1
      readonly pollIntervalMs: number; // how often the condition is evaluated
    };
```

### The scheduler service

```ts
export interface Scheduler {
  /** Anchors missing rows, then fires every schedule that is due at `now`. */
  scheduleDue(now: number): number;
}

export const createScheduler = (deps: {
  db: JournalDb;
  jobs: JobStore;
  definitions: readonly ScheduleDefinition[];
  clock?: () => number;
}): Scheduler;
```

`scheduleDue` returns the number of occurrences that were fired at `now` — an occurrence that was
already enqueued (the same key) is not counted again. It runs in one immediate transaction: the
anchor, the due selection and the job enqueue commit together or not at all.

### The job payload (`contracts/jobs.ts`)

```ts
const scheduleTriggerPayload = z
  .object({
    type: z.literal("schedule_trigger"),
    scheduleId: z.string().min(1),
    dueAt: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    trigger: z.enum(["time", "condition"]),
    /** The source change a condition occurrence consumed; null for a time trigger. */
    sourceId: z.string().min(1).nullable(),
  })
  .strict();
```

It joins the existing strict discriminated union. No DB change: `intelligence_jobs.payload_json` is
already a JSON text column, and `intelligence_jobs.idempotency_key` is already unique.

### The trigger handler (`infrastructure/scheduler.ts`)

The worker routes a `schedule_trigger` job to the schedule handler (`worker.ts` gains one branch in
`findHandler`, mirroring the existing `seed_account` branch). The handler is deterministic, does no
network call, selects no model and reads no provider. It commits the durable effect of the trigger
inside the job's own transaction, so the effect and the acknowledgement commit together (contract
review §4, ADR 0007).

## Ownership of `next_due_at` — exactly one advance per row state

`next_due_at` is advanced in exactly one place for a given row state, so an occurrence is never
skipped and never consumed twice:

| Row state at the tick             | Who advances `next_due_at` and to what                                     |
| --------------------------------- | -------------------------------------------------------------------------- |
| time schedule, occurrence due     | the **handler**, to the first occurrence strictly after the moment it runs |
| condition schedule, not satisfied | the **tick**, to `now + pollIntervalMs`                                    |
| condition schedule, satisfied     | the **handler**, to `now + pollIntervalMs`                                 |

The tick never advances a time schedule's row. It only selects due rows and enqueues the job. The
handler advances the row when the work is acknowledged, so a crashed or never-run trigger keeps
its occurrence due and fires again with the _same_ key — the unique idempotency key makes that a
no-op rather than a second job.

## Keys

| Trigger   | Job idempotency key              | Uniqueness comes from                        |
| --------- | -------------------------------- | -------------------------------------------- |
| time      | `<scheduleId>:<dueAt>:<version>` | `intelligence_jobs.idempotency_key` (unique) |
| condition | `<scheduleId>:<sourceId>`        | `intelligence_jobs.idempotency_key` (unique) |

The time key is exactly the `(scheduleId, dueAt, version)` key the contract review names
("unique `(scheduleId, dueAt, version)` jobs make restart safe"). A condition trigger is keyed by
the durable source change that satisfied it, so two different source changes are two occurrences
and the same change is never two. The condition key deliberately carries **no** version: the
occurrence of a source change is the change itself, so a definition-version bump must not let the
same change fire a second time under a fresh key. The version still travels in the payload, and the
handler checks it before it moves a time schedule's row.

The payload carries the same `sourceId`, so the handler advances the checkpoint to the change the
job names — not to "whatever is newest now".

A duplicate tick cannot fire twice for two independent reasons: the unique idempotency key makes a
second enqueue of the same occurrence a no-op that returns the original job, and the row advance
makes the occurrence no longer due.

## Deterministic ticks and the three time cases

`next_due_at` is the only clock the scheduler reads; `now` is injected. The occurrence that is due
at `now` is `next_due_at` itself.

- **Duplicate tick.** The first tick enqueues the occurrence. The second tick finds the same
  occurrence due, computes the same key and gets the original job back — no second job, and the
  return count does not rise.
- **Restart after a due time.** The row still holds the missed `next_due_at`; the first tick after
  the restart enqueues exactly one job for it (the same key an interrupted tick would have used, so
  an interrupted enqueue cannot become two). When the handler runs, it advances the row to the
  first occurrence strictly after the moment it runs, and the schedule continues from there.
- **Long offline gap.** Missed occurrences are _not_ replayed. The handler sets `next_due_at` to the
  first occurrence strictly after the moment it runs, so a gap of a hundred days produces one fire,
  not a hundred. The one fire that does happen is the oldest missed occurrence — the one the row
  was pointing at.

For an interval schedule the next occurrence is `dueAt + everyMs * (floor((now - dueAt) / everyMs) + 1)`,
i.e. the first interval boundary strictly after the handler ran. For a daily schedule it is the next
local wall-clock occurrence, computed from the local calendar date (never by adding 24 hours).

## DST

Local-time schedules use the pure helpers in `packages/core/src/time.ts` (no dependency, no IO, no
import from `apps/web`). The helper converts a local wall-clock time to epoch milliseconds using
`Intl.DateTimeFormat` offsets, with two explicit rules:

- **Gap** — a local time that does not exist (spring forward). `America/New_York`, 2026-03-08 02:30
  does not exist: the transition is at 07:00Z. The occurrence resolves **forward through the gap**
  to the instant the _pre-transition_ offset (−05:00) maps it to: **07:30Z** (03:30 EDT locally).
  Exactly one occurrence — never zero, never two.
- **Fold** — a local time that happens twice (fall back). `America/New_York`, 2026-11-01 01:30
  happens at 05:30Z (EDT) and 06:30Z (EST). The occurrence resolves to the **earlier** instant:
  **05:30Z**. Exactly one occurrence — never zero, never two.

Both instants are pinned in the tests, so a wrong resolution fails the test.

The next occurrence of a daily schedule is derived from the local **calendar date**, not by adding a
fixed duration, so the fold's second instant (06:30Z) never becomes an occurrence of its own: the
schedule fires once on the fold day, at 05:30Z.

## Condition triggers

A condition trigger consumes the durable source-change log Phase 14 wrote (`knowledge_sources`) and
a persisted checkpoint (`checkpoint_json`).

- The checkpoint holds the last consumed source change: `{"lastRecordedAt": number, "lastSourceId": string | null}`.
- The trigger is satisfied when the number of source changes newer than the checkpoint reaches the
  threshold (default 1), optionally filtered by source kind. The query is **bounded by the
  threshold**: a poll reads only as many changes as it needs to decide, never the whole log.
- The occurrence's identity is the id of the last change of that batch; it is part of the job key
  and is carried in the payload. The checkpoint then advances to that change, so the next poll
  continues with the changes that are still pending.
- The handler advances the checkpoint to exactly that source change, so a replayed condition cannot
  fire again and a change that arrived after the tick is not silently consumed. The checkpoint only
  moves **forward**: a retried older occurrence never makes an already consumed change count again.

No model is selected and no provider is touched: the condition is evaluated over durable rows only.

## Version lifecycle

`definition.version` is owned by the code. The row's `definition_version` records the definition the
row is anchored to.

- Anchoring a missing row writes the current `definition_version`, the first occurrence (time) or
  `now + pollIntervalMs` (condition) as `next_due_at`, and a null checkpoint (condition).
- When the row's `definition_version` differs from the definition's version, the definition changed.
  The tick re-anchors the row: it writes the new `definition_version` and moves `next_due_at` to the
  first occurrence strictly after `now` (or `now + pollIntervalMs`), and leaves the checkpoint
  alone. The pending occurrence is _dropped_, not fired under the new version — so a version change
  cannot replay an occurrence under a fresh key, and the checkpoint is not reset, so a version change
  cannot replay consumed source changes.
- The handler that carries an occurrence of the old version cannot move the new definition's row: it
  reads the row's `definition_version` and does nothing when it no longer matches the payload's
  version. A condition occurrence is keyed by its source change rather than by the version, so one
  source change can never produce two occurrences across a version bump.

## Wiring (`composition.ts`)

- `createIntelligenceServices` gains the scheduler and the schedule trigger handler, so the default
  journal exposes `scheduleDue` and registers the handler with the worker.
- The worker's tick calls `scheduleDue(now)` on the worker's own connection and the worker's own
  clock, never on a request thread.

## Tests (`apps/web/tests/intelligence-scheduler.test.ts`)

Every case runs against a disposable journal, exactly like the sibling suites. The core time
helpers are unit-tested in the same file, imported from `@luxalgo/journal-core`.

| Case                     | What it proves                                                            |
| ------------------------ | ------------------------------------------------------------------------- |
| duplicate tick           | the same `(scheduleId, dueAt, version)` key can never enqueue twice       |
| restart after a due time | the missed occurrence fires exactly once, then the row continues          |
| DST gap                  | 2026-03-08 02:30 New York resolves to exactly 07:30Z                      |
| DST fold                 | 2026-11-01 01:30 New York resolves to exactly 05:30Z                      |
| long offline gap         | missed occurrences coalesce into one fire                                 |
| condition checkpoint     | the checkpoint advances to the consumed change; a replay does not re-fire |
| no model selection       | the scheduling path selects no provider and no model                      |

Each behaviour is proved by breaking the production code and watching the test fail, then restoring
it and watching the test pass again; both results are recorded in the phase report.

## Commands

```bash
pnpm exec vitest run apps/web/tests/intelligence-scheduler.test.ts
pnpm typecheck
```

The full `pnpm test` and the merged-feature gate are run by the coordinator's verification owner
after the merge, not here.

## Commits

1. `docs: plan the durable time and condition scheduling` — this plan.
2. `feat: schedule bounded intelligence and propagate source revisions` — the implementation. This
   is the detailed plan's Task 10 subject; Phase 14 already used it for the source-revision half of
   the same task, and this phase implements the scheduler half.
3. `docs: record the Phase 15 scheduler evidence` — the phase report.

## Stop condition

Done when the scheduler, its wiring and its tests are committed, the targeted test and the typecheck
pass, the review verdict is PASS, and the phase report records the evidence. Integration into
`codex/ai-native-journal` is the coordinator's job.
