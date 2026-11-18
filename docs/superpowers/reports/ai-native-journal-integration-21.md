# Phase 21 integration - performance, packaging and release acceptance

## Outcome

Phase 21 was merged into `codex/ai-native-journal` at `c7c49ad3cd6a0a2307bb5dc78a7990694ee39bf8` and the destination gate passed.

- Destination branch: `codex/ai-native-journal`
- Destination-before SHA: `7b038dc13351af8bbc69e5843cc7b6b462be3d07`
- Candidate base SHA: `aab8505a5cf3fd084ef1fad627d9fdab39d103b1`
- Candidate tip SHA: `b469b32f0cdecadb09d3359a84d279ba085465e9`
- Merge SHA: `c7c49ad3cd6a0a2307bb5dc78a7990694ee39bf8` (`--no-ff`)
- Merge parents: `7b038dc13351af8bbc69e5843cc7b6b462be3d07` and `b469b32f0cdecadb09d3359a84d279ba085465e9`
- The candidate base was resolved at run time as `git merge-base codex/ai-native-journal-p21 codex/ai-native-journal`; no SHA is hardcoded in the integration script.

## Candidate commits

```
b469b32 docs: record the desktop scripts' icon generation in the phase report and the operations runbook
21ee53b fix: make the desktop scripts generate the bundle icons before cargo runs
78ee15d docs: name the gate repair commit in the phase report
25d5a27 fix: make the desktop typecheck generate the icons the Windows resource compiler needs
```

## Changed-file summary

```
.github/workflows/ci.yml                           |   5 +-
 .github/workflows/release.yml                      |   5 +-
 .omp/reviewer-report.md                            | 464 ++++++---------------
 desktop/README.md                                  |  52 ++-
 desktop/package.json                               |   6 +-
 desktop/scripts/run-sidecar-setup.js               |   2 +-
 desktop/src-tauri/tauri.conf.json                  |   8 +-
 docs/intelligence-operations.md                    |  46 +-
 .../plans/ai-native-journal/phase-21.md            |  12 +-
 .../reports/ai-native-journal-phase-21.md          | 203 +++++++--
 10 files changed, 390 insertions(+), 413 deletions(-)
```

10 candidate files, 10 files in the merge.

