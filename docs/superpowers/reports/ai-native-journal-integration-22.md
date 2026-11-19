# Phase A integration - persist a revision-bound AI insight

## Outcome

Phase A was merged into `codex/ai-native-journal` at `dd30430086cf4eb0c21153f359dc851db159b2db` and the destination gate passed.

- Destination branch: `codex/ai-native-journal`
- Destination-before SHA: `084408c2c663c771b03c55ee62b702af6c4ca102`
- Candidate base SHA: `3340519c02a46cbac406c240c78d6b8809ccc73e`
- Candidate tip SHA: `f3a8182445d087b4b2a32a5d62349d18874acad0`
- Merge SHA: `dd30430086cf4eb0c21153f359dc851db159b2db` (`--no-ff`, subject `Merge Phase A: persist a revision-bound AI insight`)
- Merge parents: `084408c2c663c771b03c55ee62b702af6c4ca102` and `f3a8182445d087b4b2a32a5d62349d18874acad0`
- The candidate base was resolved at run time as `git merge-base codex/ai-native-journal-p22 codex/ai-native-journal`; no SHA is hardcoded in the integration script.

## Candidate commits

```
f3a8182 feat: bind the 0008 checksum to its migration source
3384194 docs: record the Phase A insight storage evidence
fbf63c7 feat: persist a revision-bound AI insight
97f0899 docs: plan the revision-bound insight storage
```

## Changed-file summary

```
.omp/reviewer-report.md                            | 192 +++----
 apps/web/src/db/bootstrap.ts                       |   3 +
 apps/web/src/db/migration-checksums.json           |   5 +
 apps/web/src/db/migrations.ts                      |   2 +
 apps/web/src/db/migrations/0008-ai-insights.ts     |  64 +++
 apps/web/src/db/schema.ts                          |  46 ++
 .../src/server/intelligence/contracts/insights.ts  |  92 ++++
 .../intelligence/infrastructure/insight-store.ts   | 230 ++++++++
 .../intelligence/infrastructure/retention.ts       |  12 +
 apps/web/tests/intelligence-backup.test.ts         |  77 +++
 apps/web/tests/intelligence-insights.test.ts       | 579 +++++++++++++++++++++
 .../tests/intelligence-knowledge-revisions.test.ts |  10 +-
 apps/web/tests/intelligence-migrations.test.ts     |  75 +++
 apps/web/tests/intelligence-workflows.test.ts      |   6 +-
 docs/database-migrations.md                        |  19 +-
 docs/intelligence-operations.md                    |  30 +-
 .../plans/ai-native-journal/phase-22.md            | 313 +++++++++++
 .../reports/ai-native-journal-phase-22.md          | 249 +++++++++
 18 files changed, 1851 insertions(+), 153 deletions(-)
```

18 candidate files, 18 files in the merge.

Merged files:

- `.omp/reviewer-report.md`
- `apps/web/src/db/bootstrap.ts`
- `apps/web/src/db/migration-checksums.json`
- `apps/web/src/db/migrations.ts`
- `apps/web/src/db/migrations/0008-ai-insights.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/server/intelligence/contracts/insights.ts`
- `apps/web/src/server/intelligence/infrastructure/insight-store.ts`
- `apps/web/src/server/intelligence/infrastructure/retention.ts`
- `apps/web/tests/intelligence-backup.test.ts`
- `apps/web/tests/intelligence-insights.test.ts`
- `apps/web/tests/intelligence-knowledge-revisions.test.ts`
- `apps/web/tests/intelligence-migrations.test.ts`
- `apps/web/tests/intelligence-workflows.test.ts`
- `docs/database-migrations.md`
- `docs/intelligence-operations.md`
- `docs/superpowers/plans/ai-native-journal/phase-22.md`
- `docs/superpowers/reports/ai-native-journal-phase-22.md`

## Ownership verdict

