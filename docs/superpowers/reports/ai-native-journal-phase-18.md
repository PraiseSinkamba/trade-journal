# Phase 18 — Authenticated interaction and control APIs

Phase guide row 18 · detailed-plan Task 12 (backend half) · milestone M5 · schema allocation: **None**

| | |
| --- | --- |
| Branch | `codex/ai-native-journal-p18` (child of the feature worktree) |
| Base | `a616a67cf340144e294a607ef048a0c6bcc77a49` (verified feature HEAD) |
| Plan commit | `326179835039ce27c85459db8b541cf286ed0e51` — "docs: plan the authenticated interaction APIs" |
| Implementation commit | `c0cfb3073e5f162c96f942ffbd9a756b688e681b` — "feat: expose controlled intelligence interactions and user settings" |
| Repair commit | `ce1b098f5e184702d471cb8a3a5a2d984c8e47c6` — "fix: refuse a review of an inactive observation and pin the revoked scope refusal" |
| Migrations | none. `0001`–`0007` are byte-unchanged; no schema, registry or checksum file was touched. |

## What was built

The operator can now be told what to do over HTTP, and what they say is applied to durable state.

- `apps/web/src/lib/intelligence-interactions.ts` — the public DTOs. `InteractionIntent` is a strict
  union of the three shapes an interaction may take (`observation-review`, `status`,
  `input-request`); the server supplies the action ids, the expected revision, the text, the evidence
  references and the input constraints. The module also holds the strict request schemas
  (`interactionCommandRequestSchema`, `dismissRequestSchema`, `observationReviewRequestSchema`), the
  action-id builders and `parseInteractionActionId`. It imports no server and no database code.
- `apps/web/src/server/request-origin.ts` — the origin policy. `checkRequestOrigin(request)` returns
  `allowed` or a reason (`origin_mismatch`, `cross_site`, `untrusted_client`). A missing `Origin` is
  the trusted-nonbrowser case and is allowed **only** when the request declares no fetch site; a
  browser request that omits the origin while declaring one is refused.
- `apps/web/src/server/api.ts` — `handler(fn, options)` grows two optional flags: `origin: true`
  (the request must pass the origin policy) and `sanitize: true` (an unexpected error becomes
  `500 {"error":"Internal error"}`). Both are additive: every existing call site keeps its exact
  behaviour, including the unsanitized error message.
- `apps/web/src/server/intelligence/experience/intents.ts` — the pure intent builders
  (`observationReviewIntent`, `statusIntent`, `inputRequestIntent`). The actions an intent offers are
  the legal transitions of the workflow's own definition at its current revision; a workflow in a
  status with no legal user transition offers nothing.
- `apps/web/src/server/intelligence/experience/commands.ts` — the command service
  (`createCommandService`). One command is resolved in a fixed order: parse → resolve the action id →
  resolve the scope → load the workflow → check the revision → check the scope against the workflow →
  apply through the Phase 16 engine. Every decision happens before the engine opens its transaction.
- `apps/web/src/server/intelligence/composition.ts` — the wiring point. It now builds the experience
  store, the job store, the workflow engine, the engagement coordinator, the interactive
  `ExecutionContext` factory and the command service, and re-exports the intent builders. Every
  existing export keeps working.
- `apps/web/src/server/intelligence/experience/interactions.ts` — the Phase 17 interface
  `InteractionIntent` was renamed to `EngagementIntent` (shape unchanged); the public DTO takes the
  free name. The old name was used nowhere else in the repository.
- `apps/web/src/app/api/intelligence/` — the routes and their read model:
  - `queries.ts` — the scoped read model and the scope resolution.
  - `observations/route.ts` — `GET` the active observations of the scope with the review intent of
    their workflow; `POST` start the review workflow of one active observation.
  - `opportunities/route.ts` — `GET` the live opportunities of the scope with their dismissal intent;
    `POST` dismiss an opportunity or one evidence revision.
  - `commands/route.ts` — `POST` apply one workflow command; answers the engine's `WorkflowResult`.
  - `conversations/route.ts` — `GET` the open conversations of the scope and their messages.
  - `status/route.ts` — `GET` the background policy view, the worker status and the engagement
    defaults. No key, no endpoint credential, no raw error.

### The status codes

