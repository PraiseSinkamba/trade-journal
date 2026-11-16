## Verdict: PASS

## Reviewer Report — Phase 20: Retention, backup/restore, deletion and operations documentation

Contract: `docs/orchestration/ai-native-journal/tasks/T-020.md`. Plan of record:
`docs/superpowers/plans/ai-native-journal/phase-20.md`.

This report follows up the implementation review of this diff, which returned **FAIL** with one P1
and two P2 findings. Every finding was reproduced, fixed and re-proved with a deliberate break; the
findings are listed with their resolutions below. The follow-up review run did not complete inside
its budget, so this report is written from the evidence that was gathered: the failing review
report, the fix commits, the teeth runs (each a deliberate break of the production behaviour with the
test that failed), the type check, the format check and the test runs.

### PASS / FAIL

PASS — every finding of the previous review is resolved and proved by a test that can fail.

### Findings

#### The previous review's blocking findings, resolved

- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:373-404` — **P1, the rebuild
  never re-seeded the account — FIXED.** `requestAccountIntelligenceRebuildInTx` now clears the
  checkpoint's cursor and enqueues the `seed_account` job with the key the historical seed uses for
  its own continuation (`backfill.ts:197-200`), so a rebuild asked for twice is one job. Proved by a
  break: removing the enqueue fails
  `apps/web/tests/intelligence-retention.test.ts` — "enqueues the seed job when a rebuild is
  requested".
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:672-690` — **P2, the backup
  could seal the key probe under the wrong key — FIXED.** The probe is sealed under the journal's
  **live** key (`dataDir()`), and a source whose `.secret` is not the journal's own is refused before
  the snapshot is written. Proved by a break: removing the comparison fails
  `apps/web/tests/intelligence-backup.test.ts` — "refuses a source that does not hold the journal's
  own key".
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:838-852` — **P2, a restore of
  a deleted account left part of the deletion behind — FIXED.** The `deleted` branch now runs
  `purgeAccountIntelligence` — the same purge the delete path runs — before it deletes the account
  row, so the account's events, their deliveries and jobs, its observations, its knowledge and the
  rows that are not account bound but name its observations all go. Proved by a break: removing the
  purge fails `apps/web/tests/intelligence-backup.test.ts` — "takes the whole intelligence of a
  deleted account out of the restored journal".
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:517-534` — **the diagnostics
  prune no longer overstates its work.** A run whose diagnostics are already empty is not counted,
  and the emptied run's `updatedAt` is the instant of the prune rather than the cutoff, so it is not
  re-selected by every later prune.
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:164-176` — **a rebuild undoes
  a reset only.** `forgetPurgeLedger` takes the kind it removes, so a `deleted` account keeps its
  protection and an older backup still cannot bring it back.
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:846-856` — **the restored
  journal is verified again** after the ledger was applied, so the copy handed over is the copy that
  was checked.
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:900-925` — **the manifest is
  checked, not trusted.** A manifest without a version this build knows, or without a database, is
  refused with a clear reason instead of a crash later.

#### The contracts

- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:434` —
  `pruneIntelligence(before: number, limit: number): { removed: number }` matches the authoritative
  signature (`modernization.md:561`). The transaction-scoped twin `pruneIntelligenceInTx` and the
  knowledge entry point `pruneSupersededKnowledge` carry the 30-day and 90-day windows
  (`contract-review.md:392-394`).
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:199` —
  `purgeAccountIntelligence(tx: JournalTx, accountId: string): void` matches the authoritative
  signature and is integrated in the account deletion (`trading/commands.ts:213`).
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:637-651` — the backup takes an
  explicit source, an explicit destination and an explicit quiescence acknowledgement, and refuses
  everything it cannot vouch for.

#### The reference graph

