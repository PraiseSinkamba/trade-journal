# Phase 18 integration - authenticated interaction and control APIs

## Outcome

Phase 18 was merged into `codex/ai-native-journal` at `d5a230e6e76bb0ac52197c7f965b80ea72db03bc`, but the destination gate FAILED at `pnpm exec prettier --check <17 merged files>` (exit code 1). The failing command was not re-run, no success is claimed, and the merge was not undone.

- Destination branch: `codex/ai-native-journal`
- Destination-before SHA: `cba9dce5ebb91432c324c91f5ce07c784999eef7`
- Candidate base SHA: `a616a67cf340144e294a607ef048a0c6bcc77a49`
- Candidate tip SHA: `2683b8cebb2cc972831f80b614f2e878bcade1f9`
- Merge SHA: `d5a230e6e76bb0ac52197c7f965b80ea72db03bc` (`--no-ff`)
- Merge parents: `cba9dce5ebb91432c324c91f5ce07c784999eef7` and `2683b8cebb2cc972831f80b614f2e878bcade1f9`
- The candidate base was resolved at run time as `git merge-base codex/ai-native-journal-p18 codex/ai-native-journal`; no SHA is hardcoded in the integration script.

## Candidate commits

```
2683b8c docs: record the Phase 18 observation and scope repair
ce1b098 fix: refuse a review of an inactive observation and pin the revoked scope refusal
ddbd0db docs: record the Phase 18 interaction API evidence
c0cfb30 feat: expose controlled intelligence interactions and user settings
3261798 docs: plan the authenticated interaction APIs
```

## Changed-file summary

```
.omp/reviewer-report.md                            | 337 +++-------
 .../web/src/app/api/intelligence/commands/route.ts |  31 +
 .../app/api/intelligence/conversations/route.ts    |  39 ++
 .../src/app/api/intelligence/observations/route.ts | 122 ++++
 .../app/api/intelligence/opportunities/route.ts    | 112 ++++
 apps/web/src/app/api/intelligence/queries.ts       | 209 ++++++
 apps/web/src/app/api/intelligence/status/route.ts  |  27 +
 apps/web/src/lib/intelligence-interactions.ts      | 207 ++++++
 apps/web/src/server/api.ts                         |  35 +-
 apps/web/src/server/intelligence/composition.ts    |  87 ++-
 .../src/server/intelligence/experience/commands.ts | 135 ++++
 .../src/server/intelligence/experience/intents.ts  | 146 ++++
 .../server/intelligence/experience/interactions.ts |   4 +-
 apps/web/src/server/request-origin.ts              |  97 +++
 apps/web/tests/intelligence-routes.test.ts         | 735 +++++++++++++++++++++
 .../plans/ai-native-journal/phase-18.md            | 448 +++++++++++++
 .../reports/ai-native-journal-phase-18.md          | 285 ++++++++
 17 files changed, 2805 insertions(+), 251 deletions(-)
```

17 candidate files, 17 files in the merge.

Merged files:

