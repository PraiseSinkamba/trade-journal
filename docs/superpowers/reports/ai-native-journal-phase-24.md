# Phase 24 — the review question on the card

## What this phase delivers

The optional-AI-insight feature now shows its result. The review card of an
observation carries a labelled **AI question** block with the question the
provider asked, and the scoped inbox surface serves that question on the
review that is waiting for the operator.

Nothing else changed. The deterministic review, the provider leg, the store,
the policy, the schema and the prompts are untouched: Phase A gave the
question a home, Phase B gave it a provider, and this phase only reads what
they stored.

## The shape of the change

| File                                                        | Change                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/web/src/lib/intelligence-interactions.ts`             | `InsightView` and the optional `insight` on the review intent          |
| `apps/web/src/app/api/intelligence/queries.ts`              | `currentInsightOf` — the reader                                        |
| `apps/web/src/app/api/intelligence/observations/route.ts`   | the scoped GET attaches the question                                   |
| `apps/web/src/components/intelligence/interaction-card.tsx` | the labelled block and its privacy mask                                |
| `apps/web/tests/intelligence-slice-b.test.ts`               | the end-to-end proof                                                   |
| `apps/web/tests/intelligence-insight-card.test.ts`          | the card and the mask                                                  |
| `docs/intelligence-operations.md`                           | where the question appears, and why a stored question may not be shown |
| `docs/superpowers/plans/ai-native-journal/phase-24.md`      | the plan this phase was built from                                     |

### The reader

`currentInsightOf(observation, evidenceRevisionIds)` answers with the question
the journal still holds for one observation, or with nothing.

- The CURRENT-REVISION RULE stays in the store. The reader calls the store's
  public factory (`createInsightStore()`) and its `readCurrentInsightInTx`,
  so a corrected source hides the older question without the reader
  re-implementing that rule.
- The read runs in ONE DEFERRED transaction on the app's own handle. Deferred
  is the right mode for a read: it takes a read snapshot and no write lock,
  so opening the inbox never blocks the writer.
- The account is non-nullable (the column is NOT NULL), is passed to the
  store, and is compared with the returned row.
- The question must belong to THIS observation, to THIS account and to a
  revision the review shows as evidence.
- Only `question` and `sourceRevision` cross the wire. The stored row also
  carries the business key, the account, the subject, the observation, the
  capability version and the run — none of them belong on the wire.

### The card

The question is labelled text above the evidence, masked while privacy mode is
on. The mask announces itself as "AI question hidden" (not "Monetary value
hidden") and lifts through the same `HoverHint` overlay the money uses.
`components/privacy.tsx` was not touched: there is no generic text mask to
reuse, and the money's mask would announce the wrong thing.

## The proof

`apps/web/tests/intelligence-slice-b.test.ts` drives the NORMAL path with an
opted-in account and a mock approved provider: a committed live trade change,
the worker, the observation, the provider job, the stored question, the scoped
GET, and the operator's command.

The preconditions the Phase B chain needs, which the proof sets up itself:

- a stored background policy that is enabled and lists the account;
- the journal-side provider settings (`aiProvider`, `compatibleModel`,
  `compatibleBaseUrl`) — an injected transport is only the CALL, the journal
  configuration is the GATE;
- the review STARTED before the GET: the scoped surface serves an
  observation-review intent only for a workflow that waits for the operator.

The provider cases drive the PRODUCTION worker registration, because it
registers `asyncHandlers` — the Slice B file's own worker never runs a
`run_capability` job. The production registration also carries the
workflow-effect handler, so it is NOT used in the case that asserts the
deferred `workflow_effect` job stays pending; that case keeps the file's own
worker.

The file's `beforeEach` also clears `intelligenceInsights`,
`intelligencePolicy` and `intelligenceBudgetReservations`, and the three
provider setting keys. Without that a stored question, a leftover policy or a
leftover daily attempt leaks into the next case, and the ten-attempts-per-UTC-day
allowance is spent across cases.

### Cases

| Case                                                                 | Asserts                                                                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| serves each account its own question                                 | two accounts, two trades, two answers; each scoped GET serves its own question and the intent's subject is the observation's id                |
| links the question to the source revision it was made from           | the served `sourceRevision` equals the observation's `sourceRevision`                                                                          |
| serves the question only for a revision the review shows as evidence | the reader answers for the shown revision and nothing for another one or another observation                                                   |
| hides the question of a corrected source and keeps the stored row    | after the correction the card is empty, the provider was asked once, and the stored row survives                                               |
| stores no question without a provider and leaves the review usable   | zero provider calls, no run, no question; the observation and its opportunity are there, the review starts and the operator can acknowledge it |
| stores no question for an account the policy does not list           | zero provider calls, no question, the review still usable                                                                                      |
| serves a question only inside the scope of its own account           | another account's scope serves nothing and never the question; an unknown account's scope is refused with 403 `scope_denied`                   |
| serves the question again after the journal is reopened              | the journal is closed and reopened on the same directory, the route module is imported again, and the question is still served                 |

The card test proves the label, the question while privacy is off, and the
mask while privacy is on.

## The teeth bar

Every claimed behaviour was broken on purpose, seen to fail, restored and
seen to pass again. Both results are recorded.

| #   | Behaviour                                                   | Break                                                        | Fail           | Restore  | Pass      |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------ | -------------- | -------- | --------- |
| 1   | the scoped GET serves the question                          | the route stops attaching the insight                        | 4 cases failed | restored | 23 passed |
| 2   | the question is served only for a revision the review shows | the reader drops the evidence-revision check                 | 1 case failed  | restored | 23 passed |
| 3   | the card masks the question under privacy                   | the card renders the question unmasked                       | 1 case failed  | restored | 3 passed  |
| 4   | only the question and its revision cross the wire           | the reader returns the raw store row                         | 4 cases failed | restored | 23 passed |
| 5   | the question belongs to the observation it is served for    | the reader compares the observation id with a wrong constant | 5 cases failed | restored | 23 passed |
| 5b  | the question belongs to the observation it is served for    | the reader drops the observation id comparison               | 1 case failed  | restored | 23 passed |
| 6   | the question is served only inside the account's scope      | the route reads the insight for another account              | 4 cases failed | restored | 23 passed |
| 6a  | the reader compares the account itself                      | the reader drops the account comparison                      | 0 cases failed | restored | 23 passed |

Break 2 first showed no failure: the evidence-revision check was not
observable through the surface, so a direct reader case was added, and the
break then failed as it should. That case is the one that now holds the check
in place.

Break 5 uses a wrong constant, so the comparison refuses EVERY question and
the surface cases fail together. Break 5b removes the comparison entirely,
and then only the direct reader case fails — the surface cases cannot tell
the difference, because the store already returns the row of the observation
that was asked about. The observation id comparison is therefore held by the
direct reader case alone, which is what 5b shows.

The reader's ACCOUNT comparison is a second line of defence, not the only
one: dropping it alone (break 6a) fails NO case, because the store's own
account filter already refuses a foreign question. Break 6 shows the account
scope biting end to end, through the route.

## The checks

| Check                                                                                                     | Result                                                                    |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm vitest run` on the five intelligence suites (boundaries, insight-card, ui, review-insight, slice-b) | 78 passed                                                                 |
| `pnpm test` (the whole suite)                                                                             | 119 files, 1429 passed                                                    |
| `pnpm --filter web typecheck`                                                                             | clean                                                                     |
| `pnpm --filter web migrations:check`                                                                      | `migration-checksums.json is up to date`                                  |
| `pnpm format:check`                                                                                       | 79 failures, all on untouched files; none on the files this phase touched |
| web + worker production build                                                                             | succeeded                                                                 |
| bundled worker smoke                                                                                      | the shipped worker stored the question and the app served it              |

