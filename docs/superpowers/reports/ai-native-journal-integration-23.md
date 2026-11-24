# Phase B integration - fenced provider job for the review question

## Outcome

Phase B was merged into `codex/ai-native-journal` at `06a443fd5a1f299363b9cee1be76b18fb4048107` and the destination gate passed.

- Destination branch: `codex/ai-native-journal`
- Destination-before SHA: `4ae65be404eafcd6c4f80c30bf879a8512dda90c`
- Candidate base SHA: `96115f9170201da2fd581bc6ade2aec922c32b67`
- Candidate tip SHA: `86c979e3956e4bd3c261a53c4d0f6e3de081f2b5`
- Merge SHA: `06a443fd5a1f299363b9cee1be76b18fb4048107` (`--no-ff`, subject `Merge Phase B: fenced provider job for the review question`)
- Merge parents: `4ae65be404eafcd6c4f80c30bf879a8512dda90c` and `86c979e3956e4bd3c261a53c4d0f6e3de081f2b5`
- The candidate base was resolved at run time as `git merge-base codex/ai-native-journal-p23 codex/ai-native-journal`; no SHA is hardcoded in the integration script.

## Candidate commits

```
86c979e Correct the operations guide and pin the enqueue's account gate
9110173 Close the review question's coverage holes and correct the guide
e7f9210 test(intelligence): pin the review question's refusals
a5a15aa docs(intelligence): say where each refusal reason lands
576678d fix(intelligence): record the provider call and close the legacy path
865fa2b docs: record the Phase 23 provider job evidence
340b4d1 Ask the provider one review question per live trade, through a fenced job
ad49145 docs: plan the fenced provider job for the review question
```

## Changed-file summary

```
.omp/reviewer-report.md                            |  170 ++-
 apps/web/src/server/ai-review-insight.ts           |   78 ++
 apps/web/src/server/intelligence/composition.ts    |  115 +-
 .../server/intelligence/contracts/capabilities.ts  |   32 +
 .../src/server/intelligence/contracts/insights.ts  |  156 ++-
 apps/web/src/server/intelligence/contracts/jobs.ts |   81 ++
 .../src/server/intelligence/contracts/policy.ts    |  137 ++
 .../intelligence/infrastructure/environment.ts     |   45 +
 .../intelligence/infrastructure/insight-store.ts   |  149 ++-
 .../intelligence/infrastructure/policy-store.ts    |  128 +-
 .../infrastructure/review-transport.ts             |   58 +
 .../server/intelligence/infrastructure/worker.ts   |  206 ++-
 .../server/intelligence/runtime/capability-job.ts  |  403 ++++++
 .../server/intelligence/runtime/model-policy.ts    |    3 +-
 .../server/intelligence/runtime/review-enqueue.ts  |  157 +++
 .../server/intelligence/runtime/review-insight.ts  |   58 +
 apps/web/src/server/settings.ts                    |   67 +-
 apps/web/tests/intelligence-jobs.test.ts           |    4 +-
 apps/web/tests/intelligence-review-insight.test.ts | 1347 ++++++++++++++++++++
 docs/intelligence-operations.md                    |  251 +++-
 .../plans/ai-native-journal/phase-23.md            |  234 ++++
 .../reports/ai-native-journal-phase-23.md          |  353 +++++
 22 files changed, 4075 insertions(+), 157 deletions(-)
```

22 candidate files, 22 files in the merge.

Merged files:

- `.omp/reviewer-report.md`
- `apps/web/src/server/ai-review-insight.ts`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/contracts/capabilities.ts`
- `apps/web/src/server/intelligence/contracts/insights.ts`
- `apps/web/src/server/intelligence/contracts/jobs.ts`
- `apps/web/src/server/intelligence/contracts/policy.ts`
- `apps/web/src/server/intelligence/infrastructure/environment.ts`
- `apps/web/src/server/intelligence/infrastructure/insight-store.ts`
- `apps/web/src/server/intelligence/infrastructure/policy-store.ts`
- `apps/web/src/server/intelligence/infrastructure/review-transport.ts`
- `apps/web/src/server/intelligence/infrastructure/worker.ts`
- `apps/web/src/server/intelligence/runtime/capability-job.ts`
- `apps/web/src/server/intelligence/runtime/model-policy.ts`
- `apps/web/src/server/intelligence/runtime/review-enqueue.ts`
- `apps/web/src/server/intelligence/runtime/review-insight.ts`
- `apps/web/src/server/settings.ts`
- `apps/web/tests/intelligence-jobs.test.ts`
- `apps/web/tests/intelligence-review-insight.test.ts`
- `docs/intelligence-operations.md`
- `docs/superpowers/plans/ai-native-journal/phase-23.md`
- `docs/superpowers/reports/ai-native-journal-phase-23.md`

## Ownership verdict

```
.omp/reviewer-report.md: ALLOWED (local artifact (tracked but gitignored, never staged))
apps/web/src/server/ai-review-insight.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/composition.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/contracts/capabilities.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/contracts/)
apps/web/src/server/intelligence/contracts/insights.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/contracts/)
apps/web/src/server/intelligence/contracts/jobs.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/contracts/)
apps/web/src/server/intelligence/contracts/policy.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/contracts/)
apps/web/src/server/intelligence/infrastructure/environment.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/infrastructure/)
apps/web/src/server/intelligence/infrastructure/insight-store.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/infrastructure/)
apps/web/src/server/intelligence/infrastructure/policy-store.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/infrastructure/)
apps/web/src/server/intelligence/infrastructure/review-transport.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/infrastructure/)
apps/web/src/server/intelligence/infrastructure/worker.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/infrastructure/)
apps/web/src/server/intelligence/runtime/capability-job.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/runtime/)
apps/web/src/server/intelligence/runtime/model-policy.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/runtime/)
apps/web/src/server/intelligence/runtime/review-enqueue.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/runtime/)
apps/web/src/server/intelligence/runtime/review-insight.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/runtime/)
apps/web/src/server/settings.ts: ALLOWED (owned file)
apps/web/tests/intelligence-jobs.test.ts: ALLOWED (owned directory prefix: apps/web/tests/)
apps/web/tests/intelligence-review-insight.test.ts: ALLOWED (owned directory prefix: apps/web/tests/)
docs/intelligence-operations.md: ALLOWED (owned file)
docs/superpowers/plans/ai-native-journal/phase-23.md: ALLOWED (owned file)
docs/superpowers/reports/ai-native-journal-phase-23.md: ALLOWED (owned file)
OWNERSHIP VERDICT: ALLOWED
```

The Phase B ownership set is the exact files `apps/web/src/server/ai-runtime.ts`, `apps/web/src/server/ai-review-insight.ts`, `apps/web/src/server/settings.ts`, `apps/web/src/server/intelligence/composition.ts`, `docs/intelligence-operations.md`, `docs/superpowers/plans/ai-native-journal/phase-23.md`, `docs/superpowers/reports/ai-native-journal-phase-23.md`; the directory prefixes `apps/web/src/server/intelligence/runtime/`, `apps/web/src/server/intelligence/infrastructure/`, `apps/web/src/server/intelligence/experience/`, `apps/web/src/server/intelligence/contracts/`, `apps/web/tests/`; the local artifact `.omp/reviewer-report.md` (tracked but gitignored, never staged); and no other prefixes. This phase genuinely spans the intelligence tree, so the coordinator granted those directories rather than fixed file names: every path a prefix accepts is PRINTED and MARKED as prefix-derived below, so the review sees exactly what a prefix let through. This phase owns NO route: `apps/web/src/app/api/` is deliberately absent from the allow-list, because those handlers were Phase 18's, so any change under that directory aborts the merge. No owned path reaches `apps/web/src/db/`, so this phase still owns no schema path and no migration. The extension points `PLAN_EXTENSION` and `COORDINATOR_EXTENSION` are empty arrays, so widening the allow-list is a deliberate edit, never a silent side effect.

The 15 path(s) below were accepted by a directory prefix and are MARKED as prefix-derived. They are listed here so the review can see exactly what a prefix let through.

Paths accepted through a directory prefix:

- `apps/web/src/server/intelligence/contracts/capabilities.ts` — prefix: `apps/web/src/server/intelligence/contracts/` (prefix-derived)
- `apps/web/src/server/intelligence/contracts/insights.ts` — prefix: `apps/web/src/server/intelligence/contracts/` (prefix-derived)
- `apps/web/src/server/intelligence/contracts/jobs.ts` — prefix: `apps/web/src/server/intelligence/contracts/` (prefix-derived)
- `apps/web/src/server/intelligence/contracts/policy.ts` — prefix: `apps/web/src/server/intelligence/contracts/` (prefix-derived)
- `apps/web/src/server/intelligence/infrastructure/environment.ts` — prefix: `apps/web/src/server/intelligence/infrastructure/` (prefix-derived)
- `apps/web/src/server/intelligence/infrastructure/insight-store.ts` — prefix: `apps/web/src/server/intelligence/infrastructure/` (prefix-derived)
- `apps/web/src/server/intelligence/infrastructure/policy-store.ts` — prefix: `apps/web/src/server/intelligence/infrastructure/` (prefix-derived)
- `apps/web/src/server/intelligence/infrastructure/review-transport.ts` — prefix: `apps/web/src/server/intelligence/infrastructure/` (prefix-derived)
- `apps/web/src/server/intelligence/infrastructure/worker.ts` — prefix: `apps/web/src/server/intelligence/infrastructure/` (prefix-derived)
- `apps/web/src/server/intelligence/runtime/capability-job.ts` — prefix: `apps/web/src/server/intelligence/runtime/` (prefix-derived)
- `apps/web/src/server/intelligence/runtime/model-policy.ts` — prefix: `apps/web/src/server/intelligence/runtime/` (prefix-derived)
- `apps/web/src/server/intelligence/runtime/review-enqueue.ts` — prefix: `apps/web/src/server/intelligence/runtime/` (prefix-derived)
- `apps/web/src/server/intelligence/runtime/review-insight.ts` — prefix: `apps/web/src/server/intelligence/runtime/` (prefix-derived)
- `apps/web/tests/intelligence-jobs.test.ts` — prefix: `apps/web/tests/` (prefix-derived)
- `apps/web/tests/intelligence-review-insight.test.ts` — prefix: `apps/web/tests/` (prefix-derived)

## Schema verdict

SCHEMA VERDICT: ALLOWED
SCHEMA VERDICT: ALLOWED — this phase owns no migration and no schema change, and migrations 0001 through 0008 are byte-unchanged.

- Schema allocation: NO new schema expected. This phase owns NO migration and NO schema change. The migration diff against the merge base `96115f9170201da2fd581bc6ade2aec922c32b67` is empty: `git diff --name-status --find-renames 96115f9170201da2fd581bc6ade2aec922c32b67..86c979e3956e4bd3c261a53c4d0f6e3de081f2b5 -- apps/web/src/db/migrations/` returned no path, so no migration file was added, deleted or renamed anywhere under `apps/web/src/db/migrations/`.
- No path under `apps/web/src/db/` changed at all: the schema, the bootstrap snapshot, the migration registry `apps/web/src/db/migrations.ts` and the checksum artifact `apps/web/src/db/migration-checksums.json` are untouched. The diff `git diff --name-status --find-renames 96115f9170201da2fd581bc6ade2aec922c32b67..86c979e3956e4bd3c261a53c4d0f6e3de081f2b5 -- apps/web/src/db/` returned no path, so not even a code file under the database tree changed.
- Migrations `0001 through 0008` are byte-unchanged against the merge base `96115f9170201da2fd581bc6ade2aec922c32b67`: the git blob hash of every migration file is identical at the merge base and at the candidate tip.

| Migration | File                                                         | Git blob hash                                           |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `0001`    | `apps/web/src/db/migrations/0001-legacy-baseline.ts`         | `5a2fd458699ecc523a237b9c13b33f35251c8453` (base = tip) |
| `0002`    | `apps/web/src/db/migrations/0002-trade-projections.ts`       | `ae720a2c5beff259a16c71891548dd7f8e82b46e` (base = tip) |
| `0003`    | `apps/web/src/db/migrations/0003-durable-jobs.ts`            | `030b6a8bf7688eaa4d8113665cba6cf526a8ef03` (base = tip) |
| `0004`    | `apps/web/src/db/migrations/0004-observations.ts`            | `103bb72ea3b71c6d0ef047eb57cd6e4df2292f9e` (base = tip) |
| `0005`    | `apps/web/src/db/migrations/0005-intelligence-runtime.ts`    | `353e55137c567af27e854fe9d2c6c4bb26c1ce4b` (base = tip) |
| `0006`    | `apps/web/src/db/migrations/0006-knowledge-scheduling.ts`    | `86bdbf2fe7facb7565c2b3d253042e22dd2d6185` (base = tip) |
| `0007`    | `apps/web/src/db/migrations/0007-intelligence-experience.ts` | `fe693722d11445f2b6b73623d288a9199c2efdff` (base = tip) |
| `0008`    | `apps/web/src/db/migrations/0008-ai-insights.ts`             | `923e98c408a5cd127e381c0c8e1b2f90a3f1960f` (base = tip) |

## Layer-boundary verdict

LAYER BOUNDARY VERDICT: ALLOWED

- Scope: the boundary rules apply to the TypeScript tree only (.ts and .tsx). A .rs file, a .yml file, a .mjs script, a .py file, a Dockerfile and a markdown file are not TypeScript and are not checked against these rules.
- Contracts layer (`apps/web/src/server/intelligence/contracts/`): no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Contracts layer files: every file in the contracts directory (`apps/web/src/server/intelligence/contracts/`) obeys the same purity rule as the other contracts - no runtime import of a database module, a Next module, an AI SDK module or a workspace package. A type-only database import is reported, not counted. Phase B owns the contracts directory as a prefix, so a contracts file it changed is in scope, but the purity rule is kept from Phase 18 and applies to every contracts file.
- Knowledge layer (`apps/web/src/server/intelligence/knowledge/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Experience layer (`apps/web/src/server/intelligence/experience/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package. A type-only database import is reported, not counted.
- Experience layer database rule: the experience domain layer must have NO runtime import of a database module. The database module opens the journal at import time, so a runtime import turns importing the domain layer into a database side effect and binds the domain layer to the database layer. Only a type-only database import is allowed. A type-only database reference is reported and not counted; a runtime database import is counted and fails this check.
- Runtime layer (`apps/web/src/server/intelligence/runtime/`): no direct runtime database import. Persistence is reached through the infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`), which is exempt. A type-only database reference creates no runtime dependency, so it is reported, not counted.
- Pure core package (`packages/core/src/time.ts`): no import from `apps/web`, no import through the `@/` path alias and no import of any workspace package. `packages/core` has zero dependencies and never imports from `apps/web`; a violation there is a cross-boundary import and fails this check. A type-only import counts as a violation too.
- Route directory (`apps/web/src/app/api/intelligence/`): this phase owns NO route, so nothing under `apps/web/src/app/api/` may change and the ownership verdict rejects any such change. The Phase 18 rule is kept unchanged: the handlers in that directory must not import a database module at runtime beyond what the repository's existing route handlers already do. The baseline was computed at the candidate tip from every existing route handler outside the new directory: `@/db`, `drizzle-orm`. A runtime database import of a module outside that baseline is counted and fails this check; a runtime import inside the baseline follows the existing route handler pattern; a type-only database reference is reported, not counted.
- Shared client-side interaction module (`apps/web/src/lib/intelligence-interactions.ts`): the module is bundled for the browser, so it must not import a database module, a Next server module or a Node-only module the browser bundle cannot resolve. A runtime import is counted and fails this check; a type-only database reference is reported, not counted. This Phase 18 rule is kept unchanged.
- Browser layers (`apps/web/src/components/`, `apps/web/src/lib/`, `apps/web/src/app/settings/`): these directories are BROWSER code. They must import NO runtime database module, NO Next server module (`next/server`, `next/headers`, `next/cache`, `server-only`) and NO Node-only module the browser bundle cannot resolve. A type-only database reference is reported as `file:line: text`, not counted; a runtime import is counted and fails this check. The separate shared-interaction-module rule above is kept unchanged.
- Server code (`apps/web/src/server/`): this phase touches almost only server code, tests and documentation. Server code is EXPECTED to import the database. The infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`) is exempt from the no-runtime-database rule, exactly as in the earlier phases; the runtime layer still reaches persistence through infrastructure.

Contracts layer imports (apps/web/src/server/intelligence/contracts/):

```
  apps/web/src/server/intelligence/contracts/experience.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/insights.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/policy.ts:4: import type { JournalTx } from "@/db/transaction";
