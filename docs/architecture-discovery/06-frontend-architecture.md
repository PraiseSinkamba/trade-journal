# 06 — Frontend Architecture

**Evidence register:** ARCH-100–199

---

## 6.1 Framework and Runtime

| Concern | Implementation | ARCH |
|---------|---------------|------|
| Framework | Next.js 15.5.23 App Router | `ARCH-101` |
| UI library | React 19.1.0 | `ARCH-101` |
| Styling | Tailwind CSS v4.3.3 + class-variance-authority | `ARCH-101` |
| Radix primitives | `@radix-ui/react-*` for Dialog, Tabs, Select, etc. | `ARCH-101` |
| Charts | ECharts 6.1.0 via `components/charts/` wrappers | `ARCH-102` |
| Data fetching | Custom `useApi` / `useAutosave` (no TanStack Query) | `ARCH-103` |
| State | React Context (`PrivacyContext`) + component-local `useState` | `ARCH-104` |
| Build output | `output: "standalone"` — self-contained Node server | `ARCH-105` |

Sources: `apps/web/package.json:43` (Next), `:45` (React), `:61` (Tailwind), `:36` (CVA), `:41` (ECharts); `apps/web/next.config.ts:4` (`output: "standalone"`); `apps/web/src/components/charts/`; `apps/web/src/lib/use-api.ts:14-63`; `apps/web/src/components/privacy.tsx:9`; `Dockerfile:2,13` (`node:22-slim`)

---

## 6.2 Application Shell

The shell (`apps/web/src/components/shell.tsx`) is a client component wrapping all authenticated pages.

```
RootLayout
└── Shell (client)
    ├── AppSidebar (sidebar)
    │   ├── NAV: Dashboard | Calendar | Daily journal | Trades | Reports |
    │   │           Prop firms | Notebook | Playbooks | Progress | Missed trades
    │   └── NAV_SETUP: Import | Accounts | Settings
    └── SidebarInset
        └── page content (via children)
```

The two nav arrays are literal constants in the source — `NAV` at `apps/web/src/components/shell.tsx:45-56` (10 entries) and `NAV_SETUP` at `:58-62` (3 entries: Import, Accounts, Settings). "Trade Explorer" is **not** a nav entry: it is a component (`components/trade-explorer.tsx`) reached from the Reports page's "Trade explorer" report mode (`app/reports/page.tsx:289`).

Login (`/login`) is intentionally unwrapped — `apps/web/src/components/shell.tsx:267-273` returns `<>{children}</>` for that pathname (`:269`), so no sidebar renders. All other routes share the sidebar.

The sidebar collapses to a rail on desktop and a drawer on mobile via `@radix-ui/react-dialog` + custom state.

`ARCH-106`

---

## 6.3 Data Fetching Layer

### `useApi` (`apps/web/src/lib/use-api.ts`)

```typescript
useApi<T>(url: string | null) → { data, error, loading, refresh }
```

- Deduplicates concurrent reads of the same URL via `acquireJson` in `api-request.ts`.
- Cancels in-flight requests via `AbortController` when last subscriber unmounts.
- Uses `startTransition` to avoid blocking the main thread during render.
- `refresh()` bumps a tick counter to retrigger the effect.

`ARCH-103`

### `acquireJson` (`apps/web/src/lib/api-request.ts`)

- Shares in-flight GET requests across components via a `Map<string, PendingRequest>`.
- `queueMicrotask` aborts the shared controller when `users` drops to zero.
- Each request is `cache: no-store` — no browser or CDN caching.

`ARCH-107`

### `postJson` (`apps/web/src/lib/use-api.ts`)

```typescript
postJson<T>(url, body, method) → Promise<T>
```

Throws on non-2xx responses, extracting `data.error ?? "Request failed (status)"`.

### `useAutosave` (`apps/web/src/lib/use-autosave.ts`)

Debounced writes for the notebook editor. Merges rapid edits, sends one PATCH at a time (method defaults to `PATCH`, `:4`), retains failed edits for retry. Every POST carries `keepalive` when the serialised body is under 50 000 characters (`:24`); the `beforeunload` handler (`:53-56`) only triggers a final `flush()`.

