# Phase 19 integration - native inbox and control UI

## Outcome

Phase 19 was merged into `codex/ai-native-journal` at `4cab43c983b4a2d8e252480b778f9b516a14dd11` and the destination gate passed.

- Destination branch: `codex/ai-native-journal`
- Destination-before SHA: `a305f726b5beddf039d055d24022b2a9b9c6add2`
- Candidate base SHA: `14f8ec3aa0451c53c91d9503c2b79425232cdfaf`
- Candidate tip SHA: `062fa556677f13df1761812c02d30076b41b3074`
- Merge SHA: `4cab43c983b4a2d8e252480b778f9b516a14dd11` (`--no-ff`)
- Merge parents: `a305f726b5beddf039d055d24022b2a9b9c6add2` and `062fa556677f13df1761812c02d30076b41b3074`
- The candidate base was resolved at run time as `git merge-base codex/ai-native-journal-p19 codex/ai-native-journal`; no SHA is hardcoded in the integration script.

## Candidate commits

```
062fa55 docs: record the review of the Phase 19 observations pairing fix
8ac2572 fix: make the observation review pairing deterministic and keep its rules in the route
7b0fa24 docs: record the Phase 19 observations pairing fix
148f2c6 fix: pair the actionable workflow and refuse a duplicate review
b3ed0a1 docs: report the web suite run against the committed tree
21f889d docs: name the residual of the review's MAJOR finding
13d8855 docs: format the Phase 19 plan and report
5306008 docs: name the Phase 19 implementation commit in the report
c984996 feat: expose controlled intelligence interactions and user settings
f8f0525 docs: plan the native inbox and the Slice B gate
```

## Changed-file summary

```
.omp/reviewer-report.md                            | 216 +++---
 .../web/src/app/api/intelligence/controls/route.ts |  56 ++
 .../src/app/api/intelligence/observations/route.ts |  96 ++-
 apps/web/src/app/api/intelligence/queries.ts       |  19 +-
 apps/web/src/app/settings/page.tsx                 |   9 +
 apps/web/src/components/intelligence/controls.tsx  | 166 +++++
 apps/web/src/components/intelligence/inbox.tsx     | 230 ++++++
 .../components/intelligence/interaction-card.tsx   | 292 ++++++++
 apps/web/src/components/shell.tsx                  |  43 +-
 apps/web/src/lib/intelligence-interactions.ts      | 163 +++++
 apps/web/src/lib/use-api.ts                        |  26 +-
 apps/web/src/server/intelligence/composition.ts    | 177 ++++-
 .../src/server/intelligence/experience/producer.ts |  79 +++
 apps/web/src/server/settings.ts                    |  56 +-
 apps/web/tests/intelligence-routes.test.ts         |   5 +-
 apps/web/tests/intelligence-slice-b.test.ts        | 787 +++++++++++++++++++++
 apps/web/tests/intelligence-ui.test.ts             | 593 ++++++++++++++++
 docs/decisions/0003-adopt-shadcn-ui.md             |  13 +
 .../plans/ai-native-journal/phase-19.md            | 256 +++++++
 .../reports/ai-native-journal-phase-19.md          | 248 +++++++
 20 files changed, 3397 insertions(+), 133 deletions(-)
```

20 candidate files, 20 files in the merge.

Merged files:

- `.omp/reviewer-report.md`
- `apps/web/src/app/api/intelligence/controls/route.ts`
- `apps/web/src/app/api/intelligence/observations/route.ts`
- `apps/web/src/app/api/intelligence/queries.ts`
- `apps/web/src/app/settings/page.tsx`
- `apps/web/src/components/intelligence/controls.tsx`
- `apps/web/src/components/intelligence/inbox.tsx`
- `apps/web/src/components/intelligence/interaction-card.tsx`
- `apps/web/src/components/shell.tsx`
- `apps/web/src/lib/intelligence-interactions.ts`
- `apps/web/src/lib/use-api.ts`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/experience/producer.ts`
- `apps/web/src/server/settings.ts`
- `apps/web/tests/intelligence-routes.test.ts`
- `apps/web/tests/intelligence-slice-b.test.ts`
- `apps/web/tests/intelligence-ui.test.ts`
- `docs/decisions/0003-adopt-shadcn-ui.md`
- `docs/superpowers/plans/ai-native-journal/phase-19.md`
- `docs/superpowers/reports/ai-native-journal-phase-19.md`

## Ownership verdict

```
.omp/reviewer-report.md: ALLOWED (local artifact)
apps/web/src/app/api/intelligence/controls/route.ts: ALLOWED (owned file)
apps/web/src/app/api/intelligence/observations/route.ts: ALLOWED (owned file)
apps/web/src/app/api/intelligence/queries.ts: ALLOWED (owned file)
apps/web/src/app/settings/page.tsx: ALLOWED (owned file)
apps/web/src/components/intelligence/controls.tsx: ALLOWED (owned directory prefix: apps/web/src/components/intelligence/)
apps/web/src/components/intelligence/inbox.tsx: ALLOWED (owned directory prefix: apps/web/src/components/intelligence/)
apps/web/src/components/intelligence/interaction-card.tsx: ALLOWED (owned directory prefix: apps/web/src/components/intelligence/)
apps/web/src/components/shell.tsx: ALLOWED (owned file)
apps/web/src/lib/intelligence-interactions.ts: ALLOWED (owned file)
apps/web/src/lib/use-api.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/composition.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/experience/producer.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/experience/)
apps/web/src/server/settings.ts: ALLOWED (owned file)
apps/web/tests/intelligence-routes.test.ts: ALLOWED (owned file)
apps/web/tests/intelligence-slice-b.test.ts: ALLOWED (owned file)
apps/web/tests/intelligence-ui.test.ts: ALLOWED (owned file)
docs/decisions/0003-adopt-shadcn-ui.md: ALLOWED (owned file)
docs/superpowers/plans/ai-native-journal/phase-19.md: ALLOWED (owned file)
docs/superpowers/reports/ai-native-journal-phase-19.md: ALLOWED (owned file)
OWNERSHIP VERDICT: ALLOWED
```

The Phase 19 ownership set is the exact files `apps/web/src/components/shell.tsx`, `apps/web/src/app/settings/page.tsx`, `apps/web/src/lib/intelligence-interactions.ts`, `apps/web/src/lib/use-api.ts`, `apps/web/src/lib/use-ai-request.ts`, `docs/decisions/0003-adopt-shadcn-ui.md`, `apps/web/tests/intelligence-ui.test.ts`, `apps/web/tests/intelligence-slice-b.test.ts`, `docs/superpowers/plans/ai-native-journal/phase-19.md` and `docs/superpowers/reports/ai-native-journal-phase-19.md`; the directory prefixes `apps/web/src/components/ui/` and `apps/web/src/components/intelligence/`; and the local artifact `.omp/reviewer-report.md` (tracked but gitignored, never staged). This phase owns NO route: `apps/web/src/app/api/` is deliberately absent from the allow-list, because those handlers were Phase 18's, so any change under that directory aborts the merge. No owned prefix reaches `apps/web/src/db/`, so this phase still owns no schema path and no migration. The extension points `PLAN_EXTENSION` and `COORDINATOR_EXTENSION` are empty, so widening the allow-list is a deliberate edit, never a silent side effect.

## Schema verdict

SCHEMA VERDICT: ALLOWED

- This phase owns NO migration. The migration diff against the merge base `14f8ec3aa0451c53c91d9503c2b79425232cdfaf` is empty: `git diff --name-status --find-renames 14f8ec3aa0451c53c91d9503c2b79425232cdfaf..062fa556677f13df1761812c02d30076b41b3074 -- apps/web/src/db/migrations/` returned no path, so no migration file was added, deleted or renamed.
- No path under `apps/web/src/db/` changed at all: the schema, the migration registry `apps/web/src/db/migrations.ts` and the checksum artifact `apps/web/src/db/migration-checksums.json` are untouched. The diff `git diff --name-status --find-renames 14f8ec3aa0451c53c91d9503c2b79425232cdfaf..062fa556677f13df1761812c02d30076b41b3074 -- apps/web/src/db/` returned no path.
- Migrations `0001 through 0007` are byte-unchanged against the merge base `14f8ec3aa0451c53c91d9503c2b79425232cdfaf`: the git blob hash of every migration file is identical at the merge base and at the candidate tip.

| Migration | File                                                         | Git blob hash                                           |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `0001`    | `apps/web/src/db/migrations/0001-legacy-baseline.ts`         | `5a2fd458699ecc523a237b9c13b33f35251c8453` (base = tip) |
| `0002`    | `apps/web/src/db/migrations/0002-trade-projections.ts`       | `ae720a2c5beff259a16c71891548dd7f8e82b46e` (base = tip) |
| `0003`    | `apps/web/src/db/migrations/0003-durable-jobs.ts`            | `030b6a8bf7688eaa4d8113665cba6cf526a8ef03` (base = tip) |
| `0004`    | `apps/web/src/db/migrations/0004-observations.ts`            | `103bb72ea3b71c6d0ef047eb57cd6e4df2292f9e` (base = tip) |
| `0005`    | `apps/web/src/db/migrations/0005-intelligence-runtime.ts`    | `353e55137c567af27e854fe9d2c6c4bb26c1ce4b` (base = tip) |
| `0006`    | `apps/web/src/db/migrations/0006-knowledge-scheduling.ts`    | `86bdbf2fe7facb7565c2b3d253042e22dd2d6185` (base = tip) |
| `0007`    | `apps/web/src/db/migrations/0007-intelligence-experience.ts` | `fe693722d11445f2b6b73623d288a9199c2efdff` (base = tip) |

## Layer-boundary verdict

LAYER BOUNDARY VERDICT: ALLOWED

- Contracts layer (`apps/web/src/server/intelligence/contracts/`): no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Contracts layer files: every file in the contracts directory (`apps/web/src/server/intelligence/contracts/`) obeys the same purity rule as the other contracts - no runtime import of a database module, a Next module, an AI SDK module or a workspace package. A type-only database import is reported, not counted. Phase 19 owns no contracts file; the rule is kept from Phase 18.
- Knowledge layer (`apps/web/src/server/intelligence/knowledge/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Experience layer (`apps/web/src/server/intelligence/experience/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package. A type-only database import is reported, not counted.
- Experience layer database rule: the experience domain layer must have NO runtime import of a database module. The database module opens the journal at import time, so a runtime import turns importing the domain layer into a database side effect and binds the domain layer to the database layer. Only a type-only database import is allowed. A type-only database reference is reported and not counted; a runtime database import is counted and fails this check.
- Runtime layer (`apps/web/src/server/intelligence/runtime/`): no direct database import. Persistence is reached through the infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`), which is exempt.
- Pure core package (`packages/core/src/time.ts`): no import from `apps/web`, no import through the `@/` path alias and no import of any workspace package. `packages/core` has zero dependencies and never imports from `apps/web`; a violation there is a cross-boundary import and fails this check. A type-only import counts as a violation too.
- Route directory (`apps/web/src/app/api/intelligence/`): this phase owns NO route, so nothing under `apps/web/src/app/api/` may change and the ownership verdict rejects any such change. The Phase 18 rule is kept unchanged: the handlers in that directory must not import a database module at runtime beyond what the repository's existing route handlers already do. The baseline was computed at the candidate tip from every existing route handler outside the new directory: `@/db`, `drizzle-orm`. A runtime database import of a module outside that baseline is counted and fails this check; a runtime import inside the baseline follows the existing route handler pattern; a type-only database reference is reported, not counted.
- Shared client-side interaction module (`apps/web/src/lib/intelligence-interactions.ts`): the module is bundled for the browser, so it must not import a database module, a Next server module or a Node-only module the browser bundle cannot resolve. Any such import is counted and fails this check, type-only references included. This phase EXTENDS that Phase 18 rule rather than forking it: the same classifier and the same counted set apply to the new client directory below.
- New client directory (`apps/web/src/components/intelligence/`): the directory is BROWSER code. It must import NO database module, NO Next server module (`next/server`, `next/headers`, `next/cache`, `server-only`) and NO Node-only module the browser bundle cannot resolve. Every violation is counted and reported as `file:line: text`, type-only references included, exactly as in the shared client-side interaction module rule this phase extends rather than forks. The Phase 19 review found that the experience domain layer once runtime-imported the database module, whose module-level connection opens the journal at import time; the same class of mistake in a client component breaks the browser bundle, so it must be caught here.
- Client surfaces (`apps/web/src/components/shell.tsx`, `apps/web/src/app/settings/page.tsx`): these are client surfaces too, so they must not import a database module or a Next server module. Every violation is reported as `file:line: text`, with type-only references reported but not counted and runtime imports counted.