```
.omp/reviewer-report.md: ALLOWED (local artifact (tracked but gitignored, never staged))
apps/web/src/db/bootstrap.ts: ALLOWED (owned file)
apps/web/src/db/migration-checksums.json: ALLOWED (owned file)
apps/web/src/db/migrations.ts: ALLOWED (owned file)
apps/web/src/db/migrations/0008-ai-insights.ts: ALLOWED (owned directory prefix: apps/web/src/db/migrations/0008-)
apps/web/src/db/schema.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/contracts/insights.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/contracts/)
apps/web/src/server/intelligence/infrastructure/insight-store.ts: ALLOWED (owned directory prefix: apps/web/src/server/intelligence/infrastructure/)
apps/web/src/server/intelligence/infrastructure/retention.ts: ALLOWED (owned file)
apps/web/tests/intelligence-backup.test.ts: ALLOWED (owned file)
apps/web/tests/intelligence-insights.test.ts: ALLOWED (owned directory prefix: apps/web/tests/)
apps/web/tests/intelligence-knowledge-revisions.test.ts: ALLOWED (owned directory prefix: apps/web/tests/)
apps/web/tests/intelligence-migrations.test.ts: ALLOWED (owned file)
apps/web/tests/intelligence-workflows.test.ts: ALLOWED (owned directory prefix: apps/web/tests/)
docs/database-migrations.md: ALLOWED (owned file)
docs/intelligence-operations.md: ALLOWED (owned file)
docs/superpowers/plans/ai-native-journal/phase-22.md: ALLOWED (owned file)
docs/superpowers/reports/ai-native-journal-phase-22.md: ALLOWED (owned file)
OWNERSHIP VERDICT: ALLOWED
```

The Phase A ownership set is the exact files `apps/web/src/db/schema.ts`, `apps/web/src/db/migrations.ts`, `apps/web/src/db/bootstrap.ts`, `apps/web/src/db/migration-checksums.json`, `apps/web/src/server/trading/commands.ts`, `apps/web/src/server/intelligence/infrastructure/retention.ts`, `apps/web/src/server/intelligence/infrastructure/experience-store.ts`, `apps/web/tests/intelligence-migrations.test.ts`, `apps/web/tests/intelligence-retention.test.ts`, `apps/web/tests/intelligence-backup.test.ts`, `docs/intelligence-operations.md`, `docs/database-migrations.md`, `docs/superpowers/plans/ai-native-journal/phase-22.md`, `docs/superpowers/reports/ai-native-journal-phase-22.md`; the directory prefixes `apps/web/src/db/migrations/0008-`, `apps/web/src/server/intelligence/contracts/`, `apps/web/src/server/intelligence/infrastructure/`, `apps/web/tests/`; the local artifact `.omp/reviewer-report.md` (tracked but gitignored, never staged); and no other prefixes. The extension points `PLAN_EXTENSION` and `COORDINATOR_EXTENSION` are empty arrays, so a widening of the allow-list is a deliberate edit here and never a silent side effect of the review.

The worker chose the names of the new files and the coordinator granted the directories rather than fixed names, so the 6 path(s) below were accepted by a directory prefix and are MARKED as prefix-derived. They are listed here so the review can see exactly what a prefix let through.

Paths accepted through a directory prefix:

- `apps/web/src/db/migrations/0008-ai-insights.ts` — prefix: `apps/web/src/db/migrations/0008-` (prefix-derived)
- `apps/web/src/server/intelligence/contracts/insights.ts` — prefix: `apps/web/src/server/intelligence/contracts/` (prefix-derived)
- `apps/web/src/server/intelligence/infrastructure/insight-store.ts` — prefix: `apps/web/src/server/intelligence/infrastructure/` (prefix-derived)
- `apps/web/tests/intelligence-insights.test.ts` — prefix: `apps/web/tests/` (prefix-derived)
- `apps/web/tests/intelligence-knowledge-revisions.test.ts` — prefix: `apps/web/tests/` (prefix-derived)
- `apps/web/tests/intelligence-workflows.test.ts` — prefix: `apps/web/tests/` (prefix-derived)

## Schema verdict

