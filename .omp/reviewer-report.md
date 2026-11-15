## Verdict: PASS

## Reviewer Report — Phase 16 workflow command/transition engine (uncommitted working tree)

### PASS / FAIL

PASS — the phase implements the committed plan (`docs/superpowers/plans/ai-native-journal/phase-16.md`)
and the packet (`docs/orchestration/ai-native-journal/tasks/T-016.md`): a persistent, versioned
workflow with recorded transition history, compare-and-swap on the expected revision, exact-retry
replay from the command ledger, a digest-bound command id, a conflict that mutates nothing, the
transition and its durable effect enqueued in one transaction, an idempotent effect, a job release
on every transition, a self-report correction, the scope rule, and migration `0007` with the whole
workflow/experience table set.

Two reviewer runs were spent, both inside the coordinator's budget of two: one on the implementation
diff before the fixes, one on the fixed diff. The first run returned FAIL with six findings; every
finding is fixed, verified by a test, and listed below. The second run confirmed all six fixes and
raised two mechanical nits (a type error and a Prettier violation) that the implementer introduced
with the fixes; both are fixed and re-verified below. No finding is open.

### Findings from run 1 and their resolutions

| # | Location | Sev | Issue | Resolution |
| - | -------- | --- | ----- | ---------- |
| 1 | `experience/workflows.ts:143` | P2 | The scope rule was applied after the command-ledger lookup, so an out-of-scope caller replaying a known command id learned the workflow's revision from the `duplicate`/`conflict` answer | The engine now loads the workflow and applies the scope check **before** the ledger lookup. Covered by "refuses an out-of-scope replay of a command it already knows" |
| 2 | `contracts/experience.ts:34` | P2 | `WORKFLOW_ACTIONS` carried six entries, so `start` and `present` parsed as commands and became conflicts instead of invalid input | Split: `WORKFLOW_ACTIONS` is the four user commands, `WORKFLOW_TRANSITION_ACTIONS` the six recorded transition actions. The command schema accepts only the four. Covered by "refuses the actions the workflow records on its own" |
| 3 | `infrastructure/experience-store.ts:108` | P2 | The adapter held the state machine (system edges, `present` row, revision bump, `effect_revision`), contradicting its own header | The system edges moved to the contract (`WORKFLOW_SYSTEM_TRANSITIONS`, `nextSystemStatus`) and the engine performs the transition. The adapter is SQL only and no longer has `applyEffectTx` |
| 4 | `infrastructure/worker.ts:221` | P2 | The worker recognises no `workflow_effect` handler, so such a job would be terminally failed | The engine exports `effectHandler()` (`workflow-effect`/`1`), tested in the caller's transaction. Registering it in `worker.ts`/`composition.ts` is a Phase 17/18 wiring step: neither file is this phase's, and nothing composes the engine yet, so no `workflow_effect` job can be enqueued in production. Recorded as a handoff item |
| 5 | `db/schema.ts:1194` | P3 | The typed schema declared a composite primary key the DDL did not create | The Drizzle `primaryKey` was removed; the typed schema and the migration DDL now agree on the unique index over the pair |
| 6 | `infrastructure/experience-store.ts:117` | P3 | `effect_revision` was written before the status/revision checks, so a declined effect advanced the marker | The effect now applies only to the revision it was enqueued for; a declined effect writes nothing and the marker advances only on the applying path |

### Findings from run 2 and their resolutions

| # | Location | Sev | Issue | Resolution |
| - | -------- | --- | ----- | ---------- |
| 7 | `apps/web/tests/intelligence-workflows.test.ts:334` | FAIL | TS2322 — the `"start" \| "present"` loop no longer assigned to the four-value action union | The command is built as `Parameters<typeof engine.transitionWorkflow>[0]`, which is the type the schema rejects at runtime; `pnpm --filter web typecheck` now exits 0 |
| 8 | `apps/web/src/server/intelligence/contracts/experience.ts:186` | FAIL | Prettier violation on the `WORKFLOW_SYSTEM_TRANSITIONS` type argument | `prettier --write` applied; `prettier --check` exits 0 on every changed file |

Two notes from run 2 were also acted on: the `workflowConversations` doc comment no longer claims a
primary key, and the unreachable `target === "running"` enqueue branch was deleted (no transition
reaches `running`).

### Independently verified

- **Contract**: CAS on the expected revision; a stale revision conflicts and mutates nothing; the
  same command id with the same payload returns the stored prior result; the same command id with a
  different payload conflicts; the transition and the effect enqueue share one transaction; the
  effect applies once and a late effect writes nothing; every transition releases the workflow's
  pending jobs and never touches a running one; a correction stores a self-report with the
  execution and correlation ids and leaves the evidence it was given; a workflow outside the
  commander's scope is refused.
- **Boundary**: `intelligence-boundaries.test.ts` 8/8 green. The engine depends on the
  `ExperienceStore` **port** in `contracts/` and never imports `infrastructure/`; the SQLite
  adapter is injected. No exemption was added to the boundary suite.
- **Migration hygiene**: `migrations:check` reports the manifest up to date; `0001`–`0006` are
  byte-unchanged (sha256 compared); `BOOTSTRAP_SQL` reuses `EXPERIENCE_SQL`, so the snapshot cannot
  drift from the migration; the typed schema mirrors the DDL column for column.
- **Financial safety**: the engine writes workflow, transition, command and job rows only. The
  correction test compares the account, note, trade and execution rows before and after and finds
  them byte-identical.
- **No engagement behaviour**: `decideEngagement`, cooldown, dismissal, expiry and opportunity
  behaviour are absent. The four Phase 17/18 tables exist and are used by nobody yet, as the phase
  guide's allocation requires.
- **Tests have teeth**: nine deliberate production breaks each failed exactly the behaviour they
  claim — CAS check, digest comparison, effect revision check, job release, transition validation,
  enqueue atomicity, scope check, command-action split, system transition. With every break restored
  the suite is 19/19 green.

### Checks run

| Command | Exit | Result |
| ------- | ---- | ------ |
| `pnpm exec vitest run apps/web/tests/intelligence-workflows.test.ts` | 0 | 19 passed |
| `pnpm exec vitest run apps/web/tests/intelligence-{boundaries,migrations,knowledge-revisions,jobs,worker}.test.ts` | 0 | 92 passed |
| `pnpm --filter web typecheck` | 0 | clean |
| `pnpm exec prettier --check <changed files>` | 0 | clean |
| `pnpm --filter web migrations:check` | 0 | manifest up to date |
