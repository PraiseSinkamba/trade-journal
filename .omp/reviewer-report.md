## Verdict: PASS

Review of the uncommitted Phase 19 implementation against `docs/superpowers/plans/ai-native-journal/phase-19.md`
(HEAD `f8f0525c11`). No BLOCKER. One MAJOR defect and seven MINOR findings are listed below; the
MAJOR one is a real loop the operator can hit, and it is fixable inside this phase's ownership.

---

## Findings

### MAJOR — The inbox offers "Review" again for an observation whose review is already finished, and the second review is never shown

- `apps/web/src/components/intelligence/inbox.tsx:63-67`
- `apps/web/src/app/api/intelligence/observations/route.ts:51`
- `apps/web/src/app/api/intelligence/observations/route.ts:93-109`

**What is wrong.** The inbox derives "this observation has been reviewed" from the intents the server
served:

```ts
const reviewed = new Set(
  intents
    .filter((intent) => intent.kind === "observation-review")
    .map((intent) => intent.subject.id),
);
```

An `observation-review` intent exists only while the workflow is `waiting_for_user`
(`apps/web/src/server/intelligence/experience/intents.ts:79` returns `null` otherwise). The moment the
operator acknowledges or cancels, the workflow leaves `waiting_for_user`, the intent disappears, and
the observation — whose own status stays `active` — falls out of the `reviewed` set. The inbox then
renders the "Review" button for it again.

`POST /api/intelligence/observations` does not refuse that: it looks the observation up by id
(`findActiveObservation`, line 93), which only checks `status === "active"`, and then starts a fresh
workflow (line 98). The workflow for the same observation is now duplicated.

The duplicate is then invisible. The GET route pairs each observation with the *first* workflow it
finds for that subject:

```ts
const workflow = workflows.find((candidate) => candidate.subjectId === row.id);
```

`listWorkflows` returns every workflow for the subject, and `find` takes the first, so the stale
`completed` workflow wins over the new `waiting_for_user` one. `observationReviewIntent` then returns
`null` for it, so the operator gets no review card for the review they just started.

**Trigger and impact (verified in a real browser against the running app).** Acknowledge a review, then
open the inbox:

- The "Review" button is offered again for the observation that was just reviewed (`count=1`).
- Clicking it starts a second workflow for the same observation. The journal database afterwards holds
  three workflows for `obs-1`: `completed`, `waiting_for_user`, `waiting_for_user`.
- The GET surface still serves no review intent for `obs-1` (`intents` = `["observation-review:obs-2"]`
  only), so the operator can never act on the second review.

Every acknowledge/cancel/review cycle therefore leaks one workflow row and one unreachable interaction.
The plan's own rule — "An observation with no review workflow gets a **Review** button" — is what the
client breaks: it must mean *no review workflow at all*, not *no live review intent*.

**Fix.** The client cannot distinguish the two cases from the served surface alone, because the surface
exposes intents but not workflows. Two changes, both small:

1. Serve the review state per observation. In `apps/web/src/app/api/intelligence/observations/route.ts`,
   include the observation's review workflow (id and status) in each `observations` row — the route
   already loads those workflows at line 43 — and let the client mark the observation reviewed when
   *any* workflow exists for it, not only when a live intent was served.
2. Make the pairing deterministic and correct: pick the workflow the operator can act on
   (`status === "waiting_for_user"`) rather than the first row returned (line 51). With one workflow per
   observation this changes nothing; with two it is the difference between a visible review and a lost
   one.

Guard the POST route against the duplicate as well: if the observation already has a workflow, refuse
the second start rather than writing another one. The Phase 19 route owns the inbox surface, but this
route is Phase 18 and outside this phase's ownership — the coordinator's call whether the fix lands
here or in Phase 20.

---

### MINOR — `controls.tsx` redeclares the background-policy shape and fetches a second endpoint for it

- `apps/web/src/components/intelligence/controls.tsx:25-35`
- `apps/web/src/components/intelligence/controls.tsx:40`
- `apps/web/src/lib/intelligence-interactions.ts:279-291`