SCHEMA VERDICT: ALLOWED

- Phase A owns exactly one migration: `apps/web/src/db/migrations/0008-ai-insights.ts`. It is the only migration file added; any other added migration aborts the run, and zero added `0008-*.ts` files aborts the run too.
- Migrations `0001 through 0007` are byte-unchanged against the merge base `3340519c02a46cbac406c240c78d6b8809ccc73e`: the git blob hash of every migration file is identical at the merge base and at the candidate tip.
- The changed registry line in `apps/web/src/db/migrations.ts`: `import { aiInsights } from "./migrations/0008-ai-insights.ts";`
- The new migration file blob hash at the candidate tip is `923e98c408a5cd127e381c0c8e1b2f90a3f1960f`.

### The new migration

| Property | Value |
| --- | --- |
| File | `apps/web/src/db/migrations/0008-ai-insights.ts` |
| Version | 8 |
| Name | `ai-insights` |
| Checksum | `0815aa9f1dd30f2250eb4ee7b94a526c8b1b0f1ac1345d8ef984922656c44aca` |

The checksum artifact was regenerated: `apps/web/src/db/migration-checksums.json` at the candidate tip carries the version 8 entry for `0008-ai-insights.ts` with the checksum above. The manifest entry, the migration file name and the declared migration name agree.

The gate step `pnpm --filter web migrations:check` exited 0 (passed): the regenerated checksum manifest matches the migration sources.

| Migration | File | Git blob hash |
| --- | --- | --- |
| `0001` | `apps/web/src/db/migrations/0001-legacy-baseline.ts` | `5a2fd458699ecc523a237b9c13b33f35251c8453` (base = tip) |
| `0002` | `apps/web/src/db/migrations/0002-trade-projections.ts` | `ae720a2c5beff259a16c71891548dd7f8e82b46e` (base = tip) |
| `0003` | `apps/web/src/db/migrations/0003-durable-jobs.ts` | `030b6a8bf7688eaa4d8113665cba6cf526a8ef03` (base = tip) |
| `0004` | `apps/web/src/db/migrations/0004-observations.ts` | `103bb72ea3b71c6d0ef047eb57cd6e4df2292f9e` (base = tip) |
| `0005` | `apps/web/src/db/migrations/0005-intelligence-runtime.ts` | `353e55137c567af27e854fe9d2c6c4bb26c1ce4b` (base = tip) |
| `0006` | `apps/web/src/db/migrations/0006-knowledge-scheduling.ts` | `86bdbf2fe7facb7565c2b3d253042e22dd2d6185` (base = tip) |
| `0007` | `apps/web/src/db/migrations/0007-intelligence-experience.ts` | `fe693722d11445f2b6b73623d288a9199c2efdff` (base = tip) |
| `0008` | `apps/web/src/db/migrations/0008-ai-insights.ts` | `923e98c408a5cd127e381c0c8e1b2f90a3f1960f` (added by this phase) |

## Layer-boundary verdict

LAYER BOUNDARY VERDICT: ALLOWED

- The boundary rules apply to the TypeScript tree only (`.ts` and `.tsx`). A `.rs` file, a `.yml` file, a `.mjs` script, a `.py` file, a `Dockerfile` and a markdown file are not TypeScript and are not checked against these rules.
- Contracts layer (`apps/web/src/server/intelligence/contracts/`): no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Knowledge layer (`apps/web/src/server/intelligence/knowledge/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Experience layer (`apps/web/src/server/intelligence/experience/`): the same purity rule holds, and the layer must not import the database at runtime: the database module opens the journal at import time. A type-only database import is reported, not counted.
- Runtime layer (`apps/web/src/server/intelligence/runtime/`): no direct database import. Persistence is reached through the infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`), which is exempt.
- Route directory (`apps/web/src/app/api/intelligence/`): this phase owns no route, and the handlers must not import a database module at runtime beyond what the repository's existing route handlers already use. The runtime database modules the existing handlers already use: @/db, drizzle-orm. A type-only database import is reported, not counted.
- Pure core package (`packages/core/src/time.ts`): no import from `apps/web`, no import through the `@/` path alias and no import of any workspace package. `packages/core` has zero dependencies and never imports from `apps/web`; a violation there is a cross-boundary import and fails this check. A type-only import counts as a violation too.