`ARCH-202`

---

## 6.4 Page Architecture

All 16 route pages under `apps/web/src/app/`:

| Route | Component | Data ownership |
|-------|-----------|---------------|
| `/` | `app/page.tsx` (client) | `GET /api/stats?query` — widget grid |
| `/accounts` | `app/accounts/page.tsx` | `GET /api/accounts`, `POST /api/accounts` |
| `/calendar` | `app/calendar/page.tsx` | `GET /api/calendar?query` |
| `/import` | `app/import/page.tsx` (large, multi-step) | `POST /api/import` |
| `/journal` | `app/journal/page.tsx` | `GET /api/journal` |
| `/journal/[date]` | `app/journal/[date]/page.tsx` | `GET /api/journal/{date}` + `AiRecap` |
| `/login` | `app/login/page.tsx` | `POST /api/auth` |
| `/missed` | `app/missed/page.tsx` | `GET /api/trades?query` (missed-trade observation set) |
| `/notebook` | `app/notebook/page.tsx` | `GET/POST/PATCH /api/notes` (autosaved editor) |
| `/playbooks` | `app/playbooks/page.tsx` | `GET /api/playbooks` |
| `/progress` | `app/progress/page.tsx` | `GET /api/stats?query` (stage hit-rate history) |
| `/prop-firms` | `app/prop-firms/page.tsx` | `GET /api/prop-firms` |
| `/reports` | `app/reports/page.tsx` | `GET /api/stats?query`, `GET /api/analysis?…` + report mode state; hosts `AskJournal` |
| `/settings` | `app/settings/page.tsx` | `GET/PATCH /api/settings` |
| `/trades` | `app/trades/page.tsx` (client) | `GET /api/trades?query` — TanStack Table |
| `/trades/[key]` | `app/trades/[key]/page.tsx` (client) | `GET /api/trades/{key}` + `POST /api/ai/critique` |

**Suspense coverage:** 14 of the 16 pages contain an explicit `<Suspense>` boundary in the page body. Two do **not**: `app/login/page.tsx` and `app/trades/[key]/page.tsx`. The outer `app/layout.tsx:24` wraps the provider tree in a `<Suspense>` boundary regardless.

`ARCH-108`

---

## 6.5 Dashboard Widget Architecture

`app/page.tsx` (Dashboard) builds a widget array inline in the JSX (`apps/web/src/app/page.tsx:226-800`):

```typescript
DashboardLayout
  widgets={[
    { id, label, size, layoutGroup, content: <Card>…</Card> },
    ...
  ]}
```

Each widget is a self-contained `<Card>` with a `<StatHeader>` + `<CardContent>`. `DashboardLayout` (`apps/web/src/components/dashboard-layout.tsx`) arranges them in CSS grid columns controlled by the saved layout in `localStorage` (`dashboard-layout.tsx:145`, `:175`; the `storage` event re-reads it at `:160`).

The 16 widget labels, in source order (`app/page.tsx`):

| # | Label | Line |
|---|-------|------|
| 1 | Net P&L | `:230` |
| 2 | Trade win % | `:270` |
| 3 | Profit factor | `:293` |
| 4 | Day win % | `:320` |
| 5 | Avg win / loss | `:339` |
| 6 | Edge Score | `:392` |
| 7 | Cumulative P&L | `:437` |
| 8 | Daily P&L | `:463` |
| 9 | Calendar | `:487` |
| 10 | Activity | `:519` |
| 11 | Max drawdown | `:597` |
| 12 | Streaks | `:623` |
| 13 | Expectancy / trade | `:650` |
| 14 | Avg duration | `:681` |
| 15 | Best / worst day | `:702` |
| 16 | Trade time performance | `:741` |

Note: there are no "R:Ratio", "R multiples", or "Edge radar" widgets.

**Stats payload (not widgets):** the dashboard's `GET /api/stats` response carries a `buckets` object keyed by `"symbol" | "weekday" | "hour" | "duration" | "direction"` (`apps/web/src/app/page.tsx:67`; server side `apps/web/src/app/api/stats/route.ts:96-101`). Those buckets are data consumed by the widgets above — they are not separate dashboard cards.

