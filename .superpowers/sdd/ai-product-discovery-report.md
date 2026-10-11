# AI Product Discovery Report

**Date:** 2026-10-11
**Scope:** All non-API pages, all server modules under `apps/web/src/server/`, AI subsystem
**Basis:** Code read-only; no source changes; no invented features.

---

## 1. Page Inventory

Sidebar navigation is defined in `apps/web/src/components/shell.tsx:35-51` as two `const` arrays: `NAV` (10 items) and `NAV_SETUP` (3 items). Every non-login page is a Client Component wrapped in `<Shell>` with `FilterBar` and `useFilters()`. Data fetching uses `useApi` / `postJson` pointing to `/app/api/**/route.ts`.

### Dashboard
- **Route:** `/` (`apps/web/src/app/page.tsx`)
- **Components:** `FilterBar`, `AddTradeDialog`, `CurrencyNotice`, `CalendarPnl`, `DashboardLayout` (widget grid: Net P&L, Win %, Profit Factor, EdgeRadar, Gauge, DailyBars, EquityArea, RelativeDrawdownBars, TimeHeatmap), open positions, recent trades
- **Data sources:** `GET /api/stats?query`
- **AI involvement:** None
- **User workflow:** Configurable widget grid; account/range filter drives all widgets

### Calendar
- **Route:** `/calendar` (`apps/web/src/app/calendar/page.tsx`)
- **Components:** `CalendarPnl` heatmap, `CalendarPerformance` insights
- **Data sources:** `GET /api/calendar?query&calYear&calMonth`
- **AI involvement:** None
- **User workflow:** Month grid of daily P&L; performance tab shows streaks, best/worst days

### Daily journal
- **Route:** `/journal` (`apps/web/src/app/journal/page.tsx`) — list
- **Route:** `/journal/[date]` (`apps/web/src/app/journal/[date]/page.tsx`) — day detail
- **Components (list):** Paginated day list (50/page), links to `/journal/[date]`
- **Components (detail):** Day stats card, intraday `EquityArea`, trade list, `RichEditor` note (autosave `PUT /api/journal/[date]`), `VoiceNote`, `ReviewExport`, `Attachments`
- **Data sources:** `GET /api/journal?query` (list); `GET /api/journal/[date]?query` (detail)
- **AI involvement:** `AiRecap` posts to `POST /api/ai/recap` with `{date, filters, timeZone}`; output is appended as `## AI recap` to the day note (never replaces user content). Evidence: `apps/web/src/app/journal/[date]/page.tsx`
- **User workflow:** Browse days → open a day → optionally trigger AI recap → note is human-authored before AI appends

### Trades
- **Route:** `/trades` (`apps/web/src/app/trades/page.tsx`) — list
- **Route:** `/trades/[key]` (`apps/web/src/app/trades/[key]/page.tsx`) — trade detail
- **Components (list):** TanStack table, column visibility, sorting, bulk actions (`/api/trades/bulk`: review/unreview/tag/delete), CSV export (`/api/export`)
- **Components (detail):** `TradeNavigation` (`/api/trades/[key]/navigation`), `TradeMarketData` (`/api/trades/[key]/market-data`, `/api/market-data/connections`), `TradeRating`, `RichEditor` notes (autosave `PATCH`), `ReviewExport`, `Attachments`, `RuleChecklist` (`/api/trades/[key]/rules?playbook=...`)
- **Data sources:** `GET /api/trades?view=list&query` (list); `GET /api/trades/[key]` (detail)
- **AI involvement:** "AI review" card on trade detail posts to `POST /api/ai/critique` with `{key}`; renders critique prose + `AiNotice` on error. Evidence: `apps/web/src/app/trades/[key]/page.tsx`
- **User workflow:** Browse trades → open a trade → optionally trigger AI critique; AI reviews are additive, never auto-saved

### Reports
- **Route:** `/reports` (`apps/web/src/app/reports/page.tsx`)
- **Components:** Mode tabs — `ReportOverview` (`/api/stats`), `PerformanceTrendsReport` (`/api/performance-trends`), `TradeExplorer` (`/api/trade-explorer`), `Breakdown` (`/api/analysis?primary=&secondary=`), `Comparison` (two `AnalysisFilter` + two `/api/analysis` calls)
- **Data sources:** `GET /api/stats`, `GET /api/performance-trends`, `GET /api/trade-explorer`, `GET /api/analysis`
- **AI involvement:** `AskJournal` component pinned at top of page posts to `POST /api/ai/ask` with `{question, filters, timeZone}`. Evidence: `apps/web/src/app/reports/page.tsx`
- **User workflow:** Select report mode → apply filters → optionally ask a natural-language question about the filtered journal data

### Prop firms
- **Route:** `/prop-firms` (`apps/web/src/app/prop-firms/page.tsx`)
- **Components:** `PropFirmTracker`, `PropFirmForms` (modal)
- **Data sources:** `GET /api/prop-firms`, `POST /api/prop-firms`, `POST /api/prop-firms/csv`
- **AI involvement:** None
- **User workflow:** Create/edit prop firm plans; track accounts and evaluations; upload CSV