The component declares its own `BackgroundAiPolicy` interface and fetches `/api/settings` for
`backgroundAi`, while the same patch adds `BackgroundPolicyView` to the client contract module and
`IntelligenceStatusResponse.status.backgroundPolicy` — served by `GET /api/intelligence/status`, which
the component already fetches at line 39. The result is a duplicated type and a redundant request.

Fix: use `status.data?.status.backgroundPolicy` and drop the local interface and the `/api/settings`
fetch. The comment at lines 19-24 ("the client layer never imports server contracts") is stale in any
case: `BackgroundPolicyView` in `@/lib/intelligence-interactions` is exactly that contract, and the
client module already imports from it.

### MINOR — `postJson` now swallows a non-JSON success body instead of failing

- `apps/web/src/lib/use-api.ts:96`

`await response.json().catch(() => ({}))` turns a successful but non-JSON response into `{}`. A route
that answers `200` with an empty or non-JSON body would read as a successful write that returned no
data, instead of the parse error the caller used to see. The intent of the change — reporting a failed
request by status — only needs the guard on the error path.

Fix: parse the body as before on the success path, and use the `{}` fallback only when the response is
not `ok`:

```ts
if (!response.ok) {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  throw new ApiError(data.error ?? `Request failed (${response.status})`, response.status);
}
return (await response.json()) as T;
```

### MINOR — The producer exposes inputs no caller ever sets

- `apps/web/src/server/intelligence/experience/producer.ts:54-57`
- `apps/web/src/server/intelligence/experience/producer.ts:77`
- `apps/web/src/server/intelligence/experience/producer.ts:80`

`activity` and `expiryMs` are optional and unused: no caller in `composition.ts` or the gate passes
either. The plan fixes the behaviour outright — activity is always `"unknown"` and the expiry is the
engagement default — so these are speculative parameters on a pure function.

Fix: drop both parameters and hardcode `activity: "unknown"` and
`expiresAt: now + ENGAGEMENT_DEFAULTS.opportunityExpiryMs`.

### MINOR — The consent path loads the whole evidence table and filters it in JavaScript

- `apps/web/src/server/intelligence/composition.ts:730`
- `apps/web/src/server/intelligence/composition.ts:733-739`

`db.select().from(observationEvidence).all()` reads every evidence row in the journal, then filters it
per observation in a loop — O(observations × evidence rows). The running path does it correctly with a
scoped query (`composition.ts:239-242`, filtered by `observationId`).

Fix: query the links for the observation ids in scope, as the running path does.

### MINOR — "Raised" counts re-engagements, not new opportunities

- `apps/web/src/server/intelligence/composition.ts:746`

`if (engagement.decision.outcome !== "suppress") raised += 1` counts every non-suppressed engagement,
including a re-engagement of an opportunity that already exists. The function is named for what it
raises, so the number overstates its meaning: an operator who toggles the controls twice with the same
observation held sees a "raised" count for work that was already done.

Fix: count only engagements that created a new opportunity row (compare the row id before and after),
or rename the return value to what it actually is.

### MINOR — The two control switches are written in two separate statements

- `apps/web/src/server/settings.ts:339-341`

`setIntelligenceControls` writes `intelligenceProactiveOptIn` and `intelligencePaused` with two
independent `setSetting` calls, each its own transaction. A crash between them leaves the journal
paused but still opted in, or vice versa — a half-applied operator decision. The rest of the file
uses `setSettingInTx` inside a transaction for exactly this reason.

Fix: write both keys inside one `withJournalTransaction` with `setSettingInTx`.

### MINOR — Two new files fail `prettier --check`

- `apps/web/src/server/intelligence/experience/producer.ts:1-4`
- `apps/web/tests/intelligence-slice-b.test.ts:60`
- `apps/web/tests/intelligence-slice-b.test.ts:165-166`

