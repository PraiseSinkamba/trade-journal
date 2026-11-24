# Phase 23 — Fenced provider job for the review question

Phase B of the optional-AI feature · the provider leg of the design chain · **no migration**

|                       |                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Branch                | `codex/ai-native-journal-p23` (child of the feature worktree)                              |
| Base                  | `96115f9` — the Phase A integration and the passing destination gate                       |
| Plan commit           | `ad49145fdc` — _docs: plan the fenced provider job for the review question_                |
| Implementation commit | `340b4d12d3` — _ask the provider one review question per live trade, through a fenced job_ |
| Report commit         | _docs: record the Phase 23 provider job evidence_                                          |
| Repair commits        | `576678d` (the code), `a5a15aa` (the guide), `e7f9210` (the cases), this report            |
| Migrations            | none. `0001`–`0008` are byte-unchanged; the job payload rides the existing table           |

## What was built

Phase A gave the optional-AI leg a persisted home. This phase connects that home to a provider:
one live trade change now produces one short review question, asked through a durable job the
worker executes **outside** any write transaction, and stored through one **fenced** final
transaction that re-checks everything the answer depended on.

The deterministic review is untouched. With no background policy, no consent, no provider, no live
opportunity or a refusal at any gate, the journal behaves exactly as before: the observation is
produced, the opportunity is raised, and no question is stored. The provider leg is opt-in, per
account, and every one of its refusals is a stable reason code.

### The capability

`journal.review-insight`, version `1` — the version Phase A minted as
`AI_INSIGHT_CAPABILITY_VERSION`. The id joins `JOURNAL_CAPABILITY_IDS` so the journal keeps one
registry of capability ids, and it is deliberately **not** granted to any interactive data source:
the interactive surface never reaches it.

The capability is a background capability (`contracts/capabilities.ts`): a versioned unit of work
with a strict input schema, a strict output schema and a prompt builder. It declares no tools and
no tool access. Its answer is bounded by Phase A's `MAX_INSIGHT_QUESTION_LENGTH` (2000 characters),
and the answer is validated before the caller ever sees it.

The evidence it reads is the minimum a review question needs, and nothing else:

| Field           | Where it comes from       | Why it is there                                       |
| --------------- | ------------------------- | ----------------------------------------------------- |
| `symbol`        | the projection snapshot   | the trader recognises it                              |
| `direction`     | the projection snapshot   | long or short changes what a review asks              |
| `status`        | the observation           | open, win, loss or breakeven                          |
| `currency`      | the observation           | the money is meaningless without it                   |
| `netPnl`        | the observation           | the outcome the question is about                     |
| `fees`          | the observation           | the cost that often decides the question              |
| `durationMs`    | the observation, nullable | null means the journal does not know the holding time |
| `timingQuality` | the observation           | the uncertainty, stated rather than guessed           |

The prompt lives in the application-owned AI surface (`apps/web/src/server/ai-review-insight.ts`),
as the AI integration guide requires of a dedicated feature prompt file. The capability itself
stays pure: `composition.ts` injects the prompt into it, so `runtime/` never holds prose. The
prompt states what the journal does not know — an unknown holding time and an untrusted timing —
and the closing line is exact: _the journal holds these facts about this trade and nothing else_.

### The enqueue

The run and its job are written in the transaction that persists the observation and raises its
review opportunity — the trade-observation handler's transaction, on the worker's own connection.
Both writes take the caller's transaction, so they commit or roll back together.

**The gates**, all read inside that transaction (`runtime/review-enqueue.ts`):

| Gate                                                      | Why                                                      |
| --------------------------------------------------------- | -------------------------------------------------------- |
| the change is live, not a historical reconstruction       | a reconstructed trade is not the trader's own experience |
| the observation is active and its revision is current     | a superseded observation is not the current truth        |
| the review opportunity is live and not suppressed         | a suppressed opportunity is observed, never reviewed     |
| the account opted into background AI and the policy is on | consent is the operator's decision                       |
| the account still exists                                  | a run for a deleted account answers nobody               |
| a provider is configured                                  | a question nobody can answer is not worth a run          |
| the evidence fits the policy's character allowance        | the operator caps what a run may read                    |