### Notebook
- **Route:** `/notebook` (`apps/web/src/app/notebook/page.tsx`)
- **Components:** Three-pane workspace — folder tree, note list, `NoteEditor`, `RichEditor`, `VoiceNote`, `ReviewExport`, `Attachments`
- **Data sources:** `GET /api/notes?folder=&q=`, `GET /api/folders`, `POST /api/notes`, `DELETE /api/folders/[id]`, `PATCH /api/notes/[id]` (autosave)
- **AI involvement:** None
- **User workflow:** Organize free-form notes in folders; autosave on every edit

### Playbooks
- **Route:** `/playbooks` (`apps/web/src/app/playbooks/page.tsx`)
- **Components:** Card grid, per-playbook `AdherenceReport` (`/api/adherence?query`), modal create (`POST /api/playbooks`), delete (`DELETE /api/playbooks/[id]`)
- **Data sources:** `GET /api/playbooks`, `GET /api/adherence?query`
- **AI involvement:** None
- **User workflow:** Browse playbooks; view adherence score per playbook; create/delete playbooks; no `/playbooks/[id]` detail page — details render inline

### Progress
- **Route:** `/progress` (`apps/web/src/app/progress/page.tsx`)
- **Components:** Three-stage routine checklist (Before/During/After trading), checkbox autosave (`POST`/`DELETE /api/workspace/progress`), 13-week heatmap
- **Data sources:** `GET /api/workspace/progress` (rules, checks, today), `progressScore()` + `scheduledRules()` pure functions
- **AI involvement:** None
- **User workflow:** Check off daily/pre-trade/post-trade routine items; heatmap shows consistency over 13 weeks

### Missed trades
- **Route:** `/missed` (`apps/web/src/app/missed/page.tsx`)
- **Components:** `RichEditor` notes, `ReviewExport`, `Attachments`, CRUD via `/api/workspace/missed`
- **Data sources:** `GET /api/workspace/missed`, `GET /api/playbooks`
- **AI involvement:** None
- **User workflow:** Log missed-trade observations; archive/restore toggle; link to playbook

### Import
- **Route:** `/import` (`apps/web/src/app/import/page.tsx`)
- **Components:** Three tabs — `FileImport`, `BrokerConnect`, `ManualTradeEntry`; `AiImportToggle` in file tab header
- **Data sources:** `POST /api/import` (preview/commit), `GET /api/settings` (AI config + importTimeZone), `GET /api/brokers`, `POST /api/accounts` (sync accounts), `POST /api/executions` (manual)
- **AI involvement:** `AiImportToggle` enables AI-assisted parsing. When `ai: true`, the file is base64-encoded and sent to `POST /api/import`; server calls `parseStatementWithAi` (`apps/web/src/server/ai-import.ts`) which uses `runObjectAi` with a strict extraction schema. Evidence: `apps/web/src/app/import/page.tsx`
- **User workflow:** Upload broker statement → AI parses to execution preview → human reviews → commit; or connect broker sync; or manual entry

### Accounts
- **Route:** `/accounts` (`apps/web/src/app/accounts/page.tsx`)
- **Components:** Per-card actions via `/api/accounts/[id]/actions` (sync, archive, unarchive, clear, transfer); initial balance + profitCalcMethod `PATCH`; delete
- **Data sources:** `GET /api/accounts`, `PATCH /api/accounts/[id]`, `POST /api/accounts/[id]/actions`, `DELETE /api/accounts/[id]`
- **AI involvement:** None
- **User workflow:** Manage broker accounts; trigger sync; archive inactive accounts

### Settings
- **Route:** `/settings` (`apps/web/src/app/settings/page.tsx`)
- **Components:** Six anchored sections — general, trading, currency, market-data, AI settings (`AiSettings`), data; all `POST`/`PATCH /api/settings`
- **Data sources:** `GET /api/settings`, `PATCH /api/settings`
- **AI involvement:** `AiSettings` component posts provider + API key + model selection to `/api/settings` (stored encrypted via `apps/web/src/server/settings.ts`). Evidence: `apps/web/src/app/settings/page.tsx`
- **User workflow:** Configure journal defaults, currency, market data connections, AI provider/key

### Login
- **Route:** `/login` (`apps/web/src/app/login/page.tsx`)
- **Components:** Password input, `POST /api/auth`
- **AI involvement:** None
- **Note:** Rendered outside `Shell` (layout skips Shell for `/login`). Evidence: `apps/web/src/app/layout.tsx`

---

## 2. Existing Capability Inventory

All typed, read-only server modules the model could reuse as a tool. Write operations are noted.

### `queryTrades` — `apps/web/src/server/trades-query.ts`
```ts
queryTrades(filters: TradeFilters, timeZone?: string): { trades: AnnotatedTrade[]; config: JournalConfig }
getTradeByKey(key: string): AnnotatedTrade | null
getAdjacentTradeKeys(currentKey: string, filters: TradeFilters, accountId?: string): { prev?: string; next?: string }
```
- **Data source:** `db.trades`, `settings.getTimeZone`, `settings.getMultipliers`, `journal-core.matchesFilters`
- **Read-only:** Yes
- **AI reuse:** Used by `askJournalContext` (`ai-capabilities.ts:14`) and `tradeCritiqueContext` (`ai-capabilities.ts`)

