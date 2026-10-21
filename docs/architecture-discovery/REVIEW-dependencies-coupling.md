# Dependencies & Coupling Report — Review

**Reviewer:** DependenciesCouplingAudit
**Date:** 2026-10-21
**Report reviewed:** `docs/architecture-discovery/09-dependencies-and-coupling.md`

---

## Overall Verdict

**FAIL** — multiple materially incorrect claims, stale line citations, an incomplete dependency graph, a wrong test-file path, and a missing defect. The report's monorepo-boundary section is reliable; its AI layering, capability-attribution, tool-coupling, and Tauri sections are not.

---

## Findings Table

| ID | Claim (report) | Report states | Actual source | Status | Notes |
|----|----------------|---------------|---------------|--------|-------|
| ARCH-600 | `packages/core` has no dependencies | `package.json` has no `dependencies` field | Confirmed | **PASS** | Grep returned zero matches |
| ARCH-600 | `packages/importers` has no external deps | Only `@luxalgo/journal-core: workspace:*` | Confirmed | **PASS** | All core imports are `import type` |
| ARCH-600 | Importer → core imports are type-only | `import type { ... }` throughout | Confirmed | **PASS** | `ibkr.ts:4`, `pepperstone.ts:12`, `position-fills.ts:1`, `types.ts:1` |
| ARCH-600 | No cross-boundary imports from core | Grep returned `exit=1` | Confirmed | **PASS** | No `from 'apps/web'` or `from '@luxalgo/journal-importers'` in `packages/core/src/` |
| ARCH-600 | No HTTP in importers | Grep returned `exit=1` | Confirmed | **PASS** | No `fetch(` / `axios` / `http.` in `packages/importers/src/` |
| ARCH-601 | `packages/core/src/round-trips.ts:95-99` defines trade key | Lines cited as `:95-99` | `:98-101` | **MINOR** | Off by 3 lines; key construction confirmed |
| ARCH-601 | Trade key format: `accountId\|symbol\|direction\|openedAt` | Correct | Confirmed | **PASS** | Verified at `:98-101` |
| ARCH-601 | Key collision suffix is `\|N` | Correct | Confirmed | **PASS** | `collision === 0 ? baseKey : `${baseKey}\|${collision}`` |
| ARCH-601 | Annotation excluded from rebuild upsert | Confirmed | Confirmed | **PASS** | `notes`, `tagsJson`, `mistakesJson`, `playbookId`, `rating`, `stopLoss`, `profitTarget`, `reviewedAt` omitted from `onConflictDoUpdate` |
| ARCH-602 | `tradeRuleChecks.id` is `JSON.stringify([key, book.id, b.rule])` | Confirmed | Confirmed | **PASS** | `rules/route.ts:40`; renamed rules leave orphaned rows |
| ARCH-602 | Only `trade_excursions.tradeKey` has ON DELETE CASCADE | Correct | Correct | **PASS** | Other cascades at `schema.ts:16,27,32,44`; `trade_excursions` confirmed as sole cascade FK to `trades` |
| ARCH-603 | `apps/web/src/app/api/trades/[key]/rules/route.ts:21` writes tradeRuleChecks | Confirmed | `:44` writes `tradeKey` | **MINOR** | Line 21 is a brace; write is at line 44 |
| ARCH-603 | Trade-key consumers listed | Rule-checklist, trade-navigation, stats, reports, ask-ai | Partially confirmed | **MINOR** | See § Coverage below |
| ARCH-604 | AI layering: Prompts → Scope → Capabilities → Runtime → Tools → Routes | Correct high-level layering | Confirmed | **PASS** | |
| ARCH-604 | Longest dependency path in server/ | "ai-capabilities → trades-query → ai-scope (4 hops)" | `ai → ai-report-context → ai-scope → settings → crypto` (5 hops) | **WRONG** | DFS over 25 server files: zero cycles; longest path is `ai → ai-report-context → ai-scope → settings → crypto` (5 edges) |
| ARCH-604 | "ai-capabilities → trades-query → ai-scope" path | Correct | That path is only 3 edges; also `ai-scope → trades-query` does not exist | **WRONG** | `ai-capabilities` imports `trades-query` and `ai-scope`; `ai-scope` does NOT import `trades-query` |
| ARCH-604 | `ai-scope.ts` imports `ai-capabilities.ts` | Correct | `ai-scope.ts` imports `ai-capabilities.ts` | **WRONG** | `ai-scope.ts` imports `api.ts`, `settings.ts`, `@/lib/filter-description`; `ai-capabilities.ts` imports `ai-scope.ts` (reverse direction) |
| ARCH-604 | `ai-runtime.ts` imports `ai-capabilities.ts` | Correct | `ai-runtime.ts` only imports `ai-contracts.ts` and a type from `@/lib/ai-settings` | **WRONG** | Verified by DFS: `ai-runtime` → `ai-contracts` only |
| ARCH-604 | `ai-runtime.ts` exports `runReportsAgentAiRuntime` | Correct | Export is `runReportsAgentAi`; `runReportsAgentAiRuntime` is an import alias in `ai.ts` | **WRONG** | Export name in `ai-runtime.ts` is `runReportsAgentAi` |
| ARCH-605 | `ai-capabilities.ts` defines 8 capability functions | Correct | `ai-capabilities.ts` exports 7 functions; `reportContext` is in `ai-report-context.ts` | **WRONG** | 8 total capabilities across two files, not 8 in one file |
| ARCH-605 | `askJournalContext` at `ai-capabilities.ts:36` | Correct | `:40` | **STALE** | Off by 4 lines |
| ARCH-605 | `dailyRecapContext` at `ai-capabilities.ts:94` | Correct | `:67` | **STALE** | Off by 27 lines |
| ARCH-605 | `tradeCritiqueContext` at `ai-capabilities.ts:150` | Correct | `:119` | **STALE** | Off by 31 lines |
| ARCH-605 | `playbookRulesForTrade` at `ai-capabilities.ts:179` | Correct | `:179` | **PASS** | |
| ARCH-605 | `missedObservations` at `ai-capabilities.ts:211` | Correct | `:211` | **PASS** | |
| ARCH-605 | `notebookEntries` at `ai-capabilities.ts:247` | Correct | `:247` | **PASS** | |
| ARCH-605 | `progressHistory` at `ai-capabilities.ts:277` | Correct | `:277` | **PASS** | |
| ARCH-605 | All 4 unregistered capabilities enforce `scope.dataSource` | Correct | Confirmed | **PASS** | `playbookRulesForTrade`, `missedObservations`, `notebookEntries`, `progressHistory` all validate scope |
| ARCH-605 | `reportContext` defined in `ai-capabilities.ts` | Correct | `ai-report-context.ts:166` | **WRONG** | Different file; `reportContext` calls `queryTrades` |
| ARCH-606 | `ai-contracts.ts:36-51` contains `AI_FEATURE_POLICIES` | Correct | `:41-58` | **STALE** | Off by 5–7 lines |
| ARCH-606 | `maxToolCalls` at `ai-contracts.ts:42-43` | Correct | Later in each policy object | **STALE** | Values are not at those exact lines |
| ARCH-606 | Provider creation at 4 sites | Correct | 4 sites confirmed at lines 135–136, 186–187, 249–250, 289–290 | **PASS** | |
| ARCH-606 | Provider fallback logic | Correct | `getAiProvider()` falls back to `openai` if `ANTHROPIC_API_KEY` absent | **PASS** | `settings.ts:85-89` |
| ARCH-606 | AI tool budget: `{ error: "AI tool limit reached." }` | Correct | `ai.ts:35` | **PASS** | |
| ARCH-606 | Runtime error: "AI could not extract…" | Correct | `ai-runtime.ts:209, 272` | **PASS** | |
| ARCH-606 | Runtime error messages absent from `ai-runtime.ts` | Correct | `"Tool use limit reached"` and `"Empty response"` do not exist in `ai-runtime.ts`; `ai.ts:35` is the tool-limit error | **PASS** | |
| ARCH-606 | `cache: "no-store"` on all fetches | Correct | Not confirmed; only some paths use it | **UNCONFIRMED** | Report may be accurate for specific fetches; general claim unverified |
| ARCH-607 | `switch_report_mode` → `reportContext` | Correct | Confirmed at `ai.ts:233` | **PASS** | |
| ARCH-607 | `GET /api/stats` → `reportContext` | Correct | `stats/route.ts` calls `queryTrades` directly; does NOT use `reportContext` | **WRONG** | Report's own "same as" characterization contradicts this |
| ARCH-607 | `get_trade_detail` → `getTradeByKey` + `listExecutions` | Correct | `ai.ts:180` uses `queryTrades(scope.filters, scope.timeZone).trades.find(...)`, not `getTradeByKey`; then `listExecutions` | **WRONG** | Route uses `getTradeByKey`; AI tool uses `queryTrades` — "No divergence exists" is false |
| ARCH-607 | `get_journal_summary` → `askJournalContext` → `queryTrades` | Correct | `ai.ts` returns a pre-built `{ context }`; `askJournalContext` is called by routes, not by this tool | **WRONG** | Tool returns a context object; does not call the capability function |
| ARCH-607 | AI import graph is incomplete | — | `ai.ts` also imports `ai-contracts.ts`, `ai-prompts.ts`, `ai-report-context.ts`, `trades-query.ts`, `settings.ts`, `@/lib/ai-settings` | **CONFIRMED** | Report understates the import graph |
| ARCH-608 | `positionFillProblem` is a "projection function" | Correct characterization | `position-fills.ts:41` — validates a single `ImportedExecution` and returns a string or null | **SEMANTIC** | Not a projection; a validation predicate |
| ARCH-608 | `positionGroup` is deterministic | Correct | `positionGroup` uses `JSON.stringify` on `[contract, positionId, direction]` | **PASS** | |
| ARCH-609 | Schema comment at `schema.ts:136` | Correct | Comment at `:108-112`; `:136` is `notes` column | **STALE** | |
| ARCH-609 | Rebuild computed object omits `assetClass` | Correct | Object includes `assetClass: trip.assetClass ?? null` | **CONFIRMED** | Report omitted it from the quote; source has it |
| ARCH-609 | `rebuild.ts:49-68` computed fields | Correct | Confirmed | **PASS** | |
| ARCH-609 | `onConflictDoUpdate` at `rebuild.ts:75` | Correct | Confirmed | **PASS** | |
| ARCH-610 | `apps/web` depends on `@luxalgo/journal-core`, `@luxalgo/journal-importers`, `@luxalgo/broker-sdk` | Correct | Confirmed | **PASS** | |
| ARCH-610 | Package names: `@luxalgo/journal-core`, `@luxalgo/journal-importers` | Correct | Confirmed | **PASS** | |
| ARCH-610 | `broker-sdk` runtime import at `apps/web/src/server/sync.ts` | Correct | `sync.ts:1` | **PASS** | |
| ARCH-611 | `apps/web/tests/import-formats-regression.test.ts` exists | Correct | Confirmed | **PASS** | |
| ARCH-611 | Regression test at `packages/importers/src/formats/` | Correct | That path does not exist; real file is `apps/web/tests/import-formats-regression.test.ts` | **WRONG** | Critical path error; the report's ARCH-613 test location is wrong |
| ARCH-611 | Regression test: `executions.length > 0` and `price > 0` | Correct | Those specific assertions are not in the actual test | **WRONG** | Actual test exercises preview/import API, duplicate detection, legacy-note preservation |
| ARCH-611 | Regression test uses fixture files and `parsed.executions` | Correct | Test uses synthetic inline CSV; calls `/api/import` route with a real temp `JOURNAL_DATA_DIR` | **WRONG** | Integration test via HTTP, not a disposable offline parser diagnostic |
| ARCH-612 | `.omp/hooks/pre/protect-trade-key.ts` is a git pre-commit hook | Correct | Hook exists at that path | **CONFIRMED** | |
| ARCH-612 | Hook checks for corresponding ADR file | Correct | Hook checks for any ADR file matching `/^0\d{3}-.*\.md$/` | **PASS** | |
| ARCH-612 | `NEXT_TELEMETRY_DISABLED=1` absent from root `Dockerfile` | Correct | Not present | **PASS** | |
| ARCH-612 | `generateText` only in `ai-runtime.ts` | Correct | Confirmed | **PASS** | |
| ARCH-612 | `apps/web/tests/` has no vitest config | Correct | `apps/web/vitest.config.ts` does not exist | **PASS** | |
| ARCH-613 | Tauri sidecar spawn via `app.shell().sidecar("node")` | Correct | `server.rs:55-64` | **PASS** | |
| ARCH-613 | `server.rs:60` port regex `127\.0\.0\.1:(\d+)` | Correct | `server.rs:72` | **MINOR** | Off by 12 lines |
| ARCH-613 | `HOSTNAME` is never set in spawn environment | Correct | Confirmed | **PASS** | Diagram incorrectly lists it as passed |
| ARCH-613 | `get_status` returns `"starting"` indefinitely on regex miss | Correct | `server.rs:113-120` | **PASS** | |
| ARCH-613 | `lib.rs` navigates main window to emitted URL on `server-ready` | Correct | `lib.rs` | **PASS** | |
| ARCH-613 | Tauri diagram environment includes `HOSTNAME` | Correct | `HOSTNAME` is NOT in the actual spawn environment | **WRONG** | Diagram contradicts the text it supports |
| ARCH-614 | `PORT=0` selects ephemeral port in Tauri context | Correct | Generated `server.js` uses `parseInt(process.env.PORT, 10) || 3000`; `"0"` falls back to fixed `3000` | **CONFIRMED** | Not a Tauri behavior defect; a standalone-server startup defect |
| ARCH-614 | `PORT=0` defect missing from report | — | Report omits this defect entirely | **MISSING** | Should be ARCH-614 or equivalent |
| ARCH-615 | `ai-scope.ts` validates `dataSource` values | Correct | `trades`, `trades+playbooks`, `trades+missed`, `trades+notes`, `trades+progress`; default `trades` | **PASS** | |
| ARCH-615 | `ai.ts` inline prompts at `ai-import.ts:75` | Correct | Actual line is `:69` | **STALE** | |

