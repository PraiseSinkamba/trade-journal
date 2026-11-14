# Phase 15 integration - durable time and condition scheduling

## Outcome

Phase 15 was merged into `codex/ai-native-journal` at `fc1f61cecb122095a0a7585ed466f7ef3f62eea7` and the destination gate passed.

- Destination branch: `codex/ai-native-journal`
- Destination-before SHA: `be748d72bae489ad4ea166fc85a92790b55d90da`
- Candidate base SHA: `19975e03e76345ccf2b9e78e0641fdf20e614203`
- Candidate tip SHA: `fb166052687875c24fe5285697cd112d36127e15`
- Merge SHA: `fc1f61cecb122095a0a7585ed466f7ef3f62eea7` (`--no-ff`)
- Merge parents: `be748d72bae489ad4ea166fc85a92790b55d90da` and `fb166052687875c24fe5285697cd112d36127e15`
- The candidate base was resolved at run time as `git merge-base codex/ai-native-journal-p15 codex/ai-native-journal`; no SHA is hardcoded in the integration script.

## Candidate commits

```
fb16605 docs: record the Phase 15 stalled schedule repair
0257db1 fix: stop a stalled schedule from replaying or suppressing its occurrences
89c1059 docs: record the Phase 15 scheduler evidence
949acf8 feat: schedule bounded intelligence and propagate source revisions
bd6af62 docs: plan the durable time and condition scheduling
```

## Changed-file summary

```
.omp/reviewer-report.md                            |  77 +--
 apps/web/src/server/intelligence/composition.ts    |  17 +-
 apps/web/src/server/intelligence/contracts/jobs.ts |  15 +
 .../intelligence/infrastructure/scheduler.ts       | 555 +++++++++++++++++++
 .../server/intelligence/infrastructure/worker.ts   |   7 +-
 apps/web/tests/intelligence-scheduler.test.ts      | 606 +++++++++++++++++++++
 .../plans/ai-native-journal/phase-15.md            | 305 +++++++++++
 .../reports/ai-native-journal-phase-15.md          | 351 ++++++++++++
 packages/core/src/time.ts                          | 149 +++++
 9 files changed, 2028 insertions(+), 54 deletions(-)
```

9 candidate files, 9 files in the merge.

Merged files:

- `.omp/reviewer-report.md`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/contracts/jobs.ts`
- `apps/web/src/server/intelligence/infrastructure/scheduler.ts`
- `apps/web/src/server/intelligence/infrastructure/worker.ts`
- `apps/web/tests/intelligence-scheduler.test.ts`
- `docs/superpowers/plans/ai-native-journal/phase-15.md`
- `docs/superpowers/reports/ai-native-journal-phase-15.md`
- `packages/core/src/time.ts`

## Ownership verdict

```
.omp/reviewer-report.md: ALLOWED (local artifact)
apps/web/src/server/intelligence/composition.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/contracts/jobs.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/infrastructure/scheduler.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/infrastructure/worker.ts: ALLOWED (owned file)
apps/web/tests/intelligence-scheduler.test.ts: ALLOWED (owned file)
docs/superpowers/plans/ai-native-journal/phase-15.md: ALLOWED (owned file)
docs/superpowers/reports/ai-native-journal-phase-15.md: ALLOWED (owned file)
packages/core/src/time.ts: ALLOWED (owned file)
OWNERSHIP VERDICT: ALLOWED
```

The Phase 15 ownership set is the exact files `apps/web/src/server/intelligence/infrastructure/scheduler.ts`, `apps/web/src/server/intelligence/infrastructure/jobs.ts`, `apps/web/src/server/intelligence/infrastructure/outbox.ts`, `apps/web/src/server/intelligence/composition.ts`, `packages/core/src/time.ts`, `apps/web/tests/intelligence-scheduler.test.ts`, `docs/superpowers/plans/ai-native-journal/phase-15.md` and `docs/superpowers/reports/ai-native-journal-phase-15.md`; the local artifact `.omp/reviewer-report.md` (tracked but gitignored, never staged); and no directory prefixes at all. The extension points `PLAN_EXTENSION` and `COORDINATOR_EXTENSION` are empty, so widening the allow-list is a deliberate edit, never a silent side effect.

## Schema verdict

SCHEMA VERDICT: ALLOWED

- Phase 15 owns no migration. The `intelligence_schedules` table already exists in migration `0006`; this phase consumes it.
- No migration file was added, deleted or renamed: `git diff --name-status --find-renames 19975e03e76345ccf2b9e78e0641fdf20e614203..fb166052687875c24fe5285697cd112d36127e15 -- apps/web/src/db/migrations/` is empty.
- No path under `apps/web/src/db/` changed at all: `git diff --name-status --find-renames 19975e03e76345ccf2b9e78e0641fdf20e614203..fb166052687875c24fe5285697cd112d36127e15 -- apps/web/src/db/` is empty, so the schema, the migration registry and the checksum artifact are untouched.
- Migrations `0001` through `0006` are byte-unchanged against the merge base `19975e03e76345ccf2b9e78e0641fdf20e614203`: the git blob hash of every migration file is identical at the merge base and at the candidate tip.

| Migration | File | Git blob hash (base = tip) |
| --- | --- | --- |
| `0001` | `apps/web/src/db/migrations/0001-legacy-baseline.ts` | `5a2fd458699ecc523a237b9c13b33f35251c8453` |
| `0002` | `apps/web/src/db/migrations/0002-trade-projections.ts` | `ae720a2c5beff259a16c71891548dd7f8e82b46e` |
| `0003` | `apps/web/src/db/migrations/0003-durable-jobs.ts` | `030b6a8bf7688eaa4d8113665cba6cf526a8ef03` |
| `0004` | `apps/web/src/db/migrations/0004-observations.ts` | `103bb72ea3b71c6d0ef047eb57cd6e4df2292f9e` |
| `0005` | `apps/web/src/db/migrations/0005-intelligence-runtime.ts` | `353e55137c567af27e854fe9d2c6c4bb26c1ce4b` |
| `0006` | `apps/web/src/db/migrations/0006-knowledge-scheduling.ts` | `86bdbf2fe7facb7565c2b3d253042e22dd2d6185` |

## Layer-boundary verdict

LAYER BOUNDARY VERDICT: ALLOWED

- Contracts layer (`apps/web/src/server/intelligence/contracts/`): no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Knowledge layer (`apps/web/src/server/intelligence/knowledge/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Runtime layer (`apps/web/src/server/intelligence/runtime/`): no direct database import. Persistence is reached through the infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`), which is exempt.
- Pure core package (`packages/core/src/time.ts`): no import from `apps/web`, no import through the `@/` path alias and no import of any workspace package. `packages/core` has zero dependencies and never imports from `apps/web`; a violation there is a cross-boundary import and fails this check. A type-only import counts as a violation too.

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
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:1: import { and, asc, eq, gt, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:12: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
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
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
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
| `pnpm exec prettier --check <9 merged files>` | 0 | passed |
| `pnpm build` | 0 | passed |
| `pnpm test` | 0 | passed |

The prettier file list was computed after the merge, from the merge commit itself: `git diff --name-only be748d72bae489ad4ea166fc85a92790b55d90da..fc1f61cecb122095a0a7585ed466f7ef3f62eea7` in the feature worktree (9 files).

- `.omp/reviewer-report.md`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/contracts/jobs.ts`
- `apps/web/src/server/intelligence/infrastructure/scheduler.ts`
- `apps/web/src/server/intelligence/infrastructure/worker.ts`
- `apps/web/tests/intelligence-scheduler.test.ts`
- `docs/superpowers/plans/ai-native-journal/phase-15.md`
- `docs/superpowers/reports/ai-native-journal-phase-15.md`
- `packages/core/src/time.ts`

The `desktop` workspace was deliberately not typechecked: its `cargo check` fails on a pre-existing repository defect (the Tauri sidecar resource `binaries/node-x86_64-pc-windows-msvc.exe` is missing because `desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` inside an ESM package). That defect belongs to Phase 21 and is recorded as blocked host evidence. It was not mocked and it is not reported as passed.

## Review verdict

PASS. The candidate commits were reviewed, the ownership boundary held (ALLOWED), the schema verdict is no-migration with 0001 through 0006 byte-unchanged (ALLOWED), the layer-boundary verdict, including the pure core package rule, is ALLOWED, and the destination gate passed on the destination branch.

## What was not done

No push happened. No pull request was opened. No merge into `main` happened. The Docker daemon was not started and no Docker result is claimed. The `desktop` workspace cargo gate was not run, not mocked and not reported as passed; it stays recorded as blocked host evidence for Phase 21.

The tracked-but-gitignored local artifact `.omp/reviewer-report.md` was backed up before the merge, reset so the merge could proceed, and the local copy was restored afterwards. It was never staged and never committed by this integration.
