# Phase 19 — Native inbox and control UI, and the complete Slice B gate

Phase guide row 19 · detailed-plan Task 12 · milestone M5 · schema allocation: **None**

|                       |                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Branch                | `codex/ai-native-journal-p19` (child of the feature worktree)                             |
| Base                  | `14f8ec3aa0451c53c91d9503c2b79425232cdfaf` (verified feature HEAD)                        |
| Plan commit           | `f8f0525c11` — "docs: plan the native inbox and the Slice B gate"                         |
| Implementation commit | `c9849963bb` — "feat: expose controlled intelligence interactions and user settings"      |
| Repair commit         | `148f2c6df6` — "fix: pair the actionable workflow and refuse a duplicate review"          |
| Migrations            | none. `0001`–`0007` are byte-unchanged; no schema, registry or checksum file was touched. |

## What was built

The operator can now open the journal's inbox, see what it noticed, act on it, and decide what the
journal may do on its own. Behind that surface, the observation the journal derived from a trade
now becomes an engagement opportunity in the running code — the chain that was missing.

### The server half

- `apps/web/src/server/intelligence/experience/producer.ts` (new) — the opportunity producer. A pure
  module: no database, no network, no clock of its own. `buildOpportunityRequest` reads one persisted
  observation and the operator's controls and answers either the engagement request the observation
  deserves or the reason it does not deserve one. The switches are read in the order the operator
  reads them: a paused journal raises nothing, a journal without the opt-in raises nothing of its own,
  and an observation that is no longer active is not worth raising. The activity stays `unknown` and
  the lifetime stays the engagement default, because the journal never invents an idle operator and
  never invents a lifetime. The dedup key is the observation's own id, so a repeated delivery of the
  same observation resolves to the same opportunity.
- `apps/web/src/server/intelligence/composition.ts` — the wiring. `produceOpportunityInTx` builds the
  request and engages it **on the transaction the caller already owns**: the worker holds the write
  lock on its own connection, so a second connection would deadlock the journal instead of committing
  the observation and its opportunity together. The trade-observation handler reads the observation
  row back inside the same transaction, by its unique key, and produces the opportunity there — so the
  observation, its evidence links and the engagement decision commit together.
  `produceOpportunitiesForActiveObservations` is the consent path: when the operator grants the opt-in
  or resumes the journal, the insights it already noticed become visible at once. It reads only the
  evidence links of the observations it engages, and it counts the opportunities it actually raised
  rather than the re-engagements.
- `apps/web/src/server/settings.ts` — the two journal switches, persisted in the **existing settings
  key/value table** under `intelligenceProactiveOptIn` and `intelligencePaused` (`"true"`/`"false"`).
  The defaults are `proactiveOptIn: true` and `paused: false`. A patch writes only the keys it names
  and both of them inside one journal transaction, so a crash cannot leave a half-applied operator
  decision.
- `apps/web/src/app/api/intelligence/controls/route.ts` (new) — `GET` answers the served controls;
  `POST` accepts a strict partial patch and answers the merged state. The route follows the Phase 18
  conventions exactly: `401` unauthenticated, `403 origin_denied` on a denied origin, `400
invalid_request` on a body that is not the schema, and a sanitised `500` for an unexpected internal
  error. After a write that leaves the journal allowed to raise insights, the route raises the
  opportunities the journal already holds — best-effort: the controls are saved either way, and the
  failure never leaks its cause to the operator.

### The client half

- `apps/web/src/components/intelligence/inbox.tsx` (new) — the inbox. It reads the observations and
  the opportunities, renders one card per intent, and matches intents to their subject by id, never by
  the position of an array. An observation the journal has not asked about yet gets a **Review**
  button, which is the only way a review workflow comes into being. The intent the route answers when
  a review starts is rendered straight away, so the operator can act on the review they just started,
  and an observation is never offered a second review.
- `apps/web/src/components/intelligence/interaction-card.tsx` (new) — one interaction. It renders the
  subject, the structured observation facts, the evidence references and exactly the actions the
  server authorised: the action ids, the labels and the revision all come from the intent, and the
  client assembles no handle of its own. `correct` reveals a textarea, `defer` a `datetime-local`
  input. A stale answer (`409`) is reported as "This interaction changed" and the list is refreshed;
  it is not retried blindly.
- `apps/web/src/components/intelligence/controls.tsx` (new) — the operator's switches: the proactive
  opt-in and the journal pause, the background-AI policy **read-only** (the AI section stays its one
  editor), the served worker status and the engagement defaults.
- `apps/web/src/components/shell.tsx` — the inbox mounts from the sidebar through the existing
  `Sheet`.
