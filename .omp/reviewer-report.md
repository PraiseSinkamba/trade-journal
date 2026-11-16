## Verdict: PASS

## Reviewer Report — Phase 20 repair (retention, backup/restore, deletion, operations)

Contract: `docs/orchestration/ai-native-journal/tasks/T-020.md`. Plan of record:
`docs/superpowers/plans/ai-native-journal/phase-20.md`.

This report covers the repair of the committed candidate: the coordinator granted three areas the
phase had declared out of scope (`infrastructure/worker.ts`, `intelligence/composition.ts` and
`app/api/intelligence/`), and a follow-up review of the candidate found nine defects. Every defect
is fixed on the final tree and proved by a test that can fail.

### PASS / FAIL

PASS — every finding of the follow-up review is resolved, and the granted repair is wired and
proved end to end.

### The granted repair

- [PASS] `apps/web/src/server/intelligence/infrastructure/worker.ts` — the job-kind resolver now
  answers for a `retention` job (handler `retention`/`1`) and for a `workflow_effect` job (handler
  `workflow-effect`/`1`, the id the workflow engine declares). Neither payload carries a handler id
  of its own, so before the repair both kinds resolved to no handler and the worker failed them
  terminally as `unhandled_job`.
- [PASS] `apps/web/src/server/intelligence/composition.ts` — the handler registry carries the
  retention handler (the transport and the diagnostics class at the cutoff the payload names, the
  knowledge class at its own 90-day window, the whole run inside one bound of 500 rows) and the
  workflow engine's own effect handler, so a deferred workflow resumes instead of dead-lettering.
  The default journal has one workflow engine, not two.
- [PASS] `apps/web/src/app/api/intelligence/retention/` — four routes: the run (`POST`), the state
  (`GET`), the account reset (`POST …/reset`) and the rebuild request (`POST …/rebuild`). Each
  mutating route needs a session (401), a same-origin request (403 `origin_denied`), a body that
  parses (400 `invalid_request`) and an account the journal knows (403 `scope_denied`), and an
  unexpected failure is sanitised.