| Code | Body | When |
| --- | --- | --- |
| `400` | `{"error":"invalid_request"}` | the body does not parse, the action id is malformed, the action id and the expected revision disagree, the command payload is illegal |
| `401` | `{"error":"Unauthorized"}` | a password is configured and the session is missing or invalid |
| `403` | `{"error":"origin_denied"}` | the origin is refused |
| `403` | `{"error":"scope_denied"}` | a named account does not exist, or the workflow is outside the scope |
| `409` | `{"error":"stale_revision","currentRevision":n}` | the expected revision is stale, or the workflow is gone |
| `500` | `{"error":"Internal error"}` | an unexpected error, sanitized |

### The rules that carry the phase

- **The server decides.** The action id is a handle, not a permission. The service resolves it against
  the stored workflow, requires its revision to equal the requested `expectedRevision`, compares the
  stored revision, and compares the account with the resolved scope before the engine runs. A payload
  that names an action authorizes nothing on its own.
- **The scope is server-derived.** A named account must exist; a name that does not exist is a revoked
  scope. A workflow whose account is outside the scope is refused. The engine's own scope check stays
  as the second line.
- **A refused command writes nothing.** The stale and purge checks run before the engine opens its
  transaction, and the test asserts that the engine was never called.
- **The purge race leaves nothing half-applied.** Deleting the account cascades its intelligence away;
  the command that follows is `409`, and the journal holds no transition row and no command row.

## Commands actually run

All against the implementation commit `c0cfb3073e`, Node v24.20.0, pnpm 11.0.8.

| Command | Exit | Runtime | Result |
| --- | --- | --- | --- |
| `pnpm exec vitest run apps/web/tests/intelligence-routes.test.ts` | 0 | 10.2 s (14.5 s wall) | 19 passed |
| `pnpm --filter web typecheck` | 0 | 14.9 s | `next typegen` + `tsc --noEmit` clean |
| `pnpm typecheck` (repository root) | **101** | 22.1 s | **fails in `desktop` only** — `resource path 'binaries/node-x86_64-pc-windows-msvc.exe' doesn't exist`. The Tauri sidecar is downloaded at build time and is not tracked (`desktop/src-tauri/binaries/` holds only `.gitkeep`), so the Rust package cannot be checked on this host. No desktop, Rust or configuration file is in this phase's diff; `core`, `importers` and `web` all pass. |
| `pnpm exec vitest run apps/web/tests/ai-reports-route.test.ts apps/web/tests/api-auth.test.ts apps/web/tests/auth-gate.unit.test.ts apps/web/tests/intelligence-workflows.test.ts apps/web/tests/intelligence-engagement.test.ts apps/web/tests/intelligence-boundaries.test.ts apps/web/tests/account-mutation-routes.test.ts apps/web/tests/ai-ask-agent.test.ts` | 0 | 9.9 s | 110 passed |
| `pnpm format:check` | 1 | 32.6 s | 77 files are unformatted; **none of them is a Phase 18 file** (they are `packages/importers/**`, `PRODUCT.md` and other pre-existing paths). The Phase 18 files are prettier-clean. |

The whole-project `pnpm test` and the merge into `codex/ai-native-journal` belong to the coordinator.

The table above is the run against the implementation commit. The repair re-ran the route test and the
web typecheck against the repair commit; its commands are in the repair section below.

## The fixtures

- A scratch journal: `mkdtempSync(join(tmpdir(), "journal-intelligence-routes-"))` as
  `JOURNAL_DATA_DIR`, set before the journal module is imported.
- `next/headers` is mocked with a mutable session holder, so the tests can present a valid session
  cookie (`sessionToken()`) or none.
- Accounts are journal rows (`acct-alpha`, `acct-beta`).
- Observations are inserted directly, because this phase has no observation producer: the opportunity
  producer is Phase 19's Slice B. The row carries the factual evidence and its evidence link.
- Workflows come from the domain: `workflowEngine.startWorkflow(...)` followed by the effect, so the
  workflow waits for the operator at revision 2.
- Opportunities come from the domain: `engagementCoordinator.engage({...})`.
- The Ask-route fixture copies the shape of `apps/web/tests/ai-reports-route.test.ts`: one account,
  `insertExecutions` fills, `setSetting("timeZone", "UTC")` and a mocked `@/server/ai`.