### `listExecutions` — `apps/web/src/server/executions.ts`
```ts
listExecutions(accountId: string, ids?: string[]): Execution[]
```
- **Data source:** `db.executions`, `db.accounts`, `db.trades`
- **Read-only:** Yes (exposes fills for a trade)
- **AI reuse:** Used by `askJournalContext` and `tradeCritiqueContext` to render fill detail in `get_trade_detail` tool

### `askJournalContext` — `apps/web/src/server/ai-capabilities.ts`
```ts
askJournalContext(scope: FrozenApprovedScope): Promise<{ context: string; scope: FrozenApprovedScope } | { error: string }>
```
- **Data source:** `queryTrades` (DB trades), `journal-core.computeMetrics/bySymbol/byDuration/etc.`
- **Read-only:** Yes
- **Output:** Human-readable string summary (metrics, buckets, top symbols, outcomes, weekdays, mistakes, playbooks, tags) plus the frozen scope
- **AI reuse:** Consumed by `POST /api/ai/ask` route only

### `dailyRecapContext` — `apps/web/src/server/ai-capabilities.ts`
```ts
dailyRecapContext(scope: FrozenApprovedScope, date: string, existingNote?: string): Promise<{ context: string }>
```
- **Data source:** `queryTrades` scoped to a single date, `journal-core.computeMetrics`
- **Read-only:** Yes
- **Output:** Day metrics + existing note content (excluded from AI input so the recap cannot read prior AI output)
- **AI reuse:** Consumed by `POST /api/ai/recap` route only

### `tradeCritiqueContext` — `apps/web/src/server/ai-capabilities.ts`
```ts
tradeCritiqueContext(key: string): Promise<null | { context: string }>
```
- **Data source:** `getTradeByKey`, `listExecutions` (fills)
- **Read-only:** Yes
- **Output:** Single-trade summary + fill list; returns `null` when no trade matches the key
- **AI reuse:** Consumed by `POST /api/ai/critique` route only

### `FrozenApprovedScope` + `readAiRequest` — `apps/web/src/server/ai-scope.ts`
```ts
readAiRequest(value: unknown, field: "question" | "date"): FrozenApprovedScope
deepFreeze<T>(value: T): T
accountContext(trades: AnnotatedTrade[], scope: FrozenApprovedScope): string
```
- **Data source:** `db.accounts`, `db.playbooks`, `settings.getTimeZone`
- **Read-only:** Yes (validation only; no data modification)
- **Output:** Deep-frozen, account-bounded, filter-bounded scope object
- **AI reuse:** Gate for all three AI routes; the AI tool loop cannot widen the frozen scope

### `aiConfigured()` — `apps/web/src/server/ai.ts`
```ts
aiConfigured(): boolean
```
- **Data source:** `settings.getAiKey(getAiProvider())`
- **Read-only:** Yes
- **AI reuse:** UI gate for AI feature availability

### `aiKeyEnvironment` / `resolveAiConfiguration` — `apps/web/src/server/settings.ts`
```ts
resolveAiConfiguration(): { provider: AiProvider; modelId: string; apiKey: string | null }
getAiSettings(): AiSettings
```
- **Data source:** `db.settings` (encrypted), `process.env`
- **Read-only:** Yes
- **AI reuse:** Called exclusively by `ai-runtime.ts`; never by routes or components directly

### `AiFeature` + `AI_FEATURE_POLICIES` + `AI_PROMPT_VERSIONS` — `apps/web/src/server/ai-contracts.ts`
```ts
type AiFeature = "reflection" | "askJournalAgent" | "statementImport"
AI_FEATURE_POLICIES: Record<AiFeature, AiExecutionPolicy>  // tokens, retries, timeouts, step/call limits
AI_PROMPT_VERSIONS: Record<AiFeature, string>              // "reflection-v1", "ask-journal-agent-v1", ...
```
- **Data source:** None (constant)
- **Read-only:** Yes
- **AI reuse:** Read by `ai-runtime.ts` to configure every execution

### `AiExecutionMeta` — `apps/web/src/server/ai-contracts.ts`
```ts
type AiExecutionMeta = Readonly<{
  feature: AiFeature; provider: "anthropic" | "openai"; modelId: string;
  promptVersion: string; durationMs: number; finishReason: string | undefined;
  inputTokens: number | undefined; outputTokens: number | undefined;
  maxRetries: number; stepCount: number | undefined; toolCallCount: number | undefined;
}>
```
- **Data source:** Produced by `ai-runtime.ts`; logged by callers
- **AI reuse:** Redacted metadata; prompt/response never surfaced

### `createAskJournalTools` — `apps/web/src/server/ai.ts`
Three read-only tools over the frozen scope:
1. `get_journal_summary` — no input; returns the same pre-built `askJournalContext` string
2. `find_trades` — `{ symbol?: string; outcome?: "win"|"loss"|"breakeven"|"open"; dateOrder?: "newest"|"oldest" }`; returns ≤5 trades via scoped `queryTrades`; symbol capped at 64 chars
3. `get_trade_detail` — `{ key: string ≤300 }`; resolves via scoped `queryTrades`; returns trade projection + ≤50 chronological fills via `listExecutions`; missing trade returns `{ error: "Trade is not available in this journal scope." }`
- **Budget:** `reserveToolCall` guard; over-budget returns `{ error: "AI tool limit reached." }`
- **Constraint:** All tools are closures over the route-created `FrozenApprovedScope`; none call raw DB APIs