---

## §9 Spec Coverage

| Spec requirement | Status | Notes |
|-----------------|--------|-------|
| **Strong architectural boundaries** | ✅ Confirmed | Monorepo boundary greps all pass; no cross-boundary imports |
| **Tight coupling documented** | ⚠️ Partially | Boundary coupling correct; AI tool coupling has multiple errors |
| **Extension points identified** | ⚠️ Partially | 4 unregistered capabilities confirmed; location/count inaccurate |
| **Dependency diagrams** | ❌ Wrong | Longest-path graph incorrect; import edges misstated |
| **Coupling table** | ⚠️ Minor inaccuracies | Some stale line numbers; one wrong capability-file attribution |

---

## Required Fixes (ordered)

1. **Fix ARCH-604 longest-path claim.** The path `ai-capabilities → trades-query → ai-scope` is wrong; `ai-scope` does not import `trades-query`. Correct longest path is `ai → ai-report-context → ai-scope → settings → crypto` (5 edges). `ai-capabilities` → `trades-query` and `ai-capabilities` → `ai-scope` are separate 2-hop leaves, not a chain.

2. **Fix ARCH-604 `ai-runtime` import claim.** `ai-runtime.ts` imports `ai-contracts.ts`, not `ai-capabilities.ts`. The DFS over 25 server `.ts` files confirms zero circular imports and this edge.

