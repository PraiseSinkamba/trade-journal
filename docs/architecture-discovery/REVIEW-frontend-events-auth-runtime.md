# Frontend + Events + Auth + Runtime Reports — Review

Reviewed: `06-frontend-architecture.md`, `05-events-and-background-processing.md`,
`07-authentication-and-security.md`, `08-runtime-and-operations.md`
against `E:/4004/orca/trade-journal` working tree (2026-10-21).

Method: every concrete claim re-checked against source. Cited line numbers below are the
**actual** source lines (the reports' own line numbers are frequently off — see Required fix #1).

---

## Overall Verdict

**PASS-WITH-MINOR-FIXES**

The load-bearing architectural claims are correct and verifiable: single-user optional-password
auth, middleware-presence / handler-HMAC split, AES-256-GCM + scrypt KDF, no event bus, no
streaming, no background workers, exact AI policy table, exact CI gate order, telemetry genuinely
absent from the Dockerfile. Nothing in the reports is architecturally misleading.

The defects are concentrated in three classes: (a) **inventories that are wrong or incomplete**
(nav menu, route table, dashboard widget list, AI-surface mount point), (b) **evidence line
references that point at the wrong lines** (systematically off by 2–9 lines), and (c) **two
"VERIFIED" grep claims that are false as written** (ARCH-200 `subscribe`, ARCH-203 setTimeout
lines) plus **one fabricated source reference** (`readAiRequest` attributed to
`ai-capabilities.ts`). One genuine security nuance is understated: the 30-day cookie TTL is
browser-side only, never enforced server-side.

---

## Findings table — 06 Frontend Architecture

| ID | Claim | Report states | Actual source | Status | Notes |
|----|-------|---------------|---------------|--------|-------|
| ARCH-101 | Next.js 15.5.23 / React 19.1.0 / Tailwind 4.3.3 / CVA / Radix | versions | `apps/web/package.json:33,36,39,43,45,62` | CONFIRMED | — |
| ARCH-102 | ECharts 6.1.0 via `components/charts/` | 12 chart wrappers | `apps/web/package.json:39`; `components/charts/` | CONFIRMED | — |
| ARCH-103 | `useApi` — dedupe, abort, `startTransition`, tick-based `refresh` | 4 bullets | `apps/web/src/lib/use-api.ts:13-64` | CONFIRMED | Code matches prose exactly. |
| ARCH-104 | State = `PrivacyContext` + local `useState` | — | `apps/web/src/components/privacy.tsx:9` | CONFIRMED | — |
| ARCH-105 | `output: "standalone"` | `next.config.ts:3` | `apps/web/next.config.ts:4` | PARTIALLY | Value correct; cited line is the `const` declaration. |
| ARCH-106 | Shell is a client component; `/login` unwrapped | — | `components/shell.tsx:1`, `:262-273` | CONFIRMED | `if (pathname === "/login") return <>{children}</>;` |
| ARCH-106a | Nav = Dashboard \| Trades \| Trade Explorer \| Calendar \| Journal \| Playbooks \| Import \| Reports \| Settings | 9 items | `components/shell.tsx:45-61` | **WRONG** | Actual: Dashboard, Calendar, **Daily journal**, Trades, Reports, **Prop firms**, **Notebook**, Playbooks, **Progress**, **Missed trades** + SETUP: Import, **Accounts**, Settings. "Trade Explorer" is **not** in the nav (it is a component `components/trade-explorer.tsx` + `/api/trade-explorer`). 4 nav items and 1 setup item missing. |
| ARCH-107 | `acquireJson` shares GETs, `queueMicrotask` aborts at zero users, `cache: "no-store"` | — | `lib/api-request.ts:10-43` | CONFIRMED | — |
| ARCH-108 | All pages Suspense-wrapped; outer layout also Suspense | "All pages" | `app/layout.tsx:24` ✓; pages with Suspense = 14 of 16 | **WRONG** | `app/login/page.tsx` and `app/trades/[key]/page.tsx` contain **no** `Suspense`. |
| ARCH-108a | Route table (11 routes) | 11 rows | 16 `page.tsx` files exist | **WRONG (incomplete)** | Missing: `/accounts`, `/missed`, `/notebook`, `/progress`, `/prop-firms`. |
| ARCH-109 | Dashboard widget array, `DashboardLayout` grid, `localStorage` layout | — | `app/page.tsx:226-800`, `components/dashboard-layout.tsx:131,162` | PARTIALLY | 16 widgets. See ARCH-109a. |
| ARCH-109a | Widgets: "Net P&L, Win %, Profit Factor, **R:Ratio, R multiples**, Calendar heatmap, Equity area, Daily bars, **Edge radar**, Win rate by weekday/-symbol/duration/hour/direction buckets" | list | `app/page.tsx:230,270,293,320,339,392,437,463,487,519,597,623,650,681,702,741` | **WRONG** | Actual labels: Net P&L, Trade win %, Profit factor, Day win %, Avg win / loss, Edge Score, Cumulative P&L, Daily P&L, Calendar, Activity, Max drawdown, Streaks, Expectancy / trade, Avg duration, Best / worst day, Trade time performance. "R:Ratio" / "R multiples" / "Edge radar" are **not** widget labels. The weekday/symbol/hour/duration/direction buckets exist in the **stats payload** (`app/page.tsx:67`), not as widgets — payload shape conflated with widget list. |
| ARCH-110 | `AskJournal` — POST `/api/ai/ask`, `useAiRequest`, no streaming, "Thinking…" | — | `components/ask-journal.tsx:37-45,72,96` | CONFIRMED | Body `{question, filters, timeZone}` ✓, response `{answer, scope}` ✓, "Thinking…" ✓. |
| ARCH-110a | AskJournal is **"Embedded on the Dashboard (`/`) page as a card widget"** | Dashboard | `app/reports/page.tsx:16,283` | **WRONG** | Mounted on **`/reports`**, not `/`. `app/page.tsx` never imports `AskJournal` (grep over `app/` returns only `reports/page.tsx`). |
| ARCH-111 | `AiRecap` on `/journal/[date]`, props `date/filters/timeZone/disabled/onRecap` | — | `components/ai-recap.tsx:11-29`; `app/journal/[date]/page.tsx:2,202` | CONFIRMED | — |
| ARCH-112 | Critique → POST `/api/ai/critique {key}` → `{critique}`, inline on `/trades/[key]` | — | `app/api/ai/critique/route.ts:7-13`; `app/trades/[key]/page.tsx:151,281,295` | CONFIRMED | — |
| ARCH-113 | Reports agent uses `runReportsAgentAi` with `switch_report_mode` | — | `app/api/ai/reports/route.ts:8`; `server/ai.ts:202,310` | CONFIRMED | — |
| ARCH-114 | `useAiRequest` — `active.current` stale guard, `pending.current` serialiser | code block | `lib/use-ai-request.ts:7-33` | CONFIRMED | Snippet matches source verbatim. `active` is set in `useLayoutEffect` (mount) and cleared on unmount. |
| ARCH-115 | `PrivacyProvider` — init `true`, `localStorage`, `storage` event, `••••` | — | `components/privacy.tsx:15-50,100-113` | CONFIRMED | — |
| ARCH-115a | "No server-side privacy enforcement — purely a client-side display toggle. Any user can open DevTools and see network responses." | caveat | `components/privacy.tsx:100-113` | PARTIALLY | Understated: `MonetaryValue` receives its value as `children` from the server, so the numeric amount is **serialised into the RSC payload / HTML** regardless of privacy state — not merely visible in a network tab. Strengthen the caveat. |
| ARCH-116 | Filters in URL params; `useFilters` → `{values, query, timeZone, …}` | — | `components/filter-bar.tsx:17-43` | CONFIRMED | — |
| ARCH-116a | "FilterBar conditionally rendered on dashboard, trades, calendar, journal, playbooks" | 5 routes | `components/filter-bar.tsx:48-50` | PARTIALLY | Actual: `["/","/reports","/trades","/calendar","/journal","/playbooks"]` **plus** `pathname.startsWith("/journal/")`. `/reports` omitted. |
| ARCH-117 | Theme init script in `layout.tsx`; tooltip delay 350 ms | — | `app/layout.tsx:20,23`; `lib/theme.ts:8` | CONFIRMED | — |
| ARCH-118 | Component inventory (11 files) | — | `components/` — all 11 exist | CONFIRMED | `trade-chart.tsx` is consumed by `components/trade-market-data.tsx:18,342`, not directly by `/trades/[key]`. |
| ARCH-119 | AI flow diagram: `server/ai-capabilities.ts → readAiRequest() → frozen scope` | diagram | `server/ai-scope.ts:50` (`readAiRequest`), `server/ai-capabilities.ts:40` (`askJournalContext`) | **WRONG** | `readAiRequest` lives in **`server/ai-scope.ts`**, not `ai-capabilities.ts`. `ai-capabilities.ts` exports `askJournalContext`, `dailyRecapContext`, `tradeCritiqueContext`, `playbookRulesForTrade`, `missedObservations`, `notebookEntries`, `progressHistory`. Diagram also omits `ai-scope.ts` and `ai-prompts.ts` from the chain. |
| ARCH-119a | `useAutosave` — "keepalive for bodies under 50 KB **on beforeunload**" | — | `lib/use-autosave.ts:22` | PARTIALLY | `keepalive: JSON.stringify(body).length < 50000` is set on **every** autosave POST, not only during `beforeunload`; `beforeunload` merely triggers `flush()` (`:53-56`). Length is measured in JS string chars, not bytes. |

---

## Findings table — 05 Events and Background Processing

| ID | Claim | Report states | Actual source | Status | Notes |
|----|-------|---------------|---------------|--------|-------|
| ARCH-200 | "Grep `EventEmitter\|addListener\|dispatch\|subscribe\|process\.on` … returns **zero hits**" | zero hits | `apps/web/src/components/charts/tokens.ts:50` — `function subscribeTokens(listener: () => void)` | **WRONG (as written)** | Counterexample: a real pub/sub listener registry (`listeners` Set + `useSyncExternalStore`) exists at `components/charts/tokens.ts:49-74`. It is a design-token subscription, **not** a domain event bus — so the *conclusion* ("no event bus") stands, but the stated evidence is false. Fix the grep or the claim. |
| ARCH-200a | No `EventEmitter`, `worker_threads`, `bullmq`, `pg-boss`, `streamText`, `ReadableStream` in the app | zero hits | repo-wide grep (ts/tsx/json/mjs, excl. `node_modules`): no hits in `apps/`, `packages/`, `scripts/`. `WebSocket` only in `.omp/mcp.json:3,21` (dev tooling, not app code) | CONFIRMED | Scope caveat: the Rust `desktop/src-tauri` tree was not scanned. |
| ARCH-201 | `setInterval` only at `components/trade-market-data.tsx:369` (animation) | 1 hit | `trade-market-data.tsx:369` ✓; no other `setInterval` in `apps/web/src` | CONFIRMED | Exact line match. |
| ARCH-202 | `useAutosave` — 500 ms debounce → PATCH `/api/notes/{id}` | — | `lib/use-autosave.ts:78` (`setTimeout(..., 500)`), `:7` (method default PATCH) | CONFIRMED | The report's citation `use-autosave.ts:10` points at the interface, not the debounce. |
| ARCH-203 | `setTimeout` at `server/market-data/transport.ts:16,22,33`; 6 concurrent, max 2/host, 64-queue depth | 3 line refs | `transport.ts:39` is the only `setTimeout` call. `:16` = `let wake: ReturnType<typeof setTimeout>` (type only), `:22` = `for` loop, `:33` = `queue.splice` | **WRONG (line refs)** | The **numbers** are correct: `running < 6 && active.get(host) < 2` at `:27`; `queue.length >= 64` at `:44`. Undocumented: per-host `minIntervalMs = 350` (`:9,34`). |
| ARCH-204 | No `streamText`, `ReadableStream`, `WebSocket`, `EventSource`, `createEventBus`; all AI routes buffered | zero hits | grep: zero hits. All 4 AI routes return `ok({...})` (`server/api.ts:10-14`) | CONFIRMED | — |
| ARCH-205 | `runTextAi` non-streaming | — | `server/ai-runtime.ts:130-160` (`generateText`, no `streamText`) | CONFIRMED | — |
| ARCH-206 | All trade writes inside `db.transaction(...)` | — | `server/executions.ts`; `app/api/trades/route.ts` | PARTIALLY | `db.transaction` blocks are confirmed in `db/index.ts:44-51,59-...` and in execution write paths. The specific claim that **all** write operations in `app/api/trades/route.ts` are transactional was not individually re-verified line-by-line. |
| ARCH-207 | No `cron`, `setInterval` (other than animation), `EventEmitter`, worker threads | — | grep: zero hits | CONFIRMED | — |
| ARCH-200b | "No event bus, message queue, or pub/sub system exists **anywhere in the codebase**" | absolute | `components/charts/tokens.ts:50` (`subscribeTokens`); `lib/api-request.ts` subscriber ref-counting; `server/market-data/transport.ts` job queue | **WRONG (absolute wording)** | "No *domain* event bus" is true. "Anywhere in the codebase" is false. Soften to "no domain event bus / message broker". |

---

## Findings table — 07 Authentication and Security

| ID | Claim | Report states | Actual source | Status | Notes |
|----|-------|---------------|---------------|--------|-------|
| ARCH-301 | Single-user, optional-by-design | quote | `server/auth.ts:4-6` | CONFIRMED | Report cites `auth.ts:2-4`; the quote is at `:4-6`. |
| ARCH-302 | `JOURNAL_PASSWORD` unset ⇒ no auth; set ⇒ login required | — | `server/auth.ts:10`; `middleware.ts:10`; `server/api.ts:27` | CONFIRMED | — |
| ARCH-303 | `sessionToken()` = HMAC-SHA256 over `"session-v1"`; rotating password invalidates sessions | — | `server/auth.ts:12-15` | CONFIRMED | Report cites `:10-12`; actual `:12-15`. |
| ARCH-303a | "Constant-time comparison via `timingSafeEqual` for both password verification and session validation" | — | `server/auth.ts:20,28` | PARTIALLY | `timingSafeEqual` is used, but **both** call sites are guarded by `expected.length === given.length &&` — a length check that short-circuits before the constant-time compare. This is standard practice (avoids throwing on unequal lengths) but the report's "constant-time" claim should note the length gate. |
| ARCH-304 | Cookie: `httpOnly`, `sameSite: "lax"`, `secure` iff https, `path: "/"`, `maxAge` 30 days | code block cited at `server/auth.ts:18-24` | `app/api/auth/route.ts:12-18` | **WRONG (file attribution)** | The cookie code is in **`app/api/auth/route.ts`**, not `server/auth.ts`. `server/auth.ts:18-24` is `verifyPassword`/`verifySession`. Values themselves all confirmed. |
| ARCH-305 | Middleware checks cookie **presence** only; runs on Edge, cannot call `crypto.createHmac` | — | `middleware.ts:10-20` (presence check) | CONFIRMED (code) / INFERRED (Edge rationale) | The Edge/no-Node-crypto rationale is the **codebase's own comment** (`middleware.ts:4-7`), not an independently verified fact — and it is not strictly true for Next 15.5, which supports a Node.js middleware runtime. Demote to INFERRED, or reword as "the author chose not to import `node:crypto` into middleware". |
| ARCH-306 | `handler()` wrapper performs HMAC session verification per route | — | `server/api.ts:27-30` | CONFIRMED | Report cites `:18-21`; actual `:27-30`. |
| ARCH-307 | Every route handler wrapped in `handler(...)`; only `/api/auth` is `public: true` | — | scan of all `app/api/**/route.ts`: **zero** files without `handler(`; `public: true` appears only at `app/api/auth/route.ts:21` | CONFIRMED | Independently re-verified. |
| ARCH-308 | `resolveAiConfiguration()` → env key, else saved encrypted key, else `null` | signature `{provider, model, apiKey}` | `server/settings.ts:119-129` — returns `{ provider, modelId, apiKey }` | PARTIALLY | Ordering confirmed (`settings.ts:65-67` env first, then `${provider}KeyEnc`). The quoted **property name is `modelId`, not `model`** — a wrong quoted signature. |
| ARCH-309 | AES-256-GCM, 12-byte random IV, `scryptSync(JOURNAL_SECRET, "luxalgo-trade-journal", 32)`, `.secret` fallback mode `0o600` | — | `server/crypto.ts:12-22` (KDF), `:24-35` (encryptJson) | CONFIRMED | Report cites `crypto.ts:17-27` / `:7-16`; actual `:24-35` / `:12-22`. |
| ARCH-310 | Key flow: PATCH `/api/settings {anthropicKey}` → `setAiKey` → `encryptJson` → `db.update(settings).where(eq(settings.key,"anthropicKey")).run()` | — | `app/api/settings/route.ts:133-134`; `server/settings.ts:77-80` → `setSetting(`${provider}KeyEnc`, encryptJson(key.trim()))` → `settings.ts:24-29` `db.insert(...).onConflictDoUpdate(...)` | **WRONG** | Two errors: the settings **row key is `anthropicKeyEnc`**, not `anthropicKey`; and the write is an **upsert via `setSetting`**, not `db.update(...).run()`. |
| ARCH-311 | `store: false` on all OpenAI calls; provider errors mapped to safe categories; raw provider text never relayed | — | `server/ai-runtime.ts:145,199,262,304`; `mapAiRuntimeError` `:66-111` | CONFIRMED | All four OpenAI call sites set `providerOptions.openai.store = false`; the `provider` fallback at `:106-109` uses a fixed message. |
| ARCH-312 | Credential exposure table | — | `server/settings.ts`, `crypto.ts`, `auth.ts` | CONFIRMED | — |
| ARCH-313 | "No explicit redaction found in API handlers… error paths must be audited" | INFERRED | `server/api.ts:33` returns `error.message` verbatim for non-`RequestError` throws | CONFIRMED as INFERRED | Correctly tagged. Note the concrete leak vector: any non-`RequestError` exception (e.g. a SQLite error string) is returned to the client in the JSON body. Worth an explicit bullet. |
| ARCH-314 | `handler` catch → `{error: message}`, 400 for `RequestError`, 500 otherwise; no stack traces | — | `server/api.ts:32-38` | CONFIRMED | Report cites `:22-31`; actual `:32-38`. |
| ARCH-315 | Static analysis table (7 invariants) | — | see rows above | CONFIRMED overall | Two sub-rows need re-basing: `middleware.ts:6` → `:10`; `auth.ts:14,22` → `:20,28`; `crypto.ts:9` → `:14`. |
| ARCH-315a | "Session: httpOnly cookie, **30-day TTL**" (security summary box §7.8) | server-enforced TTL implied | `server/auth.ts:23-29` `verifySession` has **no expiry check**; `app/api/auth/route.ts:17` `maxAge` is browser-enforced only | **WRONG (security-relevant)** | A stolen/captured cookie is valid **indefinitely** server-side (until `JOURNAL_PASSWORD` changes). There is no server-side session expiry. Restate as "30-day **browser** cookie maxAge; no server-side expiry enforcement". |
| ARCH-315b | "No API key in URL params or logs" | INFERRED | `server/settings.ts:119-129` | CONFIRMED as INFERRED | Correctly scoped. |
| ARCH-315c | "`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` not stored" | VERIFIED | `server/settings.ts:59-67` | PARTIALLY | Env vars are *not persisted*, true — but a saved key is still written to the DB even when an env var is present (`setAiKey` is unconditional), so "not stored" overstates. |

---

## Findings table — 08 Runtime and Operations

| ID | Claim | Report states | Actual source | Status | Notes |
|----|-------|---------------|---------------|--------|-------|
| ARCH-400 | Node `>= 22`; pnpm 11.0.8; ESM; Next 15.5.23 + Turbopack; standalone | `package.json:8-9` | `package.json:10-13` (`engines`, `packageManager`); `apps/web/package.json:5,7,43` | CONFIRMED | Line refs off by ~2-4. `Dockerfile:2,13` = `node:22-slim` (both stages). |
| ARCH-401 | `"type": "module"` in `apps/web/package.json` | `:5` | `:5` | CONFIRMED | — |
| ARCH-402 | Multi-stage Docker, non-root `node`, `/data` volume, no baked-in secrets | quoted block | `Dockerfile:2,13,22,23` | CONFIRMED | The report's quoted Dockerfile **omits** `ENV PORT=3000 HOSTNAME=0.0.0.0` (`Dockerfile:25`) — which §8.3 later relies on. Add it to the quote. |
| ARCH-403 | `docker-compose.yml` — ports, volume, env, `restart: unless-stopped` | quoted block | `docker-compose.yml:1-14` | CONFIRMED | Quoted env key order differs from the file (cosmetic). |
| ARCH-404 | `JOURNAL_DATA_DIR` default "`./data` (dev), `/data` (Docker)" | table | `apps/web/src/db/index.ts:8` — `process.env.JOURNAL_DATA_DIR ?? "/data/trade-journal"` | **WRONG** | The **code** default is `/data/trade-journal` — an absolute POSIX path, on **all** platforms, not just Docker. The report copied `.env.example:10` ("Default: ./data"), which contradicts the code. On Windows dev without `JOURNAL_DATA_DIR`, the DB lands in `C:\data\trade-journal`. This is a real, user-visible inconsistency worth a dedicated finding. |
| ARCH-404a | `NEXT_TELEMETRY_DISABLED` — "Not set in Docker"; "**recommended in the docker-compose comments** but not enforced" | §8.3 + §8.7 | repo-wide grep: **zero** hits in `Dockerfile`, `docker-compose.yml`, `.env.example` | PARTIALLY | The *primary* claim (not set in the Dockerfile) is CONFIRMED. The secondary claim is **WRONG**: `docker-compose.yml` contains **no** `NEXT_TELEMETRY_DISABLED` comment (only `JOURNAL_PASSWORD` and `JOURNAL_SECRET` comments, `:9-12`). See ARCH-409. |
| ARCH-405 | better-sqlite3 ^12.2.0; Drizzle ^0.45.2; WAL; `FOREIGN_KEYS=ON`; `{DATA_DIR}/journal.db` | — | `apps/web/package.json:35,40`; `db/index.ts:34,36,38,97-100` | CONFIRMED | "WAL — **default SQLite**" is a mislabel: WAL is *not* SQLite's default (default is `delete`); the code sets it explicitly. |
| ARCH-405a | "Migrations: Not confirmed (no `drizzle-kit` config observed)" | UNVERIFIED | `db/index.ts:39` (`sqlite.exec(BOOTSTRAP_SQL)`), `:40-56` (additive `ALTER TABLE` upgrades) | CONFIRMED as UNVERIFIED | Correctly tagged. The `ALTER TABLE` blocks in `createDb` are effectively a hand-rolled migration path and should be named. |
| ARCH-406 | Single Node process, one WAL writer, no pooling | — | `Dockerfile:26`; `db/index.ts:81-100` | CONFIRMED | — |
| ARCH-407 | AI policies: reflection 1200/2; ask 1200/2/30 s/4×4; reports 1200/2/30 s/4×4; import 32000/0/120 s | table | `server/ai-contracts.ts:41-58` | CONFIRMED | **All values exact.** |
| ARCH-407a | `statementImport` — "Tool loop: **Yes**" | table | `server/ai-contracts.ts:57` (no `maxSteps`/`maxToolCalls`); `ai-runtime.ts:45-53` `ObjectAiRequest` has **no** `createTools` | **WRONG** | `statementImport` runs `runObjectAi` → `generateText` with an `output` schema. There is **no tool loop**. Change to "No". |
| ARCH-408 | No streaming for any AI feature | — | `ai-runtime.ts:130-313`; 4 AI routes return `ok({...})` | CONFIRMED | — |
| ARCH-409 | Next.js telemetry not disabled in the Docker image | INFERRED | `Dockerfile` — no `NEXT_TELEMETRY_DISABLED` ✓ | CONFIRMED (fact) / INFERRED (severity) | **Escalate.** `AGENTS.md:260` states: *"**No telemetry:** `NEXT_TELEMETRY_DISABLED=1` in the Dockerfile"*, and `.omp/hooks/pre/telemetry-guard.ts:7` asserts *"The project ships with NEXT_TELEMETRY_DISABLED=1"*. The Dockerfile does **not**. This is a **documented project invariant that the code violates**, not a "recommended" nicety. The report must say so. |
| ARCH-410 | No application-level rate limiting; no rate-limit dependency | — | `apps/web/package.json:12-52`, root `package.json:28-34` — no rate-limit dep | CONFIRMED | Note: the market-data transport's 6/2/64 limits and the `minIntervalMs = 350` throttle **are** a rate limit, but of the outbound provider, not of inbound requests. Consider stating that distinction. |
| ARCH-411 | No background workers, cron, or daemons; all synchronous | — | grep `setInterval\|cron\|worker_threads` → zero hits in `apps/web/src` | CONFIRMED | — |
| ARCH-411a | "Broker sync (ctrader MCP) → HTTP POST → sync broker API call → return" | §8.9 | `server/ctrader-mcp/client.ts:21-31` — MCP **JSON-RPC over HTTP transport** to a `remote`/`local` endpoint, via `createMCPClient` | PARTIALLY | It is an MCP tool call over HTTP, not a plain broker HTTP POST. Also, `mode: "local"` implies an **external local MCP server process** — worth one line so "no background processes" is not read as "the app never talks to another process". |
| ARCH-412 | DB opened lazily on first use; schema via `BOOTSTRAP_SQL`; no migration runner | — | `db/index.ts:81` — `export const db = (() => { … })()` | PARTIALLY | The DB is opened in a **module-level IIFE** at import time, not via a `db.open()` call on first request (the report's `db.open()` is a non-existent symbol). `BOOTSTRAP_SQL` + `ALTER TABLE` upgrades are confirmed (`:39-56`). |
| ARCH-413 | CI gates: install → format:check → typecheck → test → check-licenses → packages build → web build | code block | `.github/workflows/ci.yml:19-25` | CONFIRMED | **Exact order, exact commands.** Best-verified claim in the four reports. |
| ARCH-413a | "No security scanning (npm audit, SARIF), no Lighthouse CI" | — | `ci.yml` — none; `release.yml` — none | CONFIRMED | But see ARCH-413b. |
| ARCH-413b | Only `ci.yml` described | §8.11 | `.github/workflows/release.yml` exists — `workflow_dispatch` npm publish of `@luxalgo/journal-core` + `@luxalgo/journal-importers` via **OIDC trusted publishing**, `id-token: write` | INSUFFICIENT-EVIDENCE (coverage) | The reports never mention the release workflow, npm provenance, or the published-package contract. Required read: `.github/workflows/release.yml:1-41`. |
| ARCH-414 | Hosting constraints incl. "No health endpoint" | — | `app/api/` contains no `health` route ✓; `Dockerfile:25-26`; `next.config.ts:4` | CONFIRMED | The `NEXT_UNSTABLE，预防` fragment (§8.12) is a **garbled token** — appears to be a truncated `NEXT_UNSTABLE_*` reference and is not present in the codebase. Delete it. |
| ARCH-415 | better-sqlite3 sync; ECharts canvas; bundle size UNVERIFIED; token budgets | — | `package.json:35,39`; `ai-contracts.ts:42,57` | CONFIRMED | "Large trade histories passed as structured text (not raw rows)" is an assertion about `server/ai.ts` context builders that was **not** verified here — read `server/ai.ts:40-260` before keeping it. |
| ARCH-415a | Deployment/runtime story = Docker + Next only | §8.1-8.2 | `pnpm-workspace.yaml:4` lists `"desktop"`; `desktop/src-tauri/src/server.rs:61` sets `.env("JOURNAL_DATA_DIR", journal_data_dir.clone())` and spawns `node apps/web/server.js` on `127.0.0.1` with a random port (`PORT=0`, `NODE_ENV=production`, readiness regex `server-ready`) | **WRONG (incomplete)** | A **Tauri desktop app is a first-class workspace member** and is absent from all four reports. It **bundles and spawns the Next standalone server as a child process** — a second, non-Docker runtime with its own `JOURNAL_DATA_DIR`, bound to loopback with a dynamic port. `08` §8.1-8.2 presents the Docker image as *the* deployment story. Required read: `desktop/src-tauri/src/server.rs`, `desktop/package.json`, `desktop/README.md`. |

---

## Cross-document consistency

- **Contradiction: telemetry.** `08` §8.3/§8.7 treats `NEXT_TELEMETRY_DISABLED` as an optional "recommendation"; `AGENTS.md:260` treats it as a shipped invariant ("**No telemetry:** `NEXT_TELEMETRY_DISABLED=1` in the Dockerfile"). The reports mirror the weaker framing and miss a live policy violation.
- **Contradiction: data directory.** `08` §8.3 says default `./data` (dev). `apps/web/src/db/index.ts:8` says `/data/trade-journal`. `.env.example:10` says `./data`. Three-way inconsistency; the report picked the one that matches neither the code nor the Docker image.
- **Contradiction: `JOURNAL_DATA_DIR` vs `crypto.ts` fallback.** `07` §7.4 places the `.secret` file "in data directory" ✓ consistent with `crypto.ts:15-16` — but only if `JOURNAL_DATA_DIR` and the DB path agree. They do (both use `dataDir()`), so this is fine. No action.
- **Contradiction: statement import tool loop.** `08` §8.5 says `statementImport` has a tool loop; `ai-runtime.ts:45-53` shows `ObjectAiRequest` has no tools. Internal to `08`.
- **Contradiction: AI surfaces.** `06` §6.6 lists 4 AI surfaces and places AskJournal on the Dashboard; `06`'s own §6.4 route table shows `/reports` exists but has no AI mount. The mount is on `/reports` (`app/reports/page.tsx:283`) — the report contradicts itself here.
- **Contradiction: "no pub/sub anywhere".** `05` §5.1 asserts zero `subscribe` matches; `components/charts/tokens.ts:50` is a subscribe-based store. `05` §5.6 repeats the absolute claim.
- **Consistent:** no streaming — `05` §5.3, `08` §8.6, and the AI routes all agree ✓.
- **Consistent:** no background workers — `05` §5.6, `08` §8.9, `08` ARCH-411 agree ✓.
- **Consistent:** single-user / no multi-tenancy — `07` §7.1, §7.8, and the schema (zero `userId`/`user_id` hits across `apps/web/src` and `packages/`) agree ✓.
- **Consistent:** `08` §8.5 AI policies and `05` §5.3 non-streaming are consistent with `ai-runtime.ts` ✓.
- **Inconsistent citation style:** `06`/`07`/`08` cite line numbers that are off by 2–9 lines in ~15 places; `05` cites correct lines in 4 of 7 cases. The `06`/`07`/`08` line references look machine-generated and never re-read against the file.

---

## Gaps in coverage (spec sections 6, 7, 9, 10)

**§6 Frontend**
1. **Tauri desktop app** (`desktop/`, `desktop/src-tauri/`) is entirely absent from `06` and `08`. `pnpm-workspace.yaml:4` includes it; the root `package.json:24-25` has `desktop:build` / `desktop:build:debug` scripts. If the desktop app is a supported runtime, `08`'s entire "Node.js runtime / Docker deployment" story is one of **two** deployment targets, not the only one.
2. **5 of 16 routes missing** from `06` §6.4 (`/accounts`, `/missed`, `/notebook`, `/progress`, `/prop-firms`) and 5 of 13 nav entries missing from §6.2.
3. **Non-dashboard AI surfaces missing from §6.6**: AI statement import (`components/ai-import-options.tsx`, `server/ai-import.ts`) and the notebook/journal reflection path (`server/ai.ts:252-280`, feature `reflection`) are never listed, even though `08` §8.5 prices the `reflection` policy.
4. **No `packages/core` / `packages/importers` boundary** in `06` — `useFilters`/`readFilters`/`AnalysisFilters` all come from `@luxalgo/journal-core` (`filter-bar.tsx:4`), which `06` treats as an opaque import.
5. **Client-side data boundary** (`packages/core` → `apps/web`) is the single most important frontend architectural fact and is unstated.

**§7 Events/background**
6. Grep scope was `apps/web/src` only. `packages/`, `scripts/`, and `desktop/src-tauri` (Rust — could use threads/channels) were not scanned.
7. The market-data transport's **cache** (`transport.ts:10`, TTL + byte budget) is not described, though it is the only persistent-ish state in the app.
8. `server/market-data/transport.ts` shares its `Flight`/ref-count pattern with `lib/api-request.ts` — the duplicated abort/dedup idiom is not mentioned.

**§9 Auth/security**
9. **No server-side session expiry** — the real session model (indefinitely-valid HMAC cookie) is not analysed; `07` §7.8 says "30-day TTL".
10. **CSRF**: `sameSite: "lax"` is stated but never *assessed*. All mutating routes are `POST`/`PATCH`/`DELETE` with `Content-Type: application/json`; there is no origin check, no CSRF token, and `middleware.ts` gates by cookie *presence* only. This is a control worth an explicit verdict, not a bullet.
11. **Rate limiting / brute force** on `POST /api/auth` — unbounded password attempts. `08` §8.8 says "no application-level rate limiting"; `07` never connects that to the login endpoint.
12. `secure: request.url.protocol === "https:"` — behind a TLS-terminating reverse proxy the request URL may be `http:`, silently downgrading the cookie to non-`Secure`. `07` §7.1 mentions the mechanism but not the proxy caveat.
13. **Secret rotation**: `JOURNAL_SECRET` change re-derives the AES key and makes stored credentials undecryptable (`decryptJson` → `Malformed credential envelope`/auth-tag failure) with no migration path. `07` §7.4 covers the `.secret` fallback but not rotation failure mode.
14. `middleware.ts` `config.matcher` (`/((?!_next/static|_next/image|favicon.ico).*)`) is not mentioned in `07` §7.2.

**§10 Runtime/ops**
15. **Release workflow** (`.github/workflows/release.yml`, OIDC npm publish of the two public packages) is absent.
16. **No `docker-compose` healthcheck, no `restart` semantics, no log/rotation policy, no image pinning (`node:22-slim` is a floating tag, not `@sha256:…`)** — `08` §8.2 calls the image "multi-stage, non-root" but never notes the unpinned base tag.
17. **No `NEXT_TELEMETRY_DISABLED`** against the repo's own stated invariant (see ARCH-409).
18. **`JOURNAL_DATA_DIR` default mismatch** (see ARCH-404) — a live dev-environment defect, not just a doc error. The wrong default (`./data`) is repeated in **three** places: `.env.example:10`, `apps/web/src/lib/export-format.ts:13` ("JOURNAL_DATA_DIR, default ./data"), and `08` §8.3 — against the code's `/data/trade-journal` (`db/index.ts:8`). The desktop app overrides it explicitly (`desktop/src-tauri/src/server.rs:61`), so only the bare `pnpm dev` path is affected.
19. **No `drizzle-kit`** is correct, but the *actual* migration mechanism (`BOOTSTRAP_SQL` + hand-written `ALTER TABLE` in `db/index.ts:40-56`) is never named, and it mutates schema **outside** a transaction guard in two places (`:41-43`, `:53-56`) while `:44-51` and `:59-…` are transactional.
20. **`busy_timeout = 5000`** (`db/index.ts:37`) and WAL checkpointing on directory change (`:86`) are operational facts `08` §8.4/§8.13 omits.
21. **Docker/Next `HOSTNAME`**: `Dockerfile:25` sets `HOSTNAME=0.0.0.0`; `08` §8.3 lists it as a "Next.js built-in" — it is not a Next.js built-in, it is consumed by the standalone server.
22. **Desktop/Tauri runtime** (item 1) — also a §10 gap: no Rust/Node split, no IPC contract, no update path.

---

## Required fixes (ordered)

1. **Re-anchor every line citation** in `06`, `07`, `08` against the actual files. Currently ~15 references point at the wrong line (`auth.ts:18-24` → `app/api/auth/route.ts:12-18`; `crypto.ts:17-27` → `:24-35`; `api.ts:18-21` → `:27-30`; `next.config.ts:3` → `:4`; `package.json:8-9` → `:10-13`; `transport.ts:16,22,33` → `:39`; `use-autosave.ts:10` → `:78`; `middleware.ts:6` → `:10`; `auth.ts:14,22` → `:20,28`; `crypto.ts:9` → `:14`; `Dockerfile:14` → `:2,13`). An evidence register whose line numbers are wrong is not an evidence register.
2. **`07` §7.4 (ARCH-310): correct the AI-key storage flow.** Row key is `anthropicKeyEnc`/`openaiKeyEnc`, written by `setSetting()` → `db.insert(...).onConflictDoUpdate(...)` (`server/settings.ts:77-80`, `:24-29`) — **not** `db.update(...).run()` on `anthropicKey`.
3. **`07` §7.2 (ARCH-304): move the cookie code citation** from `server/auth.ts:18-24` to `app/api/auth/route.ts:12-18`.
4. **`07` §7.8 (ARCH-315a): state that there is no server-side session expiry.** `verifySession` (`server/auth.ts:23-29`) checks only the HMAC; `maxAge: 60*60*24*30` is browser-enforced. Replace "30-day TTL" with "30-day browser cookie maxAge; session remains valid server-side until the password changes".
5. **`08` §8.3/§8.7 (ARCH-404a, ARCH-409): correct the telemetry finding.** `NEXT_TELEMETRY_DISABLED` is not in `docker-compose.yml` (delete "recommended in the docker-compose comments") and its absence contradicts `AGENTS.md:260` — escalate from "recommendation" to a **policy violation of the repo's own documented invariant**, and cite `AGENTS.md:260` and `.omp/hooks/pre/telemetry-guard.ts:7`.
6. **`08` §8.3 (ARCH-404): correct the `JOURNAL_DATA_DIR` default** to `/data/trade-journal` (`db/index.ts:8`) and flag the divergence from `.env.example:10` and the Windows-dev consequence.
7. **`06` §6.2/§6.4: fix the nav and route inventories.** Replace with the actual `NAV`/`NAV_SETUP` arrays (`components/shell.tsx:45-61`) and all 16 routes; remove "Trade Explorer" from the nav (it is a component, not a nav entry).
8. **`06` §6.6 (ARCH-110a): correct the AskJournal mount** to `app/reports/page.tsx:283` (`/reports`), not the Dashboard.
9. **`05` §5.1/§5.6 (ARCH-200, ARCH-200b): fix the false grep claim.** `subscribe` **does** match (`components/charts/tokens.ts:50`, `subscribeTokens`). Restate as "no **domain** event bus / message broker"; cite the counterexample rather than claiming zero hits.
10. **`05` §5.2 (ARCH-203): fix the setTimeout citations** to `server/market-data/transport.ts:39` and add the undocumented `minIntervalMs = 350` per-host throttle.
11. **`08` §8.5 (ARCH-407a): `statementImport` has no tool loop** — `ObjectAiRequest` (`ai-runtime.ts:45-53`) has no `createTools`; change the cell to "No".
12. **`06` §6.11 (ARCH-119): fix the flow diagram** — `readAiRequest` is in `server/ai-scope.ts:50`, not `server/ai-capabilities.ts`; add `ai-scope.ts` and `ai-prompts.ts` to the chain.
13. **`06` §6.4 (ARCH-108): correct "All pages are Suspense-wrapped"** — 14 of 16; `app/login/page.tsx` and `app/trades/[key]/page.tsx` have none.
14. **`06` §6.5 (ARCH-109a): correct the widget list** to the 16 actual labels from `app/page.tsx`; move the weekday/symbol/hour/duration/direction buckets to the stats-payload description, not the widget list.
15. **`07` ARCH-308: fix the quoted `resolveAiConfiguration` signature** — the field is `modelId`, not `model` (`server/settings.ts:119-122`).
16. **`08` §8.12 (ARCH-414): delete the garbled `NEXT_UNSTABLE，预防` token** and the stray CJK characters.
17. **`08` §8.10 (ARCH-412): replace `db.open()`** with the actual mechanism — a module-level IIFE at `db/index.ts:81` plus `BOOTSTRAP_SQL` (`:39`) and additive `ALTER TABLE` upgrades (`:40-56`).
18. **`08` §8.1-8.2 (ARCH-415a): add the Tauri desktop runtime.** `desktop/src-tauri/src/server.rs` spawns `node apps/web/server.js` as a child process on `127.0.0.1` with `PORT=0` and its own `JOURNAL_DATA_DIR`. Without this, `08` presents the Docker image as the sole deployment target and `07`'s cookie/secret model is never checked against the loopback, non-TLS desktop transport.

---

## Recommended additional evidence

- **`desktop/` Tauri app** — read `desktop/package.json`, `desktop/README.md`, `desktop/src-tauri/` (Cargo.toml, `tauri.conf.json`, Rust src). Determine: does it bundle the Next server, spawn it, or call it over HTTP? What is the IPC contract? Is `JOURNAL_DATA_DIR` overridden? This determines whether `08` needs a second runtime section and whether `07`'s cookie `secure` flag and `JOURNAL_PASSWORD` model hold on `http://127.0.0.1`.
- **Reverse-proxy deployment reality** — `docker-compose.yml` maps `3000:3000` with no TLS. If users front it with Caddy/nginx, `new URL(request.url).protocol` may be `http:` and the cookie loses `Secure`. Check `SECURITY.md` and `README.md` for the documented deployment topology.
- **CSRF posture** — grep for `Origin`/`Referer`/`csrf` across `apps/web/src/server` and `middleware.ts`; if absent, record "no CSRF token, mitigated only by `sameSite: lax` + JSON content type" as an explicit invariant row in `07` §7.7.
- **Login brute force** — confirm there is no attempt counter/lockout in `app/api/auth/route.ts`; if so, cross-reference `08` §8.8 (no rate limiting) and note the auth endpoint as the concrete exposure.
- **`JOURNAL_SECRET` rotation** — test/describe what happens to stored broker + AI credentials when `JOURNAL_SECRET` changes (`crypto.ts:14` re-derives the key; `decryptJson` fails closed with "Malformed credential envelope" or an auth-tag error). Add to `07` §7.4.
- **DB write-path audit** — read `server/executions.ts` and `app/api/trades/route.ts` end-to-end to substantiate `05` ARCH-206's "all writes are transactional" (currently the weakest VERIFIED in the set).
- **Package publish contract** — read `packages/core/package.json` and `packages/importers/package.json` (public npm packages, `publishConfig`, `exports`) and `release.yml`; `08` §8.11 should mention the release pipeline.
- **Base image pinning** — note that `node:22-slim` (`Dockerfile:2,13`) is an unpinned floating tag; recommend a `@sha256:` digest if the "production deployment" posture in `08` §8.2 is meant to be prescriptive.
- **`readAiRequest` scope enforcement** — `server/ai-scope.ts:50-183` is the trust boundary for every AI route (allowed fields, `dataSource`, account scope). `07` §7.1/§7.3 asserts "no resource-level authorization" — verify that claim against `ai-scope.ts` before leaving it unqualified, since scope narrowing *is* a form of authorization at the AI boundary.
- **CI security gates** — confirm the absence of `npm audit`, CodeQL, or SARIF upload in `ci.yml` (already checked: absent) and add it explicitly to `08` §8.11 so the "no security scanning" statement is evidenced rather than asserted.
