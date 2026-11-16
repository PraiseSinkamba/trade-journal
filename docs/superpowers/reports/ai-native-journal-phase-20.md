# Phase 20 — Retention, backup/restore, deletion and operations documentation

Phase guide row 20 · detailed-plan Task 13 (storage/operations portion) · milestone M6 ·
schema allocation: **None**

|                       |                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                | `codex/ai-native-journal-p20` (child of the feature worktree)                                                                                |
| Base                  | `036fd3f83e63018d38160dd5138949d5aa7ce86d` (verified feature HEAD)                                                                           |
| Plan commit           | _docs: plan the retention, backup and operations work_                                                                                       |
| Implementation commit | _test: harden intelligence recovery packaging and operations_                                                                                |
| Repair commits        | _fix: keep the backlog, the rebuild and the deleted account safe_ · _fix: keep a queued seed job queued and cover the backup's key refusals_ |
| Migrations            | none. `0001`–`0007` are byte-unchanged; no schema, registry or checksum file was touched.                                                    |

## What was built

The journal can now forget what is finished, take its intelligence with it when an account goes,
and hand the operator a backup that can be read again — with a runbook that says what to do.

### The retention layer

- `apps/web/src/server/intelligence/infrastructure/retention.ts` (extended) — the prune, the purge,
  the deletion ledger, the backup and the restore.
  - `pruneIntelligence(before, limit)` prunes the **transport** class (an outbox event whose whole
    subtree is finished) and the **diagnostics** class (the diagnostic payload of a finished
    background run). The bound is strict: a subtree that does not fit in the remaining budget is
    left whole, so one call never exceeds the number of rows it was given — and the prune carries on
    with a cheaper subtree instead of ending the call. An event the dispatcher never handed to a
    handler is still the backlog, so it is never a candidate.
  - `pruneSupersededKnowledge(before, limit)` prunes the **knowledge** class: the superseded and
    invalidated records and observations nobody names. The newest version of a subject survives the
    window only while it is still live, so a record a source deletion invalidated — which raises no
    successor — falls to the 90-day rule instead of surviving forever.
  - `purgeAccountIntelligence(tx, accountId)` takes the account's whole intelligence with it: its
    outbox events, their deliveries and jobs (cancelled first, so a leased worker is fenced), the
    evidence sidecar of its fills, its observations, its knowledge, its workflows, its opportunities
    and its conversations — including the rows that are not account bound but talk about one of its
    observations. A background run of the account loses the account id from its scope; a run whose
    only account was the deleted one is deleted with its reservations, because a run with no account
    left to read is not a scope.
  - `resetAccountIntelligenceInTx` purges the intelligence of an account that **survives** and writes
    its seed checkpoint as `suppressed`, so the historical seed does not re-derive what was deleted
    and the replay seam refuses the account.
  - `requestAccountIntelligenceRebuildInTx` moves the checkpoint back to `pending`, so the seed runs
    again.
  - `backupJournal` writes a consistent snapshot with SQLite's `VACUUM INTO` — never a copy of a live
    WAL file — copies the key material beside it, and writes a manifest carrying a **key probe**: an
    envelope encrypted under the journal's own key over a fixed label. The probe is a key _check_, not
    a credential.
  - `restoreJournal` restores into scratch storage, verifies the copy **before anything migrates
    it** (`PRAGMA integrity_check` and `PRAGMA foreign_key_check` judge the backup, not a migrated
    version of it), verifies the key against the probe, and re-applies the deletion ledger.
- `apps/web/src/server/intelligence/infrastructure/experience-store.ts` (extended) — the live
  reference index the prune reads: the observation ids and the projection revision ids that a live
  workflow, a live opportunity, an open conversation or a dismissal names.
- `apps/web/src/server/intelligence/infrastructure/knowledge-store.ts` (extended) — the knowledge and
  observation prunes.
- `apps/web/src/server/intelligence/infrastructure/jobs.ts` (extended) — the terminal job prune of an
  event's subtree.
- `apps/web/src/server/trading/commands.ts` (extended) — the account purge records the deletion in
  the ledger **before** the purge runs and takes the entry back if the purge fails; `clearAccount`
  invalidates the evidence of the fills it deletes (`timingQuality` becomes `unknown`) instead of
  leaving a source-quality claim for a fill that no longer exists.

### The deletion ledger

The ledger is a file `purge-ledger.json` **beside** the database, holding the purged account ids and
the kind of purge (`deleted` or `reset`). It lives beside the database rather than inside it
because the database is what a restore replaces: a ledger inside the database would be rolled back
with it, and the purged account would come back. The entry is written before the purge runs, so a
journal that was purged is never restored without the ledger that says so.

### The documentation