3. **Fix ARCH-605 capability-file attribution.** `reportContext` is in `ai-report-context.ts`, not `ai-capabilities.ts`. There are 8 capabilities across 2 files: 7 in `ai-capabilities.ts`, 1 in `ai-report-context.ts`.

4. **Fix ARCH-605 line citations** for `askJournalContext` (→ `:40`), `dailyRecapContext` (→ `:67`), `tradeCritiqueContext` (→ `:119`).

5. **Fix ARCH-607 `get_trade_detail` claim.** It uses `queryTrades().trades.find(...)`, not `getTradeByKey`. This is a real divergence from the route handler. The "No divergence exists" claim is false.

6. **Fix ARCH-607 `get_journal_summary` claim.** The tool returns a pre-built `{ context }` value; it does not call `askJournalContext`. `askJournalContext` is called by route handlers (`ask/route.ts:12`, `reports/route.ts:12`).

7. **Fix ARCH-607 `switch_report_mode` / `GET /api/stats` claim.** `stats/route.ts` does not call `reportContext`. The "Same as" characterization is incorrect.

8. **Fix ARCH-611 regression-test path.** The test is at `apps/web/tests/import-formats-regression.test.ts`, not `packages/importers/src/formats/`. The test is an integration test through the HTTP API with a real SQLite DB and temp data dir, not a fixture-only offline parser diagnostic. Assertions cover preview/insert/dedup, not `parsed.executions.length > 0`.