```

Route directory database-importing lines (apps/web/src/app/api/intelligence/, Phase 18's directory; this phase owns no route) - every line as file:line: text:

```
  apps/web/src/app/api/intelligence/queries.ts:1: import { and, asc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";   [runtime, matches the existing route handler pattern database import]
  apps/web/src/app/api/intelligence/queries.ts:2: import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";   [type-only database import]
  apps/web/src/app/api/intelligence/queries.ts:12: } from "@/db";   [runtime, matches the existing route handler pattern database import]
  apps/web/src/app/api/intelligence/retention/route.ts:4: import { accounts, db, dataDir, intelligenceSeedCheckpoints } from "@/db";   [runtime, matches the existing route handler pattern database import]
```

Route directory type-only database references (apps/web/src/app/api/intelligence/) - reported, not counted:

```
  apps/web/src/app/api/intelligence/queries.ts:2: import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
```

Route directory runtime database imports (apps/web/src/app/api/intelligence/) - counted when they go beyond the existing route handler pattern:

```
  apps/web/src/app/api/intelligence/queries.ts:1: import { and, asc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";   [not counted]
  apps/web/src/app/api/intelligence/queries.ts:12: } from "@/db";   [not counted]
  apps/web/src/app/api/intelligence/retention/route.ts:4: import { accounts, db, dataDir, intelligenceSeedCheckpoints } from "@/db";   [not counted]
```

Shared client-side interaction module imports (apps/web/src/lib/intelligence-interactions.ts) - a database module, a Next server module or a Node-only module is a violation:

```
  (none)
```

Browser layer imports (apps/web/src/components/, apps/web/src/lib/, apps/web/src/app/settings/) - a runtime database module, Next server module or Node-only module is counted; a type-only database reference is reported, not counted:

```
  (none)
```

Browser layer database-importing lines - every line as file:line: text:

```
  (none)
```

Browser layer database imports counted as layer boundary violations:

```
  (none)
```

Experience layer imports (apps/web/src/server/intelligence/experience/):

```
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
```

Experience layer database imports (apps/web/src/server/intelligence/experience/): a runtime import is counted, a type-only reference is reported:

```
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";   [type-only database import]
```

Core package imports (packages/core/src/time.ts):

```
  (none)
