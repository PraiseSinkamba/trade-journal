---
status: not-started
phase: 0
updated: 2026-10-08
---

# AI Agent Architecture Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan phase by phase. This record is planning only; it authorizes no source change by itself.

**Goal:** Evolve the existing provider-neutral, bring-your-own-key AI integrations into bounded feature interfaces and—only for a demonstrated Ask Journal need—a read-only, scope-bound agent, while retaining deterministic workflows where they already fit.

**Architecture:** Preserve feature routes as adapters over AI feature interfaces. Place provider selection, credential resolution, model invocation, bounded execution controls, and safe call metadata behind a provider-neutral execution runtime; keep OpenAI and Anthropic as adapters. Extract typed read-only journal capabilities from routes before any agent is introduced, then let a narrowly-defined Ask Journal agent use only those capabilities. Import remains a deterministic structured extraction, preview, review, and commit workflow.

**Tech Stack:** Next.js App Router, TypeScript, Vercel AI SDK, OpenAI Responses API, Anthropic Messages API, encrypted settings, SQLite/Drizzle journal services, existing Vitest suites.

---

## Record status and terminology

- **Current fact** means behavior verified in the cited repository evidence as of 2026-10-08.
- **Recommendation** means the intended migration direction; it is not present in production code.
- **Future decision** means a gate to resolve using evidence gathered during a prior phase. Do not implement it merely because it is listed here.
- The phases are numbered **0–6**. Phase 0 is discovery baseline; phases 1–6 are the six migration phases.
- No provider request, tool, streaming response, cache, global orchestration layer, or telemetry endpoint is added by this planning record.

## Current-state evidence

### AI integrations and product capabilities

Exactly two server-side Vercel AI SDK `generateText` integration modules exist: reflection in `apps/web/src/server/ai.ts` and structured import in `apps/web/src/server/ai-import.ts`.

| Capability                      | Current fact                                                                                                                                                                                                                                                                                                         | Evidence                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Reflection runtime              | `apps/web/src/server/ai.ts` is the server-side Vercel AI SDK text-generation integration for reflection features. `runAi` selects the provider/model, applies the shared reflection system instruction, defaults to 1,200 output tokens, unwraps SDK retry errors, and maps provider failures to sanitized messages. | `apps/web/src/server/ai.ts:1-66` (`runAi`, `SYSTEM`)                                                               |
| Structured statement extraction | `apps/web/src/server/ai-import.ts` is the other server-side Vercel AI SDK integration. It uses a strict output schema, post-validates every result, caps output at 32,000 tokens, disables SDK retries, and supplies a 120-second abort signal.                                                                      | `apps/web/src/server/ai-import.ts:38-86,88-176,178-263` (`schema`, `validateAiExtraction`, `parseStatementWithAi`) |
| Ask Journal                     | `POST /api/ai/ask` validates a scope snapshot, queries matching trades, computes journal aggregates, and makes one `runAi` call. Its prompt limits answers to the supplied journal aggregates and asks it to disclose missing data.                                                                                  | `apps/web/src/app/api/ai/ask/route.ts:31-62`                                                                       |
| Daily recap                     | `POST /api/ai/recap` queries trades for one local day, excludes shared notes for a narrowed trade subset, creates a recap prompt from those records, and makes one `runAi` call.                                                                                                                                     | `apps/web/src/app/api/ai/recap/route.ts:10-57`; `docs/ai-scope.md:3-10`                                            |
| Trade critique                  | `POST /api/ai/critique` looks up exactly one trade key and its executions, then makes one `runAi` call for a single-trade critique.                                                                                                                                                                                  | `apps/web/src/app/api/ai/critique/route.ts:7-34`; `apps/web/tests/ai-scope.test.ts:324-330`                        |
| AI statement import             | `/api/import` can use AI only for preview. Commit requires a reviewed preview token and reloads the reviewed parsed result instead of calling AI again.                                                                                                                                                              | `apps/web/src/app/api/import/route.ts:68-153`; `apps/web/tests/ai-import.test.ts:118-167`                          |

### Provider, key, and privacy behavior

