# 02 — AI Architecture

> Architecture as-implemented, verified against source. Claims tagged VERIFIED (file:line), INFERRED (best reading), UNVERIFIED (unreachable), or UNKNOWN (no evidence). No secrets.

---

## 1. System Overview

Five AI routes exist:

| Route | Handler | Pattern | Tool loop |
|---|---|---|---|
| Ask Journal | `POST /api/ai/ask` | aggregate + bounded agent | yes — `runAskJournalAi` |
| Reports | `POST /api/ai/reports` | aggregate + bounded agent | yes — `runReportsAgentAi` |
| Daily Recap | `POST /api/ai/recap` | aggregate → direct reflection | no |
| Trade Critique | `POST /api/ai/critique` | single trade → direct reflection | no |
| Statement Import | `POST /api/import` (mode=preview) | schema-constrained extraction | no |

All AI runs server-side only. The client supplies a validated scope snapshot; the server resolves the provider key from the encrypted settings store and calls the model directly. No AI request, response, or key passes through a third-party relay.

**Evidence:** `apps/web/src/app/api/ai/ask/route.ts:1-17`; `apps/web/src/app/api/ai/reports/route.ts:1-17`; `apps/web/src/app/api/ai/recap/route.ts:1-30`; `apps/web/src/app/api/ai/critique/route.ts:1-15`; `apps/web/src/app/api/import/route.ts:77-83`

---

## 2. Provider & Key Management

**VERIFIED** — `apps/web/src/lib/ai-settings.ts`; `apps/web/src/server/settings.ts`

### 2.1 Supported providers

Two closed-union providers: `openai` and `anthropic`. Provider is persisted per-user in encrypted settings. Each provider has its own model ID and API key field.

### 2.2 Key resolution order (precedence high → low)