9. **Fix ARCH-613 Tauri environment diagram.** Remove `HOSTNAME` from the diagram's environment-variable list; it is not passed to the sidecar process.

10. **Add ARCH-614 standalone-server `PORT=0` defect.** Generated `server.js` uses `parseInt(process.env.PORT, 10) || 3000`. `PORT="0"` yields `3000` (fixed), not an ephemeral port. The Tauri regex mismatch (hostname `localhost` vs expected `127.0.0.1`) compounds this: even if the sidecar selected an ephemeral port, the regex would miss it. The proposed `.env("HOSTNAME", "127.0.0.1")` fix addresses the regex but not the fixed-port fallback.

11. **Fix ARCH-606 `AI_FEATURE_POLICIES` line range** (→ `:41-58`) and acknowledge `maxToolCalls` values are not at `:42-43`.

12. **Fix ARCH-601 line citation** (→ `:98-101`) and **ARCH-609 schema comment** (→ `:108-112`).

---

## Recommended Additional Evidence

- **Circular import check:** DFS over all 25 `apps/web/src/server/*.ts` files confirms zero cycles. Report could cite this as positive evidence.
- **Provider fallback behavior:** `settings.ts:85-89` shows `openai` is selected when `ANTHROPIC_API_KEY` is absent, even if `OPENAI_API_KEY` is present — worth documenting as a coupling point.
- **5 importer callers** of `detectFormat`/`parseStatement`: `import/route.ts`, `ai-import.ts`, `ctrader-mcp/deals.ts`, `ctrader-mcp/sync.ts`, `ninjatrader-import.ts`. Report could enumerate these as a coupling table entry.
- **`positionFillProblem` semantics:** It is a validation predicate (returns `null` on success, `string` on failure), not a projection. This distinction matters for understanding the importer's validation contract.
- **`ai.ts` import graph:** Add `ai-contracts.ts`, `ai-prompts.ts`, `ai-report-context.ts`, `trades-query.ts`, `settings.ts`, `@/lib/ai-settings` to the AI tool import diagram.
- **Regression test inventory:** `packages/importers/tests/` contains 5 test files the report does not mention. These represent a non-trivial offline test surface worth documenting.
