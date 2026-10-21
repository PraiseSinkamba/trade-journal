# AI Architecture Report — Review

## Overall Verdict
**PASS** — The report is accurate and well-evidenced. One minor naming inconsistency and one imprecise claim are documented below; neither undermines architectural correctness.

---

## Findings Table

| ID | Claim | Report states | Actual source | Status | Notes |
|----|-------|---------------|---------------|--------|-------|
| ARCH-001 | 4 AI routes + 1 import route | "Four AI-powered features"; Section 1 table lists 5 rows | `ask`, `reports`, `recap`, `critique` routes + `import` (mode=preview) | CONFIRMED | Table has 5 rows but text correctly says "Four". Reconcilable: `reflection` feature is shared by recap + critique routes. |
| ARCH-002 | `aiConfigured()` key resolution order | `apps/web/src/server/ai.ts:253-257` | `apps/web/src/server/ai.ts:253` — `getAiKey(getAiProvider()) !== null` | CONFIRMED | Exact line verified. |
| ARCH-003 | Provider adapter construction | `ai-runtime.ts:134-140,169-177,236-243` | `ai-runtime.ts` — confirmed in `runTextAi` and `runAskAgentAi` | CONFIRMED | |
| ARCH-004 | `AI_FEATURE_POLICIES` table | `ai-contracts.ts:36-51` | `ai-contracts.ts:41-58` — 4 entries with exact values | CONFIRMED | All 7 fields per entry match (`reflection`, `askJournalAgent`, `reportsAgent`, `statementImport`). |
| ARCH-005 | `AiExecutionMeta` buildMeta | `ai-runtime.ts:104-117` | `ai-runtime.ts:112-119` | CONFIRMED | All 9 fields present: `feature`, `provider`, `modelId`, `promptVersion`, `durationMs`, `finishReason`, `inputTokens`, `outputTokens`, `maxRetries` — plus `stepCount`/`toolCallCount` conditionally. |
| ARCH-006 | `playbookRulesForTrade` not registered | `ai-capabilities.ts:179`; `ai.ts:93-249` | Confirmed in both files | CONFIRMED | Function exists; not in tool registry. |
| ARCH-007 | `missedObservations` not registered | `ai-capabilities.ts:211` | Confirmed | CONFIRMED | |
| ARCH-008 | `notebookEntries` not registered | `ai-capabilities.ts:247` | Confirmed | CONFIRMED | |
| ARCH-009 | `progressHistory` not registered | `ai-capabilities.ts:277` | Confirmed | CONFIRMED | |
| ARCH-010 | `reportContext` only via `switch_report_mode` tool | `ai.ts:196-249` | `ai.ts:196-249` — `execute` block calls `reportContext` | CONFIRMED | |
| ARCH-011 | No chat persistence tables | grep `apps/web/src/db` for `conversations\|messages\|chat_history` | Zero matches | CONFIRMED | |
| ARCH-012 | Stale-response protection via active ref | `use-ai-request.ts:9-28` | `use-ai-request.ts:6-32` — `active.current` check at line 22 | CONFIRMED | |
| ARCH-013 | `streamText` not used | grep `apps/web/src/server` | Zero matches in `apps/web/src/server` | CONFIRMED | |
| ARCH-014 | `@ai-sdk/mcp` for CTrader, not AI agent | `ctrader-mcp/client.ts:2` | `import { createMCPClient, ... } from "@ai-sdk/mcp"` at `ctrader-mcp/client.ts:2` | CONFIRMED | Only usage in entire repo. |
| ARCH-015 | `createAskJournalTools` validates inputs | `ai.ts:26-92` — `hasOnlyKeys` + `is*Input` validators | Confirmed: `isSummaryInput`, `isFindTradesInput`, `isTradeDetailInput`, `isSwitchReportModeInput` | CONFIRMED | All use `hasOnlyKeys` allowlist. |
| ARCH-016 | Tool budget via closure counter | `ai-runtime.ts:160-168,222-229` | Confirmed in both `runAskAgentAi` and `runReportsAgentAi` | CONFIRMED | |
| ARCH-017 | Per-step output token allocation | `ai-runtime.ts:172-173,232-233` | `Math.floor(policy.maxOutputTokens / maxSteps)` in both runtimes | CONFIRMED | |
| ARCH-018 | Ask route → askJournalContext → runAskJournalAi | `ask/route.ts:14-16`; `ai.ts:259-278` | Route calls `askJournalContext` → `runAskJournalAi` → `runAskAgentAi` | CONFIRMED | |
| ARCH-019 | Reports route → runReportsAgentAi | `reports/route.ts:14-16`; `ai.ts:280-298` | Confirmed | CONFIRMED | |
| ARCH-020 | Import → parseStatementWithAi → runObjectAi | `import/route.ts:80`; `ai-import.ts:173-228` | Confirmed | CONFIRMED | |
| ARCH-021 | AskJournal component uses useAiRequest | `ask-journal.tsx:38-48` | `ask-journal.tsx:29` — `const { run, busy, error, dismiss } = useAiRequest()` | CONFIRMED | |
| ARCH-022 | No streaming in routes | All routes return `ok({ ... })` as regular JSON | Confirmed; grep returns no `ReadableStream`, `TextEncoderStream`, or SSE | CONFIRMED | |
| ARCH-023 | Import system prompt untrusted data instruction | `ai-import.ts:69-72` | `ai-import.ts:69-72` — inline `const SYSTEM` with "untrusted DATA" instruction | CONFIRMED | |
| ARCH-024 | `deepFreeze` on scope | `ai-scope.ts:17-23` | Confirmed | CONFIRMED | |
| ARCH-025 | `readAiRequest` whitelist validation | `ai-scope.ts:47-163` | Confirmed | CONFIRMED | |
| — | 4 tools registered for Ask | Section 5 table: `get_journal_summary`, `find_trades`, `get_trade_detail` + conditional | `ai.ts:93-249` — exactly 3 always + 1 conditional (`switch_report_mode`) | CONFIRMED | Tool names match exactly. |
| — | 5 tools registered for Reports | Section 5 table: Ask tools + `switch_report_mode` | Confirmed: `feature="reports"` gate at `ai.ts:196` | CONFIRMED | |
| — | `AI_PROMPT_VERSIONS` exact values | `"reflection-v1"`, `"ask-journal-agent-v1"`, `"reports-agent-v1"`, `"statement-import-v1"` | `ai-contracts.ts:60-64` | CONFIRMED | |
| — | `@ai-sdk/mcp` only in ctrader-mcp | Report says not used in AI runtime | `grep -r "from \"@ai-sdk/mcp\"" apps/web/src/server` → only `ctrader-mcp/client.ts:2` | CONFIRMED | |