- `apps/web/src/app/settings/page.tsx` — a new "Intelligence" section hosting the controls.
- `apps/web/src/lib/intelligence-interactions.ts` — the client DTOs (`ObservationSummary`,
  `OpportunitySummary`, the two response shapes, the controls and the status) and the two request
  builders: `commandRequestBody` builds exactly the strict command schema from the server-issued
  intent and action descriptor, and `dismissalRequestBody` parses the server-issued action id and
  takes both the scope and the target from it. The module imports no server and no database code.
- `apps/web/src/lib/use-api.ts` — `ApiError` carries the HTTP status, so the inbox can tell a stale
  revision from another refusal; `postJson` throws it. A body it cannot read is a failure reported by
  status, not an empty answer.

### The privacy and keyboard rules

Money reaches the DOM only through `MonetaryValue`. The server composes an observation review's
`text` as `"<status> trade, net <netP&L> <currency>."` — that string carries the raw net P&L in plain
characters, which the overlay cannot mask, so the card renders the structured facts instead and never
the composed text. Every control is a native `button`, `input` or `textarea` with an accessible name
and a visible focus ring.

## The commands, and what they proved

| Command                                                                                                                                                                                                                                                        | Exit | Result                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------- |
| `pnpm exec vitest run apps/web/tests/intelligence-ui.test.ts apps/web/tests/intelligence-slice-b.test.ts`                                                                                                                                                      | 0    | 2 files, 23 tests passed (10 UI, 13 gate)                         |
| `pnpm --filter web typecheck`                                                                                                                                                                                                                                  | 0    | `next typegen` + `tsc --noEmit` clean                             |
| `pnpm exec vitest run apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/intelligence-routes.test.ts apps/web/tests/intelligence-workflows.test.ts apps/web/tests/intelligence-engagement.test.ts apps/web/tests/intelligence-observations.test.ts` | 0    | 5 files, 107 tests passed                                         |
| `pnpm exec vitest run apps/web/tests`                                                                                                                                                                                                                          | 0    | 101 files, 1131 tests passed, run against the committed tree      |
| `pnpm exec vitest run apps/web/tests/intelligence-ui.test.ts apps/web/tests/intelligence-slice-b.test.ts` (after the repair)                                                                                                                                   | 0    | 2 files, 27 tests passed                                          |
| `pnpm --filter web typecheck` (after the repair)                                                                                                                                                                                                               | 0    | `next typegen` + `tsc --noEmit` clean                             |
| `pnpm exec vitest run apps/web/tests/intelligence-routes.test.ts` (after the repair)                                                                                                                                                                           | 0    | 1 file, 21 tests passed — the Phase 18 route contract still holds |
| `pnpm exec prettier --check <the 13 phase files>`                                                                                                                                                                                                              | 0    | every phase file is Prettier-clean                                |

The repository-root `pnpm typecheck` still fails in the `desktop` Rust package on this host (the
Tauri sidecar binary is not tracked); `pnpm --filter web typecheck` — the scope of this phase — is
exit 0. `pnpm format:check` is red at HEAD with 74 pre-existing offenders; no phase file adds to it.

## The gate

`apps/web/tests/intelligence-slice-b.test.ts` runs the chain on a scratch journal with real SQLite
and fake time:

1. **The running path** — a committed trade change, the worker, the observation and the opportunity
   appear together, and the engagement decision routes it to the inbox (`activity_unknown`, never a
   proactive delivery: the journal does not know the operator is idle).
2. **The producer's idempotence** — a repeated delivery of the same event raises no second
   opportunity.
3. **The controls** — a paused journal raises nothing, a journal without the opt-in raises nothing,
   and a journal with both raises exactly one opportunity.
4. **The controls route** — the served defaults, the merged patch, the persisted rows, `401` without
   a session, `403` on a foreign origin and `400` on a body that is not the schema, each refusing to
   persist anything.
5. **The operator's command** — a correction is written to the transition history, to the command
   ledger and to the workflow's self report.
6. **A dismissed insight** — a later engagement of the same subject stays suppressed.
7. **The provider-free chain** — the whole chain runs with no AI provider configured; nothing reaches
   for a provider.
8. **A restart before the continuation** — the journal is closed, its globals dropped, the modules
   re-imported and the journal reopened on the same data directory; the pending effect then applies
   **exactly once** (one `present` transition) and applying it again changes nothing.

The ten design §18 Slice B cases map onto the suites as follows: no configured AI provider (case 7
here), unsupported model capability and provider timeout (the Phase 13 provider-policy suite), duplicate
generated outcome (case 2), dismissed insight (case 6), deferred engagement (the Phase 16 workflow
suite), user correction (case 5), interrupted workflow (case 8), stale or duplicate UI action (the
Phase 18 route suite and the UI suite), and application restart before workflow continuation (case 8).