- `docs/intelligence-operations.md` (new) — the runbook: the worker and its states, the backlog, the
  dead letter, an unsupported event schema, lease recovery, the no-provider behaviour, the opt-in
  budgets, the retention windows, the deletion and reset, the backup, the restore and the rollback.
- `docs/database-migrations.md` (extended) — what each of `0001`–`0007` means to an operator, the
  backup procedure before an upgrade, and the pointer to the runbook.

## The tests

| File                                             | Cases | What it proves                                                                                                                                               |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/tests/intelligence-retention.test.ts`  | 32    | the reference-safe prune, the compact dedup keys, the bound, the windows, the purge, the reset and the rebuild, the cancellation fence, the knowledge window |
| `apps/web/tests/intelligence-backup.test.ts`     | 23    | the explicit inputs, the quiescence check, the key travel, the key verification, the restore verification, no resurrection                                   |
| `apps/web/tests/intelligence-acceptance.test.ts` | 10    | the phase gate end to end, the two migration failure cases, and the operator routes                                                                          |

### The proof of teeth

Every protection was proved by breaking it and watching the test fail. Each row below is a
deliberate break of the production behaviour, the test that failed, and the restoration.

| What was broken                                                       | The test that failed                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| a live workflow no longer protects its observation                    | `keeps an observation a live workflow names`                                      |
| a live opportunity no longer protects its observation                 | `keeps an observation a live opportunity names`                                   |
| an open conversation no longer protects its observation               | `keeps an observation an open conversation names`                                 |
| a dismissal of a revision no longer protects the observation it names | `keeps an observation a dismissed revision names`                                 |
| the failed-delivery protection was narrowed to pending only           | `keeps the event of a failed delivery, with its diagnostic`                       |
| the job liveness check was removed                                    | `keeps the event of a running job`                                                |
| a failed run's diagnostics were emptied                               | `keeps a failed run with its diagnostics`                                         |
| the purge left the rows that are not account bound                    | `removes the rows that are not account bound but talk about its observations`     |
| the reset wrote `completed` instead of `suppressed`                   | `purges the intelligence and suppresses the seed`                                 |
| the purge kept the deleted account in a run's scope                   | `takes the account id out of the scope of its background runs`                    |
| the backup stopped checking the worker lease                          | `refuses a journal that still holds a worker lease`                               |
| the restore stopped applying the ledger                               | `keeps a purged account out of the restored journal`, and the phase gate          |
| the knowledge prune stopped reading the evidence a live record cites  | `keeps a knowledge record a live workflow cites`                                  |
| the rebuild stopped enqueueing the seed job                           | `enqueues the seed job when a rebuild is requested`                               |
| the restore's deleted branch stopped running the purge                | `takes the whole intelligence of a deleted account out of the restored journal`   |
| the backup accepted a source with a foreign key                       | `refuses a source that does not hold the journal's own key`                       |
| the prune deleted an event that was never dispatched                  | `keeps an event that was never dispatched`                                        |
| the prune deleted an event the dispatcher never stamped               | `keeps an event the dispatcher never stamped`                                     |
| the prune deleted a dispatched event that never reached a handler     | `keeps a dispatched event that has no delivery row`                               |
| the rebuild enqueued nothing on a second cycle                        | `re-arms the seed job when the account is rebuilt again`                          |
| the restore left the fills and the trades of a deleted account        | `takes the fills and the trades of a deleted account out of the restored journal` |
| the restore reported a verified key it never verified                 | `reports a key as verified only when it verified one`                             |
| a restore reported a verified key when it verified none               | `reports a key as unverified when the backup carries none`                        |
| the backup copied the key file world-readable                         | `copies the key material so only its owner can read it`                           |
| the backup accepted a journal whose key lives in the environment      | `refuses a backup when the key comes from the environment`                        |
| the backup copied encrypted material no key can travel with           | `refuses a backup of encrypted material no key can travel with`                   |
| the knowledge prune kept an invalidated record forever                | `removes a knowledge record a source deletion invalidated`                        |

Two test bugs were found by the teeth work and fixed: several "keeps" cases used an event newer
than the cutoff, so the prune never considered it, and the no-resurrection case purged the account
_before_ the backup, so the restore never had to apply the ledger. Both are corrected: the events
are now older than the cutoff, and the ledger is what removes the account from the restored copy.

### The commands that were run

Every command below was run against the final tree of this phase, on Node v24.22.3 and pnpm 11.0.8.

