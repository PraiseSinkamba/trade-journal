# Phase 24 — show the review question, and prove the Slice B chain

## 1. What this phase delivers

Phase A gave the optional-AI leg a home (`intelligence_insights`, migration
0008). Phase B connected that home to a provider: one live trade change
produces one review question, asked through a durable job and stored through
one fenced final transaction.

This phase DISPLAYS the question and PROVES the chain end to end. It does
not redesign the provider leg and does not change it.

What the operator sees: on the review card of an observation, a labelled block
**AI question** with the provider's question. Nothing else changes: the
evidence list, the workflow revision checks and the dismiss/defer/correct
behaviour stay exactly as they are.

Invariants that stand (Phase A/B): one business key
(`insight:<capabilityVersion>:<accountId>:<sourceRevision>`), the
current-revision read inside the store, the 2000-character question bound at
the store boundary, the seven-check fenced final transaction, and the
deterministic path (no provider, no run, no job) staying available.

Out of scope: no migration, no new dependency, no new prompt, no stored
provider response, no change to the provider leg, the worker, the capability,
the policy or the store.

## 2. The presentation DTO

`apps/web/src/lib/intelligence-interactions.ts` gains:

```ts
export interface InsightView {
  readonly question: string;
  readonly sourceRevision: string;
}
```

and the `observation-review` variant of `InteractionIntent` gains
`readonly insight?: InsightView`. The field is optional and absent when the
journal holds no current question for the observation — which includes the
moment the source it was made from is corrected, because the older question is
then no longer served.

The DTO carries the question and the revision it rests on. It never carries a
store row: `InsightRow` (contracts/insights.ts) also holds `businessKey`,
`accountId`, `subjectId`, `observationId`, `capabilityVersion` and `runId`, and
none of those belong on the wire.

## 3. The reader (app layer)

`apps/web/src/app/api/intelligence/queries.ts` gains one exported function. It
lives in the app layer because the app layer is where the scoped surface is
assembled; the CURRENT-REVISION RULE stays in the store, and the reader only
adds the checks the surface owns.

```ts
export const currentInsightOf = (
  observation: {
    readonly id: string;
    readonly subjectId: string;
    readonly accountId: string;
  },
  evidenceRevisionIds: readonly string[],
): InsightView | null;
```

How it reads:

- The store's public surface is used, not its adapter: `createInsightStore()`
  from `@/server/intelligence/infrastructure/insight-store` gives the
  `InsightStore` port, whose `readCurrentInsightInTx(tx, query)` answers
  "the current question of this subject" and already enforces the Phase A/B
  rule (current projection revision, current capability version, observation
  still active, account filter).
- The read runs in ONE DEFERRED transaction on the app's own handle:
  `db.transaction((tx) => store.readCurrentInsightInTx(tx, query), { behavior:
"deferred" })`. Deferred is the right mode for a read: it takes a read
  snapshot and NO write lock, so the GET never blocks the worker. The
  alternative, `withJournalTransaction`, is `immediate` and would take a
  write lock for a read.
- The account is NOT NULL on `intelligence_observations`, so the reader takes
  a non-nullable `accountId`, passes it to the store (the store filters on it
  only when it is non-empty) and compares the returned row's account with it.
- The returned row is checked against the observation it is served for:
  `observationId` must be this observation's id (the question belongs to THIS
  card) and `sourceRevision` must be one of the revision ids the review shows
  as evidence.
- The row is PROJECTED to the DTO: `{ question, sourceRevision }`. Nothing
  else crosses the wire.

## 4. The route (scoped GET)

`apps/web/src/app/api/intelligence/observations/route.ts`: the review intent
is built as today, then the insight is attached.

The intent builder returns the wide `InteractionIntent` union, so the route
narrows it before spreading (spreading the union would not typecheck):

```ts
const built = observationReviewIntent(workflow, references, observationText(row));
if (built) {
  intents.push(
    built.kind === "observation-review" ? { ...built, ...(insight ? { insight } : {}) } : built,
  );
}
```

`insight` is `currentInsightOf(row, references.map((reference) => reference.revisionId))`.
The POST route is untouched: it starts a review and returns the intent it
just created; the question appears on the GET, which is the scoped surface
that lists the review.

The GET stays a read. It never enqueues, never calls a provider and never
writes.

## 5. The card

`apps/web/src/components/intelligence/interaction-card.tsx` renders the
question as LABELLED TEXT, above the evidence, inside the observation-review
branch:

```tsx
{
  intent.kind === "observation-review" && intent.insight ? (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">AI question</p>
      <p className="text-sm">{masked ? "••••" : intent.insight.question}</p>
    </div>
  ) : null;
}
```

The privacy overlay applies. The privacy module offers only `MonetaryValue`
and `MonetaryField`, whose accessible name is "Monetary value hidden" - the
wrong name for a question - and there is no generic text mask, so the card
adds the mask it needs, using the existing `HoverHint` overlay:

```tsx
const masked = usePrivacy();
```

`usePrivacy()` returns the enabled flag only; the card needs nothing else.
The masked state announces "AI question hidden" through the same `HoverHint`
overlay the money uses, so the operator is told what the mask is and how to
lift it.

No new primitive file is added and `components/privacy.tsx` is untouched: the
mask lives in the card, which is the component that renders the question.

## 6. The end-to-end proof

`apps/web/tests/intelligence-slice-b.test.ts` gains the provider leg. The
preconditions the Phase B chain needs, which the proof must set up itself:

- A STORED BACKGROUND POLICY that is enabled and lists the account:
  `composition.saveBackgroundPolicy({ enabled: true, accounts: [ACCOUNT],
capabilities: { tools: false, structuredOutput: false }, maxInputCharacters:
8000 })`. Without it the enqueue refuses and no question is ever produced.
- JOURNAL-SIDE PROVIDER SETTINGS, not only an injected transport:
  `setSetting("aiProvider", "compatible")`, `setSetting("compatibleModel",
MODEL)`, `setSetting("compatibleBaseUrl", SERVER)`. The enqueue gate reads
  the configuration from the journal; an injected transport is only the CALL.
- The REVIEW must be STARTED before the GET serves anything: the scoped GET
  builds an observation-review intent only for a workflow that waits for the
  operator, so the chain is `POST /observations` (start the review) then
  `GET /observations`.

Which worker each case drives:

- The provider cases drive the PRODUCTION registration
  `composition.createIntelligenceWorker({ db, clock, owner, transport })`
  against the OPENED journal handle, because it registers `asyncHandlers`
  (the capability handler) - the Slice B file's own worker has none, so it
  never runs a `run_capability` job. The production registration also carries
  the workflow-effect handler, so it MUST NOT be used in the case that
  asserts the deferred workflow_effect job stays pending; that case keeps
  using the file's own worker.
- The REOPEN case re-imports the route module (and the queries module it
  uses) after the journal is reopened, because the route captures `db` at
  import. It re-imports `../src/db` and the route module, and drives the
  re-imported handler.

Cleanup: the file's `beforeEach` also deletes `intelligenceInsights`,
`intelligencePolicy` and `intelligenceBudgetReservations`, and clears the
provider settings keys (`aiProvider`, `compatibleModel`,
`compatibleBaseUrl`). Without that a stored question, a leftover policy or a
leftover daily attempt leaks into the next case, and the ten-attempts-per-UTC-day
allowance is spent across cases.

The cases:

1. The question is served on the CORRECT card. Two accounts, two trades, two
   distinct answers from the stub transport. Each account's scoped GET serves
   ITS OWN question, and the intent's subject id is the observation's id.
2. The question is linked to its source. The served insight's
   `sourceRevision` equals the observation's `sourceRevision`.
3. A corrected source hides the older question. After the correction the
   scoped GET serves no insight for the superseded observation, while the
   stored row survives (hidden, not deleted).
4. A restart before the workflow continues. The journal is closed and
   reopened on the same directory; the re-imported route still serves the
   question.
5. No provider: no provider settings and no policy. The observation and its
   opportunity are still produced, NO question is stored, and the review is
   still usable (the operator can start it and acknowledge it). Zero provider
   calls.
6. The account is not opted in: the policy exists and is enabled but does not
   list the account. Zero provider calls, no question, and the review is still
   usable.
7. Another account's scope is refused: a scope naming an account that does
   not exist is refused with 403 `scope_denied`, and a scope naming another
   account never serves this account's question.
8. The privacy mask, in the card's own test file: with privacy on, the card
   renders the mask and not the question text; with privacy off, the question
   text is rendered.

The stub transport records its calls, so "zero outbound calls" is asserted on
the transport, not on `fetch`.

## 7. The checks

Targeted first, then the whole gate:

1. `pnpm vitest run apps/web/tests/intelligence-slice-b.test.ts` - the chain.
2. `pnpm vitest run apps/web/tests/intelligence-insight-card.test.ts` - the
   card and the mask.
3. `pnpm vitest run apps/web/tests/intelligence-boundaries.test.ts` - the
   import graph.
4. `pnpm vitest run apps/web/tests/intelligence-review-insight.test.ts` - the
   Phase B provider invariants, unchanged.
5. `pnpm format:check` - the first CI gate.
6. `pnpm typecheck`.
7. `pnpm test`.
8. `pnpm --filter web migrations:check` - no migration, and the check says so.
9. The web and worker PRODUCTION build with a disposable journal directory
   (`JOURNAL_DATA_DIR` pointing at a scratch directory).
10. The BUNDLED WORKER smoke: the built worker artifact is started against a
    synthetic journal with a loopback provider stub; it must start, consume
    the job and the stored result must be served through the app.

The teeth bar: for every behaviour this phase claims, the production code is
broken on purpose, the test is seen to FAIL, the code is restored and the
test is seen to PASS again. Both results go into the phase report.

## 8. Boundaries

- `packages/core` and `packages/importers` are untouched.
- The reader reaches the store's public factory from the APP layer
  (`apps/web/src/app/api/intelligence/`), which already owns the journal
  queries (`queries.ts` reads `db` today). The server's own layering is
  unchanged: no domain module gains an import, `composition.ts` still wires
  the store, and the store still owns the current-revision rule.
- The client layer (`apps/web/src/lib`, `apps/web/src/components`) gains no
  import of server code or the database. `intelligence-interactions.ts` stays
  plain data; the card imports only `usePrivacy` and `HoverHint`.
- `apps/web/src/lib/intelligence-interactions.ts` holds the DTO, so the
  question's shape is declared once and both the route and the card use it.

## 9. The operations document

`docs/intelligence-operations.md` gains what an operator can now see and what
they can check:

- In the background review-question job section: the question is served on
  the observation's review card, it is masked while privacy mode is on, and
  the card shows it only where the review waits.
- In the troubleshooting list: a question that is stored but not served. The
  three reasons are the current-revision rule (the source was corrected), the
  observation's status (it is no longer active) and the capability version.
  The policy is NOT one of them: the policy decides whether a question is
  asked and stored, not whether a stored one is shown.
