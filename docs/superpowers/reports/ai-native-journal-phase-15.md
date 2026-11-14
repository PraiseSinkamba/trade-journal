# Phase 15 — Durable time and condition scheduling

Phase report for the Phase 15 subset of the AI-native journal run (milestone M4, task packet
T-015): the **scheduler half** of detailed-plan Task 10. Binding scope: design §8 (§9 knowledge
invariants apply to whatever a schedule produces); contract review §§2–6; the phase guide's Phase 15
row ("Task 10 scheduler only", schema allocation `0006`).

## Outcome

The scheduler exists and is wired. A due schedule becomes a durable job whose key names the
schedule, the due instant and the definition version, so the same occurrence can never be enqueued
twice — not by a repeated tick, not by a restart. Time triggers resolve local wall-clock times with
explicit daylight-saving rules; condition triggers consume the durable source-change log against a
persisted checkpoint that only moves forward. The scheduling path selects no provider and no model.

## Changed files

| File                                                           | Change                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/intelligence/infrastructure/scheduler.ts` | **new** — the scheduler, the schedule definitions and the trigger handler                                                   |
| `apps/web/src/server/intelligence/contracts/jobs.ts`           | one new strict `schedule_trigger` payload variant in the discriminated union                                                |
| `apps/web/src/server/intelligence/infrastructure/worker.ts`    | one routing branch for the new payload, one optional `scheduler` dependency ticked on the worker's own connection and clock |
| `apps/web/src/server/intelligence/composition.ts`              | wiring: the scheduler, the schedule handler, the scheduler dependency on the worker                                         |
| `packages/core/src/time.ts`                                    | the pure local-time helpers: `wallClockOf`, `offsetAt`, `localInstant`, `nextDailyOccurrence`                               |
| `apps/web/tests/intelligence-scheduler.test.ts`                | **new** — 14 cases                                                                                                          |
| `docs/superpowers/plans/ai-native-journal/phase-15.md`         | the phase plan, committed before the implementation                                                                         |

No other file changed. `apps/web/src/db/schema.ts`, the bootstrap snapshot, the migration registry
and `apps/web/src/db/migration-checksums.json` are byte-unchanged. No migration was added, no
dependency was introduced, no ADR was needed, and no financial, credential, hash, key or annotation
behaviour was touched.

## Migrations

None. The phase's schema allocation is "uses schedules in 0006": `intelligence_schedules`
(`id`, `definition_version`, `next_due_at`, `checkpoint_json`, `created_at`, `updated_at`) from
migration `0006` is used exactly as it is. Migrations `0001`–`0006` stay byte-unchanged.

## Exported interfaces

```ts
// apps/web/src/server/intelligence/infrastructure/scheduler.ts
export type TimeScheduleDefinition;          // daily (local wall-clock) or interval cadence
export type ConditionScheduleDefinition;      // source-change condition with a poll interval
export type ScheduleDefinition = TimeScheduleDefinition | ConditionScheduleDefinition;
export interface ScheduleCheckpoint;          // { lastRecordedAt, lastSourceId }
export interface Scheduler { scheduleDue(now: number): number }
export const createScheduler(deps): Scheduler;
export const createScheduleHandler(deps): JobHandler;
export const nextOccurrence(definition, dueAt, afterMs): number;
export const SCHEDULE_HANDLER_ID;             // "schedule-trigger"
export const SCHEDULE_HANDLER_VERSION;        // "1"

