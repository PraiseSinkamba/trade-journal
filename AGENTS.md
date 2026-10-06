# Repository Guidelines

A self-hosted trade-journal monorepo. Three packages — a pure domain engine, broker-statement importers, and a Next.js 15 app — share one workspace.

## Project Overview

`trade-journal` is an open-source personal trading journal:

- Round-trip engine, performance metrics, calendar, **Edge Score** (documented formula, versioned) — pure TypeScript, zero runtime deps (`packages/core`).
- Statement importers for 12+ broker formats + a generic column mapper (`packages/importers`).
- Next.js 15 app with SQLite (Drizzle/better-sqlite3), broker sync, daily journal, AI reflection (Anthropic/OpenAI), prop-firm tracker (`apps/web`).

The published engine + importers are framework-free; the app renders, does not compute. No hosted-service assumptions, no telemetry.

## Architecture & Data Flow

**One primitive drives everything:** a raw `Execution` (single fill) → `RoundTrip` (flat-to-flat position cycle) → metrics / Edge Score.

```
executions (broker-sync | import | manual)
   └─→ @luxalgo/journal-core: buildRoundTrips
         └─→ materialized `trades` table (rebuild-stable key)
               ├─→ dashboard / reports / calendar
               ├─→ daily journal + AI recaps
               ├─→ Edge Score (v2)
               └─→ trade replay + estimated MAE/MFE (market data optional)
```

Key contracts:

- **`Execution`** is the atomic fact (`packages/core/src/types.ts`). Mutations never come from analytics.
- **`RoundTrip`** carries `key = accountId|symbol|direction|openedAt[|importGroup][|N]`. Rows are upserted by key — annotations (notes, tags, rating, stop/target, playbook, reviewed) survive rebuilds.
- **Trade key stability** is the bridge between user-authored review and the recomputed math; never encode non-identity facts (labels, account balance) into keys.
- **Total P&L of a cycle is method-independent**; FIFO / LIFO / WAVG only change per-exit attribution (`packages/core/src/round-trips.ts`).
- **Crossing-flat fills split into two trades**; fee is split pro-rata by quantity (`round-trips.test.ts` invariant).

App boundaries:

- `apps/web/src/server/` — DB writes, rebuild, sync, AI, prop firm, market data (Node-only).
- `apps/web/src/app/api/*/route.ts` — thin route handlers wrapped in `handler(...)` from `src/server/api.ts` (uniform auth + error JSON).
- `apps/web/src/components/` + `apps/web/src/app/<route>/page.tsx` — React + Radix UI + Tailwind v4 + ECharts/Recharts.
- `apps/web/src/lib/` — pure client helpers (filters, dashboard layout, formatters, AI settings).

## Key Directories

| Path | Purpose |
| --- | --- |
| `packages/core/src/` | Domain engine: `types.ts`, `round-trips.ts`, `metrics.ts`, `equity.ts`, `aggregate.ts`, `analysis.ts`, `edge-score.ts`, `time.ts`, `adherence.ts`. Public exports via `src/index.ts`. |
| `packages/importers/src/` | Parsers: `csv.ts`, `dates.ts`, `numbers.ts`, `types.ts`, `formats/{fills,simple,metatrader,ibkr,thinkorswim,tradezella,ninjatrader,generic,history}.ts`, `history/adapters/{adapter,generic,metatrader,mt5deals,tradingview}.ts`. |
| `apps/web/src/db/` | Drizzle schema (`schema.ts`), idempotent `BOOTSTRAP_SQL` (`bootstrap.ts`), singleton SQLite client (`index.ts`). |
| `apps/web/src/server/` | Server-only logic: `api.ts`, `auth.ts`, `crypto.ts`, `executions.ts`, `rebuild.ts`, `sync.ts`, `settings.ts`, `ai*.ts`, `ninjatrader-{import,order}.ts`, `prop-firms.ts`, `market-data/`, `ibkr-sync-timezone.ts`. |
| `apps/web/src/app/api/<resource>/route.ts` | One route handler per resource. ~24 resources: `trades`, `executions`, `import`, `stats`, `analysis`, `journal`, `ai/{recap,critique,ask}`, `market-data`, `prop-firms`, `brokers`, etc. |
| `apps/web/src/components/charts/` | ECharts/canvas wrappers (`tokens.ts` reads CSS variables). |
| `apps/web/src/components/ui/` | Radix-based primitives (button, dialog, dropdown, table, tabs, tooltip, calendar, date-picker, …). |
| `apps/web/tests/` | 54 Vitest files for web logic (auth, importer integration, AI feedback, dashboard, market data, prop firms, …). |
| `packages/core/tests/`, `packages/importers/tests/` | Engine + importer unit tests. |
| `docs/` | Public guides: `edge-score.md`, `importers.md`, `market-data.md`, `prop-firms.md`, `design.md`, `calendar-insights.md`, `performance-trends.md`, `trade-explorer.md`, `ai-scope.md`, `samples/`, plus the live-learning docs `MISTAKES.md` (raw ledger) and `LEARNINGS.md` (distilled principles) — see the **Live learning workflow** below. |
| `scripts/` | `check-licenses.mjs` (CI gate), `verify-features.py`, `benchmark-journal.py`. |

