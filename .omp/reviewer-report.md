## Verdict: PASS

## Reviewer Report — Phase 16 repair: the workflow domain layer and its definition version

### PASS / FAIL

PASS — this report covers **only the repair diff** on top of `d84150b` (the Phase 16 implementation
and its report). It closes the two findings of the Phase 16 implementation-diff review and changes
nothing else: no behaviour outside the two findings moved, no migration, dependency, schema,
provider, financial, hash, key or annotation change is present, and migrations `0001`–`0007` are
byte-unchanged.

### Findings and their resolutions

| # | Location                                            | Sev   | Issue                                                                                                                                        | Resolution                                                                                                                                                          |
| - | --------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `apps/web/src/server/intelligence/experience/workflows.ts:3` | BLOCK | The domain layer imported `withConnectionTransaction` as a **runtime** value from `@/db/transaction`. That module reaches `@/db/connection`, whose module-level `db` singleton opens the journal and runs the migration runner **at import time**, so importing the domain layer performed a database side effect and bound the domain to the database layer. | The transaction is now an **injected seam**: `createWorkflowEngine` takes `runInTransaction: RunInTransaction` and every database import in the domain layer is **type-only**. `deps.db` is gone — it had no other use. |
| 2 | `apps/web/src/server/intelligence/experience/workflows.ts:175,249` | FAIL  | `definition_key` / `definition_version` were written on every workflow and never read. The legality of a transition came from `WORKFLOW_TRANSITIONS[status][action]` alone, so a workflow stored under a different definition or version was still advanced by review-observation v1 rules. | The legal-transition source is now keyed by **(definition, version)**: `WORKFLOW_DEFINITIONS` in `contracts/experience.ts` holds the rules of each definition version, and the engine resolves the stored workflow's own definition before any transition. An unsupported definition or version is **refused**, never advanced. |

### Independently verified

- **Domain boundary**: importing `experience/workflows.ts` opens no journal — the data directory
  stays empty. Proven by the new case "performs no database side effect when the domain layer is
  imported", which fails with `journal.db`, `journal.db-shm` and `journal.db-wal` when a runtime
  database import is put back.
- **Injected seam**: the engine's work runs through the injected `runInTransaction`, proven by the
  new case "runs its work through the injected transaction seam", which counts the seam calls of
  `startWorkflow` and `applyWorkflowEffect`.
- **Definition version**: a workflow stored under an unknown definition, and one stored under an
  unsupported **version** of the supported definition, are both refused — the command returns
  `{kind:"conflict"}`, the revision, the status, the transition history and the command ledger all
  stay untouched, and the effect does not advance them.
- **Format and type**: `prettier --check` clean on the three changed files; `pnpm --filter web
  typecheck` exits 0.
- **Tests**: `pnpm exec vitest run apps/web/tests/intelligence-workflows.test.ts
  apps/web/tests/intelligence-knowledge-revisions.test.ts` — 51 passed (24 workflow cases, 27
  knowledge-revision cases). The boundary suite (8 cases) and the migration suite (17 cases) are
  green, and `pnpm --filter web migrations:check` reports the checksum manifest up to date.

### Teeth

Each of the two findings was proved by deliberately breaking the production code, watching the new
case fail, and restoring it:

| Break                                                                | While broken                                                                                                      | After restore |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------- |
| A runtime import of `@/db/transaction` back into the domain layer    | **5 failed**, 19 passed — the purity case lists the three journal files it opened; the other four fail because the domain layer closed the journal it had no business touching | 24 passed     |
| An unsupported definition inherits the v1 rules (command path)       | **2 failed**, 22 passed — both new "refuses a command…" cases                                                      | 24 passed     |
| An unsupported definition inherits the v1 rules (effect path)        | **1 failed**, 23 passed — "does not advance a workflow it does not support when its effect runs"                     | 24 passed     |
| The whole original engine (both findings present)                   | **21 failed**, 3 passed — every new case fails                                                                    | 24 passed     |

### Out of scope, unchanged

No engagement policy (Phase 17), no worker registration, no schema or migration change, no
dependency, no financial write, no correction outside the workflow's own self-report.