| Current fact                                                                                                                                                                                                                              | Evidence                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Provider support is a closed Anthropic/OpenAI union. Each provider has a separately persisted model and key; the selected provider is resolved from the saved provider or existing key availability.                                      | `apps/web/src/lib/ai-settings.ts:1-28`; `apps/web/src/server/settings.ts:85-115`                                            |
| An environment key takes precedence over its encrypted saved key. Saved provider credentials are encrypted, unreadable ciphertext is treated as unconfigured, and key/ciphertext values are not returned in settings or export responses. | `apps/web/src/server/settings.ts:59-80`; `apps/web/tests/ai-settings.test.ts:84-164`                                        |
| Requests go directly from this server to the selected provider. OpenAI requests set `store: false`; Anthropic and OpenAI use their provider SDK adapters.                                                                                 | `apps/web/src/server/ai.ts:31-40`; `apps/web/src/server/ai-import.ts:221-251`; `apps/web/tests/ai-settings.test.ts:174-238` |
| Repository policy is self-hosted and prohibits a journal analytics or tracking service. The plan must not add or claim an external telemetry endpoint.                                                                                    | `README.md:100-106,284-288`                                                                                                 |

### Import safety workflow

| Current fact                                                                                                                                                                                                                                                                   | Evidence                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| The import system treats the uploaded statement as untrusted data, instructs the model not to follow embedded instructions or call tools, requires source references, and rejects incomplete, ambiguous, multi-account, duplicate, malformed, or invalid extracted executions. | `apps/web/src/server/ai-import.ts:80-86,88-176`                                        |
| Input caps are 8 MB PDF or 150,000 text characters; an AI import request has a 120-second abort timeout; output must end with `stop`.                                                                                                                                          | `apps/web/src/server/ai-import.ts:198-263`                                             |
| Preview tokens are encrypted, bind the exact statement content/encoding/timezone fingerprint, expire after 30 minutes, and are re-read on commit.                                                                                                                              | `apps/web/src/server/ai-import.ts:265-295`; `apps/web/tests/ai-import.test.ts:148-167` |
| Native parsing remains local when AI is not selected.                                                                                                                                                                                                                          | `apps/web/tests/ai-import.test.ts:84-96`                                               |

### Existing scope and UI contracts

| Contract                                                                                                                                                                                                                                                  | Evidence                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Ask and recap receive a validated snapshot of the UI’s selected filters and timezone. Invalid/unknown account selections, malformed filters, reversed ranges, and unknown request fields are rejected; no implicit broadening to all accounts is allowed. | `docs/ai-scope.md:3-18`; `apps/web/tests/ai-scope.test.ts:112-155,309-321`                     |
| Ask and recap send only selected-account data, include a server-confirmed scope label, and do not call the provider if there are no matching trades.                                                                                                      | `apps/web/src/app/api/ai/ask/route.ts:31-62`; `apps/web/tests/ai-scope.test.ts:75-110,145-155` |
| A recap cannot use a shared day note when a filter narrows the trade subset.                                                                                                                                                                              | `apps/web/src/app/api/ai/recap/route.ts:22-27`; `apps/web/tests/ai-scope.test.ts:297-307`      |
| Changing account/filter/timezone scope, returning to a former scope, unmounting, or changing recap date invalidates pending UI results. Late responses must not replace an answer or append/save a recap.                                                 | `docs/ai-scope.md:8-10`; `apps/web/tests/ai-ui.test.ts:93-218`                                 |

## Direct calls versus agent classification

| Capability                                                        | Classification                    | Decision                         | Rationale                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily recap                                                       | Direct AI call                    | **Keep direct.**                 | Input is one validated local day and a fixed recap format. It does not need iterative discovery or tool selection. `apps/web/src/app/api/ai/recap/route.ts:10-57`                                                                                                               |
| Trade critique                                                    | Direct AI call                    | **Keep direct.**                 | Input is one key-scoped trade plus its fills; the request has no multi-step information need. `apps/web/src/app/api/ai/critique/route.ts:7-34`                                                                                                                                  |
| AI statement import                                               | Deterministic structured workflow | **Keep non-agentic.**            | Schema-constrained extraction, post-validation, human review, encrypted preview binding, and a commit that never re-calls AI are the safety boundary. `apps/web/src/server/ai-import.ts:38-295`; `apps/web/src/app/api/import/route.ts:68-153`                                  |
| Ask Journal                                                       | Conditional first agent candidate | **Consider only after Phase 2.** | A question may eventually benefit from choosing among multiple read-only aggregate views, but today it is one aggregate-building route and one direct call. Its scope contract must remain the authority. `apps/web/src/app/api/ai/ask/route.ts:31-62`; `docs/ai-scope.md:3-18` |
| Global orchestrator, multi-agent hierarchy, cross-feature planner | Not indicated                     | **Do not add.**                  | No cited current workflow requires delegation between agents. Introducing it would broaden data/control surfaces without demonstrated user value.                                                                                                                               |