// packages/core/src/time.ts
export interface WallClock;                   // { year, month, day, hour, minute, second }
export type LocalResolution = "exact" | "gap" | "fold";
export interface LocalInstant { epochMs: number; resolution: LocalResolution }
export const wallClockOf(epochMs, timeZone): WallClock;
export const offsetAt(epochMs, timeZone): number;
export const localInstant(wall, timeZone): LocalInstant;
export const nextDailyOccurrence(timeZone, hour, minute, afterMs): number;
```

The new job payload variant:

```ts
{
  type: "schedule_trigger",
  scheduleId: string,
  dueAt: number,
  version: number,
  trigger: "time" | "condition",
  sourceId: string | null,
  handlerId: string,
  handlerVersion: string,
}
```

It is a strict discriminated-union member: no extra keys are accepted, and no existing variant was
weakened.

## Scope extension the coordinator granted

The coordinator approved two files outside the originally listed scope:

- `apps/web/src/server/intelligence/contracts/jobs.ts` — one new strict payload variant;
- `apps/web/src/server/intelligence/infrastructure/worker.ts` — one routing branch and the scheduler
  hook.

**Why it was needed.** Contract review §5 says "unique `(scheduleId, dueAt, version)` jobs make
restart safe". The durable job with that unique key _is_ the contract's mechanism;
`intelligence_jobs.idempotency_key` is already unique, so no database change was needed. The
alternative — recording the fired occurrence in the schedules row with the key inside
`checkpoint_json` — is weaker against that wording, so the coordinator granted the extension rather
than the fallback. The coordinator confirmed that neither file is owned by any other phase in the
execution manifest, so no concurrent-writer conflict exists. The changes are additive: one payload
variant, one `findHandler` branch, one optional dependency on the worker service. The worker hook
does not change the existing interactive job handling or the outbox dispatch behaviour, and no
existing worker branch was weakened.

## Commands run, with results

All commands ran in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal-p15` on Node
v24.20.0 / pnpm 11.0.8, with `JOURNAL_DATA_DIR` pointing at a disposable absolute directory and
no server or Docker process started.

| Command                                                                                                        | Exit | Result                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec vitest run apps/web/tests/intelligence-scheduler.test.ts`                                           | 0    | 14 passed (14)                                                                                                                                                                                                                                                                 |
| `pnpm --filter web typecheck`                                                                                  | 0    | `tsc --noEmit` clean                                                                                                                                                                                                                                                           |
| `pnpm --filter @luxalgo/journal-core typecheck`                                                                | 0    | `tsc --noEmit` clean                                                                                                                                                                                                                                                           |
| `pnpm --filter @luxalgo/journal-core test --run`                                                               | 0    | core suite passed                                                                                                                                                                                                                                                              |
| `pnpm exec vitest run apps/web/tests/intelligence-{scheduler,jobs,outbox,runtime,recovery,supervisor}.test.ts` | 0    | 6 files, 85 passed                                                                                                                                                                                                                                                             |
| `pnpm typecheck` (whole repo)                                                                                  | 101  | `packages/core`, `packages/importers` and `apps/web` clean; **`desktop` fails on `resource path 'binaries/node-x86_64-pc-windows-msvc.exe' doesn't exist`** — reproduced on the clean tree at the base SHA with the phase changes stashed, so it is pre-existing and unrelated |
| `pnpm format:check` (whole repo)                                                                               | 1    | 78 files fail on the **baseline tree** as well; every file this phase touched passes `prettier --check`                                                                                                                                                                        |
| `pnpm exec prettier --check <the six changed files> docs/superpowers/plans/ai-native-journal/phase-15.md`      | 0    | all clean                                                                                                                                                                                                                                                                      |

The full `pnpm test` and the merged-feature gate were **not** run here: the coordinator's brief
reserves the full destination gate for its verification owner, after the merge. The targeted
scheduler suite and the related intelligence suites were run instead.

## Fixtures

The scheduler tests use a disposable journal
(`mkdtempSync(join(tmpdir(), "journal-scheduler-"))`), imported after `JOURNAL_DATA_DIR` points at
it, exactly like the sibling suites.

- **Time triggers**: an interval schedule (`everyMs = 1 h`) and two daily schedules in
  `America/New_York` — one at 02:30 (the local time a spring-forward gap removes) and one at 01:30
  (the local time a fall-back fold makes ambiguous).
- **Condition triggers**: rows written directly into `knowledge_sources`, the durable source-change
  log Phase 14 created.
- **The local-time helpers**: real `America/New_York` transition instants — 2026-03-08 02:30 does
  not exist, 2026-11-01 01:30 happens twice.

## Results against the exact code SHA

Base SHA: `19975e03e76345ccf2b9e78e0641fdf20e614203` (the verified feature HEAD this phase
started from).

| Commit    | Subject                                                              |
| --------- | -------------------------------------------------------------------- |
| `bd6af62` | `docs: plan the durable time and condition scheduling`               |
| `949acf8` | `feat: schedule bounded intelligence and propagate source revisions` |

Implementation tip SHA: `949acf8837d64a39b71e542ad3cfb98ab9a51282` — the tree the commands above were
run against. The phase report and the reviewer report are the commit on top of it.