## Development Commands

> **Node ≥ 22**, **pnpm 11.0.8** (pinned in `packageManager`). Use `corepack enable` once.

```bash
pnpm install --frozen-lockfile   # workspace install
pnpm dev                         # Next dev (Turbopack) on :3000
pnpm build                       # Next production build
pnpm start                       # serve an existing build
pnpm preview                     # build then start, same port as dev
pnpm test                        # vitest run (all packages + apps/web tests)
pnpm test:watch                  # vitest watch
pnpm typecheck                   # pnpm -r --parallel typecheck
pnpm format / pnpm format:check  # prettier
```

Per-package:

```bash
pnpm --filter @luxalgo/journal-core build     # tsup, emits dist/
pnpm --filter @luxalgo/journal-importers build
```

### Desktop (Tauri)

From `desktop/`. The Tauri window wraps the Next.js dev server at `http://localhost:3000` (set in `tauri.conf.json → devUrl`).

```bash
# Run in dev (debug build, file watcher, sidecar Node 22.11.0)
pnpm tauri dev
# Builds take ~1-3 min the first time (Rust), seconds after.

# Build standalone .exe (debug, no installer, fast)
pnpm build:debug
# → desktop/src-tauri/target/debug/trade-journal-desktop.exe

# Build standalone .exe (release, optimized)
pnpm build:app
# → desktop/src-tauri/target/release/trade-journal-desktop.exe

# Build full installers (MSI + NSIS) for distribution
pnpm build
# → target/release/bundle/{msi,nsis}/Trade Journal_0.1.0_x64_*.{msi,exe}
```

**Dev workflow for a feature:**

1. Web-side change (`apps/web/`) — `pnpm dev` (or `pnpm --filter web dev`) auto-reloads via Turbopack.
2. Tauri-side change (`desktop/src-tauri/src/`) — `pnpm tauri dev` rebuilds and relaunches incrementally.
3. `packages/core` change — both web and Tauri rebuild since the package is consumed by both.

**Test the webapp without the Tauri shell:** `pnpm --filter web dev`, then open `http://127.0.0.1:3000` in a regular browser.

**Sidecar Node runtime**: Tauri spawns `desktop/src-tauri/binaries/node-x86_64-pc-windows-msvc.exe` (Node 22.11.0 LTS) to run the standalone Next.js server inside the app. The dev URL points to the same port — make sure no other process holds `:3000` before launching `tauri dev`.

Docker:

```bash
docker compose up -d    # http://localhost:3000, ./data persisted
```

Useful env (`apps/web/.env.local` or process env):

- `JOURNAL_PASSWORD` — gate the UI + API (HMAC session cookie).
- `JOURNAL_SECRET` — derive AES-256-GCM key for credentials at rest (else random `.secret` file in data dir).
- `JOURNAL_DATA_DIR` — SQLite + attachments location (default `./data`).
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — optional, override saved keys.

CI gate (`.github/workflows/ci.yml`) runs, in order: `format:check`, `typecheck`, `test`, `node scripts/check-licenses.mjs`, package builds, app build.

## Code Conventions & Common Patterns

### Formatting / structure

