# Phase 19 — Native inbox and control UI, and the complete Slice B gate

Plan of record for T-019. Scope: the phase guide's Phase 19 row — "Task 12 UI and complete Slice B
gate" — with schema allocation **None**.

## Objective

1. **The native inbox and control UI.** The operator sees what the journal noticed, inspects the
   evidence behind it, corrects it, defers it, dismisses it, and controls the two journal switches.
2. **The complete Slice B gate.** The chain *observation → opportunity → policy → user command →
   persisted workflow* runs as a real path in the running code, survives a restart before the
   continuation, applies its completed effect exactly once, and works with no AI provider configured.

## Ownership

| File | Change |
| --- | --- |
| `apps/web/src/lib/intelligence-interactions.ts` | extend: client DTOs and request builders |
| `apps/web/src/lib/use-api.ts` | extend: `ApiError` carrying the HTTP status |
| `apps/web/src/components/intelligence/inbox.tsx` | new: the inbox surface |
| `apps/web/src/components/intelligence/interaction-card.tsx` | new: one interaction and its authorized actions |
| `apps/web/src/components/intelligence/controls.tsx` | new: the journal controls |
| `apps/web/src/components/shell.tsx` | wire the inbox into the shell |
| `apps/web/src/app/settings/page.tsx` | new "Intelligence" section hosting the controls |
| `apps/web/src/server/intelligence/experience/producer.ts` | new: the opportunity producer |
| `apps/web/src/server/intelligence/composition.ts` | the producer's wiring |
| `apps/web/src/server/settings.ts` | persist the controls in the existing settings table |
| `apps/web/src/app/api/intelligence/controls/route.ts` | new: read and write the controls |
| `apps/web/tests/intelligence-ui.test.ts` | new: keyboard and privacy |
| `apps/web/tests/intelligence-slice-b.test.ts` | new: the Slice B gate |

The producer module and the controls route were granted by the coordinator during the phase (the
option-A decision): the opportunity producer and its wiring, one controls route, and the persistence
helper in `server/settings.ts`. **Nothing else.** No other route and no other file under `app/api/`
changes. No schema change, no migration, no new dependency. The Phase 13 background policy schema is
untouched.

## Contracts

Only the served Phase 18 surfaces are consumed. The client never invents an action id, a revision or
a scope.

### Commands — `POST /api/intelligence/commands`

Body (`interactionCommandRequestSchema`, strict):

```jsonc
{
  "actionId": "act:<workflowId>:<action>:<revision>", // from intent.actions[].actionId
  "commandId": "<client-minted idempotency key, 1..200 chars>",
  "expectedRevision": 3,                                 // from intent.expectedRevision
  "action": "acknowledge" | "correct" | "defer" | "cancel",
  "correction": "…",             // action=correct only, the operator's text
  "deferUntil": 1800000000000   // action=defer only, the instant the operator picked
}
```

`expectedRevision` exists only on the `observation-review` and `input-request` intents; the `status`
intent carries no revision and never sends a command. `correction` and `deferUntil` are the
operator's input: the server's stricter engine schema requires a correction with `correct` and an
instant with `defer`, and the intent's `defer` descriptor carries neither, so the card asks the
operator for the instant instead of inventing one.

### Dismissals — `POST /api/intelligence/opportunities`

```jsonc
{ "actionId": "act:opportunity:<id>:dismiss", "scope": "opportunity", "target": "<id>" }
```

The action id is the one the server issued in the status intent, and the target is parsed out of
that same action id (`parseInteractionActionId`). For an evidence revision the id comes from the
published builder `evidenceDismissActionId(revisionId)` applied to a **server-issued** revision id
(the opportunity's `evidenceIds`, or the intent's `evidence[].revisionId`); the route re-resolves the
id and refuses a target it does not name. No account scope is sent: the journal is single-user and a
request that names no account covers every account — and a stale account id would otherwise make
every read fail with `403 scope_denied`.

### Controls — `GET`/`POST /api/intelligence/controls`

```jsonc
// GET
{ "controls": { "proactiveOptIn": true, "paused": false } }
// POST
{ "proactiveOptIn": false, "paused": false }  // strict; unknown keys are refused
```