```

Database-importing lines (file:line: text):

```
  apps/web/src/server/ai-capabilities.ts:33: } from "@/db";
  apps/web/src/server/ai-capabilities.ts:34: import { eq } from "drizzle-orm";
  apps/web/src/server/ai-capabilities.ts:35: import { sql } from "drizzle-orm";
  apps/web/src/server/ai-scope.ts:7: import { db, accounts, playbooks } from "@/db";
  apps/web/src/server/crypto.ts:4: import { dataDir } from "@/db";
  apps/web/src/server/ctrader-mcp/sync.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/ctrader-mcp/sync.ts:3: import { db, accounts } from "@/db";
  apps/web/src/server/ctrader-mcp/sync.ts:4: import { withJournalTransaction } from "@/db/transaction";
  apps/web/src/server/demo.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/demo.ts:3: import { accounts } from "@/db";
  apps/web/src/server/demo.ts:4: import { withJournalTransaction } from "@/db/transaction";
  apps/web/src/server/domain-event-store.ts:1: import { and, asc, eq, isNull } from "drizzle-orm";
  apps/web/src/server/domain-event-store.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/domain-event-store.ts:3: import { domainOutbox } from "@/db/schema";
  apps/web/src/server/executions.ts:1: import { and, eq, inArray } from "drizzle-orm";
  apps/web/src/server/executions.ts:3: import { db, executions, accounts, executionEvidence, trades } from "@/db";
  apps/web/src/server/executions.ts:4: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/ibkr-flex-xml-import.ts:4: import { eq } from "drizzle-orm";
  apps/web/src/server/ibkr-flex-xml-import.ts:5: import { accounts, db } from "@/db";
  apps/web/src/server/ibkr-flex-xml-import.ts:6: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/ibkr-sync-timezone.ts:1: import { and, eq } from "drizzle-orm";
  apps/web/src/server/ibkr-sync-timezone.ts:2: import { accounts, db, executions } from "@/db";
  apps/web/src/server/intelligence/composition.ts:1: import { and, eq, inArray, like } from "drizzle-orm";
  apps/web/src/server/intelligence/composition.ts:2: import { db, type JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/composition.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/composition.ts:16: } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/experience.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/insights.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/policy.ts:4: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:1: import { and, asc, eq, gt, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:12: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/environment.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/environment.ts:2: import { accounts } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/environment.ts:3: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:1: import { and, count, eq, gte, inArray, like, max } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:9: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:10: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:1: import { and, eq, inArray, lt } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:10: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:11: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:1: import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:3: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:10: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:1: import { and, eq, inArray, isNull, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:2: import { knowledgeHypotheses, knowledgePatterns, knowledgeSources } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:3: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:1: import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:12: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/outbox.ts:1: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/outbox.ts:2: import { eventDeliveries } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:1: import { count, desc, eq, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:3: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:4: import { intelligenceBudgetReservations, intelligencePolicy, intelligenceRuns } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/retention.ts:1: import { and, eq, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/retention.ts:23: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/retention.ts:24: import { dataDir, db, openConnection } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/retention.ts:25: import { checkJournalFile, copyJournalFile, readJournalFileFacts } from "@/db/journal-file";
  apps/web/src/server/intelligence/infrastructure/retention.ts:30: } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:1: import { and, asc, eq, gt, gte, lt, or } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:4: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:5: import { intelligenceJobs, intelligenceSchedules, knowledgeSources } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/worker.ts:1: import { and, eq, lte } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/worker.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/worker.ts:4: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/worker.ts:5: import { intelligenceWorkerLease } from "@/db/schema";
  apps/web/src/server/intelligence/runtime/capability-job.ts:1: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/runtime/review-enqueue.ts:1: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/worker-entry.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/worker-entry.ts:64: const connection = await import("@/db/connection");
  apps/web/src/server/market-data/csv.ts:2: import { and, eq, sql } from "drizzle-orm";
  apps/web/src/server/market-data/csv.ts:3: import { db, marketCsvDatasets, tradeExcursions } from "@/db";
  apps/web/src/server/market-data/estimates.ts:2: import { eq, inArray } from "drizzle-orm";
  apps/web/src/server/market-data/estimates.ts:4: import { accounts, db, tradeExcursions, marketCsvDatasets, executions } from "@/db";
  apps/web/src/server/ninjatrader-import.ts:2: import { and, eq } from "drizzle-orm";
  apps/web/src/server/ninjatrader-import.ts:19: } from "@/db";
  apps/web/src/server/ninjatrader-import.ts:21: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/position-import.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/position-import.ts:3: import { executions } from "@/db";
  apps/web/src/server/position-import.ts:4: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/prop-csv.ts:2: import { and, eq } from "drizzle-orm";
  apps/web/src/server/prop-csv.ts:4: import { db, propEntries, propAudit } from "@/db";
  apps/web/src/server/prop-firms.ts:1: import { and, count, desc, eq } from "drizzle-orm";
  apps/web/src/server/prop-firms.ts:2: import { db, accounts, propAccounts, propEntries, propReceipts, propAudit } from "@/db";
  apps/web/src/server/rebuild.ts:1: import { withJournalTransaction } from "@/db/transaction";
  apps/web/src/server/settings.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/settings.ts:2: import { db, settings } from "@/db";
  apps/web/src/server/settings.ts:3: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/sync.ts:3: import { eq } from "drizzle-orm";
  apps/web/src/server/sync.ts:4: import { accounts, db } from "@/db";
  apps/web/src/server/sync.ts:5: import { withJournalTransaction } from "@/db/transaction";
  apps/web/src/server/trades-query.ts:1: import { and, asc, eq, inArray } from "drizzle-orm";
  apps/web/src/server/trades-query.ts:4: import { db, trades } from "@/db";
  apps/web/src/server/trading/commands.ts:1: import { and, eq, inArray } from "drizzle-orm";
  apps/web/src/server/trading/commands.ts:3: import { accounts, executionEvidence, executions, trades, tradeIdentities } from "@/db/schema";
  apps/web/src/server/trading/commands.ts:4: import { dataDir } from "@/db/connection";
  apps/web/src/server/trading/commands.ts:5: import { withJournalTransaction } from "@/db/transaction";
  apps/web/src/server/trading/identity.ts:1: import { and, desc, eq, inArray } from "drizzle-orm";
  apps/web/src/server/trading/identity.ts:8: } from "@/db/schema";
  apps/web/src/server/trading/identity.ts:9: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/trading/reconcile.ts:1: import { and, eq, inArray } from "drizzle-orm";
  apps/web/src/server/trading/reconcile.ts:16: } from "@/db/schema";
  apps/web/src/server/trading/reconcile.ts:17: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/xtb-import.ts:1: import { and, eq } from "drizzle-orm";
  apps/web/src/server/xtb-import.ts:3: import { db, executions } from "@/db";
  apps/web/src/server/xtb-import.ts:4: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
  apps/web/tests/account-default.test.ts:10: const { db, settings, accounts } = await import("../src/db");
  apps/web/tests/account-mutation-routes.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/account-mutation-routes.test.ts:24: const { db, accounts, executions, trades, settings } = await import("../src/db");
  apps/web/tests/ai-ask-agent.test.ts:6: import { db, accounts, executions, settings, trades } from "../src/db";
  apps/web/tests/ai-capability.test.ts:19: } from "../src/db";
  apps/web/tests/ai-import.test.ts:23: const { db, accounts, executions, trades, settings } = await import("../src/db");
  apps/web/tests/ai-report-context.test.ts:5: import { db, accounts, trades } from "../src/db";
  apps/web/tests/ai-reports-route.test.ts:5: import { db, accounts, executions, trades, settings } from "../src/db";
  apps/web/tests/ai-scope.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/ai-scope.test.ts:7: import { db, accounts, executions, trades, settings, journalDays } from "../src/db";
  apps/web/tests/ai-settings.test.ts:9: const { db, settings } = await import("../src/db");
  apps/web/tests/ctrader-mcp/accounts-route.test.ts:2: import { accounts, db } from "@/db";
  apps/web/tests/ctrader-mcp/sync.test.ts:1: import { eq } from "drizzle-orm";
  apps/web/tests/ctrader-mcp/sync.test.ts:3: import { db, accounts, executions, trades, domainOutbox } from "@/db";
  apps/web/tests/ctrader-mcp/sync.test.ts:4: import { executionEvidence, tradeProjectionRevisions } from "@/db/schema";
  apps/web/tests/db-concurrent-init.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/db-concurrent-init.test.ts:9: import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
  apps/web/tests/db-concurrent-init.test.ts:10: import checksumManifest from "../src/db/migration-checksums.json" with { type: "json" };
  apps/web/tests/db-connection-lifecycle.test.ts:5: import type { JournalDb } from "../src/db/connection";
  apps/web/tests/db-connection-lifecycle.test.ts:6: import type { JournalTx } from "../src/db/transaction";
  apps/web/tests/db-connection-lifecycle.test.ts:48: const app = await import("../src/db");
  apps/web/tests/demo-import.test.ts:19: const { db, accounts, executions, trades, domainOutbox } = await import("../src/db");
  apps/web/tests/execution-storage.test.ts:10: const { db, accounts, executions, trades } = await import("../src/db");
  apps/web/tests/folder-delete.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/folder-delete.test.ts:6: import { eq } from "drizzle-orm";
  apps/web/tests/folder-delete.test.ts:19: const { db, folders, notes } = await import("../src/db");
  apps/web/tests/folder-delete.test.ts:20: const { BOOTSTRAP_SQL } = await import("../src/db/bootstrap");
  apps/web/tests/history-import.test.ts:5: import Database from "better-sqlite3";
  apps/web/tests/history-import.test.ts:6: import { eq } from "drizzle-orm";
  apps/web/tests/history-import.test.ts:8: import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
  apps/web/tests/history-import.test.ts:26: const { db, accounts, executions, trades, settings } = await import("../src/db");
  apps/web/tests/ibkr-flex-xml-import.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/ibkr-flex-xml-import.test.ts:12: const { db, accounts, executions, trades, settings, domainOutbox } = await import("../src/db");
  apps/web/tests/ibkr-sync-timezone.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/ibkr-sync-timezone.test.ts:12: const { db, accounts, executions, trades, settings } = await import("../src/db");
  apps/web/tests/ibkr-timezone-migration.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/ibkr-timezone-migration.test.ts:6: import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
  apps/web/tests/ibkr-timezone-migration.test.ts:22: const { db, accounts } = await import("../src/db");
  apps/web/tests/import-account.test.ts:12: const { db, executions, trades } = await import("../src/db");
  apps/web/tests/import-formats-regression.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/import-formats-regression.test.ts:10: const { db, accounts, executions, trades } = await import("../src/db");
  apps/web/tests/intelligence-acceptance.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/intelligence-acceptance.test.ts:6: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-acceptance.test.ts:49: } = await import("../src/db");
  apps/web/tests/intelligence-acceptance.test.ts:50: const { openConnection } = await import("../src/db/connection");
  apps/web/tests/intelligence-acceptance.test.ts:62: const { applyMigrations, LEDGER_TABLE_SQL, MigrationError } = await import("../src/db/migrations");
  apps/web/tests/intelligence-backup.test.ts:19: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-backup.test.ts:49: } = await import("../src/db");
  apps/web/tests/intelligence-backup.test.ts:50: const { openConnection } = await import("../src/db/connection");
  apps/web/tests/intelligence-engagement.test.ts:5: import { eq, like } from "drizzle-orm";
  apps/web/tests/intelligence-engagement.test.ts:6: import type { JournalTx } from "../src/db/transaction";
  apps/web/tests/intelligence-engagement.test.ts:31: await import("../src/db");
  apps/web/tests/intelligence-engagement.test.ts:32: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-insights.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-insights.test.ts:33: } = await import("../src/db");
  apps/web/tests/intelligence-jobs.test.ts:29: } = await import("../src/db");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:6: import { eq, inArray } from "drizzle-orm";
  apps/web/tests/intelligence-knowledge-revisions.test.ts:42: } = await import("../src/db");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:43: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:319: const { applyMigrations } = await import("../src/db/migrations");
  apps/web/tests/intelligence-migrations.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/intelligence-migrations.test.ts:10: import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
  apps/web/tests/intelligence-migrations.test.ts:19: } from "../src/db/migrations";
  apps/web/tests/intelligence-migrations.test.ts:20: import checksumManifest from "../src/db/migration-checksums.json" with { type: "json" };
  apps/web/tests/intelligence-observations.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-observations.test.ts:45: } = await import("../src/db");
  apps/web/tests/intelligence-outbox.test.ts:24: await import("../src/db");
  apps/web/tests/intelligence-provider-policy.test.ts:2: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-provider-policy.test.ts:8: import checksumManifest from "../src/db/migration-checksums.json" with { type: "json" };
  apps/web/tests/intelligence-provider-policy.test.ts:30: await import("../src/db");
  apps/web/tests/intelligence-provider-policy.test.ts:31: const { intelligenceBudgetReservations } = await import("../src/db/schema");
  apps/web/tests/intelligence-provider-policy.test.ts:33: const { withConnectionTransaction, withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-recovery.test.ts:9: import type { JournalDb } from "../src/db/connection";
  apps/web/tests/intelligence-recovery.test.ts:102: import { db, accounts, withConnectionTransaction } from "@/db";
  apps/web/tests/intelligence-recovery.test.ts:26: const { db: parentDb, openConnection } = await import("../src/db");
  apps/web/tests/intelligence-retention.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-retention.test.ts:39: } = await import("../src/db");
  apps/web/tests/intelligence-review-insight.test.ts:6: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-review-insight.test.ts:69: } = await import("../src/db");
  apps/web/tests/intelligence-review-insight.test.ts:70: const { withConnectionTransaction, withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-routes.test.ts:5: import { eq, like } from "drizzle-orm";
  apps/web/tests/intelligence-routes.test.ts:57: } = await import("../src/db");
  apps/web/tests/intelligence-scheduler.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-scheduler.test.ts:29: } = await import("../src/db");
  apps/web/tests/intelligence-scope.test.ts:5: import { db, accounts, executions, trades, settings, journalDays } from "../src/db";
  apps/web/tests/intelligence-slice-a.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-slice-a.test.ts:37: } = await import("../src/db");
  apps/web/tests/intelligence-slice-b.test.ts:5: import { eq, inArray, like } from "drizzle-orm";
  apps/web/tests/intelligence-slice-b.test.ts:61: } = await import("../src/db");
  apps/web/tests/intelligence-slice-b.test.ts:62: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-slice-b.test.ts:752: const restartedJournal = await import("../src/db");
  apps/web/tests/intelligence-worker.test.ts:5: import { eq, sql } from "drizzle-orm";
  apps/web/tests/intelligence-worker.test.ts:31: } = await import("../src/db");
  apps/web/tests/intelligence-workflows.test.ts:6: import { eq, like } from "drizzle-orm";
  apps/web/tests/intelligence-workflows.test.ts:7: import type { JournalTx } from "../src/db/transaction";
  apps/web/tests/intelligence-workflows.test.ts:54: } = await import("../src/db");
  apps/web/tests/intelligence-workflows.test.ts:60: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-workflows.test.ts:61: const { applyMigrations } = await import("../src/db/migrations");
  apps/web/tests/market-csv-migration.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/market-csv-migration.test.ts:22: const { db, marketCsvDatasets } = await import("../src/db");
  apps/web/tests/market-data-connections.test.ts:2: import { eq } from "drizzle-orm";
  apps/web/tests/market-data-connections.test.ts:11: const { db, settings, accounts, executions, trades, marketCsvDatasets } = await import("../src/db");
  apps/web/tests/market-data-connections.test.ts:267: const { tradeExcursions } = await import("../src/db");
  apps/web/tests/ninjatrader-import.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/ninjatrader-import.test.ts:23: } = await import("../src/db");
  apps/web/tests/ninjatrader-reconciliation.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/ninjatrader-reconciliation.test.ts:20: } = await import("../src/db");
  apps/web/tests/prop-firms.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/prop-firms.test.ts:29: } = await import("../src/db");
  apps/web/tests/settings-mutation-routes.test.ts:19: const { db, accounts, trades, settings } = await import("../src/db");
  apps/web/tests/sync-resilience.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/sync-resilience.test.ts:49: await import("../src/db");
  apps/web/tests/timezone.test.ts:12: const { db, accounts, executions, trades, settings } = await import("../src/db");
  apps/web/tests/trade-delete-routes.test.ts:18: const { db, accounts, executions, trades } = await import("../src/db");
  apps/web/tests/trade-mutation-commands.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/trade-mutation-commands.test.ts:41: } = await import("../src/db");
  apps/web/tests/trade-mutation-events.test.ts:25: await import("../src/db");
  apps/web/tests/trade-navigation.test.ts:9: const { db, accounts, trades, executions, settings } = await import("../src/db");
  apps/web/tests/trade-projection-identity.test.ts:33: } = await import("../src/db");
  apps/web/tests/trade-reconciliation.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/trade-reconciliation.test.ts:36: } = await import("../src/db");
  apps/web/tests/trade-roi-api.test.ts:10: const { db, accounts, trades, settings } = await import("../src/db");
  apps/web/tests/xtb-import.test.ts:15: const { db, accounts, executions, trades, domainOutbox } = await import("../src/db");