- [PASS] The proof is end to end: `apps/web/tests/intelligence-retention.test.ts` drives a retention
  job through the composed worker and a deferred workflow through the same worker
  ("prunes through the worker's retention handler", "resumes through the worker's workflow effect
  handler"), and `apps/web/tests/intelligence-acceptance.test.ts` drives the four routes.

### The follow-up review's nine findings, resolved

- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts` — **the prune deleted an
  event that was never dispatched — FIXED.** The candidate query requires
  `isNotNull(domainOutbox.dispatchedAt)`, and an event with no delivery row at all is treated as
  unfinished work rather than as a vacuously finished subtree. Disabling the worker preserves the
  backlog the contract review §6 protects. Proved by a break: removing either guard fails
  "keeps an event the dispatcher never stamped" and "keeps a dispatched event that has no delivery
  row", and the undispatched case fails "keeps an event that was never dispatched".
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts` — **a second
  reset-and-rebuild cycle enqueued nothing — FIXED.** The rebuild re-arms the seed job the way the
  replay seam re-arms a job (status `pending`, attempts `0`, availableAt now, owner null, fence
  `+1`, lease cleared), and it re-arms **only a job that is no longer live**: a rebuild asked for
  twice while the seed is still queued stays one job, and a running seed is not fenced. Proved by a
  break: skipping the re-arm fails "re-arms the seed job when the account is rebuilt again".
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts` — **the restore left the
  fills and the trades of a deleted account behind — FIXED.** The deleted branch now removes the
  account's trades and its executions through the same helper the live delete path uses; neither
  table has a foreign key to the account, so nothing else takes them. Proved by a break: removing
  the two deletes fails "takes the fills and the trades of a deleted account out of the restored
  journal".
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts` — **the copied key file was
  world-readable — FIXED.** The copy is written with `mode: 0o600`, the mode the live key file uses
  (`crypto.ts:19`). Covered by "copies the key material so only its owner can read it"; the mode
  assertion applies where the platform applies it (POSIX), and the Windows branch asserts that the
  copy carries the same key material.
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts` — **the restore reported a
  verified key it never verified — FIXED.** `keyVerified` starts `false` and becomes `true` only
  when the manifest's probe opens under the restored key. The backup refuses a source whose
  encrypted material no key can travel with, and keeps the refusal for a key that lives in
  `JOURNAL_SECRET`. Proved by a break: defaulting `keyVerified` to `true` fails "reports a key as
  verified only when it verified one"; the refusals are covered by "refuses a backup when the key
  comes from the environment" and "refuses a backup of encrypted material no key can travel with";
  the unverified answer by "reports a key as unverified when the backup carries none".
- [PASS] `apps/web/src/server/intelligence/infrastructure/knowledge-store.ts` — **a knowledge record
  invalidated by a source deletion was never pruned — FIXED.** The newest-of-subject protection now
  keeps a **live** record (`active`, `stale`, `pending`); a superseded or invalidated record is
  finished knowledge and falls to the 90-day window. Proved by a break: restoring the old
  protection fails "removes a knowledge record a source deletion invalidated", and the live record
  still survives ("keeps a live knowledge record that is the newest of its subject").
- [PASS] `apps/web/src/server/intelligence/composition.ts` and the three phase test files — **the
  format check failed on three touched files — FIXED.** `prettier --write` ran over every touched
  path, and `prettier --check` is clean on all of them.
- [PASS] `docs/superpowers/reports/ai-native-journal-phase-20.md` — **the report contradicted the
  tree — FIXED.** The report records the granted repair and its three areas, the case counts of the
  final tree (32 / 23 / 10), the commands with their exit codes and runtimes, and the nine findings
  with their resolutions. The section that listed the retention handler, the operator routes and the
  deferred resume as later inputs now says they are delivered.
- [PASS] `docs/intelligence-operations.md` — **the runbook applied the live purge ledger after the
  restore — FIXED.** The promote step copies the live `purge-ledger.json` into the restore
  destination **before** the restore runs, because the restore applies the ledger it finds there.
  The runbook names the exact route or command for the retention run, the reset and the rebuild,
  and its dead-letter advice now distinguishes a dead letter that belongs to a committed event from
  a workflow effect, which the worker resolves itself.

### The contracts, re-checked on the repaired tree

- [PASS] `pruneIntelligence(before, limit): { removed: number }`,
  `purgeSupersededKnowledge(before, limit): { removed: number }` and
  `purgeAccountIntelligence(tx, accountId): void` keep their authoritative signatures; the backup
  takes an explicit source, an explicit destination and an explicit quiescence acknowledgement.
- [PASS] `apps/web/src/server/intelligence/infrastructure/experience-store.ts` — the live reference
  index still uses the real status sets and the real id spaces: workflow
  `running|waiting_for_user|scheduled`, opportunity `pending|eligible|suppressed`, conversation
  `open`, and the four `dedup_key` namespaces.
- [PASS] The compact dedup keys survive: the delivery goes only with its event, the run row is never
  deleted, an opportunity is never deleted by the prune, and the seed job's key is re-armed rather
  than reused.
- [PASS] The cancellation fence holds: the purge cancels the job before deleting it, and a fenced
  completion raises `StaleClaimError`.
- [PASS] The ownership boundary is the packet's file list plus the plan, the report and the three
  tests, **plus the three areas the coordinator granted after the candidate** — recorded in the
  phase plan under **The granted repair**. No schema, migration, registry or checksum change;
  `0001`–`0007` are byte-unchanged; no new dependency.

### The checks

- [PASS] `pnpm exec vitest run apps/web/tests/intelligence-retention.test.ts
  apps/web/tests/intelligence-backup.test.ts apps/web/tests/intelligence-acceptance.test.ts` —
  **65 tests, 3 files, all passed**, exit 0, 18 s (32 retention, 23 backup, 10 acceptance).
- [PASS] `pnpm --filter web typecheck` — exit 0, 116 s.
- [PASS] `npx prettier --check` over every touched path — clean.
- [PASS] The reviewer's regression runs over the eight related suites — 134 tests, 8 files, passed.
- [PASS] No new dependency, no raw fetch in the importers, no trade-key change, no chart change.

### Gaps noted, not failures

- The persisted home for an AI-assisted insight remains Phase 19's open item, and the benchmark, the
  full CI sequence, the Docker and Windows smoke and the package audit are Phase 21's release half.
- The key file's mode is a POSIX permission; Node ignores it on Windows, so the test asserts the
  permission only where the platform applies it.

### Summary

22 PASS, 0 FAIL, 0 BLOCK.
