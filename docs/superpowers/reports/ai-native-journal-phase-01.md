# AI-native journal — Phase 01 report

**Phase:** 01 — Safe connection/transaction seams; separate request errors from Next
**Task:** T-001 (package ID) · native task `task_2acef5be58ee` · dispatch `ctx_c398a01cfc05`
**Branch:** `codex/ai-native-journal-p01`
**Base SHA (verified feature bootstrap):** `0a278503fd67c0f9e82138dfecb744f4bfd307ad`
**Plan commit:** `e3b4df3e1c42ff56de2065817e503486022d5573`
**Tip SHA (implementation):** `477b1020ecc86af01310c85e0d257934d67e1908` — the formatting-fix commit; this report's own correction is committed on top of it.
**Integration destination (coordinator-owned, not merged here):** `codex/ai-native-journal`

---

## 1. Phase ID, baseline, scope completed and remaining

Phase 01 implements detailed-plan **Task 1 only**, as required by the phase guide row 01
("Safe connection/transaction seams; separate request errors from Next" · schema change **None**).

**Completed in this phase**

- Two explicit journal seams, both reachable from the public `@/db` path:
  `openConnection(directory)` and the synchronous-only `withJournalTransaction(fn)`.
- The app journal singleton moved to `db/connection.ts`, with the **manual WAL/SHM unlink
  removed** — the ADR 0007 forbidden behaviour ("deleting live WAL sidecars").
- The app singleton's cached directory moved onto `globalThis`, so a module re-evaluation resets
  the singleton only when the data directory actually changed. This also removes the
  `join(currentDataDir!, …)` `TypeError` the old module-scoped tracking produced on
  re-evaluation.
- `RequestError` and `requireValue` extracted to `server/request-error.ts` and re-exported
  unchanged from `server/api.ts`; the ten server modules that imported them from `"./api"` now
  import from `"./request-error"`.
- Two new test files: a connection-lifecycle/transaction suite and an import-graph boundary
  guard.

**Not done in this phase (out of scope by design)**

- No migration runner, no migration ledger, no checksum manifest — Phase 02.
- No `server/intelligence/**` tree — it is created in a later phase. The boundary guard for it is
  installed but visibly dormant (see §5).
- No worker, no outbox/jobs, no AI runtime changes, no UI work.
- The phase→feature merge and `docs/superpowers/reports/ai-native-journal-integration-01.md`
  belong to the coordinator, not this phase.

---

## 2. Changed files, exported interfaces, and compatibility preserved

### New files

| File                                             | Exports                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `apps/web/src/db/connection.ts`                  | `dataDir()`, `JournalDb`, `openConnection(directory)`, the app singleton `db` |
| `apps/web/src/db/transaction.ts`                 | `JournalTx`, `withJournalTransaction(fn)`                                     |
| `apps/web/src/server/request-error.ts`           | `RequestError`, `requireValue`                                                |
| `apps/web/tests/db-connection-lifecycle.test.ts` | 7 cases (see §4)                                                              |
| `apps/web/tests/intelligence-boundaries.test.ts` | 8 cases across 5 rules (see §4)                                               |

### Modified files

| File                                                                                                                                                    | Change                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/db/index.ts`                                                                                                                              | Now a barrel re-exporting `./connection`, `./transaction`, `./schema`. The old singleton and `cleanWalFiles` are gone.           |
| `apps/web/src/server/api.ts`                                                                                                                            | Imports and re-exports the same `RequestError`/`requireValue` bindings from `./request-error`. `ok`, `bad`, `handler` unchanged. |
| `apps/web/src/server/{ai-import,ai-scope,executions,ibkr-flex-xml-import,ibkr-sync-timezone,ninjatrader-import,prop-csv,prop-firms,sync,xtb-import}.ts` | Import line only: `"./api"` → `"./request-error"`.                                                                               |

Full diff: 18 files, +1204 / −82 lines (`git diff --stat 0a27850 4b361d3`).

### Exported interfaces (authoritative signatures)

```ts
// apps/web/src/db/connection.ts
export type JournalDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
export const openConnection = (directory: string): JournalDb;