Persisted in the **existing settings key/value table** (no schema change, no migration) under the keys
`intelligenceProactiveOptIn` and `intelligencePaused`, each `"true"`/`"false"`.

* **`proactiveOptIn`** (default `true`) — the journal may raise insights it noticed on its own. With
  it off the producer raises nothing, so the inbox holds only what the operator asked for. The inbox
  is a pull surface: nothing is pushed and no provider is called, so the Phase 17 policy still refuses
  every proactive *delivery* (it never knows the operator is idle).
* **`paused`** (default `false`) — the journal's engagement is paused: the producer raises nothing
  even with the opt-in on, and resuming brings it back.

Route rules, exactly as the Phase 18 routes: authenticated (`401` without a session), same-origin
validation on the mutation (`403 origin_denied`) — the browser sends `Origin` on a same-origin
mutation, so no custom header is added — `400 invalid_request` on a body that is not the strict
schema, and a sanitized `500` for an unexpected error.

### The producer

`apps/web/src/server/intelligence/experience/producer.ts` — a pure module: no database, no network, no
clock of its own. It turns one persisted observation into one engagement request.

```ts
export interface ProducerObservation {
  readonly id: string;
  readonly subjectId: string;
  readonly accountId: string | null;
  readonly status: string;
  readonly evidenceRevisions: readonly string[];
}
export interface ProducerControls {
  readonly proactiveOptIn: boolean;
  readonly paused: boolean;
}
export type ProducerOutcome =
  | { readonly kind: "skipped"; readonly reason: "paused" | "not_opted_in" | "inactive" }
  | { readonly kind: "produced"; readonly request: EngageRequest };
```

Rules, in order: `paused` → skip (`"paused"`); no `proactiveOptIn` → skip (`"not_opted_in"`); the
observation is not `active` → skip (`"inactive"`). Otherwise one `EngageRequest` — dedup key
`observation/<observationId>`, subject `{ type: "observation", id: <observationId> }`, the
observation's evidence revisions, material `"current"`, `actionable: true`, `proactiveOptIn` as
persisted, `activity: "unknown"` (the journal cannot know the operator's trading activity and the
policy never invents an idle state — Phase 17), `context: null`, `eligibleAt` now, `expiresAt` now +
the engagement default expiry.

### The running path

`composition.ts` owns the wiring, and only it may touch concrete adapters:

* **New observations** — the trade-observation handler persists the observation and then produces the
  opportunity **in the same transaction**, with the engagement bound to that transaction, so the
  observation, its evidence links and the engagement decision commit together and no second
  connection is opened while the first holds the write lock.
* **Consent** — granting the proactive opt-in (or un-pausing) produces opportunities for the active
  observations the journal already holds, so the operator sees what it noticed the moment they allow
  it.

`GET /api/intelligence/opportunities` therefore answers with real rows in production, which is what
Phase 18 could not show.

## The UI

### Inbox — `components/intelligence/inbox.tsx`

Reached from the shell (a sidebar button that opens a `Sheet`). It reads
`GET /api/intelligence/observations` and `GET /api/intelligence/opportunities` — **without a scope
parameter**, so a stale account id cannot turn every read into a `403` — and renders one
`InteractionCard` per authorized intent, matched by subject id (never by array position).

* An observation with no review workflow gets a **Review** button → `POST /api/intelligence/observations`
  with the server-issued observation id → the workflow's intent appears.
* An observation with a review workflow renders its `observation-review` intent.
* An opportunity renders its `status` intent (dismiss) and the evidence revisions it rests on.

### Interaction card — `components/intelligence/interaction-card.tsx`

Renders one intent: the subject, the observation facts, the evidence references, and the actions the
server offered (`intent.actions[]` — the labels come from the server).

* Money is rendered from the observation payload through `MonetaryValue`, so the privacy overlay can
  mask it. The server's composed `intent.text` is **not** rendered for an observation review: that
  string carries the net P&L in plain characters, which the overlay cannot mask. The card renders the
  structured facts instead (`tradeStatus`, `netPnl`, `fees`, `currency`, `timingQuality`).
* `correct` reveals a textarea; `defer` reveals a `datetime-local` input.
* A `409` answer is reported as "This interaction changed" and the list is refreshed; it is not
  retried blindly.

### Controls — `components/intelligence/controls.tsx`

