## Verdict: PASS

## Reviewer Report — Phase 13 background-AI test-coverage repair

### PASS / FAIL

PASS. All four findings from the implementation-diff review are genuinely resolved, the
strengthened cases have teeth against the production plumbing they name, no production file was
touched, no existing assertion was weakened, and the plan and report describe what the test
actually does. Three documentation nits are recorded below; none of them changes a check result
or overstates coverage.

### Findings

- [PASS] `apps/web/src/` — no production change: `git diff 6012ab4 -- apps/web/src/` is empty
  (0 bytes, 0 files). The repair touches only
  `apps/web/tests/intelligence-provider-policy.test.ts`,
  `docs/superpowers/plans/ai-native-journal/phase-13.md` and
  `docs/superpowers/reports/ai-native-journal-phase-13.md`. No schema change, no migration change,
  no new dependency (the test imports `node:crypto`, `node:fs`, `node:path`, `node:url`,
  `node:os` and the existing `../src/db/migration-checksums.json` artifact — all already in the
  tree).
- [PASS] `apps/web/tests/intelligence-provider-policy.test.ts:633-669` — finding 1 resolved. The
  fetch stub now captures `init.signal` (`providerSignal`), the caller cancels while the request
  is in flight, and the case asserts `abortedInFlight === true`, `providerSignal?.aborted === true`
  and `providerSignal?.reason === controller.signal.reason`. Teeth: `runBackgroundAi` forwards
  `AbortSignal.any([request.abortSignal, AbortSignal.timeout(...)])` into `generateText`
  (`apps/web/src/server/ai-runtime.ts:394-404`), and `AbortSignal.any` propagates the source
  signal's abort reason, so the captured signal is aborted and carries the caller's reason
  identity. Remove the `abortSignal` forwarding and `init.signal` is never aborted, so
  `expect(abortedInFlight).toBe(true)` fails. The pre-existing "the request was stopped"
  assertion (`.rejects.toMatchObject({ kind: "timeout" })`, line 656) is kept, not weakened.
- [PASS] `apps/web/tests/intelligence-provider-policy.test.ts:488-527` — finding 2 resolved. The
  composed cancelled case keeps `expect(result).toMatchObject({ status: "cancelled", reason:
  "cancelled" })` and the stored-status/meta assertions, and additionally proves the composed path
  aborted the in-flight provider request through the caller's signal: the stub captures
  `init.signal`, aborts the caller's controller and asserts the captured signal was aborted and
  carries the caller's reason. Teeth: `executeBackgroundRun` passes `abortSignal: input.signal` to
  `runBackgroundAi` (`apps/web/src/server/intelligence/composition.ts:467`); with the forwarding
  removed the provider sees no aborted signal and the case fails.
- [PASS] `apps/web/tests/intelligence-provider-policy.test.ts:394-424` — finding 3 resolved for
  the ordering. The fetch stub now reads `db.select().from(intelligenceBudgetReservations).all()`
  at call time, and the case asserts `reservationsAtCallTime` has length 1 and matches
  `{ runId, attempt: 1 }` — the row must already be committed when the provider is called, not
  only once the call returned. Teeth: `reserveBackgroundAttempt` is committed by
  `withJournalTransaction` before `runBackgroundAi`
  (`apps/web/src/server/intelligence/composition.ts:425,467`); move the reservation after the
  provider call and the call-time read is empty, so `toHaveLength(1)` fails.
- [PASS] `apps/web/tests/intelligence-provider-policy.test.ts:358-390` — finding 3 resolved for the
  race. The new case fills the day's allowance to `BACKGROUND_DAILY_ATTEMPT_LIMIT - 1` for another
  run, then races two reservations for the same run and day through two connections
  (`withJournalTransaction` on the journal handle and `withConnectionTransaction` on a second
  `openConnection`), and asserts exactly one success, exactly one failure, total rows equal to the
  limit and exactly one row for the raced run — the loser leaves no row behind. Teeth:
  `reserveBackgroundAttempt` counts the day's rows and refuses at the limit
  (`apps/web/src/server/intelligence/infrastructure/policy-store.ts:140-150`); break that check and
  both racers succeed. The report discloses the limitation honestly: better-sqlite3 transactions
  are synchronous, so the racers serialise rather than interleave
  (`docs/superpowers/reports/ai-native-journal-phase-13.md:196-199`).
