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
| `apps/web/tests/intelligence-insight-smoke.test.ts`         | the shipped worker bundle, end to end                                  |
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

### The read is free

The plan's rule is that reading the inbox must never itself trigger a paid
request. Three cases now HOLD that rule instead of asserting it in prose.
The runs, the jobs and the daily attempt reservations — the three things the
provider leg writes — are counted BEFORE the scoped read and must be exactly
the same AFTER it, and the provider call count must not move either.

The case with two accounts reads twice, once per account, and the counts are
compared after BOTH reads. The two cases without a provider read the inbox as
well: the review is served, no question is on it, and the read reaches no
provider. Without those two reads the "the read is free" half would be
unproven exactly where there is nothing to spend.

### The question is on the right card

The inbox pairs every intent with its OWN observation, by id. The card case
renders the INBOX — not a card in isolation — with two observations: one
under review and carrying the question, one merely offered for review. The
question must sit on the card that shows the trade it was made from, and on
no other card.

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

| Case                                                                 | Asserts                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| serves each account its own question                                 | two accounts, two trades, two answers; each scoped GET serves its own question and the intent's subject is the observation's id; after BOTH reads the runs, the jobs, the attempt reservations and the provider calls are exactly what they were |
| links the question to the source revision it was made from           | the served `sourceRevision` equals the observation's `sourceRevision`                                                                                                                                                                            |
| serves the question only for a revision the review shows as evidence | the reader answers for the shown revision and nothing for another one or another observation                                                                                                                                                     |
| hides the question of a corrected source and keeps the stored row    | after the correction the card is empty, the provider was asked once, and the stored row survives                                                                                                                                                 |
| stores no question without a provider and leaves the review usable   | zero provider calls, no run, no question; the observation and its opportunity are there, the review starts, the inbox is READ as well and the read spends nothing, and the operator can acknowledge the review                                   |
| stores no question for an account the policy does not list           | zero provider calls, no question, the review still usable, and the read of the inbox reaches no provider                                                                                                                                         |
| serves a question only inside the scope of its own account           | another account's scope serves nothing and never the question; an unknown account's scope is refused with 403 `scope_denied`                                                                                                                     |
| serves the question again after the journal is reopened              | the journal is closed and reopened on the same directory, the route module is imported again, and the question is still served                                                                                                                   |
| takes the operator's command while the question is on the card       | the card's own command body carries only the action id, the revision and the action; the command route accepts it, the review completes, and the question never crosses the wire inside the command                                              |
| still refuses a stale command while the question is on the card      | the revision the card carries is the workflow's own; after a deferral the workflow waits again at a newer revision, and the card's command is refused with 409 `stale_revision`                                                                  |

The card test proves the label, the question while privacy is off, and the
mask while privacy is on. A fourth card case proves the keyboard is left
where it was: the question adds text, not controls, so the focusable set on
the card is EXACTLY the one it had without the question — the Acknowledge
button and nothing else — and the evidence list is untouched. It renders
BOTH privacy states, each on its own mount, because the provider reads the
saved preference when it mounts.

A FIFTH card case proves the PAIRING. It mounts the inbox with two
observations — one under review and carrying the question, one merely
offered for review — and asserts that the question sits on the card that
shows the trade it was made from ("trade-b") and on no other card. The card
that shows the other trade carries no question at all.