- **Prettier** (`printWidth: 100`); do not hand-format.
- **TypeScript strict** with `noUncheckedIndexedAccess: true` — every `arr[i]` is `T | undefined`. Use `!` only when the index is provably in range (e.g. `group[0]!` after a `find(...)`/non-empty check).
- ESM-only. Workspace packages have `"sideEffects": false` and ship raw `src/index.ts` during development (`"main": "./src/index.ts"`).
- Per-package `tsconfig.json` extends `tsconfig.base.json`.

### Naming

- Domain identifiers are camelCase: `tradeKey`, `executedAt`, `profitFactor`, `breakevenTolerance`.
- File names use lowercase kebab in components (`add-trade-dialog.tsx`) and module names in `server/`/`lib/` (`executions.ts`, `ibkr-sync-timezone.ts`).
- DB columns snake_case; Drizzle maps them to camelCase TS fields.

### Error handling

- API handlers use `handler(fn)` from `apps/web/src/server/api.ts`. Throw `new RequestError(msg)` for 400; any other thrown error becomes a JSON 500. Handlers also enforce auth unless `{ public: true }` (login, `/api/auth`).
- Use `requireValue(condition, msg)` for assertion-style guards — works inside `handler` and inside transactions.
- Never leak provider payloads, key fragments, or stack traces to clients. The AI path translates `APICallError` into plain-language categories (`runAi` in `server/ai.ts`); `aiFeedback` maps to UI-friendly notices without echoing raw text.
- Persistence is transactional: `insertExecutions`, `rebuildAccount`, `mutateProp`, `commitNinjaTraderImport` run inside `db.transaction(...)` (often `behavior: "immediate"`). Combine inserts + rebuild in one tx so a failure can't leave executions without trades.

### Async / state

- Server code is fully async; prefer `await` + Drizzle's typed query builder. Use `db.transaction((tx) => …)` to share a tx across helpers (pass `tx` explicitly).
- React components are `"use client"` only when they use hooks / events; server components stay synchronous and call `useApi` via Suspense.
- `useApi(url)` from `lib/use-api.ts` deduplicates in-flight GETs and aborts when the last subscriber leaves. Never cache completed financial data in a global; the dashboard and reports re-fetch.
- `useAutosave(url, method)` coalesces rapid edits and flushes on unmount / `beforeunload`. Failed writes keep the latest fields for retry.
- Data fetches render as `startTransition` so the page paints progressively; the dashboard, trades list, and calendar rely on this.

### Dependency injection / boundaries

- All broker connectivity goes through `@luxalgo/broker-sdk` (`connect`, `listBrokers`). Never call a broker API directly. Adding a broker means proposing against that repo.
- Credentials are stored AES-256-GCM (`apps/web/src/server/crypto.ts`). The key is `scryptSync(JOURNAL_SECRET, …, 32)` or a random 256-bit key file in the data dir.
- AI keys are stored per-provider in the encrypted settings store; env vars override saved values and are themselves not persisted (`server/settings.ts`).
- `Execution` dedup uses `executionHash()` (SHA-256 of symbol+side+qty+price+time, optionally importMetadata). Uniqueness is `(account_id, content_hash)` — a unique index.

### State / data model

- SQLite WAL mode, `foreign_keys = ON`. Additive schema upgrades live in `db/index.ts` as `ALTER TABLE` guards; the canonical DDL is `BOOTSTRAP_SQL` in `db/bootstrap.ts`.
- The trade key lets the app overwrite computed columns on rebuild without touching user annotations. Never change the key format without a migration.
- `importMetadata` (id, group, order, preserveFee, reportedGrossPnl, ninjaTrader…) is a source-provenance blob — preserved verbatim through the round-trip engine so reconstruction stays deterministic.

### Timezones

- Two settings: `timeZone` (display) and `importTimeZone` (parsing). Default import zone falls back to display zone until the user explicitly sets it.
- All bucketing uses `dayKeyOf(iso, tz)` / `monthKeyOf` / `weekdayOf` / `hourOf` — DST-safe via `Intl.DateTimeFormat`.
- IBKR sync stores the statement zone on `accounts.ibkr_sync_time_zone`; `assertIbkrSyncTimeZone` blocks writes that would mix zones inside one account.

## Important Files