`ARCH-109`

---

## 6.6 AI Chat Surfaces

### Surface 1: Ask Journal (`AskJournal`)

**Component:** `apps/web/src/components/ask-journal.tsx`
**Mount:** The **Reports** page (`/reports`), rendered as a card above the report-mode buttons (`apps/web/src/app/reports/page.tsx:16` import, `:283` render). It is **not** mounted on the Dashboard — `app/page.tsx` never imports it.
**Request:**

```typescript
POST /api/ai/ask
{ question: string, filters: AnalysisFilters, timeZone: string }
```

**Response:**

```typescript
{ answer: string, scope: AiScope }
```

**Hook:** `useAiRequest()` from `lib/use-ai-request.ts` — serialises concurrent requests, ignores stale completions via `active.current` ref (`components/ask-journal.tsx:29`).

**UI flow:**
1. User types a question and presses Enter or clicks "Ask" (`:37-45`).
2. `busy` state shows "Thinking…" (`:72`) with no streaming.
3. Answer renders as plain text in the card body (`:93-96`).

`ARCH-110`

### Surface 2: AI Recap (`AiRecap`)

**Component:** `apps/web/src/components/ai-recap.tsx`
**Mount:** Journal day page (`/journal/[date]`) as a button above the day notes.
**Props:** `date`, `filters`, `timeZone`, `disabled`, `onRecap(result)`

**Request:**

```typescript
POST /api/ai/recap
{ date: string, filters: AnalysisFilters, timeZone: string }
```

**Response:**

```typescript
{ recap: string, scope: AiScope }
```

**UI flow:** Button click → `AiNotice` shows error or retry → `onRecap` parent stores result → parent renders the recap text.

`ARCH-111`

### Surface 3: Trade Critique

**Trigger:** "Critique" button on the single-trade view (`/trades/[key]` page).

**Request:**

```typescript
POST /api/ai/critique
{ key: string }
```

**Response:**

```typescript
{ critique: string }
```

Displayed inline below the trade's fills.

`ARCH-112`

### Surface 4: Reports Agent

**Component:** `apps/web/src/app/reports/page.tsx`
**Request:**

```typescript
POST /api/ai/reports
{ question: string, filters: AnalysisFilters, timeZone: string }
```

Uses the same `runReportsAgentAi` path as Ask, but with `switch_report_mode` tool available (allows the model to drill into report sub-modes before answering).

`ARCH-113`

### Surface 5: AI Statement Import

**Component:** `apps/web/src/components/ai-import-options.tsx` (`AiImportToggle`) — a checkbox on the Import page (`apps/web/src/app/import/page.tsx:30` import, `:347` render).
**Server:** `apps/web/src/server/ai-import.ts` (`createAiImportPreview`, `parseStatementWithAi`), reached through `POST /api/import`.

The browser sends only a boolean `ai: true` intent plus the statement text; provider, model, and API key are resolved **server-side** from Settings (`apps/web/src/app/api/import/route.ts:31-35`, `components/ai-import-options.tsx:8-11`).

This surface runs on the `statementImport` AI policy (`apps/web/src/server/ai-contracts.ts:57`) and uses `runObjectAi` — a single `generateText` call with an `output` schema and **no tool loop** (`apps/web/src/server/ai-runtime.ts:284`, `:45-53`).

`ARCH-110b`

### Surface 6: Reflection (Recap / Critique backend)

The daily recap and the trade critique are not separate front-end components beyond their triggers — both call the shared `runAi()` helper, which executes the `reflection` AI feature: a single non-tool `generateText` call with a built prompt (`apps/web/src/server/ai.ts:252-280`, `:261` sets `feature: "reflection"`).

`ARCH-110c`

### Shared AI hook: `useAiRequest`

```typescript
// apps/web/src/lib/use-ai-request.ts
export function useAiRequest() {
  async function run<T>(request: () => Promise<T>, accept: (result: T) => void) {
    if (pending.current || !active.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await request();
      if (active.current) accept(result);
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "AI request failed");
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return { run, busy, error, dismiss };
}
```

Key invariants:
- `active.current` ref prevents state updates after component unmount.
- `pending.current` serialises concurrent requests.
- No streaming; `busy` state drives UI loading indicators.