```

Runtime database imports (counted as violations where the layer forbids a runtime database dependency):

```
  apps/web/src/server/ai-capabilities.ts:33: } from "@/db";
  apps/web/src/server/ai-capabilities.ts:34: import { eq } from "drizzle-orm";
  apps/web/src/server/ai-capabilities.ts:35: import { sql } from "drizzle-orm";
  apps/web/src/server/ai-scope.ts:7: import { db, accounts, playbooks } from "@/db";
  apps/web/src/server/crypto.ts:4: import { dataDir } from "@/db";
  apps/web/src/server/ctrader-mcp/sync.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/ctrader-mcp/sync.ts:3: import { db, accounts } from "@/db";
  apps/web/src/server/ctrader-mcp/sync.ts:4: import { withJournalTransaction } from "@/db/transaction";
  apps/web/src/server/demo.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/demo.ts:3: import { accounts } from "@/db";
  apps/web/src/server/demo.ts:4: import { withJournalTransaction } from "@/db/transaction";
  apps/web/src/server/domain-event-store.ts:1: import { and, asc, eq, isNull } from "drizzle-orm";
  apps/web/src/server/domain-event-store.ts:3: import { domainOutbox } from "@/db/schema";
  apps/web/src/server/executions.ts:1: import { and, eq, inArray } from "drizzle-orm";
  apps/web/src/server/executions.ts:3: import { db, executions, accounts, executionEvidence, trades } from "@/db";
  apps/web/src/server/executions.ts:4: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/ibkr-flex-xml-import.ts:4: import { eq } from "drizzle-orm";
  apps/web/src/server/ibkr-flex-xml-import.ts:5: import { accounts, db } from "@/db";
  apps/web/src/server/ibkr-flex-xml-import.ts:6: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/ibkr-sync-timezone.ts:1: import { and, eq } from "drizzle-orm";
  apps/web/src/server/ibkr-sync-timezone.ts:2: import { accounts, db, executions } from "@/db";
  apps/web/src/server/intelligence/composition.ts:1: import { and, eq, inArray, like } from "drizzle-orm";
  apps/web/src/server/intelligence/composition.ts:2: import { db, type JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/composition.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/composition.ts:16: } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:1: import { and, asc, eq, gt, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:12: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/environment.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/environment.ts:2: import { accounts } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:1: import { and, count, eq, gte, inArray, like, max } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:9: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:1: import { and, eq, inArray, lt } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:10: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:1: import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:3: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:10: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:1: import { and, eq, inArray, isNull, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:2: import { knowledgeHypotheses, knowledgePatterns, knowledgeSources } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:1: import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/outbox.ts:2: import { eventDeliveries } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:1: import { count, desc, eq, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:3: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:4: import { intelligenceBudgetReservations, intelligencePolicy, intelligenceRuns } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/retention.ts:1: import { and, eq, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/retention.ts:23: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/retention.ts:24: import { dataDir, db, openConnection } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/retention.ts:25: import { checkJournalFile, copyJournalFile, readJournalFileFacts } from "@/db/journal-file";
  apps/web/src/server/intelligence/infrastructure/retention.ts:30: } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:1: import { and, asc, eq, gt, gte, lt, or } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:4: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:5: import { intelligenceJobs, intelligenceSchedules, knowledgeSources } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/worker.ts:1: import { and, eq, lte } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/worker.ts:4: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/worker.ts:5: import { intelligenceWorkerLease } from "@/db/schema";
  apps/web/src/server/intelligence/worker-entry.ts:64: const connection = await import("@/db/connection");
  apps/web/src/server/market-data/csv.ts:2: import { and, eq, sql } from "drizzle-orm";
  apps/web/src/server/market-data/csv.ts:3: import { db, marketCsvDatasets, tradeExcursions } from "@/db";
  apps/web/src/server/market-data/estimates.ts:2: import { eq, inArray } from "drizzle-orm";
  apps/web/src/server/market-data/estimates.ts:4: import { accounts, db, tradeExcursions, marketCsvDatasets, executions } from "@/db";
  apps/web/src/server/ninjatrader-import.ts:2: import { and, eq } from "drizzle-orm";
  apps/web/src/server/ninjatrader-import.ts:19: } from "@/db";
  apps/web/src/server/position-import.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/position-import.ts:3: import { executions } from "@/db";
  apps/web/src/server/prop-csv.ts:2: import { and, eq } from "drizzle-orm";
  apps/web/src/server/prop-csv.ts:4: import { db, propEntries, propAudit } from "@/db";
  apps/web/src/server/prop-firms.ts:1: import { and, count, desc, eq } from "drizzle-orm";
  apps/web/src/server/prop-firms.ts:2: import { db, accounts, propAccounts, propEntries, propReceipts, propAudit } from "@/db";
  apps/web/src/server/rebuild.ts:1: import { withJournalTransaction } from "@/db/transaction";
  apps/web/src/server/settings.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/settings.ts:2: import { db, settings } from "@/db";
  apps/web/src/server/settings.ts:3: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/sync.ts:3: import { eq } from "drizzle-orm";
  apps/web/src/server/sync.ts:4: import { accounts, db } from "@/db";
  apps/web/src/server/sync.ts:5: import { withJournalTransaction } from "@/db/transaction";
  apps/web/src/server/trades-query.ts:1: import { and, asc, eq, inArray } from "drizzle-orm";
  apps/web/src/server/trades-query.ts:4: import { db, trades } from "@/db";
  apps/web/src/server/trading/commands.ts:1: import { and, eq, inArray } from "drizzle-orm";
  apps/web/src/server/trading/commands.ts:3: import { accounts, executionEvidence, executions, trades, tradeIdentities } from "@/db/schema";
  apps/web/src/server/trading/commands.ts:4: import { dataDir } from "@/db/connection";
  apps/web/src/server/trading/commands.ts:5: import { withJournalTransaction } from "@/db/transaction";
  apps/web/src/server/trading/identity.ts:1: import { and, desc, eq, inArray } from "drizzle-orm";
  apps/web/src/server/trading/identity.ts:8: } from "@/db/schema";
  apps/web/src/server/trading/reconcile.ts:1: import { and, eq, inArray } from "drizzle-orm";
  apps/web/src/server/trading/reconcile.ts:16: } from "@/db/schema";
  apps/web/src/server/xtb-import.ts:1: import { and, eq } from "drizzle-orm";
  apps/web/src/server/xtb-import.ts:3: import { db, executions } from "@/db";
  apps/web/src/server/xtb-import.ts:4: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
  apps/web/tests/account-default.test.ts:10: const { db, settings, accounts } = await import("../src/db");
  apps/web/tests/account-mutation-routes.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/account-mutation-routes.test.ts:24: const { db, accounts, executions, trades, settings } = await import("../src/db");
  apps/web/tests/ai-ask-agent.test.ts:6: import { db, accounts, executions, settings, trades } from "../src/db";
  apps/web/tests/ai-capability.test.ts:19: } from "../src/db";
  apps/web/tests/ai-import.test.ts:23: const { db, accounts, executions, trades, settings } = await import("../src/db");
  apps/web/tests/ai-report-context.test.ts:5: import { db, accounts, trades } from "../src/db";
  apps/web/tests/ai-reports-route.test.ts:5: import { db, accounts, executions, trades, settings } from "../src/db";
  apps/web/tests/ai-scope.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/ai-scope.test.ts:7: import { db, accounts, executions, trades, settings, journalDays } from "../src/db";
  apps/web/tests/ai-settings.test.ts:9: const { db, settings } = await import("../src/db");
  apps/web/tests/ctrader-mcp/accounts-route.test.ts:2: import { accounts, db } from "@/db";
  apps/web/tests/ctrader-mcp/sync.test.ts:1: import { eq } from "drizzle-orm";
  apps/web/tests/ctrader-mcp/sync.test.ts:3: import { db, accounts, executions, trades, domainOutbox } from "@/db";
  apps/web/tests/ctrader-mcp/sync.test.ts:4: import { executionEvidence, tradeProjectionRevisions } from "@/db/schema";
  apps/web/tests/db-concurrent-init.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/db-concurrent-init.test.ts:9: import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
  apps/web/tests/db-concurrent-init.test.ts:10: import checksumManifest from "../src/db/migration-checksums.json" with { type: "json" };
  apps/web/tests/db-connection-lifecycle.test.ts:48: const app = await import("../src/db");
  apps/web/tests/demo-import.test.ts:19: const { db, accounts, executions, trades, domainOutbox } = await import("../src/db");
  apps/web/tests/execution-storage.test.ts:10: const { db, accounts, executions, trades } = await import("../src/db");
  apps/web/tests/folder-delete.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/folder-delete.test.ts:6: import { eq } from "drizzle-orm";
  apps/web/tests/folder-delete.test.ts:19: const { db, folders, notes } = await import("../src/db");
  apps/web/tests/folder-delete.test.ts:20: const { BOOTSTRAP_SQL } = await import("../src/db/bootstrap");
  apps/web/tests/history-import.test.ts:5: import Database from "better-sqlite3";
  apps/web/tests/history-import.test.ts:6: import { eq } from "drizzle-orm";
  apps/web/tests/history-import.test.ts:8: import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
  apps/web/tests/history-import.test.ts:26: const { db, accounts, executions, trades, settings } = await import("../src/db");
  apps/web/tests/ibkr-flex-xml-import.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/ibkr-flex-xml-import.test.ts:12: const { db, accounts, executions, trades, settings, domainOutbox } = await import("../src/db");
  apps/web/tests/ibkr-sync-timezone.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/ibkr-sync-timezone.test.ts:12: const { db, accounts, executions, trades, settings } = await import("../src/db");
  apps/web/tests/ibkr-timezone-migration.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/ibkr-timezone-migration.test.ts:6: import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
  apps/web/tests/ibkr-timezone-migration.test.ts:22: const { db, accounts } = await import("../src/db");
  apps/web/tests/import-account.test.ts:12: const { db, executions, trades } = await import("../src/db");
  apps/web/tests/import-formats-regression.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/import-formats-regression.test.ts:10: const { db, accounts, executions, trades } = await import("../src/db");
  apps/web/tests/intelligence-acceptance.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/intelligence-acceptance.test.ts:6: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-acceptance.test.ts:49: } = await import("../src/db");
  apps/web/tests/intelligence-acceptance.test.ts:50: const { openConnection } = await import("../src/db/connection");
  apps/web/tests/intelligence-acceptance.test.ts:62: const { applyMigrations, LEDGER_TABLE_SQL, MigrationError } = await import("../src/db/migrations");
  apps/web/tests/intelligence-backup.test.ts:19: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-backup.test.ts:49: } = await import("../src/db");
  apps/web/tests/intelligence-backup.test.ts:50: const { openConnection } = await import("../src/db/connection");
  apps/web/tests/intelligence-engagement.test.ts:5: import { eq, like } from "drizzle-orm";
  apps/web/tests/intelligence-engagement.test.ts:31: await import("../src/db");
  apps/web/tests/intelligence-engagement.test.ts:32: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-insights.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-insights.test.ts:33: } = await import("../src/db");
  apps/web/tests/intelligence-jobs.test.ts:29: } = await import("../src/db");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:6: import { eq, inArray } from "drizzle-orm";
  apps/web/tests/intelligence-knowledge-revisions.test.ts:42: } = await import("../src/db");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:43: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:319: const { applyMigrations } = await import("../src/db/migrations");
  apps/web/tests/intelligence-migrations.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/intelligence-migrations.test.ts:10: import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
  apps/web/tests/intelligence-migrations.test.ts:19: } from "../src/db/migrations";
  apps/web/tests/intelligence-migrations.test.ts:20: import checksumManifest from "../src/db/migration-checksums.json" with { type: "json" };
  apps/web/tests/intelligence-observations.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-observations.test.ts:45: } = await import("../src/db");
  apps/web/tests/intelligence-outbox.test.ts:24: await import("../src/db");
  apps/web/tests/intelligence-provider-policy.test.ts:2: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-provider-policy.test.ts:8: import checksumManifest from "../src/db/migration-checksums.json" with { type: "json" };
  apps/web/tests/intelligence-provider-policy.test.ts:30: await import("../src/db");
  apps/web/tests/intelligence-provider-policy.test.ts:31: const { intelligenceBudgetReservations } = await import("../src/db/schema");
  apps/web/tests/intelligence-provider-policy.test.ts:33: const { withConnectionTransaction, withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-recovery.test.ts:102: import { db, accounts, withConnectionTransaction } from "@/db";
  apps/web/tests/intelligence-recovery.test.ts:26: const { db: parentDb, openConnection } = await import("../src/db");
  apps/web/tests/intelligence-retention.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-retention.test.ts:39: } = await import("../src/db");
  apps/web/tests/intelligence-review-insight.test.ts:6: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-review-insight.test.ts:69: } = await import("../src/db");
  apps/web/tests/intelligence-review-insight.test.ts:70: const { withConnectionTransaction, withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-routes.test.ts:5: import { eq, like } from "drizzle-orm";
  apps/web/tests/intelligence-routes.test.ts:57: } = await import("../src/db");
  apps/web/tests/intelligence-scheduler.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-scheduler.test.ts:29: } = await import("../src/db");
  apps/web/tests/intelligence-scope.test.ts:5: import { db, accounts, executions, trades, settings, journalDays } from "../src/db";
  apps/web/tests/intelligence-slice-a.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-slice-a.test.ts:37: } = await import("../src/db");
  apps/web/tests/intelligence-slice-b.test.ts:5: import { eq, inArray, like } from "drizzle-orm";
  apps/web/tests/intelligence-slice-b.test.ts:61: } = await import("../src/db");
  apps/web/tests/intelligence-slice-b.test.ts:62: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-slice-b.test.ts:752: const restartedJournal = await import("../src/db");
  apps/web/tests/intelligence-worker.test.ts:5: import { eq, sql } from "drizzle-orm";
  apps/web/tests/intelligence-worker.test.ts:31: } = await import("../src/db");
  apps/web/tests/intelligence-workflows.test.ts:6: import { eq, like } from "drizzle-orm";
  apps/web/tests/intelligence-workflows.test.ts:54: } = await import("../src/db");
  apps/web/tests/intelligence-workflows.test.ts:60: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-workflows.test.ts:61: const { applyMigrations } = await import("../src/db/migrations");
  apps/web/tests/market-csv-migration.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/market-csv-migration.test.ts:22: const { db, marketCsvDatasets } = await import("../src/db");
  apps/web/tests/market-data-connections.test.ts:2: import { eq } from "drizzle-orm";
  apps/web/tests/market-data-connections.test.ts:11: const { db, settings, accounts, executions, trades, marketCsvDatasets } = await import("../src/db");
  apps/web/tests/market-data-connections.test.ts:267: const { tradeExcursions } = await import("../src/db");
  apps/web/tests/ninjatrader-import.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/ninjatrader-import.test.ts:23: } = await import("../src/db");
  apps/web/tests/ninjatrader-reconciliation.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/ninjatrader-reconciliation.test.ts:20: } = await import("../src/db");
  apps/web/tests/prop-firms.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/prop-firms.test.ts:29: } = await import("../src/db");
  apps/web/tests/settings-mutation-routes.test.ts:19: const { db, accounts, trades, settings } = await import("../src/db");
  apps/web/tests/sync-resilience.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/sync-resilience.test.ts:49: await import("../src/db");
  apps/web/tests/timezone.test.ts:12: const { db, accounts, executions, trades, settings } = await import("../src/db");
  apps/web/tests/trade-delete-routes.test.ts:18: const { db, accounts, executions, trades } = await import("../src/db");
  apps/web/tests/trade-mutation-commands.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/trade-mutation-commands.test.ts:41: } = await import("../src/db");
  apps/web/tests/trade-mutation-events.test.ts:25: await import("../src/db");
  apps/web/tests/trade-navigation.test.ts:9: const { db, accounts, trades, executions, settings } = await import("../src/db");
  apps/web/tests/trade-projection-identity.test.ts:33: } = await import("../src/db");
  apps/web/tests/trade-reconciliation.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/trade-reconciliation.test.ts:36: } = await import("../src/db");
  apps/web/tests/trade-roi-api.test.ts:10: const { db, accounts, trades, settings } = await import("../src/db");
  apps/web/tests/xtb-import.test.ts:15: const { db, accounts, executions, trades, domainOutbox } = await import("../src/db");