### `currencyProjection` — `apps/web/src/server/currency-conversion.ts`
```ts
currencyProjection(trades: AnnotatedTrade[], accounts: CurrencyAccount[], settings: Settings): CurrencyAccount[]
```
- **Data source:** Pure function over trade + account + settings objects
- **Read-only:** Yes
- **AI reuse:** None currently; projection-only (no writes)

### Calendar data — `GET /api/calendar` (route: `apps/web/src/app/api/calendar/route.ts`)
- **Data source:** `queryTrades` bucketed by day, with `computeMetrics`
- **Read-only:** Yes
- **AI reuse:** None currently

### Notebook/Notes — `apps/web/src/server/notes.ts` (route: `apps/web/src/app/api/notes/route.ts`)
```ts
// API: GET /api/notes?folder=&q=, POST /api/notes, PATCH /api/notes/[id], DELETE /api/folders/[id]
```
- **Data source:** `db.notes`, `db.folders`
- **Read-only:** API has read operations; write operations exist
- **AI reuse:** None currently

### Playbooks — `apps/web/src/server/playbooks.ts` (route: `apps/web/src/app/api/playbooks/route.ts`)
```ts
// API: GET /api/playbooks, POST /api/playbooks, DELETE /api/playbooks/[id]
// Adherence: GET /api/adherence?query
```
- **Data source:** `db.playbooks`, `db.rules`
- **Read-only:** Read API exists; write API also exists
- **AI reuse:** None currently; `accountContext` in `ai-scope.ts` reads playbook names for scope labeling

### Progress — `apps/web/src/server/workspace/progress.ts` (route: `apps/web/src/app/api/workspace/progress/route.ts`)
```ts
// API: GET /api/workspace/progress, POST /api/workspace/progress, DELETE /api/workspace/progress
```
- **Data source:** `db.progressChecks`, `db.scheduledRules`
- **Read-only:** Read+write API
- **AI reuse:** None currently

### Market data providers — `apps/web/src/server/market-data/`
```ts
MarketDataProvider: { history(candles: HistoryRequest): Promise<Candle[]>; validateCredentials?(input: unknown): Promise<boolean> }
```
- **Providers:** OANDA (`oanda.ts`), Alpaca (`alpaca.ts`), London Strategic Edge (`london-strategic-edge.ts`), Binance (`public-crypto.ts`), Coinbase (`public-crypto.ts`), user CSV (`csv.ts`)
- **Data source:** External APIs via `marketTransport`; CSV from `db.marketCsvDatasets`
- **Read-only:** Yes (no writes to market data providers)
- **AI reuse:** None currently; provider registry in `connections.ts`

### `propData` / `propToday` / `mutateProp` / `propHistory` — `apps/web/src/server/prop-firms.ts`
```ts
propData(): Promise<PropFirmData>
propToday(): Promise<PropFirmToday | null>
mutateProp(body: PropFirmMutation): Promise<void>
propHistory(type: string, id: string): Promise<PropFirmHistoryEntry[]>
```
- **Data source:** `db.propAccounts`, `db.propEntries`, `db.propReceipts`, `db.propAudit`, `db.accounts`
- **Read-only:** `propData`, `propToday`, `propHistory` are read-only; `mutateProp` is write
- **AI reuse:** None currently

---

## 3. Existing Business-Rule Modules

The following must NOT be duplicated or bypassed by any agent:

### Scope validation — `apps/web/src/server/ai-scope.ts`
`readAiRequest` is the **only** entry point that creates a `FrozenApprovedScope`. It validates:
- Filter key whitelist (only `AnalysisFilters` keys)
- Account ID existence against `db.accounts`
- Timezone equality against `getTimeZone()`
- `from ≤ to`, min ≤ max for numeric filters
- Question max 10,000 chars (for ask-journal)
- Date format `YYYY-MM-DD` (for daily recap)
An agent must never instantiate a scope directly; it must receive a pre-frozen scope from a validated request. Evidence: `ai-scope.ts:56-93`

### Encryption — `apps/web/src/server/crypto.ts`
AES-256-GCM envelope encryption (`encryptJson`/`decryptJson`) protects all broker credentials and AI API keys at rest. Keys are stored in `dataDir/.secret` or env vars. No agent may read or write encrypted credentials without going through `settings.ts`. Evidence: `crypto.ts`; usage in `sync.ts` and `settings.ts`

### Broker SDK boundary — `apps/web/src/server/sync.ts`
Broker connectivity is exclusively through `@luxalgo/broker-sdk.connect`. All sync operations route through `syncAccount` which calls `insertExecutions` for writes. No agent may call broker APIs directly. Evidence: `sync.ts`

### Import write-path — `apps/web/src/server/ai-import.ts`
Statement import is a **deterministic schema-bound preview/review/commit** workflow:
1. `parseStatementWithAi` — AI extracts executions (120s timeout, 0 retries, 32k tokens)
2. `validateAiExtraction` — strict schema validation
3. `createAiImportPreview` — encrypted token stored server-side
4. `readAiImportPreview` — token verified and decrypted; **no AI call on commit**

