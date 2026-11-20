# Phase 23 — Fenced provider job for the review question

Plan of record for Phase B of the optional-AI-insight feature. Phase A (Phase 22) created the
persisted home: the `intelligence_insights` table, the `insightBusinessKey(...)` identity, and the
`InsightStore` port. This phase connects that home to a provider: one live observation produces one
short, labelled review question, through a durable job the worker executes outside any write
transaction, and commits through one fenced final transaction.

The plan of record for the feature as a whole lives outside this repository. This document is the
plan of record for this phase.

## Objective

1. **One versioned capability** for one review question: `journal.review-insight`, version `1`,
   application-owned, bounded plain-text output, zero tool access, reading the minimum authorised
   factual evidence of one observation, including its uncertainty.
2. **An atomic enqueue**: the eligible run row and its durable job are written in the same
   transaction as the observation and its review opportunity, on the worker's own connection, keyed
   by the Phase A business key. A rollback leaves neither run nor job; a reprocessed observation
   reuses the same key and writes neither twice.
3. **An asynchronous worker path**: the job is claimed in a short transaction, the authorisation is
   recomputed at execution time, the daily attempt is reserved and committed _before_ the provider
   is called, the provider call happens outside every write transaction, and the job and worker
   leases are maintained across the wait. Lease loss aborts and discards the answer.
4. **One fenced final transaction**: the claim fence, the account and its consent, the pinned policy
   and configuration, the current observation revision and the opportunity's eligibility are all
   rechecked in one synchronous transaction; then the output is validated, the unique insight is
   inserted, the run status is updated and the job is acknowledged — together or not at all.

The deterministic path stays available throughout: no provider configured, no consent, no
opportunity, no eligible observation, or a refusal at any step means the ordinary review works
exactly as before and no question is stored.

## Ownership