- `packages/core/src/round-trips.ts` — `buildRoundTrips`, `consumeLots`, `finalizeCycle`, `compareExecutions` (deterministic total order: time → importOrder → id).
- `packages/core/src/edge-score.ts` — `computeEdgeScore`, `EDGE_SCORE_VERSION = 2`, `EDGE_SCORE_WEIGHTS`. Six components × documented thresholds.
- `packages/core/src/metrics.ts` — `computeMetrics`, realized-R, profit factor (Infinity → `profitFactorIsInfinite`).
- `packages/core/src/analysis.ts` — `FILTER_KEYS`, `readFilters`, `matchesFilters`, `tradeR`, `plannedR`, `clockTime`.
- `packages/importers/src/detect.ts` — `parseAuto`, `detectFormat`, `FORMATS` (legacy + history path; route logic in one place).
- `packages/importers/src/formats/fills.ts` — `makeFillsFormat`, `rowsToFills`, `parseSide` — declarative column spec for CSV fills.
- `apps/web/src/db/schema.ts` + `bootstrap.ts` — full Drizzle schema and idempotent SQL.
- `apps/web/src/server/executions.ts` — `insertExecutions`, `partitionExecutions`, `executionProblem`, `InsertResult`. Manual entry is strict; sync/import only partitions out unusable rows.
- `apps/web/src/server/rebuild.ts` — `rebuildAccount`: read executions → `buildRoundTrips` → upsert `trades` by key → delete obsolete rows in batches of 500 (SQLite bind-param limit).
- `apps/web/src/server/sync.ts` — broker sync via `@luxalgo/broker-sdk`; IBKR timezone guard; immediate transaction; returns `SyncOutcome` (inserted / duplicates / skipped / equity / positions).
- `apps/web/src/server/ai.ts` + `apps/web/src/server/ai-import.ts` + `apps/web/src/server/ai-scope.ts` — BYO-key AI reflection: session recaps, trade critiques, ask-your-journal, AI-assisted statement parsing (PDF + text).
- `apps/web/src/server/market-data/` — provider adapters (`alpaca`, `oanda`, `binance`, `coinbase`, `london-strategic-edge`, `csv`), `transport.ts`, `http.ts`, `estimates.ts`.
- `apps/web/src/components/dashboard-layout.tsx` — `DashboardLayout` (dnd-kit drag-to-reorder, saved layouts, motion-reduced path).
- `apps/web/src/components/shell.tsx` — sidebar, theme/privacy toggles, page transitions.
- `apps/web/src/components/charts/tokens.ts` — resolves Tailwind/CSS variables for ECharts (canvas).
- `apps/web/next.config.ts` — `output: "standalone"`, `transpilePackages: ["@luxalgo/journal-core", "@luxalgo/journal-importers"]`, `serverExternalPackages: ["better-sqlite3"]`, excludes `./data/**` from tracing.
- `apps/web/src/middleware.ts` — gates routes when `JOURNAL_PASSWORD` is set (cookies re-verified in API handlers with HMAC).
- `scripts/check-licenses.mjs` — allowlist + per-package exceptions; CI-fatal.
- `scripts/verify-features.py` — end-to-end HTTP smoke against a disposable loopback journal (separate `JOURNAL_DATA_DIR`, port ≠ 3000/3001).
- `scripts/benchmark-journal.py` — median latency on `/api/stats`, `/api/analysis`, `/api/adherence`, `/api/trades` (1–30 samples).

## Live learning workflow

Two live docs capture what we learn the hard way:

- **`docs/MISTAKES.md`** — raw ledger. One entry per concrete mistake
  with symptom, cause, fix, and date. New entries go on top.
- **`docs/LEARNINGS.md`** — distilled principles. When a mistake becomes
  a general rule (not just a one-off patch), promote it. One entry per
  principle, organized by domain, linking back to the mistakes that
  produced it.

**Rules of the road** (enforced when editing either file):

1. **When you make a mistake, log it in `MISTAKES.md` immediately** —
   same turn, before you forget. Symptom + cause + fix + date.
2. **When you know the general principle behind a fix** (not just the
   patch), promote the entry to `LEARNINGS.md`. Edit the mistake entry
   in `MISTAKES.md` to point to the new learning (replace the fix
   description with `See LEARNINGS.md → "<principle name>"`).