The commit endpoint (`POST /api/import` with `commit: true`) **must not call a model**. Evidence: `ai-import.ts`, `ai-contracts.ts:AI_FEATURE_POLICIES.statementImport`

### `rebuildAccount` — `apps/web/src/server/rebuild.ts`
Account materialization (`trades` + `positions`) is derived from `db.executions`. Any agent that triggers a rebuild without user action could corrupt trade state. Rebuilds must remain user-initiated only.

### Rule evaluation — `apps/web/src/server/rules.ts` (route: `apps/web/src/app/api/trades/[key]/rules/route.ts`)
Rule checklists and adherence scores are computed via `journal-core`. The AI critique path (`/api/ai/critique`) receives pre-built `RuleChecklist` output; it does not evaluate rules itself.

### Trade-key format — `apps/web/src/server/ids.ts`
Trade keys are derived via `executionHash` + `newId()`. Changing the key derivation algorithm would break trade identity. Any agent that generates or parses trade keys must use existing `ids.ts` functions.

### Position import validation — `apps/web/src/server/position-import.ts`
`positionImportErrors` validates incoming position-labeled CSVs against `db.executions` via `ids.executionHash`. Agents must not bypass this validation.

### IBKR sync timezone — `apps/web/src/server/ibkr-sync-timezone.ts`
IBKR sync accounts have a timezone provenance contract. `assertIbkrSyncTimeZone` and `ibkrTransferTimeZone` must be respected; mixing timezone-aware and naive timestamps would corrupt execution history.

---

## 4. Existing AI Feature Classification

### Direct (no agent loop)

| Feature | Route | Runtime function | Policy |
|---|---|---|---|
| Daily recap | `POST /api/ai/recap` | `runAi(buildDailyRecapPrompt(...))` | `reflection`: 1200 tok, 2 retries |
| Trade critique | `POST /api/ai/critique` | `runAi(buildTradeCritiquePrompt(...))` | `reflection`: 1200 tok, 2 retries |
| Statement import (preview) | `POST /api/import` (`ai: true`) | `runObjectAi` with `jsonSchema<Extraction>` | `statementImport`: 32k tok, 0 retries, 120s timeout |

Evidence: `apps/web/src/server/ai.ts:runAi`, `ai-runtime.ts:runTextAi/runObjectAi`, `ai-contracts.ts:AI_FEATURE_POLICIES`

### Agent (bounded tool loop)

| Feature | Route | Runtime function | Tools | Bounds |
|---|---|---|---|---|
| Ask Journal | `POST /api/ai/ask` | `runAskJournalAi(scope, context)` | `get_journal_summary`, `find_trades`, `get_trade_detail` | 4 max steps, 4 max tool calls, 1200 tok, 30s timeout, `FrozenApprovedScope` closure |

Evidence: `apps/web/src/server/ai.ts:createAskJournalTools`, `ai-runtime.ts:runAskAgentAi`, `ai-contracts.ts:AI_FEATURE_POLICIES.askJournalAgent`

### AI feature policy map

Defined in `apps/web/src/server/ai-contracts.ts:AI_FEATURE_POLICIES`:
```ts
reflection:       { maxOutputTokens: 1200, maxRetries: 2 }
askJournalAgent:  { maxOutputTokens: 1200, maxRetries: 2, timeoutMs: 30_000, maxSteps: 4, maxToolCalls: 4 }
statementImport:  { maxOutputTokens: 32_000, maxRetries: 0, timeoutMs: 120_000 }
```

Prompt versions (`AI_PROMPT_VERSIONS`): `"reflection-v1"`, `"ask-journal-agent-v1"`, `"statement-import-v1"`. Evidence: `ai-contracts.ts:33-39`

---

## 5. Identified Agent Opportunities Per Page

Classification key: **(a)** strong agent candidate · **(b)** potentially agentic · **(c)** deterministic · **(d)** needs further investigation

Exclusion: any workflow requiring write actions, settings mutations, raw DB access, or external service calls.

---

### Dashboard — `/`
- **Classification:** (c) deterministic
- **Reason:** Widget grid reads from `/api/stats` which is purely a `queryTrades` aggregation. No natural-language intent to resolve; all filters are already exposed in `FilterBar`. AI commentary on a widget configuration would be speculative (YAGNI).
- **AI exposure today:** None

### Calendar — `/calendar`
- **Classification:** (c) deterministic
- **Reason:** Month/year heatmap reads from `queryTrades` bucketed by day. CalendarPerformance insights are pre-computed `computeMetrics` output. No AI opportunity that is not already covered by Ask Journal on Reports.
- **AI exposure today:** None

### Daily journal list — `/journal`
- **Classification:** (d) needs further investigation
- **Reason:** A natural-language filter ("show me the week after I changed my journal defaults") could route to `queryTrades` with computed filters, but this is functionally identical to Ask Journal scoped to a date range. No separate agent needed unless the UX differs meaningfully.
- **AI exposure today:** None