| File                                                                  | Change                                                                                                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/server/intelligence/contracts/capabilities.ts`          | the capability id; the background capability shape                                                                         |
| `apps/web/src/server/intelligence/contracts/insights.ts`              | the evidence schema, the answer schema, the provider transport port, the evidence reader port, the opportunity reader port |
| `apps/web/src/server/intelligence/contracts/policy.ts`                | the run-store port moves here                                                                                              |
| `apps/web/src/server/intelligence/contracts/jobs.ts`                  | the capability job payload; the asynchronous handler contract                                                              |
| `apps/web/src/server/ai-review-insight.ts`                            | new: the review-question prompt (the application-owned AI surface)                                                         |
| `apps/web/src/server/intelligence/runtime/review-insight.ts`          | new: the review-question capability (the prompt is injected)                                                               |
| `apps/web/src/server/intelligence/runtime/review-enqueue.ts`          | new: the eligibility gates and the atomic run+job enqueue                                                                  |
| `apps/web/src/server/intelligence/runtime/capability-job.ts`          | new: the durable capability job                                                                                            |
| `apps/web/src/server/intelligence/runtime/model-policy.ts`            | the provider of the authorisation is typed, so a pinned run cannot name an unknown provider                                |
| `apps/web/src/server/intelligence/infrastructure/policy-store.ts`     | the run-store adapter; the insert-once enqueue; the attempt reservation                                                    |
| `apps/web/src/server/intelligence/infrastructure/insight-store.ts`    | the evidence reader; the opportunity reader                                                                                |
| `apps/web/src/server/intelligence/infrastructure/environment.ts`      | new: the background environment reader                                                                                     |
| `apps/web/src/server/intelligence/infrastructure/review-transport.ts` | new: the provider transport over the background runtime                                                                    |
| `apps/web/src/server/intelligence/infrastructure/worker.ts`           | the asynchronous dispatch, the lease renewal across the wait                                                               |
| `apps/web/src/server/settings.ts`                                     | the provider configuration, read inside a transaction                                                                      |
| `apps/web/src/server/intelligence/composition.ts`                     | the wiring: the capability, the transport, the worker, the enqueue                                                         |
| `apps/web/tests/intelligence-review-insight.test.ts`                  | new: the exit evidence                                                                                                     |
| `docs/intelligence-operations.md`                                     | the operational notes                                                                                                      |
| `docs/superpowers/plans/ai-native-journal/phase-23.md`                | this plan                                                                                                                  |
| `docs/superpowers/reports/ai-native-journal-phase-23.md`              | the phase report                                                                                                           |

The run-store port moves from `infrastructure/policy-store.ts` into `contracts/policy.ts`,
because the capability job in `runtime/` needs it and a sibling domain may only import
`contracts/`. The adapter stays where it is; only the interface moves.

The capability's version is the one Phase A minted: `AI_INSIGHT_CAPABILITY_VERSION` (`"1"`).
The capability id is the one Phase A named: `journal.review-insight`, registered in
`JOURNAL_CAPABILITY_IDS` so the journal keeps a single registry of capability ids. It is
deliberately **not** granted to any interactive data source, so the interactive surface never
reaches it.

No other file changes. `apps/web/src/app/**`, `apps/web/src/components/**`, the AI runtime's
provider list, its endpoint routing and its policy caps stay untouched: this phase adds no
dependency, no migration and no new surface to the operator.

## The capability

`journal.review-insight` joins `JOURNAL_CAPABILITY_IDS` — the single registry of capability ids — and
carries version `1`, the same constant Phase A minted as `AI_INSIGHT_CAPABILITY_VERSION`. The
capability id and version travel in the job payload, so a queued job names the exact capability it
was queued for; a version that is no longer registered is a refusal, not a silent upgrade.

The capability is _ai-assisted_: it asks the provider for one question and returns plain text. It
declares **no tools** and no tool access, and its answer is bounded by Phase A's
`MAX_INSIGHT_QUESTION_LENGTH`. The dispatcher validates the answer against the answer schema before
the caller sees it, so an unbounded or empty answer never reaches the journal.

The evidence the capability receives is the minimum a review question needs, taken from the
observation's own direct facts:

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

`timingQuality` is the uncertainty: `source_reported`, `reconstructed` or `unknown`. The prompt
tells the model that an unknown or reconstructed timing may not be trusted, so the question does not
assume facts the journal does not have. Nothing else reaches the provider: no prompt, no response
and no credential is ever stored.

The capability's prompt lives in the application-owned AI surface
(`apps/web/src/server/ai-review-insight.ts`), as the AI integration style guide requires of a
dedicated feature prompt file. The capability itself stays pure: the composition injects the
prompt into it, so `runtime/` never holds prose. The interactive prompt surface
(`apps/web/src/server/ai-prompts.ts`) is unchanged: this is a background capability of the
intelligence runtime, not an interactive feature.

## The enqueue

The eligible run and its job are written in the transaction that persists the observation and
raises its review opportunity — the trade-observation handler's transaction, on the worker's own
connection. Both writes take the caller's transaction, so they commit or roll back together.

**Eligibility** — all of it, in the same transaction:

| Gate                                                      | Why                                                      |
| --------------------------------------------------------- | -------------------------------------------------------- |
| the change is live, not a historical reconstruction       | a reconstructed trade is not the trader's own experience |
| the observation is active and its revision is current     | a superseded observation is not the current truth        |
| the review opportunity is live and not suppressed         | a suppressed opportunity is observed, never reviewed     |
| the account opted into background AI and the policy is on | consent is the operator's decision                       |
| the evidence fits the policy's character allowance        | the operator caps what a run may read                    |
| a provider is configured                                  | a question nobody can answer is not worth a run          |

The historical seed path and the replay path produce no run and no job: a reconstruction is not a
live trade, and a replayed delivery reuses the business key of the delivery it replays.

**The run row** (`intelligence_runs`) pins the configuration the run was queued against: provider,
model, endpoint fingerprint, policy revision and the account scope. Its effect key is the Phase A
business key, so one source revision yields one run.

**The job row** (`intelligence_jobs`) carries the references the worker needs and nothing else: the
run id, the capability id and version, and the observation id. Its idempotency key is the same
business key, so a reprocessed observation reuses the same job instead of creating a second one.

The run is enqueued **once**. A run that already exists for the business key is returned unchanged:
the run is never re-pinned and never re-queued by a repeated delivery, so a reprocessed observation
cannot spend a second attempt.

## The asynchronous worker path

`JobHandler.run(tx, job)` stays exactly as it is: the synchronous handlers keep running inside the
effect transaction, and the worker keeps dispatching them the same way. A second, asynchronous
dispatch is added for the capability job.

The capability job runs in this order:

1. **Claim in a short transaction.** The claim is the existing fenced claim: the job's fence
   increments on every claim and the lease is refreshed while the work runs.
2. **Recompute the authorisation at execution time.** The consent, the policy revision, the pinned
   configuration and the account scope are read again, because the world moved between the enqueue
   and the execution. A refusal records the terminal reason on the run and fails the job; it never
   calls the provider.
3. **Load the current evidence.** The observation is read again, and so is the current projection
   revision of its subject. A correction between the enqueue and the execution means the target is
   stale: the run ends without a question, and the job fails with the reason, so nothing is
   acknowledged as a completed question.
4. **Reserve the daily attempt, and commit it.** The reservation is taken in its own transaction and
   committed _before_ the provider is called, so a crashed attempt keeps its allowance and a fresh
   attempt spends another one. The day's allowance is the existing one: ten attempts per journal per
   UTC day.
5. **Call the provider outside every write transaction.** The call carries the shutdown signal, the
   cancellation signal and the deadline. The answer is validated against the answer schema.
6. **Maintain the leases across the wait.** The job lease and the worker lease are renewed while
   the provider is called. A lease that cannot be renewed aborts the call and discards the answer:
   a worker that lost its lease may not acknowledge the work it started.

The provider transport is injected, so the tests drive the real worker registration with a stub
provider and the production path with the real one.

## The fenced final transaction

Everything that decides the outcome happens in one synchronous transaction on the worker's
connection:

1. **the claim fence** — `EffectStore.assertClaim` refuses a claim that was taken over, expired or
   cancelled, and the refusal aborts the transaction, so a late claimant writes nothing.
2. **the account and its consent** — the account still exists and the background policy still
   enables it and still lists it.
3. **the pinned policy and configuration** — the run's policy revision is still the current one and
   the pinned provider, model and endpoint fingerprint still match the configured ones. A changed
   configuration makes the run unavailable; it is never rerouted.
4. **the current observation revision** — the observation is still active and still derived from
   the subject's current projection revision.
5. **the opportunity's eligibility** — the review opportunity is still live and not suppressed.

Then, in the same transaction: the answer is validated, the unique insight is inserted through
Phase A's store (the business key is the unique identity, so a second attempt writes the same
row), the run status is updated, and the job is acknowledged by the effect store. A stale or purged
target yields no visible output: the transaction inserts nothing and the run is finished without a
question.

The failure writes are fenced as well: a run status written by a worker that lost its claim never
lands, so a late claimant cannot overwrite the winner's result.

## The tests

`apps/web/tests/intelligence-review-insight.test.ts` drives the production worker registration
against a real file-backed SQLite journal, with an injected provider transport.

| Case                                                  | What it proves                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| the observation produces one run and one job          | the enqueue is atomic and keyed                                     |
| a rollback leaves neither run nor job                 | the two writes commit together                                      |
| the provider answer becomes one insight               | the final transaction stores the question                           |
| another connection writes while the answer is held    | the provider call is not inside a write transaction                 |
| consent is revoked while the answer is held           | no insight, no provider request beyond the one in flight            |
| the policy is revised while the answer is held        | no insight; the run is unavailable                                  |
| the endpoint changes while the answer is held         | no insight; the run is unavailable                                  |
| the observation is corrected while the answer is held | no insight; the corrected revision gets its own run                 |
| the account is deleted while the answer is held       | no insight                                                          |
| the claim expires while the answer is held            | no insight; the job is not acknowledged by the late claimant        |
| a duplicate delivery                                  | one run, one job, one insight, one provider request                 |
| the provider times out                                | the job fails within the attempt bound and the run is not completed |
| the provider answers with something unusable          | the job fails and nothing is stored                                 |
| the job names an unregistered capability              | the job fails without a provider request                            |
| the day's allowance is spent                          | no provider request and a terminal run                              |
| the account never opted in                            | no run, no job, no provider request                                 |
| the deterministic review still works                  | the ordinary review is unaffected by the provider path              |

The existing worker, provider-policy, observation, recovery and boundary suites stay green.

## The checks

```
pnpm exec vitest run apps/web/tests/intelligence-review-insight.test.ts apps/web/tests/intelligence-worker.test.ts apps/web/tests/intelligence-provider-policy.test.ts apps/web/tests/intelligence-observations.test.ts apps/web/tests/intelligence-recovery.test.ts apps/web/tests/intelligence-boundaries.test.ts
pnpm --filter web typecheck
```

The mutation evidence — each behaviour broken on purpose and seen to fail — is recorded in the
phase report.