CI runs `pnpm format:check` (`.github/workflows/ci.yml`), and these two files are not formatted to the
repo's Prettier config: a wrapped import that should be one line, and two expressions that should not
be wrapped. The repo baseline is already red on `format:check` (76 files at HEAD, before this patch),
so this is not a new break of a green gate — but these two files are new and should not add to it.

Fix: run `pnpm exec prettier --write` on the two files.

---

## Verified as correct (no action)

- **Contract conformance.** `commandRequestBody` builds exactly `interactionCommandRequestSchema`
  (strict): `actionId` and `expectedRevision` come from the server-issued intent and its descriptor,
  `commandId` is client-minted (as the plan specifies), and `correction`/`deferUntil` are only ever
  attached to the matching action. `dismissalRequestBody` parses the server-issued action id and
  takes both the scope and the target from it, so no scope or target is invented. The client sends no
  account scope, so a stale account id cannot turn a read into a `403`.
- **Privacy.** Money reaches the DOM only through `MonetaryValue` (`interaction-card.tsx:69,73`). The
  composed `intent.text` is never rendered on any path — confirmed in the browser: the dialog text
  contains `+€987.65` with privacy off, `••••` with privacy on, and never `win trade, net`. No money
  appears in an attribute, title or aria-label.
- **Keyboard and focusability.** The inbox trigger, the sheet and the switches are native elements
  with focus rings; in the browser the Inbox button is a focusable `<button>` with `aria-haspopup="dialog"`,
  focus moves into the sheet on open, Escape closes it and restores focus, and the switch is a
  focusable `<button role="checkbox">` with an associated `<label>`. Space toggles it.
- **Producer wiring and the transaction seam.** `produceOpportunityInTx`
  (`composition.ts:687-709`) binds the engagement to the caller's transaction through the
  `runOnAmbientTransaction` shim, so no second connection is opened while the worker holds the write
  lock. The observation is read back inside the same transaction by its unique key
  (`composition.ts:214-236`), so a repeated delivery resolves to the same dedup key. The producer stays
  inside the experience domain (`../contracts/experience` and a type-only import from `./interactions`),
  and the boundaries suite enforces it.
- **Route conventions.** The controls route follows the Phase 18 shape: `handler` with `sanitize` on
  GET (401 unauthenticated, no origin check on a read) and `origin` + `sanitize` on POST (403
  `origin_denied`, 400 `invalid_request`, sanitised 500). Verified in the browser: an unauthenticated
  mutation is refused, and the origin policy behaves exactly as it does on the Phase 18 mutating routes.
- **Boundaries.** `apps/web/src/lib/**` and `apps/web/src/components/**` import no `@/server` and no
  `@/db`. No schema change, no migration, no new dependency. No Phase 13 background-policy change. No
  route other than the new controls route is touched. The Phase 18 surfaces, the AI screens and the
  import/AI JSON contracts are untouched.
- **Test quality.** The gate pins durable rows, not internals: the restart case asserts the
  PRESENT-transition count is exactly one (`intelligence-slice-b.test.ts:495`) and that re-applying the
  effect changes nothing; the controls case shows zero opportunities while paused and zero without the
  opt-in, then one with both (`:318-337`); the no-provider case shows no run row and no `fetch` call
  (`:436-437`). The UI test asserts native semantics, accessible names, focusability, the masked money
  and the exact request bodies.

---