Merged files:

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.omp/reviewer-report.md`
- `desktop/README.md`
- `desktop/package.json`
- `desktop/scripts/run-sidecar-setup.js`
- `desktop/src-tauri/tauri.conf.json`
- `docs/intelligence-operations.md`
- `docs/superpowers/plans/ai-native-journal/phase-21.md`
- `docs/superpowers/reports/ai-native-journal-phase-21.md`

## Ownership verdict

```
.github/workflows/ci.yml: ALLOWED (owned file)
.github/workflows/release.yml: ALLOWED (owned file)
.omp/reviewer-report.md: ALLOWED (local artifact)
desktop/README.md: ALLOWED (owned file)
desktop/package.json: ALLOWED (owned file)
desktop/scripts/run-sidecar-setup.js: ALLOWED (owned file)
desktop/src-tauri/tauri.conf.json: ALLOWED (owned file)
docs/intelligence-operations.md: ALLOWED (owned file)
docs/superpowers/plans/ai-native-journal/phase-21.md: ALLOWED (owned file)
docs/superpowers/reports/ai-native-journal-phase-21.md: ALLOWED (owned file)
OWNERSHIP VERDICT: ALLOWED
```

The Phase 21 ownership set is the exact files `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `Dockerfile`, `scripts/benchmark-intelligence.mjs`, `scripts/verify-features.py`, `desktop/README.md`, `desktop/package.json`, `desktop/scripts/run-sidecar-setup.js`, `desktop/src-tauri/src/server.rs`, `desktop/src-tauri/src/lib.rs`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/scripts/gen_icons/src/main.rs`, `apps/web/scripts/run-journal.mjs`, `apps/web/scripts/http-child.mjs`, `docs/intelligence-operations.md`, `apps/web/tests/intelligence-packaging.test.ts`, `docs/superpowers/plans/ai-native-journal/phase-21.md` and `docs/superpowers/reports/ai-native-journal-phase-21.md`; and the local artifact `.omp/reviewer-report.md` (tracked but gitignored, never staged). The set is much wider than the earlier phases because Phase 21 owns the release surface: the CI and release workflows, the container image, the desktop workspace that eleven phases left as blocked host evidence, the benchmark and the packaging acceptance test. There are NO directory prefixes in this phase's set: `OWNED_DIRS` is empty, so a sibling file in any owned directory aborts the merge. No owned path reaches `apps/web/src/db/`, so this phase still owns no schema path and no migration. The extension points `PLAN_EXTENSION` and `COORDINATOR_EXTENSION` are empty, so widening the allow-list is a deliberate edit, never a silent side effect.

## Schema verdict

SCHEMA VERDICT: ALLOWED
SCHEMA VERDICT: ALLOWED — this phase owns no migration and no schema change, and migrations 0001 through 0007 are byte-unchanged.

- Schema allocation: None. This phase owns NO migration and NO schema change. The migration diff against the merge base `aab8505a5cf3fd084ef1fad627d9fdab39d103b1` is empty: `git diff --name-status --find-renames aab8505a5cf3fd084ef1fad627d9fdab39d103b1..b469b32f0cdecadb09d3359a84d279ba085465e9 -- apps/web/src/db/migrations/` returned no path, so no migration file was added, deleted or renamed.
- No path under `apps/web/src/db/` changed at all: the schema, the migration registry `apps/web/src/db/migrations.ts` and the checksum artifact `apps/web/src/db/migration-checksums.json` are untouched. The diff `git diff --name-status --find-renames aab8505a5cf3fd084ef1fad627d9fdab39d103b1..b469b32f0cdecadb09d3359a84d279ba085465e9 -- apps/web/src/db/` returned no path.
- Migrations `0001 through 0007` are byte-unchanged against the merge base `aab8505a5cf3fd084ef1fad627d9fdab39d103b1`: the git blob hash of every migration file is identical at the merge base and at the candidate tip.

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

- Scope: the boundary rules apply to the TypeScript tree ONLY. The scanned files are the `.ts` and `.tsx` files under `apps/web/src/server/`, `apps/web/tests/`, `apps/web/src/components/`, `apps/web/src/lib/`, `apps/web/src/app/settings/` and `packages/core/src/time.ts`. Phase 21 adds Rust (`.rs`), YAML workflows, a Dockerfile, Python (`.py`) and `.mjs` scripts; the purity rules were written for TypeScript and are NOT applied to those files, so a Rust import, a YAML key or a Python import can never be reported as a layer boundary violation.
- Contracts layer (`apps/web/src/server/intelligence/contracts/`): no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Contracts layer files: every file in the contracts directory (`apps/web/src/server/intelligence/contracts/`) obeys the same purity rule as the other contracts - no runtime import of a database module, a Next module, an AI SDK module or a workspace package. A type-only database import is reported, not counted. Phase 21 owns no contracts file; the rule is kept from Phase 18.
- Knowledge layer (`apps/web/src/server/intelligence/knowledge/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package.
- Experience layer (`apps/web/src/server/intelligence/experience/`): the same purity rule holds - no runtime import of a database module, a Next module, an AI SDK module or a workspace package. A type-only database import is reported, not counted.
- Experience layer database rule: the experience domain layer must have NO runtime import of a database module. The database module opens the journal at import time, so a runtime import turns importing the domain layer into a database side effect and binds the domain layer to the database layer. Only a type-only database import is allowed. A type-only database reference is reported and not counted; a runtime database import is counted and fails this check.
- Runtime layer (`apps/web/src/server/intelligence/runtime/`): no direct runtime database import. Persistence is reached through the infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`), which is exempt. A type-only database reference creates no runtime dependency, so it is reported, not counted.
- Pure core package (`packages/core/src/time.ts`): no import from `apps/web`, no import through the `@/` path alias and no import of any workspace package. `packages/core` has zero dependencies and never imports from `apps/web`; a violation there is a cross-boundary import and fails this check. A type-only import counts as a violation too.
- Browser layers (`apps/web/src/components/`, `apps/web/src/lib/`, `apps/web/src/app/settings/`): these directories are BROWSER code. They must import NO runtime database module, NO Next server module (`next/server`, `next/headers`, `next/cache`, `server-only`) and NO Node-only module the browser bundle cannot resolve. A type-only database reference is reported as `file:line: text`, not counted; a runtime import is counted and fails this check. The shared client-side interaction module (`apps/web/src/lib/intelligence-interactions.ts`) lives under `apps/web/src/lib/`, so the same rule covers it; it is not counted twice.
- Server code (`apps/web/src/server/`): server code is EXPECTED to import the database. The infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`) is exempt from the no-runtime-database rule, exactly as in the earlier phases; the runtime layer still reaches persistence through infrastructure.