- [PASS] `apps/web/tests/intelligence-provider-policy.test.ts:697-731` — finding 4 resolved. Two
  cases exist: the three tables `intelligence_budget_reservations`, `intelligence_policy`,
  `intelligence_runs` exist in the journal (`sqlite_master`), and the registered checksum of
  migration `0005` matches the migration source (`sha256(canonical(source))` vs
  `MANIFEST.migrations["5"].checksum`) and the ledger row the runner applied
  (`journal_migrations` version 5, same checksum). The ledger-row assertion is what proves
  migration 0005 was actually applied; the table assertion alone could be satisfied by the
  bootstrap DDL splice (`apps/web/src/db/bootstrap.ts`), so the pair is stronger than either
  alone.
- [PASS] `docs/superpowers/plans/ai-native-journal/phase-13.md:190-193`, `:205-207`,
  `docs/superpowers/reports/ai-native-journal-phase-13.md:73-76` — the plan checklist line, the
  plan's step 2 and the report sentence now describe exactly what the test does (three tables
  exist, checksum matches the migration source and the ledger row). No coverage is claimed that
  the test does not have.
- [PASS] assertion integrity across the test diff — `expect(` count goes from 67 (HEAD) to 85; the
  only removed `expect(` is a re-flow of
  `expect(authorizeBackgroundRun(rescheduled, NOW, ...).status).toBe("completed")` into a
  single-line form with identical semantics. No assertion was deleted or weakened; the changes
  are additions.
- [PASS] test count — 33 `it(...)` blocks (30 at HEAD plus the racing-reservation case plus the
  two `0005` cases), matching the report's "33 tests" claim
  (`docs/superpowers/reports/ai-native-journal-phase-13.md:56-57`).
- [PASS] scoped verification —
  `pnpm exec vitest run apps/web/tests/intelligence-provider-policy.test.ts` → 1 file,
  33 tests passed (439 ms);
  `pnpm exec prettier --check apps/web/tests/intelligence-provider-policy.test.ts` →
  "All matched files use Prettier code style!".
  Supporting checks: `pnpm --filter web typecheck` → clean;
  `cd apps/web && node scripts/build-migration-manifest.mjs --check` → "migration-checksums.json
  is up to date".
- [PASS] commit message — proposed subject "fix: make the Phase 13 background policy tests fail
  when the behaviour breaks" states the capability gained (the phase's tests now fail when the
  behaviour breaks) rather than the files edited, names no file or symbol, and matches the
  repository precedent (`60c4f25 fix: keep the legacy tool-call budget error reachable through the
  execution context`). Audit result: PASS. Optional improvement, not a gate: name the behaviour
  (cancellation / reservation ordering) so the subject reads as a solved problem, e.g. "fix: prove
  a cancelled background run aborts the provider request and reserves before it".
- [NOTE] `docs/superpowers/reports/ai-native-journal-phase-13.md:224-225` — the proof-of-teeth
  table quotes the failure text `expected undefined to be defined` for both cancellation cases. The
  current assertions are `expect(abortedInFlight).toBe(true)` and `expect(providerSignal?.aborted)
  .toBe(true)`, which fail as `expected false to be true` / `expected undefined to be true`; the
  file contains no `toBeDefined` assertion, so the quoted message cannot be produced by the
  committed test. Non-blocking: the substantive claim (the case fails when the abort plumbing is
  removed) holds and is verifiable from the diff; only the quoted literal is stale. Correct the
  two quoted strings when the report is next touched.
- [NOTE] `docs/superpowers/reports/ai-native-journal-phase-13.md:237` — the drift count is given as
  "78 files"; `pnpm format:check` reports "Code style issues found in 77 files." (78 `[warn]`
  lines includes the summary line). Non-blocking.
- [NOTE] `docs/superpowers/reports/ai-native-journal-phase-13.md:219-236` — the two tables added by
  this repair are not prettier-canonical (prettier reformats them), while line 238 states the
  drift "pre-exists this phase and was not touched". Both markdown documents already failed
  `prettier --check` at HEAD, so no gate result changes, and the scoped prettier command for this
  slice covers the test file only. The plan's newly added prose is prettier-clean. Running
  `prettier --write` on the two documents would remove the ambiguity, but that would also
  reformat the pre-existing drift in them and is out of scope for this slice.

### Summary

15 PASS, 0 FAIL, 0 BLOCK. The four findings are resolved with teeth, production is untouched, no
assertion was weakened, the two scoped verification commands are green, and the commit subject
passes the "what was solved, not what was edited" audit. The three notes above are documentation
accuracy nits (a stale quoted failure message, a file count off by one, and new tables that are
not prettier-canonical inside files that already failed prettier at HEAD); none of them changes a
check result or overstates coverage.

Pre-existing state outside this slice: `pnpm format:check` fails repo-wide on 77 files, including
both touched markdown documents, at HEAD. Out of scope, reported as a note only.
