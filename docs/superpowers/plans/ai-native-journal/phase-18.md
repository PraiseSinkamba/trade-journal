# Phase 18 — Authenticated interaction and control APIs

> Phase guide row 18: *Authenticated interaction/control APIs* — Task 12 backend
> routes/origin checks only. Schema allocation: **None**. Milestone M5.
>
> This phase is the **backend half** of detailed-plan Task 12. Phase 19 owns the
> React inbox/control UI and the complete Slice B gate, under the same Task 12.

## Objective and outcome

The journal can now be *told what to do* by the operator, over HTTP, safely.

This phase delivers the authenticated server surface of the intelligence
interaction loop: a read surface that hands the operator the interactions that
are live, and a write surface that applies the operator's decisions to durable
state. The decisions are workflow commands (acknowledge, correct, defer,
cancel) and engagement dismissals.

The outcome is:

- `apps/web/src/lib/intelligence-interactions.ts` — the public DTOs
  (`InteractionIntent` and friends) and the strict request schemas. Public DTOs
  only: no server import, no database import (contract review §2).
- `apps/web/src/app/api/intelligence/{observations,opportunities,commands,conversations,status}/route.ts`
  — thin route handlers over strict schemas.
- `apps/web/src/server/request-origin.ts` — the same-origin policy for new
  mutating routes, with an explicit trusted-nonbrowser policy for a missing
  `Origin` header.
- `apps/web/src/server/api.ts` — the handler wrapper grows the two things the
  new routes need: an origin check and sanitized unexpected errors.
- `apps/web/src/server/intelligence/composition.ts` — the wiring point: the
  workflow engine, the engagement coordinator and the interaction read model
  become reachable from the routes.

The server decides what an action may do. A payload that names an action is a
*request to be authorized*, never an authorization (modernization plan Task 12;
design §15).

## Scope in

- The route families above, their DTOs, their strict request schemas.
- The origin policy and the authenticated handler wiring.
- The scope policy: which accounts a request may read and act on.
- The command service: action resolution, scope check, stale check, dispatch to
  the Phase 16 workflow engine, and the mapping to `WorkflowResult`.
- The engagement dismissal path (Phase 17 coordinator).
- The status surface the backend serves: the background policy view, the worker
  status and the engagement defaults.
- `apps/web/tests/intelligence-routes.test.ts`.

## Scope out

- **All React work.** No file under `apps/web/src/components/intelligence/`, no
  change to `apps/web/src/components/shell.tsx`, no change to
  `apps/web/src/app/settings/page.tsx`. That is Phase 19.
- **No schema change.** No migration, no `db/schema.ts` change, no registry or
  checksum change. Migrations `0001`–`0007` stay byte-unchanged.
- No change to the existing Ask/Reports/Recap/Critique/Import JSON contracts.
- No provider, credential, cTrader, financial-hash or import behaviour change.
- No new dependency; no ADR is needed.
- No observation→opportunity production wiring: the opportunity *producer* is
  Phase 19's Slice B. Phase 18 exposes the opportunity surface and the
  dismissal path.

## Storage model (no migration)

Everything this phase reads or writes already exists in migration `0007`:

| Table | Used for |
| --- | --- |
| `intelligence_observations` | the active observations a review is about |
| `observation_evidence` | the evidence revisions behind an observation |
| `intelligence_workflows` | the durable workflow a command acts on |
| `workflow_transitions` | the audit trail of every applied command |
| `interaction_commands` | the idempotency ledger of every command |
| `intelligence_opportunities` | the inbox items and their dismissals |
| `intelligence_conversations` / `intelligence_messages` | the conversation surface |
| `intelligence_policy` | the background policy document the status surface serves |

The account foreign keys cascade: deleting an account purges its workflows,
opportunities, conversations and observations in the same statement. The purge
race this phase must survive follows from that.

## Contracts

### `apps/web/src/lib/intelligence-interactions.ts` (public DTOs)

This module is imported by the client and by the server. It holds **only**
public DTOs and their schemas: no `@/server`, no `@/db`, no server contract
import (contract review §2, and the rule-3 import guard).