### Daily journal detail — `/journal/[date]`
- **Classification:** (b) potentially agentic
- **Reason:** The "AI recap" is today a one-shot `runAi` call with `dailyRecapContext`. An agent could be given a memory of prior recaps for the same day across weeks/months to detect drift — but this requires a read store for AI-generated recaps, which does not exist today. The deterministic `dailyRecapContext` covers the current use case.
- **AI exposure today:** `AiRecap` → `POST /api/ai/recap`
- **Constraint:** `dailyRecapContext` explicitly **excludes** the existing note from the AI input (`existingNote` parameter fed to the prompt builder separately), preventing the AI from reading its own prior output.

### Trades list — `/trades`
- **Classification:** (c) deterministic
- **Reason:** Table is a structured `queryTrades` output with column sorting/filtering. Bulk actions (review/unreview/tag/delete) are write operations — out of scope for read-only agent.
- **AI exposure today:** None

### Trade detail — `/trades/[key]`
- **Classification:** (b) potentially agentic
- **Reason:** The "AI review" card is today a one-shot `runAi` call with `tradeCritiqueContext`. An agent could cross-reference the trade against playbook rules or missed-trade log — but `RuleChecklist` is already rendered separately and `tradeCritiqueContext` intentionally provides a bounded, self-contained trade view. An extended agent would need read access to `db.playbooks` rules and `db.missed` which are not in the current frozen scope.
- **AI exposure today:** "AI review" card → `POST /api/ai/critique`
- **Constraint:** Critique key must exist within the scoped `queryTrades` filter; out-of-scope trades return an error.

### Reports — `/reports`
- **Classification:** (a) strong agent candidate
- **Reason:** `AskJournal` is already on this page. The page aggregates five report modes over the same filtered journal. A Report Generation agent could, given a natural-language request like "why did my win rate drop in August?", automatically: (1) detect the relevant time window, (2) slice by symbol/strategy, (3) cross-reference mistakes log, (4) produce a structured answer — all within the existing `FrozenApprovedScope` and `askJournalContext` data. The bounded Ask Journal tool loop already has `find_trades` and `get_trade_detail` tools; the remaining gap is `RuleChecklist` / mistake-tag correlation.
- **AI exposure today:** `AskJournal` → `POST /api/ai/ask`
- **Existing tools:** `get_journal_summary`, `find_trades`, `get_trade_detail`
- **Gap:** No tool to read playbook rule evaluations for a given trade; no tool to read missed-trade observations.

### Prop firms — `/prop-firms`
- **Classification:** (d) needs further investigation
- **Reason:** Prop firm data (`propData`, `propHistory`) is separate from journal trades. An agent could correlate prop firm evaluation windows against journal performance — but this requires a new data scope outside `FrozenApprovedScope`. No AI runs here today.
- **AI exposure today:** None

### Notebook — `/notebook`
- **Classification:** (d) needs further investigation
- **Reason:** Notes are free-form text. An agent that could read and synthesize notebook entries across folders could support reflection workflows, but this requires read access to `db.notes` and `db.folders` which are not part of the `FrozenApprovedScope`. The existing `REFLECTION_SYSTEM_PROMPT` in `ai-prompts.ts` suggests a reflection use case but is not wired to notebook data.
- **AI exposure today:** None

### Playbooks — `/playbooks`
- **Classification:** (d) needs further investigation
- **Reason:** Playbook creation/editing are write operations. An agent that could read playbook rules and adherence reports could suggest playbook improvements — but this requires read access to `db.playbooks` and `db.rules` outside the current `FrozenApprovedScope`. `AdherenceReport` is already a pre-computed read. No AI runs here today.
- **AI exposure today:** None (only `db.playbooks` names are read by `accountContext` for scope labeling)

### Progress — `/progress`
- **Classification:** (d) needs further investigation
- **Reason:** Progress checks are write-driven (autosave). An agent that could read the 13-week heatmap and suggest routine improvements would need `db.progressChecks` read access, which is outside the current scope. Pre-computed `progressScore()` and `scheduledRules()` exist as pure functions.
- **AI exposure today:** None

### Missed trades — `/missed`
- **Classification:** (b) potentially agentic
- **Reason:** Missed-trade log is a rich source of pattern data. An agent that could correlate missed-trade observations with the trades that caused them (via date/symbol/context matching) could surface systematic mistakes — functionally similar to the existing `byMistake` bucket in `askJournalContext`. The gap is a tool to read `db.missed` observations, which does not exist today.
- **AI exposure today:** None

### Import — `/import`
- **Classification:** (c) deterministic
- **Reason:** The AI-assisted import flow is already a deterministic schema-bound preview/review/commit workflow. `parseStatementWithAi` is a single `runObjectAi` call with strict extraction schema. The commit path must not call a model. No agent loop here; not a candidate for conversion.
- **AI exposure today:** `AiImportToggle` → `POST /api/import` (`ai: true`) → `parseStatementWithAi` → `createAiImportPreview`
- **Constraint:** `{ ai: true }` body flag; 120s timeout; 0 retries; 32k tokens; commit is AI-free.

### Accounts — `/accounts`
- **Classification:** (d) needs further investigation
- **Reason:** Account management is write-heavy (sync, archive, transfer). A read-only account health agent could flag accounts with stale sync data or unusual execution volumes — but this requires new read capabilities outside the current `FrozenApprovedScope`. No AI runs here today.
- **AI exposure today:** None