`feat: schedule bounded intelligence and propagate source revisions` is the detailed plan's Task 10
subject. Phase 14 already used it for the source-revision half of the same task; **this phase
implements the scheduler half**, which is why the subject repeats.

### Acceptance evidence

| Behaviour                | Result                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate ticks          | The same `(scheduleId, dueAt, version)` key can never enqueue twice: the unique `intelligence_jobs.idempotency_key` plus an explicit existence check. A second tick for the same due time returns 0 and adds no job.                                    |
| Restart after a due time | A fresh scheduler over the same journal finds the occurrence already enqueued and fires nothing; the handler then moves the schedule to the next occurrence and the schedule continues from there.                                                      |
| DST gap                  | `America/New_York` 2026-03-08 02:30 resolves to exactly **07:30Z** (03:30 EDT, forward through the gap). One occurrence, never zero and never two.                                                                                                      |
| DST fold                 | `America/New_York` 2026-11-01 01:30 resolves to exactly **05:30Z** (the earlier of the two instants). The later instant, 06:30Z, never becomes an occurrence of its own.                                                                                |
| Long offline gap         | A hundred-hour gap produces **one** catch-up fire; the handler moves the row to the first interval boundary after it ran, so the missed occurrences are skipped, not replayed.                                                                          |
| Condition checkpoint     | The checkpoint advances to exactly the change the job names; a replayed condition fires nothing; a retried older occurrence cannot move the checkpoint backwards.                                                                                       |
| No model selection       | The fired job payload carries no provider, model or endpoint fingerprint, and no row is written to `intelligence_runs`. The scheduling path reads durable rows and writes durable jobs only.                                                            |
| Version bump             | A condition occurrence is keyed by its source change rather than by the definition version, so one source change cannot fire twice across a bump; the handler refuses to move a row whose `definition_version` no longer matches the payload's version. |

## Review findings and their resolutions

Two reviewer runs were spent, both inside the coordinator's budget of two: one on the plan, one on
the implementation diff. Both returned FAIL with concrete findings; every finding is fixed and
covered by a test.

### Plan review

| Finding                                                                     | Resolution                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1 — `next_due_at` had two advance owners; the schedule skipped occurrences | The plan now states one owner per row state: the tick never advances a time schedule's row, the handler does. A condition row is advanced by the tick when the condition is not satisfied and by the handler when it is. |
| P1 — the condition payload could not identify the change it consumed        | The payload carries `sourceId`; the handler advances the checkpoint to exactly that change.                                                                                                                              |
| P2 — condition schedules had no due-selection semantics                     | A condition definition carries `pollIntervalMs`, and the plan states what a condition row's `next_due_at` holds.                                                                                                         |
| P2 — the DST gap rule was not discriminating; the helpers did not exist     | The plan pins the exact instants (07:30Z and 05:30Z); the helpers were added to `packages/core/src/time.ts` and unit-tested.                                                                                             |
| P2 — the version lifecycle was undefined                                    | The plan states the re-anchor rule, the handler's version guard and the version-free condition key.                                                                                                                      |

### Implementation review

| Finding                                                                     | Resolution                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 — a version bump replayed a pending occurrence under the new definition  | The condition key names the source change, not the version; the handler compares the row's `definition_version` with the payload's version and does nothing on a mismatch. Covered by "drops the pending occurrence when the definition version changes" and "does not let a version bump make one source change fire twice". |
| P2 — condition evaluation scanned the whole source-change log on every poll | The query is ordered in SQL and bounded by the threshold, so a poll reads only as many changes as it needs to decide.                                                                                                                                                                                                         |
| P3 — the condition checkpoint could move backwards                          | The checkpoint only moves forward, so a retried older occurrence never makes an already consumed change count again. Covered by "never lets a retried older occurrence move the checkpoint backwards".                                                                                                                        |

The reviewer also confirmed independently: the DST arithmetic against a minute-resolution oracle
over 13 zones across the 2026 transitions with zero mismatches; the gap/fold instants, the
coalescing values and the `next_due_at` values match the plan's pinned values; the occurrence keys,
the ownership of `next_due_at` and the no-provider/no-LLM constraint all hold.

## Proof of teeth

Every behaviour claimed above was proved by deliberately breaking the production code, watching the
test fail, restoring the code and watching the test pass again. All breaks were made on the
committed implementation, and each restore was verified by a full green run of the suite.