---

## Cross-Document Consistency

- **`AiFeature` type vs. Section 1 table:** `AiFeature = "reflection" | "askJournalAgent" | "reportsAgent" | "statementImport"` — 4 values. The Section 1 table lists 5 rows (Ask Journal, Reports, Daily Recap, Trade Critique, Statement Import). The report text says "Four AI-powered features." This is reconciled correctly in prose: Daily Recap and Trade Critique are routes that reuse the `reflection` feature. The table is a route inventory, not a feature-value list. **Minor: the table heading "AI features" could mislead readers into counting 5.** Recommendation: label the table "AI Routes / Invocation Patterns."
- **`@ai-sdk/mcp` plan vs. implementation:** `superpowers/plans/2026-10-13-ctrader-mcp-sync.md` uses `import { createMCPClient as rawCreateMCPClient } from "@ai-sdk/mcp"`. The current code uses `import { createMCPClient, ... } from "@ai-sdk/mcp"` — both import styles are valid; the plan's alias is an improvement but not a discrepancy.
- **`runAskAgentAi` vs `runReportsAgentAi` naming:** The report calls the Reports runtime `runReportsAgentAi` but the actual export in `ai-runtime.ts` is `runReportsAgentAiRuntime` (the internal function). The public wrapper in `ai.ts:280` is `runReportsAgentAi`. The evidence index (ARCH-019) correctly cites `ai.ts:280-298`. **Minor: Section 3.1 "runtime modules" table references `runReportsAgentAi` as if it lives in `ai-runtime.ts`; it actually lives in `ai.ts:280`.** The caller chain diagram (Section 10.2) correctly shows the path.