## Commands run

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm exec vitest run apps/web/tests/intelligence-ui.test.ts apps/web/tests/intelligence-slice-b.test.ts` | **0** | 2 files, 16 tests passed |
| `pnpm --filter web typecheck` | **0** | `next typegen && tsc --noEmit` — route types generated, no diagnostics |
| `pnpm exec vitest run apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/intelligence-routes.test.ts apps/web/tests/intelligence-workflows.test.ts apps/web/tests/intelligence-engagement.test.ts apps/web/tests/intelligence-observations.test.ts` | **0** | 5 files, 107 tests passed |
| `pnpm exec prettier --check <13 changed/new files>` | **1** | 2 offenders: `producer.ts`, `intelligence-slice-b.test.ts` |
| `pnpm format:check` (repo-wide) | **1** | 76 offenders, of which 74 are pre-existing at HEAD; the 2 new ones are listed above |
| `pnpm --filter web dev` (port 3111, scratch `JOURNAL_DATA_DIR`) | started | dev server up, used for the browser run below |
| `curl` the four intelligence endpoints (200) + `POST /api/intelligence/controls` with `Origin: http://localhost:3111` (200) | 0 | controls persist and are read back as `{"proactiveOptIn":true,"paused":true}` |
| Browser (headless Chrome via `playwright-core`, installed outside the repo in a temp dir) — 4 runs, 48 assertions | 0 | **44 passed, 4 failed**; all 4 failures were defects in my own test script (wrong privacy key, reading the switch before the fetch settled, and `127.0.0.1` vs `localhost` in the origin check) — each was corrected and the corrected run is green. The last run is 17/17 on the inbox, and 4/4 on the review loop that produced the MAJOR finding above |

No file in the repository was modified by this review except `.omp/reviewer-report.md` itself; the
browser tooling and the scratch journal were created outside the repo tree.

---

## The findings and what was done about them

Every finding above was addressed before the implementation commit. The phase budget allows one
review of the implementation diff, so the resolutions are recorded here rather than in a second
report.

### MAJOR — the inbox re-offers a review that is already finished

The defect is real and it lives half in Phase 18's route, which this phase does not own: the GET
pairs the FIRST workflow of a subject, and the POST starts a new review even when one exists. The
coordinator was asked for the ownership to fix it server-side (`msg_dc600a06763b`, options A/B/C).

What ships now is the client half of the fix, which is inside this phase's ownership:

- **The inbox renders the intent the POST answers.** The route answers the intent of the workflow it
  just started, with its own server-issued action id and revision. The inbox keeps that intent and
  shows it as an actionable card, so the operator can act on the review they just started even though
  the GET may pair a different workflow of the same observation.
- **The inbox never offers a second review of the same observation.** The client keeps the ids of
  the observations it put up for review and does not offer "Review" again, so the workflow leak
  cannot happen through this surface while the session lives.

The residual is named: after a reload the client no longer knows the observation was reviewed, so one
more workflow row can still be started for it. The operator gets an actionable review; the row leaks.

The server-side pairing (serve the observation's review state, pair the actionable workflow, refuse
a duplicate start) stays a Phase 20 input unless the coordinator grants the ownership.

### The seven MINOR findings

- The controls surface reads the background policy from the status surface it already fetches; the
  local copy of the shape, the second endpoint and the local type are gone.
- `postJson` no longer turns a body it cannot read into an empty answer: an unreadable success is a
  failure reported by status.
- The producer takes only what a caller sets: `activity` and `expiryMs` are gone, and the journal's
  values (`unknown`, the engagement default expiry) are hard-wired with the reason.
- The consent path reads only the evidence links of the observations it engages.
- The consent path counts the opportunities it actually raised, not the re-engagements.
- Both control switches are written inside one journal transaction.
- Both new files are Prettier-clean.

### The proof that the tests have teeth

Each behaviour was broken once, the named test was seen to fail, and the file was restored:

| Broken behaviour                                                        | Test that failed                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| the producer ignores the pause                                          | `the controls > raises nothing while the journal is paused…`    |
| the producer ignores the proactive opt-in                                | the same case                                                     |
| the producer's dedup key is not stable                                  | `the producer's idempotence > raises no second opportunity…`    |
| the workflow effect does not advance the status                          | `a restart before the continuation > applies the pending effect exactly once` |
| the card renders the composed intent text                                | `masks the money while privacy is on…`                          |
| the card drops the 409 refusal                                          | `reports a stale answer as a change and does not retry it`       |
| the inbox does not render the review it started                          | `shows the review it started and never offers that review again` |
| the controls route accepts an unknown key                               | `the controls route > refuses a body that is not the schema…`   |