- `.omp/reviewer-report.md`
- `apps/web/src/app/api/intelligence/commands/route.ts`
- `apps/web/src/app/api/intelligence/conversations/route.ts`
- `apps/web/src/app/api/intelligence/observations/route.ts`
- `apps/web/src/app/api/intelligence/opportunities/route.ts`
- `apps/web/src/app/api/intelligence/queries.ts`
- `apps/web/src/app/api/intelligence/status/route.ts`
- `apps/web/src/lib/intelligence-interactions.ts`
- `apps/web/src/server/api.ts`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/experience/commands.ts`
- `apps/web/src/server/intelligence/experience/intents.ts`
- `apps/web/src/server/intelligence/experience/interactions.ts`
- `apps/web/src/server/request-origin.ts`
- `apps/web/tests/intelligence-routes.test.ts`
- `docs/superpowers/plans/ai-native-journal/phase-18.md`
- `docs/superpowers/reports/ai-native-journal-phase-18.md`

## Ownership verdict

```
.omp/reviewer-report.md: ALLOWED (local artifact)
apps/web/src/app/api/intelligence/commands/route.ts: ALLOWED (owned directory prefix: apps/web/src/app/api/intelligence/)
apps/web/src/app/api/intelligence/conversations/route.ts: ALLOWED (owned directory prefix: apps/web/src/app/api/intelligence/)
apps/web/src/app/api/intelligence/observations/route.ts: ALLOWED (owned directory prefix: apps/web/src/app/api/intelligence/)
apps/web/src/app/api/intelligence/opportunities/route.ts: ALLOWED (owned directory prefix: apps/web/src/app/api/intelligence/)
apps/web/src/app/api/intelligence/queries.ts: ALLOWED (owned directory prefix: apps/web/src/app/api/intelligence/)
apps/web/src/app/api/intelligence/status/route.ts: ALLOWED (owned directory prefix: apps/web/src/app/api/intelligence/)
apps/web/src/lib/intelligence-interactions.ts: ALLOWED (owned file)
apps/web/src/server/api.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/composition.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/experience/commands.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/experience/)
apps/web/src/server/intelligence/experience/intents.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/experience/)
apps/web/src/server/intelligence/experience/interactions.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/experience/)
apps/web/src/server/request-origin.ts: ALLOWED (owned file)
apps/web/tests/intelligence-routes.test.ts: ALLOWED (owned file)
docs/superpowers/plans/ai-native-journal/phase-18.md: ALLOWED (owned file)
docs/superpowers/reports/ai-native-journal-phase-18.md: ALLOWED (owned file)
OWNERSHIP VERDICT: ALLOWED
```

The Phase 18 ownership set is the exact files `apps/web/src/server/api.ts`, `apps/web/src/server/auth.ts`, `apps/web/src/server/request-origin.ts`, `apps/web/src/server/intelligence/composition.ts`, `apps/web/src/lib/intelligence-interactions.ts`, `apps/web/tests/intelligence-routes.test.ts`, `docs/superpowers/plans/ai-native-journal/phase-18.md` and `docs/superpowers/reports/ai-native-journal-phase-18.md`; the directory prefixes `apps/web/src/app/api/intelligence/`, `apps/web/src/server/intelligence/experience/` and `apps/web/src/server/intelligence/contracts/`; and the local artifact `.omp/reviewer-report.md` (tracked but gitignored, never staged). No owned prefix reaches `apps/web/src/db/`, so this phase still owns no schema path and no migration. The extension points `PLAN_EXTENSION` and `COORDINATOR_EXTENSION` are empty, so widening the allow-list is a deliberate edit, never a silent side effect.

## Schema verdict

SCHEMA VERDICT: ALLOWED

- This phase owns NO migration. The migration diff against the merge base `a616a67cf340144e294a607ef048a0c6bcc77a49` is empty: `git diff --name-status --find-renames a616a67cf340144e294a607ef048a0c6bcc77a49..2683b8cebb2cc972831f80b614f2e878bcade1f9 -- apps/web/src/db/migrations/` returned no path, so no migration file was added, deleted or renamed.
- No path under `apps/web/src/db/` changed at all: the schema, the migration registry `apps/web/src/db/migrations.ts` and the checksum artifact `apps/web/src/db/migration-checksums.json` are untouched. The diff `git diff --name-status --find-renames a616a67cf340144e294a607ef048a0c6bcc77a49..2683b8cebb2cc972831f80b614f2e878bcade1f9 -- apps/web/src/db/` returned no path.
- Migrations `0001 through 0007` are byte-unchanged against the merge base `a616a67cf340144e294a607ef048a0c6bcc77a49`: the git blob hash of every migration file is identical at the merge base and at the candidate tip.

| Migration | File | Git blob hash |
| --- | --- | --- |
| `0001` | `apps/web/src/db/migrations/0001-legacy-baseline.ts` | `5a2fd458699ecc523a237b9c13b33f35251c8453` (base = tip) |
| `0002` | `apps/web/src/db/migrations/0002-trade-projections.ts` | `ae720a2c5beff259a16c71891548dd7f8e82b46e` (base = tip) |
| `0003` | `apps/web/src/db/migrations/0003-durable-jobs.ts` | `030b6a8bf7688eaa4d8113665cba6cf526a8ef03` (base = tip) |
| `0004` | `apps/web/src/db/migrations/0004-observations.ts` | `103bb72ea3b71c6d0ef047eb57cd6e4df2292f9e` (base = tip) |
| `0005` | `apps/web/src/db/migrations/0005-intelligence-runtime.ts` | `353e55137c567af27e854fe9d2c6c4bb26c1ce4b` (base = tip) |
| `0006` | `apps/web/src/db/migrations/0006-knowledge-scheduling.ts` | `86bdbf2fe7facb7565c2b3d253042e22dd2d6185` (base = tip) |
| `0007` | `apps/web/src/db/migrations/0007-intelligence-experience.ts` | `fe693722d11445f2b6b73623d288a9199c2efdff` (base = tip) |

## Layer-boundary verdict

LAYER BOUNDARY VERDICT: ALLOWED

- Contracts layer (`apps/web/src/server/intelligence/contracts/`): no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Contracts file of this phase: every file in the contracts directory (`apps/web/src/server/intelligence/contracts/`) obeys the same purity rule as the other contracts - no runtime import of a database module, a Next module, an AI SDK module or a workspace package. A type-only database import is reported, not counted.
- Knowledge layer (`apps/web/src/server/intelligence/knowledge/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Experience layer (`apps/web/src/server/intelligence/experience/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package. A type-only database import is reported, not counted.
- Experience layer database rule: the experience domain layer must have NO runtime import of a database module. The database module opens the journal at import time, so a runtime import turns importing the domain layer into a database side effect and binds the domain layer to the database layer. Only a type-only database import is allowed. A type-only database reference is reported and not counted; a runtime database import is counted and fails this check.
- Runtime layer (`apps/web/src/server/intelligence/runtime/`): no direct database import. Persistence is reached through the infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`), which is exempt.
- Pure core package (`packages/core/src/time.ts`): no import from `apps/web`, no import through the `@/` path alias and no import of any workspace package. `packages/core` has zero dependencies and never imports from `apps/web`; a violation there is a cross-boundary import and fails this check. A type-only import counts as a violation too.
- New route directory (`apps/web/src/app/api/intelligence/`): the new authenticated intelligence handlers must not import a database module at runtime beyond what the repository's existing route handlers already do. The baseline was computed at the candidate tip from every existing route handler outside the new directory: `@/db`, `drizzle-orm`. A runtime database import of a module outside that baseline is counted and fails this check; a runtime import inside the baseline follows the existing route handler pattern; a type-only database reference is reported, not counted.
- Shared client-side interaction module (`apps/web/src/lib/intelligence-interactions.ts`): the module is bundled for the browser, so it must not import a database module, a Next server module or a Node-only module the browser bundle cannot resolve. Any such import is counted and fails this check, type-only references included.

