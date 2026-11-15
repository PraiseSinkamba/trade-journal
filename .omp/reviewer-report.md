## Verdict: PASS

# Reviewer Report — Phase 18 repair diff (inactive observation and revoked scope)

Slice reviewed: the uncommitted Phase 18 repair working tree against `HEAD` = `ddbd0db` ("docs: record
the Phase 18 interaction API evidence"). One review, per the repair budget.
Plan of record: `docs/superpowers/plans/ai-native-journal/phase-18.md`.

## PASS

Files in the slice (nothing outside the owned set):

- `apps/web/src/app/api/intelligence/queries.ts` (modified) — `findActiveObservation` replaces
  `findObservation`; the status predicate is in the read model. `observationOfRevision` keeps its
  status-agnostic lookup and documents why.
- `apps/web/src/app/api/intelligence/observations/route.ts` (modified) — the POST reads the active
  observation and refuses a non-active one with `400 invalid_request` before any evidence is read and
  before any workflow is started.
- `apps/web/tests/intelligence-routes.test.ts` (modified) — two new cases; `seedObservation` gained an
  optional `status` parameter that defaults to `"active"`, so every earlier caller is unchanged.

Nothing else changed. `apps/web/src/server/intelligence/experience/commands.ts` is byte-identical to
`HEAD` (sha256 verified): the revoked-scope behaviour was already correct and only its proof was
missing.

### What the review checked

- **Finding 1 — a review of an inactive observation (FAIL before, PASS now).** The POST selected the
  observation by id with no status predicate, so an `invalidated` or `superseded` observation could
  still start a review workflow, against the route's own docstring, the phase plan's route table
  ("one active observation") and the GET surface (`status = "active"`). The lookup now filters
  `status = "active"` in the read model, exactly like `listObservations`. The refusal happens before
  `evidenceOf` and before `workflowEngine.startWorkflow`. `startWorkflow` has one caller in
  `apps/web/src` — the review route — so no other review path is left open.
- **Finding 2 — the revoked-scope refusal had no independent proof (proof added).** The pre-existing
  unknown-account case targeted an account-bound workflow, where the workflow-scope rule refuses the
  same request with the same body; removing the unknown-account check left the suite green. The new
  case opens a journal-wide workflow (`accountId: null`), where the workflow-scope rule cannot
  refuse: the commands route does not use `resolveScope`, and step 6 of the service skips a
  `null`-account workflow. Only the revoked-scope rule can refuse it. The case also asserts the engine
  never ran and that no command row was written.
- **The other observation reads were checked, deliberately left alone.**
  `observationOfRevision` attributes an evidence revision to an account for the dismissal scope; that
  attribution must outlive the observation's lifecycle, so it stays status-agnostic and says so in its
  docstring. The conversations surface reads no observation at all (`listConversations` filters
  `status = "open"`, `listMessages` filters by conversation).
- **No other behaviour changed.** The origin policy, the status codes, the action-id authorisation,
  the stale-action refusals, the purge race and the scoped GET surfaces are untouched.

### The proof of teeth

Every new case was broken once, seen to fail, and restored.

| Behaviour | Test | Broken run | Restored run |
| --- | --- | --- | --- |
| An invalidated or superseded observation cannot start a review | `the observation reviews > refuses to start a review of an observation that is no longer active` | the unfixed lookup → **1 failed**: "expected 200 to be 400" | restored → 21 passed |
| A command that names an account that does not exist is refused, even against a journal-wide workflow | `the scope policy > refuses a command that names an unknown account against a journal-wide workflow` | the revoked-scope check disabled (`if (false && …)`) → **1 failed**: "expected 200 to be 403" | restored → 21 passed |

The reviewer repeated both mutations in a scratch copy outside the repository, and additionally
relaxed the status assertions alone: the spy assertions then fail on their own
(`startWorkflow` called 2×, `transitionWorkflow` called 1×). Both new cases can fail for the reason
they claim.

### Hard blocks

- [PASS] no new dependency — `package.json` and `pnpm-lock.yaml` untouched; `node scripts/check-licenses.mjs` → exit 0.
- [PASS] no schema or migration change — `apps/web/src/db/**` untouched; `0001`–`0007` byte-unchanged.
- [PASS] no raw `fetch`/`axios`/`http.` in `packages/importers/src` — grep, no match.
- [PASS] the trade-key format in `packages/core/src/round-trips.ts` is unchanged.
- [PASS] no existing test weakened or deleted.
- [PASS] no React component, no new route, no schema, no migration.

### Commands run (exit codes)

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm exec vitest run apps/web/tests/intelligence-routes.test.ts` | 0 | 21 passed |
| `pnpm --filter web typecheck` | 0 | `next typegen` + `tsc --noEmit` clean |
| `pnpm exec prettier --check <the three touched files>` | 0 | all three prettier-clean |
| `pnpm exec vitest run apps/web/tests/intelligence-boundaries.test.ts intelligence-workflows.test.ts intelligence-engagement.test.ts` | 0 | 70 passed |
| `pnpm exec vitest run apps/web/tests/intelligence-observations.test.ts intelligence-jobs.test.ts intelligence-migrations.test.ts intelligence-supervisor.test.ts intelligence-worker.test.ts intelligence-boundaries.test.ts` | 0 | 85 passed |
| `node scripts/check-licenses.mjs` | 0 | licenses OK |

The root `pnpm typecheck` and the whole-project `pnpm test` were not run: the root typecheck fails in
the `desktop` Rust package on this host (the Tauri sidecar binary is not tracked), and the
whole-project gate belongs to the coordinator after the merge.

### Findings

- [PASS] finding 1 — the active-observation predicate is in the read model and the refusal precedes
  the evidence read and the workflow start.
- [PASS] finding 2 — the revoked-scope refusal is now proven independently of the workflow-scope rule.
- [P3] `docs/superpowers/reports/ai-native-journal-phase-18.md` does not yet carry this repair's
  evidence (the teeth table still lists 19 tests, the commands table still says 19 passed). The
  repair commits the report update separately; nothing false is said about the code in the meantime.
  **Resolved in the follow-up report commit** (`docs: record the Phase 18 observation and scope
  repair`): the phase report now carries the repair section, both teeth results and the repair's own
  commands.

### Summary

6 PASS, 0 FAIL, 0 BLOCK (the P3 note is a record-keeping item, not a defect of the diff).
