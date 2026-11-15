# Phase 16 integration - persistent workflow command and transition engine

## Outcome

Phase 16 was merged into `codex/ai-native-journal` at `a305aba1f5f0f10dc633fe40c44b0b49262c6769` and the destination gate passed.

- Destination branch: `codex/ai-native-journal`
- Destination-before SHA: `cd78d5fcc76d9c61bba8d9f4c486b78de2bec07c`
- Candidate base SHA: `96b39b3062ec381f15b2ba00fee143ee8e8d4dce`
- Candidate tip SHA: `8b3d84deb4122e898dac83dad99c0b9802decb70`
- Merge SHA: `a305aba1f5f0f10dc633fe40c44b0b49262c6769` (`--no-ff`)
- Merge parents: `cd78d5fcc76d9c61bba8d9f4c486b78de2bec07c` and `8b3d84deb4122e898dac83dad99c0b9802decb70`
- The candidate base was resolved at run time as `git merge-base codex/ai-native-journal-p16 codex/ai-native-journal`; no SHA is hardcoded in the integration script.

## Candidate commits

```
8b3d84d docs: record the Phase 16 domain boundary repair
f9b5ff5 fix: keep the workflow domain layer free of the database and validate its definition version
d84150b docs: record the Phase 16 workflow engine evidence
6f0dd32 feat: persist workflows and coordinate engagement
cee2009 docs: plan the workflow command and transition engine
```

## Changed-file summary

```
.omp/reviewer-report.md                            |  82 +-
 apps/web/src/db/bootstrap.ts                       |   3 +
 apps/web/src/db/migration-checksums.json           |   5 +
 apps/web/src/db/migrations.ts                      |   2 +
 .../db/migrations/0007-intelligence-experience.ts  | 144 ++++
 apps/web/src/db/schema.ts                          | 228 ++++++
 .../server/intelligence/contracts/experience.ts    | 308 ++++++++
 .../server/intelligence/experience/workflows.ts    | 355 +++++++++
 .../infrastructure/experience-store.ts             | 107 +++
 .../tests/intelligence-knowledge-revisions.test.ts |  11 +
 apps/web/tests/intelligence-workflows.test.ts      | 865 +++++++++++++++++++++
 .../plans/ai-native-journal/phase-16.md            | 330 ++++++++
 .../reports/ai-native-journal-phase-16.md          | 356 +++++++++
 13 files changed, 2764 insertions(+), 32 deletions(-)
```

13 candidate files, 13 files in the merge.

Merged files:

- `.omp/reviewer-report.md`
- `apps/web/src/db/bootstrap.ts`
- `apps/web/src/db/migration-checksums.json`
- `apps/web/src/db/migrations.ts`
- `apps/web/src/db/migrations/0007-intelligence-experience.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/server/intelligence/contracts/experience.ts`
- `apps/web/src/server/intelligence/experience/workflows.ts`
- `apps/web/src/server/intelligence/infrastructure/experience-store.ts`
- `apps/web/tests/intelligence-knowledge-revisions.test.ts`
- `apps/web/tests/intelligence-workflows.test.ts`
- `docs/superpowers/plans/ai-native-journal/phase-16.md`
- `docs/superpowers/reports/ai-native-journal-phase-16.md`

## Ownership verdict

```
.omp/reviewer-report.md: ALLOWED (local artifact)
apps/web/src/db/bootstrap.ts: ALLOWED (owned file)
apps/web/src/db/migration-checksums.json: ALLOWED (owned file)
apps/web/src/db/migrations.ts: ALLOWED (owned file)
apps/web/src/db/migrations/0007-intelligence-experience.ts: ALLOWED (owned directory: only one added 0007-*.ts migration is allowed)
apps/web/src/db/schema.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/contracts/experience.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/experience/workflows.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/infrastructure/experience-store.ts: ALLOWED (owned file)
apps/web/tests/intelligence-knowledge-revisions.test.ts: ALLOWED (owned file)
apps/web/tests/intelligence-workflows.test.ts: ALLOWED (owned file)
docs/superpowers/plans/ai-native-journal/phase-16.md: ALLOWED (owned file)
docs/superpowers/reports/ai-native-journal-phase-16.md: ALLOWED (owned file)
OWNERSHIP VERDICT: ALLOWED
```