`ARCH-114`

---

## 6.7 Privacy Mode

`PrivacyProvider` (`apps/web/src/components/privacy.tsx`) — React Context:

```typescript
{ enabled: boolean, ready: boolean, error: string, toggle: () => void }
```

- Initialised to `true` (privacy on) to avoid flash on direct navigation.
- Reads from `localStorage` on mount; syncs across tabs via `storage` event.
- `MonetaryValue` renders `••••` when `enabled === true`.
- `MonetaryField` renders a locked placeholder when privacy is on and `sensitive === true`.

No server-side privacy enforcement — this is purely a client-side display toggle. The amount is **not** withheld from the browser: `MonetaryValue` receives the numeric value as its `children` from the server (`components/privacy.tsx:101-107`), so the figure is serialised into the RSC payload / HTML regardless of privacy state. A user who views source or the network tab sees every value; privacy mode only masks the rendered text.

`ARCH-115`

---

## 6.8 Filter System

`FilterBar` (`apps/web/src/components/filter-bar.tsx`) owns the shared filter state:

```typescript
// URL search params → AnalysisFilters
useFilters() → { values, query, timeZone, ... }
```

- Filters stored as URL search params (`?range=30d&symbol=AAPL&...`).
- `FilterBar` is conditionally rendered on `/`, `/reports`, `/trades`, `/calendar`, `/journal`, `/playbooks`, and any `/journal/…` sub-route (`components/filter-bar.tsx:51-53`).
- `useApi` calls re-fetch when URL params change — no client-side cache invalidation needed.

The filter primitives (`FILTER_KEYS`, `readFilters`, `AnalysisFilters`, `dayKeyOf`) are **not** defined in the web app — they come from the `@luxalgo/journal-core` workspace package (`components/filter-bar.tsx:4`, `components/shell.tsx:42`). See §6.12.

`ARCH-116`

---

## 6.9 Theme and Accessibility

- Theme (`ThemeProvider`, `apps/web/src/components/theme.tsx`) initialised via inline `<script>` in `layout.tsx` to prevent flash on dark-mode direct navigation (`THEME_INIT_SCRIPT`).
- Tooltip delay: 350 ms (`TooltipProvider` in `layout.tsx`).
- All interactive elements have `aria-pressed` or `aria-label`.
- Privacy toggle has `role="alert"` for error messages.

`ARCH-117`

---

## 6.10 Component Inventory (key custom components)

| Component | File | Role |
|-----------|------|------|
| `AppSidebar` | `shell.tsx` | Navigation rail + mobile drawer |
| `DashboardLayout` | `dashboard-layout.tsx` | CSS grid arranger |
| `AskJournal` | `ask-journal.tsx` | NL question surface |
| `AiRecap` | `ai-recap.tsx` | Session recap trigger |
| `PrivacyToggle` | `privacy.tsx` | Privacy mode toggle |
| `FilterBar` | `filter-bar.tsx` | Shared filter UI + URL state |
| `CalendarPnl` | `calendar-pnl.tsx` | Monthly P&L calendar |
| `TradeChart` | `trade-chart.tsx` | Per-trade OHLCV chart |
| `AddTradeDialog` | `add-trade-dialog.tsx` | Manual trade entry |
| `AiSettings` | `ai-settings.tsx` | AI provider + key config |
| `ManualTradeEntry` | `manual-trade-entry.tsx` | Single-trade form |

`ARCH-118`

---

## 6.11 Data Flow Diagram

```
User interaction
    ↓
URL param change / form submit
    ↓
useApi(url)  →  acquireJson(url)  →  fetch (no-store)
    ↓
React startTransition → setData / setError
    ↓
Component renders
    ↓ (filter/sort computed in component)
Dashboard widgets / table rows / charts
```