// apps/web/src/db/transaction.ts
export type JournalTx = Parameters<Parameters<JournalDb["transaction"]>[0]>[0];
export function withJournalTransaction<T>(
  fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T,
): T;

// apps/web/src/server/request-error.ts
export class RequestError extends Error {}
export function requireValue(condition: unknown, message: string): asserts condition;

// apps/web/src/server/api.ts
export { RequestError, requireValue };
```

All four are re-exported from `@/db` / `@/server/api` respectively. The barrel still exports
`db`, `dataDir`, `JournalDb` and every schema table that `@/db` consumers used before.

### Compatibility preserved

- **`RequestError` identity.** `api.ts` re-exports the _same_ class object, so
  `error instanceof RequestError` is true on both import paths. Verified at runtime:
  `RequestError === RE2` and `requireValue === rv2` both `true`.
- **Route responses unchanged.** `handler` still maps `RequestError` → HTTP 400 and every other
  exception → HTTP 500. `requireValue` still throws `RequestError`. The 43 route files under
  `apps/web/src/app/api/**` are untouched and still import from `@/server/api`.
- **Journal behaviour unchanged.** `openConnection` reuses the existing `openJournalDatabase`
  bootstrap, so WAL mode, `foreign_keys = ON`, `busy_timeout = 5000` and the idempotent schema
  setup are identical. `withJournalTransaction` uses `behavior: "immediate"`, matching the
  existing write path.
- **No financial, provider or credential change.** Execution hashes, derived trade keys,
  annotations, cTrader sync, encrypted credentials and the Anthropic / OpenAI /
  OpenAI-compatible provider categories are untouched. No file under `packages/**` changed.
- **No schema or dependency change.** `apps/web/src/db/schema.ts` and
  `apps/web/src/db/bootstrap.ts` are untouched; no migration was added; no manifest and no
  `pnpm-lock.yaml` entry changed.

---

## 3. Migration, upgrade results, backup and rollback impact

**Migrations: none.** Phase 01 allocates no schema change (phase guide row 01, schema change
"None"), so there is no migration version, table, column or index to report, and no applied
migration was edited.

**Upgrade results:** not applicable — the schema is unchanged, and the idempotent bootstrap
still converges every existing journal.

**Backup and rollback impact:** none. The phase changes no on-disk format, no financial bytes,
no credentials and no annotations. Rolling back the phase commit restores the previous
`db/index.ts` singleton (including its old WAL/SHM cleanup) and the previous import graph; the
data directory is unaffected either way.

**One behavioural note worth recording:** the old singleton deleted the `-wal`/`-shm` sidecars of
the directory it was leaving. That deletion could destroy the WAL of a _different_ live
connection to the same journal (a worker or a second process). Removing it is the point of this
phase, and ADR 0007 lists "deleting live WAL sidecars" as forbidden. Rollback therefore
reintroduces a known data-safety hazard and should not be done for convenience.

---

## 4. Commands actually run, results, and environment-limited checks

All commands were run in `E:/4004/orca/workspaces/trade-journal/codex-ai-native-journal-p01` with
Node v24.20.0 and pnpm 11.0.8, against the commits named in the header.

### Test-first evidence (the single pre-implementation red run)

| Command                                                                                                              | Exit  | Result                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/db-connection-lifecycle.test.ts apps/web/tests/intelligence-boundaries.test.ts` | **1** | `1 failed \| 12 passed \| 1 skipped (14)`. Both files were written before any production edit. The failure is rule 2 of the boundary guard: 16 server modules reach `next/server`/`next/headers` through `server/api.ts`. The rule-5 detector self-test passed; the rule-5 application block reported as skipped. |

### Final targeted gate (required command)

| Command                                                                                                                                                                                       | Exit  | Result                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/db-connection-lifecycle.test.ts apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/execution-storage.test.ts apps/web/tests/ai-scope.test.ts` | **0** | 4 files passed — **62 passed \| 1 skipped (63)**. The 1 skip is the dormant rule-5 application block.                                                                     |
| `pnpm --filter web typecheck`                                                                                                                                                                 | **0** | `next typegen && tsc --noEmit` clean. This is what proves the `@ts-expect-error` in the compile-time case is genuinely used (an unused directive is itself a type error). |
| `pnpm --filter @luxalgo/journal-core typecheck`                                                                                                                                               | **0** | clean                                                                                                                                                                     |
| `pnpm --filter @luxalgo/journal-importers typecheck`                                                                                                                                          | **0** | clean                                                                                                                                                                     |
| `node scripts/check-licenses.mjs`                                                                                                                                                             | **0** | "Dependency licenses OK." — no new dependency.                                                                                                                            |
| `pnpm exec prettier --check <every file changed 0a27850..HEAD>`                                                                                                                               | **0** | "All matched files use Prettier code style!" — **after** the formatting repair recorded below; this gate **failed** (exit 1) when it was first run.                       |

### Formatting-gate defect and repair

The format gate was **not** clean when this report was first written. `pnpm exec prettier --check`
over the files this phase touched exited **1** on `docs/superpowers/plans/ai-native-journal/phase-01.md`,
which had been committed with CRLF line endings and `*emphasis*` markers. The earlier claim in
this section that the format gate reported exit 0 was therefore **wrong**; it is corrected above
and the repair is recorded here.

The plan file was normalised with
`pnpm exec prettier --write docs/superpowers/plans/ai-native-journal/phase-01.md` (CRLF → LF,
`*same*` → `_same_`, and prettier's table-column alignment). A line-by-line comparison of the
committed blob against the formatted file, after normalising line endings, shows no content
difference beyond those emphasis markers and the table padding — **no contract, instruction or
behaviour changed**. The fix is committed on its own as
`477b1020ecc86af01310c85e0d257934d67e1908` ("Fix the Phase 01 plan formatting so the repository
format gate passes").

The four required gates were re-run after the repair, against the same commits:

| Command                                                                                                                                                                                       | Exit  | Result                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/db-connection-lifecycle.test.ts apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/execution-storage.test.ts apps/web/tests/ai-scope.test.ts` | **0** | 4 files passed — **62 passed \| 1 skipped (63)**. The 1 skip is the dormant rule-5 application block. |
| `pnpm --filter web typecheck`                                                                                                                                                                 | **0** | `next typegen && tsc --noEmit` clean.                                                                 |
| `pnpm exec prettier --check <every file changed 0a27850..HEAD>`                                                                                                                               | **0** | "All matched files use Prettier code style!"                                                          |
| `node scripts/check-licenses.mjs`                                                                                                                                                             | **0** | "Dependency licenses OK." — no new dependency.                                                        |

The repo-wide prettier violations outside this phase's file set are pre-existing and were left
untouched.

### Wider regression (regression targets of the changed server modules)

| Command                                                                                                                                                                                                                                                | Exit  | Result                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------------- |
| `pnpm exec vitest run` over `execution-storage`, `ai-scope`, `history-import`, `xtb-import`, `ibkr-flex-xml-import`, `ninjatrader-import`, `db-concurrent-init`, `db-connection-lifecycle`, `intelligence-boundaries`, `prop-firms`, `sync-resilience` | **0** | 11 files passed — **127 passed \| 1 skipped (128)**. |

The six-file regression set required by the plan reports **87 tests in 6 files**
(execution-storage 10, ai-scope 38, history-import 7, xtb-import 5, ibkr-flex-xml-import 17,
ninjatrader-import 10) — identical to the baseline recorded on the base commit.

### Environment-limited check: the root `pnpm typecheck`

`pnpm typecheck` runs `pnpm -r --parallel typecheck`, which includes the `desktop` workspace
(`cd src-tauri && cargo check`). It **fails on this host**, exit **101**, and the failure is
confined to `desktop`:

```
desktop typecheck:   E:\build-cache\target\debug\build\trade-journal-desktop-119a88e22edbe3fa\out\resource.rc(26) : error RC2175 : resource file E:\4004\orca\workspaces\trade-journal\codex-ai-native-journal-p01\desktop\src-tauri\icons\icon.ico is not in 3.00 format
desktop typecheck:   called `Result::unwrap()` on an `Err` value: Failed("RC.EXE failed to compile specified resource file")
```

This is **pre-existing and environmental**: the same command on the untouched base tree, with the
phase work stashed aside, prints the **byte-identical** error (verified by diffing the two
captured outputs — `IDENTICAL`). The phase changes no file under `desktop/`. `apps/web`,
`packages/core` and `packages/importers` all typecheck clean (§4 above). The desktop gate
belongs to the phase verification owner.

### Not run here (coordinator-appointed gate)

The full `pnpm test` suite was deliberately **not** run: the coordinator appoints the phase
verification owner for that gate.

---

## 5. Deviations, evidence, review findings and their resolution, and open risks

### Deviations from the plan

1. **The barrel was wired by the phase owner, not by the implementing subtask.** The plan assigns
   `db/index.ts` to subtask 1, but that subtask was scoped to the two new modules and the test,
   because the barrel rewrite is a public-surface change the phase owner should make and verify.
   The barrel now re-exports `./connection`, `./transaction` and `./schema`.
2. **The lifecycle test imports the seams through the `@/db` barrel**, not through deep module
   paths. The plan's Global Constraint ("the public import path for every new seam is `@/db`")
   is therefore covered by a test rather than assumed.

### Evidence that the new tests are not vacuous

- **ADR 0007 sidecar protection** — the lifecycle test spies on `node:fs.unlinkSync` and asserts
  no `-wal`/`-shm` path was ever unlinked, so the regression is caught on POSIX as well as
  Windows (on POSIX an open sidecar is unlinked silently; on Windows the unlink fails).
- **Callable-thenable guard** — reverting the `isThenable` change makes the new
  "rejects a callable thenable as well as a promise" case fail with better-sqlite3's generic
  `Transaction function cannot return a promise`; restoring it passes 7/7. The guard is
  load-bearing.
- **Compile-time rejection** — the `@ts-expect-error` directive is unused-as-written would be a
  type error, so `pnpm --filter web typecheck` passing proves the conditional signature really
  rejects an async callback.
- **Boundary guard** — the rule-2 offender count dropped **16 → 0** when the ten direct
  `./api` importers were repointed. The six modules that reached Next only transitively
  (`ai-capabilities.ts`, `ai-report-context.ts`, `ai.ts`, `ctrader-mcp/sync.ts`, `demo.ts`,
  `market-data/estimates.ts`) needed no edit of their own.
- **Rule 5 dormancy** — the detector's violating-fixture self-test runs **live** on every run, so
  the guard is proven to work; only its application to the not-yet-existing
  `server/intelligence/` tree is skipped, and the report shows it as skipped.

### Review findings and how each was resolved

The plan went through six reviewer rounds before it was approved (each round's findings were
wording or completeness defects in the plan, not design changes). The implementation went through
one review round plus one re-check:

| Finding                                                                                                                                                                                                           | Resolution                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan: no combined pre-implementation red run                                                                                                                                                                      | Plan rewritten: one combined red run, both test files first. Executed — exit 1, output in §4.                                                                                                                                                                                                                           |
| Plan: the async-transaction test did not require a rejecting promise or observe `unhandledRejection`                                                                                                              | Plan rewritten to require an asynchronously-rejecting promise, the rollback assertion, and an `unhandledRejection` listener assertion. Implemented.                                                                                                                                                                     |
| Plan: `withJournalTransaction` had no assigned public import path; two subtasks claimed one file                                                                                                                  | Ownership re-assigned: one subtask owns the barrel and both new modules.                                                                                                                                                                                                                                                |
| Plan: the import-graph resolver did not resolve directory targets for `@/` aliases                                                                                                                                | Plan rewritten; the resolver tries `<path>.ts`, `<path>.tsx`, `<path>/index.ts`, `<path>/index.tsx`. Without this, `@/db` would vanish from the graph and the rules would pass vacuously.                                                                                                                               |
| Plan: the dormant rule-5 detector proof was inside the skipped block                                                                                                                                              | Split: the violating-fixture self-test is live; only the real-tree application is skipped.                                                                                                                                                                                                                              |
| Plan: the stop condition omitted the review/report/coordinator gates                                                                                                                                              | Stop condition rewritten to cover the review verdict, the six required report items and the coordinator-owned gates.                                                                                                                                                                                                    |
| Plan: the root typecheck failure was pre-classified as a missing sidecar                                                                                                                                          | Plan rewritten to require the **exact** baseline error text, quoted verbatim, with no cause pre-assigned. The actual cause on this host is `RC2175` on the generated icon.                                                                                                                                              |
| **Implementation:** `isThenable` accepted only objects, so a callable thenable bypassed the guard and its rejection escaped as `unhandledRejection`                                                               | `isThenable` now accepts objects **and** functions. Mutation-proved: the old form fails the new test with better-sqlite3's generic message.                                                                                                                                                                             |
| **Implementation:** the lifecycle test's comment claimed the barrel did not export the new seams, and it imported deep paths, leaving the `@/db` public-path constraint untested                                  | The test now imports through the barrel; the comment is corrected; the barrel's completeness is asserted.                                                                                                                                                                                                               |
| **Phase gate:** `docs/superpowers/plans/ai-native-journal/phase-01.md` failed `prettier --check` (exit 1), so the phase's own stop condition was not met and the earlier report claimed the format gate was clean | The plan file was normalised with `prettier --write` (CRLF → LF, `*same*` → `_same_`, table alignment) — no contract, instruction or behaviour changed — and committed on its own as `477b102`. `prettier --check` over every file changed `0a27850..HEAD` now exits 0; the four required gates were re-run green (§4). |

Final implementation review: **PASS, 13 PASS / 0 FAIL / 0 BLOCK** (`.omp/reviewer-report.md`).

### Open risks

| Risk                                                                                                                                                                                                                                                                                                                    | Severity                                                         | Blocks next phase?                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The `desktop` workspace typecheck fails on this host (host-generated icon, `RC2175`). Pre-existing; identical on the untouched base tree.                                                                                                                                                                               | Low for Phase 01 — no `desktop/` file changed.                   | No, but the phase verification owner must classify it as environmental. |
| The `desktop` sidecar binary, generated icons and the built web bundle were provisioned locally during this phase to obtain baseline evidence. All are git-ignored and absent from the committed tree.                                                                                                                  | None for the deliverable.                                        | No.                                                                     |
| `withJournalTransaction` is bound to the app singleton at module-evaluation time. A consumer that resets the module registry must re-import both the barrel and the transaction seam together, or it will hold a closed handle. The lifecycle test now imports through the barrel, so it exercises the consistent path. | Low — a Phase 04+ concern (the worker opens its own connection). | No, but Phase 04 should prefer a per-connection seam.                   |
| Rule 5 of the boundary guard is dormant until `server/intelligence/` exists.                                                                                                                                                                                                                                            | Low — the detector itself is proven live by its self-test.       | No.                                                                     |

---

## 6. Next-phase handoff (Phase 02 — not started here)

Inputs Phase 02 needs from this phase:

1. **The connection seam is ready to build on:** `openConnection(directory)` returns a
   `JournalDb` with the shared bootstrap already applied (WAL, `foreign_keys = ON`,
   `busy_timeout = 5000`, idempotent schema setup), and it never touches WAL sidecars. Phase 02
   should use it for the migration runner instead of reaching for the singleton.
2. **The transaction seam** `withJournalTransaction(fn)` is available for the migration runner's
   immediate-transaction requirement, with a synchronous-only contract already proven by tests.
3. **The app singleton now tracks its directory on `globalThis`**, so a Phase 02 migration runner
   that re-evaluates modules can rely on the singleton resetting only on a real directory change.
4. **The boundary guard is installed** and will automatically police the Phase 03+
   `server/intelligence/**` tree once it exists (rule 5's application block activates
   automatically; the detector is already proven live).
5. **Preconditions to confirm before starting Phase 02:** the Phase 02 task's own plan and
   migration-ledger design must be committed first; `apps/web/src/db/schema.ts` and
   `apps/web/src/db/bootstrap.ts` remain the single owner for schema and migration-registry
   changes, and are currently unmodified by Phase 01.
6. **Gates still owned by the coordinator:** the full `pnpm test` phase gate, the serialized
   phase→feature merge into `codex/ai-native-journal`, and
   `docs/superpowers/reports/ai-native-journal-integration-01.md`. This phase claims none of them.

Phase 02 was **not started** by this phase.
