# Phase 13 integration - background AI policies and provider adapters

## Outcome

Phase 13 (T-013) was merged into `codex/ai-native-journal` at `bf15f30590a29917c192378b470d474c503259a6`, and the destination gate passes.

The first gate run after the merge stopped at `pnpm exec prettier --check`: the candidate carried seven files that had never been formatted. Every command before it exited 0, and `pnpm build` and `pnpm test` did not run at all. The formatting was applied with `prettier --write` in commit `1df91a2`, which changes only prettier's own line wrapping and import collapsing — the whitespace-stripped content of every affected TypeScript file is byte-identical to the merged version — and the whole gate was then re-run alone on the host. The table below is that re-run.

- Destination branch: `codex/ai-native-journal`
- Destination-before SHA: `a46ccda8e2f8705ff59c9e55533a025c3b0c8451`
- Candidate base SHA: `135fd0ecd7d6252e17d0e406e907e6e76dbbed5f`
- Candidate tip SHA: `a0a14a2a0ed2d45f0bf14827badd0e69892b73a4`
- Merge SHA: `bf15f30590a29917c192378b470d474c503259a6` (`--no-ff`)
- Merge parents: `a46ccda8e2f8705ff59c9e55533a025c3b0c8451` and `a0a14a2a0ed2d45f0bf14827badd0e69892b73a4`

- a0a14a2 docs: record the Phase 13 test coverage repair
- 640226b fix: make the Phase 13 background policy tests fail when the behaviour breaks
- 0d31edf docs: record the Phase 13 background AI policy evidence
- 6012ab4 feat: execute scoped intelligence through compatible AI adapters
- d5fdfbe docs: plan the background AI policies and provider adapters

The phase report is `docs/superpowers/reports/ai-native-journal-phase-13.md` and the phase plan is `docs/superpowers/plans/ai-native-journal/phase-13.md`.

The candidate base was resolved at run time as `git merge-base codex/ai-native-journal-p13 codex/ai-native-journal`; no SHA is hardcoded in the integration script.

## Changed-file summary

.omp/reviewer-report.md | 157 +++--
apps/web/src/app/api/settings/route.ts | 20 +
apps/web/src/components/ai-settings.tsx | 428 ++++++++----
apps/web/src/db/bootstrap.ts | 3 +
apps/web/src/db/migration-checksums.json | 5 +
apps/web/src/db/migrations.ts | 2 +
.../src/db/migrations/0005-intelligence-runtime.ts | 76 +++
apps/web/src/db/schema.ts | 83 +++
apps/web/src/server/ai-contracts.ts | 10 +-
apps/web/src/server/ai-runtime.ts | 89 ++-
apps/web/src/server/intelligence/composition.ts | 278 +++++++-
.../src/server/intelligence/contracts/policy.ts | 243 +++++++
.../intelligence/infrastructure/policy-store.ts | 377 +++++++++++
.../server/intelligence/runtime/model-policy.ts | 159 +++++
apps/web/src/server/settings.ts | 20 +
.../web/tests/intelligence-provider-policy.test.ts | 732 +++++++++++++++++++++
.../plans/ai-native-journal/phase-13.md | 277 ++++++++
.../reports/ai-native-journal-phase-13.md | 268 ++++++++
18 files changed, 3068 insertions(+), 159 deletions(-)

18 candidate files, 18 files in the merge.

## Ownership verdict

ALLOWED. Every changed path is inside the Phase 13 ownership set:

- `apps/web/src/server/ai-runtime.ts`
- `apps/web/src/server/ai-contracts.ts`
- `apps/web/src/server/settings.ts`
- `apps/web/src/server/ai-import.ts`
- `apps/web/src/app/api/settings/route.ts`
- `apps/web/src/components/ai-settings.tsx`
- `docs/superpowers/plans/ai-native-journal/phase-13.md`
- `docs/superpowers/reports/ai-native-journal-phase-13.md`
- `apps/web/tests/intelligence-provider-policy.test.ts`
- `apps/web/src/server/intelligence/composition.ts`
- `apps/web/src/server/intelligence/contracts/policy.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/migrations.ts`
- `apps/web/src/db/migration-checksums.json`
- `apps/web/src/db/bootstrap.ts`
- `apps/web/src/server/intelligence/runtime/` (directory prefix)
- `apps/web/src/server/intelligence/infrastructure/policy-store.ts` (exact file)
- `apps/web/src/db/migrations/` (directory prefix)

- `.omp/reviewer-report.md` (tracked-but-gitignored local artifact)

No path outside that set changed, so the integration did not abort on an out-of-scope path.

## Schema verdict

SCHEMA VERDICT: ALLOWED.

- Phase 13 owns exactly one new migration: `apps/web/src/db/migrations/0005-intelligence-runtime.ts`
- Its source SHA-256 is `49e3ceafd7cf97e639fa6088f3dc4738a9f44cacf6f405cc16e11a8285a21a72`
- The registry entry that changed in `apps/web/src/db/migrations.ts`: import { intelligenceRuntime } from "./migrations/0005-intelligence-runtime.ts";
- Migrations `0001`, `0002`, `0003`, `0004` are byte-unchanged against the merge base `135fd0ecd7d6252e17d0e406e907e6e76dbbed5f`
- No migration was renumbered, added or deleted below `0005`
- The schema files Phase 13 owns are `apps/web/src/db/schema.ts`, `apps/web/src/db/migrations.ts`, `apps/web/src/db/bootstrap.ts` and the directory `apps/web/src/db/migrations/`