```
AI user action
    ↓
useAiRequest.run(() → postJson("/api/ai/ask", body))
    ↓
POST /api/ai/{ask,recap,critique,reports}
    ↓
server/ai-scope.ts:50  readAiRequest()  → validate + freeze the approved scope
    ↓
server/ai-capabilities.ts:40  askJournalContext()  → read-only context text
    ↓
server/ai-prompts.ts  buildAskJournalPrompt() / buildReportsAgentPrompt() /
                      buildDailyRecapPrompt() / buildTradeCritiquePrompt()
    ↓
server/ai.ts  runAskJournalAi() / runReportsAgentAi() / runAi()
    ↓
server/ai-runtime.ts → provider (Anthropic/OpenAI) → model API
    ↓
ok({ answer, scope })
    ↓
useAiRequest: setBusy(false), accept(result)
    ↓
Component renders answer
```

Note the ordering: `readAiRequest` lives in **`server/ai-scope.ts:50`**, not in `ai-capabilities.ts`. `ai-capabilities.ts` exports the context builders `askJournalContext` (`:40`), `dailyRecapContext` (`:67`), `tradeCritiqueContext` (`:119`), `playbookRulesForTrade` (`:179`), `missedObservations` (`:211`), `notebookEntries` (`:247`), `progressHistory` (`:277`). Prompt construction lives in `server/ai-prompts.ts` (`buildAskJournalPrompt` `:57`, `buildDailyRecapPrompt` `:67`, `buildTradeCritiquePrompt` `:86`, `buildReportsAgentPrompt` `:106`).

`ARCH-119`

---

## 6.12 Workspace Package Boundary

The web app is not self-contained. Two workspace packages supply the domain logic:

| Package | Role | Consumed by |
|---------|------|-------------|
| `@luxalgo/journal-core` | Pure domain engine — round-trip matching, metrics, equity curves, Edge Score, aggregations, filter parsing. No IO, no framework. | `components/filter-bar.tsx:4`, `components/shell.tsx:42`, `app/api/trades/route.ts:1-2`, `server/ai-scope.ts:1-6` |
| `@luxalgo/journal-importers` | Broker file parsers (CSV/XML/PDF statement formats) and history adapters | `app/api/import/route.ts:1-8` |

Both are declared as `workspace:*` dependencies (`apps/web/package.json:20-21`) and are transpiled by Next (`apps/web/next.config.ts:5`). Because `journal-core` is framework-free, the **same** code runs in the browser (via `useFilters`/`readFilters`) and on the server (via `queryTrades`/`computeMetrics`) — the filter contract cannot drift between the two.

`packages/core` is also a published npm package (`@luxalgo/journal-core`, `publishConfig` at `packages/core/package.json:39-51`; `packages/importers/package.json:42`) — see `08` §8.11 for the release pipeline.

`ARCH-120`

---

## 6.13 Desktop (Tauri) Frontend

The same Next.js build is the front end of a second runtime: the Windows **Tauri desktop app** (`desktop/`, a first-class workspace member — `pnpm-workspace.yaml:4`).

| Concern | Detail |
|---------|--------|
| Shell | Tauri 2 webview window, 1400×900, resizable (`desktop/src-tauri/tauri.conf.json`) |
| Dev URL | `http://localhost:3000` — the Tauri dev build points at the separately-running Next dev server (`tauri.conf.json` `build.devUrl`) |
| Prod URL | `http://127.0.0.1:<ephemeral>` — the bundled Next standalone server is spawned as a sidecar with `PORT=0` and the assigned port discovered from stdout (`desktop/src-tauri/src/server.rs:58-70`, `:78-90`) |
| Frontend assets | `frontendDist: ../../apps/web/.next/tauri-dist`, produced by `apps/web/scripts/copy-static-build.js` |
| Data dir | `%APPDATA%\TradeJournal\data` — `JOURNAL_DATA_DIR` is set explicitly on the child process (`desktop/src-tauri/src/server.rs:61`; path resolution `desktop/src-tauri/src/paths.rs:8-16`) |

Consequences for the front end: the desktop app serves the **same** routes and components — no separate UI code path. But the transport is plain `http://127.0.0.1`, so the auth cookie's `secure` flag is never set (the request URL is not HTTPS). See `07` §7.1 and `08` §8.14.

`ARCH-121`

---

## Evidence Register