Contracts layer imports (apps/web/src/server/intelligence/contracts/):

```
  apps/web/src/server/intelligence/contracts/experience.ts:7: } from "@/db/schema";
  apps/web/src/server/intelligence/contracts/experience.ts:8: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
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
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:1: import { and, asc, eq, gt, inArray } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:11: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:12: import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:1: import { and, count, eq, gte, inArray, like, max } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:9: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:10: import type { JournalTx } from "@/db/transaction";
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
  apps/web/src/server/intelligence/infrastructure/retention.ts:22: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/retention.ts:23: import { dataDir, db, openConnection } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/retention.ts:24: import { checkJournalFile, copyJournalFile, readJournalFileFacts } from "@/db/journal-file";
  apps/web/src/server/intelligence/infrastructure/retention.ts:29: } from "@/db/transaction";
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
  apps/web/tests/intelligence-backup.test.ts:47: } = await import("../src/db");
  apps/web/tests/intelligence-backup.test.ts:48: const { openConnection } = await import("../src/db/connection");
  apps/web/tests/intelligence-engagement.test.ts:5: import { eq, like } from "drizzle-orm";
  apps/web/tests/intelligence-engagement.test.ts:6: import type { JournalTx } from "../src/db/transaction";
  apps/web/tests/intelligence-engagement.test.ts:31: await import("../src/db");
  apps/web/tests/intelligence-engagement.test.ts:32: const { withJournalTransaction } = await import("../src/db/transaction");
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
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:1: import { and, count, eq, gte, inArray, like, max } from "drizzle-orm";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:9: } from "@/db/schema";
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
  apps/web/src/server/intelligence/infrastructure/retention.ts:22: } from "@/db/schema";
  apps/web/src/server/intelligence/infrastructure/retention.ts:23: import { dataDir, db, openConnection } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/retention.ts:24: import { checkJournalFile, copyJournalFile, readJournalFileFacts } from "@/db/journal-file";
  apps/web/src/server/intelligence/infrastructure/retention.ts:29: } from "@/db/transaction";
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
  apps/web/tests/intelligence-backup.test.ts:47: } = await import("../src/db");
  apps/web/tests/intelligence-backup.test.ts:48: const { openConnection } = await import("../src/db/connection");
  apps/web/tests/intelligence-engagement.test.ts:5: import { eq, like } from "drizzle-orm";
  apps/web/tests/intelligence-engagement.test.ts:31: await import("../src/db");
  apps/web/tests/intelligence-engagement.test.ts:32: const { withJournalTransaction } = await import("../src/db/transaction");
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
  apps/web/src/server/intelligence/contracts/jobs.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/experience/workflows.ts:2: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/backfill.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/experience-store.ts:10: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/jobs.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/knowledge-revisions.ts:3: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:12: import type { JournalTx } from "@/db/transaction";
  apps/web/src/server/intelligence/infrastructure/outbox.ts:1: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/policy-store.ts:2: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/scheduler.ts:3: import type { JournalDb } from "@/db/connection";
  apps/web/src/server/intelligence/infrastructure/worker.ts:3: import type { JournalDb } from "@/db/connection";
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

One full gate run on the destination branch, alone on the host, sequentially. Every exit code is the exit status of the command itself, never the status of a pipe. The gate stops at the first non-zero command.

The desktop workspace is IN SCOPE for this gate. The ROOT `pnpm typecheck` covers it (`pnpm -r --parallel typecheck` runs the desktop workspace `typecheck` script, which is `cargo check` in `desktop/src-tauri`), so a desktop workspace that does not typecheck FAILS this gate. The earlier phases excluded the desktop workspace and recorded it as blocked host evidence; this phase owns the two defects that kept it blocked (`desktop/scripts/run-sidecar-setup.js` used CommonJS `require()` inside a package whose `package.json` says `"type": "module"`, and `desktop/src-tauri/scripts/gen_icons/src/main.rs` emitted an invalid ICO), so the desktop workspace is checked for real.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | passed |
| `pnpm typecheck (root; covers the desktop workspace)` | 0 | passed |
| `pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck` | 0 | passed |
| `pnpm --filter web migrations:check` | 0 | passed |
| `node scripts/check-licenses.mjs` | 0 | passed |
| `pnpm exec prettier --check <8 prettier-governed merged files>` | 0 | passed |
| `pnpm build` | 0 | passed |
| `pnpm test` | 0 | passed |
| `cargo check (desktop/src-tauri)` | 0 | passed |
| `cargo test (desktop/src-tauri)` | 0 | passed |

The prettier file list was computed after the merge, from the merge commit itself: `git diff --name-only 7b038dc13351af8bbc69e5843cc7b6b462be3d07..c7c49ad3cd6a0a2307bb5dc78a7990694ee39bf8` in the feature worktree, with deleted paths excluded because prettier cannot check them (10 merged files).

Only the files prettier actually governs are passed to prettier (8 of 10). A Rust file, a Python file and a Dockerfile are not prettier targets at all, and the YAML workflows are outside the Phase 21 prettier scope. Each governed file was probed once with `pnpm exec prettier --check <file>` before the gate command, so the result below is per file:

```
  .omp/reviewer-report.md: prettier exit code 0 (formatted)
  desktop/README.md: prettier exit code 0 (formatted)
  desktop/package.json: prettier exit code 0 (formatted)
  desktop/scripts/run-sidecar-setup.js: prettier exit code 0 (formatted)
  desktop/src-tauri/tauri.conf.json: prettier exit code 0 (formatted)
  docs/intelligence-operations.md: prettier exit code 0 (formatted)
  docs/superpowers/plans/ai-native-journal/phase-21.md: prettier exit code 0 (formatted)
  docs/superpowers/reports/ai-native-journal-phase-21.md: prettier exit code 0 (formatted)