```ts
/** The actions an interaction may offer. */
export const INTERACTION_ACTIONS = [
  "acknowledge",
  "correct",
  "defer",
  "cancel",
  "dismiss",
] as const;
export type InteractionAction = (typeof INTERACTION_ACTIONS)[number];

/** The surfaces an interaction may be offered on. */
export const INTERACTION_SURFACES = ["inbox", "contextual", "proactive"] as const;
export type InteractionSurface = (typeof INTERACTION_SURFACES)[number];

/** The subject an interaction is about. */
export interface InteractionSubject {
  readonly type: string;
  readonly id: string;
}

/** One piece of evidence an interaction rests on. */
export interface EvidenceReference {
  /** The immutable revision the evidence rests on. */
  readonly revisionId: string;
  /** The kind of evidence, for presentation. */
  readonly kind: string;
}

/** What an input request accepts. */
export interface InputConstraint {
  readonly kind: "text";
  readonly minLength: number;
  readonly maxLength: number;
  readonly required: boolean;
  readonly hint?: string;
}

/**
 * One authorized action.
 *
 * The action id is issued by the server and encodes the workflow, the action
 * and the revision it was issued at. It is a handle, not a permission: the
 * server re-resolves it against its own state before it acts.
 */
export interface IntentActionDescriptor {
  readonly actionId: string;
  readonly action: InteractionAction;
  readonly label: string;
  readonly requiresInput: boolean;
}

/**
 * A structured interaction intent (design §15).
 *
 * A strict union of the three shapes an interaction may take. The server
 * supplies the action ids, the expected revision, the text, the evidence
 * references and the input constraints (modernization plan Task 12).
 */
export type InteractionIntent =
  | {
      readonly kind: "observation-review";
      readonly intentId: string;
      readonly workflowId: string;
      readonly expectedRevision: number;
      readonly subject: InteractionSubject;
      readonly text: string;
      readonly evidence: readonly EvidenceReference[];
      readonly actions: readonly IntentActionDescriptor[];
    }
  | {
      readonly kind: "status";
      readonly intentId: string;
      readonly surface: InteractionSurface;
      readonly subject: InteractionSubject;
      readonly status: string;
      readonly updatedAt: number;
      readonly text: string;
      readonly actions: readonly IntentActionDescriptor[];
    }
  | {
      readonly kind: "input-request";
      readonly intentId: string;
      readonly workflowId: string;
      readonly expectedRevision: number;
      readonly subject: InteractionSubject;
      readonly prompt: string;
      readonly input: InputConstraint;
      readonly actions: readonly IntentActionDescriptor[];
    };
```

The action id format is server-owned and stable:

| Intent | Action id |
| --- | --- |
| workflow action | `act:<workflowId>:<action>:<revision>` |
| opportunity dismissal | `act:opportunity:<opportunityId>:dismiss` |
| evidence dismissal | `act:evidence:<revisionId>:dismiss` |

A malformed action id is a client error (`400`), never a lookup that guesses.

Request schemas (strict; an unknown key is an error):

```ts
export const interactionCommandRequestSchema = z
  .object({
    actionId: z.string().min(1).max(512),
    commandId: z.string().min(1).max(200),
    expectedRevision: z.number().int().nonnegative(),
    action: z.enum(["acknowledge", "correct", "defer", "cancel"]),
    correction: z.string().min(1).max(4000).optional(),
    deferUntil: z.number().int().positive().optional(),
    scope: z.array(z.string().min(1)).max(64).optional(),
  })
  .strict();

export const dismissRequestSchema = z
  .object({
    actionId: z.string().min(1).max(512),
    scope: z.enum(["opportunity", "evidence"]),
    target: z.string().min(1).max(512),
    accounts: z.array(z.string().min(1)).max(64).optional(),
  })
  .strict();
```

### `apps/web/src/server/request-origin.ts` (the origin policy)

```ts
export type OriginVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "origin_mismatch" | "cross_site" | "untrusted_client";
    };

export const checkRequestOrigin = (request: Request): OriginVerdict;
```

The policy, in order:

1. The allowed origins are the origin of the request URL, plus every origin in
   `JOURNAL_ALLOWED_ORIGINS` (comma separated), when that variable is set.
2. A request with an `Origin` header is allowed only when that origin is
   allowed. Any other origin is `origin_mismatch`.
3. A request with `Sec-Fetch-Site: cross-site` is refused, whatever else it
   carries (`cross_site`).
4. A request **without** an `Origin` header is the trusted-nonbrowser case: it
   is allowed when it carries no `Sec-Fetch-Site` header, or when that header
   is `none`. A browser request that omits `Origin` but declares a fetch site
   is refused (`untrusted_client`). A missing `Origin` therefore never means
   "any cross-site request is fine".

The module imports nothing from Next and reads no cookie: it takes the
`Request` and decides.

### `apps/web/src/server/api.ts` (the handler wrapper)

`handler(fn, options)` grows two options and keeps every existing call site
working:

- `origin: true` — the request must pass `checkRequestOrigin`; a refusal is
  `403` with the reason.
- `sanitize: true` — an unexpected error becomes `500 {"error":"Internal
  error"}`. Without the option the existing behaviour (the error message) is
  kept, so no existing route changes its contract.

The authentication gate stays where it is: when `JOURNAL_PASSWORD` is set, a
request without a valid session cookie is refused with `401` before the
handler body runs.

### `apps/web/src/server/intelligence/experience/commands.ts` (the command service)

```ts
export type CommandOutcome =
  | { readonly status: 200; readonly result: WorkflowResult }
  | { readonly status: 400; readonly error: "invalid_command" }
  | { readonly status: 403; readonly error: "scope_denied" }
  | { readonly status: 409; readonly error: "stale_revision"; readonly currentRevision: number };
```

The service applies one command, in this order:

1. **Parse** the request with `interactionCommandRequestSchema`; then build the
   workflow command and parse it with the engine's own `workflowCommandSchema`
   (a `correct` without a correction, a `defer` without a `deferUntil`, or a
   correction on another action is `400`).
2. **Resolve the action id.** `act:<workflowId>:<action>:<revision>` must parse
   and its action must equal the requested action; otherwise `400`.
3. **Resolve the scope.** Every account the request names must exist. A name
   that does not exist is a revoked scope: `403 scope_denied`.
4. **Load the workflow.** A workflow that does not exist — including one that
   was purged with its account — is `409 stale_revision` with
   `currentRevision: 0`.
5. **Check the revision.** The stored revision must equal the requested
   `expectedRevision`; otherwise `409 stale_revision` with the stored
   revision. The stale check happens **before** the engine runs, so a stale
   command changes nothing.
6. **Check the scope against the workflow.** A workflow whose account is not
   in the resolved scope is `403 scope_denied`. An account-bound workflow may
   never act outside the scope; a workflow with no account is always in scope.
7. **Apply** through `transitionWorkflow` with an interactive
   `ExecutionContext` built by the composition layer. `applied` and
   `duplicate` are `200` with the `WorkflowResult`; a `conflict` the service
   did not already detect is `409 stale_revision`.

The engine's own ledger makes the retry safe: the same `commandId` with the
same payload is answered `duplicate` and applied once; the same `commandId`
with a different payload is a conflict.

### `apps/web/src/server/intelligence/experience/intents.ts` (the intent builders)

Pure functions that turn stored rows into the public DTOs. They take the rows
as arguments and touch no database:

- `observationReviewIntent(workflow, evidence)` — an `observation-review`
  intent for a workflow in `waiting_for_user` whose definition is
  `review_observation`. The actions offered are the legal transitions of the
  workflow's own status, each with its action id at the workflow's revision.
- `statusIntent(opportunity, surface)` — a `status` intent for an opportunity
  that is live (`pending`, `eligible` or `suppressed`, not expired), with the
  dismissal action.
- `inputRequestIntent(workflow, prompt, constraint)` — an `input-request`
  intent for a workflow that waits for an answer.

A workflow in any other status offers no action: the server offers what the
workflow's own definition allows, never what the client asks for.

### `apps/web/src/server/intelligence/composition.ts` (the wiring point)

The composition layer builds what the routes need and nothing else:

- the experience store (`createExperienceStore`) and the job store
  (`createJobStore`, already there),
- the workflow engine (`createWorkflowEngine`),
- the engagement coordinator (`createEngagementCoordinator`),
- the interaction services the routes call.

Composition is the only place that may import a concrete adapter, and it is
the only place that builds an `ExecutionContext`. The routes import
composition; composition never imports a route (import-guard rule 2).

### The routes

| Route | Method | Answers |
| --- | --- | --- |
| `/api/intelligence/observations` | `GET` | the active observations of the scope, each with the review intent of its workflow |
| `/api/intelligence/observations` | `POST` | starts the review workflow of one active observation, so the operator can act on it |
| `/api/intelligence/opportunities` | `GET` | the live opportunities of the scope, each with its dismissal intent |
| `/api/intelligence/opportunities` | `POST` | dismisses an opportunity or one evidence revision |
| `/api/intelligence/commands` | `POST` | applies one workflow command; answers `WorkflowResult` |
| `/api/intelligence/conversations` | `GET` | the open conversations of the scope and their messages |
| `/api/intelligence/status` | `GET` | the background policy view, the worker status and the engagement defaults |

The `POST` routes are mutating and therefore carry the origin check.

Status codes are fixed:

| Code | When |
| --- | --- |
| `400` | the request does not parse, the action id is malformed, the action is illegal for the payload |
| `401` | a password is configured and the session is missing or invalid |
| `403` | the origin is refused, or the scope is refused |
| `409` | the expected revision is stale (or the workflow is gone) |

Every unexpected error is sanitized: the client sees `500 {"error":"Internal
error"}` and nothing of the internal message.

## The scope policy

- A request may name the accounts it is about (`scope` on a command, `accounts`
  on a dismissal, `?scope=` on a read). Without one, the request is about every
  account.
- A named account must exist. An account that does not exist is a revoked
  scope: `403`.
- A read returns only the rows of the scope. A workflow whose account is not in
  the scope cannot be commanded: `403`.
- An account-bound workflow always needs its account in the scope. A workflow
  with no account is journal-wide and always in scope.
- The scope is server-derived, never taken from a generated payload as
  permission (contract review §4).

## The purge race

Deleting an account cascades its intelligence away. A command that arrives
after the purge finds no workflow, so it is refused with `409` and writes
nothing: no transition row, no command row, no effect job. A command that is
refused earlier — a revoked scope, a stale revision — writes nothing either.
The whole decision happens before the engine opens its transaction, and the
engine's own transaction is all-or-nothing.

## Files and steps (test first)

Write `apps/web/tests/intelligence-routes.test.ts` first, then implement in
this order.

| Step | File | Change |
| --- | --- | --- |
| 1 | `apps/web/tests/intelligence-routes.test.ts` | the failing route test |
| 2 | `apps/web/src/lib/intelligence-interactions.ts` | the public DTOs and the request schemas |
| 3 | `apps/web/src/server/request-origin.ts` | the origin policy |
| 4 | `apps/web/src/server/api.ts` | the `origin` and `sanitize` handler options |
| 5 | `apps/web/src/server/intelligence/experience/intents.ts` | the intent builders |
| 6 | `apps/web/src/server/intelligence/experience/commands.ts` | the command service |
| 7 | `apps/web/src/server/intelligence/composition.ts` | the wiring |
| 8 | `apps/web/src/app/api/intelligence/*/route.ts` | the routes |
| 9 | `apps/web/src/server/intelligence/experience/interactions.ts` | rename the Phase 17 `InteractionIntent` to `EngagementIntent` (the public DTO takes the free name; the shape is unchanged) |

## Test plan (`apps/web/tests/intelligence-routes.test.ts`)

The test follows the route-test pattern of the repository: a scratch
`JOURNAL_DATA_DIR`, `vi.mock("next/headers")`, and a `Request` built by hand.

The behaviours, one assertion group each:

1. **Auth.** With `JOURNAL_PASSWORD` set and no session cookie, every route
   answers `401`. With a valid session cookie, the route answers `200`.
2. **Origin.** A mutating request from a foreign `Origin` answers `403` and
   changes nothing. A request with no `Origin` and no `Sec-Fetch-Site` is
   allowed (the trusted nonbrowser policy). A request with no `Origin` but
   `Sec-Fetch-Site: cross-site` answers `403`. A same-origin request answers
   `200`.
3. **Scope.** A request naming an account that does not exist answers `403`.
   A read with a scope returns only that account's rows.
4. **Stale actions.** A command at the current revision applies and returns
   `WorkflowResult {kind:"applied"}`. The same command id with the same
   payload returns `{kind:"duplicate"}` and applies once. A command at an old
   revision answers `409` and writes no transition and no command row.
5. **Corrections, dismissals and deferrals.** A `correct` command records the
   correction text on the workflow and advances the revision. A `defer`
   command sets `deferUntil` and schedules the workflow. A dismissal marks
   the opportunity dismissed and records the dismissal, and it survives a
   repeated dismissal.
6. **The purge race.** An account is deleted while its workflow is open. The
   command that follows answers `409`, and the journal holds no transition
   row, no command row and no effect job for it.
7. **The existing AI contracts.** The Ask, Reports, Recap, Critique and
   Import routes still answer exactly as their own tests say (those tests are
   the contract; this phase changes none of them).

Every behaviour is proved with teeth: each assertion is run once against
broken production behaviour (the check removed) and must fail, and then
against the restored behaviour and must pass. Both results go into the phase
report.

## Checks and stop condition

```bash
pnpm exec vitest run apps/web/tests/intelligence-routes.test.ts
pnpm typecheck
```

Stop condition: the targeted test is green, the typecheck is green, the
existing intelligence suites are unchanged and green, and the phase report is
committed. The full-project suite and the merge into
`codex/ai-native-journal` belong to the coordinator.
