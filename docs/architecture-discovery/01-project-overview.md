# Section 3 — Project Overview

> Architecture as-implemented, verified against source. Claims tagged **VERIFIED** (file:line), **INFERRED** (best reading), **UNVERIFIED** (unreachable), or **UNKNOWN** (no evidence). No secrets.
>
> **Evidence ID convention.** This section owns the `ARCH-800+` range (800–899); each ID below is assigned to one of this document's own claims. `ARCH-0xx`–`ARCH-4xx` belong to the other section documents (`03-domain-model.md` owns `ARCH-0xx`, etc.) and `ARCH-5xx`–`ARCH-7xx` belong to the companion `REVIEW-*.md` files — this document therefore does **not** mint IDs in those ranges.

---

## 1. Project Summary

**Trade Journal** is an open-source personal trading journal maintained by [LuxAlgo](https://luxalgo.com). It records executions from broker sync, statement imports, or manual entry; materializes round-trip trades through a pure domain engine; and surfaces P&L, analytics, a daily journal, AI reflection, and prop-firm tracking.

- Repository: `https://github.com/LuxAlgo/trade-journal.git` — **VERIFIED** `package.json:6-9`
- License: MIT — **VERIFIED** `package.json:5`; `LICENSE:1` ("MIT License, Copyright (c) 2026 LuxAlgo Global, LLC")
- npm packages: `@luxalgo/journal-core` (engine), `@luxalgo/journal-importers` (parsers) — **VERIFIED** as *publish-ready*, not as published: both declare `version: "0.1.0"` and `publishConfig.access: "public"` (`packages/core/package.json:3,39-40`; `packages/importers/package.json:3,42-43`). Actual registry publication is **UNVERIFIED** from the repo.
- Architecture: self-hosted only — no hosted-service assumptions — **VERIFIED** `README.md:82` ("Deploy anywhere a Node process and a persistent disk exist … Serverless platforms without a disk need an external database, which this release does not support").
- Telemetry: the project ships **no** telemetry SDK, but Next.js anonymous framework telemetry is **not** disabled in the image — see **ARCH-829** in §8.

---

## 2. Verified Technology Stack

### 2.1 Runtime & Package Manager

| Layer | Technology | Evidence |
|---|---|---|
| Runtime | Node ≥ 22 | `package.json:10-12` (`"node": ">=22"` at `:11`) |
| Package manager | pnpm 11.0.8 | `package.json:13` (`"packageManager": "pnpm@11.0.8"`) |
| Production image | `node:22-slim` (two-stage: builder + runner) | `Dockerfile:2` (`FROM node:22-slim AS builder`), `Dockerfile:13` (`FROM node:22-slim AS runner`) |

### 2.2 Workspace Structure

```
trade-journal-monorepo (pnpm workspace)
├── packages/
│   ├── core/          @luxalgo/journal-core      (workspace member)
│   └── importers/    @luxalgo/journal-importers  (workspace member)
├── apps/
│   └── web/          web (Next.js 15 app)         (workspace member)
├── desktop/          desktop (Tauri wrapper)      (workspace member)
└── scripts/          CI + dev utilities — plain directory, NOT a workspace member
```

**Evidence:** `pnpm-workspace.yaml:1-4` — members are `packages/*`, `apps/*`, and the explicit entry `desktop`. `scripts/` is not listed there; it is a plain directory in the repository root. Root package name: `package.json:2` (`"trade-journal-monorepo"`).

### 2.3 Core Engine — `packages/core`

| Concern | Library | Version | Evidence |
|---|---|---|---|
| Language | TypeScript (strict) | `^5.9.0` | `package.json:32` (root devDependency — **not** declared in `packages/core/package.json`) |
| Module system | ESM | `"type": "module"` | `packages/core/package.json:6` |
| Type checking | `tsc --noEmit` | — | `packages/core/package.json:35` |
| Build | tsup (`--format esm,cjs --dts --clean`) | `^8.5.1` | `package.json:31` (root devDep); script at `packages/core/package.json:36` |
| **Runtime deps** | **none** | — | `packages/core/package.json` — no `dependencies`, `devDependencies`, or `peerDependencies` key |

`packages/core` is a pure domain library: no Node APIs, no database, no network. **VERIFIED** — grep for `from "node:` / `require(` across `packages/core/src/` returns zero matches; `sideEffects: false` is declared at `packages/core/package.json:15`. Unit-tested by 4 test files plus 1 shared helper (`packages/core/tests/`: `analysis.test.ts`, `metrics.test.ts`, `overview-regression.test.ts`, `round-trips.test.ts`, `helpers.ts`).

### 2.4 Importers — `packages/importers`

| Concern | Library | Version | Evidence |
|---|---|---|---|
| Language | TypeScript | `^5.9.0` | `package.json:32` (root devDependency) |
| Module system | ESM | `"type": "module"` | `packages/importers/package.json:6` |
| **Runtime deps** | **`@luxalgo/journal-core`** | `workspace:*` | `packages/importers/package.json:39-41` (entry at `:40`) — the only runtime dependency |

Zero third-party dependencies; the sole runtime dep is the sibling workspace package. **Evidence:** `packages/importers/package.json` (single `dependencies` entry).

### 2.5 Web App — `apps/web`

| Concern | Library | Version | Evidence |
|---|---|---|---|
| Framework | Next.js | `15.5.23` | `apps/web/package.json:43` |
| Language | TypeScript | `^5.9.0` | **Not declared in `apps/web/package.json`** — root devDependency only (`package.json:32`). `apps/web` typecheck is `next typegen && tsc --noEmit` (`apps/web/package.json:10`) |
| React | React + React DOM | `^19.1.0` | `apps/web/package.json:45` (react), `:47` (react-dom) |
| Database | SQLite (better-sqlite3) | `^12.2.0` | `apps/web/package.json:35` |
| ORM | Drizzle ORM | `^0.45.2` | `apps/web/package.json:40` |
| AI SDK | Vercel AI (`ai`) | `^7.0.77` | `apps/web/package.json:34` |
| Anthropic adapter | `@ai-sdk/anthropic` | `^4.0.41` | `apps/web/package.json:13` |
| OpenAI adapter | `@ai-sdk/openai` | `^4.0.64` | `apps/web/package.json:15` |
| MCP | `@ai-sdk/mcp` | `^2.0.73` | `apps/web/package.json:14` |
| Broker SDK | `@luxalgo/broker-sdk` | `0.5.1` | `apps/web/package.json:19` |
| Charting | Vela + ECharts + Recharts | `^0.6.8`, `^6.1.0`, `^3.10.1` | `apps/web/package.json:22`, `:41`, `:49` |
| Tables | TanStack Table | `^9.1.2` | `apps/web/package.json:33` |
| UI primitives | Radix UI | **9 packages**, `^1.1.21`–`^2.3.7` | `apps/web/package.json:24-32` (checkbox `^1.3.11`, dialog `^1.1.23`, dropdown-menu `^2.1.24`, label `^2.1.15`, popover `^1.1.23`, select `^2.3.7`, slot `^1.3.3`, tabs `^1.1.21`, tooltip `^1.2.16`) |
| Base UI | `@base-ui/react` | `^1.9.0` | `apps/web/package.json:16` |
| Styling | Tailwind CSS v4 | `^4.3.3` | `apps/web/package.json:61` (devDep); paired with `@tailwindcss/postcss ^4.3.3` at `:55` |
| PDF | pdf-lib + `@pdf-lib/fontkit` | `^1.17.1`, `^1.1.1` | `apps/web/package.json:44`, `:23` |
| Markdown rendering | react-markdown + remark-gfm | `^10.1.0`, `^4.0.1` | `apps/web/package.json:48`, `:50` |
| Date utilities | date-fns | `^4.4.0` | `apps/web/package.json:39` |
| Date picker | react-day-picker | `^10.0.2` | `apps/web/package.json:46` |
| Icons | lucide-react | `^1.34.0` | `apps/web/package.json:42` |
| Schema validation | Zod | `^3.25.76` (Zod v3) | `apps/web/package.json:52` |
| Drag-and-drop | @dnd-kit | core `6.3.1`, sortable `10.0.0` | `apps/web/package.json:17-18` |
| Class-name utilities | class-variance-authority, clsx, `cn`, tailwind-merge | `^0.7.1`, `^2.1.1`, `^0.5.0`, `^3.6.0` | `apps/web/package.json:36-38`, `:51` |

### 2.6 TypeScript Configuration

```json
// tsconfig.base.json — applied by all packages
{
  "target": "ES2022",
  "lib": ["ES2022"],
  "module": "ESNext",
  "moduleResolution": "bundler",
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "forceConsistentCasingInFileNames": true,
  "skipLibCheck": true,
  "esModuleInterop": true,
  "resolveJsonModule": true,
  "isolatedModules": true,
  "noEmit": true
}
```

**Evidence:** `tsconfig.base.json:1-16` (compiler options at `:2-15`; the values above occupy `:3-14`).

### 2.7 Build Allowlist & Supply-Chain Policy

- `allowBuilds`: only `esbuild` and `better-sqlite3` may run post-install binaries — `pnpm-workspace.yaml:5-7`.
- `ignoredOptionalDependencies`: `sharp` — `pnpm-workspace.yaml:8-9`.
- `minimumReleaseAgeExclude`: four packages pinned past the release-age gate (`@ai-sdk/openai@4.0.64`, `@ai-sdk/provider-utils@5.0.38`, `@ai-sdk/provider@4.0.12`, `@luxalgo/broker-sdk@0.5.1`) — `pnpm-workspace.yaml:10-14`.

**Evidence:** `pnpm-workspace.yaml:5-14`.

---

## 3. High-Level Architecture Diagram

```mermaid
flowchart TB
    subgraph "Ingestion"
        BS["Broker Sync\n(@luxalgo/broker-sdk)"]
        IM["14 Statement Formats\n(packages/importers)"]
        MN["Manual Entry\n(Add Trade form)"]
    end

    subgraph "packages/core — pure domain, zero runtime deps"
        RT["buildRoundTrips()\nFIFO / LIFO / WAVG"]
        MET["computeMetrics()"]
        EDGE["computeEdgeScore()"]
        AGG["aggregate / equity curves"]
        FILT["matchesFilters / tradeR"]
    end

    subgraph "apps/web — SQLite + Next.js 15"
        DB[(("SQLite\nbetter-sqlite3\nWAL mode"))]
        API["43 API routes\n(Next.js route handlers)"]
        UI["React 19\nRadix + Tailwind v4\nECharts / Recharts / Vela"]
        AI["AI routes\n(Anthropic / OpenAI)"]
        MID["middleware.ts\noptional password gate\n(cookie presence only)"]
    end

    subgraph "Output Surfaces"
        DASH["Dashboard\nP&L gauges + Edge Score radar"]
        CAL["Calendar\ndaily P&L + insights"]
        REP["Reports\nrolling trends + trade explorer"]
        JRN["Daily Journal\nnotes + voice dictation"]
        TRD["Trade detail\nVela chart + MAE/MFE"]
        PROP["Prop firm tracker\ncash ledger"]
        AI_CHAT["AI Ask Journal / Reports / Recap / Critique"]
    end

    BS -->|"executions"| API
    IM -->|"executions"| API
    MN -->|"executions"| API
    API --> DB
    DB -->|"executions"| RT
    RT -->|"trades"| MET
    RT -->|"trades"| EDGE
    RT -->|"trades"| AGG
    RT -->|"trades"| FILT
    RT -->|"trades"| API
    API --> UI
    AI --> UI
    UI --> DASH
    UI --> CAL
    UI --> REP
    UI --> JRN
    UI --> TRD
    UI --> PROP
    UI --> AI_CHAT
```

**Route count:** **VERIFIED** — 43 `route.ts` files under `apps/web/src/app/api/` (filesystem count).

**Data flow summary**: Execution (fill) → RoundTrip (materialized trade) → all surfaces.
**Evidence:** README.md "One primitive drives everything" flowchart; `AGENTS.md` §Architecture & Data Flow; `packages/core/src/index.ts:1-9` for the exported engine surface (`buildRoundTrips`, `computeMetrics`, `computeEdgeScore`, `equityCurve`, aggregate helpers, `matchesFilters`/`tradeR`); `packages/importers/src/detect.ts:40` for the 14-entry `FORMATS` registry (13 `LEGACY_FORMATS` at `:24-38` plus `historyFormat`).

---

## 4. Directory Map with Architectural Responsibilities

```
trade-journal/
├── packages/
│   ├── core/                    # Pure domain engine — zero runtime deps
│   │   └── src/
│   │       ├── index.ts         # Public API surface (all exports below)
│   │       ├── types.ts         # Domain types: Execution, RoundTrip, Trade, Metrics, etc.
│   │       ├── round-trips.ts   # buildRoundTrips(), FIFO/LIFO/WAVG, consumeLots, finalizeCycle
│   │       ├── metrics.ts       # computeMetrics(), realized-R, profit factor
│   │       ├── equity.ts        # equityCurve(), dailyStats, dailyCumulative
│   │       ├── aggregate.ts     # trade aggregates by symbol/time/account
│   │       ├── analysis.ts      # FILTER_KEYS, matchesFilters, tradeR, plannedR
│   │       ├── edge-score.ts    # computeEdgeScore(), EDGE_SCORE_VERSION = 2
│   │       ├── time.ts          # dayKeyOf, monthKeyOf, weekdayOf, hourOf (DST-safe)
│   │       └── adherence.ts     # analyzeAdherence() — read-only rule-check analysis
│   │   └── tests/               # 4 unit-test files + helpers.ts
│   │
│   └── importers/               # Zero-dep statement parsers
│       └── src/
│           ├── index.ts         # Public exports: parseAuto, detectFormat, FORMATS, parseHistory
│           ├── detect.ts        # parseAuto(), detectFormat(), FORMATS registry
│           ├── csv.ts           # Generic CSV parsing primitives
│           ├── dates.ts         # Date parsing helpers
│           ├── numbers.ts       # Number/currency parsing helpers
│           ├── position-fills.ts # Hedge/position action parsing (parsePositionAction, positionFillProblem)
│           ├── types.ts         # Importer types: ParsedFill, ImportResult, etc.
│           ├── formats/         # Per-broker format definitions → fills
│           │   ├── fills.ts     # makeFillsFormat(), rowsToFills() — declarative column spec
│           │   ├── simple.ts    # Simple CSV
│           │   ├── metatrader.ts
│           │   ├── ibkr.ts
│           │   ├── thinkorswim.ts
│           │   ├── tradezella.ts
│           │   ├── ninjatrader.ts
│           │   ├── pepperstone.ts
│           │   ├── generic.ts   # Column mapper
│           │   └── history.ts   # Bridge: routes a history import into history/import.ts
│           └── history/         # SIBLING of formats/ — historical import adapters
│               ├── import.ts    # importTradeHistory() — adapter dispatch
│               ├── model.ts     # History result model
│               ├── csv.ts       # CSV section/table parsing
│               ├── html.ts      # HTML statement parsing
│               ├── aliases.ts   # Header alias mapping
│               ├── timestamps.ts# Timestamp normalization
│               ├── reconstruct.ts # Rebuild trades from raw history fills
│               └── adapters/
│                   ├── adapter.ts
│                   ├── generic.ts
│                   ├── metatrader.ts
│                   ├── mt5deals.ts
│                   └── tradingview.ts
│           └── tests/           # Unit tests + fixtures/ (dates, history, importers,
│                                #   ninjatrader, pepperstone, skipped-reasons)
│
├── apps/
│   └── web/                     # Next.js 15 app — renders, orchestrates, persists
│       ├── next.config.ts       # output:"standalone", transpilePackages, serverExternalPackages
│       └── src/
│           ├── middleware.ts    # Optional password gate (JOURNAL_PASSWORD) — cookie presence only
│           ├── hooks/           # Client hooks (use-mobile.ts)
│           ├── app/             # Next.js App Router pages
│           │   ├── layout.tsx   # Root layout
│           │   ├── page.tsx     # Dashboard
│           │   ├── login/
│           │   ├── accounts/    calendar/   import/    journal/
│           │   ├── missed/      notebook/   playbooks/ progress/
│           │   ├── prop-firms/  reports/    settings/  trades/
│           │   └── api/         # 43 route handlers across 24 directories
│           │       ├── accounts/        adherence/       ai/
│           │       ├── analysis/        attachments/     auth/
│           │       ├── brokers/         calendar/        demo/
│           │       ├── executions/      export/          folders/
│           │       ├── import/          journal/         market-data/
│           │       ├── notes/           performance-trends/
│           │       ├── playbooks/       prop-firms/      settings/
│           │       ├── stats/           trade-explorer/  trades/
│           │       ├── workspace/
│           │       └── ai/              # ask/ recap/ critique/ reports/
│           ├── components/      # React UI — Radix primitives, charts, dashboard layout
│           │   ├── ui/          # shadcn-style: Button, Card, Dialog, Tabs, Select, etc.
│           │   ├── charts/      # ECharts canvas wrappers (tokens.ts reads CSS vars)
│           │   ├── dashboard-layout.tsx
│           │   ├── shell.tsx
│           │   └── [feature]/
│           ├── server/         # Node-only: all DB writes, rebuild, sync, AI, broker SDK
│           │   ├── api.ts       # handler() wrapper — uniform auth + error JSON
│           │   ├── auth.ts      # HMAC session token + verifySession
│           │   ├── crypto.ts    # AES-256-GCM credential encryption
│           │   ├── executions.ts
│           │   ├── rebuild.ts   # rebuildAccount() — read execs → buildRoundTrips → upsert trades
│           │   ├── sync.ts      # Broker sync via @luxalgo/broker-sdk
│           │   ├── settings.ts  # Encrypted settings store
│           │   ├── trades-query.ts
│           │   ├── ids.ts
│           │   ├── demo.ts
│           │   ├── currency-conversion.ts
│           │   ├── prop-firms.ts
│           │   ├── prop-csv.ts
│           │   ├── position-import.ts
│           │   ├── ibkr-sync-timezone.ts
│           │   ├── ninjatrader-import.ts
│           │   ├── ninjatrader-order.ts
│           │   ├── ai.ts        # runAi, runAskJournalAi, runReportsAgentAi
│           │   ├── ai-runtime.ts
│           │   ├── ai-prompts.ts
│           │   ├── ai-scope.ts
│           │   ├── ai-contracts.ts
│           │   ├── ai-report-context.ts
│           │   ├── ai-capabilities.ts
│           │   ├── ai-import.ts
│           │   ├── market-data/ # Provider adapters: alpaca, oanda, public-crypto (binance + coinbase),
│           │   │                #   london-strategic-edge (LSE), csv, provider, http, transport,
│           │   │                #   estimates, connections
│           │   ├── ctrader-mcp/ # CTrader MCP client (broker sync, not AI)
│           │   └── ninjatrader-*.ts
│           ├── db/
│           │   ├── index.ts     # Drizzle singleton + SQLite WAL config
│           │   ├── schema.ts    # Full Drizzle schema
│           │   └── bootstrap.ts # BOOTSTRAP_SQL DDL + ALTER guards
│           └── lib/            # Pure client helpers: use-api, use-ai-request, filters, formatters
│       └── public/
│
├── desktop/                     # Tauri desktop wrapper
│   ├── src-tauri/               # Rust backend
│   │   ├── tauri.conf.json      # devUrl=http://localhost:3000 (no Node version field)
│   │   ├── binaries/            # Node sidecar (only .gitkeep checked in)
│   │   ├── scripts/             # setup-sidecar-node.{ps1,sh}, gen_icons/
│   │   └── src/                 # main.rs, lib.rs, paths.rs, server.rs
│   ├── scripts/                 # run-sidecar-setup.js
│   └── package.json             # tauri scripts — run from desktop/
│
├── docs/
│   ├── architecture-discovery/  # This document set
│   ├── edge-score.md, importers.md, market-data.md, prop-firms.md
│   ├── import-formats.md, ai-scope.md, calendar-insights.md
│   ├── performance-trends.md, trade-explorer.md
│   ├── design.md, decisions/, samples/, superpowers/
│   └── LEARNINGS.md, MISTAKES.md
│
└── scripts/                     # NOT a pnpm workspace package
    ├── check-licenses.mjs       # CI allowlist gate
    ├── verify-features.py       # E2E HTTP smoke
    ├── benchmark-journal.py     # Latency benchmarking
    └── *.ps1                    # Build / diagnostics scripts
```

### 4.1 Two parallel importer pipelines

`packages/importers` contains **two** independent parsing pipelines that both end in `ImportResult`:

1. **`formats/*` → fills.** Declarative per-broker column specs (`formats/fills.ts` → `makeFillsFormat`, `rowsToFills`) plus dedicated parsers (`ibkr.ts`, `metatrader.ts`, `thinkorswim.ts`, `tradezella.ts`, `ninjatrader.ts`, `pepperstone.ts`, `simple.ts`). These yield executions/fills.
2. **`history/*` → reconstructed trades.** `history/import.ts` dispatches to source adapters (`history/adapters/{generic,metatrader,mt5deals,tradingview}.ts`), which parse CSV/HTML statements and let `history/reconstruct.ts` rebuild trades from raw history fills.

The bridge is `formats/history.ts` (`parseHistory`), which delegates to `history/import.ts`; it is registered as the 14th entry of `FORMATS` (`packages/importers/src/detect.ts:40`). `history/import.ts:1-6` documents the provenance (adapted from `ChristopherDownie/prop-firm-sim`, MIT).

**Evidence:** filesystem listing of `packages/importers/src/`, `apps/web/src/server/`, `apps/web/src/app/api/`, `apps/web/src/`, `packages/core/src/`, `packages/core/tests/`, `desktop/`; `AGENTS.md` §Key Directories.

---

## 5. Major Application Entry Points

### 5.1 Web App Entry Points

| Entry | File | Role | Evidence |
|---|---|---|---|
| Next.js config | `apps/web/next.config.ts` | `output:"standalone"`, transpiles workspace packages, excludes `./data/**/*` from tracing | `next.config.ts:4-10` (values at `:4`, `:5`, `:6`, `:8-10`) |
| Auth guard (navigation) | `apps/web/src/middleware.ts` | Optional password gate. **Presence-only** cookie check: it reads `journal_session` and, if absent, returns 401 for `/api/*` or redirects to `/login`. It does **not** verify the HMAC — the middleware runtime has no Node crypto. Bypassed entirely when `JOURNAL_PASSWORD` is unset. | `middleware.ts:9-21` (bypass `:10`, cookie read `:13`, 401 `:15-17`, redirect `:18`); config matcher `:23-25` |
| Session cryptography | `apps/web/src/server/auth.ts` | HMAC-SHA256 session token (`sessionToken()`, `:12-15`) and constant-time `verifySession()` (`:23-29`) | `auth.ts:1`, `:8`, `:12-15`, `:23-29` |
| API handler wrapper | `apps/web/src/server/api.ts` | `handler(fn)` — verifies the session cookie when a password is configured, catches `RequestError` → JSON 400 and other errors → JSON 500; `{ public: true }` opts a route out | `api.ts:20-39` (auth `:27-30`, error mapping `:32-38`); `AGENTS.md:147` |
| Server entry | `apps/web/src/server/` | `executions.ts`, `rebuild.ts`, `sync.ts`, `settings.ts`, `ai*.ts`, `prop-firms.ts`, `market-data/` | `AGENTS.md` §Server-only logic |

**Note (security):** HMAC session validation is **not** in the middleware. It lives in `server/auth.ts` and is applied by `handler()` in `server/api.ts`; all 43 route handlers go through `handler()`.

### 5.2 Core Engine Entry Point

```typescript
// packages/core/src/index.ts
export * from "./types";
export * from "./round-trips";  // buildRoundTrips()
export * from "./metrics";       // computeMetrics()
export * from "./equity";        // equityCurve()
export * from "./aggregate";
export * from "./edge-score";    // computeEdgeScore()
export * from "./time";          // dayKeyOf, monthKeyOf
export * from "./analysis";      // matchesFilters, FILTER_KEYS
export * from "./adherence";     // analyzeAdherence()
```

**Evidence:** `packages/core/src/index.ts:1-9` (verbatim).

### 5.3 Importer Entry Point

```typescript
// packages/importers/src/index.ts
export * from "./types";
export * from "./detect";                                 // parseAuto, detectFormat, FORMATS
export { parseCsv, headerKey } from "./csv";
export { parseTimestamp, parseDateAndTime } from "./dates";
export { parseMoney, parseQuantity } from "./numbers";
export { parseWithMapping, readHeaders, type GenericMapping } from "./formats/generic";
export { makeFillsFormat, parseSide, type FillsFormatSpec } from "./formats/fills";
export { parseHistory, type HistoryParseOptions } from "./formats/history";
export { positionFillProblem } from "./position-fills";
```

**Evidence:** `packages/importers/src/index.ts:1-9` (verbatim); the package entry points map `main`/`types`/`exports["."]` → `./src/index.ts` at `packages/importers/package.json:7-11`.

### 5.4 Tauri Desktop Entry

| Entry | Role | Evidence |
|---|---|---|
| `desktop/src-tauri/tauri.conf.json` | `devUrl: "http://localhost:3000"` (`:8`). **No Node version field.** | `tauri.conf.json:8` |
| Sidecar Node runtime | Tauri spawns `desktop/src-tauri/binaries/node-x86_64-pc-windows-msvc.exe` (Node **24.11.0**) to run the standalone Next.js server | `desktop/README.md:25` (downloads `node-v24.11.0-win-x64.zip`); `AGENTS.md:113` |
| Sidecar version — repo inconsistency | `AGENTS.md:88` describes the dev sidecar as **Node 22.11.0**, while `AGENTS.md:113` and `desktop/README.md:25` state **24.11.0**. The setup script is `pnpm --filter desktop setup:sidecar` (`desktop/package.json:14`). | `AGENTS.md:88`, `AGENTS.md:113`, `desktop/README.md:25` |
| `pnpm tauri dev` | Runs the Next.js dev server + Tauri window — **must be run from `desktop/`** (the script lives in `desktop/package.json:7-8`; the root `package.json` has no `tauri` script) | `AGENTS.md:85-89`; `desktop/package.json:7-8` |

---

## 6. Major Execution Environments

| Environment | How | Evidence |
|---|---|---|
| **Local dev** | `pnpm dev` → Turbopack dev server on `:3000` | `package.json:15`; `apps/web/package.json:7`; `README.md:40` |
| **Local production** | `pnpm build` → `pnpm start` (standalone Next.js server) | `package.json:16-17`; `README.md` |
| **Local preview** | `pnpm preview` = `pnpm build && pnpm start` (same port as dev) | `package.json:18`; `README.md:46-50` |
| **Docker** | `docker compose up -d` → two-stage `node:22-slim` image, port `3000:3000`, `./data:/data` bind mount, `JOURNAL_DATA_DIR=/data`, `restart: unless-stopped` | `Dockerfile:2`, `Dockerfile:13-26`; `docker-compose.yml:2-14` (port `:4-5`, volume `:6-7`, `JOURNAL_DATA_DIR` `:13`, restart `:14`) |
| **Tauri desktop** | `pnpm tauri dev` from `desktop/`; standalone `.exe` via `pnpm build:app` from `desktop/` | `AGENTS.md:85-101`; `desktop/package.json:7-12`; root equivalents `pnpm desktop:build` / `pnpm desktop:build:debug` at `package.json:24-25` |
| **CI** | GitHub Actions: `format:check` → `typecheck` → `test` → `node scripts/check-licenses.mjs` → package builds → app build | `.github/workflows/ci.yml:20-25` |

---

## 7. Existing Architectural Conventions

### 7.1 Naming Conventions

| Convention | Example | Evidence |
|---|---|---|
| Domain identifiers | camelCase: `tradeKey`, `executedAt`, `profitFactor` | `AGENTS.md:141` |
| Component files | lowercase kebab: `add-trade-dialog.tsx` | `AGENTS.md:142` |
| Server/lib modules | lowercase kebab: `executions.ts`, `ibkr-sync-timezone.ts` | `AGENTS.md:142` |
| DB columns | snake_case; Drizzle maps them to camelCase TS fields | `AGENTS.md:143` |

### 7.2 Error Handling

- API handlers wrapped in `handler(fn)` from `apps/web/src/server/api.ts` — `api.ts:20-39`; `AGENTS.md:147`
- Throw `new RequestError(msg)` → HTTP 400 JSON — `api.ts:5`, `:36`; `AGENTS.md:147`
- All other thrown errors → HTTP 500 JSON — `api.ts:32-38`
- `requireValue(condition, msg)` for assertion guards — `api.ts:6-8`; `AGENTS.md:148`
- Provider payloads, keys, and stack traces **never** leak to clients — `AGENTS.md:149`
- `APICallError` mapped to 7 plain-language categories (`missing_key`, `authentication`, `billing`, `rate_limited`, `model_unavailable`, `timeout`, `provider`) by `mapAiRuntimeError` — `ai-runtime.ts:61-64` (categories), `:66` (function); thrown at `:152`, `:217`, `:280`, `:311`

### 7.3 Async / React Patterns

- Server code fully async; prefer `await` + Drizzle query builder — `AGENTS.md:154`
- React components `"use client"` only when using hooks/events — `AGENTS.md:155`
- `useApi(url)` — deduplicates in-flight GETs, aborts on last unsubscribe — `AGENTS.md:156`; `apps/web/src/lib/use-api.ts`
- `useAutosave(url, method)` — coalesces rapid edits, flushes on unmount — `AGENTS.md:157`; `apps/web/src/lib/use-autosave.ts`
- Data fetches wrapped in `startTransition` for progressive painting — `AGENTS.md:158`

### 7.4 Transaction Boundaries

- `db.transaction(..., { behavior: "immediate" })` for writes across tables — `AGENTS.md:150`, `AGENTS.md:257`
- `insertExecutions`, `rebuildAccount`, `mutateProp`, `commitNinjaTraderImport` run in a single tx — `AGENTS.md:150`
- Combination inserts + rebuild in one tx prevents executions-without-trades state — `AGENTS.md:150`
- `behavior: "immediate"` sites: `app/api/accounts/[id]/actions/route.ts:78`, `app/api/accounts/[id]/route.ts:55`, `server/ctrader-mcp/sync.ts:190`, `server/ninjatrader-import.ts:548`, `server/sync.ts:104`

### 7.5 Build Configuration

| Setting | Value | Evidence |
|---|---|---|
| `output` | `"standalone"` (Docker-friendly) | `next.config.ts:4` |
| `transpilePackages` | `["@luxalgo/journal-core", "@luxalgo/journal-importers"]` | `next.config.ts:5` |
| `serverExternalPackages` | `["better-sqlite3"]` | `next.config.ts:6` |
| `outputFileTracingExcludes` | `"/*"` → `./data/**/*`, `../../outputs/**/*`, `../../.runtime-backup*/**/*` | `next.config.ts:8-10` |

---

## 8. Deployment & Runtime Assumptions

| ID | Assumption | Detail | Evidence |
|---|---|---|---|
| ARCH-821 | Persistent disk required | SQLite is single-file on disk; no serverless disk-less deployment | `README.md:82` |
| ARCH-822 | Data directory | README documents the default as `./data` relative to the app process; configurable via `JOURNAL_DATA_DIR`. **Discrepancy:** the code default is `/data/trade-journal` (`apps/web/src/db/index.ts:8`), so a plain `pnpm` run and the documented `./data` differ. Compose sets `JOURNAL_DATA_DIR: /data`. | `README.md:74`, `README.md:237`; `apps/web/src/db/index.ts:8`; `docker-compose.yml:13` |
| ARCH-823 | Optional password | `JOURNAL_PASSWORD` gates navigation (middleware) and all API routes (`handler()` → `verifySession`). Unset ⇒ everything is open. | `README.md` env table; `middleware.ts:10`; `api.ts:27-30`; `auth.ts:10`, `:24` |
| ARCH-824 | Credential encryption | `JOURNAL_SECRET` derives an AES-256-GCM key via `scryptSync(JOURNAL_SECRET, …, 32)`; a random 256-bit key file is used if unset | `README.md:73`; `AGENTS.md:163`; `apps/web/src/server/crypto.ts` |
| ARCH-825 | AI BYO-key | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` via env or Settings page | `README.md:75-76`; `02-ai-architecture.md` §2 |
| ARCH-826 | WAL mode | SQLite WAL enabled; concurrent reads during writes. Set in **both** the legacy `createDb()` helper and the singleton. | `apps/web/src/db/index.ts:36`; `apps/web/src/db/index.ts:98` |
| ARCH-827 | `foreign_keys = ON` | Enforced at connection level, in both init paths | `apps/web/src/db/index.ts:38`; `apps/web/src/db/index.ts:100` |
| ARCH-828 | `busy_timeout = 5000` | 5-second write-wait, in both init paths | `apps/web/src/db/index.ts:37`; `apps/web/src/db/index.ts:99` |
| ARCH-829 | Next.js telemetry | **Not disabled by the project.** The Dockerfile sets `NODE_ENV=production` (`Dockerfile:14`) but no `NEXT_TELEMETRY_DISABLED`. `README.md:288` tells users to `set NEXT_TELEMETRY_DISABLED=1` themselves. `AGENTS.md:260` claims the flag is in the Dockerfile — **that claim is false** and is the only place in the repo that states it as shipped behavior. | `Dockerfile:13-14`; `README.md:288`; `AGENTS.md:260` |

**Drift note:** `createDb()` (`apps/web/src/db/index.ts:31-72`) is an unreferenced duplicate of the singleton initialization (`:81-137`); the singleton mirrors its upgrade queries. Two init paths set the same pragmas, so the pragma line numbers above differ by path — a maintenance drift risk.

---

## 9. Dependency Map (Workspace)

```
root package.json (devDependencies only — package.json:28-34)
├── vitest ^3.2.0
├── prettier ^3.6.0
├── tsup ^8.5.1
├── typescript ^5.9.0
└── jsdom ^26.1.0

packages/core
└── (zero runtime dependencies)

packages/importers
└── @luxalgo/journal-core  workspace:*

apps/web (runtime dependencies — apps/web/package.json:12-53)
├── @luxalgo/journal-core     workspace:*
├── @luxalgo/journal-importers workspace:*
├── @luxalgo/broker-sdk       0.5.1
├── @luxalgo/vela             ^0.6.8
├── next                      15.5.23
├── react                     ^19.1.0
├── react-dom                 ^19.1.0
├── better-sqlite3            ^12.2.0
├── drizzle-orm               ^0.45.2
├── ai                        ^7.0.77        (Vercel AI SDK)
├── @ai-sdk/anthropic         ^4.0.41
├── @ai-sdk/openai            ^4.0.64
├── @ai-sdk/mcp               ^2.0.73
├── echarts                   ^6.1.0
├── recharts                  ^3.10.1
├── @tanstack/react-table     ^9.1.2
├── @dnd-kit/core             6.3.1
├── @dnd-kit/sortable         10.0.0
├── @base-ui/react            ^1.9.0
├── @radix-ui/*               (9 packages — ^1.1.21 … ^2.3.7)
├── pdf-lib                   ^1.17.1
├── @pdf-lib/fontkit          ^1.1.1
├── zod                       ^3.25.76
├── date-fns                  ^4.4.0
├── react-day-picker          ^10.0.2
├── react-markdown            ^10.1.0
├── remark-gfm                ^4.0.1
├── lucide-react              ^1.34.0
├── class-variance-authority  ^0.7.1
├── clsx                      ^2.1.1
├── cn                        ^0.5.0
├── tailwind-merge            ^3.6.0
├── tailwindcss               ^4.3.3        (devDependency)
└── @types/better-sqlite3     ^7.6.13       (devDependency)
```

**Evidence:** `package.json:28-34`; `packages/core/package.json`; `packages/importers/package.json:39-41`; `apps/web/package.json:12-62`.

---

## 10. Important Technical Constraints

| ID | Constraint | Detail | Evidence |
|---|---|---|---|
| ARCH-801 | **Node 22+ required** | Hard requirement; `node:22-slim` in both Dockerfile stages | `package.json:10-12`; `Dockerfile:2`, `Dockerfile:13` |
| ARCH-802 | **pnpm 11.0.8 required** | Pinned via `packageManager` field; `--frozen-lockfile` in CI and in the Dockerfile | `package.json:13`; `Dockerfile:8`; `.github/workflows/ci.yml:19` |
| ARCH-803 | **ESM-only** | All packages use `"type": "module"`; no CommonJS at runtime | `packages/core/package.json:6`; `packages/importers/package.json:6`; `apps/web/package.json:5`; `tsconfig.base.json:5` |
| ARCH-804 | **TypeScript strict** | `strict: true`, `noUncheckedIndexedAccess: true` | `tsconfig.base.json:7`, `tsconfig.base.json:8` |
| ARCH-805 | **`noUncheckedIndexedAccess`** | Every `arr[i]` is `T \| undefined`; use `!` only when provably in range | `tsconfig.base.json:8`; `AGENTS.md` §Formatting / structure |
| ARCH-806 | **`better-sqlite3` must be serverExternal** | Prevents bundling; process-resident | `next.config.ts:6`; `AGENTS.md:257` |
| ARCH-807 | **No `import.meta` in sync/broker code** | Sync code runs in browser-less Node; `import.meta` is not polyfilled there. **VERIFIED** — grep for `import.meta` across `apps/web/src/server/` and `apps/web/src/app/api/` returns zero matches | `AGENTS.md` §Async / state |
| ARCH-808 | **Execution immutability** | Executions are append-only; `contentHash` uniqueness enforced by DB index | `03-domain-model.md:ARCH-059` |
| ARCH-809 | **Trade key stability** | Key format `accountId\|symbol\|direction\|openedAt` must never change without migration | `03-domain-model.md:ARCH-065` |
| ARCH-810 | **Annotations survive rebuild** | `notes`, `tagsJson`, `mistakesJson`, `rating`, `stopLoss`, `profitTarget`, `playbookId` are not part of the upsert set — `rebuild.ts` writes only `computed` fields (`:49-72`) via `.onConflictDoUpdate({ target: trades.key, set: computed })` (`:75`) | `apps/web/src/server/rebuild.ts:49-75`; `03-domain-model.md:ARCH-067` |
| ARCH-811 | **Prop firm cash ledger is separate** | `prop_accounts` / `prop_entries` are distinct from `accounts` / `trades`; `journalAccountId` is a reference, not FK cascade | `03-domain-model.md:ARCH-078` |
| ARCH-812 | **IBKR timezone lock** | `ibkr_sync_time_zone` is asserted on first sync; mixed-timezone accounts require recovery | `AGENTS.md` §IBKR broker sync; `apps/web/src/server/ibkr-sync-timezone.ts` |
| ARCH-813 | **AI tools limited to 4 per agent run** | `maxToolCalls: 4`, `maxSteps: 4`. The constants live in `ai-contracts.ts` (`:47-48`, `:54-55`); enforcement is in `ai-runtime.ts` (`:165-167`, `:177`, `:195-196`, `:228-230`, `:240`, `:258-259`) | `apps/web/src/server/ai-contracts.ts:47-48`, `:54-55`; `apps/web/src/server/ai-runtime.ts:165-167` |
| ARCH-814 | **AI never streams** | `streamText` is not used anywhere; all calls are non-streaming `generateText`. **VERIFIED** — grep for `streamText` across `apps/web/src/` returns zero matches | `02-ai-architecture.md` §8 |
| ARCH-815 | **No persistent chat** | No `conversations`/`messages` tables; each request builds a fresh aggregate context. **VERIFIED** — grep across `apps/web/src/db/` returns zero matches | `02-ai-architecture.md` §7 |
| ARCH-816 | **Serverless not supported** | SQLite requires a persistent disk; no external DB in this release | `README.md:82` |
| ARCH-817 | **No telemetry (qualified)** | The project ships no telemetry SDK and no analytics calls, but it does make outbound requests to brokers, market-data providers, and AI providers. Next.js anonymous framework telemetry is **not** disabled in the shipped image — users are told to set `NEXT_TELEMETRY_DISABLED=1` themselves. `AGENTS.md:260` asserts the flag is in the Dockerfile; it is not. | `README.md:288`; `AGENTS.md:260`; `Dockerfile:13-14` (absence) |
| ARCH-818 | **Desktop sidecar runtime ≠ Docker runtime** | The Docker image builds and runs on Node 22 (`Dockerfile:2`, `:13`); the Tauri sidecar is Node 24.11.0 (`desktop/README.md:25`, `AGENTS.md:113`), and `AGENTS.md:88` states 22.11.0 — the repo is internally inconsistent | `Dockerfile:2`; `desktop/README.md:25`; `AGENTS.md:88`, `AGENTS.md:113` |

---

## 11. Build & Test Commands

| Command | Effect | Evidence |
|---|---|---|
| `pnpm install --frozen-lockfile` | Workspace install (all packages) | `README.md:39`; `Dockerfile:8` |
| `pnpm dev` | Next.js Turbopack dev server on `:3000` | `package.json:15`; `apps/web/package.json:7` |
| `pnpm build` | Next.js production build + static copy script | `package.json:16`; `apps/web/package.json:8` |
| `pnpm start` | Serve existing standalone build | `package.json:17`; `apps/web/package.json:9` |
| `pnpm preview` | Build then start (same port as dev) | `package.json:18`; `README.md:46-50` |
| `pnpm test` | `vitest run` — all packages + apps/web | `package.json:19` |
| `pnpm test:watch` | Vitest watch mode | `package.json:20` |
| `pnpm typecheck` | `pnpm -r --parallel typecheck` | `package.json:21` |
| `pnpm format` | Prettier write | `package.json:22` |
| `pnpm format:check` | Prettier check | `package.json:23` |
| `pnpm --filter web build` | Build standalone Next.js output | `README.md` |
| `pnpm desktop:build` (root) | → `pnpm --filter desktop build:app` (Tauri release build) | `package.json:25`; `desktop/package.json:10` |
| `pnpm desktop:build:debug` (root) | → `pnpm --filter desktop build:debug` | `package.json:24`; `desktop/package.json:12` |
| `pnpm tauri dev` (**from `desktop/`**) | Tauri desktop dev | `desktop/package.json:8`; `AGENTS.md:89` |
| `pnpm build:app` (**from `desktop/`**) | Tauri standalone `.exe` (release) | `desktop/package.json:10`; `AGENTS.md:97` |
| `pnpm setup:sidecar` (**from `desktop/`**) | Download + verify the Node sidecar | `desktop/package.json:14`; `desktop/README.md:25` |
| `docker compose up -d` | Docker deployment | `README.md:64`; `docker-compose.yml:2-14` |

**CI pipeline order** (`.github/workflows/ci.yml:20-25`): format:check → typecheck → test → `node scripts/check-licenses.mjs` → package builds → app build.

**Evidence:** `AGENTS.md` §Development Commands; `package.json:14-26`; `apps/web/package.json:6-11`; `desktop/package.json:6-18`.

---

## 12. Key Files Reference

| File | Role | Evidence |
|---|---|---|
| `packages/core/src/round-trips.ts` | `buildRoundTrips`, `consumeLots`, `finalizeCycle` — FIFO/LIFO/WAVG | `AGENTS.md` §Important Files |
| `packages/core/src/edge-score.ts` | `computeEdgeScore`, `EDGE_SCORE_VERSION = 2` (`:29`), documented weights | `AGENTS.md` §Important Files; `packages/core/src/edge-score.ts:29` |
| `packages/core/src/metrics.ts` | `computeMetrics`, realized-R, profit factor | `AGENTS.md` §Important Files |
| `packages/importers/src/detect.ts` | `parseAuto`, `detectFormat`, `FORMATS` registry (`:40`) | `AGENTS.md` §Important Files; `packages/importers/src/detect.ts:40` |
| `packages/importers/src/formats/fills.ts` | `makeFillsFormat`, `rowsToFills` — declarative column spec | `AGENTS.md` §Important Files |
| `packages/importers/src/formats/history.ts` | Bridge from the fill-format layer into the history-import pipeline | `packages/importers/src/formats/history.ts:1` |
| `packages/importers/src/history/import.ts` | `importTradeHistory()` — adapter dispatch for historical statements | `packages/importers/src/history/import.ts:1-6` |
| `apps/web/src/db/schema.ts` | Full Drizzle schema | `AGENTS.md` §Important Files |
| `apps/web/src/db/bootstrap.ts` | `BOOTSTRAP_SQL` idempotent DDL + `ALTER TABLE` guards | `AGENTS.md` §Important Files |
| `apps/web/src/db/index.ts` | Drizzle singleton + SQLite WAL/pragma configuration | `apps/web/src/db/index.ts:81-137` |
| `apps/web/src/server/executions.ts` | `insertExecutions`, `partitionExecutions`, `executionProblem` | `AGENTS.md` §Important Files |
| `apps/web/src/server/rebuild.ts` | `rebuildAccount` — reads execs, builds round-trips, upserts by key | `AGENTS.md` §Important Files; `apps/web/src/server/rebuild.ts:49-75` |
| `apps/web/src/server/sync.ts` | Broker sync via `@luxalgo/broker-sdk`; `SyncOutcome` | `AGENTS.md:190` |
| `apps/web/src/server/auth.ts` | HMAC session token + `verifySession` — the actual session check | `apps/web/src/server/auth.ts:12-15`, `:23-29` |
| `apps/web/src/server/api.ts` | `handler()` — uniform auth + error JSON | `apps/web/src/server/api.ts:20-39` |
| `apps/web/src/server/ai.ts` + `ai-runtime.ts` + `ai-prompts.ts` + `ai-scope.ts` | AI reflection runtime, tool factory, prompt builders, scope validation | `02-ai-architecture.md` §1 |
| `apps/web/src/server/market-data/` | Provider adapters: `alpaca.ts`, `oanda.ts`, `public-crypto.ts` (binance + coinbase), `london-strategic-edge.ts` (LSE), `csv.ts`, plus `provider.ts`, `http.ts`, `transport.ts`, `estimates.ts`, `connections.ts` | filesystem listing of `apps/web/src/server/market-data/` |
| `apps/web/src/components/dashboard-layout.tsx` | Drag-to-reorder dashboard cards, saved layouts | `AGENTS.md` §Important Files |
| `apps/web/src/components/shell.tsx` | Sidebar, theme/privacy toggles, page transitions | `AGENTS.md` §Important Files |
| `apps/web/src/components/charts/tokens.ts` | Resolves Tailwind/CSS vars for ECharts canvas | `AGENTS.md` §Important Files |
| `scripts/check-licenses.mjs` | Allowlist CI gate | `AGENTS.md` §Important Files; `.github/workflows/ci.yml:23` |
| `scripts/verify-features.py` | E2E HTTP smoke against disposable journal | `AGENTS.md` §Important Files |
| `scripts/benchmark-journal.py` | Latency benchmarks on `/api/stats`, `/api/analysis`, etc. | `AGENTS.md` §Important Files |