## Runtime / contracts boundary verdict

- Contracts layer (`apps/web/src/server/intelligence/contracts/`): imports no database module, no Next module, no AI SDK module and no workspace package.
- Runtime layer (`apps/web/src/server/intelligence/runtime/`): imports no database module directly. Persistence is reached through the infrastructure layer (`apps/web/src/server/intelligence/infrastructure/`), which is the intended place for a database import in Phase 13.
- The database-importing lines that were found, so a reviewer can see where persistence actually happens:

- `apps/web/src/server/intelligence/infrastructure/policy-store.ts:1` import { count, desc, eq, sql } from "drizzle-orm";
- `apps/web/src/server/intelligence/infrastructure/policy-store.ts:2` import type { JournalDb } from "@/db/connection";
- `apps/web/src/server/intelligence/infrastructure/policy-store.ts:3` import { withConnectionTransaction, type JournalTx } from "@/db/transaction";
- `apps/web/src/server/intelligence/infrastructure/policy-store.ts:8` } from "@/db/schema";

## Dependency and lockfile check

No `package.json` and no `pnpm-lock.yaml` changed. Phase 13 adds no dependency.

## Destination gate

One full gate run on the destination branch, alone on the host, sequentially. Every exit code is
the exit status of the command itself, never the status of a pipe.

| Command                                                                             | Exit | Result |
| ----------------------------------------------------------------------------------- | ---- | ------ |
| `pnpm install --frozen-lockfile`                                                    | 0    | passed |
| `pnpm --filter web typecheck`                                                       | 0    | passed |
| `pnpm --filter @luxalgo/journal-core --filter @luxalgo/journal-importers typecheck` | 0    | passed |
| `pnpm --filter web migrations:check`                                                | 0    | passed |
| `node scripts/check-licenses.mjs`                                                   | 0    | passed |
| `pnpm exec prettier --check <the 18 merged files>`                                  | 0    | passed |
| `pnpm build`                                                                        | 0    | passed |
| `pnpm test`                                                                         | 0    | passed |

`pnpm test` reported 106 test files and 1144 tests passed in 178.22s.

### Gate history

The first gate run after the merge stopped at `pnpm exec prettier --check`: seven candidate files
had never been formatted. Every command before it exited 0, and `pnpm build` and `pnpm test` did
not run at all. The formatting was applied with `prettier --write` in commit `1df91a2`. That change
was verified to be formatting only: with all whitespace stripped, the content of every affected
TypeScript file is identical to the merged version, and the only differences are prettier's own
line wrapping and import collapsing. The whole gate was then re-run alone on the host, and the table
above is that run.

The `desktop` workspace was deliberately not typechecked here. Root `pnpm typecheck` also runs
the `desktop` workspace, whose `cargo check` fails on a pre-existing repository defect: the
Tauri sidecar resource `binaries/node-x86_64-pc-windows-msvc.exe` is missing because
`desktop/scripts/run-sidecar-setup.js` uses CommonJS `require()` inside an ESM package. That
defect belongs to Phase 21 and is recorded as blocked host evidence. It was not mocked and it is
not reported as passed.

## What was not done

No push. No pull request. No merge into `main`. The Docker daemon was not started and no Docker
result is claimed. The `desktop` workspace cargo gate was not run, not mocked and not reported as
passed; it stays recorded as blocked host evidence for Phase 21.

## Review verdict

PASS. The candidate commits were reviewed, the ownership boundary held, the schema verdict is 0005-only
with 0001 through 0004 byte-unchanged, and the destination gate passes on the destination branch.

The independent implementation-diff review raised 4 findings against the first candidate: the two
cancellation cases could not fail for the reason they claimed, because their fetch stub aborted its
own controller; the reservation case checked the row only after the call returned and had no
concurrent-writer case; and the plan and the report claimed 0005-specific test coverage that did not
exist. The reviewer and the coordinator both confirmed the production code was correct:
`runBackgroundAi` forwards `AbortSignal.any([caller, timeout])` to `generateText`, and
`executeBackgroundRun` reserves inside its own transaction before the provider request.

The phase was reopened and repaired in `640226b`. The coordinator then proved the repaired tests have
teeth, independently of the worker's own claim, with three mutations of the production plumbing:

- dropping `abortSignal` from the background adapter's `generateText` call failed exactly the two
  cancellation cases and nothing else;
- never taking the daily reservation failed "calls the pinned endpoint once, after the reservation is
  committed";
- moving the daily reservation to after the provider call failed that same case, which is what proves
  the at-call-time assertion;

each mutation was followed by a restore that made the file pass again, and the candidate ended clean
with no production file differing from the tip. The repair itself changed no production file:
`git diff 6012ab4 -- apps/web/src/` is empty.

No push, no pull request and no merge into `main`.