## The behaviour, the test and the proof of teeth

Every behaviour was broken once, seen to fail, then restored and seen to pass. Both results are
recorded: a test that never failed proves nothing.

| Behaviour | Test | Broken run | Restored run |
| --- | --- | --- | --- |
| Auth: `401` without a session, `200` with one, on all seven route calls | `the authentication gate > refuses every route without a session and admits every route with one` | — (the gate is the pre-existing one; a missing cookie answers `401` by construction) | green |
| Origin: a foreign origin is refused and changes nothing | `the origin policy > refuses a foreign origin and changes nothing` | removed the `options.origin` block in `api.ts` → `-t "origin"` → **2 failed**: "expected 200 to be 403" (the foreign origin and the cross-site fetch were both admitted) | restored → 4 passed |
| Origin: a missing origin with no fetch site is allowed | `the origin policy > allows a request without an origin and without a fetch site` | same break | restored → 4 passed |
| Origin: a missing origin that declares a cross-site fetch is refused | `the origin policy > refuses a request without an origin that declares a cross-site fetch` | same break | restored → 4 passed |
| Origin: a same-origin request is allowed | `the origin policy > allows a same-origin request` | same break | restored → 4 passed |
| Scope: a named account that does not exist is refused | `the scope policy > refuses a request that names an account that does not exist` | removed the revoked-scope check in `resolveScope` → `-t "scope"` → **1 failed**: "expected 200 to be 403" (the ghost account was admitted) | restored → 3 passed |
| Scope: a read answers only the rows of the scope | `the scope policy > returns only the rows of the scope` | same break | restored → 3 passed |
| Scope: a command on a workflow outside the scope is refused | `the scope policy > refuses a command on a workflow outside the scope` | same break | restored → 3 passed |
| Scope: an evidence revision that belongs to no account needs an unrestricted scope | `the scope policy > refuses to dismiss an evidence revision that belongs to no account when the request names accounts` | `else if (false && !scope.all)` in the opportunities route → **1 failed**: "expected 200 to be 403" | restored → 19 passed |
| Stale: a command at the current revision applies | `the stale actions > applies a command at the current revision` | — | green |
| Stale: the same command id is answered `duplicate` and applies once | `the stale actions > answers a repeated command with a duplicate and applies it once` | — | green |
| Stale: a command at an old revision is `409` and writes nothing | `the stale actions > refuses a command at an old revision and writes nothing` | removed the revision check in `commands.ts` → `-t "stale"` → **1 failed**: "expected transitionWorkflow to not be called at all, but actually been called 1 times" | restored → 3 passed |
| Consistency: an action id and an expected revision that disagree are `400` | `the inconsistent commands > refuses a command whose action id and expected revision disagree and writes nothing` | `if (false && actionId.revision !== request.expectedRevision)` → **1 failed**: "expected 200 to be 400" | restored → 19 passed |
| Correction: the correction text is recorded and the revision advances | `the corrections, dismissals and deferrals > records a correction on the workflow and advances the revision` | — | green |
| Deferral: `deferUntil` is set and the workflow is scheduled | `the corrections, dismissals and deferrals > defers the workflow until the given instant` | — | green |
| Dismissal: the opportunity is dismissed, the dismissal is recorded, a repeat stays dismissed | `the corrections, dismissals and deferrals > dismisses an opportunity, records the dismissal and keeps it dismissed` | — | green |
| Dismissal: a dismissed opportunity is no longer listed | `the corrections, dismissals and deferrals > no longer lists an opportunity that was dismissed` | added `"dismissed"` to the live-status list in `queries.ts` → **1 failed**: the listing contained the dismissed row and the dismissal record | restored → 19 passed |
| Purge race: the command of a purged workflow is `409` and writes nothing | `the purge race > refuses the command of a purged workflow and writes nothing` | removed the purged-workflow check → `-t "purge"` → **1 failed**: "expected transitionWorkflow to not be called at all, but actually been called 1 times" | restored → 16 passed |
| The existing AI contract is unchanged | `the existing AI contracts > the Ask route still answers with the answer and the scope` | — | green |

The two rows added by the repair are in the repair section below.

## The review and its findings

One implementation review, per the phase budget. The report is `.omp/reviewer-report.md`
("## Verdict: PASS").