Contracts layer imports (apps/web/src/server/intelligence/contracts/):

```
  apps/web/src/server/intelligence/contracts/experience.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
```

New route directory database-importing lines (apps/web/src/app/api/intelligence/) - every line as file:line: text:

```
  apps/web/src/app/api/intelligence/queries.ts:1: import { and, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";   [runtime, matches the existing route handler pattern database import]
  apps/web/src/app/api/intelligence/queries.ts:2: import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";   [type-only database import]
  apps/web/src/app/api/intelligence/queries.ts:12: } from "@/db";   [runtime, matches the existing route handler pattern database import]
```

New route directory type-only database references (apps/web/src/app/api/intelligence/) - reported, not counted:

```
  apps/web/src/app/api/intelligence/queries.ts:2: import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
```

New route directory runtime database imports (apps/web/src/app/api/intelligence/) - counted when they go beyond the existing route handler pattern:

```
  apps/web/src/app/api/intelligence/queries.ts:1: import { and, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";   [not counted]
  apps/web/src/app/api/intelligence/queries.ts:12: } from "@/db";   [not counted]
```

Shared client-side interaction module imports (apps/web/src/lib/intelligence-interactions.ts) - a database module, a Next server module or a Node-only module is a violation:

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
  apps/web/src/server/intelligence/composition.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/intelligence/composition.ts:2: import { db, type JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/composition.ts:3: import { accounts, domainOutbox, intelligenceJobs, tradeProjectionRevisions } from "@/db/schema";
  apps/web/src/server/intelligence/composition.ts:4: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
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
  apps/web/src/server/intelligence/composition.ts:1: import { eq } from "drizzle-orm";
  apps/web/src/server/intelligence/composition.ts:2: import { db, type JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/composition.ts:3: import { accounts, domainOutbox, intelligenceJobs, tradeProjectionRevisions } from "@/db/schema";
  apps/web/src/server/intelligence/composition.ts:4: import { withJournalTransaction, type JournalTx } from "@/db/transaction";
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

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | passed |
| `pnpm --filter web typecheck` | 0 | passed |
| `pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck` | 0 | passed |
| `pnpm --filter web migrations:check` | 0 | passed |
| `node scripts/check-licenses.mjs` | 0 | passed |
| `pnpm exec prettier --check <17 merged files>` | 1 | failed |
| `pnpm build` | - | not run (gate stopped) |
| `pnpm test` | - | not run (gate stopped) |

The prettier file list was computed after the merge, from the merge commit itself: `git diff --name-only cba9dce5ebb91432c324c91f5ce07c784999eef7..d5a230e6e76bb0ac52197c7f965b80ea72db03bc` in the feature worktree, with deleted paths excluded because prettier cannot check them (17 files).

- `.omp/reviewer-report.md`
- `apps/web/src/app/api/intelligence/commands/route.ts`
- `apps/web/src/app/api/intelligence/conversations/route.ts`
- `apps/web/src/app/api/intelligence/observations/route.ts`
- `apps/web/src/app/api/intelligence/opportunities/route.ts`
- `apps/web/src/app/api/intelligence/queries.ts`
- `apps/web/src/app/api/intelligence/status/route.ts`
- `apps/web/src/lib/intelligence-interactions.ts`
- `apps/web/src/server/api.ts`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/experience/commands.ts`
- `apps/web/src/server/intelligence/experience/intents.ts`
- `apps/web/src/server/intelligence/experience/interactions.ts`
- `apps/web/src/server/request-origin.ts`
- `apps/web/tests/intelligence-routes.test.ts`
- `docs/superpowers/plans/ai-native-journal/phase-18.md`
- `docs/superpowers/reports/ai-native-journal-phase-18.md`

The gate stopped at `pnpm exec prettier --check <17 merged files>` with exit code 1. The exact failing command was:

```
pnpm exec prettier --check .omp/reviewer-report.md apps/web/src/app/api/intelligence/commands/route.ts apps/web/src/app/api/intelligence/conversations/route.ts apps/web/src/app/api/intelligence/observations/route.ts apps/web/src/app/api/intelligence/opportunities/route.ts apps/web/src/app/api/intelligence/queries.ts apps/web/src/app/api/intelligence/status/route.ts apps/web/src/lib/intelligence-interactions.ts apps/web/src/server/api.ts apps/web/src/server/intelligence/composition.ts apps/web/src/server/intelligence/experience/commands.ts apps/web/src/server/intelligence/experience/intents.ts apps/web/src/server/intelligence/experience/interactions.ts apps/web/src/server/request-origin.ts apps/web/tests/intelligence-routes.test.ts docs/superpowers/plans/ai-native-journal/phase-18.md docs/superpowers/reports/ai-native-journal-phase-18.md
```

Every command after it was not run. The gate did not pass and this report does not claim it did.

The `desktop` workspace was deliberately not typechecked: its `cargo check` fails on a pre-existing repository defect (the Tauri sidecar resource `binaries/node-x86_64-pc-windows-msvc.exe` is missing because `desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` inside an ESM package). That defect belongs to Phase 21 and is recorded as blocked host evidence. It was not mocked and it is not reported as passed.

## Review verdict

CHANGES REQUIRED. The ownership verdict is ALLOWED, the schema verdict is ALLOWED (this phase owns no migration and migrations 0001 through 0007 are byte-unchanged) and the layer-boundary verdict, including the contracts layer, the experience layer with its no-runtime-database-import rule, the pure core package rule, the new route directory rule (apps/web/src/app/api/intelligence/) and the shared client-side interaction module rule (apps/web/src/lib/intelligence-interactions.ts), is ALLOWED, but the destination gate failed at `pnpm exec prettier --check <17 merged files>` (exit code 1). The merge stays in place; the failing command must be fixed and the gate re-run before this phase is called integrated.

## What was not done

No push happened. No pull request was opened. No merge into `main` happened. The Docker daemon was not started and no Docker result is claimed. The `desktop` workspace cargo gate was not run, not mocked and not reported as passed; it stays recorded as blocked host evidence for Phase 21.

The tracked-but-gitignored local artifact `.omp/reviewer-report.md` was backed up before the merge, reset so the merge could proceed, and the local copy was restored afterwards. It was never staged and never committed by this integration.