### The proof that the tests have teeth

Every behaviour above was broken once, the named test was seen to fail, and the file was restored:
the producer ignoring the pause; the producer ignoring the opt-in; an unstable dedup key; a workflow
effect that does not advance the status; the card rendering the composed intent text; the card
dropping the `409` refusal; the inbox not rendering the review it started; the controls route
accepting an unknown key. Each break failed its test and nothing else.

The pairing repair is broken the same way: the route's pairing of the review that waits was reverted to
the first review of the observation — the defect itself — and the gate was run. The broken run exited
`1`; the restored run exited `0`, and the file was restored byte-for-byte before the second run.

## The review and its findings

One implementation review, per the phase budget. The report is `.omp/reviewer-report.md`
("## Verdict: PASS"), with the findings and their resolutions recorded in the same file.

- **MAJOR — the inbox re-offers a review that is already finished, and the second review is never
  shown.** The defect was real and it lived half in Phase 18's route, which this phase did not own:
  the GET paired the FIRST workflow of a subject, and the POST started a new review even when one
  existed. The coordinator confirmed the finding and granted the ownership of the two route files
  (`msg_73aea0f05530`, decision A), and the server-side fix is in `148f2c6df6` ("fix: pair the
  actionable workflow and refuse a duplicate review"):
  - the surface pairs the review that WAITS for the operator, not the first one, so a review the
    operator already gave no longer hides the review that is due;
  - every observation answers with its review state — `unreviewed`, `live` or `reviewed` — so the
    client knows after a reload which observations already carry a review and never offers one again;
  - a second review of a live or given observation is refused with `409 review_already_started` and
    writes nothing; an abandoned review holds nothing, so the observation may be reviewed again.

  The residual named by the first version of this report — that after a reload one more workflow row
  could still be started — no longer holds: the server refuses the duplicate start, so no row leaks.
  The client-side mitigation stays (the session's list of the observations it put up for review, and
  the intent the POST answered with), and the two agree.

- The seven MINOR findings — a duplicated background-policy shape, an unreadable success body, two
  producer inputs no caller sets, the whole evidence table read in the consent path, a count that
  counted re-engagements, two switches written in two statements, and two unformatted files — are all
  fixed.

## Deviations from the plan

1. **The optional-AI node of the design chain is not wired.** The chain's AI leg has no persisted
   home in the current schema (an opportunity carries no text) and a provider call may not happen
   inside a write transaction. The producer is therefore deterministic and provider-free, which makes
   the no-provider path the only path — the requirement the phase must prove. Wiring an AI-assisted
   insight needs a place to store it: a Phase 20 input.
2. **A deferred workflow does not resume in production.** The committed worker resolves no handler for
   a `workflow_effect` job, so the job that wakes a deferred workflow is never run. The resume leg is
   proven at the engine level in the gate; the handler registration is a Phase 20 input.
3. **The worker status the web process serves is always `null`** — the web process cannot observe the
   separately supervised worker. The card says so plainly rather than guessing.
4. **The deletion of persistent intelligence is Phase 20** (coordinator decision). Phase 19 exposes the
   served deletion only: the dismissal of an opportunity through `POST /api/intelligence/opportunities`.
   The coordinator also granted the producer module, the composition wiring, the controls route and
   the persistence helper during the phase; the execution manifest and the merge allow-list carry
   that grant.

## Next-phase inputs

- The `workflow_effect` job handler in the worker, so a deferred workflow resumes in production.
- A persisted home for an AI-assisted insight, so the optional-AI node of the design chain can be
  wired.
- The deletion of persistent intelligence (the retention phase).

## What Phase 20 gets

- The controls document is served by `GET /api/intelligence/controls` and written by `POST` — the two
  journal switches, persisted in the existing settings table.
- The producer is a pure module with an injected engagement: a new capability that turns an
  observation into an opportunity needs only to build a request and hand it to the coordinator.
- `produceOpportunityInTx` runs an engagement on the caller's transaction, so a producer that runs
  inside a write transaction does not open a second connection.
- The public DTOs and the two request builders live in `apps/web/src/lib/intelligence-interactions.ts`;
  the UI imports them and nothing else from the server side.
- The inbox, the interaction card and the controls are native components over the existing primitives;
  ADR 0003 records that no primitive was added.
- The observation surface pairs the review that waits for the operator and serves each observation's
  review state, so a later surface never offers a review that already exists and never leaks a
  workflow row for one.