```

Type-only database references (reported, not counted; a runtime import is counted only where the layer forbids a runtime database dependency):

```
  apps/web/src/server/domain-event-store.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/experience.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/insights.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/policy.ts:4: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/environment.ts:3: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:10: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:11: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:3: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:12: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/outbox.ts:1: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/worker.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/runtime/capability-job.ts:1: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/runtime/review-enqueue.ts:1: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/worker-entry.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/ninjatrader-import.ts:21: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/position-import.ts:4: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/trading/identity.ts:9: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/trading/reconcile.ts:17: import type { JournalTx } from "@/db/transaction";
  apps/web/tests/db-connection-lifecycle.test.ts:5: import type { JournalDb } from "../src/db/connection";
  apps/web/tests/db-connection-lifecycle.test.ts:6: import type { JournalTx } from "../src/db/transaction";
  apps/web/tests/intelligence-engagement.test.ts:6: import type { JournalTx } from "../src/db/transaction";
  apps/web/tests/intelligence-recovery.test.ts:9: import type { JournalDb } from "../src/db/connection";
  apps/web/tests/intelligence-workflows.test.ts:7: import type { JournalTx } from "../src/db/transaction";
```

Database imports counted as layer boundary violations:

```
  (none)
```

## Destination gate

One full gate run on the destination branch, alone on the host, sequentially. Every exit code is the exit status of the command itself, never the status of a pipe.

| Command                                                                             | Exit | Result |
| ----------------------------------------------------------------------------------- | ---- | ------ |
| `pnpm install --frozen-lockfile`                                                    | 0    | passed |
| `pnpm --filter web typecheck`                                                       | 0    | passed |
| `pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck` | 0    | passed |
| `pnpm --filter web migrations:check`                                                | 0    | passed |
| `node scripts/check-licenses.mjs`                                                   | 0    | passed |
| `pnpm exec prettier --check <22 prettier-governed merged files>`                    | 0    | passed |
| `pnpm build`                                                                        | 0    | passed |
| `pnpm test`                                                                         | 0    | passed |

The prettier file list was computed after the merge, from the merge commit itself: `git diff --name-only 4ae65be404eafcd6c4f80c30bf879a8512dda90c..06a443fd5a1f299363b9cee1be76b18fb4048107` in the feature worktree, with deleted paths excluded because prettier cannot check them (22 files).

- `.omp/reviewer-report.md`
- `apps/web/src/server/ai-review-insight.ts`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/contracts/capabilities.ts`
- `apps/web/src/server/intelligence/contracts/insights.ts`
- `apps/web/src/server/intelligence/contracts/jobs.ts`
- `apps/web/src/server/intelligence/contracts/policy.ts`
- `apps/web/src/server/intelligence/infrastructure/environment.ts`
- `apps/web/src/server/intelligence/infrastructure/insight-store.ts`
- `apps/web/src/server/intelligence/infrastructure/policy-store.ts`
- `apps/web/src/server/intelligence/infrastructure/review-transport.ts`
- `apps/web/src/server/intelligence/infrastructure/worker.ts`
- `apps/web/src/server/intelligence/runtime/capability-job.ts`
- `apps/web/src/server/intelligence/runtime/model-policy.ts`
- `apps/web/src/server/intelligence/runtime/review-enqueue.ts`
- `apps/web/src/server/intelligence/runtime/review-insight.ts`
- `apps/web/src/server/settings.ts`
- `apps/web/tests/intelligence-jobs.test.ts`
- `apps/web/tests/intelligence-review-insight.test.ts`
- `docs/intelligence-operations.md`
- `docs/superpowers/plans/ai-native-journal/phase-23.md`
- `docs/superpowers/reports/ai-native-journal-phase-23.md`