```

Files excluded from the prettier scope:

```
  .github/workflows/ci.yml: a YAML workflow: excluded from the Phase 21 prettier scope by the gate rule
  .github/workflows/release.yml: a YAML workflow: excluded from the Phase 21 prettier scope by the gate rule
```

- prettier-governed: `.omp/reviewer-report.md`
- prettier-governed: `desktop/README.md`
- prettier-governed: `desktop/package.json`
- prettier-governed: `desktop/scripts/run-sidecar-setup.js`
- prettier-governed: `desktop/src-tauri/tauri.conf.json`
- prettier-governed: `docs/intelligence-operations.md`
- prettier-governed: `docs/superpowers/plans/ai-native-journal/phase-21.md`
- prettier-governed: `docs/superpowers/reports/ai-native-journal-phase-21.md`

## Observed results and blocked host evidence

The observed results and the blocked items are kept apart. A blocked item is never reported as passed and never mocked.

### Observed

- `pnpm install --frozen-lockfile` exited 0: passed.
- `pnpm typecheck (root; covers the desktop workspace)` exited 0: passed.
- `pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck` exited 0: passed.
- `pnpm --filter web migrations:check` exited 0: passed.
- `node scripts/check-licenses.mjs` exited 0: passed.
- `pnpm exec prettier --check <8 prettier-governed merged files>` exited 0: passed.
- `pnpm build` exited 0: passed.
- `pnpm test` exited 0: passed.
- `cargo check (desktop/src-tauri)` exited 0: passed.
- `cargo test (desktop/src-tauri)` exited 0: passed.

### Blocked host evidence

- None. Every gate command either ran and is reported with its exit code above, or did not run because the gate stopped at an earlier command (which the table states).

Host provisioning note: the Tauri sidecar binary is gitignored, so the merge cannot carry it and `cargo check` needs it on disk. Before the gate steps ran, `pnpm --filter desktop setup:sidecar` was run once with the merged code (the script Phase 21 repaired). This is host provisioning, not a gate step and not a gate result; its outcome is recorded above.

## Review verdict

PASS. The candidate commits were reviewed, the ownership boundary held (ALLOWED), the schema verdict is no migration owned with 0001 through 0007 byte-unchanged (ALLOWED), the layer-boundary verdict, scoped to the TypeScript tree and covering the contracts layer, the knowledge layer, the experience layer with its no-runtime-database-import rule, the runtime no-direct-database rule, the pure core package rule and the browser-layer rule (apps/web/src/components/, apps/web/src/lib/, apps/web/src/app/settings/), is ALLOWED, and the destination gate passed on the destination branch, desktop workspace included.

## What was not done

No push happened. No pull request was opened. No merge into `main` happened. In short: no push, no PR and no `main` merge happened during this integration. The Docker daemon was not started by this script and no Docker result is claimed; the Docker smoke result belongs to the phase report, not to this integration.

The tracked-but-gitignored local artifact `.omp/reviewer-report.md` was backed up before the merge, reset so the merge could proceed, and the local copy was restored afterwards. It was never staged and never committed by this integration.
