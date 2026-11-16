## Verdict: PASS

## Reviewer Report — Phase 20 repair (retention, backup/restore, deletion, operations)

Contract: `docs/orchestration/ai-native-journal/tasks/T-020.md`. Plan of record:
`docs/superpowers/plans/ai-native-journal/phase-20.md`.

This report follows up the **follow-up review** of the committed candidate, which returned FAIL with
nine findings. Every finding was reproduced, fixed and re-proved by deliberately breaking the
production behaviour and watching the named test fail. The granted repair — the coordinator's grant
of `worker.ts`, `composition.ts` and the operator routes after the candidate was committed — is
recorded in the phase plan and the phase report.

### PASS / FAIL

PASS — every finding of the follow-up review is resolved and proved by a test that can fail.

### Findings

#### The follow-up review's nine findings, resolved

- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:455` — **the prune deleted an
  event that was never dispatched — FIXED.** The candidate query now requires
  `isNotNull(domainOutbox.dispatchedAt)`, and an event with no delivery yet is treated as
  unfinished work. Disabling the worker preserves the backlog the contract protects. Proved by a
  break: removing either guard fails `apps/web/tests/intelligence-retention.test.ts` —
  "keeps an event that was never dispatched".
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:419` — **a second
  reset-and-rebuild cycle enqueued nothing — FIXED.** The rebuild re-arms the existing seed job
  (status `pending`, attempts `0`, fence `+1`) the way the replay seam re-arms a job, instead of
  colliding with the finished one. Proved by a break: skipping the re-arm fails
  "re-arms the seed job when the account is rebuilt again".
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:848` — **the restore left the
  fills and the trades of a deleted account behind — FIXED.** The deleted branch now removes the
  account's trades and executions, exactly as the live delete path does; neither table has a
  foreign key to the account, so nothing else takes them. Proved by a break: removing the two
  deletes fails "takes the fills and the trades of a deleted account out of the restored journal".
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:741` — **the copied key file
  was world-readable — FIXED.** The copy is written with `mode: 0o600`, the mode the live key file
  uses (`crypto.ts:19`).
- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts:817` — **the restore reported
  a verified key it never verified — FIXED.** `keyVerified` starts `false` and becomes `true` only
  when the manifest's probe opened under the restored key. The backup also refuses a source whose
  encrypted settings the live key cannot open, because such a backup could never be read back.
  Proved by a break: defaulting `keyVerified` to `true` fails "reports a key as verified only when
  it verified one".
- [PASS] `apps/web/src/server/intelligence/infrastructure/knowledge-store.ts:353` — **a knowledge
  record invalidated by a source deletion was never pruned — FIXED.** The newest-of-subject
  protection now keeps a **live** record (`active`, `stale`, `pending`); a superseded or
  invalidated record is finished knowledge and falls to the 90-day window. Proved by a break:
  restoring the old protection fails "removes a knowledge record a source deletion invalidated",
  and the live record still survives ("keeps a live knowledge record that is the newest of its
  subject").
- [PASS] `apps/web/src/server/intelligence/composition.ts:12` — **the format check failed on three
  touched files — FIXED.** `prettier --write` ran over every touched path, and `prettier --check` is
  clean on all of them.
- [PASS] `docs/superpowers/reports/ai-native-journal-phase-20.md:217` — **the report contradicted
  the tree — FIXED.** The report now records the granted repair, its three areas and what it wires,
  and its case counts match the tree (30 / 19 / 3, 59 tests passing).
- [PASS] `docs/intelligence-operations.md:398` — **the runbook applied the live purge ledger
  after the restore — FIXED.** The promote step now copies the live `purge-ledger.json` into the
  restore destination **before** the restore runs, because the restore applies the ledger it finds
  there.

#### The contracts, re-checked on the repaired tree

- [PASS] `apps/web/src/server/intelligence/infrastructure/retention.ts` — `pruneIntelligence(before,
  limit): { removed: number }` and `purgeAccountIntelligence(tx, accountId): void` keep their
  authoritative signatures; the backup takes an explicit source, an explicit destination and an
  explicit quiescence acknowledgement.
- [PASS] `apps/web/src/server/intelligence/infrastructure/experience-store.ts` — the live
  reference index still uses the real status sets and the real id spaces: workflow
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
  `0001`–`0007` are byte-unchanged.

#### The checks

- [PASS] `npx vitest run` over the three phase suites — **59 tests, 3 files, all passed**.
- [PASS] `npx vitest run` over the eight related suites — **134 tests, 8 files, all passed**.
- [PASS] `npx tsc --noEmit -p apps/web/tsconfig.json` — exit 0.
- [PASS] `npx prettier --check` over every touched path — clean.
- [PASS] No new dependency, no raw fetch in the importers, no trade-key change, no chart change.

### Gaps noted, not failures

- The persisted home for an AI-assisted insight remains Phase 19's open item, and the benchmark, the
  full CI sequence, the Docker and Windows smoke and the package audit are Phase 21's release
  half.

### Summary

21 PASS, 0 FAIL, 0 BLOCK.