Database-importing lines (file:line: text):

```
  apps/web/src/server/intelligence/composition.ts:1: import { and, eq, inArray, like } from "drizzle-orm";
  apps/web/src/server/intelligence/composition.ts:2: import { db, type JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/composition.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/composition.ts:16: } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/experience.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/insights.ts:1: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:1: import { and, asc, eq, gt, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:12: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:1: import { and, count, eq, gte, inArray, like, max } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:9: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:10: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:1: import { and, eq, lt } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:8: import type { JournalTx } from "@/db/transaction";
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
  apps/web/src/server/intelligence/worker-entry.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/worker-entry.ts:64: const connection = await import("@/db/connection");
  apps/web/src/db/bootstrap.ts:1: import Database from "better-sqlite3";
  apps/web/src/db/migrations.ts:1: import type Database from "better-sqlite3";
  apps/web/src/db/migrations/0008-ai-insights.ts:1: import type Database from "better-sqlite3";
  apps/web/src/db/schema.ts:1: import { sql } from "drizzle-orm";
  apps/web/src/db/schema.ts:12: } from "drizzle-orm/sqlite-core";
  apps/web/tests/intelligence-backup.test.ts:19: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-backup.test.ts:49: } = await import("../src/db");
  apps/web/tests/intelligence-backup.test.ts:50: const { openConnection } = await import("../src/db/connection");
  apps/web/tests/intelligence-insights.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-insights.test.ts:33: } = await import("../src/db");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:6: import { eq, inArray } from "drizzle-orm";
  apps/web/tests/intelligence-knowledge-revisions.test.ts:42: } = await import("../src/db");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:43: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:319: const { applyMigrations } = await import("../src/db/migrations");
  apps/web/tests/intelligence-migrations.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/intelligence-migrations.test.ts:10: import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
  apps/web/tests/intelligence-migrations.test.ts:19: } from "../src/db/migrations";
  apps/web/tests/intelligence-migrations.test.ts:20: import checksumManifest from "../src/db/migration-checksums.json" with { type: "json" };
  apps/web/tests/intelligence-workflows.test.ts:6: import { eq, like } from "drizzle-orm";
  apps/web/tests/intelligence-workflows.test.ts:7: import type { JournalTx } from "../src/db/transaction";
  apps/web/tests/intelligence-workflows.test.ts:54: } = await import("../src/db");
  apps/web/tests/intelligence-workflows.test.ts:60: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-workflows.test.ts:61: const { applyMigrations } = await import("../src/db/migrations");
  apps/web/src/app/api/intelligence/queries.ts:1: import { and, asc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
  apps/web/src/app/api/intelligence/queries.ts:2: import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
  apps/web/src/app/api/intelligence/queries.ts:12: } from "@/db";
  apps/web/src/app/api/intelligence/retention/route.ts:4: import { accounts, db, dataDir, intelligenceSeedCheckpoints } from "@/db";
```

Type-only database references (reported, no runtime dependency, not counted as violations):

```
  apps/web/src/server/intelligence/contracts/experience.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/insights.ts:1: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:10: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:3: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:12: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/outbox.ts:1: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/worker.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/worker-entry.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/db/migrations.ts:1: import type Database from "better-sqlite3";
  apps/web/src/db/migrations/0008-ai-insights.ts:1: import type Database from "better-sqlite3";
  apps/web/tests/intelligence-workflows.test.ts:7: import type { JournalTx } from "../src/db/transaction";
  apps/web/src/app/api/intelligence/queries.ts:2: import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
```

Runtime database imports (counted where the layer forbids them):