The historical seed path and the replay path produce no run and no job: the backfill writes its
events with `mode: "historical"`, and a replayed live delivery reuses the business key of the
delivery it replays.

**The identity.** One source revision yields one run, one job and one question, because all three
share one string:

```
insight:<capabilityVersion>:<accountId>:<sourceRevision>
```

It is the run's `effect_key`, the job's `idempotency_key` and the insight's `business_key`. The
run is enqueued **once** (`enqueueRunOnceInTx` inserts with `onConflictDoNothing` on the effect key
and reads the row back unchanged): a repeated delivery never re-pins the run, never re-queues the
job and never spends a second attempt.

### The asynchronous worker path

`JobHandler.run(tx, job)` is unchanged — the synchronous handlers keep running inside the effect
transaction. A second, asynchronous dispatch was added for the capability job:

1. **The claim** is the existing fenced claim: the fence increments on every claim and the lease
   is refreshed while the work runs.
2. **The authorisation is recomputed** at execution time, because the world moved between the
   enqueue and the execution. A refusal records its reason on the run and never calls a provider.
   The refusal's own state is kept: a target that is gone ends the run `cancelled`, a run that
   cannot be found ends it `failed`, everything else ends it `unavailable`.
3. **The evidence is loaded** — the observation, its current projection revision and the
   opportunity's liveness — **before** the attempt is reserved. A target that went stale costs no
   allowance.
4. **The daily attempt is reserved and committed** in its own transaction, before the provider is
   called. A crashed attempt keeps its slot; a fresh attempt spends another one. The allowance is
   the existing one: ten attempts per journal per UTC day.
5. **The provider is called outside every write transaction.** The transport is injected, so the
   tests drive the real worker registration with a stub provider and the production path with the
   real one. The request carries the pinned provider, model and endpoint.
6. **The leases are maintained across the wait.** The job lease and the worker lease are renewed
   on a timer while the provider is asked. A lease that cannot be renewed aborts the call and
   discards the answer: a worker that lost the journal writes nothing.

A capability job naming a version nobody registered is terminal (`unhandled_capability`) and never
reaches a provider.

### The fenced final transaction

Everything that decides the outcome happens in one synchronous transaction on the worker's
connection, and the acknowledgement commits with it:

1. **the claim fence** — `assertClaim` refuses a claim that was taken over, expired or cancelled,
   and the refusal aborts the transaction;
2. **the account** — it still exists;
3. **the consent** — the background policy still enables it and still lists it;
4. **the policy revision** — the run's pinned revision is still the current one, so a revision
   that landed during the provider call does not apply retroactively;
5. **the pinned configuration** — provider, model and endpoint fingerprint still match. A changed
   configuration makes the run `unavailable`; a run is never rerouted;
6. **the current observation revision** — the observation is still active and still derived from
   the subject's current projection revision;
7. **the opportunity's liveness** — the review opportunity is still live and not suppressed.

Then, in the same transaction: the answer is validated, the unique insight is inserted through
Phase A's store, the run status is updated and the job is acknowledged. A stale or purged target
yields no visible output.

## The exit evidence