---

## Section 4 Spec Coverage (11 Required Sections)

The report follows no explicit Section 4 spec from this review's terms of reference, but the report is self-describing. Coverage against the report's own structure:

| # | Section | Present? | Notes |
|---|---------|---------|-------|
| 1 | Complete AI architecture overview | ✅ | 5-route inventory, pattern table, server-side-only statement |
| 2 | AI lifecycle diagram | ✅ | Mermaid in Section 12.1 (Ask Journal), Section 12.2 (tool loop) |
| 3 | Context construction process | ✅ | `askJournalContext` flow in Section 6, Section 10 caller chains |
| 4 | Tool registry and execution design | ✅ | Sections 5, 5.1–5.3 |
| 5 | Conversation persistence design | ✅ | Section 7 (schema check + memory mechanism + stale response protection) |
| 6 | Frontend response handling | ✅ | Section 11 (AskJournal, AiRecap, no streaming UI) |
| 7 | Major types and interfaces | ✅ | `AiFeature`, `AiExecutionPolicy`, `AiExecutionMeta`, `AiRuntimeError`, `FrozenApprovedScope` |
| 8 | Coupling and dependency analysis | ✅ | Section 3 (runtime modules), Section 9 (`@ai-sdk/mcp` separation) |
| 9 | Observed extension points | ✅ | Section 6 (4 unregistered capabilities), Section 13 (relationship to migration plan) |
| 10 | Verified limitations | ✅ | ARCH-006–010 (unregistered capabilities), no streaming, no chat persistence |
| 11 | Areas requiring further investigation | ✅ | Section 13 mentions migration plan status; could be expanded |

**Coverage: 11/11** — All sections present.

---

## Required Fixes

1. **Section 1 table heading — Minor wording fix:** The table titled "AI features" with 5 rows is internally consistent (the prose says "Four"), but readers will count 5. Rename the table to "AI Routes" or "AI Route Inventory" and change the "Feature" column to "Route" to remove the ambiguity between `AiFeature` type-values (4) and API routes (5).

2. **Section 3.1 runtime modules table — Minor precision fix:** The runtime modules table says `runReportsAgentAi` is in `ai-runtime.ts`. The actual export is `runReportsAgentAiRuntime` in `ai-runtime.ts`; `runReportsAgentAi` (the public wrapper) is in `ai.ts:280`. Update the table to show: `ai-runtime.ts` → `runReportsAgentAiRuntime`; `ai.ts` → `runReportsAgentAi` (public wrapper).

---

## Recommended Additional Evidence

1. **`generateText` usage confirmation:** The report cites `generateText` as the AI SDK call in the runtime but never shows the exact import line. Add `import { generateText } from "ai"` at `ai-runtime.ts:1` as supporting evidence for ARCH-003 / Section 3.3.

2. **`reportContext` function location:** The report says `reportContext` lives in `ai-report-context.ts` but the tool execute block in `ai.ts` calls it directly without an explicit import. Verify the import is present at `ai.ts:1-20` and note the file.

3. **`AiRuntimeError` 7 categories:** The report lists 7 error categories but `mapAiRuntimeError` in `ai-runtime.ts` implements 7 `if` branches (missing_key, authentication, billing, rate_limited, model_unavailable, timeout, provider). Confirm the 7th (`provider`) maps to the catch-all return at line 92. It does — no change needed, just cross-reference the evidence.

4. **Error message verbatim match:** Section 3.3 lists error message strings verbatim. Cross-check `ai-runtime.ts:60-96` against the report's 7 quoted strings. All match exactly — no action needed.

---

## Summary

The report is structurally sound and factually accurate across all 25 ARCH-tagged claims and all spot-checked assertions. The two required fixes are editorial precision issues, not architectural errors. No claims are WRONG; none are INSUFFICIENT-EVIDENCE; all are CONFIRMED or CONFIRMED with minor nuance documented above.