3. **If a learning's underlying mistake recurs** after promotion,
   escalate it to a hard rule — a pre-commit hook, an `AGENTS.md`
   invariant, or a dedicated skill. The hard rule's text goes in
   `LEARNINGS.md` under "Hard rules (codified from recurring
   mistakes)" with a link to the codification (skill name, hook path,
   or `AGENTS.md` section).
4. **The "next" implementation of the workflow** lives in
   `scripts/` if a recurring mistake ever justifies automation; a
   hook is preferred over a doc-only check.
5. **The docs are not aspirational.** Every entry must trace to a
   real symptom the next reader can recognize. Speculative content
   goes elsewhere (e.g. a comment in the relevant code, a PR
   description, or `docs/design.md`).

**Update cadence**: mistakes are added in the turn they happen;
promotions happen at natural review points (end of a feature, end
of a debugging session, before a release). Don't batch — small
append-only edits keep the diffs clean.

**How this connects to other rules**:

- The `MISTAKES.md` ↔ `LEARNINGS.md` flow is the *mechanism*; the
  *content* lives in domain-specific docs (`importers.md`,
  `market-data.md`, `design.md`, …). If a learning is large enough
  to need its own narrative section, link it from the relevant domain
  doc rather than duplicating.
- New skills or hooks reference their motivating mistakes in the
  skill's frontmatter, creating a chain of provenance:
  `MISTAKES.md` → `LEARNINGS.md` → skill/hook.

## Runtime / Tooling Preferences

- **Runtime:** Node 22+. Production image is `node:22-slim` (see `Dockerfile`). `pnpm 11.0.8` via `packageManager` field.
- **Package manager:** pnpm workspaces (`pnpm-workspace.yaml` lists `packages/*` and `apps/*`). `allowBuilds` whitelist esbuild + better-sqlite3; `sharp` is in `ignoredOptionalDependencies`.
- **No** Turborepo / Nx — workspace scripts are direct pnpm filters.
- **Next config:** `output: "standalone"` (Docker-friendly), Turbopack dev, workspace packages are transpiled by Next.
- **DB driver:** better-sqlite3 must be marked `serverExternalPackages` (already configured). Use `db.transaction(..., { behavior: "immediate" })` when writing across tables.
- **Long-running processes / watchers / REPLs**: do NOT spawn via raw `bash` — use `hub` (`op:"start"`). Examples worth knowing: `pnpm dev` (long-lived Next dev server), `python3 scripts/verify-features.py --base-url http://127.0.0.1:3002`.
- **Lockfile:** `pnpm-lock.yaml` — `--frozen-lockfile` is mandatory in CI.
- **No telemetry:** `NEXT_TELEMETRY_DISABLED=1` in the Dockerfile; `set NEXT_TELEMETRY_DISABLED=1` locally if desired.

## Testing & QA

- **Framework:** Vitest. Root `vitest.config.ts` aliases `@` → `apps/web/src` and picks up `packages/*/tests/**/*.test.ts` + `apps/*/tests/**/*.test.ts`.
- **Per package:** `packages/core/tests/` (5 files — round-trips, metrics, analysis, helpers, overview regression) and `packages/importers/tests/` (5 files + `fixtures/`).
- **App-level:** `apps/web/tests/` — 54 unit/integration tests cover auth (mocked `next/headers`), AI feedback mapping, importer integration, dashboard layout, market data, prop firms, broker sync resilience, etc.
- **Tests defend product invariants, not implementations** (see `CONTRIBUTING.md`). Examples: "a fill that crosses through flat splits into two trades", "FIFO and LIFO attribute a partial exit to different entry lots", "AI feedback never echoes raw provider payloads".
- **Run:** `pnpm test` (CI runs once with `--run`). Watch with `pnpm test:watch`. Don't run project-wide suites inside subagents — they belong at the end of a slice.
- **E2E smoke (CI/manual):** start Next dev or `pnpm preview`, then `python3 scripts/verify-features.py --base-url http://127.0.0.1:<port>` against a disposable data dir. `scripts/benchmark-journal.py` measures warm read latency.
- **Demo data:** the empty dashboard offers "Load demo data" (~90 days of synthetic trades); the Prop firms page has its own read-only preview that does not write financial records.
