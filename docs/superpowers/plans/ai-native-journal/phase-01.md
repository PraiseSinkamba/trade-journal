# Phase 01 — Safe journal seams; request errors separated from Next

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Implement only this phase. Do not begin Phase 02.

**Goal:** Give the journal two safe, explicit seams — an independent connection factory and a
synchronous-only transaction runner — and move `RequestError`/`requireValue` out of the
Next-coupled request module so server-side domain code no longer pulls Next in transitively.

**Architecture:** `apps/web/src/db/connection.ts` owns every way a journal connection is opened
(the app singleton and `openConnection(directory)`); `apps/web/src/db/transaction.ts` owns the
transaction seam (`JournalTx`, `withJournalTransaction`); `apps/web/src/db/index.ts` stays the
public `@/db` barrel. `apps/web/src/server/request-error.ts` owns the request-failure type and
the assertion helper; `apps/web/src/server/api.ts` re-exports the _same_ class and function so
route handlers and their response contracts are untouched.

**Tech Stack:** Existing TypeScript (strict, `noUncheckedIndexedAccess`), Next.js 15, Drizzle +
better-sqlite3, Zod, Vitest. **No new dependency.** No schema change, no migration.

---

## Global Constraints

These bind every task in this phase. Copy them verbatim into any review dispatch.

- **Schema allocation: None.** Phase 01 adds no table, column, index, ledger or migration.
  `apps/web/src/db/schema.ts` and `apps/web/src/db/bootstrap.ts` are read-only this phase and
  must not be edited.
- **No new dependency.** No manifest and no `pnpm-lock.yaml` change; no ADR is required because
  nothing is added. `node scripts/check-licenses.mjs` must still report OK.
- **No network, Promise, worker invocation or provider call inside a write transaction.**
- **Preserve** execution hashes, derived trade keys, annotations, cTrader sync, all three AI
  provider categories (Anthropic, OpenAI, OpenAI-compatible), encrypted credentials, and every
  existing import and AI response contract.
- **Never edit an applied migration.** Phase 01 applies none.
- **Route response behaviour is unchanged.** `RequestError` still maps to HTTP 400; every other
  exception still maps to HTTP 500. `requireValue` still throws `RequestError`.
- **`RequestError` identity is preserved.** `api.ts` re-exports the _same_ class object, so
  `error instanceof RequestError` is true on both import paths.
- **Worker boundary.** No module under `apps/web/src/server/` other than the request boundary
  `apps/web/src/server/api.ts` may reach `next/*`, `react`, `react-dom` or an
  `apps/web/src/app/**` route file.
- **Synchronous transactions only.** A transaction callback that returns a promise is rejected at
  compile time _and_ at runtime; the discarded promise's rejection is consumed so it never
  surfaces as an unhandled rejection.
- **The public import path for every new seam is `@/db`.** `openConnection`, `JournalDb`,
  `JournalTx` and `withJournalTransaction` are all reachable from `@/db`; `apps/web/src/db/index.ts`
  is the only barrel and is owned by exactly one subtask.
- **Do not weaken an expected behaviour to make a test pass.** Do not delete or relax an existing
  assertion to accommodate this phase.
- **Node ≥ 22, pnpm 11.0.8, frozen lockfile.** `pnpm install` is already done; do not reinstall.
- Use a disposable absolute `JOURNAL_DATA_DIR`. Never use ports 3000/3001.

---

## Contracts (authoritative — implement exactly, do not paraphrase)

From the detailed plan (`docs/superpowers/plans/2026-10-22-ai-native-journal-modernization.md`
Task 1) and the contract review
(`docs/superpowers/specs/2026-10-22-ai-native-journal-architecture-contract-review.md` §3):

```ts
// apps/web/src/db/connection.ts
export type JournalDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
export const openConnection = (directory: string): JournalDb => {
  /* ... */
};

// apps/web/src/db/transaction.ts
// derives the real Drizzle transaction type, not JournalDb
export type JournalTx = Parameters<Parameters<JournalDb["transaction"]>[0]>[0];
export function withJournalTransaction<T>(
  fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T,
): T;

// apps/web/src/server/request-error.ts
export class RequestError extends Error {}
export function requireValue(condition: unknown, message: string): asserts condition;

// apps/web/src/server/api.ts
export { RequestError, requireValue } from "./request-error"; // identical bindings
```