```
  apps/web/src/server/intelligence/composition.ts:1: import { and, eq, inArray, like } from "drizzle-orm";
  apps/web/src/server/intelligence/composition.ts:2: import { db, type JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/composition.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/composition.ts:16: } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:1: import { and, asc, eq, gt, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:12: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:1: import { and, count, eq, gte, inArray, like, max } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:9: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:1: import { and, eq, lt } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/insight-store.ts:7: } from "@/db/schema";
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
  apps/web/src/db/bootstrap.ts:1: import Database from "better-sqlite3";
  apps/web/src/db/schema.ts:1: import { sql } from "drizzle-orm";
  apps/web/src/db/schema.ts:12: } from "drizzle-orm/sqlite-core";
  apps/web/tests/intelligence-backup.test.ts:19: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-backup.test.ts:49: } = await import("../src/db");
  apps/web/tests/intelligence-backup.test.ts:50: const { openConnection } = await import("../src/db/connection");
  apps/web/tests/intelligence-insights.test.ts:5: import { eq } from "drizzle-orm";
  apps/web/tests/intelligence-insights.test.ts:33: } = await import("../src/db");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:6: import { eq, inArray } from "drizzle-orm";
  apps/web/tests/intelligence-knowledge-revisions.test.ts:42: } = await import("../src/db");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:43: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-knowledge-revisions.test.ts:319: const { applyMigrations } = await import("../src/db/migrations");
  apps/web/tests/intelligence-migrations.test.ts:2: import Database from "better-sqlite3";
  apps/web/tests/intelligence-migrations.test.ts:10: import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
  apps/web/tests/intelligence-migrations.test.ts:19: } from "../src/db/migrations";
  apps/web/tests/intelligence-migrations.test.ts:20: import checksumManifest from "../src/db/migration-checksums.json" with { type: "json" };
  apps/web/tests/intelligence-workflows.test.ts:6: import { eq, like } from "drizzle-orm";
  apps/web/tests/intelligence-workflows.test.ts:54: } = await import("../src/db");
  apps/web/tests/intelligence-workflows.test.ts:60: const { withJournalTransaction } = await import("../src/db/transaction");
  apps/web/tests/intelligence-workflows.test.ts:61: const { applyMigrations } = await import("../src/db/migrations");
  apps/web/src/app/api/intelligence/queries.ts:1: import { and, asc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
  apps/web/src/app/api/intelligence/queries.ts:12: } from "@/db";
  apps/web/src/app/api/intelligence/retention/route.ts:4: import { accounts, db, dataDir, intelligenceSeedCheckpoints } from "@/db";
```

Route directory database imports (apps/web/src/app/api/intelligence/):

```
  apps/web/src/app/api/intelligence/queries.ts:1: import { and, asc, eq, gt, inArray, isNull, or, type SQL } from "drizzle-orm";
  apps/web/src/app/api/intelligence/queries.ts:2: import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
  apps/web/src/app/api/intelligence/queries.ts:12: } from "@/db";
  apps/web/src/app/api/intelligence/retention/route.ts:4: import { accounts, db, dataDir, intelligenceSeedCheckpoints } from "@/db";
```

Core package imports (packages/core/src/time.ts):

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
| `pnpm exec prettier --check <18 prettier-governed merged files>` | 0 | passed |
| `pnpm build` | 0 | passed |
| `pnpm test` | 0 | passed |

The prettier file list was computed after the merge, from the merge commit itself: `git diff --name-only 084408c2c663c771b03c55ee62b702af6c4ca102..dd30430086cf4eb0c21153f359dc851db159b2db` in the feature worktree, with deleted paths excluded because prettier cannot check them (18 merged files).

Only the files prettier actually governs are passed to prettier (18 of 18). A Rust file, a Python file and a Dockerfile are not prettier targets at all, and the YAML workflows are not prettier targets for this gate. Each remaining file was probed once with `pnpm exec prettier --check <file>` before the gate command, so the result below is per file:

```
  .omp/reviewer-report.md: prettier exit code 0 (formatted)
  apps/web/src/db/bootstrap.ts: prettier exit code 0 (formatted)
  apps/web/src/db/migration-checksums.json: prettier exit code 0 (formatted)
  apps/web/src/db/migrations.ts: prettier exit code 0 (formatted)
  apps/web/src/db/migrations/0008-ai-insights.ts: prettier exit code 0 (formatted)
  apps/web/src/db/schema.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/contracts/insights.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/infrastructure/insight-store.ts: prettier exit code 0 (formatted)
  apps/web/src/server/intelligence/infrastructure/retention.ts: prettier exit code 0 (formatted)
  apps/web/tests/intelligence-backup.test.ts: prettier exit code 0 (formatted)
  apps/web/tests/intelligence-insights.test.ts: prettier exit code 0 (formatted)
  apps/web/tests/intelligence-knowledge-revisions.test.ts: prettier exit code 0 (formatted)
  apps/web/tests/intelligence-migrations.test.ts: prettier exit code 0 (formatted)
  apps/web/tests/intelligence-workflows.test.ts: prettier exit code 0 (formatted)
  docs/database-migrations.md: prettier exit code 0 (formatted)
  docs/intelligence-operations.md: prettier exit code 0 (formatted)
  docs/superpowers/plans/ai-native-journal/phase-22.md: prettier exit code 0 (formatted)
  docs/superpowers/reports/ai-native-journal-phase-22.md: prettier exit code 0 (formatted)
```

Files excluded from the prettier scope:

```
  (none)
```

- prettier-governed: `.omp/reviewer-report.md`
- prettier-governed: `apps/web/src/db/bootstrap.ts`
- prettier-governed: `apps/web/src/db/migration-checksums.json`
- prettier-governed: `apps/web/src/db/migrations.ts`
- prettier-governed: `apps/web/src/db/migrations/0008-ai-insights.ts`
- prettier-governed: `apps/web/src/db/schema.ts`
- prettier-governed: `apps/web/src/server/intelligence/contracts/insights.ts`
- prettier-governed: `apps/web/src/server/intelligence/infrastructure/insight-store.ts`
- prettier-governed: `apps/web/src/server/intelligence/infrastructure/retention.ts`
- prettier-governed: `apps/web/tests/intelligence-backup.test.ts`
- prettier-governed: `apps/web/tests/intelligence-insights.test.ts`
- prettier-governed: `apps/web/tests/intelligence-knowledge-revisions.test.ts`
- prettier-governed: `apps/web/tests/intelligence-migrations.test.ts`
- prettier-governed: `apps/web/tests/intelligence-workflows.test.ts`
- prettier-governed: `docs/database-migrations.md`
- prettier-governed: `docs/intelligence-operations.md`
- prettier-governed: `docs/superpowers/plans/ai-native-journal/phase-22.md`
- prettier-governed: `docs/superpowers/reports/ai-native-journal-phase-22.md`

The `desktop` workspace was deliberately not typechecked: its `cargo check` fails on a pre-existing repository defect (the Tauri sidecar resource `binaries/node-x86_64-pc-windows-msvc.exe` is missing because `desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` inside an ESM package). That defect belongs to Phase 21 and is recorded as blocked host evidence. It was not mocked and it is not reported as passed.

## Review verdict

PASS. The candidate commits were reviewed, the ownership boundary held (ALLOWED, with the 6 prefix-derived path(s) marked above), the schema verdict is exactly one 0008 migration with 0001 through 0007 byte-unchanged (ALLOWED), the layer-boundary verdict, including the contracts, knowledge, experience, runtime, route-directory and pure core package rules, is ALLOWED, and the destination gate passed on the destination branch.

## What was not done

No push happened. No pull request was opened. No merge into `main` happened. The Docker daemon was not started and no Docker result is claimed. The `desktop` workspace cargo gate was not run, not mocked and not reported as passed; it stays recorded as blocked host evidence for Phase 21.

The tracked-but-gitignored local artifact `.omp/reviewer-report.md` was backed up before the merge, reset so the merge could proceed, and the local copy was restored afterwards. It was never staged and never committed by this integration.
