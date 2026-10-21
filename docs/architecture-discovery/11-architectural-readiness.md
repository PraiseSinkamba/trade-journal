# Section 11 — Architectural Readiness

> Architecture as-implemented, verified against source. Claims tagged VERIFIED (file:line), INFERRED (best reading), UNVERIFIED (unreachable), or UNKNOWN (no evidence). Evidence IDs 700–799 reserved for this section.

---

## Overview

This section evaluates 15 capability categories against the as-built system to determine how close the journal is to supporting an autonomous, event-driven, tool-using AI agent system. Each category receives a support classification, a citation to the most relevant evidence, a gap summary, and an architectural-impact classification.

The system today is a **user-initiated, request/response AI application** with no background workers, no event bus, no persistent AI memory, and no dynamic tool loading. The gap between current state and a fully autonomous agent system is significant but structurally approachable: the AI runtime, tool framework, and domain model all exist — what is missing is the **reactive infrastructure layer** that connects events to AI actions, and the **persistent memory layer** that retains AI observations across sessions.

---

## Capability Matrix

| # | Capability | Existing Support | Key Evidence | Gap | Architectural Impact |
|---|---|---|---|---|---|
| 1 | AI outside chat | **Partially supported** | AI runs in `/api/import` (preview only), `/api/ai/ask`, `/api/ai/reports`, `/api/ai/recap`, `/api/ai/critique` — all HTTP request/response handlers. AI is **not** invoked by background processes, trade-import commit, or broker-sync flows. `ai-import.ts:69-72` bounds AI to preview rows; `ai-runtime.ts:136-147` is called synchronously with no background variant. | No AI invocation path for: trade commit hooks, scheduled summary generation, sync completion callbacks, or rule-breach alerts. The AI runtime has no fire-and-forget mode. | **Missing feature** — requires a job/queue layer that can call `runAi`-equivalent logic asynchronously. See §5. |
| 2 | Modular AI tools | **Partially supported** | 4 tools registered (`get_journal_summary`, `find_trades`, `get_trade_detail`, `switch_report_mode`) via `createAskJournalTools` (`ai.ts:93-249`). 4 additional capabilities defined in `ai-capabilities.ts` but **not wired** into the tool factory: `playbookRulesForTrade` (:179), `missedObservations` (:211), `notebookEntries` (:247), `progressHistory` (:277). Each has a safe scope-check guard that returns an error object if the data source is not in scope. | The 4 dormant capabilities are defined but unreachable by the agent. Wiring them requires adding them to `createAskJournalTools` and updating the prompt builder to describe their use. | **Missing feature** — add 4 tool registrations in `ai.ts:93-249`; update `buildAskJournalPrompt` in `ai-prompts.ts` to include their descriptions. |
| 3 | Dynamic skill loading | **Not currently supported** | No `import()`, no plugin registry, no skill directory. Grep across `apps/web/src/` for `createRequire\|require("|"`) returns zero skill-loading patterns. `ai-prompts.ts` is the only prompt source; it is a static module with no conditional loading. | No mechanism to load, version, or hot-reload prompt templates or tool definitions at runtime. | **Architectural limitation** — requires a skill registry, versioned prompt storage (DB or file), and a `resolveSkill(name, version)` lookup used by the tool factory. |
| 4 | Event publishing | **Not currently supported** | No `EventEmitter`, `addListener`, `dispatch`, or message broker. Grep for `EventEmitter\|addListener\|dispatch\|process\.on\|pg-boss\|bullmq` across `apps/web/src/`, `packages/*/src/`, `scripts/` returns zero matches. The only pub/sub is a design-token listener registry in `components/charts/tokens.ts:50` — not a domain event bus. | No event bus means no subscriber pattern for domain actions (trade saved, sync completed, rule broken). All coordination is hard-coded direct calls. | **Missing feature** — requires an event bus (Node `EventEmitter` or a minimal pub/sub) and `emit()` calls at domain action points. Refactoring all direct-call coordination to publish/subscribe is a significant but bounded change. |
| 5 | Background processing | **Not currently supported** | No `cron`, no worker threads, no `setInterval` (animation only at `trade-market-data.tsx:369`). All processing is synchronous and user-driven. `ARCH-200, ARCH-207` | No background worker means no scheduled AI tasks (daily recap generation, weekly summary, rule-breach alerts). The market-data transport uses `setTimeout` for retry scheduling but is not a general-purpose job queue. | **Missing feature** — requires a job queue (even an in-process one with persistent storage) to schedule AI tasks. A `jobs` table in SQLite with a polling worker would suffice for MVP. |
| 6 | Persistent observations | **Not currently supported** | No `observations`, `ai_memory`, or `session_history` table in the Drizzle schema. No concept of an AI "note" about a trade or market condition that persists for later retrieval. `notes` table (`schema.ts:173-189`) stores human notes, not AI-generated observations. | No storage for AI-generated insights, flagged patterns, or learned correlations. Any AI observation vanishes after the HTTP response. | **Missing feature** — requires a new table (e.g., `ai_observations`) with fields for `id`, `tradeKey`, `symbol`, `observation`, `tags`, `createdAt`. The AI runtime would write to it; the tool layer would read from it. |
| 7 | Behavioral pattern tracking | **Not currently supported** | `metrics.ts` computes aggregate statistics (win rate, profit factor, R-multiple) but these are point-in-time query results, not tracked sequences. No table stores a behavioral "profile" that evolves over time. | No mechanism to track that a user consistently exits early on Tuesdays, or that a certain pattern triggers a specific behavior. | **Missing feature** — requires new tables for behavioral profiles and pattern rules, plus a tracking system that updates them on each relevant event. |
| 8 | Durable workflows | **Not currently supported** | All AI routes (`ask`, `reports`, `recap`, `critique`) are stateless request/response. `AiExecutionMeta` is built per-call but not persisted. `ARCH-407` — no workflow state store. | No multi-step AI workflow can pause, resume, or recover from interruption. A "generate daily recap" task that gets interrupted must restart from scratch. | **Missing feature** — requires a workflow state table (e.g., `ai_workflow_steps`) with fields for `workflowId`, `feature`, `step`, `state`, `resumeKey`. The AI runtime would checkpoint state after each step. |
| 9 | AI-initiated interactions | **Not currently supported** | All 5 AI routes are triggered by an explicit user HTTP request. No timer-driven, event-driven, or subscription-based AI invocation. The broker sync via `CTraderMcpClient` is an outbound HTTP call, not an inbound AI action. | The system can never proactively notify the user of a discovered pattern, a rule breach, or an anomaly — it can only respond to queries. | **Missing feature** — requires combining background processing (§5) + event publishing (§4) + AI invocation to enable AI-initiated workflows. |
| 10 | Interactive AI outputs | **Partially supported** | AI returns prose markdown text via `generateText` → `result.text` → `NextResponse.json`. The frontend renders as plain text. `ai-runtime.ts:136-147` is the canonical call site; no `output` schema for UI components. No `streamText`. `ARCH-408` | AI cannot return interactive UI components (charts, tables, action buttons). A user asking "show my P&L chart" gets prose description, not an embedded chart. | **Missing feature** — requires `streamText` with a UI-component output schema, a frontend renderer for structured AI outputs, and updated prompt instructions for when to emit structured vs. prose responses. |
| 11 | Strategy rule evaluation | **Partially supported** | Manual UI (`rule-checklist.tsx`) + read-only `analyzeAdherence` in `packages/core/src/adherence.ts`. `POST /api/trades/[key]/rules` writes `trade_rule_checks` rows. No AI-driven rule evaluation. `ARCH-076` | The system can report whether a past trade followed playbook rules, but cannot proactively score a planned trade against those rules before entry, nor generate corrective guidance. | **Missing feature** — requires an AI tool that calls `analyzeAdherence` or implements rule scoring, plus a pre-trade prompt path that uses it. |
| 12 | Cross-domain intelligence | **Partially supported** | `askJournalContext` (`ai-capabilities.ts:36`) aggregates trades + computed metrics + buckets into a single context string — the only cross-domain data the agent sees. `reportContext` (`ai-report-context.ts`) is called by `switch_report_mode` tool but not directly accessible. `ARCH-006–010` | The context aggregation logic is powerful but is not available as a reusable tool, and cannot be called mid-conversation to refresh a specific domain's data. | **Missing feature** — requires exposing `askJournalContext`, `reportContext`, and the other capability functions as named tools callable by the agent at any point during a conversation. |
| 13 | Persistent user context | **Partially supported** | `settings` table stores user preferences (AI provider, model, theme, timezone). `ARCH-100` in §4. No conversation history, no learned preferences, no feedback loop. Every AI request starts from scratch with a freshly built context string. | No memory of prior AI conversations, no user correction history, no learned preferences (preferred report format, default time range, favored analysis depth). | **Missing feature** — requires a conversation history table and a user-preference learning layer that influences prompt construction. |
| 14 | User feedback and corrections | **Not currently supported** | No UI for rating, correcting, or endorsing AI responses. No storage for feedback signals. No mechanism to incorporate corrections into future AI behavior. | Users cannot correct a wrong AI answer, endorse a good one, or tune AI behavior over time. | **Missing feature** — requires a feedback UI (thumbs up/down, inline correction), a `feedback` table, and a prompt-injection path that incorporates recent feedback into similar future queries. |
| 15 | Observability and auditability | **Partially supported** | `AiExecutionMeta` (`ai-runtime.ts:104-117`) is built for every call in memory and returned to the caller. It is not persisted. No audit log table. No structured log file. `ARCH-314` — error messages are sanitized before client delivery, but raw driver errors can leak via `api.ts:33`. | No persistent record of AI calls, token usage, or decision paths. `AiExecutionMeta` is ephemeral. A post-mortem on an AI failure has no server-side trace to consult. | **Missing feature** — requires a `ai_execution_log` table (or append-only log file) that captures `AiExecutionMeta` fields plus the prompt (without keys). Error sanitization must be audited for all code paths. |