`withJournalTransaction` must reject a promise-returning callback **by types** (the conditional
return type above) **and by a runtime thenable guard** that throws inside the transaction so the
transaction rolls back.

---

## File ownership (exclusive — no two tasks may touch the same file)

| Path                                                                                                                                                                              | Owner subtask      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `apps/web/src/db/connection.ts` (new)                                                                                                                                             | 1 — journal seams  |
| `apps/web/src/db/transaction.ts` (new)                                                                                                                                            | 1 — journal seams  |
| `apps/web/src/db/index.ts` (modify — the only barrel)                                                                                                                             | 1 — journal seams  |
| `apps/web/tests/db-connection-lifecycle.test.ts` (new)                                                                                                                            | 1 — journal seams  |
| `apps/web/src/server/request-error.ts` (new)                                                                                                                                      | 2 — error boundary |
| `apps/web/src/server/api.ts` (modify)                                                                                                                                             | 2 — error boundary |
| `apps/web/src/server/{ai-import,ai-scope,executions,ibkr-flex-xml-import,ibkr-sync-timezone,ninjatrader-import,prop-csv,prop-firms,sync,xtb-import}.ts` (modify import line only) | 2 — error boundary |
| `apps/web/tests/intelligence-boundaries.test.ts` (new)                                                                                                                            | 3 — import guard   |
| `docs/superpowers/plans/ai-native-journal/phase-01.md` (this file)                                                                                                                | phase owner        |
| `docs/superpowers/reports/ai-native-journal-phase-01.md`                                                                                                                          | phase owner        |

The Subtask 2 file set is **derived, not guessed**: it is exactly the set of files under
`apps/web/src/server/` that import from `"./api"`. Verified on the base commit, that set is the
ten files listed above:

```bash
grep -rln 'from "\./api"' apps/web/src/server/
```

`apps/web/src/server/position-import.ts` does **not** import from `"./api"` (its line 4 is
`import { executionHash } from "./ids";`) and must not be edited — it is not an owner of any
subtask here. Six further server modules (`ai-capabilities.ts`, `ai-report-context.ts`, `ai.ts`,
`ctrader-mcp/sync.ts`, `demo.ts`, `market-data/estimates.ts`) reach Next **only transitively**,
through the ten files above; once those ten stop importing `"./api"`, those six are clean too and
need no edit of their own. A resolver run over the base commit confirms the numbers: **16**
server modules reach `next/server` or `next/headers` today, and **0** do after the repoint.

Read-only for everyone: `apps/web/src/db/schema.ts`, `apps/web/src/db/bootstrap.ts`,
`packages/**`, `apps/web/tests/execution-storage.test.ts`, `apps/web/tests/ai-scope.test.ts`.
The last two are **regression targets**, not edit targets — they must pass unchanged.

---

## Execution order (the plan's test-first sequence is binding)

```
commit plan ─→ Subtask 1 tests  ─┐
                                  ├─→ RED RUN (both files, one command)  →  Subtask 1 impl
                    Subtask 3 tests  ─┘                                            Subtask 2 impl  (parallel with 1)
```

0. **Commit this plan first.** It must be committed to the phase branch before any
   implementation or subtask branching begins, so every implementer and reviewer works from the
   same committed contract:
   `git add docs/superpowers/plans/ai-native-journal/phase-01.md && git commit -m "docs: add Phase 01 journal seam plan"`.
1. Write **both** test files first (subtasks 1 and 3). No production file is touched yet.
2. Run the single combined command and record the expected failure.
3. Implement subtasks 1 and 2 (disjoint files, may run in parallel).
4. Re-run the combined command and the regression targets.
5. Commit the implementation with Task 1's conventional commit subject:
   `refactor: expose safe journal transaction boundaries`.

---

## Subtask 1 — Journal seams: connection lifecycle and synchronous transaction

**Files:** create `apps/web/src/db/connection.ts`, `apps/web/src/db/transaction.ts`,
`apps/web/tests/db-connection-lifecycle.test.ts`; modify `apps/web/src/db/index.ts`.

**Interfaces produced:** `JournalDb`, `dataDir()`, `openConnection(directory)`, `JournalTx`,
`withJournalTransaction(fn)`, and the app singleton `db` — all reachable from `@/db`.

This subtask owns both new db modules and the only barrel, so the public import path `@/db` is
assigned here and no other subtask may edit `apps/web/src/db/index.ts`.