The Phase 16 ownership set is the exact files `apps/web/src/server/intelligence/contracts/experience.ts`, `apps/web/src/server/intelligence/experience/workflows.ts`, `apps/web/src/server/intelligence/infrastructure/experience-store.ts`, `apps/web/src/server/intelligence/infrastructure/jobs.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/db/migrations.ts`, `apps/web/src/db/bootstrap.ts`, `apps/web/src/db/migration-checksums.json`, `apps/web/tests/intelligence-workflows.test.ts`, `docs/superpowers/plans/ai-native-journal/phase-16.md` and `docs/superpowers/reports/ai-native-journal-phase-16.md`; the directory prefix `apps/web/src/db/migrations/`, which the schema verdict restricts to exactly one added file named `0007-*.ts`; the local artifact `.omp/reviewer-report.md` (tracked but gitignored, never staged); and no other prefixes. The extension points `PLAN_EXTENSION` and `COORDINATOR_EXTENSION` are empty, so widening the allow-list is a deliberate edit, never a silent side effect.

## Schema verdict

SCHEMA VERDICT: ALLOWED

- Phase 16 owns exactly one migration: `apps/web/src/db/migrations/0007-intelligence-experience.ts`. It is the only migration file added; any other added migration aborts the run.
- Migrations `0001 through 0006` are byte-unchanged against the merge base `96b39b3062ec381f15b2ba00fee143ee8e8d4dce`: the git blob hash of every migration file is identical at the merge base and at the candidate tip.
- The changed registry line in `apps/web/src/db/migrations.ts`: `import { intelligenceExperience } from "./migrations/0007-intelligence-experience.ts";`
- The new migration file blob hash at the candidate tip is `fe693722d11445f2b6b73623d288a9199c2efdff`.

| Migration | File | Git blob hash |
| --- | --- | --- |
| `0001` | `apps/web/src/db/migrations/0001-legacy-baseline.ts` | `5a2fd458699ecc523a237b9c13b33f35251c8453` (base = tip) |
| `0002` | `apps/web/src/db/migrations/0002-trade-projections.ts` | `ae720a2c5beff259a16c71891548dd7f8e82b46e` (base = tip) |
| `0003` | `apps/web/src/db/migrations/0003-durable-jobs.ts` | `030b6a8bf7688eaa4d8113665cba6cf526a8ef03` (base = tip) |
| `0004` | `apps/web/src/db/migrations/0004-observations.ts` | `103bb72ea3b71c6d0ef047eb57cd6e4df2292f9e` (base = tip) |
| `0005` | `apps/web/src/db/migrations/0005-intelligence-runtime.ts` | `353e55137c567af27e854fe9d2c6c4bb26c1ce4b` (base = tip) |
| `0006` | `apps/web/src/db/migrations/0006-knowledge-scheduling.ts` | `86bdbf2fe7facb7565c2b3d253042e22dd2d6185` (base = tip) |
| `0007` | `apps/web/src/db/migrations/0007-intelligence-experience.ts` | `fe693722d11445f2b6b73623d288a9199c2efdff` (added by this phase) |

## Layer-boundary verdict

LAYER BOUNDARY VERDICT: ALLOWED