| ID | Source | Status |
|----|--------|--------|
| ARCH-100 | `apps/web/package.json` | VERIFIED |
| ARCH-101 | `apps/web/package.json:43` (Next 15.5.23), `:45` (React 19.1.0), `:61` (Tailwind 4.3.3), `:36` (CVA), `:16-52` (Radix) | VERIFIED |
| ARCH-102 | `apps/web/package.json:41` (ECharts 6.1.0); `apps/web/src/components/charts/` dir listing | VERIFIED |
| ARCH-103 | `apps/web/src/lib/use-api.ts:14-63` | VERIFIED |
| ARCH-104 | `apps/web/src/components/privacy.tsx:9` | VERIFIED |
| ARCH-105 | `apps/web/next.config.ts:4` | VERIFIED |
| ARCH-106 | `apps/web/src/components/shell.tsx:45-56` (NAV), `:58-62` (NAV_SETUP), `:267-273` (login unwrap) | VERIFIED |
| ARCH-107 | `apps/web/src/lib/api-request.ts:10-43` | VERIFIED |
| ARCH-108 | `apps/web/src/app/` — 16 `page.tsx` files; 14 with `<Suspense>`, `app/login/page.tsx` and `app/trades/[key]/page.tsx` without; `app/layout.tsx:24` | VERIFIED |
| ARCH-109 | `apps/web/src/app/page.tsx:226-800` (widget array), widget labels at `:230,270,293,320,339,392,437,463,487,519,597,623,650,681,702,741`; `components/dashboard-layout.tsx:145,160,175` | VERIFIED |
| ARCH-110 | `apps/web/src/components/ask-journal.tsx:29,37-45,72,93-96`; `apps/web/src/app/api/ai/ask/route.ts` | VERIFIED |
| ARCH-110a | `apps/web/src/app/reports/page.tsx:16,283` — AskJournal mounts on `/reports`, **not** the Dashboard | VERIFIED (corrected) |
| ARCH-110b | `apps/web/src/components/ai-import-options.tsx`; `apps/web/src/app/import/page.tsx:30,347`; `apps/web/src/server/ai-import.ts:203-210` | VERIFIED |
| ARCH-110c | `apps/web/src/server/ai.ts:252-280` (`runAi`, feature `reflection` at `:261`) | VERIFIED |
| ARCH-111 | `apps/web/src/components/ai-recap.tsx:11-29`; `apps/web/src/app/journal/[date]/page.tsx:2,202`; `apps/web/src/app/api/ai/recap/route.ts` | VERIFIED |
| ARCH-112 | `apps/web/src/app/api/ai/critique/route.ts:7-13`; `apps/web/src/app/trades/[key]/page.tsx:151,281,295` | VERIFIED |
| ARCH-113 | `apps/web/src/app/api/ai/reports/route.ts`; `apps/web/src/server/ai.ts:202,310` | VERIFIED |
| ARCH-114 | `apps/web/src/lib/use-ai-request.ts:7-33` | VERIFIED |
| ARCH-115 | `apps/web/src/components/privacy.tsx:9-50,101-107` | VERIFIED |
| ARCH-116 | `apps/web/src/components/filter-bar.tsx:17-43` (filters), `:51-53` (rendered routes) | VERIFIED |
| ARCH-117 | `apps/web/src/app/layout.tsx:20,23`; `apps/web/src/lib/theme.ts:8` | VERIFIED |
| ARCH-118 | `apps/web/src/components/` dir listing | VERIFIED |
| ARCH-119 | `apps/web/src/server/ai-scope.ts:50` (`readAiRequest`), `apps/web/src/server/ai-capabilities.ts:40,67,119,179,211,247,277`, `apps/web/src/server/ai-prompts.ts:57,67,86,106`, `apps/web/src/server/ai.ts:252-330` | VERIFIED — architectural synthesis |
| ARCH-120 | `packages/core/src/index.ts:1-9`; `packages/core/package.json:39-51`; `apps/web/package.json:20-21`; `apps/web/next.config.ts:5` | VERIFIED |
| ARCH-121 | `desktop/src-tauri/tauri.conf.json`; `desktop/src-tauri/src/server.rs:58-70,78-90`; `desktop/src-tauri/src/paths.rs:8-16`; `apps/web/scripts/copy-static-build.js` | VERIFIED |