### Settings — `/settings`
- **Classification:** (c) deterministic (configuration UI; not a data page)
- **Reason:** AI key management (`AiSettings`) is a configuration surface, not a data reasoning page. BYO-key and model selection are set here; no AI reasoning target.
- **AI exposure today:** `AiSettings` component → `PATCH /api/settings` with `[provider]Key`

---

## 6. Capability Gaps

Typed, read-only server capabilities the product would need to expose before an agent could safely reason about each opportunity. These are **not implemented today**.

### Gap 1: Playbook rule evaluation for a trade
- **Needed for:** Trade detail (extended critique), Reports (playbook adherence questioning)
- **Required read:** `db.rules` filtered by playbook, rule evaluation result for a specific trade
- **Existing partial:** `RuleChecklist` is rendered server-side at `GET /api/trades/[key]/rules?playbook=...`; it is consumed by the UI component, not exposed as a capability
- **Constraint:** Rules reference trade outcomes; must be scoped to the same `FrozenApprovedScope`

### Gap 2: Missed-trade observation reader
- **Needed for:** Missed trades page (pattern correlation), extended trade critique
- **Required read:** `db.missed` observations filtered by date range or symbol
- **Existing partial:** `GET /api/workspace/missed` exists as a UI endpoint; not available to the AI tool loop
- **Constraint:** Observations are free-form text; a summarization step would be needed before injecting into a prompt

### Gap 3: Notebook entry reader
- **Needed for:** Notebook page (reflection across notes), extended journal analysis
- **Required read:** `db.notes` entries filtered by folder or free-text search
- **Existing partial:** `GET /api/notes?folder=&q=` exists as a UI endpoint
- **Constraint:** Notes may contain sensitive trade observations; privacy settings must be honored before surfacing to AI

### Gap 4: Progress check history reader
- **Needed for:** Progress page (routine improvement suggestions)
- **Required read:** `db.progressChecks` with date range and routine stage filter
- **Existing partial:** `GET /api/workspace/progress` exists as a UI endpoint
- **Constraint:** Progress data is user-routine private; privacy mode must be respected

### Gap 5: Prop firm correlation reader
- **Needed for:** Prop firms page (evaluation window vs. journal performance)
- **Required read:** `propData()` output + `propHistory()` filtered by date range, correlated with `queryTrades` metrics for the same period
- **Existing partial:** Both functions exist in `prop-firms.ts`; not available to AI scope
- **Constraint:** Prop firm data is institutionally sensitive; scope must be explicitly granted, not derived from journal accounts

### Gap 6: Calendar day reader for Ask Journal
- **Needed for:** Daily journal detail (Ask Journal "why was this day different?")
- **Required read:** `computeMetrics` output for a specific day, or the `calendar` bucket structure from `askJournalContext`
- **Existing partial:** `dailyRecapContext` produces day-level metrics but is only consumed by the recap route; not available as a tool
- **Constraint:** Must not include AI-generated recap text (already handled by excluding `existingNote` from the prompt input)

### Gap 7: Multi-account aggregated metrics over time
- **Needed for:** Dashboard (AI commentary on portfolio-level drift), Reports (cross-account comparison)
- **Required read:** `queryTrades` with multiple `accounts` IDs, bucketed by week/month
- **Existing partial:** `computeMetrics` in `askJournalContext` already does this for the ask-journal context string; `ReportOverview` does it for the stats endpoint
- **Constraint:** The metrics are available but not as a named, stable capability interface

---

## 7. Risks and Constraints

### Privacy
- Journal data is sensitive. `REFLECTION_SYSTEM_PROMPT` (`ai-prompts.ts`) states the model operates on the user's own journal. Privacy mode (`PrivacyToggle` in `shell.tsx`) controls rendering; AI tool outputs must also respect it before being displayed. Currently the AI output is appended to user-authored notes — the user controls publication. A future agent that auto-generates notes must implement privacy-aware rendering. Evidence: `.omp/style/ai-integration.md` privacy rules.

### BYO-key isolation
- API keys are encrypted at rest via `crypto.ts` and resolved only on the server via `resolveAiConfiguration()`. No AI feature may accept a key, model, or provider from the client. The runtime (`ai-runtime.ts`) is the sole adapter. Evidence: `settings.ts:resolveAiConfiguration`; enforced by `ai-contracts.ts` feature policy.

### No telemetry / prompt logging
- `AiExecutionMeta` is the only metadata that may be recorded. Prompt text, model response, and key material must never appear in logs, metadata, drafts, or traces. Evidence: `.omp/style/ai-integration.md` logging section.

### Import commit is AI-free
- The commit step of the import workflow (`POST /api/import` with `commit: true`) must not call a model. This is enforced by the bounded `statementImport` policy (0 retries, 120s timeout) and the `readAiImportPreview` flow. Evidence: `ai-import.ts:createAiImportPreview` / `readAiImportPreview`.

### Zero-trust statement parsing
- `parseStatementWithAi` treats the broker statement as untrusted data. The system prompt instructs the model to ignore any instructions inside the document. The `Extraction` schema requires explicit `complete: true` only when all rows are verified. Incomplete parses are rejected rather than committed with warnings. Evidence: `ai-import.ts:parseStatementWithAi` system prompt.