- **P3 — a workflow effect job survives an account purge.** `intelligence_jobs` carries no account
  foreign key, and the Phase 07 purge helper (`purgeAccountIntelligence`) deletes only the outbox,
  observation and seed rows, so the job of a purged workflow stays in the table. The command itself
  writes nothing, so this phase's promise holds; the test asserts that the job set of the purged
  workflow is unchanged. The helper is not in this phase's ownership, so the leak is reported, not
  patched. **Next-phase input for the retention phase.**
- **P3 — `inputRequestIntent` has no route consumer yet.** The `input-request` member of the union is
  constructed by a builder no route serves; the UI that surfaces it is Phase 19.
- **P3 — `POST /api/intelligence/observations` is not named in the detailed plan.** Without a way to
  start a review workflow, no workflow would exist in production and the command route would be
  unreachable. It is backend-only and inside the named route family.

Resolved before the commit:

- The opportunity list answered dismissed, delivered and expired rows. It now answers the live
  opportunities only (pending, eligible, suppressed, not expired).
- An evidence dismissal of a revision that belongs to no observation could escape a restricted scope.
  It now needs an unrestricted scope.
- The action id carried the revision it was issued at, but nothing compared it. The service now
  requires the action id revision to equal the requested `expectedRevision`; a disagreement is
  `400 invalid_request`.
- The first version of the test proved the existing AI contracts with a `git status` check, which
  proves nothing about behaviour. It now asserts the Ask route's response body.

## The repair