Only the files prettier actually governs are passed to prettier (22 of 22). A Rust file, a Python file and a Dockerfile are not prettier targets at all, and the YAML workflows are not prettier targets for this gate. Each remaining file was probed once with `pnpm exec prettier --check <file>` before the gate command, so the result below is per file:

```
  .omp/reviewer-report.md: prettier exit code 0 (formatted)
  apps/web/src/server/ai-review-insight.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/composition.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/contracts/capabilities.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/contracts/insights.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/contracts/jobs.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/contracts/policy.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/infrastructure/environment.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/infrastructure/insight-store.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/infrastructure/policy-store.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/infrastructure/review-transport.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/infrastructure/worker.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/runtime/capability-job.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/runtime/model-policy.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/runtime/review-enqueue.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/runtime/review-insight.ts: prettier exit code 0 (formatted)
  apps/web/src/server/settings.ts: prettier exit code 0 (formatted)
  apps/web/tests/intelligence-jobs.test.ts: prettier exit code 0 (formatted)
  apps/web/tests/intelligence-review-insight.test.ts: prettier exit code 0 (formatted)
  docs/intelligence-operations.md: prettier exit code 0 (formatted)
  docs/superpowers/plans/ai-native-journal/phase-23.md: prettier exit code 0 (formatted)
  docs/superpowers/reports/ai-native-journal-phase-23.md: prettier exit code 0 (formatted)
```

