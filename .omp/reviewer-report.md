## Verdict: PASS

## Reviewer Report — Phase 20 repair (the operator entry point)

Contract: `docs/orchestration/ai-native-journal/tasks/T-020.md`. Plan of record:
`docs/superpowers/plans/ai-native-journal/phase-20.md`.

This report covers the granted repair of the committed candidate: the coordinator's review found
that `backupJournal` and `restoreJournal` were **reachable by nobody** — no route, no script and no
package script called them — while the runbook described the backup and the restore as procedures
an operator performs, and `docs/database-migrations.md` named "the journal's own backup command",
which did not exist. Every finding of that review and of the follow-up review of this repair is
fixed on the final tree.

### PASS / FAIL

PASS — the operator can now run the backup and the restore, and the runbook is true end to end.

### The granted repair

- [PASS] `apps/web/scripts/intelligence-operations.mjs` (new) — the operator command. A `backup`
  operation and a `restore` operation, each of which calls the shipped `backupJournal` and
  `restoreJournal` **unchanged**. Nothing is reimplemented: no backup, no restore, no checksum
  verification and no purge-ledger handling is duplicated. The module is bundled with the same
  toolchain the worker bundle uses (`build-worker.mjs` resolves esbuild through `tsup`), and the
  bundle is refused if it pulls in `next`, `react` or `src/app`.
- [PASS] `apps/web/package.json` (extended) — one script entry, `intelligence:operations`, and
  nothing else. No dependency, no version, no other script touched.
- [PASS] The entry point runs **from the repository root** with the repo's own toolchain:
  `pnpm --filter web intelligence:operations backup --source <dir> --destination <dir>
  --acknowledge-quiescence`, and the same command with `restore`. Both invocations were run from
  the repository root against disposable journals.
- [PASS] **Nothing is defaulted.** The operator types the source, the destination and the
  quiescence acknowledgement (`--acknowledge-quiescence`). An omitted flag is a refusal, not a
  quiet default.
- [PASS] **Every shipped refusal is reachable through the entry point**, each with the shipped
  message: a relative path, a missing source or destination, a source and a destination that are
  the same, a missing quiescence acknowledgement, a journal that still holds a worker lease, a
  source that does not hold the journal's own key, a destination that already holds a journal, and
  a source that does not hold a backup manifest.
- [PASS] The command adds two preconditions of its own, and the script header says so rather than
  claiming every refusal is shipped: `JOURNAL_DATA_DIR` must name the journal the operator owns,
  because that is where the key that travels with the backup comes from.
- [PASS] **The command never opens the journal it copies.** The bundled module opens a journal when
  it is evaluated, so the command loads it against a scratch directory and points
  `JOURNAL_DATA_DIR` at the operator's journal only for the call itself. A journal too broken to
  open therefore does not stop a restore — the case the rollback table tells an operator to
  recover from.
- [PASS] The proof is end to end: `apps/web/tests/intelligence-backup.test.ts` drives the command
  as a child process — it backs a journal up, it refuses a relative path, it refuses a missing
  acknowledgement, it refuses a destination that already holds a journal, it carries the key beside
  the snapshot and nowhere else, it leaves the journal it copies untouched, and it restores a backup
  into scratch storage.

### The follow-up review's findings, resolved

- [PASS] **BLOCK — the documented quiescence procedure could not work — FIXED.** The worker lease
  row outlives the stopped worker: nothing deletes it, and it stays valid for up to
  `WORKER_LEASE_MS` (30 seconds), so a backup run immediately after stopping the supervisor was
  refused with "The journal still holds a worker lease". Both documents now say to wait until
  `intelligence_worker_lease.lease_until` is in the past and run it again, and never to delete the
  row — a live lease is the journal's own record of who was writing to it.
- [PASS] **FAIL — the migration guide's command list named a command that could not succeed —
  FIXED.** The `pnpm --filter web intelligence:operations backup` line carried no
  `JOURNAL_DATA_DIR`, and the command refuses without it. The list now carries it, and says that
  the restore does not need it.
- [PASS] The six smaller corrections — the command's own preconditions are distinguished from the
  shipped refusals; the supervisor command the operator stops is named (`pnpm start` in production,
  `pnpm --filter web dev:journal` in development, which starts no worker unless
  `--worker enabled`); the restore's steps follow the order the code performs them and the last
  verification judges the migrated journal; the backup's refusal list no longer reads as
  exhaustive; the destination is described as created when absent and refused when it already holds
  a journal; and the lease check is said to read the source journal's own database.
- [PASS] The manual copy of a whole data directory is now described accurately: it carries no
  manifest, so the restore command refuses it, and the WAL warning is kept.

### The runbook, re-read against the shipped code

- [PASS] The worker is forked by the **journal supervisor**, not by the web process
  (`run-journal.mjs` forks the http child and the worker child; `http-child.mjs` starts no
  consumer).
- [PASS] The retention job's payload carries the `type` the worker's payload schema discriminates
  on (`contracts/jobs.ts` is a strict discriminated union), so the `INSERT` the runbook shows
  produces a job the worker can read.
- [PASS] The **prune**, not the purge, is what leaves the delivery, run and opportunity rows
  alone; the runbook says so.
- [PASS] The `curl` example carries the `journal_session` cookie the gate requires, and says that
  a journal without a password needs none.
- [PASS] The account deletion names `DELETE /api/accounts/{id}` and the clear history names
  `POST /api/accounts/{id}/actions` with `{"action": "clear"}`.
- [PASS] The deletion list names the background runs scoped to the account and what happens to a
  run that no longer has an account.
- [PASS] The replay seam and the job cancel say plainly that **no operator surface calls them
  yet**, rather than implying they can be performed.
- [PASS] Both documents name the **same** entry point with the **same** exact invocation.

### The checks

- [PASS] `pnpm exec vitest run apps/web/tests/intelligence-retention.test.ts
  apps/web/tests/intelligence-backup.test.ts apps/web/tests/intelligence-acceptance.test.ts` —
  **73 tests, 3 files, all passed**, exit 0, 21 s (32 retention, 31 backup, 10 acceptance).
- [PASS] `pnpm --filter web typecheck` — exit 0, 96 s.
- [PASS] `npx prettier --check` over every touched path — clean.
- [PASS] No new dependency, no schema change, no migration, no change outside the granted files:
  the script, one package script entry, the backup suite, the two documents, the phase plan and
  the phase report. `0001`–`0007` are byte-unchanged.

### Gaps noted, not failures

- The replay seam and the job cancel still have no operator surface. The runbook says so plainly
  and the phase report records them as a next-milestone item.
- The persisted home for an AI-assisted insight remains Phase 19's open item, and the benchmark, the
  full CI sequence, the Docker and Windows smoke and the package audit are Phase 21's release half.

### Summary

24 PASS, 0 FAIL, 0 BLOCK.