| Break                                                                             | Result while broken                                                                                                                                                                                 | Result after restore |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| The duplicate-tick existence check is skipped (`if (existing && false) continue`) | **4 failed**, 10 passed — "fires a due schedule exactly once…", "fires the missed occurrence once after a restart…", "fires once on the gap day", "never fires the later instant of a fold"         | 14 passed            |
| The DST gap resolves to the later instant instead of the pre-transition offset    | **3 failed**, 11 passed — "resolves a daylight-saving gap forward through the gap", "gives one occurrence per local day across a transition", "fires once on the gap day"                           | 14 passed            |
| The DST fold resolves to the later instant instead of the earlier one             | **3 failed**, 11 passed — "resolves a daylight-saving fold to the earlier of the two instants", "gives one occurrence per local day across a transition", "never fires the later instant of a fold" | 14 passed            |
| Interval coalescing replays the missed intervals (`elapsed = 0`)                  | **1 failed**, 13 passed — "coalesces the missed occurrences into one fire"                                                                                                                          | 14 passed            |
| The condition handler stops writing the checkpoint                                | **2 failed**, 12 passed — "never lets a retried older occurrence move the checkpoint backwards", "does not re-fire a condition whose checkpoint already consumed the change"                        | 14 passed            |
| The handler's definition-version guard is removed                                 | **1 failed**, 13 passed — "drops the pending occurrence when the definition version changes"                                                                                                        | 14 passed            |
| The condition key carries the definition version again                            | **3 failed**, 11 passed — "fires on a source change", "does not let a version bump make one source change fire twice", "never lets a retried older occurrence move the checkpoint backwards"        | 14 passed            |
| The checkpoint monotonicity guard is removed                                      | **1 failed**, 13 passed — "never lets a retried older occurrence move the checkpoint backwards"                                                                                                     | 14 passed            |
| The bounded condition query loses its `limit`                                     | **1 failed**, 13 passed — "never lets a retried older occurrence move the checkpoint backwards"                                                                                                     | 14 passed            |

The last break is worth spelling out: removing the `limit` makes the poll read the whole log, so
the second pending source change is consumed by the same occurrence and the checkpoint lands on the
wrong change. The test catches it, so the bound is load-bearing rather than decorative.

## Deviations

- **Two files outside the originally listed scope** (`contracts/jobs.ts`, `infrastructure/worker.ts`)
  were taken with the coordinator's explicit approval, for the reason recorded above.
- **The definition of a schedule lives in code, not in a row.** `intelligence_schedules` has no
  column for a trigger specification and the phase may not add one, so the scheduler is given a
  registry of definitions and the table holds only the cursor and the version. The row's
  `definition_version` records which definition the row is anchored to.
- **A condition occurrence is keyed by its source change, not by `(scheduleId, dueAt, version)`.**
  The `(scheduleId, dueAt, version)` key applies to time triggers, as contract review §5 states. A
  condition's occurrence _is_ the source change that satisfied it, so keying it by the version would
  let one change fire twice across a version bump. The version still travels in the payload.
- **`pnpm typecheck` fails on the `desktop` package** and `pnpm format:check` fails on 78 files,
  both on the clean baseline tree as well. Both are pre-existing on this host and unrelated to this
  phase; the packages this phase touches (`packages/core`, `apps/web`) typecheck clean.
- **The full `pnpm test` was not run here.** The coordinator's brief reserves the full destination
  gate for its verification owner after the merge.

## Next-phase handoff inputs

- `intelligence_schedules` is now written and driven. A later phase that owns scheduled work
  registers a `ScheduleDefinition` in the composition and gets its occurrence as a durable
  `schedule_trigger` job.
- The fired schedule's durable effect today is the schedule's own state moving on (`next_due_at` and
  the condition checkpoint). The work a schedule stands for — an evaluation, a workflow transition —
  is owned by a later phase and plugs in as the handler for that schedule id.
- The condition trigger consumes `knowledge_sources`, the durable source-change log Phase 14
  created. It reads it with a bounded, ordered query, so a later phase can add source kinds
  without a migration.
- `packages/core/src/time.ts` now exposes `localInstant` and `nextDailyOccurrence`, so a later phase
  that needs user-local scheduling has the same daylight-saving behaviour instead of writing its
  own.
- The scheduler runs on the worker's own connection and the worker's own clock, never on a request
  thread. A later phase that adds an interactive surface must not call `scheduleDue` from a route.