1. Environment variable for the selected provider (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`)
2. Encrypted saved key in the settings store (AES-GCM, user-specific)

`aiConfigured()` returns `true` only when the resolved key is non-null. **Evidence:** `apps/web/src/server/ai.ts:253-257`

### 2.3 Provider adapter construction

Provider-specific model adapters are constructed at the call site inside `runTextAi`, `runAskAgentAi`, `runReportsAgentAi`, and `runObjectAi`:

```
openai  → createOpenAI({ apiKey }).responses(modelId)
anthropic → createAnthropic({ apiKey })(modelId)
```

OpenAI requests include `providerOptions: { openai: { store: false } }` to disable response storage. **Evidence:** `apps/web/src/server/ai-runtime.ts:136-140,173-177,239-243`

### 2.4 BYO-key model

The system is self-hosted (BYO-key). No shared API gateway, no analytics endpoint, no telemetry exporter. **Evidence:** `README.md` (repo policy)

---

## 3. Execution Runtime

### 3.1 Module layout

Three runtime modules participate in every AI call:

| Module | Responsibility |
|---|---|
| `apps/web/src/server/ai-contracts.ts` | Feature policy table, error class, execution metadata types |
| `apps/web/src/server/ai-runtime.ts` | `runReportsAgentAiRuntime`; provider-neutral execution: model construction, `generateText` calls, error mapping |
| `apps/web/src/server/ai.ts` | Public `runAi`, `runAskJournalAi`, `runReportsAgentAi` wrappers; tool factory |

**Evidence:** `apps/web/src/server/ai-contracts.ts:1-57`; `apps/web/src/server/ai-runtime.ts:1-313`; `apps/web/src/server/ai.ts:1-336`

### 3.2 Feature policies

`AI_FEATURE_POLICIES` in `ai-contracts.ts:36-51` defines per-feature execution constraints:

```typescript
reflection:       { maxOutputTokens: 1200,  maxRetries: 2 }
askJournalAgent:  { maxOutputTokens: 1200,  maxRetries: 2, timeoutMs: 30_000, maxSteps: 4, maxToolCalls: 4 }
reportsAgent:     { maxOutputTokens: 1200,  maxRetries: 2, timeoutMs: 30_000, maxSteps: 4, maxToolCalls: 4 }
statementImport:  { maxOutputTokens: 32_000, maxRetries: 0, timeoutMs: 120_000 }
```

`maxOutputTokens` for agent features is divided equally across steps: `Math.floor(policy.maxOutputTokens / maxSteps)` per step. **Evidence:** `apps/web/src/server/ai-runtime.ts:172-173,232-233`

### 3.3 Error handling

`AiRuntimeError` (7 categories) never relays raw provider text. **Evidence:** `apps/web/src/server/ai-runtime.ts:60-96`

```
missing_key       → "AI is not configured — add an API key in Settings."
authentication    → "AI authentication_error: check your provider key…"
billing           → "AI billing: check your provider account's credits…"
rate_limited      → "AI rate limit: please try again shortly."
model_unavailable → "AI model unavailable: check the model ID…"
timeout           → "AI request timed out. Check your connection…"
provider          → "AI request failed. Check your provider settings…"
```

**VERIFIED** — `apps/web/src/server/ai-runtime.ts:53-96`

### 3.4 Execution metadata

`AiExecutionMeta` is built for every call (reflection, agent, object). It records: `feature`, `provider`, `modelId`, `promptVersion`, `durationMs`, `finishReason`, `inputTokens`, `outputTokens`, `maxRetries`, `stepCount` (agent only), `toolCallCount` (agent only). Keys, prompts, and responses are never logged. **VERIFIED** — `apps/web/src/server/ai-runtime.ts:104-117`

### 3.5 Prompt versions

```typescript
AI_PROMPT_VERSIONS = {
  reflection:         "reflection-v1",
  askJournalAgent:    "ask-journal-agent-v1",
  reportsAgent:       "reports-agent-v1",
  statementImport:    "statement-import-v1",
}
```

**VERIFIED** — `apps/web/src/server/ai-contracts.ts:53-57`

---

## 4. Prompts

### 4.1 Prompt builders

All prompt construction lives in `apps/web/src/server/ai-prompts.ts`. Prompt text is validated as a string — no variable interpolation at the callsite. **Evidence:** `apps/web/src/server/ai-prompts.ts:1-61`

| Builder | Used by | Pattern |
|---|---|---|
| `REFLECTION_SYSTEM_PROMPT` | `runAi` | static system instruction |
| `buildAskJournalPrompt` | `runAskJournalAi` | question + aggregate context + tool instruction |
| `buildReportsAgentPrompt` | `runReportsAgentAi` | question + aggregate context + switch_report_mode instruction |
| `buildDailyRecapPrompt` | `runAi` (recap) | structured daily data → prose recap |
| `buildTradeCritiquePrompt` | `runAi` (critique) | single trade + fills → prose critique |

### 4.2 Import system prompt

Lives in `ai-import.ts:69-72` (inline `const SYSTEM`). Explicitly instructs the model: document is **untrusted DATA**, ignore any embedded requests, do not call tools, do not invent facts. Bounded to `AI_IMPORT_MAX_EXECUTIONS` rows. **VERIFIED**

---

## 5. Tool System

### 5.1 Registered tools (Ask Journal + Reports)

`createAskJournalTools(scope, context, reserveToolCall?, feature?)` in `ai.ts:93-249` produces exactly these tools:

| Tool | Input | Effect |
|---|---|---|
| `get_journal_summary` | `{}` | returns `context` string (prebuilt aggregate) |
| `find_trades` | `{symbol?, outcome?, dateOrder?}` | returns ≤5 summarized trades |
| `get_trade_detail` | `{key: string}` | returns one trade + ≤50 fills |
| `switch_report_mode` | `{mode, primary?, secondary?}` | returns bounded report-mode context; only registered when `feature="reports"` |

Tool inputs are validated with `jsonSchema` + manual `hasOnlyKeys` guard. Inputs must have **no fields outside the allowlist** — a provider-bypassing field causes rejection. **VERIFIED** — `apps/web/src/server/ai.ts:26-45`

### 5.2 Tool budget

`maxToolCalls` (4 per feature policy) is tracked by a closure-scoped counter passed as `reserveToolCall` into `createAskJournalTools`. When exhausted, tools return `{ error: "AI tool limit reached." }` without throwing — the agent receives the error string and can respond. **VERIFIED** — `apps/web/src/server/ai-runtime.ts:160-168,222-229`

### 5.3 Agent stop conditions

Three conditions trigger `AiRuntimeError("provider", …)`:

1. `toolBudgetExceeded` — `toolCallCount >= maxToolCalls`
2. Step limit hit with `finishReason === "tool-calls"` — model still wants more tools
3. Empty text output — model returned nothing useful

**Evidence:** `apps/web/src/server/ai-runtime.ts:185-194,244-253`

---

## 6. Capability vs. Registered Tool Gap

### 6.1 Registered tools — confirmed 4 (plus 1 conditional)

`createAskJournalTools` registers at most **4 tools** for Ask and **5** for Reports (Ask + `switch_report_mode`). **VERIFIED** by source: `apps/web/src/server/ai.ts:93-249`

### 6.2 Existing capabilities not registered as tools

`ai-capabilities.ts` defines these functions that are **NOT wired into `createAskJournalTools`** and **NOT available to the Ask/Reports agent**:

| Capability | Location | Data source | Status |
|---|---|---|---|
| `askJournalContext` | `ai-capabilities.ts:36` | trades (computed metrics + buckets) | **IN USE** — pre-tool aggregate for Ask + Reports |
| `dailyRecapContext` | `ai-capabilities.ts:94` | trades filtered by date | **IN USE** — feeds recap route |
| `tradeCritiqueContext` | `ai-capabilities.ts:150` | single trade + fills | **IN USE** — feeds critique route |
| `playbookRulesForTrade` | `ai-capabilities.ts:179` | trades+playbooks | **NOT REGISTERED** — ARCH-006 |
| `missedObservations` | `ai-capabilities.ts:211` | trades+missed | **NOT REGISTERED** — ARCH-007 |
| `notebookEntries` | `ai-capabilities.ts:247` | trades+notes | **NOT REGISTERED** — ARCH-008 |
| `progressHistory` | `ai-capabilities.ts:277` | trades+progress | **NOT REGISTERED** — ARCH-009 |
| `reportContext` | `ai-report-context.ts` | same trades | **INDIRECT USE** — called by `switch_report_mode` tool only |

### 6.3 Data source types and their scope

`FrozenApprovedScope.dataSource` is one of: `"trades"`, `"trades+playbooks"`, `"trades+missed"`, `"trades+notes"`, `"trades+progress"`. The 4 unregistered capabilities check `scope.dataSource` and return `{ error: "Scope does not include X data" }` if mismatched — they are safe to expose but simply have not been wired. **VERIFIED** — `ai-capabilities.ts:180-182,213-214,249-251,284-286`

### 6.4 Explicit gap documentation

| Gap | Implication | ARCH-ID |
|---|---|---|
| `playbookRulesForTrade` | Agent cannot answer "which playbook rules did I break on this trade?" | ARCH-006 |
| `missedObservations` | Agent cannot answer "what missed opportunities did I archive?" | ARCH-007 |
| `notebookEntries` | Agent cannot answer "what notes do I have about trades?" | ARCH-008 |
| `progressHistory` | Agent cannot answer "what's my routine adherence over N weeks?" | ARCH-009 |
| `reportContext` direct access | Reports agent can only call `switch_report_mode` tool; cannot call `reportContext` directly for multi-mode comparison | ARCH-010 |

---

## 7. Chat Persistence

### 7.1 Schema check — no conversation tables

No tables named `conversations`, `messages`, `chat_history`, `chat_threads`, or similar exist in the Drizzle schema. **VERIFIED** — grep across `apps/web/src/db` returned zero matches for conversation-persistence keywords.

### 7.2 Memory mechanism

The Ask/Reports route creates a `FrozenApprovedScope` at request time: validated filters, resolved accounts, timezone, scope label. This is passed into `askJournalContext` to build the aggregate context string. The context string is the **only memory** — it is a prebuilt snapshot, not a rolling conversation history. **VERIFIED** — `apps/web/src/server/ai-scope.ts:47-49` (readAiRequest) + `apps/web/src/server/ai-capabilities.ts:36-68` (askJournalContext builds the context string fresh per request)

### 7.3 Stale-response protection

`useAiRequest` hook (`apps/web/src/lib/use-ai-request.ts`) uses an `active` ref keyed by the component's filter snapshot. A late-arriving response is dropped silently because `accept(result)` is only called when `active.current === true`. This prevents a stale answer from replacing a fresh one or one scope from replacing another. **VERIFIED** — `apps/web/src/lib/use-ai-request.ts:9-28`

### 7.4 Conclusion: no chat persistence

There is no persistent chat state. Every request is stateless — the "memory" is the pre-built aggregate context string built server-side from the validated scope. This is architecturally different from a session-based chat system.

---

## 8. Streaming

### 8.1 `streamText` not used

Grep for `streamText` across `apps/web/src/server` returned zero matches. The AI SDK's `streamText` API is not present in the codebase. **VERIFIED**

### 8.2 All AI calls are non-streaming

All routes (`ask`, `reports`, `recap`, `critique`, `import`) use non-streaming `generateText` with a final `result.text` response returned to the client as JSON. **VERIFIED** — `ai-runtime.ts:136-147,156-194,225-260,284-306`

---

## 9. `@ai-sdk/mcp` Usage

### 9.1 It exists but not for AI agents

`@ai-sdk/mcp@^2.0.73` is listed in dependencies. Its import is found in:

```
apps/web/src/server/ctrader-mcp/client.ts:2
  import { createMCPClient, type CallToolResult, type MCPClient } from "@ai-sdk/mcp";
```

This is a **CTrader broker sync MCP client**, not an AI agent tool provider. The `CTraderMcpClient` wraps a Model Context Protocol transport for fetching trades/deals from the cTrader broker API. It is used for account synchronization, not for AI model tooling. **VERIFIED** — `apps/web/src/server/ctrader-mcp/client.ts:1-57`

### 9.2 No AI tool MCP integration

`@ai-sdk/mcp` is not imported or used in any AI runtime, tool factory, or agent definition file. The `createAskJournalTools` function uses `import { tool } from "ai"` (Vercel AI SDK's built-in `tool()`), not an MCP tool adapter.

---

## 10. Caller Chains

### 10.1 Ask Journal

```
POST /api/ai/ask
  → readAiRequest(body, "question")
      → deepFreeze(scope)                    [ai-scope.ts:47-49, 163-176]
  → askJournalContext(scope)
      → queryTrades(filters, timeZone)       [ai-capabilities.ts:36-68]
      → computeMetrics(trades)
      → build aggregate context string
  → runAskJournalAi(resolvedScope, context)  [ai.ts:259-278]
      → resolveAiConfiguration()
      → runAskAgentAi({                      [ai-runtime.ts:162-194]
          feature: "askJournalAgent",
          createTools: (reserveToolCall) =>
            createAskJournalTools(scope, context, reserveToolCall)
              → get_journal_summary tool      [ai.ts:97-114]
              → find_trades tool             [ai.ts:115-147]
              → get_trade_detail tool        [ai.ts:148-195]
          maxSteps: 4, maxToolCalls: 4
        })
      → generateText(model, tools, stopWhen: isStepCount(4))
  → return { answer, scope }
```

**Evidence:** `apps/web/src/app/api/ai/ask/route.ts:1-17`; `apps/web/src/server/ai.ts:259-278`; `apps/web/src/server/ai-runtime.ts:162-194`

### 10.2 Reports Agent

```
POST /api/ai/reports
  → readAiRequest(body, "question")
  → askJournalContext(scope)                [ai-capabilities.ts:36-68]
  → runReportsAgentAi(resolvedScope, context) [ai.ts:280-298]
      → runReportsAgentAiRuntime({          [ai-runtime.ts:225-260]
          feature: "reportsAgent",
          createTools: (reserveToolCall) =>
            createAskJournalTools(scope, context, reserveToolCall, "reports")
              → + switch_report_mode tool    [ai.ts:196-249]
          maxSteps: 4, maxToolCalls: 4
        })
  → return { answer, scope }
```

**Evidence:** `apps/web/src/app/api/ai/reports/route.ts:1-17`; `apps/web/src/server/ai.ts:280-298`; `apps/web/src/server/ai-runtime.ts:225-260`

### 10.3 Daily Recap

```
POST /api/ai/recap
  → readAiRequest(body, "date")
  → dailyRecapContext(scope, date, existingNote) [ai-capabilities.ts:94-147]
      → queryTrades(filters)
      → day filter + computeMetrics
  → buildDailyRecapPrompt(…)
  → runAi(prompt)                           [ai.ts:240-256]
      → runTextAi({ feature: "reflection" }) [ai-runtime.ts:130-148]
          → generateText(model, prompt, maxOutputTokens: 1200)
  → return { recap, scope }
```

**Evidence:** `apps/web/src/app/api/ai/recap/route.ts:1-30`; `apps/web/src/server/ai.ts:240-256`; `apps/web/src/server/ai-runtime.ts:130-148`

### 10.4 Trade Critique

```
POST /api/ai/critique
  → tradeCritiqueContext(key)              [ai-capabilities.ts:150-170]
      → getTradeByKey(key)
      → listExecutions(accountId, executionIds)
  → buildTradeCritiquePrompt(result)
  → runAi(prompt)                          [ai.ts:240-256]
      → runTextAi({ feature: "reflection" })
  → return { critique }
```

**Evidence:** `apps/web/src/app/api/ai/critique/route.ts:1-15`; `apps/web/src/server/ai.ts:240-256`

### 10.5 Statement Import (AI preview)

```
POST /api/import (mode: "preview", ai: true)
  → parseStatementWithAi(statement, signal?) [ai-import.ts:173-228]
      → runObjectAi({                       [ai-runtime.ts:284-306]
          feature: "statementImport",
          messages: [{ role: "user", content: statement.content }],
          output: schema,                   // jsonSchema<Extraction>
          maxOutputTokens: 32_000,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(120_000)
        })
      → validateAiExtraction(result.output)
  → createAiImportPreview(statement, parsed)
  → return { preview, token }
```

**Evidence:** `apps/web/src/app/api/import/route.ts:77-83`; `apps/web/src/server/ai-import.ts:173-228`

### 10.6 Summary of exported AI functions

| Function | Defined | Calls |
|---|---|---|
| `runAi(prompt)` | `ai.ts:240` | `runTextAi` (reflection) |
| `runAskJournalAi(scope, context)` | `ai.ts:259` | `runAskAgentAi` |
| `runReportsAgentAi(scope, context)` | `ai.ts:280` | `runReportsAgentAi` (runtime) |
| `parseStatementWithAi(statement, signal?)` | `ai-import.ts:173` | `runObjectAi` |

**Evidence:** `apps/web/src/server/ai.ts:240,259,280`; `apps/web/src/server/ai-import.ts:173`

---

## 11. Frontend Chat UI

### 11.1 Ask Journal UI component

`apps/web/src/components/ask-journal.tsx` — `"use client"` component. Pattern:

1. `useFilters()` supplies current filter snapshot (accounts, date range, timezone)
2. `useAiRequest()` manages pending/dismiss/error state
3. `postJson("/api/ai/ask", { question, filters, timeZone })` — single stateless POST
4. Answer and scope rendered in the card; no streaming, no chat history
5. Suggestions rendered as clickable buttons
6. Component re-mounts on filter/timezone change (keyed by `${timeZone}:${query}`) — forces fresh state, discards any pending response from previous scope

**VERIFIED** — `apps/web/src/components/ask-journal.tsx:1-98`; `apps/web/src/lib/use-ai-request.ts:1-37`

### 11.2 AI Recap component

`apps/web/src/components/ai-recap.tsx` — `"use client"` button component. Pattern:

1. Parent keys the component by `date`
2. `postJson("/api/ai/recap", { date, filters, timeZone })`
3. `onRecap` callback delivers result to parent; no internal answer state

**VERIFIED** — `apps/web/src/components/ai-recap.tsx:1-36`

### 11.3 No other AI chat components

No other component in `apps/web/src/components` makes requests to `/api/ai/ask` or `/api/ai/reports`. **VERIFIED** — grep across `apps/web/src/components` returned only `ask-journal.tsx` and `ai-recap.tsx`.

### 11.4 No streaming UI

`useAiRequest.run()` is a standard `async/await` — it resolves the full JSON response before calling `accept(result)`. There is no `ReadableStream`, no `TextEncoderStream`, no SSE endpoint. The API routes return `ok({ answer, scope })` as regular JSON.

---

## 12. Architecture Diagrams

### 12.1 Request lifecycle — Ask Journal

```
Browser                      Server                          AI Runtime
   |                             |                                |
   | POST /api/ai/ask           |                                |
   | { question, filters, tz }  |                                |
   |----------------------------→|                                |
   |                             | readAiRequest(body)            |
   |                             | deepFreeze(scope)             |
   |                             |                                |
   |                             | askJournalContext(scope)       |
   |                             |   → queryTrades(...)          |
   |                             |   → computeMetrics(...)       |
   |                             |   → context string            |
   |                             |                                |
   |                             | runAskJournalAi(scope, ctx)    |
   |                             |   → resolveAiConfiguration() |
   |                             |   → runAskAgentAi({            |
   |                             |         createTools: fn       |
   |                             |       })                      |
   |                             |---------------------------→   |
   |                             |         generateText(model,   |
   |                             |           tools,              |
   |                             |           stopWhen=maxSteps) |
   |                             |                                |
   |   ← ← ← { answer, scope }  ← ← ← ← ← ← ← ← ← ← ← ← ← ← ← |
   |                                (JSON, not streamed)        |
```

### 12.2 Tool loop — bounded step/call cycle

```
generateText(model, tools, stopWhen=isStepCount(4))
  ┌─────────────────────────────────────────────────────┐
  │ Step 1: model → text + tool_calls: [find_trades]  │
  │   toolBudget counter = 1/4                         │
  │   execute: queryTrades → { trades: [...] }        │
  │   result returned to model                         │
  │                                                     │
  │ Step 2: model → text + tool_calls: [get_trade_detail]
  │   toolBudget counter = 2/4                         │
  │   execute: getTradeByKey + listExecutions → fills  │
  │   result returned to model                         │
  │                                                     │
  │ Step 3: model → text (no tool_calls)               │
  │   stopWhen triggers: stepCount=3, finishReason=?   │
  │   result.text returned                             │
  └─────────────────────────────────────────────────────┘
```

### 12.3 Capability vs. tool availability matrix

```
Capability              | Route caller      | In agent tools?
------------------------|------------------|----------------
askJournalContext       | ask/reports route| YES (via context string, pre-tool)
dailyRecapContext        | recap route      | NO (direct call)
tradeCritiqueContext     | critique route   | NO (direct call)
playbookRulesForTrade    | (unused by AI)    | NO — NOT REGISTERED [ARCH-006]
missedObservations      | (unused by AI)    | NO — NOT REGISTERED [ARCH-007]
notebookEntries          | (unused by AI)    | NO — NOT REGISTERED [ARCH-008]
progressHistory          | (unused by AI)    | NO — NOT REGISTERED [ARCH-009]
reportContext            | switch_report_mode tool | INDIRECT (via tool only)
```

---

## 13. Relationship to Existing Migration Plan

**Reference:** `docs/superpowers/plans/2026-10-08-ai-agent-architecture-migration.md`

The plan dated 2026-10-08 describes a **target architecture** with status `not-started`. The current codebase implements **more than the plan anticipated**:

| Plan says | Current state |
|---|---|
| "Exactly two generateText modules" | Three: `runTextAi`, `runAskAgentAi`, `runReportsAgentAi`, `runObjectAi` in `ai-runtime.ts` |
| "Ask Journal is a direct call" | Ask Journal is already a bounded tool-loop agent (`maxSteps=4`, `maxToolCalls=4`) |
| "Reports is a direct call" | Reports is already a bounded tool-loop agent |
| "4 unregistered capabilities" | Same 4 remain unregistered; they are `playbookRulesForTrade`, `missedObservations`, `notebookEntries`, `progressHistory` |

The plan's target architecture (bounded Ask Journal agent) has been **partially implemented** but the 4 additional capabilities it recommends as candidates for Phase 2 are still unregistered. The plan's plan/policy distinction (ask-journal-agent vs. reflection) is now embodied in `AI_FEATURE_POLICIES` and `AI_PROMPT_VERSIONS` in `ai-contracts.ts`.

---

## 14. Evidence Index

| ID | Claim | Evidence |
|---|---|---|
| ARCH-001 | 4 AI routes + 1 import route | `apps/web/src/app/api/ai/ask/route.ts`, `reports`, `recap`, `critique`; `import/route.ts` |
| ARCH-002 | `aiConfigured()` key resolution | `apps/web/src/server/ai.ts:253-257` |
| ARCH-003 | Provider adapter construction | `apps/web/src/server/ai-runtime.ts:134-140,169-177,236-243` |
| ARCH-004 | `AI_FEATURE_POLICIES` table | `apps/web/src/server/ai-contracts.ts:36-51` |
| ARCH-005 | `AiExecutionMeta` buildMeta | `apps/web/src/server/ai-runtime.ts:104-117` |
| ARCH-006 | `playbookRulesForTrade` not registered | `apps/web/src/server/ai-capabilities.ts:179-207`; `createAskJournalTools` only 4 tools (`ai.ts:93-249`) |
| ARCH-007 | `missedObservations` not registered | `apps/web/src/server/ai-capabilities.ts:211-244` |
| ARCH-008 | `notebookEntries` not registered | `apps/web/src/server/ai-capabilities.ts:247-275` |
| ARCH-009 | `progressHistory` not registered | `apps/web/src/server/ai-capabilities.ts:277-329` |
| ARCH-010 | `reportContext` only via tool | `apps/web/src/server/ai.ts:196-249` (switch_report_mode execute calls reportContext) |
| ARCH-011 | No chat persistence tables | grep `apps/web/src/db` for `conversations\|messages\|chat_history` |
| ARCH-012 | Stale-response protection via active ref | `apps/web/src/lib/use-ai-request.ts:9-28` |
| ARCH-013 | `streamText` not used | grep `apps/web/src/server` for `streamText` |
| ARCH-014 | `@ai-sdk/mcp` for CTrader, not AI agent | `apps/web/src/server/ctrader-mcp/client.ts:2` |
| ARCH-015 | `createAskJournalTools` validates inputs | `apps/web/src/server/ai.ts:26-92` (hasOnlyKeys + is*Input validators) |
| ARCH-016 | Tool budget via closure counter | `apps/web/src/server/ai-runtime.ts:160-168,222-229` |
| ARCH-017 | Per-step output token allocation | `apps/web/src/server/ai-runtime.ts:172-173,232-233` |
| ARCH-018 | Ask route → askJournalContext → runAskJournalAi | `apps/web/src/app/api/ai/ask/route.ts:14-16`; `apps/web/src/server/ai.ts:259-278` |
| ARCH-019 | Reports route → runReportsAgentAi | `apps/web/src/app/api/ai/reports/route.ts:14-16`; `apps/web/src/server/ai.ts:280-298` |
| ARCH-020 | Import → `parseStatementWithAi` → `runObjectAi` | `apps/web/src/app/api/import/route.ts:80`; `apps/web/src/server/ai-import.ts:173-228` |
| ARCH-021 | AskJournal component uses useAiRequest | `apps/web/src/components/ask-journal.tsx:38-48` |
| ARCH-022 | No streaming in routes | All routes return `ok({ ... })` (regular JSON), no SSE |
| ARCH-023 | Import system prompt untrusted data instruction | `apps/web/src/server/ai-import.ts:69-72` |
| ARCH-024 | `deepFreeze` on scope | `apps/web/src/server/ai-scope.ts:17-23` |
| ARCH-025 | `readAiRequest` whitelist validation | `apps/web/src/server/ai-scope.ts:47-163` |