- Contracts layer (`apps/web/src/server/intelligence/contracts/`): no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- New contracts file (`apps/web/src/server/intelligence/contracts/experience.ts`): the same purity rule as the other contracts - no runtime import of a database module, a Next module, an AI SDK module or a workspace package. A type-only database import is reported, not counted.
- Knowledge layer (`apps/web/src/server/intelligence/knowledge/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- New experience layer (`apps/web/src/server/intelligence/experience/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package. A type-only database import is reported, not counted.
- Runtime layer (`apps/web/src/server/intelligence/runtime/`): no direct database import. Persistence is reached through the infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`), which is exempt.
- Pure core package (`packages/core/src/time.ts`): no import from `apps/web`, no import through the `@/` path alias and no import of any workspace package. `packages/core` has zero dependencies and never imports from `apps/web`; a violation there is a cross-boundary import and fails this check. A type-only import counts as a violation too.

New contracts file imports (apps/web/src/server/intelligence/contracts/experience.ts):

```
  apps/web/src/server/intelligence/contracts/experience.ts:2: import type { intelligenceWorkflows, interactionCommands, workflowTransitions } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:3: import type { JournalTx } from "@/db/transaction";
```

New experience layer imports (apps/web/src/server/intelligence/experience/):

```
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
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
  apps/web/src/server/intelligence/contracts/experience.ts:2: import type { intelligenceWorkflows, interactionCommands, workflowTransitions } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:3: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:1: import { and, asc, eq, gt, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:12: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:1: import { and, eq, inArray, like } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:8: import type { JournalTx } from "@/db/transaction";
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

Type-only database references (reported, no runtime dependency, not counted as violations):

```
  apps/web/src/server/intelligence/contracts/experience.ts:2: import type { intelligenceWorkflows, interactionCommands, workflowTransitions } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:3: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:8: import type { JournalTx } from "@/db/transaction";
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

## Destination gate

One full gate run on the destination branch, alone on the host, sequentially. Every exit code is the exit status of the command itself, never the status of a pipe.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | passed |
| `pnpm --filter web typecheck` | 0 | passed |
| `pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck` | 0 | passed |
| `pnpm --filter web migrations:check` | 0 | passed |
| `node scripts/check-licenses.mjs` | 0 | passed |
| `pnpm exec prettier --check <13 merged files>` | 0 | passed |
| `pnpm build` | 0 | passed |
| `pnpm test` | 0 | passed |

The prettier file list was computed after the merge, from the merge commit itself: `git diff --name-only cd78d5fcc76d9c61bba8d9f4c486b78de2bec07c..a305aba1f5f0f10dc633fe40c44b0b49262c6769` in the feature worktree, with deleted paths excluded because prettier cannot check them (13 files).

- `.omp/reviewer-report.md`
- `apps/web/src/db/bootstrap.ts`
- `apps/web/src/db/migration-checksums.json`
- `apps/web/src/db/migrations.ts`
- `apps/web/src/db/migrations/0007-intelligence-experience.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/server/intelligence/contracts/experience.ts`
- `apps/web/src/server/intelligence/experience/workflows.ts`
- `apps/web/src/server/intelligence/infrastructure/experience-store.ts`
- `apps/web/tests/intelligence-knowledge-revisions.test.ts`
- `apps/web/tests/intelligence-workflows.test.ts`
- `docs/superpowers/plans/ai-native-journal/phase-16.md`
- `docs/superpowers/reports/ai-native-journal-phase-16.md`

The `desktop` workspace was deliberately not typechecked: its `cargo check` fails on a pre-existing repository defect (the Tauri sidecar resource `binaries/node-x86_64-pc-windows-msvc.exe` is missing because `desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` inside an ESM package). That defect belongs to Phase 21 and is recorded as blocked host evidence. It was not mocked and it is not reported as passed.

## Review verdict

PASS. The candidate commits were reviewed, the ownership boundary held (ALLOWED), the schema verdict is exactly one 0007 migration with 0001 through 0006 byte-unchanged (ALLOWED), the layer-boundary verdict, including the new contracts file, the new experience layer and the pure core package rule, is ALLOWED, and the destination gate passed on the destination branch.

## What was not done

No push happened. No pull request was opened. No merge into `main` happened. The Docker daemon was not started and no Docker result is claimed. The `desktop` workspace cargo gate was not run, not mocked and not reported as passed; it stays recorded as blocked host evidence for Phase 21.

The tracked-but-gitignored local artifact `.omp/reviewer-report.md` was backed up before the merge, reset so the merge could proceed, and the local copy was restored afterwards. It was never staged and never committed by this integration.