The 79 format failures are pre-existing: stashing this phase's changes leaves
the same 79 warnings on the pristine tree. Every file this phase touched is
Prettier-clean.

### The bundled-worker smoke

The SHIPPED artifact was started as its own process, not the source. The
smoke seeded a synthetic journal with the application's own modules (an
account, the provider settings, the background policy and one live trade
change), pointed the journal at a loopback provider stub, started
`apps/web/.next/worker-dist/worker-entry.cjs`, and then:

1. the worker reported `{"type":"ready"}` and took its lease;
2. it consumed the capability job and stored the question in
   `intelligence_insights`;
3. the app's scoped GET was called against the same journal — the review was
   started first, because the question is served where a review waits — and
   it answered with the question the worker had stored.

Both halves passed: the bundled worker stored it, and the app served it.

## Boundaries

- `packages/core` and `packages/importers` are untouched.
- The reader reaches the store's public factory from the APP layer, which
  already owns the journal queries. No server module gained an import,
  `composition.ts` still wires the store, and the store still owns the
  current-revision rule.
- The client layer gained no import of server code or the database. The DTO
  stays plain data; the card imports only `usePrivacy` and `HoverHint`.
- No migration, no new dependency, no new prompt, and no stored provider
  response: the question is the only text the journal keeps.
- The GET stays a read. It never enqueues, never calls a provider and never
  writes, so opening the inbox never spends an allowance.

## What is not claimed

- The question is served only where a REVIEW waits. The proof starts the
  review before reading the card; a question with no review waiting is not
  shown, and that is the intended behaviour rather than a gap.
- The reader's account comparison is a second line of defence: the store's
  own filter already refuses a foreign question (teeth break 6a showed this —
  dropping the comparison fails no case). The end-to-end scope claim rests on
  teeth break 6.

## The review

The reviewer's runs found four defects, all in this phase's own documents. No
defect was found in the production code or in the tests.

**Run 2.** The operations document told the operator that a revoked consent
hides a stored question. The serve path never reads the policy — the policy
decides whether a question is ASKED and STORED, and the serve conditions are
the current source revision, the current capability version and an active
observation. The document and the plan now say that.

**Run 3.** Three further defects, all in the documents:

1. The document claimed a stored question is shown "until the retention prune
   removes it". That is false in both halves: a question whose capability
   version moved on is never shown and the prune never removes it either (the
   prune's `isSuperseded` checks the observation's status and the source
   revision). The sentence now says only what is true: the policy is not
   consulted again once a question is stored.
2. The teeth table recorded that dropping the observation id comparison
   failed five cases. It fails ONE. The five-case run was a different break —
   comparing the observation id with a wrong constant, which refuses every
   question. The table now records both, as break 5 and break 5b, each with
   its own measured count.
3. The teeth table's "break 5" was cited twice for two different experiments
   with opposite outcomes. The account-comparison break is now break 6a, and
   the "what is not claimed" section cites 6a.

The reviewer confirmed the rest: the union is narrowed before the spread, the
read is one deferred transaction, the account is non-nullable and compared,
only two fields cross the wire, the mask announces the question rather than
the money, the inbox and `components/privacy.tsx` are untouched, the
app-layer store access follows the retention-route precedent, the boundaries
test passes, and there is no new dependency, migration, prompt or stored
provider response.