| Command                                                                                                                                                                                                                                                                                                                          | Exit | Runtime | Result                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- | ------------------------ |
| `pnpm exec vitest run apps/web/tests/intelligence-retention.test.ts apps/web/tests/intelligence-backup.test.ts apps/web/tests/intelligence-acceptance.test.ts`                                                                                                                                                                   | 0    | 18 s    | **65 passed** (3 files)  |
| `pnpm --filter web typecheck`                                                                                                                                                                                                                                                                                                    | 0    | 116 s   | no type errors           |
| `npx prettier --check` on every touched path                                                                                                                                                                                                                                                                                     | 0    | 8 s     | clean                    |
| `npx vitest run apps/web/tests/trade-mutation-commands.test.ts apps/web/tests/intelligence-observations.test.ts apps/web/tests/intelligence-slice-a.test.ts apps/web/tests/intelligence-slice-b.test.ts apps/web/tests/intelligence-jobs.test.ts apps/web/tests/intelligence-migrations.test.ts` (the reviewer's regression run) | 0    | —       | **96 passed** (6 files)  |
| `npx vitest run apps/web/tests/intelligence-worker.test.ts apps/web/tests/intelligence-workflows.test.ts apps/web/tests/intelligence-knowledge-revisions.test.ts apps/web/tests/intelligence-engagement.test.ts` (the reviewer's regression run)                                                                                 | 0    | —       | **100 passed** (4 files) |

The 65 cases are 32 retention, 23 backup and 10 acceptance. The whole-project `pnpm test` and the
destination gate are the coordinator's.

## The review and its findings

Two plan reviews and one implementation review, all against the committed phase plan.

**Plan review 1** returned FAIL with 17 findings. The plan was rewritten against every one of
them: the failed-delivery cascade, the unscoped job clause and the unstated prune order, the
undefined live sets and id spaces, the knowledge class, the account's background runs, the
authoritative signatures, the `purgeAccountIntelligence` binding, the `JOURNAL_SECRET` case, the
synthetic-credential restore check, the split migration acceptance cases, the deferrals without an
owner, the clear-history evidence, the checkpoint delete-versus-suppress contradiction, the quiescence
definition, the undefined restore destination, the ownership table and the claims without an
asserting test.

**Plan review 2** returned FAIL again with 8 blocking findings, all real: the restore had no
no-resurrection mechanism, the ledger conflated deleted and reset accounts, the key probe was not
computable inside the ownership boundary, the reference graph omitted conversations and the
`dedup_key` namespaces, the retention job could never run, the purge emptied a run's scope in a way
the scope schema forbids, "finished" named no terminal set, and the migration acceptance case
contradicted the runner. The plan was rewritten again, and the implementation followed the corrected
plan: the restore deletes the account row of every `deleted` entry, the ledger records the kind per
account, the key probe is an `encryptJson` envelope over a fixed label, the live sets name the
conversation subject and the four `dedup_key` namespaces, the retention job is documented as
needing the coordinator's allocation of `worker.ts` and `composition.ts`, the purge keeps a run's
scope valid, and every class names its terminal set.

**Implementation review** returned FAIL with one P1 and two P2 findings, all real and all fixed:

- **P1 — the rebuild never re-seeded the account.** `requestAccountIntelligenceRebuildInTx` moved
  the checkpoint back to `pending` and nothing enqueued the `seed_account` job, so the account sat
  at a pending checkpoint with no observations — the opposite of what a rebuild asks for. The
  rebuild now enqueues the seed job with the key the historical seed uses for its own continuation,
  so a rebuild asked for twice is one job.
- **P2 — the backup could seal the key probe under the wrong key.** The probe and the copied
  `.secret` both came from the backup source, while the journal's live key comes from the data
  directory. Point the backup at a copy with a stale `.secret` and it was self-consistent: the
  probe verified against the copied key, the restore reported `keyVerified: true`, and the restored
  journal could not read its own encrypted settings. The backup now seals the probe under the
  journal's **live** key and refuses a source that does not hold it.
- **P2 — a restore of a deleted account left part of the deletion behind.** The `deleted` branch
  deleted the account row only, so the deleted account's committed event stream, its deliveries and
  jobs and its unbound rows came back. The restore now runs **the same purge the delete path runs**
  before it deletes the account row.

A **follow-up review** of the committed candidate found nine more defects, all real and all fixed:
the prune deleted an event that was **never dispatched** (the backlog the contract protects); a
**second reset-and-rebuild cycle enqueued nothing**, because the seed job's key collided with the
finished one; the restore left the **fills and the trades** of a deleted account behind, because
neither table has a foreign key to the account; the backup wrote the copied key file
**world-readable**; the restore reported a **verified key it never verified**; a knowledge record
**invalidated by a source deletion** was never pruned, because the newest-of-subject protection
kept it forever; the report contradicted the tree and the granted repair; and the runbook placed
the live purge ledger **after** the restore that applies it.

The review's four notes were addressed too: the diagnostics prune no longer counts a run whose
diagnostics were already empty (and no longer rewrites `updatedAt` to the cutoff, which made it a
candidate again on every later prune); a rebuild forgets only a **reset** in the ledger, so a
deleted account keeps its protection; the restored journal is verified once more after the ledger
was applied; and the manifest is checked rather than trusted, so a manifest without a version or
without a database is refused with a clear reason instead of a crash.

The nine findings were closed in **two** commits. The first carried the behavioural fixes; the
second carried the **refinements and the missing coverage** the first left behind: a rebuild now
re-arms only a seed job that is no longer live, so a rebuild asked for twice while the seed is
still queued stays one job and a running seed is not fenced; the prune carries on with a cheaper
subtree instead of ending the run; the restore removes a deleted account's fills through the same
helper the delete path uses; and six new cases close the gaps the review named but no test covered
— the copied key file's permissions, the refusal when the key comes from the environment, the
refusal of a backup whose encrypted material no key can travel with, an unverified key, and the two
backlog cases of the prune.

Two more test bugs were found while proving the teeth of these fixes: the restore test never called
`restoreJournal` (it opened a fresh directory, so it asserted nothing), and the rebuild test
asserted only the checkpoint status. Both now exercise the behaviour they claim.

## Deviations from the plan

1. **The deletion ledger is a file, not a settings row.** The plan put the ledger in the settings
   table _and_ mirrored it to a file. The existing contract test `trade-mutation-commands.test.ts`
   asserts that the settings table is empty after an account deletion, and the settings table is a
   per-account store, not a journal-level one. The ledger is therefore file-only: it is the half
   that survives a restore anyway, and the settings table stays empty.
2. **The ledger entry is written before the purge, not after.** The plan wrote it after the
   transaction committed. Writing it before closes the window in which a crash between the purge and
   the ledger write would let a restore bring the account back. A purge that then fails takes its
   entry back.
3. **The prune's bound counts rows, not subtrees.** The plan did not say what the bound counts. It
   counts every row the call removes — the jobs of a subtree and the event itself — so the call
   never exceeds the number of rows it was given.
4. **The restore applies the ledger from the manifest and the destination directory.** The plan also
   mentioned the restored journal's own ledger file; that file is the source's, carried by the
   snapshot's directory, and the manifest already carries it.
5. **The knowledge prune protects a record by what cites it, not by its own id.** The first
   implementation compared a knowledge record's own id against the live sets, which hold observation
   and revision ids — the comparison could never match, so a record a live workflow cited could be
   pruned. The prune now reads the record's subject and its evidence list, which is what the live
   records actually name.
6. **The rebuild enqueues the seed job.** The plan said a rebuild moves the checkpoint back to
   `pending` "so the seed runs again", but the seed runs from a `seed_account` job and nothing
   enqueued one. The rebuild now enqueues it, and the job key is the one the historical seed uses
   for its own continuation.
7. **The backup seals the probe under the journal's live key.** The plan said the probe is
   "encrypted under the journal's live key", but the implementation took the key from the backup
   source. The backup now takes the live key and refuses a source that does not hold it.
8. **The restore's deleted branch runs the full purge.** The plan said the restore deletes the
   account row; the implementation now runs the same purge the delete path runs, so nothing of the
   deleted account is left behind.
9. **The prune of a subtree is all-or-nothing.** A subtree that does not fit in the remaining budget
   is left whole rather than half-removed, because half-removed would leave a job without its
   delivery.

## The granted repair

The candidate was committed, and the coordinator then granted three areas this phase had declared
out of scope: `infrastructure/worker.ts` (the handler resolver), `intelligence/composition.ts` (the
handler registry) and `app/api/intelligence/` (the operator routes). The grant and what it wires are
recorded in the phase plan under **The granted repair**:

- the worker resolves a `retention` job to the retention handler and a `workflow_effect` job to the
  workflow effect handler, and `composition.ts` registers both. The retention run and the deferred
  workflow resume — the leg Phase 19 left open — now run in production.
- the operator routes answer a retention run, the current retention state, a reset and a rebuild.

## The next phase's inputs

- **The persisted home for an AI-assisted insight** stays where Phase 19 left it: the chain's AI
  leg has no table of its own, and no phase in this run owns the migration that would give it one.
  The leg itself is optional, so this is a **next-milestone item and not a hole in this gate** — the
  gate of this phase is the retention, the deletion, the backup and the restore, and all four are
  proven.
- **The benchmark, the full CI sequence, the Docker and Windows smoke and the package audit** are
  Phase 21's release half of Task 13.

## What Phase 21 gets

- `pruneIntelligence`, `pruneSupersededKnowledge`, `purgeAccountIntelligence`,
  `resetAccountIntelligenceInTx` and `requestAccountIntelligenceRebuildInTx` — the retention and
  deletion behaviour, callable from the server.
- `backupJournal` and `restoreJournal` — a consistent snapshot with its key material, and a restore
  that verifies the copy before anything migrates it and applies the deletion ledger again.
- `docs/intelligence-operations.md` — the runbook an operator acts on.
- `docs/database-migrations.md` — what the migrations mean to an operator.