## Target layering

The target is an incremental layering, not a replacement framework:

```text
Feature adapters
  → AI feature interfaces
    → optional agent definitions
      → deterministic orchestration
        → bounded domain tools/capabilities
          → provider-neutral execution runtime
            → existing journal services/DB
            → OpenAI/Anthropic adapters
```

1. **Feature adapters** retain route request validation, response shapes, and UI contracts.
2. **AI feature interfaces** accept typed feature inputs and return typed feature outputs. They own feature prompt versions and output constraints, not HTTP or credential access.
3. **Optional agent definitions** are feature-local, read-only, and introduced only where a phase gate approves them. They define allowed capabilities, stop conditions, and bounded execution—not provider configuration.
4. **Deterministic orchestration** coordinates a known feature flow. For direct features it may be a single model execution; import retains preview/review/commit.
5. **Bounded domain tools/capabilities** are typed functions over existing journal services. They validate the caller’s already-approved account, filter, date, and timezone scope; an agent must never use raw database access or construct broader filters.
6. **Provider-neutral execution runtime** resolves the selected provider/model/key, applies timeout/retry/output controls, normalizes safe results/errors, and records only allowed local operational metadata.
7. **Existing journal services/DB** remain the source of truth for data selection, metrics, imports, and persistence.
8. **OpenAI/Anthropic adapters** remain the only provider-specific transport construction points. Provider keys/settings stay outside features, agents, and capabilities.

## Gap table: current state to target

| Area                        | Current fact                                                                                                         | Target recommendation                                                                                                                                                               | Migration guard                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reflection prompt ownership | One shared reflection `SYSTEM` instruction is in `ai.ts`; feature prompts are composed in routes.                    | Move feature prompt definitions/version identifiers into feature-owned modules without changing their text behavior first.                                                          | Preserve current prompt semantics and route response shapes until parity tests pass. `apps/web/src/server/ai.ts:14-21`; `.omp/style/ai-integration.md:50-67`                        |
| Result types                | Reflection routes return free-form strings; import has a structured schema and post-validation.                      | Define typed feature inputs/results at the interface boundary. Keep free-form reflection prose as a typed `answer`/`recap`/`critique` field; do not make the UI parse model syntax. | Do not impose an extraction-style schema on prose unless a feature needs structured fields. `apps/web/src/app/api/ai/ask/route.ts:52-62`; `apps/web/src/server/ai-import.ts:38-176` |
| Timeouts/cancellation       | Import has 120-second abort handling; `runAi` has no configured abort signal or timeout.                             | Add an execution-runtime deadline and caller cancellation propagation for reflection calls, preserving route-level error behavior.                                                  | Test normal completion, abort, and sanitization. `apps/web/src/server/ai.ts:21-66`; `apps/web/src/server/ai-import.ts:247-251`                                                      |
| Retry policy                | Reflection relies on SDK behavior and unwraps `RetryError`; import sets `maxRetries: 0`.                             | Make retry policy an explicit per-feature execution setting.                                                                                                                        | Do not silently retry imports or convert a canceled request into a retry. `apps/web/src/server/ai.ts:43-65`; `apps/web/src/server/ai-import.ts:247-251`                             |
| Cost controls               | Reflection defaults to 1,200 output tokens; import caps output at 32,000. No evidenced session budget.               | Retain per-call caps, then decide whether a bounded local budget is required from measured need.                                                                                    | No unlimited output. No user-wide accounting service. `.omp/style/ai-integration.md:117-130`                                                                                        |
| Cache                       | No evidenced cache for reflection or import.                                                                         | Do not add cache in parity phases. Consider a feature-specific cache only after demonstrating stale-output safety and invalidation keys.                                            | Cached content must never cross account/filter/timezone scope.                                                                                                                      |
| Streaming                   | No evidenced streaming path.                                                                                         | Do not add streaming for parity. Evaluate only after direct call UX has a measured need and cancellation semantics are specified.                                                   | A streamed response must obey current stale-scope invalidation behavior. `.omp/style/ai-integration.md:94-113`; `apps/web/tests/ai-ui.test.ts:116-218`                              |
| Observability               | No evidenced AI call observability implementation. Repository policy rules out analytics/tracking service endpoints. | If needed, add minimal local, privacy-preserving operational logs/metrics with no prompt, response, key-derived value, or external export.                                          | Must not become external telemetry. `.omp/style/ai-integration.md:149-165`; `README.md:284-288`                                                                                     |
| Tool access                 | No agent tools exist.                                                                                                | Extract only typed, read-only journal capabilities from existing domain services.                                                                                                   | No raw DB, raw SQL, unrestricted query objects, provider setting/key access, writes, or scope expansion.                                                                            |
| Agent composition           | No agent/orchestrator exists.                                                                                        | One feature-local Ask Journal agent is the only current candidate, conditional on Phase 3 gates.                                                                                    | No global router, hierarchy, or autonomous workflow.                                                                                                                                |