- [ ] **Step 1 — Write the failing lifecycle test.**

  Create `apps/web/tests/db-connection-lifecycle.test.ts`. It must cover:

  1. _Two independently opened connections see committed state._ Open two connections with
     `openConnection(dir)` against one scratch directory, insert an `accounts` row through one
     and read it back through the other. Use `mkdtempSync` scratch directories under the OS temp
     dir; never touch a live journal directory.
  2. _Closing one connection leaves the other's WAL sidecars alone._ After a write through
     connection A, close A and assert `journal.db-wal` and `journal.db-shm` still exist in that
     directory, that B still reads the committed row, and that B can still write.
  3. _The app singleton reset does not delete a live connection's WAL sidecars._ Set
     `JOURNAL_DATA_DIR` to scratch directory A and `await import("../src/db")` (fresh module
     registry via `vi.resetModules()`), open an **independent** connection to A with
     `openConnection(A)`, write a row through it so A has WAL sidecars, then point
     `JOURNAL_DATA_DIR` at scratch directory B, `vi.resetModules()`, and `await
import("../src/db")` again. Assert A's `-wal` and `-shm` still exist and that the
     independent connection still reads its row.
     **Current behaviour to expect when this fails:** re-importing `../src/db` after the data
     directory changed throws `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of
type string. Received undefined` from the existing `join(currentDataDir!, "journal.db")`
     call, because `currentDataDir` is module-scoped and resets to `undefined` on re-evaluation
     while `globalThis.__journalDb` survives. The fix (Step 3) makes the reset path work and
     keeps another connection's sidecars intact. Record the actual failure text; do not assume a
     particular message.
  4. _`withJournalTransaction` commits on success and rolls back on failure._ Insert a row
     inside the transaction and read it back; throw inside the transaction and assert the row was
     not persisted.
  5. _A promise-returning callback is rejected at runtime, rolls back, and consumes its
     rejection._ The callback writes a row inside the transaction and returns a promise that
     **rejects asynchronously** (reject on a later tick, so the rejection lands after the
     transaction has already returned). Assert that the call throws an error matching
     `/synchronous/i`, that the row written inside the transaction was **rolled back**, and that
     **no `unhandledRejection` was observed**: attach a `process.on("unhandledRejection", ...)`
     listener for the duration of the test, await long enough for the late rejection to fire, and
     assert the listener recorded nothing. Detach the listener in `finally`.
     The conditional type makes an async callback a **compile error**, so this runtime case needs
     a deliberate typed escape hatch — for example
     `const callback = async () => { ... } as unknown as (tx: JournalTx) => void;`
     followed by `withJournalTransaction(callback)`. Keep the escape hatch in one clearly
     commented place so a reviewer can see the compile-time guard is exercised separately in
     case 6.
  6. _Compile-time rejection._ Keep a never-executed function whose body calls
     `withJournalTransaction(async () => undefined)` under a `// @ts-expect-error` comment on the
     immediately preceding line. `apps/web/tsconfig.json` includes `**/*.ts`, so
     `pnpm --filter web typecheck` proves the directive is used; an unused directive is itself a
     type error. This is the proof that the conditional signature rejects async callbacks.

  Use `afterAll` to close every handle the test opened and to remove the scratch directories.

  Do **not** run this file yet: the single pre-implementation red run happens once, after both test
  files exist (see "Combined red run").

- [ ] **Step 2 — Implement `apps/web/src/db/connection.ts`.**

  Move the journal-connection concern out of `db/index.ts`:

  - `JournalDb` type: `BetterSQLite3Database<typeof schema> & { $client: Database.Database }`.
  - `dataDir()`: `process.env.JOURNAL_DATA_DIR ?? "/data/trade-journal"` (unchanged behaviour).
  - `openConnection(directory: string): JournalDb` — creates `directory` if missing
    (`mkdirSync(directory, { recursive: true })`), opens `<directory>/journal.db` through the
    existing `openJournalDatabase` from `./bootstrap` (so WAL mode, `foreign_keys = ON` and the
    idempotent schema setup are unchanged), applies `busy_timeout = 5000`, and wraps it with
    `drizzle(sqlite, { schema })` plus the `$client` handle. It must **never** unlink `-wal` or
    `-shm` files.
  - The app singleton `db` — keep the `globalThis.__journalDb` hot-reload behaviour and close the
    old handle when the data directory changed, but **delete the manual WAL/SHM unlink**
    (`cleanWalFiles` and its `existsSync`/`unlinkSync` imports). Deleting live WAL sidecars is
    forbidden by ADR 0007 and is the defect this phase removes. Track the directory the cached
    handle belongs to **on `globalThis` as well**, so a module re-evaluation resets the singleton
    only when the data directory actually changed — this also removes the `join(undefined!, …)`
    throw described in test case 3.