---

## Gap Classification Summary

| Gap Type | Count | Categories |
|---|---|---|
| **Missing feature** | 9 | §1, §4, §5, §6, §7, §8, §9, §14, §15 |
| **Architectural limitation** | 1 | §3 (dynamic skill loading) |
| **Data-model limitation** | 0 | — |
| **Infrastructure limitation** | 0 | — |
| **Security concern** | 0 | — (error-leak in `api.ts:33` is operational, not structural) |
| **Operational limitation** | 1 | §13 (persistent user context) |
| **Needs further investigation** | 2 | §10 (interactive AI outputs — depends on UI decision), §12 (cross-domain tool exposure — depends on tool registry design) |

---

## Architectural Readiness Score

| Tier | Categories | Readiness |
|---|---|---|
| **Tier 1 — Ready to wire** | §2 (modular tools) | Existing code paths are safe to expose with minimal changes. |
| **Tier 2 — Straightforward addition** | §4 (event publishing), §11 (rule evaluation tools), §12 (cross-domain tools), §15 (observability) | The underlying data and logic exist; the missing piece is the connection layer. |
| **Tier 3 — Moderate lift** | §1 (AI outside chat), §5 (background processing), §6 (persistent observations), §8 (durable workflows) | Requires new infrastructure (job queue, state table) plus integration with existing AI runtime. |
| **Tier 4 — Significant architectural work** | §3 (dynamic skill loading), §7 (behavioral tracking), §9 (AI-initiated), §10 (interactive outputs), §13 (persistent context), §14 (user feedback) | Requires new data model components, a significant frontend change (§10), or a new subsystem. |