## Decision table

| Decision                                                                                 | Status                            | Rationale and evidence                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep recap and critique as direct calls.                                                 | Recommendation                    | Their data preparation is deterministic and fixed-scope. `apps/web/src/app/api/ai/recap/route.ts:10-57`; `apps/web/src/app/api/ai/critique/route.ts:7-34`                                                                   |
| Keep AI import deterministic and non-agentic.                                            | Recommendation                    | Its strict schema, fail-closed validation, review token, and no-second-call commit are essential safety controls. `apps/web/src/server/ai-import.ts:38-295`; `apps/web/src/app/api/import/route.ts:68-153`                  |
| Make Ask Journal the first and only present agent candidate.                             | Recommendation                    | Ask is the only feature whose information need might become multi-view while remaining read-only. It must first gain typed, scope-bound capabilities. `apps/web/src/app/api/ai/ask/route.ts:31-62`; `docs/ai-scope.md:3-18` |
| Do not add a global orchestrator or agent hierarchy.                                     | Recommendation                    | No demonstrated capability requires it; a feature-local design minimizes data and control surface.                                                                                                                          |
| Tools call typed domain capabilities, never raw DB.                                      | Recommendation                    | Scope validation and known domain calculations already form critical contracts. `apps/web/src/app/api/ai/ask/route.ts:31-50`; `apps/web/src/app/api/ai/recap/route.ts:15-38`                                                |
| Agent/tools cannot read or control provider keys/settings.                               | Recommendation                    | Credentials and provider selection are encrypted/settings concerns with environment precedence. `apps/web/src/server/settings.ts:59-115`; `apps/web/src/lib/ai-settings.ts:1-28`                                            |
| Preserve account/filter/timezone scope as an immutable capability input.                 | Required compatibility constraint | Explicit invalid scopes reject rather than broaden; stale UI responses are discarded. `docs/ai-scope.md:3-18`; `apps/web/tests/ai-scope.test.ts:112-155`; `apps/web/tests/ai-ui.test.ts:116-218`                            |
| Treat the AI integration style guide as documentation drift, not current implementation. | Current fact + recommendation     | It calls for prompt modules, typed result objects, budget/cache/logging/streaming practices that are not all implemented in the cited runtime. `.omp/style/ai-integration.md:50-185`; `apps/web/src/server/ai.ts:1-66`      |

## Risks and non-negotiable constraints

### Provider, key, and privacy risks

| Risk                                                                                 | Required mitigation                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A refactor changes the selected provider or model.                                   | Preserve the Anthropic/OpenAI union, environment-key precedence, per-provider encrypted saved key, and per-provider model behavior. Add parity tests before switching any caller. `apps/web/src/server/settings.ts:59-115`; `apps/web/tests/ai-settings.test.ts:50-282` |
| A capability or agent obtains credentials.                                           | Pass no key, model, provider settings object, or setting reader into feature interfaces/capabilities. Credential resolution stays in the execution runtime.                                                                                                             |
| Provider error payload reveals a credential fragment, prompt, or uploaded statement. | Preserve sanitized error mapping; do not log prompts/responses/keys. `apps/web/src/server/ai.ts:43-66`; `apps/web/tests/ai-settings.test.ts:240-282`; `.omp/style/ai-integration.md:149-165`                                                                            |
| “Observability” becomes external tracking.                                           | Keep operational evidence local and minimal, with no analytics endpoint or external exporter. `README.md:284-288`                                                                                                                                                       |
| Import input causes instruction following or unsafe mutation.                        | Retain the untrusted-data instruction, schema, validation, preview binding, mandatory human review, and commit-without-recall-AI design. `apps/web/src/server/ai-import.ts:80-86,88-295`; `apps/web/src/app/api/import/route.ts:68-153`                                 |

