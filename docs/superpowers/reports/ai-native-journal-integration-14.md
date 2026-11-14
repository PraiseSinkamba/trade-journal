# Phase 14 integration - knowledge source revisions and invalidation

## Outcome

Phase 14 was merged into `codex/ai-native-journal` at `4fa0cb0b1903fd41aeaa9efa7a1bfd82c47f460c` and the destination gate passed.

- Destination branch: `codex/ai-native-journal`
- Destination-before SHA: `ffcc1383a8753f7ba7cb1125d7a4c248c63ed24d`
- Candidate base SHA: `934953ca9801b025a34cd1386fd536120922fb6e`
- Candidate tip SHA: `178ef0accfb6c05bbaf5dfdd3a55e2fc206ce3fe`
- Merge SHA: `4fa0cb0b1903fd41aeaa9efa7a1bfd82c47f460c` (`--no-ff`)
- Merge parents: `ffcc1383a8753f7ba7cb1125d7a4c248c63ed24d` and `178ef0accfb6c05bbaf5dfdd3a55e2fc206ce3fe`
- The candidate base was resolved at run time as `git merge-base codex/ai-native-journal-p14 codex/ai-native-journal`; no SHA is hardcoded in the integration script.

## Candidate commits

```
178ef0a docs: record the Phase 14 journal write and atomicity repair
5ec0f8e fix: keep the journal note write and the source revision independent
5346abc docs: record the Phase 14 knowledge source revision evidence
1281bdb feat: schedule bounded intelligence and propagate source revisions
4ab6776 docs: plan the knowledge source revisions and invalidation
```

## Changed-file summary

```
.omp/reviewer-report.md                            | 166 ++--
 apps/web/src/app/api/folders/[id]/route.ts         |  27 +-
 apps/web/src/app/api/journal/[date]/route.ts       |  33 +-
 apps/web/src/app/api/notes/[id]/route.ts           |  50 +-
 apps/web/src/app/api/notes/route.ts                |  42 +-
 apps/web/src/app/api/playbooks/[id]/route.ts       |  60 +-
 apps/web/src/app/api/playbooks/route.ts            |  36 +-
 apps/web/src/app/api/trades/[key]/route.ts         |  34 +-
 apps/web/src/app/api/trades/[key]/rules/route.ts   |  31 +-
 apps/web/src/app/api/trades/bulk/route.ts          |  81 +-
 apps/web/src/db/bootstrap.ts                       |   3 +
 apps/web/src/db/migration-checksums.json           |   5 +
 apps/web/src/db/migrations.ts                      |   2 +
 .../src/db/migrations/0006-knowledge-scheduling.ts | 123 +++
 apps/web/src/db/schema.ts                          | 178 ++++
 apps/web/src/server/domain-events.ts               | 101 +++
 apps/web/src/server/intelligence/composition.ts    |  62 +-
 .../src/server/intelligence/contracts/knowledge.ts | 268 ++++++
 .../infrastructure/knowledge-revisions.ts          | 411 +++++++++
 .../tests/intelligence-knowledge-revisions.test.ts | 977 +++++++++++++++++++++
 .../plans/ai-native-journal/phase-14.md            | 417 +++++++++
 .../reports/ai-native-journal-phase-14.md          | 332 +++++++
 22 files changed, 3231 insertions(+), 208 deletions(-)
```

22 candidate files, 22 files in the merge.

Merged files:

- `.omp/reviewer-report.md`
- `apps/web/src/app/api/folders/[id]/route.ts`
- `apps/web/src/app/api/journal/[date]/route.ts`
- `apps/web/src/app/api/notes/[id]/route.ts`
- `apps/web/src/app/api/notes/route.ts`
- `apps/web/src/app/api/playbooks/[id]/route.ts`
- `apps/web/src/app/api/playbooks/route.ts`
- `apps/web/src/app/api/trades/[key]/route.ts`
- `apps/web/src/app/api/trades/[key]/rules/route.ts`
- `apps/web/src/app/api/trades/bulk/route.ts`
- `apps/web/src/db/bootstrap.ts`
- `apps/web/src/db/migration-checksums.json`
- `apps/web/src/db/migrations.ts`
- `apps/web/src/db/migrations/0006-knowledge-scheduling.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/server/domain-events.ts`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/contracts/knowledge.ts`
- `apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts`
- `apps/web/tests/intelligence-knowledge-revisions.test.ts`
- `docs/superpowers/plans/ai-native-journal/phase-14.md`
- `docs/superpowers/reports/ai-native-journal-phase-14.md`

## Ownership verdict

```
.omp/reviewer-report.md: ALLOWED (local artifact)
apps/web/src/app/api/folders/[id]/route.ts: ALLOWED (owned directory)
apps/web/src/app/api/journal/[date]/route.ts: ALLOWED (owned directory)
apps/web/src/app/api/notes/[id]/route.ts: ALLOWED (owned directory)
apps/web/src/app/api/notes/route.ts: ALLOWED (owned directory)
apps/web/src/app/api/playbooks/[id]/route.ts: ALLOWED (owned directory)
apps/web/src/app/api/playbooks/route.ts: ALLOWED (owned directory)
apps/web/src/app/api/trades/[key]/route.ts: ALLOWED (owned directory)
apps/web/src/app/api/trades/[key]/rules/route.ts: ALLOWED (owned directory)
apps/web/src/app/api/trades/bulk/route.ts: ALLOWED (owned directory)
apps/web/src/db/bootstrap.ts: ALLOWED (owned file)
apps/web/src/db/migration-checksums.json: ALLOWED (owned file)
apps/web/src/db/migrations.ts: ALLOWED (owned file)
apps/web/src/db/migrations/0006-knowledge-scheduling.ts: ALLOWED (owned directory)
apps/web/src/db/schema.ts: ALLOWED (owned file)
apps/web/src/server/domain-events.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/composition.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/contracts/knowledge.ts: ALLOWED (owned file)
apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts: ALLOWED (owned file)
apps/web/tests/intelligence-knowledge-revisions.test.ts: ALLOWED (owned file)
docs/superpowers/plans/ai-native-journal/phase-14.md: ALLOWED (owned file)
docs/superpowers/reports/ai-native-journal-phase-14.md: ALLOWED (owned file)
OWNERSHIP VERDICT: ALLOWED
```

The Phase 14 ownership set is the exact files `apps/web/src/server/domain-events.ts`, `apps/web/src/server/intelligence/composition.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/db/migrations.ts`, `apps/web/src/db/bootstrap.ts`, `apps/web/src/db/migration-checksums.json`, `apps/web/tests/intelligence-knowledge-revisions.test.ts`, `docs/superpowers/plans/ai-native-journal/phase-14.md` and `docs/superpowers/reports/ai-native-journal-phase-14.md`; the directory prefixes `apps/web/src/app/api/journal/`, `apps/web/src/app/api/playbooks/`, `apps/web/src/app/api/notes/`, `apps/web/src/app/api/folders/`, `apps/web/src/app/api/trades/[key]/`, `apps/web/src/app/api/trades/bulk/`, `apps/web/src/server/intelligence/knowledge/` and `apps/web/src/db/migrations/`; and the local artifact `.omp/reviewer-report.md` (tracked but gitignored, never staged).

## Schema verdict

SCHEMA VERDICT: ALLOWED

- Phase 14 owns exactly one new migration: `apps/web/src/db/migrations/0006-knowledge-scheduling.ts`
- Its source SHA-256 is `3ed72f4081e20110c55bbec878914e04cc9515f7b6b2a6466caff94b5529ef28`
- The changed registry line in `apps/web/src/db/migrations.ts`: `import { knowledgeScheduling } from "./migrations/0006-knowledge-scheduling.ts";`
- Migrations `0001` through `0005` are byte-unchanged against the merge base `934953ca9801b025a34cd1386fd536120922fb6e` (`git diff 934953ca9801b025a34cd1386fd536120922fb6e..178ef0accfb6c05bbaf5dfdd3a55e2fc206ce3fe -- apps/web/src/db/migrations/0001-*.ts apps/web/src/db/migrations/0002-*.ts apps/web/src/db/migrations/0003-*.ts apps/web/src/db/migrations/0004-*.ts apps/web/src/db/migrations/0005-*.ts` is empty)
- No migration below `0006` was added, deleted or renamed: every `0001-` to `0005-` path in `git diff --name-status --find-renames` has a status other than `M`, or is absent from the diff entirely.

## Layer-boundary verdict

LAYER BOUNDARY VERDICT: ALLOWED

- Contracts layer (`apps/web/src/server/intelligence/contracts/`): no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Knowledge layer (`apps/web/src/server/intelligence/knowledge/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Runtime layer (`apps/web/src/server/intelligence/runtime/`): no direct database import. Persistence is reached through the infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`), which is exempt.

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
| `pnpm exec prettier --check <22 merged files>` | 0 | passed |
| `pnpm build` | 0 | passed |
| `pnpm test` | 0 | passed |

The prettier file list was computed after the merge, from the merge commit itself: `git diff --name-only ffcc1383a8753f7ba7cb1125d7a4c248c63ed24d..4fa0cb0b1903fd41aeaa9efa7a1bfd82c47f460c` in the feature worktree (22 files).

- `.omp/reviewer-report.md`
- `apps/web/src/app/api/folders/[id]/route.ts`
- `apps/web/src/app/api/journal/[date]/route.ts`
- `apps/web/src/app/api/notes/[id]/route.ts`
- `apps/web/src/app/api/notes/route.ts`
- `apps/web/src/app/api/playbooks/[id]/route.ts`
- `apps/web/src/app/api/playbooks/route.ts`
- `apps/web/src/app/api/trades/[key]/route.ts`
- `apps/web/src/app/api/trades/[key]/rules/route.ts`
- `apps/web/src/app/api/trades/bulk/route.ts`
- `apps/web/src/db/bootstrap.ts`
- `apps/web/src/db/migration-checksums.json`
- `apps/web/src/db/migrations.ts`
- `apps/web/src/db/migrations/0006-knowledge-scheduling.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/server/domain-events.ts`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/contracts/knowledge.ts`
- `apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts`
- `apps/web/tests/intelligence-knowledge-revisions.test.ts`
- `docs/superpowers/plans/ai-native-journal/phase-14.md`
- `docs/superpowers/reports/ai-native-journal-phase-14.md`

The `desktop` workspace was deliberately not typechecked: its `cargo check` fails on a pre-existing repository defect (the Tauri sidecar resource `binaries/node-x86_64-pc-windows-msvc.exe` is missing because `desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` inside an ESM package). That defect belongs to Phase 21 and is recorded as blocked host evidence. It was not mocked and it is not reported as passed.

## Review verdict

PASS. The candidate commits were reviewed, the ownership boundary held (ALLOWED), the schema verdict is 0006-only with 0001 through 0005 byte-unchanged (ALLOWED), the layer-boundary verdict is ALLOWED, and the destination gate passed on the destination branch.

## What was not done

No push. No pull request. No merge into `main`. The Docker daemon was not started and no Docker result is claimed. The `desktop` workspace cargo gate was not run, not mocked and not reported as passed; it stays recorded as blocked host evidence for Phase 21.

The tracked-but-gitignored local artifact `.omp/reviewer-report.md` was backed up before the merge, reset so the merge could proceed, and the local copy was restored afterwards. It was never staged and never committed by this integration.