Files excluded from the prettier scope:

```
  (none)
```

- prettier-governed: `.omp/reviewer-report.md`
- prettier-governed: `apps/web/src/server/ai-review-insight.ts`
- prettier-governed: `apps/web/src/server/intelligence/composition.ts`
- prettier-governed: `apps/web/src/server/intelligence/contracts/capabilities.ts`
- prettier-governed: `apps/web/src/server/intelligence/contracts/insights.ts`
- prettier-governed: `apps/web/src/server/intelligence/contracts/jobs.ts`
- prettier-governed: `apps/web/src/server/intelligence/contracts/policy.ts`
- prettier-governed: `apps/web/src/server/intelligence/infrastructure/environment.ts`
- prettier-governed: `apps/web/src/server/intelligence/infrastructure/insight-store.ts`
- prettier-governed: `apps/web/src/server/intelligence/infrastructure/policy-store.ts`
- prettier-governed: `apps/web/src/server/intelligence/infrastructure/review-transport.ts`
- prettier-governed: `apps/web/src/server/intelligence/infrastructure/worker.ts`
- prettier-governed: `apps/web/src/server/intelligence/runtime/capability-job.ts`
- prettier-governed: `apps/web/src/server/intelligence/runtime/model-policy.ts`
- prettier-governed: `apps/web/src/server/intelligence/runtime/review-enqueue.ts`
- prettier-governed: `apps/web/src/server/intelligence/runtime/review-insight.ts`
- prettier-governed: `apps/web/src/server/settings.ts`
- prettier-governed: `apps/web/tests/intelligence-jobs.test.ts`
- prettier-governed: `apps/web/tests/intelligence-review-insight.test.ts`
- prettier-governed: `docs/intelligence-operations.md`
- prettier-governed: `docs/superpowers/plans/ai-native-journal/phase-23.md`
- prettier-governed: `docs/superpowers/reports/ai-native-journal-phase-23.md`

The `desktop` workspace was deliberately not typechecked: its `cargo check` fails on a pre-existing repository defect (the Tauri sidecar resource `binaries/node-x86_64-pc-windows-msvc.exe` is missing because `desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` inside an ESM package). That defect belongs to Phase 21 and is recorded as blocked host evidence. It was not mocked and it is not reported as passed.

## Review verdict

PASS. The candidate commits were reviewed, the ownership boundary held (ALLOWED, with the 15 prefix-derived path(s) marked above), the schema verdict is no migration owned with 0001 through 0008 byte-unchanged (ALLOWED), the layer-boundary verdict, including the contracts layer, the knowledge layer, the experience layer with its no-runtime-database-import rule, the runtime no-direct-database rule, the pure core package rule, the new route directory rule (apps/web/src/app/api/intelligence/), the shared client-side interaction module rule (apps/web/src/lib/intelligence-interactions.ts), the browser-layer rule (apps/web/src/components/, apps/web/src/lib/, apps/web/src/app/settings/) and the explicit server-versus-browser distinction, is ALLOWED, and the destination gate passed on the destination branch.

## What was not done

No push happened. No pull request was opened. No merge into `main` happened. In short: no push, no PR and no `main` merge happened during this integration. The Docker daemon was not started and no Docker result is claimed. The `desktop` workspace cargo gate was not run, not mocked and not reported as passed; it stays recorded as blocked host evidence for Phase 21.

The tracked-but-gitignored local artifact `.omp/reviewer-report.md` was backed up before the merge, reset so the merge could proceed, and the local copy was restored afterwards. It was never staged and never committed by this integration.