### Backward-compatibility constraints

1. **API contracts:** Ask remains `{ answer, scope }`, recap `{ recap, scope }`, critique `{ critique }`; retain validation and safe errors unless a separately approved API change migrates every consumer. `apps/web/src/app/api/ai/ask/route.ts:52-62`; `apps/web/src/app/api/ai/recap/route.ts:40-57`; `apps/web/src/app/api/ai/critique/route.ts:17-34`.
2. **Scope authority:** UI-provided filter/timezone snapshots are validated once at the route boundary and cannot be relaxed by a feature, capability, or agent. Unknown/malformed selections must fail, not default to all accounts. `docs/ai-scope.md:3-18`; `apps/web/tests/ai-scope.test.ts:112-155`.
3. **UI freshness:** Existing pending-response invalidation remains correct for answers, errors, recap append/save, account changes, filters, timezone, date changes, and unmount. `apps/web/tests/ai-ui.test.ts:116-218`.
4. **Recap notes:** Keep shared-note exclusion for narrowed scope and preserve active user edits during recap generation. `docs/ai-scope.md:9-10`; `apps/web/tests/ai-scope.test.ts:297-307`; `apps/web/tests/ai-ui.test.ts:177-218`.
5. **Import:** AI remains opt-in; native parsing stays local; preview review is mandatory; a commit consumes the reviewed preview and makes no AI call; token content/encoding/timezone binding and 30-minute expiry remain. `apps/web/tests/ai-import.test.ts:84-167`.
6. **No behavior hidden in a compatibility layer:** Each migrated caller moves to the new feature interface in its cutover phase; remove the superseded path only after parity and all callers have moved.

## Implementation phases

### Phase 0: Discovery baseline [PENDING]

**Purpose:** Convert the cited evidence into a checked migration baseline before changing behavior.

- [ ] **0.1 Record current call graph and consumers.** Inventory every `runAi`, `parseStatementWithAi`, provider-setting, and AI route consumer using language-server references; compare it against the two confirmed server SDK modules and four product capabilities in this record.
- [ ] **0.2 Freeze behavioral test baseline.** Identify the existing assertions that protect provider/key selection, error sanitization, import review binding, account/filter/timezone scope, shared notes, and stale UI responses. Do not weaken or replace them with broad smoke tests.
- [ ] **0.3 Classify undocumented assumptions.** Resolve only facts that affect the design: exact current Vercel AI SDK behavior for cancellation/retry metadata, feature consumer locations, and whether local structured logging exists. Record results as evidence; do not infer them from the style guide.
- [ ] **0.4 Confirm documentation drift.** Compare `.omp/style/ai-integration.md` against current runtime and label each intended-but-absent practice explicitly. Do not represent the style guide’s snippets as implemented behavior. `.omp/style/ai-integration.md:50-185`; `apps/web/src/server/ai.ts:1-66`.

**Exit gate:** A later implementer can point every current behavior and consumer to a source/test reference, and no proposed interface relies on an undocumented provider or database behavior.

### Phase 1: Execution foundation [PENDING]

**Purpose:** Establish one provider-neutral execution runtime without changing feature semantics.

**Likely files to inspect before implementation:**

- `apps/web/src/server/ai.ts`
- `apps/web/src/server/ai-import.ts`
- `apps/web/src/server/settings.ts`
- `apps/web/src/lib/ai-settings.ts`
- `apps/web/tests/ai-settings.test.ts`
- `apps/web/tests/ai-import.test.ts`

- [ ] **1.1 Define narrow execution contracts.** Model typed execution input/result/error metadata needed by direct reflection and structured import. Keep provider/key/model selection inside the runtime; do not expose raw provider clients to routes or features.
- [ ] **1.2 Centralize provider adapter construction.** Move only duplicated OpenAI/Anthropic model construction and `store: false` configuration to the runtime boundary. Preserve each feature’s distinct output, retry, token, input, and timeout policy.
- [ ] **1.3 Add reflection cancellation/deadline handling.** Give direct reflection calls a configured deadline and propagation path for request cancellation. Continue to sanitize provider failures; cancellation must not create a provider retry.
- [ ] **1.4 Preserve import controls verbatim.** Keep output schema, post-validation, `maxOutputTokens: 32000`, `maxRetries: 0`, 120-second abort, upload limits, preview encryption, and reviewed-token commit behavior. Do not route import through an agent.
- [ ] **1.5 Add only necessary local call metadata.** If Phase 0 confirms a need, capture safe runtime facts such as provider/model, elapsed time, finish/error category, and bounded usage without recording prompt text, responses, statement bytes, or key-derived values. Do not create an external telemetry endpoint.