- [ ] **Step 3 — Implement `apps/web/src/db/transaction.ts`.**

  - `JournalTx` derived exactly as the contract review states:
    `Parameters<Parameters<JournalDb["transaction"]>[0]>[0]`.
  - `withJournalTransaction<T>(fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T): T`
    runs `fn` inside one `db.transaction(..., { behavior: "immediate" })` on the app's journal
    connection and returns `fn`'s value.
  - Runtime guard: if `fn` returns a thenable, **consume the thenable's rejection** (attach a
    rejection handler so it can never surface as an unhandled rejection) and throw an `Error`
    whose message says journal transactions must be synchronous. The throw must happen **inside**
    the transaction so the transaction rolls back.

- [ ] **Step 4 — Rewrite `apps/web/src/db/index.ts` as the public barrel.**

  Keep `@/db` exporting the same surface as before — `db`, `dataDir`, `JournalDb`, every schema
  table — and add `openConnection`, `JournalTx` and `withJournalTransaction`. No file may import
  `@/db` and get a different singleton than before. `export * from "./schema"` stays.

- [ ] **Step 5 — Run the lifecycle test.**

  Run: `pnpm exec vitest run apps/web/tests/db-connection-lifecycle.test.ts`
  Expected: PASS.

- [ ] **Step 6 — Typecheck.**

  Run: `pnpm --filter web typecheck`
  Expected: exit 0.

---

## Subtask 2 — Request errors separated from Next

**Files:** create `apps/web/src/server/request-error.ts`; modify `apps/web/src/server/api.ts` and
the import line of every `apps/web/src/server/**` module that imports `requireValue` or
`RequestError` from `"./api"`.

**Interfaces consumed:** none.
**Interfaces produced:** `RequestError`, `requireValue` in `apps/web/src/server/request-error.ts`,
re-exported unchanged from `apps/web/src/server/api.ts`.

- [ ] **Step 1 — Create `apps/web/src/server/request-error.ts`.**

  Move the two declarations out of `api.ts` verbatim — same class body
  (`export class RequestError extends Error {}`) and same helper
  (`export function requireValue(condition: unknown, message: string): asserts condition`).
  This module must import **nothing**: no Next, no React, no database.

- [ ] **Step 2 — Rewrite `apps/web/src/server/api.ts`.**

  `api.ts` keeps `ok`, `bad` and `handler` exactly as they are, and re-exports the same bindings:

  ```ts
  import { RequestError, requireValue } from "./request-error";
  export { RequestError, requireValue };
  ```

  The `handler` error mapping (`error instanceof RequestError ? 400 : 500`) must keep using that
  same class, so import it into `api.ts` as well. Re-exporting the _same_ class object (not a
  copy or a subclass) is what keeps `error instanceof RequestError` true on both import paths.

- [ ] **Step 3 — Repoint the domain helpers at `./request-error`.**

  Every module under `apps/web/src/server/` that currently imports `requireValue` or
  `RequestError` from `"./api"` must import them from `"./request-error"` instead — only the
  import line changes, no behaviour changes. Derive the set with the grep above; on the base
  commit it is the ten files listed in the ownership table, and after the change the grep must
  return nothing. The `apps/web/src/app/api/**` route files keep importing from `@/server/api`
  and are **not** touched.

  Do not edit server modules that only reach `"./api"` transitively (`ai-capabilities.ts`,
  `ai-report-context.ts`, `ai.ts`, `ctrader-mcp/sync.ts`, `demo.ts`,
  `market-data/estimates.ts`): repointing the ten direct importers already makes them clean, and
  an unnecessary edit widens the phase's diff.

- [ ] **Step 4 — Verify no behaviour changed.**

  Run: `pnpm exec vitest run apps/web/tests/execution-storage.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/history-import.test.ts apps/web/tests/xtb-import.test.ts apps/web/tests/ibkr-flex-xml-import.test.ts apps/web/tests/ninjatrader-import.test.ts`
  Expected: PASS with **87 tests in 6 files** — the baseline recorded on the base commit
  (execution-storage 10, ai-scope 38, history-import 7, xtb-import 5, ibkr-flex-xml-import 17,
  ninjatrader-import 10). The same counts must hold after this phase; a different count means a
  test was lost or silently skipped, which is a failure, not a pass.