### No agent session persistence
- `runAskAgentAi` executes a fixed 4-step, 4-tool-call loop with no session store. There is no `sessionId`, no conversation history, and no per-session budget tracking beyond the step/call hard limits. Evidence: `ai-runtime.ts:runAskAgentAi`, `ai-contracts.ts:AI_FEATURE_POLICIES.askJournalAgent`.

### Frozen scope immutability
- `deepFreeze` is applied to the `FrozenApprovedScope` before any tool closure is created. An agent cannot widen the scope by adding or modifying filter keys, accounts, or timezone. Evidence: `ai-scope.ts:deepFreeze`; `ai-scope.ts:readAiRequest` is the only call site.

### No raw DB access for agents
- All AI tool functions (`createAskJournalTools`) use existing typed query functions (`queryTrades`, `listExecutions`) and never call Drizzle ORM directly. New capabilities (Gap 1–7 above) must follow the same pattern: a typed server function, not a raw SQL injection point.

### Trade-key format stability
- Trade keys are opaque identifiers derived by `ids.ts`. Agents that need to reference trades must use the `key` field returned by `queryTrades` or `getTradeByKey`. Parsing or constructing keys is not a supported interface.

### Scope creep risk for "potentially agentic" features
- Several pages classified (b) (trade detail, missed trades) would require new data scopes outside `FrozenApprovedScope`. Extending the scope to include `db.missed` or `db.notes` introduces new privacy surfaces. Each requires a separate scope validation design before the AI can access it.

### No streaming
- Current AI features use synchronous `runTextAi` / `runObjectAi` / `runAskAgentAi`. There is no `ReadableStream` response, no per-chunk cancellation, and no client disconnect handling. Evidence: `ai-runtime.ts`; future architecture in `docs/superpowers/specs/2026-10-08-contextual-ai-workspace-design.md` defers streaming.

### No per-session token budget
- `sessionBudget` is described in the future architecture spec but not implemented. A malicious or runaway Ask Journal session could exhaust the API key's token quota within a single request's 4-step loop (mitigated by the 4-step hard cap, but not by a cumulative session limit). Evidence: `ai-runtime.ts` step/call limits vs. no session counter.

---

## 8. Recommended Phase 4 Decision Record

> **4.1 — Assess extending Ask Journal tool surface to cover Reports page navigation**

**Decision:** Justified for SPDR entry.

**Rationale:**
The Reports page (`/reports`) is the strongest agent candidate (5a) because:
1. `AskJournal` is already on the page — the UX hook exists
2. The page aggregates five report modes (`overview`, `trends`, `explorer`, `breakdown`, `compare`) over the same filtered journal
3. A Report Generation agent with `find_trades` + `get_trade_detail` tools can already answer most analytical questions the current Ask Journal can phrase
4. The `FrozenApprovedScope` and `askJournalContext` data already cover the hard part — the agent just needs a tool to invoke a specific report mode (e.g., "show me the breakdown by symbol for August")
5. No new privacy surface: the agent operates within the existing `FrozenApprovedScope`

**What a 4.1 record would need to define:**
- A new `runReportAgent` feature in `AI_FEATURE_POLICIES` with its own policy (tokens, timeout, steps)
- A new `reportContext(scope, mode, params)` capability in `ai-capabilities.ts` that calls the appropriate `/api/analysis` or `/api/stats` endpoint and formats the result as structured text
- A new `switchReportMode` tool in `createAskJournalTools` that accepts `{ mode: "overview"|"trends"|"explorer"|"breakdown"|"compare", primary?: string, secondary?: string, filters?: Record<string, string> }` — narrowing, not widening the scope
- Prompt builder in `ai-prompts.ts` for the report-agent system prompt
- No changes to `readAiRequest`, `FrozenApprovedScope`, or any write path

**Why not the other candidates:**
- **Trade detail critique (5b):** Already a one-shot direct call; extending to cross-reference playbook rules or missed trades requires new data scope (Gap 1, Gap 2) — too large for a Phase 4 without that gap being closed first
- **Missed trades (5b):** Requires Gap 2 (missed observation reader) — not available today
- **Notebook (5d):** Requires Gap 3 (note reader) + privacy rendering — distinct privacy surface
- **Prop firms (5d):** Requires Gap 5 (prop data correlation) — separate data domain, separate scope boundary
- **Progress (5d):** Requires Gap 4 (progress check reader) — privacy-sensitive routine data

**Blocking dependencies for any Phase 4:**
1. `ai-scope.ts` read access must be extended to cover any new data source (Gap 1–7) before a tool can access it
2. Privacy-aware rendering must be confirmed for any new data surface
3. Feature policy entry (`AI_FEATURE_POLICIES`) and prompt version (`AI_PROMPT_VERSIONS`) must exist before the runtime is called
4. The `statementImport` import flow must not be converted to an agent — it is explicitly excluded by the task constraints

---

*Report produced from read-only code analysis. No source files modified. All citations reference line ranges in `apps/web/src/server/`, `apps/web/src/app/`, and `apps/web/src/components/`.*