**Exit gate:** Reflection, recap, critique, and import retain their existing externally observable behavior while using a common provider-neutral execution boundary. Existing provider/key and import tests pass unchanged except for intentional internal seam updates.

### Phase 2: Capability extraction [PENDING]

**Purpose:** Separate journal data preparation from AI invocation so a future Ask agent can use typed, read-only, scope-bound domain capabilities.

**Likely files to inspect before implementation:**

- `apps/web/src/app/api/ai/ask/route.ts`
- `apps/web/src/app/api/ai/recap/route.ts`
- `apps/web/src/app/api/ai/critique/route.ts`
- the existing journal query/metrics services reached by those routes
- `apps/web/tests/ai-scope.test.ts`
- `apps/web/tests/ai-ui.test.ts`

- [ ] **2.1 Define an immutable approved-scope value.** It includes the validated filters, resolved accounts, timezone, label/context, and any route-approved date/key constraint. Capability functions accept this value rather than arbitrary filter objects.
- [ ] **2.2 Extract typed read-only capabilities.** Extract the existing aggregate/metric/bucket and single-trade data preparation into domain functions that return bounded typed data. Reuse existing trade query and metric logic; do not duplicate calculations or add raw database queries in tool definitions.
- [ ] **2.3 Keep route adapters authoritative.** Routes still parse/validate requests and construct approved scope before calling a feature interface. A capability may reduce its data result but may never expand accounts, dates, filters, or timezone.
- [ ] **2.4 Establish capability limits.** Bound row counts, bucket counts, string lengths, and execution time using current feature data shapes. Treat an empty matching result as the existing route error/no-provider-call case, not an instruction for the agent to broaden scope.
- [ ] **2.5 Add contract tests.** Prove that every capability refuses malformed/broadened input and returns no cross-account or cross-filter data. Preserve shared-note behavior and single-key critique scope.

**Exit gate:** Ask, recap, and critique can obtain exactly their current data from typed domain capabilities. No capability has provider configuration, persistence side effects, raw database access, or authority to alter its approved scope.

### Phase 3: Ask Journal conditional agent migration [PENDING]

**Purpose:** Decide whether Ask Journal needs one feature-local read-only agent, then migrate only if it demonstrates value over the direct call.

**Entry decision evidence required:** At least one concrete Ask Journal question class is materially better served by selecting or sequencing two or more Phase 2 capabilities than by the existing fixed aggregate prompt; evidence must include bounded latency/cost and no scope regression. If that evidence is absent, keep Ask Journal as a direct feature interface and close this phase without an agent.

- [ ] **3.1 Define the Ask feature interface.** Keep the current question, approved scope, answer, and scope-label behavior behind a typed interface. Assign a prompt version identifier for change review; do not silently alter current prompt text during the interface extraction.
- [ ] **3.2 Define the only allowed agent.** If the entry decision passes, create one Ask Journal agent definition with a fixed instruction, a finite tool/capability allowlist, explicit maximum steps/calls, a response size cap, stop conditions, and no write operations.
- [ ] **3.3 Bind agent calls to approved scope.** Each tool invocation receives the route-created immutable scope. It cannot request a provider key/model, inspect settings, execute raw SQL, change an account/date/filter/timezone, call external services, or invoke import.
- [ ] **3.4 Preserve direct fallback only as a product behavior decision.** If a tool-budget/timeout condition occurs, return a safe, explicit feature failure unless Phase 3 defines and tests a direct-answer fallback that is semantically equivalent and preserves the same scope. Do not add an untested alternate answer path.
- [ ] **3.5 Verify parity and value.** Keep all existing Ask scope/UI tests, add adversarial tool-scope tests, and compare defined question fixtures against the direct feature for factual grounding, response budget, latency, and provider calls.