`apps/web/tests/intelligence-review-insight.test.ts` — 31 cases, driving the **production** worker
registration (`createIntelligenceWorker`) against a real file-backed SQLite journal with an
injected transport. The compatible provider points at a fake local URL, so no real network call
can happen. Eleven of the cases were added by the repair round and one by the second repair
round; they are listed in [the repair round](#the-repair-round) and
[the second repair round](#the-second-repair-round) below.

| Case                                                         | What it proves                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| one run and one job                                          | the enqueue is atomic and keyed to one business key              |
| a rollback leaves neither                                    | the two writes commit together                                   |
| the provider answer becomes one insight                      | the final transaction stores the question                        |
| another connection writes while the answer is held           | the provider call is not inside a write transaction              |
| consent revoked while the answer is held                     | no insight; the run is `unavailable`                             |
| the policy revised while the answer is held                  | no insight; the run is `unavailable`                             |
| the endpoint changed while the answer is held                | no insight; the run is `unavailable`                             |
| the observation corrected while the answer is held           | no insight; the stale observation yields nothing                 |
| the account deleted while the answer is held                 | no insight; the run is `cancelled`                               |
| the claim expires while the answer is held                   | no insight; the job is not acknowledged                          |
| a duplicate delivery                                         | one run, one job, one insight, one provider request              |
| the provider times out                                       | the job fails within the attempt bound; the run is not completed |
| the provider answers with something unusable                 | the job fails and nothing is stored                              |
| the job names an unregistered capability                     | the job fails without a provider request                         |
| the day's allowance is spent                                 | no provider request and a terminal run                           |
| the account never opted in                                   | no run, no job, no provider request                              |
| the deterministic review still works                         | the ordinary review is unaffected by the provider path           |
| the holding time is unknown when the journal did not know it | the prompt never states a fact the journal withheld              |
| the pinned provider and the hidden account                   | the request goes to the pinned endpoint and names no account     |
| the enqueue's own account gate refuses the account           | no run and no job, decided by the enqueue's own gate             |

The neighbouring suites stay green: `pnpm exec vitest run apps/web/tests/intelligence-` → **25
files, 448 passed, 1 skipped**. `pnpm --filter web typecheck` → 0 errors.

### The mutation evidence

Each behaviour was broken on purpose and seen to fail.

| Broken on purpose                                                             | What happened                                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the policy-revision recheck in the final transaction (`capability-job.ts`)    | "stores nothing when the policy is revised while the answer is held" failed; the run completed and an insight was stored                                |
| the holding time read from the nulled observation column (`insight-store.ts`) | "states that the holding time is unknown when the journal did not know it" failed: the prompt said `holding time: 3600000 ms` for a reconstructed trade |
| the daily allowance reservation (`policy-store.ts`)                           | the day's ten attempts are spent; the provider is never asked                                                                                           |

## The repair round

The implementation-diff review of this phase returned **FAIL** with eight findings, and a second
mapping of the suite against the production code found nine behaviours that no test could fail.
The repair keeps the design and closes both.

### The eight findings

| #   | Finding                                                                                        | What the repair did                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | the operations guide advertised three codes the code cannot emit                               | the guide now says which codes the feature cannot emit and why: `capacity_unknown` (the policy schema demands a positive int, so a bad value is `policy_invalid`), `context_too_large` (the enqueue drops an over-budget change silently), `invalid_evidence` (the reader returns null, so the case is `target_stale`), and the two capability-feature codes (the run requires no feature) |
| 2   | the guide omitted `lease_lost` and `run_not_found`, and misstated where a code lands           | the guide now names every code and exactly where it lands: the job's `last_error` only, the run's reason and status and the job's `last_error`, or the run's reason and status alone (the job is then acknowledged completed with `last_error` NULL)                                                                                                                                       |
| 3   | the report claimed the lease renewal and the opportunity recheck were confirmed; they were not | both are now pinned by cases that fail when the check is removed, and the claim in the reviewer report is corrected                                                                                                                                                                                                                                                                        |
| 4   | the transport dropped the call metadata                                                        | the transport returns the answer with its metadata, and the run records the prompt version, the provider, the model, the duration and the token counts — no prompt text, no answer text, no credential                                                                                                                                                                                     |
| 5   | the business-key identity was only two-thirds pinned                                           | the identity case now asserts the run's effect key, the job's idempotency key and the insight's business key are one string                                                                                                                                                                                                                                                                |
| 6   | the legacy path could complete a run from a bare provider response                             | `executeBackgroundRun` has no production caller; it now refuses a run that carries a capability id before it reserves an attempt or reaches a provider, and it never completes such a run. A case pins the guard                                                                                                                                                                           |
| 7   | `invalid_payload` was a second code for the unregistered-capability condition                  | the code and both of its branches are gone; the handler narrows the payload and throws on an impossible one, and `unhandled_capability` stays the one code                                                                                                                                                                                                                                 |
| 8   | a run that failed once kept its stale `refusalReason`                                          | the success path writes `refusalReason: null`, so the meta merge clears the old reason                                                                                                                                                                                                                                                                                                     |

### The new cases, and the teeth they have

Eleven cases were added and two existing ones were extended. Every behaviour was broken on
purpose — the production check it pins was deleted — and seen to fail; the file was then restored
and the case seen to pass again.

| Case                                                                                       | The production check it pins                            | What happened when the check was deleted                                                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| renews the lease while the provider is thinking, and writes nothing when the lease is lost | the worker's renewal callback and its lease-lost branch | the case failed: the abort was the only thing that cancelled the provider call, so the answer was never discarded |
| stores nothing when the review opportunity is withdrawn while the answer is held           | the final transaction's `isLiveInTx` recheck            | the case failed: an insight was stored for a withdrawn opportunity                                                |
| stores nothing when the policy is switched off while the answer is held                    | the `policyDisabled` clause                             | the case failed: the run reported `policy_changed` instead of `policy_disabled`                                   |
| stores nothing when the policy is deleted while the answer is held                         | the `policyMissing` clause                              | the case failed: the run stayed `running`                                                                         |
| stores nothing when the policy is corrupted while the answer is held                       | the `policyInvalid` clause                              | the case failed: the run stayed `running`                                                                         |
| stores nothing when the pinned model changes while the answer is held                      | the pinned-model comparison                             | the case failed: an insight was stored for a run pinned to another model                                          |
| fails a job that names a capability version nobody registered                              | the registry lookup's version dimension                 | the case failed: the job reached the handler instead of failing with `unhandled_capability`                       |
| queues neither a run nor a job for a historical or a maintenance delivery                  | the enqueue's `mode !== "live"` gate                    | the case failed: two runs and two jobs were written for the historical delivery                                   |
| asks the real transport against a local server                                             | the whole transport adapter                             | the case failed: the answer carried no prompt version                                                             |
| the stored question carries the same business key as the run and the job                   | the business key construction                           | the case failed: the job's idempotency key differed from the run's effect key                                     |
| the attempt reservation is recorded before the provider is called                          | the attempt reservation                                 | the case failed: no reservation row existed, and the day's allowance could never be spent                         |
| refuses a capability job's run in the legacy background path                               | the legacy path's capability guard                      | the case failed: the legacy path reached the provider instead of refusing the run                                 |

### The account gate: what it does, and what it does not do

The enqueue's account gate (`runtime/review-enqueue.ts`, `existingAccountIds.includes(...)`) is
**not reachable through the production delivery path**. Two earlier checks stand in front of it:

1. the executions write requires the account row (`insertExecutionsInTx` throws `Account not
found.`), so a delivery for a deleted account is refused before the observation handler and
   the enqueue run at all; and
2. the observation reader returns null when the account row is gone, and the observation cascades
   with the account, so the enqueue's own observation gate refuses first.

The earlier case therefore proved something real — a deleted account produces no run and no job —
but it proved it through the delivery's refusal, not through the enqueue's gate. It is renamed
"refuses the whole delivery when the account no longer exists", and it says so in a comment.

The gate is kept: it is the enqueue's own guard, it costs one membership test, and it is the
check that would decide if the two earlier checks ever changed. It is now pinned **directly** by
a new case, "queues neither a run nor a job when the enqueue's own account gate refuses the
account": the case drives the enqueue with a journal that reports no account at all, and asserts
that no run and no job are written while the observation and its opportunity exist.

**The teeth.** The gate line was deleted from `runtime/review-enqueue.ts`, the case was run, and
it failed:

```
× the review insight > queues neither a run nor a job when the enqueue's own account gate refuses the account
  → expected [ { …(11) } ] to have a length of +0 but got 1
```

The gate was restored and the case passed again. No production code was changed by this round.

The worker takes an optional renew interval, so a case can exercise the lease-lost branch
without waiting the real fifteen seconds. The seam is used by the test that wires the worker
directly; the composition does not expose it, because nothing in production needs to.

## The second repair round

The final scoped review of this phase returned **FAIL** with two documentation findings, and the
coordinator's independent teeth proof found the unpinned gate above. All three are fixed, and no
production code changed.

### Finding 1 — the guide contradicted the code about what is stored

The guide said: "Nothing about the call is stored. The run's diagnostics hold the reason code, the
capability id and the capability version." That was false after the repair round: the success path
writes the call metadata into the run's `meta_json` — the prompt version, the provider, the model,
the duration and the token counts the provider reported.

The guide now says exactly what is kept (the refusal reason, the capability id and version, and
the call metadata of a successful call) and keeps the guarantee that is true and worth stating:
never the prompt text, never the provider's answer text, never a credential.

### Finding 2 — the guide was false about retries

The guide said `provider_error` was the only retryable code and that every other code ends the
job. That was false for two codes: the worker fails a lost lease with `retryable=true`
(`worker.ts`), and it fails a thrown handler with `retryable=true` unless the throw was a schema
violation. So `lease_lost` does not end the job, and the next attempt can call the provider
again; `handler_failed` is retried too, while `validation_failed` is not.

The guide now says which codes are retried (`provider_error`, `lease_lost`, `handler_failed`),
which is not (`validation_failed`), and that every other code ends the job.

### Finding 3 — the unpinned account gate

Closed as described above: the gate is kept and pinned directly, and the delivery-path case is
renamed to state what it proves.

### The verification of the second repair round

| Command                                                                                                                                                                      | Exit | Runtime |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| `pnpm exec vitest run apps/web/tests/intelligence-review-insight.test.ts apps/web/tests/intelligence-provider-policy.test.ts apps/web/tests/intelligence-boundaries.test.ts` | 0    | 9.5 s   |
| `pnpm --filter web typecheck`                                                                                                                                                | 0    | 29.5 s  |
| `pnpm exec prettier --check` on the changed files                                                                                                                            | 0    | —       |

The mutation proof for the account gate is recorded above: the gate deleted, the case failed, the
gate restored, the suite green.

## The review

Two reviewer runs, both against the plan and the implementation.

**Run 1 (the plan)** found five issues: the ownership table was missing
`runtime/model-policy.ts`, two throwaway copies sat in the repository root, the plan document
failed `prettier --check`, two sentences had drifted from the code (the stale-target wording and
the evidence status values), and — the real one — **the final transaction did not recheck the
policy revision** the plan promised. The code was wrong, not the plan: a policy edited during the
provider call still landed a question. Fixed, and pinned by a test.

**Run 2 (the implementation)** found three behavioural defects and two gaps:

1. the evidence read the holding time from the raw projection snapshot, so a reconstructed-timing
   trade would have been sent to the provider with a holding time the journal deliberately nulled
   (`intelligence_observations.duration_ms` holds the nulled value). Fixed, and pinned.
2. every authorisation refusal was flattened into the run status `unavailable`, so a deleted
   account ended the run `unavailable` instead of `cancelled`. Fixed, and pinned.
3. two reason codes for one condition: the worker answers `unhandled_capability`, and the handler
   carried an unreachable `unknown_capability` the operations guide advertised. One code now, and
   the guide was corrected.
4. the suite did not pin the holding-time contract, and the refusal cases asserted only a status.
   The suite grew from 17 to 19 cases and now asserts the recorded reason on every refusal.
5. a doubled `/**` split a doc comment. Fixed.

**Run 3 (the implementation diff of this phase, after the repair round)** is the coordinator's
review of the repair. This report's own earlier claim — that the lease renewal and the
opportunity recheck were confirmed by the suite — was false: no case could fail when either
check was deleted. Both are pinned now, and the claim in the reviewer report has been corrected.

## The verification of the repair round

| Command                                                                                                                                                                                                      | Exit | Runtime            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------ |
| `pnpm exec vitest run apps/web/tests/intelligence-review-insight.test.ts`                                                                                                                                    | 0    | 8.4 s              |
| `pnpm exec vitest run apps/web/tests/intelligence-review-insight.test.ts … intelligence-worker … intelligence-provider-policy … intelligence-observations … intelligence-recovery … intelligence-boundaries` | 0    | 17.2 s (100 tests) |
| `pnpm --filter web typecheck`                                                                                                                                                                                | 0    | 27.5 s             |

## What this phase does not do

- No migration. The job payload rides the existing `intelligence_jobs` table; `type` is plain
  text, and neither the retention prune nor the scheduler sweeps the new job type.
- No new surface for the operator. The background policy is the existing one, and the operations
  guide (`docs/intelligence-operations.md`) explains the allowance, the refusal reasons, how to
  turn it on and how to turn it off.
- No change to the AI runtime's provider list, its endpoint routing or its policy caps. The
  background transport uses the existing `runBackgroundAi`, with the prompt version
  `review-insight-v1` — the background runtime's own convention, as `background-v1` already is.
- No display. The question is stored and bound to its revision; Phase C owns the surface that
  shows it.