Contracts layer imports (apps/web/src/server/intelligence/contracts/):

```
  apps/web/src/server/intelligence/contracts/experience.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
```

Route directory database-importing lines (apps/web/src/app/api/intelligence/, Phase 18's directory; this phase owns no route) - every line as file:line: text:

```
  apps/web/src/app/api/intelligence/queries.ts:1: import { and, asc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";   [runtime, matches the existing route handler pattern database import]
  apps/web/src/app/api/intelligence/queries.ts:2: import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";   [type-only database import]
  apps/web/src/app/api/intelligence/queries.ts:12: } from "@/db";   [runtime, matches the existing route handler pattern database import]
```

Route directory type-only database references (apps/web/src/app/api/intelligence/) - reported, not counted:

```
  apps/web/src/app/api/intelligence/queries.ts:2: import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
```

Route directory runtime database imports (apps/web/src/app/api/intelligence/) - counted when they go beyond the existing route handler pattern:

```
  apps/web/src/app/api/intelligence/queries.ts:1: import { and, asc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";   [not counted]
  apps/web/src/app/api/intelligence/queries.ts:12: } from "@/db";   [not counted]
```

Shared client-side interaction module imports (apps/web/src/lib/intelligence-interactions.ts) - a database module, a Next server module or a Node-only module is a violation:

```
  (none)
```

New client directory imports (apps/web/src/components/intelligence/) - the directory is browser code: a database module, a Next server module or a Node-only module is a violation, every line as file:line: text:

```
  (none)
```

Client surface imports (apps/web/src/components/shell.tsx, apps/web/src/app/settings/page.tsx) - a runtime database module or Next server module is counted, a type-only reference is reported:

```
  (none)
```

Phase 19 client code database-importing lines (the new client directory and the client surfaces) - every line as file:line: text:

```
  (none)
```

Phase 19 client code database imports counted as layer boundary violations:

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
  apps/web/src/server/intelligence/composition.ts:1: import { and, eq, inArray, like } from "drizzle-orm";
  apps/web/src/server/intelligence/composition.ts:2: import { db, type JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/composition.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/composition.ts:12: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/experience.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:1: import { and, asc, eq, gt, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:12: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:1: import { and, count, eq, gte, inArray, like, max } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:8: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:9: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:1: import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:3: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:10: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:1: import { and, eq, inArray, isNull, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:2: import { knowledgeHypotheses, knowledgePatterns, knowledgeSources } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:3: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:1: import { and, eq, ne } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:9: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:10: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/outbox.ts:1: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/outbox.ts:2: import { eventDeliveries } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:1: import { count, desc, eq, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:3: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:4: import { intelligenceBudgetReservations, intelligencePolicy, intelligenceRuns } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/retention.ts:1: import { eq, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/retention.ts:10: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/retention.ts:11: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:1: import { and, asc, eq, gt, gte, lt, or } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:4: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:5: import { intelligenceJobs, intelligenceSchedules, knowledgeSources } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/worker.ts:1: import { and, eq, lte } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/worker.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/worker.ts:4: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/worker.ts:5: import { intelligenceWorkerLease } from "@/db/schema";
  apps/web/src/server/intelligence/worker-entry.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/worker-entry.ts:64: const connection = await import("@/db/connection");
```

Runtime database imports (counted as violations where the layer forbids a runtime database dependency):

```
  apps/web/src/server/intelligence/composition.ts:1: import { and, eq, inArray, like } from "drizzle-orm";
  apps/web/src/server/intelligence/composition.ts:2: import { db, type JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/composition.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/composition.ts:12: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:1: import { and, asc, eq, gt, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:12: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:1: import { and, count, eq, gte, inArray, like, max } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:8: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:1: import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:3: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:10: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:1: import { and, eq, inArray, isNull, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:2: import { knowledgeHypotheses, knowledgePatterns, knowledgeSources } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:1: import { and, eq, ne } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:9: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/outbox.ts:2: import { eventDeliveries } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:1: import { count, desc, eq, sql } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:3: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:4: import { intelligenceBudgetReservations, intelligencePolicy, intelligenceRuns } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/retention.ts:1: import { eq, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/retention.ts:10: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:1: import { and, asc, eq, gt, gte, lt, or } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:4: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:5: import { intelligenceJobs, intelligenceSchedules, knowledgeSources } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/worker.ts:1: import { and, eq, lte } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/worker.ts:4: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/worker.ts:5: import { intelligenceWorkerLease } from "@/db/schema";
  apps/web/src/server/intelligence/worker-entry.ts:64: const connection = await import("@/db/connection");
```

Type-only database references (reported, no runtime dependency; not counted as violations in the contracts, knowledge and experience layers. The runtime layer and the pure core package count every database import, type-only included):

```
  apps/web/src/server/intelligence/contracts/experience.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:9: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:3: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:10: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/outbox.ts:1: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/retention.ts:11: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/worker.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/worker-entry.ts:2: import type { JournalDb } from "@/db/connection";
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
| `pnpm exec prettier --check <20 merged files>`                                      | 0    | passed |
| `pnpm build`                                                                        | 0    | passed |
| `pnpm test`                                                                         | 0    | passed |

The prettier file list was computed after the merge, from the merge commit itself: `git diff --name-only a305f726b5beddf039d055d24022b2a9b9c6add2..4cab43c983b4a2d8e252480b778f9b516a14dd11` in the feature worktree, with deleted paths excluded because prettier cannot check them (20 files).

- `.omp/reviewer-report.md`
- `apps/web/src/app/api/intelligence/controls/route.ts`
- `apps/web/src/app/api/intelligence/observations/route.ts`
- `apps/web/src/app/api/intelligence/queries.ts`
- `apps/web/src/app/settings/page.tsx`
- `apps/web/src/components/intelligence/controls.tsx`
- `apps/web/src/components/intelligence/inbox.tsx`
- `apps/web/src/components/intelligence/interaction-card.tsx`
- `apps/web/src/components/shell.tsx`
- `apps/web/src/lib/intelligence-interactions.ts`
- `apps/web/src/lib/use-api.ts`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/experience/producer.ts`
- `apps/web/src/server/settings.ts`
- `apps/web/tests/intelligence-routes.test.ts`
- `apps/web/tests/intelligence-slice-b.test.ts`
- `apps/web/tests/intelligence-ui.test.ts`
- `docs/decisions/0003-adopt-shadcn-ui.md`
- `docs/superpowers/plans/ai-native-journal/phase-19.md`
- `docs/superpowers/reports/ai-native-journal-phase-19.md`

The `desktop` workspace was deliberately not typechecked: its `cargo check` fails on a pre-existing repository defect (the Tauri sidecar resource `binaries/node-x86_64-pc-windows-msvc.exe` is missing because `desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` inside an ESM package). That defect belongs to Phase 21 and is recorded as blocked host evidence. It was not mocked and it is not reported as passed.

## Review verdict

PASS. The candidate commits were reviewed, the ownership boundary held (ALLOWED), the schema verdict is no migration owned with 0001 through 0007 byte-unchanged (ALLOWED), the layer-boundary verdict, including the contracts layer, the experience layer with its no-runtime-database-import rule, the pure core package rule, the new route directory rule (apps/web/src/app/api/intelligence/), the shared client-side interaction module rule (apps/web/src/lib/intelligence-interactions.ts), the new client directory browser rule (apps/web/src/components/intelligence/) and the client surface rule (apps/web/src/components/shell.tsx, apps/web/src/app/settings/page.tsx), is ALLOWED, and the destination gate passed on the destination branch.

## What was not done

No push happened. No pull request was opened. No merge into `main` happened. In short: no push, no PR and no `main` merge happened during this integration. The Docker daemon was not started and no Docker result is claimed. The `desktop` workspace cargo gate was not run, not mocked and not reported as passed; it stays recorded as blocked host evidence for Phase 21.

The tracked-but-gitignored local artifact `.omp/reviewer-report.md` was backed up before the merge, reset so the merge could proceed, and the local copy was restored afterwards. It was never staged and never committed by this integration.