**Exit gate:** Either (a) Ask remains a direct call because no demonstrated tool-selection value exists, or (b) exactly one read-only, scope-bound Ask agent passes parity, adversarial scope, cancellation, and budget tests. No other feature becomes an agent in this phase.

### Phase 4: Composition only if demonstrated need [PENDING]

**Purpose:** Evaluate controlled composition only after a Phase 3 agent or a direct feature demonstrates a specific unmet, repeatable requirement.

- [ ] **4.1 Write the decision record.** State the user-visible question, why one feature interface/agent cannot satisfy it, the exact composed capabilities, cost/latency ceiling, data boundaries, and rollback rule.
- [ ] **4.2 Prefer deterministic composition.** Compose existing typed capabilities in feature code first. Add another agent only if its bounded tool selection proves necessary against the Phase 4 decision record.
- [ ] **4.3 Reject global coordination by default.** A global orchestrator, manager agent, or hierarchy requires separate demonstrated needs that cannot be met by feature-local deterministic composition. No such need is established by current evidence.
- [ ] **4.4 Test composition boundaries.** Prove data cannot cross account/filter/timezone/feature boundaries and that cancellation, error sanitization, and UI stale-response guarantees still hold.

**Exit gate:** Either no composition is added, or one explicitly justified composition has bounded inputs, tools, time, output, and tests. There is still no global orchestrator or hierarchy without a separately approved decision.

### Phase 5: Enhancement after parity [PENDING]

**Purpose:** Add optional runtime enhancements only when they address measured post-parity requirements.

- [ ] **5.1 Evaluate structured reflection outputs.** Add feature-specific schemas only where the UI/business logic needs fields beyond the existing answer/recap/critique prose. Do not force prose into a schema solely for uniformity.
- [ ] **5.2 Evaluate caching.** Add a feature-local cache only with a scope-complete key, invalidation requirements, retention rule, and proof that it cannot return stale or cross-scope journal content. Import remains uncached unless its preview security design is deliberately re-evaluated.
- [ ] **5.3 Evaluate streaming.** Add streaming only with specified backpressure, client-disconnect cancellation, response ordering, and stale-scope handling. The existing UI discard behavior is the compatibility floor. `.omp/style/ai-integration.md:94-113`; `apps/web/tests/ai-ui.test.ts:116-218`.
- [ ] **5.4 Evaluate a local budget.** If real usage demonstrates a need, introduce an explicit bounded per-session or per-user policy consistent with self-hosted operation and encryption/settings constraints. Do not introduce remote tracking to enforce it. `.omp/style/ai-integration.md:117-130`; `README.md:284-288`.
- [ ] **5.5 Improve local operational diagnostics.** Keep any call logging privacy-preserving and local; exclude prompts, responses, uploaded documents, and all credential material. `.omp/style/ai-integration.md:149-165`.

**Exit gate:** Each enhancement has a measured reason, a feature-local design, and tests for its new failure mode. Unneeded enhancements are deliberately absent.

### Phase 6: Consolidation and deletion of legacy paths [PENDING]

**Purpose:** Finish a proven migration with one clear execution path per feature.

- [ ] **6.1 Confirm every caller has cut over.** Use language-server references and route/UI tests to verify that each reflection feature reaches the selected execution/feature interface path and that import reaches its deterministic workflow.
- [ ] **6.2 Delete superseded runtime helpers and duplicate provider construction.** Remove obsolete adapters, interfaces, comments, exports, and tests that only exercised the replaced path. Keep no compatibility wrappers for identical operations.
- [ ] **6.3 Reconcile implementation and documentation.** Update `.omp/style/ai-integration.md` only after the intended standards are actually implemented or deliberately rejected; distinguish feature-specific choices from mandatory runtime behavior. Update user-facing documentation only if configuration or behavior changed.
- [ ] **6.4 Run the full validation matrix.** Execute the listed targeted and repository checks once after all phases/callers have landed; resolve regressions before removal is complete.

**Exit gate:** There is exactly one maintained provider execution path and one feature path per retained behavior, all callers have migrated, documentation describes actual behavior, and no agent/global orchestration exists beyond approved demonstrated needs.

## Validation matrix

Run these only in the implementation session after the relevant code changes. This planning record itself runs none.