---

## Evidence Register

| ID | Source | Status |
|----|--------|--------|
| ARCH-700 | `apps/web/src/server/ai-contracts.ts:36-51` (feature policies) | VERIFIED |
| ARCH-701 | `apps/web/src/server/ai-runtime.ts:136-147` (non-streaming `generateText`) | VERIFIED |
| ARCH-702 | `apps/web/src/server/ai-import.ts:69-72` (import system prompt, bounded rows) | VERIFIED |
| ARCH-703 | `apps/web/src/server/ai.ts:93-249` (tool factory — 4 tools, 4 dormant capabilities) | VERIFIED |
| ARCH-704 | `apps/web/src/server/ai-capabilities.ts:179,211,247,277` (dormant capability functions) | VERIFIED |
| ARCH-705 | `apps/web/src/server/ai-prompts.ts:1-61` (static prompt builders) | VERIFIED |
| ARCH-706 | Grep `EventEmitter\|addListener\|dispatch` across `apps/web/src/`, `packages/*/src/`, `scripts/` — zero matches | VERIFIED |
| ARCH-707 | `apps/web/src/components/charts/tokens.ts:50` (design-token pub/sub, not domain bus) | VERIFIED |
| ARCH-708 | `apps/web/src/server/market-data/transport.ts:39` (`setTimeout` rate-limit queue) | VERIFIED |
| ARCH-709 | Grep `cron\|worker_threads\|pg-boss\|bullmq\|setInterval` — ARCH-207 | VERIFIED |
| ARCH-710 | `apps/web/src/db/schema.ts` — no `observations`, `ai_memory`, `session_history` table | VERIFIED |
| ARCH-711 | `apps/web/src/db/schema.ts:173-189` (notes table — human notes only) | VERIFIED |
| ARCH-712 | `apps/web/src/server/ai-runtime.ts:104-117` (`AiExecutionMeta` ephemeral, not persisted) | VERIFIED |
| ARCH-713 | `apps/web/src/server/ai-scope.ts:47-49` (FrozenApprovedScope — stateless per request) | VERIFIED |
| ARCH-714 | `packages/core/src/adherence.ts` (`analyzeAdherence` read-only) | VERIFIED |
| ARCH-715 | `apps/web/src/app/api/trades/[key]/rules/route.ts` (write path for `trade_rule_checks`) | VERIFIED |
| ARCH-716 | `apps/web/src/server/ai-report-context.ts` (reportContext — only accessible via `switch_report_mode`) | VERIFIED |
| ARCH-717 | `apps/web/src/server/settings.ts` (settings table — preferences only, no AI memory) | VERIFIED |
| ARCH-718 | `apps/web/src/server/api.ts:33` (error sanitization — raw driver errors can leak) | VERIFIED |
| ARCH-719 | `apps/web/src/lib/use-ai-request.ts:9-28` (`active` ref stale-response protection) | VERIFIED |
| ARCH-720 | `apps/web/src/app/api/ai/ask/route.ts:1-17` (user-initiated only) | VERIFIED |
| ARCH-721 | `apps/web/src/app/api/ai/recap/route.ts:1-30` (user-initiated recap) | VERIFIED |
| ARCH-722 | `apps/web/src/server/ctrader-mcp/client.ts:21-31` (broker sync — outbound call, not AI-initiated) | VERIFIED |
| ARCH-723 | `apps/web/src/app/api/ai/critique/route.ts:1-15` (single-trade critique — user-initiated) | VERIFIED |
| ARCH-724 | Grep `streamText` across `apps/web/src/server/` — zero matches | VERIFIED |
| ARCH-725 | `apps/web/src/server/ai-contracts.ts:53-57` (AI_PROMPT_VERSIONS — static) | VERIFIED |
| ARCH-726 | `apps/web/src/db/index.ts:81-135` (db singleton — no background worker, process-bound) | VERIFIED |
| ARCH-727 | `apps/web/src/server/ai.ts:252-280` (`runAi` — reflection feature, stateless) | VERIFIED |