---

## Subtask 3 — Import-graph guards

**Files:** create `apps/web/tests/intelligence-boundaries.test.ts`.

**Interfaces consumed:** the `@/db` barrel and the `apps/web/src/server/` layout produced by
subtasks 1 and 2.
**Interfaces produced:** none (test only).

- [ ] **Step 1 — Write the import-graph test.**

  Read the source tree with `node:fs` (`readFileSync` plus `glob` from `node:fs/promises`, the
  pattern already used by `apps/web/tests/ctrader-mcp/boundary.test.ts`) and build a module
  graph. The resolver must handle:

  - the `@/` alias → `apps/web/src/`, **including directory targets** — `@/db` resolves to
    `apps/web/src/db/index.ts`, so the resolver must try `<dir>/index.ts` and `<dir>/index.tsx`
    as well as `<path>.ts` and `<path>.tsx`. Without directory resolution a real import such as
    `@/db` silently disappears from the graph and rules 2–4 pass vacuously.
  - relative specifiers (`./x`, `../x`) with the same `.ts` / `.tsx` / `/index.ts` /
    `/index.tsx` resolution.
  - workspace packages `@luxalgo/journal-core` → `packages/core/src/index.ts` and
    `@luxalgo/journal-importers` → `packages/importers/src/index.ts`.
  - bare specifiers as external packages.
  - `import`, `import type`, `export … from`, `export type … from`, `export * from`,
    side-effect `import "x"` and dynamic `import("x")` forms.

  Assert these rules:

  1. **Public packages stay pure.** No file under `packages/core/src/` or
     `packages/importers/src/` resolves to a file under `apps/web/`, no specifier mentions an
     `intelligence` path, and `packages/core` never reaches `packages/importers`.
  2. **Server domain code cannot reach Next, React or routes.** For every module under
     `apps/web/src/server/` except `apps/web/src/server/api.ts`, the transitive import closure
     contains no `next/*`, `react` or `react-dom` specifier and no file under
     `apps/web/src/app/`. This is the rule that makes the worker bundle safe, and it is the rule
     subtask 2 turns green. Because the graph resolves `@/db` → `db/index.ts` →
     `db/connection.ts` → `db/bootstrap.ts`, the closure must be computed transitively — a
     direct-specifier scan would miss the path. For scale: on the base commit **16** server
     modules reach Next (10 directly, 6 transitively); after the repoint the number must be **0**.
  3. **The client layer cannot reach server code.** No file under `apps/web/src/lib/` or
     `apps/web/src/components/` resolves to a file under `apps/web/src/server/` or
     `apps/web/src/db/`.
  4. **Only the infrastructure layer wires the concrete driver.** `better-sqlite3` and
     `drizzle-orm/better-sqlite3` are imported only from files under `apps/web/src/db/`.
  5. **Sibling private adapters stay private.** The intelligence tree
     (`apps/web/src/server/intelligence/{contracts,infrastructure,knowledge,runtime,experience}`
     plus `composition.ts`) arrives in a later phase. Implement the detector now as a plain
     function over a file list, and split it into two parts:
     - a **live** test that runs the detector against a synthetic in-memory fixture that
       violates the rule (a domain importing a sibling's private file) and asserts the detector
       reports the violation. This block must **not** be skipped: it proves the detector is not a
       no-op on every verification run, whether or not the intelligence tree exists.
     - the **application** of the detector to the real `apps/web/src/server/intelligence/` tree,
       which is a `describe.skipIf(...)` block that reports as skipped until that directory
       exists, so the dormant rule is visibly dormant rather than silently passing.
       The rule itself: a module in one intelligence domain may import only `contracts/` from its
       siblings (never another domain's private files and never `infrastructure/`), and only
       `composition.ts` may wire concrete infrastructure adapters.

  Rules 1–4 are live today. Rule 5 must be visibly dormant, never silently passing.

  Do **not** run this file yet: the single pre-implementation red run happens once, after both test
  files exist (see "Combined red run").

---

## Combined red run (binding — the ONLY pre-implementation red run)

Both test files exist by now (subtask 1 Step 1 and subtask 3 Step 1) and no production file has
been touched. Run the combined command once, and record its output as the phase's red evidence:

- [ ] Run: `pnpm exec vitest run apps/web/tests/db-connection-lifecycle.test.ts apps/web/tests/intelligence-boundaries.test.ts`
      Expected: FAIL in both files — the connection seams do not exist yet and the server layer still
      reaches Next through `api.ts`. The rule-5 detector self-test passes; the rule-5 application
      block reports as skipped. Record the exact output.

Do not run either test file on its own before this point, and do not run either one again before
the implementation lands — this single run is the pre-implementation evidence.

---

## Verification (phase owner runs; record exact output in the phase report)

```bash
pnpm exec vitest run apps/web/tests/db-connection-lifecycle.test.ts \
  apps/web/tests/intelligence-boundaries.test.ts \
  apps/web/tests/execution-storage.test.ts \
  apps/web/tests/ai-scope.test.ts
pnpm typecheck
```

**Baseline evidence for the root `pnpm typecheck` failure.** `pnpm typecheck` also runs
the `desktop` workspace, whose `cargo check` build step depends on the host. Whether that
workspace succeeds here is a property of this machine, not of this phase. Any desktop failure is
**pre-existing and environmental**, and it is proven by running the same command on the
**untouched base tree**:

```bash
git stash push -u -m "phase01-wip" -- apps/web docs/superpowers   # set the phase work aside
pnpm typecheck                                                     # observe the desktop failure
git stash pop                                                      # restore the phase work
```

Record that baseline run's command, exit code and the **exact** desktop error text in the phase
report, quoted verbatim from the run. Do not classify the cause in advance and do not assume a
different host would show the same failure — quote what the run actually printed. Then show that
`pnpm --filter web typecheck` passes for the application. Do not "fix" the desktop workspace in
this phase — it is outside Phase 01's scope, and the desktop gate belongs to the phase
verification owner.

Do not run the full `pnpm test` suite: the coordinator appoints the phase verification owner for
that gate.

---

## Stop condition

Phase 01 is done when **all** of the following hold.

**Implementation and tests**

- [ ] The combined red run was executed before any production edit and its failure output is
      recorded.
- [ ] The four targeted test files pass:
      `pnpm exec vitest run apps/web/tests/db-connection-lifecycle.test.ts apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/execution-storage.test.ts apps/web/tests/ai-scope.test.ts`
- [ ] `pnpm --filter web typecheck` passes, and the root `pnpm typecheck` failure — if any — is
      confined to the `desktop` workspace, is outside Phase 01's scope, and its error text is
      **identical** to the untouched-baseline run described above, quoted verbatim in the phase
      report.
- [ ] `node scripts/check-licenses.mjs` reports OK (no new dependency).
- [ ] `pnpm format:check` reports no new violation in the files this phase touched.

**Review**

- [ ] A fresh spec-compliance and code-quality review of this phase's diff has run, and every
      Critical or Important finding is fixed and re-reviewed clean.
- [ ] The repo's reviewer gate is satisfied: `.omp/reviewer-report.md` records this phase's
      verdict as `## Verdict: PASS`.

**Report**

- [ ] `docs/superpowers/reports/ai-native-journal-phase-01.md` is written and committed, and
      contains every item the phase guide requires: 1. phase ID, start/end commit or working-tree baseline, exact scope completed and remaining; 2. changed files and exported interfaces, and the compatibility behaviour preserved; 3. migration version/table/column/index changes — **none in Phase 01** — plus the
      backup/rollback impact statement; 4. the exact commands run, their exit codes, counts and runtimes — including the combined
      red run, the final targeted run, the baseline `pnpm typecheck` run and
      `pnpm --filter web typecheck` — and every environment-limited check with its reason; 5. deviations and evidence, the review findings raised against this phase and how each was
      resolved, plus unresolved risks and whether they block the next phase or release; 6. a next-phase handoff listing the required inputs for Phase 02, without starting it.
- [ ] The report states the source/base SHA and the tip SHA of this phase's commits.
- [ ] The report records which gates remain with the coordinator and are **not** claimed by this
      phase: the full `pnpm test` phase gate, the serialized phase→feature merge, and
      `docs/superpowers/reports/ai-native-journal-integration-01.md`.

**Then stop.** Phase 02 (versioned migration runner) is a separate assignment. Do not merge to
`codex/ai-native-journal`, push, or open a PR — the coordinator owns the integration lock.