The implementation review of the phase diff found one real bug and one missing proof. Both are fixed
in `ce1b098f5e` ("fix: refuse a review of an inactive observation and pin the revoked scope
refusal"), on top of the phase commits. No schema, no migration, no dependency and no other
behaviour changed.

### Finding 1 — a review could start for an inactive observation (FAIL, fixed)

`POST /api/intelligence/observations` selected the observation by id with no status predicate, so an
observation that was `invalidated` (its trade was deleted) or `superseded` (a newer revision replaced
it) could still be put into review and a workflow started for it. The route's own docstring and the
plan's route table both say one active observation, and the GET surface filters `status = "active"`.

The read model now resolves the active observation only (`findActiveObservation`,
`apps/web/src/app/api/intelligence/queries.ts`), and the POST refuses anything else with
`400 invalid_request` before it reads any evidence and before it starts a workflow.

### Finding 2 — the revoked-scope refusal had no independent proof (FAIL, fixed)

The behaviour was already right: `apps/web/src/server/intelligence/experience/commands.ts` refuses a
command that names an account that does not exist with `403 scope_denied`, unconditionally and before
the workflow-scope check. The proof was missing: the suite's only unknown-account case named an
account-bound workflow, and there the workflow-scope check refuses the same request with the same
body, so deleting the unknown-account check left the suite green.

The new case opens a journal-wide workflow (`accountId: null`), where the workflow-scope rule cannot
refuse anything: the commands route resolves no scope of its own, and the service's workflow-scope
check skips a workflow with no account. Only the revoked-scope rule can refuse that request. The case
also asserts that the engine never ran and that no command row was written.

### The other observation reads

`observationOfRevision` (the opportunities surface) attributes an evidence revision to an account for
the dismissal scope. That attribution must outlive the observation's lifecycle — a revision of a
superseded observation still belongs to that observation's account — so the lookup stays
status-agnostic and now says so in its docstring. The conversations surface reads no observation at
all: `listConversations` filters `status = "open"` and `listMessages` filters by conversation.

### The proof of teeth of the repair

| Behaviour | Test | Broken run | Restored run |
| --- | --- | --- | --- |
| An invalidated or superseded observation cannot start a review | `the observation reviews > refuses to start a review of an observation that is no longer active` | the unfixed lookup → **1 failed**: "expected 200 to be 400" | restored → 21 passed |
| A command that names an account that does not exist is refused, even against a journal-wide workflow | `the scope policy > refuses a command that names an unknown account against a journal-wide workflow` | the revoked-scope check disabled (`if (false && …)`) → **1 failed**: "expected 200 to be 403" | restored → 21 passed |

The reviewer of the repair repeated both mutations in a scratch copy outside the repository and
relaxed the status assertions alone: the spy assertions then fail by themselves (`startWorkflow` was
called twice, `transitionWorkflow` once). Both cases can fail for the reason they claim.

### The commands of the repair

Against the repair commit `ce1b098f5e`, Node v24.20.0, pnpm 11.0.8.

| Command | Exit | Runtime | Result |
| --- | --- | --- | --- |
| `pnpm exec vitest run apps/web/tests/intelligence-routes.test.ts` | 0 | 10.0 s | 21 passed |
| `pnpm --filter web typecheck` | 0 | 13.4 s | `next typegen` + `tsc --noEmit` clean |
| `pnpm exec prettier --check <the three touched files>` | 0 | 1.8 s | all three prettier-clean |

The reviewer of the repair additionally ran the neighbouring intelligence suites
(`intelligence-boundaries`, `intelligence-workflows`, `intelligence-engagement`: 70 passed;
`intelligence-observations`, `intelligence-jobs`, `intelligence-migrations`,
`intelligence-supervisor`, `intelligence-worker`, `intelligence-boundaries`: 85 passed) and
`node scripts/check-licenses.mjs` (exit 0). The whole-project `pnpm test` and the merge belong to
the coordinator.

## Deviations from the plan

1. **`invalid_request`, not `invalid_command`.** The plan's step 1 names `invalid_command`; the
   implementation dispatch fixed the body as `{"error":"invalid_request"}`. The dispatch won.
2. **The command ledger is consulted before the revision check.** The plan's ordered checks are kept,
   but a `commandId` already in the ledger skips the revision check: otherwise the retry of an applied
   command would be refused as stale before the engine could answer `duplicate`, which the plan
   requires.
3. **`observationReviewIntent(workflow, evidence, text)`.** The plan's signature has no text, but the
   public DTO carries one; the third argument is the observation's statement.
4. **The purge-race job assertion** is "the job set is unchanged" instead of "no job row exists", for
   the reason in the review findings.
5. **The root `pnpm typecheck` fails in the `desktop` Rust package** on this host (missing Tauri
   sidecar binary). `pnpm --filter web typecheck` — the scope of this phase — is exit 0. The failure is
   recorded as blocked-by-host, never as passed.
6. **Scope semantics:** a request that names no account is about every account; a request that names
   an explicitly empty list is about no account, so it sees the journal-wide rows only.
7. **`POST /api/intelligence/observations` applies the workflow effect synchronously** so the returned
   intent is actionable. The effect is idempotent: the worker that finds it applied declines.

## What Phase 19 gets

- The DTOs and the request schemas are in `apps/web/src/lib/intelligence-interactions.ts`; the UI may
  import them and nothing else from the server side.
- The routes and their exact bodies:
  - `GET /api/intelligence/observations?scope=<a,b>` → `{ observations, intents }`.
  - `POST /api/intelligence/observations` `{ observationId, scope? }` → `{ workflowId, revision, intent }`.
    The observation must be active: a superseded or invalidated one is `400 invalid_request`.
  - `GET /api/intelligence/opportunities?scope=<a,b>` → `{ opportunities, intents }` (live rows only).
  - `POST /api/intelligence/opportunities` `{ actionId, scope, target, accounts? }` → `{ kind: "dismissed", scope, target }`.
  - `POST /api/intelligence/commands` `{ actionId, commandId, expectedRevision, action, correction?, deferUntil?, scope? }` → the engine's `WorkflowResult`.
  - `GET /api/intelligence/conversations?scope=<a,b>` → `{ conversations }`.
  - `GET /api/intelligence/status` → `{ status }`.
- The action id the client must send back is the one the server issued in the intent
  (`act:<workflowId>:<action>:<revision>`, `act:opportunity:<id>:dismiss`,
  `act:evidence:<revisionId>:dismiss`); the client may not invent one.
- `inputRequestIntent` is available for a Phase 19 surface that asks the operator a question.
- Still open for the retention phase (Phase 20): the workflow effect job of a purged account survives
  the purge, because `purgeAccountIntelligence` does not delete `intelligence_jobs` rows.

## Definition of done

The assigned scope is implemented, the targeted test and the web typecheck are green, the existing
intelligence suites are unchanged and green, one implementation review passed, the two findings of
that review are repaired with their own proof of teeth, one repair review passed, and this report is
committed. The merge into `codex/ai-native-journal` is the coordinator's job.
