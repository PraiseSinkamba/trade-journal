## Verdict: PASS

## Reviewer Report — Phase 15 (durable time and condition scheduling)

### PASS / FAIL

PASS. Two reviewer runs were spent on this phase, both inside the coordinator's budget of two: one
on the phase plan and one on the implementation diff. Both returned FAIL with concrete findings.
Every finding is fixed in the committed code, each fix has a test that was seen to fail against the
broken behaviour and to pass again after the restore, and the evidence is recorded in
`docs/superpowers/reports/ai-native-journal-phase-15.md`.

No migration was added, `apps/web/src/db/schema.ts`, the bootstrap snapshot, the migration registry
and the checksum artifact are byte-unchanged, and no dependency was introduced. The scope
extension the coordinator granted (`contracts/jobs.ts` and `infrastructure/worker.ts`) is additive:
one strict payload variant, one routing branch, one scheduler hook.

### Plan review findings and resolutions

- **P1 — `next_due_at` had two advance owners.** Resolved: the plan now states one owner per row
  state. The tick never advances a time schedule's row; the handler advances it when the work is
  acknowledged. A condition schedule's row is advanced by the tick when the condition is not
  satisfied and by the handler when it is.
- **P1 — the condition payload could not identify the change it consumed.** Resolved: the payload
  carries `sourceId`, and the handler advances the checkpoint to exactly that change.
- **P2 — condition schedules had no due-selection semantics.** Resolved: a condition definition
  carries `pollIntervalMs`, and the plan states what a condition row's `next_due_at` holds.
- **P2 — the DST gap rule was not discriminating.** Resolved: the plan pins the exact instants
  (07:30Z for the gap, 05:30Z for the fold) and the core helpers were added and unit-tested.
- **P2 — the version lifecycle was undefined.** Resolved: the plan states the re-anchor rule, the
  version guard in the handler and the version-free condition key.

### Implementation review findings and resolutions

- **P1 — a version bump replayed a pending occurrence under the new definition.** Resolved: a
  condition occurrence is keyed by its source change rather than by the definition version, so one
  source change cannot produce two occurrences across a bump, and the handler refuses to move a row
  whose `definition_version` no longer matches the payload's version.
- **P2 — condition evaluation scanned the whole source-change log on every poll.** Resolved: the
  query is bounded by the threshold and ordered in SQL, so a poll reads only as many changes as it
  needs to decide.
- **P3 — the condition checkpoint could move backwards.** Resolved: the checkpoint only moves
  forward, so a retried older occurrence never makes an already consumed change count again.

### Files reviewed

- `apps/web/src/server/intelligence/infrastructure/scheduler.ts` (new)
- `apps/web/src/server/intelligence/contracts/jobs.ts`
- `apps/web/src/server/intelligence/infrastructure/worker.ts`
- `apps/web/src/server/intelligence/composition.ts`
- `packages/core/src/time.ts`
- `apps/web/tests/intelligence-scheduler.test.ts` (new)
- `docs/superpowers/plans/ai-native-journal/phase-15.md`