The two command cases close the last leg of the plan's chain. The provider
path previously stopped at the scoped GET; the operator's command was only
exercised on the provider-FREE path, where no question is on the card. The
command body the card builds is now proved twice: it carries exactly the
action id, the revision and the action (the question is in neither the body
nor the intent's own command fields), the command route applies it, and the
workflow's revision check still bites when the card carries a question.

## The teeth bar

Every claimed behaviour was broken on purpose, seen to fail, restored and
seen to pass again. Both results are recorded.

| #   | Behaviour                                                   | Break                                                         | Fail             | Restore  | Pass             |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------- | ---------------- | -------- | ---------------- |
| 1   | the scoped GET serves the question                          | the route stops attaching the insight                         | 6 cases failed   | restored | 25 passed        |
| 2   | the question is served only for a revision the review shows | the reader drops the evidence-revision check                  | 1 case failed    | restored | 25 passed        |
| 3   | the card masks the question under privacy                   | the card renders the question unmasked                        | 1 case failed    | restored | 5 passed         |
| 4   | only the question and its revision cross the wire           | the reader returns the raw store row                          | 4 cases failed   | restored | 25 passed        |
| 5   | the question belongs to the observation it is served for    | the reader compares the observation id with a wrong constant  | 7 cases failed   | restored | 25 passed        |
| 5b  | the question belongs to the observation it is served for    | the reader drops the observation id comparison                | 1 case failed    | restored | 25 passed        |
| 6   | the question is served only inside the account's scope      | the route reads the insight for another account               | 6 cases failed   | restored | 25 passed        |
| 6a  | the reader compares the account itself                      | the reader drops the account comparison                       | 0 cases failed   | restored | 25 passed        |
| 7   | the question never crosses the wire inside the command      | the command body builder carries the question as a correction | 1 case failed    | restored | 25 passed        |
| 8   | the question is served only inside the account's scope      | the observation list ignores the scope                        | 2 cases failed   | restored | 25 passed        |
| 9   | the shipped worker bundle stores the question               | the production registration drops the capability handler      | the smoke failed | restored | the smoke passed |
| 10  | the workflow's revision check still bites                   | both revision checks are disabled                             | 1 case failed    | restored | 25 passed        |
| 11  | the question adds no control to the card                    | the question is rendered as a button                          | 1 case failed    | restored | 5 passed         |
| 12  | reading the inbox spends nothing                            | the scoped GET enqueues a run                                 | 3 cases failed   | restored | 25 passed        |
| 13  | the question is on the card of its own observation          | the inbox picks the observation by position, not by id        | 1 case failed    | restored | 5 passed         |

Every count in this table was MEASURED on the tree this report describes,
with the two new cases in place: the slice-b suite holds 25 cases, the card
suite 5. The counts of breaks 1, 5 and 6 therefore rose with the new cases —
the two command cases assert a served question, so they fail with the rest
when the surface stops serving one.

Breaks 12 and 13 are the repair round's own teeth. Break 12 makes the
scoped GET enqueue a run — the exact defect the read guarantee exists for —
and the three cases that read the inbox fail on the run count: two reads in
the two-account case take the count from 2 to 4, one read in each of the two
provider-free cases takes it from 0 to 1. Nothing else fails, because the
other cases do not read the inbox. Break 13 makes the inbox pick the
observation by POSITION instead of by id — the mistake the pairing case
exists for — and the fifth card case fails: the card that carries the
question then shows the other trade's facts. The four other card cases do
not notice, because they render one card at a time.

Break 8 widens break 6: it removes the scope filter from the observation
list itself, so another account's observation enters the scope at all. Two
cases fail — the per-account question case and the scope case — which shows
the scope is held by the list, not only by the reader.

Break 9 is the bundle's own teeth. The capability handler is removed from
the production worker registration, the bundle is rebuilt, and the smoke sees
the worker start, take its lease and process the job, yet store NO question:
the assertion fails. With the registration restored the bundle stores it and
the app serves it. This is the defect class the smoke exists for: a source
test can pass while the shipped bundle never runs the leg.

Break 7 is what keeps the question out of the command. The command body
builder is given the question as the correction; the command case then fails,
because the body the card sends must carry the action id, the revision and
the action, and nothing else.

Break 10 is what makes the stale-command case a test of the REVISION check.
The revision is checked twice: once in the command service
(`experience/commands.ts`) and once in the engine
(`experience/workflows.ts`). Disabling only the service's check leaves the
engine's, so the case still passes — that is defence in depth, not a gap.
Disabling BOTH lets the stale command through and the case fails, which
proves the case pins the check rather than some other refusal.

The stale case is built to isolate the revision check. The operator DEFERS
the review, so the workflow leaves for `scheduled` and its revision moves on;
the effect then brings it back to waiting, where `acknowledge` is legal
again. Only the revision is now wrong, so the refusal can come from nothing
else. An earlier version of the case gave the review first and then sent a
second command, and that version could not tell the revision check from the
status guard — the workflow was already `completed`, so any command was
refused. The defer-and-return shape is what makes the case bite.

Break 11 is what makes the keyboard case strong. The question is rendered as
a button, and the card case fails on the focusable count: the question adds
text, never a control.

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

| Check                                                                                                                   | Result                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm vitest run` on the six intelligence suites (boundaries, insight-card, insight-smoke, ui, review-insight, slice-b) | 82 passed                                                                                          |
| `pnpm test` (the whole suite)                                                                                           | 120 files, 1433 passed                                                                             |
| `pnpm --filter web typecheck`                                                                                           | clean                                                                                              |
| `pnpm --filter web migrations:check`                                                                                    | `migration-checksums.json is up to date`                                                           |
| `pnpm format:check`                                                                                                     | 73 tracked files fail, the same 73 as the pristine tree; none of them is a file this phase touched |
| web + worker production build                                                                                           | succeeded                                                                                          |
| bundled worker smoke                                                                                                    | the shipped worker stored the question and the app served it                                       |

### The checks of the repair round

The repair round added assertions and one case; it changed no production
code. The whole suite and the production build were NOT re-run in this round
— the destination gate runs them once, on the integrated feature.

| Command                                                                                                                                                                                                   | Result                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `pnpm exec vitest run apps/web/tests/intelligence-slice-b.test.ts apps/web/tests/intelligence-insight-card.test.ts apps/web/tests/intelligence-ui.test.ts apps/web/tests/intelligence-boundaries.test.ts` | 4 files, 51 passed, exit 0, 16 s           |
| `pnpm --filter web typecheck`                                                                                                                                                                             | clean, exit 0, 19 s (95 s on the cold run) |

The format failures are pre-existing, and the count is measured, not
remembered: a pristine worktree at the parent commit fails the same 73
TRACKED files. The working tree shows 78 in total, and the extra five are
untracked local artefacts (four generated Tauri schema files and the local
scout brief), which git does not track and CI does not see. Every file this
phase touched is Prettier-clean, the phase report included.

### The bundled-worker smoke

`apps/web/tests/intelligence-insight-smoke.test.ts` drives the ARTIFACT, not
the source. It builds the worker bundle the way the release builds it
(`scripts/build-worker.mjs`), seeds a synthetic journal with the
application's own modules (an account, the provider settings, the background
policy and one live trade change), points the journal at a loopback provider
stub, starts the bundle as its own process and then:

1. the worker reported `{"type":"ready"}` and took its lease (the lease row
   is read back from the journal);
2. it consumed the capability job, asked the provider exactly once and stored
   the question in `intelligence_insights` — the provider count is checked
   again after a wait, so a second call would be seen, and the stored row
   count is checked too;
3. the app's scoped GET was called against the same journal — the review was
   started first, because the question is served where a review waits — and
   it answered with the question the worker had stored.

Both halves passed: the bundled worker stored it, and the app served it.

The suite builds the bundle itself because the CI gate runs the tests BEFORE
the application build, so no prebuilt artifact exists when the tests run. The
trade change needs `JOURNAL_EVENT_CAPTURE=1` to reach the worker's outbox —
production capture is off until the historical baseline exists — and the
synthetic case turns it on for itself.

The worker runs in its own process on the platform clock, so the smoke's
waits are real waits; no deterministic time control can reach a separate
process.

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
  writes, so opening the inbox never spends an allowance. Three cases hold
  that: the counts of the runs, the jobs and the attempt reservations, and
  the number of provider calls, are the same before and after the read
  (teeth break 12).

## What is not claimed

- The question is served only where a REVIEW waits. The proof starts the
  review before reading the card; a question with no review waiting is not
  shown, and that is the intended behaviour rather than a gap.
- The reader's account comparison is a second line of defence: the store's
  own filter already refuses a foreign question (teeth break 6a showed this —
  dropping the comparison fails no case). The end-to-end scope claim rests on
  teeth breaks 6 and 8.
- The keyboard case proves the card's controls are still native and named
  while the question is on it. It does not prove an ORDER of navigation
  between two cards: the inbox never had one, and the question adds no
  control to order. What the fifth card case proves is the PAIRING — the
  question sits on the card of the observation it was made from (teeth break 13) — and the pairing is not an order of navigation.
- The bundled-worker smoke proves the shipped bundle asks the provider once
  and stores the question, and that the app serves it. It does not prove the
  bundle against a REAL provider: the endpoint is a loopback stub, so the
  credential path is exercised only as far as the stub answers.

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

**Run 4** covered this pass's test additions and found six defects, five of
them in what this pass wrote. All six are fixed:

1. The report claimed "79 format failures, all on untouched files" while the
   report ITSELF was one of the failures — the new tables were not
   pipe-aligned. The report is Prettier-clean now, and the count is measured
   against a pristine worktree: 73 tracked files fail before this pass and
   the same 73 after it. The extra five the working tree shows are untracked
   local artefacts, which CI never sees.
2. The teeth counts were measured on the 23-case suite, before the two new
   cases landed. Every count in the table was re-measured on the tree this
   report describes; breaks 1, 5 and 6 now fail more cases, because the new
   cases assert a served question too.
3. The smoke's cleanup awaited the child's exit unconditionally. A child
   that died early — exactly the case where the bundle is broken — made
   `once(child, "exit")` wait for an event that had already fired, so the
   smoke hung to its timeout and swallowed the diagnostic. The exit is now
   awaited only while the child is alive, and the failing break reports the
   worker's own output again.
4. The report claimed the worker "took its lease" while nothing read the
   lease row. The smoke now reads it back from the journal.
5. The keyboard case proved only that the controls were native and named,
   so a NEW native button for the question would still have passed it. The
   case now pins the focusable set exactly: one button, the Acknowledge one.
6. The provider count was a snapshot taken at the first stored question, so
   "exactly once" was not durable. The smoke now waits and checks the count
   again, and checks that only one question row exists.

The reviewer confirmed the rest of this pass: the smoke drives the real
artifact (`scripts/build-worker.mjs` produces `worker-entry.cjs`, and only
`worker-entry.ts` starts a worker, so the question can only come from the
bundle); the "the question never crosses the wire inside the command"
assertion is real, because the body is the one the production
`commandRequestBody` builds; the two new command cases are non-vacuous; the
per-file environment variables cannot leak into another suite (vitest runs
one process per file); and the import-graph rules still hold.

**Run 5** found three further defects in this pass's tests, all now fixed:

7. The stale-command case could not tell the REVISION check from the STATUS
   guard. It gave the review first, so the workflow was already `completed`
   and every later command was refused by the status. The case now DEFERS
   the review and lets the effect bring it back to waiting, so the status is
   legal and only the revision is wrong. Teeth break 10 measures it: with
   both revision checks disabled the case fails.
8. The keyboard case's selector omitted `a[href]`, so a native link on the
   card would still have passed it. The selector now covers links.
9. The keyboard case rendered only the masked branch, so a control in the
   UNMASKED branch would still have passed it. It now renders both privacy
   states, each on its own mount, because the provider reads the saved
   preference when it mounts. Teeth break 11 measures it: with the question
   rendered as a button the case fails.

**Run 6** found two claims the suite could not fail. Neither was a defect in
the production code: both were claims the TESTS did not hold.

10. The read guarantee was asserted in prose and in this report, and nothing
    held it. Ten scoped reads, no assertion on the runs, the jobs, the attempt
    reservations or the provider count, and the two provider-free cases never
    read the inbox at all. A GET that enqueued a run and a job would have
    left every case green. The three cases that read the inbox now count all
    four before the read and after it, and the provider-free cases read the
    inbox as well. Teeth break 12 measures it: with the scoped GET enqueuing a
    run, those three cases fail on the run count.
11. The question had to appear on the CORRECT card, and nothing rendered two
    cards at once, so a swap of the pairing would have been invisible. The
    fifth card case mounts the inbox with two observations — one under review
    and carrying the question, one merely offered for review — and pins the
    question to the card of the observation it was made from. Teeth break 13
    measures it: with the inbox picking the observation by position instead
    of by id, the case fails on the wrong trade's facts.

The keyboard case stayed where it was: it was an addition, not a substitute
for the pairing, and break 11 still measures what it measured. Both claims
survive with teeth behind them, and nothing had to be withdrawn — the
Boundaries sentence about the read now has a break under it, and the "not
claimed" section still says the same thing: a navigation ORDER between two
cards is not claimed, and the pairing is not an order.

This round changed NO production code. The breaks were temporary edits, each
restored and each re-measured: the tree this report describes carries the
same `apps/web/src` as the commit before it.

The operations guide carries the same sentence in prose — "Reading the inbox
never asks a provider. The question was asked when the trade changed; opening
the inbox only reads what the journal already stored." (`docs/intelligence-operations.md`).
The guide was NOT changed in this round; the sentence is now held by the
three cases above, and by teeth break 12.