| Coverage                             | Commands / files                                                                                                                                                                                                      | Required assertions                                                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider/key/runtime parity          | `pnpm test apps/web/tests/ai-settings.test.ts`                                                                                                                                                                        | Separate provider models/keys; encrypted key handling; environment precedence; direct provider routing; OpenAI `store: false`; safe error text. `apps/web/tests/ai-settings.test.ts:50-282`                              |
| Import deterministic workflow        | `pnpm test apps/web/tests/ai-import.test.ts`                                                                                                                                                                          | AI remains preview-only; native parsing is unchanged; no AI re-call on commit; reviewed token is content/timezone-bound and expires; invalid/incomplete output fails closed. `apps/web/tests/ai-import.test.ts:84-210`   |
| Scope security and capability parity | `pnpm test apps/web/tests/ai-scope.test.ts`                                                                                                                                                                           | Selected account/filter/timezone only; invalid scope rejects before AI; empty scope does not broaden; shared notes are excluded for subsets; critique stays key-scoped. `apps/web/tests/ai-scope.test.ts:75-155,297-330` |
| UI freshness                         | `pnpm test apps/web/tests/ai-ui.test.ts`                                                                                                                                                                              | Current filter snapshot is sent; server scope is displayed; obsolete answers/errors/recaps are discarded; duplicate submits are prevented; current editor edits are retained. `apps/web/tests/ai-ui.test.ts:93-218`      |
| Existing documented focused suite    | `pnpm test apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-feedback.test.ts`                                                                                                           | Scope selection and UI behavior remain correct without provider connectivity. `docs/ai-scope.md:19-27`                                                                                                                   |
| Static/type/repository checks        | Inspect package scripts and CI configuration in the implementation session, then run the repository’s documented typecheck, lint/format, and full test commands exactly once after all migration phases are complete. | Do not invent commands or claim a check passed without execution evidence.                                                                                                                                               |

## Implementation review checklist

- [ ] Direct recap and critique remain direct calls.
- [ ] Import remains schema-bound, validated, reviewed, and deterministic at commit.
- [ ] Ask is the only possible current agent and only after the Phase 3 gate.
- [ ] Agent tools call typed domain capabilities only; no raw DB/provider/settings access.
- [ ] Every capability is read-only and cannot expand approved account/filter/date/timezone scope.
- [ ] Provider union, encrypted BYO keys, environment precedence, provider-specific model settings, direct server-to-provider routing, and OpenAI `store: false` remain intact.
- [ ] No external telemetry endpoint, prompt/response logging, key logging, or analytics service is introduced.
- [ ] Existing API shapes, stale-response protection, shared-note protections, and import preview/review/commit contracts remain covered.
- [ ] Documentation drift is corrected only after implementation parity; plan text is never treated as current behavior.
- [ ] Obsolete paths are deleted after every caller moves; no compatibility wrapper remains for a superseded identical path.

## Factual uncertainties to resolve in Phase 0

1. The cited evidence establishes the two server-side Vercel AI SDK integration modules and their present behaviors, but not every current callsite/reference; use language-server references before moving exported runtime symbols.
2. The cited evidence establishes no configured reflection timeout/abort signal, cache, streaming, token budget, prompt version, tool loop, or call observability. Phase 0 must determine whether any equivalent behavior exists elsewhere without assuming the style guide implements it.
3. The cited evidence proves repository policy against analytics/tracking services, but it does not establish an existing local logger/metrics facility suitable for AI operational metadata.
4. The cited evidence describes current direct provider adapters and settings behavior, but implementation must consult the installed Vercel AI SDK documentation/version before altering cancellation, retry, usage, structured output, or tool APIs.

## Source index

- `apps/web/src/server/ai.ts:1-66`
- `apps/web/src/server/ai-import.ts:38-86,88-176,178-295`
- `apps/web/src/server/settings.ts:59-115`
- `apps/web/src/lib/ai-settings.ts:1-28`
- `apps/web/src/app/api/ai/ask/route.ts:31-62`
- `apps/web/src/app/api/ai/recap/route.ts:10-57`
- `apps/web/src/app/api/ai/critique/route.ts:7-34`
- `apps/web/src/app/api/import/route.ts:68-153`
- `docs/ai-scope.md:1-27`
- `apps/web/tests/ai-settings.test.ts:50-282`
- `apps/web/tests/ai-import.test.ts:84-210`
- `apps/web/tests/ai-scope.test.ts:75-155,297-330`
- `apps/web/tests/ai-ui.test.ts:93-218`
- `.omp/style/ai-integration.md:50-185`
- `README.md:68-82,100-106,284-288`