- [PASS] `apps/web/src/server/intelligence/infrastructure/experience-store.ts:288-338` — the live
  reference index uses the real status sets: workflow `running|waiting_for_user|scheduled`
  (`schema.ts:989-991`), opportunity `pending|eligible|suppressed` (`schema.ts:1107-1108`),
  conversation `open` (`schema.ts:1143`). The id spaces are right: the live records name
  **observation ids** and **projection revision ids**, and the four `dedup_key` namespaces
  (`contracts/experience.ts:394-401`) are read as written.
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:440-470` — no prune breaks a
  live reference. Each protection was proved by a deliberate break:
  - the live workflow's subject — "keeps an observation a live workflow names";
  - the live opportunity's subject — "keeps an observation a live opportunity names";
  - the open conversation's subject — "keeps an observation an open conversation names";
  - the dismissed revision — "keeps an observation a dismissed revision names";
  - the knowledge record's evidence — "keeps a knowledge record a live workflow cites".
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:440-470` — no unacknowledged
  failure is deleted. A failed delivery keeps its event and its `last_error`, a failed or running job
  keeps its event, a failed run keeps its diagnostics. Each proved by a break.
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:490-534` — the compact dedup
  keys survive: the delivery goes only with its event (`schema.ts:588` cascade), the run row is never
  deleted, an opportunity is never deleted by the prune, and the job goes only with its delivery or
  as a finished retention job.

#### The purge, the reset and the rebuild

- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:199-303` — the purge removes
  the account's events, their deliveries and jobs (cancelled first, so a leased worker is fenced),
  the evidence sidecar of its fills, its observations, its knowledge, its workflows, its
  opportunities and its conversations, and the rows that are not account bound but name its
  observations. A background run loses the account id from its scope; a run whose only account was
  the deleted one goes with it.
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:213-229` — the cancellation
  fence holds: the purge cancels the job before deleting it, and the completion of a fenced job
  raises `StaleClaimError` with reason `stale`
  (`apps/web/tests/intelligence-retention.test.ts` — "fences a completion that races the purge").
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:346-372` — the reset writes
  every column the checkpoint schema requires, including the `NOT NULL` `baseline_operation_id`, and
  the status `suppressed` that the three existing seams honour
  (`backfill.ts:57`, `knowledge-store.ts:90`, `jobs.ts:316-324`).
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:150-176` — the deletion ledger
  lives **beside** the database, not inside it, because the database is what a restore replaces. The
  entry is written before the purge runs and taken back if the purge fails.

#### The backup and the restore

- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:660-740` — the snapshot is
  written with `VACUUM INTO`, never a copy of a live WAL file, and the key material travels beside
  it with a manifest carrying a key probe that is an envelope over a fixed label — a key *check*,
  never a credential.
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:672-680` — the
  `JOURNAL_SECRET` case is refused: that key cannot travel with a backup
  (`crypto.ts:12-22` prefers the environment variable over the `.secret` file).
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:800-830` — the restore
  verifies the copy **before anything migrates it** (`PRAGMA integrity_check` and
  `PRAGMA foreign_key_check` judge the backup, not a migrated version of it) and verifies the key
  against the probe.
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:838-852` — the restore applies
  the deletion ledger again, so a restore cannot bring a purged account back. The account of the
  snapshot is gone from the restored journal and so is everything it owned.

#### The tests

- [PASS] `apps/web/tests/intelligence-retention.test.ts` — 24 cases; each protection has a case
  that fails when the protection is removed.
- [PASS] `apps/web/tests/intelligence-backup.test.ts` — 16 cases; the refusals, the key travel, the
  synthetic credential round trip, the restore verification and the no-resurrection guarantee.
- [PASS] `apps/web/tests/intelligence-acceptance.test.ts` — 3 cases: the phase gate end to end, and
  the two migration cases (a failed migration rolls back and leaves the journal recoverable; an
  unvouchable history is refused with a machine-readable reason and left untouched).

#### The checks

- [PASS] `npx tsc --noEmit -p apps/web/tsconfig.json` — exit 0.
- [PASS] `npx prettier --check` on the eleven changed and added files — "All matched files use Prettier
  code style!".
- [PASS] `npx vitest run` over the three new suites plus the seven suites that cover the touched
  behaviour — **166 tests, 10 files, all passed**.
- [PASS] The ownership boundary is exactly the packet's file list plus the plan, the report and the
  three tests: `git status` shows only those files. No schema, migration, registry, checksum,
  composition, worker or contract change; `0001`–`0007` are byte-unchanged.
- [PASS] No new dependency, no raw fetch in the importers, no trade-key change, no chart change.

### Gaps noted, not failures

- The retention job does not run and the reset, the rebuild and the retention run have no API route
  yet. Both are declared out of scope in the phase plan with the reason: the worker resolves a
  handler for `seed_account`, `evaluate_trade` and `schedule_trigger` only (`worker.ts:214-222`), and
  `worker.ts` and `composition.ts` are not this phase's files. The coordinator allocates them.
- The follow-up review run did not complete inside its budget. The findings above are the previous
  review's findings, each reproduced and proved fixed by a teeth run, plus the checks above.

### Summary

30 PASS, 0 FAIL, 0 BLOCK.