Mounted in the new "Intelligence" section of `app/settings/page.tsx`:

* **Proactive insights** — a checkbox writing `proactiveOptIn` through the controls route.
* **Pause journal insights** — a checkbox writing `paused`; while paused the journal raises nothing.
* **Background AI** — the served policy state read-only, with a pointer to the AI section, which stays
  the one editor of that policy.
* **Worker** — the served worker status; the web process serves `worker: null` and the card says so
  plainly rather than guessing.
* **Engagement defaults** — the served daily allowance, cooldown and expiry.

### Keyboard and privacy

Every control is a native `button`, `input` or `textarea`: reachable by Tab, operable by Enter and
Space, with a visible focus ring. Nothing is a `div` with a click handler. Money appears only inside
`MonetaryValue`. The privacy preference is the existing `PRIVACY_KEY` setting, and the preference is
off by default (`privacyPreference(null, null) === false`).

The UI test asserts native semantics — element kind, accessible name, focusability and the handler
behind the control — because a DOM without a browser engine does not turn a key press into a click.

## The Slice B gate — `apps/web/tests/intelligence-slice-b.test.ts`

1. **The running path.** A trade change is recorded, the worker runs it, and the observation and the
   opportunity appear together; the engagement decision routes it to the inbox.
2. **The producer is idempotent.** A repeated delivery of the same event produces no second
   opportunity (the dedup key holds it).
3. **The controls are real.** While paused the producer produces nothing; without the opt-in it
   produces nothing; with both it produces one opportunity carrying the persisted opt-in.
4. **The user command persists knowledge.** The operator corrects the review; `workflow_transitions`,
   `interaction_commands` and `intelligence_workflows.self_report_json` are all written.
5. **Restart before the continuation.** The pending effect survives a restart: the journal is closed
   and reopened, the effect applies **exactly once** — exactly one `present` transition — and applying
   it again changes nothing.
6. **No provider configured.** The whole chain runs with no AI provider configured; the journey never
   reaches for a provider.

The ten design §18 Slice B cases map onto the suites as follows.

| Design §18 case | Where it is proven |
| --- | --- |
| No configured AI provider | this suite, case 6 |
| Unsupported model capability | Phase 13 `intelligence-provider-policy` suite |
| Provider timeout | Phase 13 provider suite |
| Duplicate generated outcome | this suite, case 2 |
| Dismissed insight | this suite, case 3 (dismissal suppresses a later engagement) |
| Deferred engagement | Phase 16 `intelligence-workflows` suite (defer → scheduled) |
| User correction | this suite, case 4 |
| Interrupted workflow | this suite, case 5 (restart before the continuation) |
| Stale or duplicate UI action | Phase 18 `intelligence-routes` suite (409 stale, duplicate command id) |
| Application restart before workflow continuation | this suite, case 5 |

## Verification

```
pnpm exec vitest run apps/web/tests/intelligence-ui.test.ts apps/web/tests/intelligence-slice-b.test.ts
pnpm --filter web typecheck
```

The whole-project `pnpm test` and the destination gate are the coordinator's.

## Deviations and next-phase inputs

* **The optional-AI node of the design chain is not wired.** The chain's AI leg has no persisted home
  in the current schema (an opportunity carries no text) and a provider call may not happen inside a
  write transaction. The producer is therefore deterministic and provider-free, which makes the
  no-provider path the only path — the requirement the phase must prove. Wiring an AI-assisted
  insight needs a place to store it: a Phase 20 input.
* **A deferred workflow does not resume in production.** The worker resolves no handler for a
  `workflow_effect` job, so the job that wakes a deferred workflow is never run. The resume leg is
  proven at the engine level in the gate; the handler registration is a Phase 20 input.
* **The worker status the web process serves is always `null`** — the web process cannot observe the
  separately supervised worker. The card says so plainly.
* **The deletion of persistent intelligence is Phase 20** (coordinator decision). Phase 19 exposes
  the served deletion only: the dismissal of an opportunity or of an evidence revision through
  `POST /api/intelligence/opportunities`.

## Stop condition

The plan is implemented, the two targeted test files and the web typecheck are green, one
implementation review has passed, and the phase report is committed. The candidate stops there; the
merge into `codex/ai-native-journal` is the coordinator's job.
