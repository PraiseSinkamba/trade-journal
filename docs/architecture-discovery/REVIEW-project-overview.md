# Project Overview Report — Review

Reviewed: `docs/architecture-discovery/01-project-overview.md` (558 lines)
Method: every concrete claim (technology, version, file path, line number) re-read against source; Mermaid diagram component names cross-checked against the tree; all cross-document `ARCH-0xx` citations resolved.

## Overall Verdict

**FAIL**

Substantive content is mostly right — the technology stack, versions, workspace layout, architectural conventions, and constraints are accurate. But the report's stated contract is *"verified against source (file:line)"*, and the evidence trail is systematically broken: **~30 of the ~45 file:line citations point at the wrong line** (values correct, citations off by 3–38 lines), **two claims are factually false** (`NEXT_TELEMETRY_DISABLED` in Dockerfile; "~24 API routes" vs. 43 actual), **one security-relevant mechanism is misattributed** (HMAC session validation attributed to `middleware.ts`), and **the importers directory tree is materially wrong** (wrong nesting, three missing source files).

Severity is not uniform: §7 (conventions), §12 (key files), §10 (constraints), §3 (diagram) are trustworthy; §2 (stack tables), §4 (directory map), §6 (environments), §11 (commands) need correction.

---

## Findings table

| ID | Claim | Report states | Actual source | Status | Notes |
|----|-------|---------------|---------------|--------|-------|
| ARCH-501 | Runtime Node ≥ 22 | `package.json:8` | `package.json:10-12` (`"node": ">=22"` at 11) | **WRONG** (citation) | Value correct; line wrong. |
| ARCH-502 | pnpm 11.0.8 | `package.json:9` | `package.json:13` | **WRONG** (citation) | Value correct. |
| ARCH-503 | Production image `node:22-slim` | `Dockerfile:1` | `Dockerfile:2` (`FROM node:22-slim AS builder`); also `:13` (runner) | **WRONG** (citation) | Two-stage build, both stages `node:22-slim`. |
| ARCH-504 | Workspace members = `packages/*`, `apps/*`, `desktop` | `pnpm-workspace.yaml:1-5` | `pnpm-workspace.yaml:1-4` | PARTIALLY | Range off by one; `desktop` is an explicit entry, not a glob. |
| ARCH-505 | `scripts/` is a workspace member (shown inside the workspace tree in §2.2) | shown in monorepo tree | `pnpm-workspace.yaml:1-4` — members are `packages/*`, `apps/*`, `desktop` only | **WRONG** | `scripts/` is a plain directory, not a pnpm workspace package. Also `pnpm-workspace.yaml` omits the `minimumReleaseAgeExclude` block (lines 10–14). |
| ARCH-506 | Root package name | `package.json:1` | `package.json:2` (`"name": "trade-journal-monorepo"`) | **WRONG** (citation) | |
| ARCH-507 | TypeScript `^5.9.0` (core) | `package.json:18` | root `package.json:32` | **WRONG** (citation) | Also: TypeScript is **not** declared in `packages/core/package.json` (root devDep only). |
| ARCH-508 | Core module system ESM | `packages/core/package.json:6` | `packages/core/package.json:6` (`"type": "module"`) | CONFIRMED | |
| ARCH-509 | Core typecheck `tsc --noEmit` | `packages/core/package.json:20` | `packages/core/package.json:35` | **WRONG** (citation) | Value correct. |
| ARCH-510 | Build tool tsup `^8.5.1` | `package.json:17` | root `package.json:31` | **WRONG** (citation) | |
| ARCH-511 | Core has zero runtime deps | `packages/core/package.json` (no `dependencies` block) | `packages/core/package.json` — no `dependencies`/`devDependencies`/`peerDependencies` keys at all | CONFIRMED | Also `sideEffects: false`, no `node:` imports in `src/` — purity claim holds. |
| ARCH-512 | Core "fully unit-tested" | `packages/core/tests/` (5 files) | `packages/core/tests/`: `analysis.test.ts`, `metrics.test.ts`, `overview-regression.test.ts`, `round-trips.test.ts`, `helpers.ts` | PARTIALLY | 4 test files + 1 shared helper, not 5 test files. |
| ARCH-513 | Importers TS `^5.9.0` | `package.json:18` | root `package.json:32` | **WRONG** (citation) | |
| ARCH-514 | Importers ESM | `packages/importers/package.json:6` | `packages/importers/package.json:6` | CONFIRMED | |
| ARCH-515 | Importers runtime dep `@luxalgo/journal-core workspace:*` | `packages/importers/package.json:25` | `packages/importers/package.json:39-41` (dep at `:40`) | **WRONG** (citation) | Only runtime dep; zero third-party. |
| ARCH-516 | Next.js `15.5.23` | `apps/web/package.json:5` | `apps/web/package.json:43` | **WRONG** (citation) | Value correct. |
| ARCH-517 | apps/web TypeScript `^5.9.0` | `apps/web/package.json:38` | not present in `apps/web/package.json` | **WRONG** | `apps/web` has **no** `typescript` dependency; TS is root-only. `apps/web` typecheck is `next typegen && tsc --noEmit` (`:10`). |
| ARCH-518 | React `^19.1.0` | `apps/web/package.json:8,11` | `apps/web/package.json:45` (react), `:47` (react-dom) | **WRONG** (citation) | |
| ARCH-519 | better-sqlite3 `^12.2.0` | `apps/web/package.json:13` | `apps/web/package.json:35` | **WRONG** (citation) | |
| ARCH-520 | drizzle-orm `^0.45.2` | `apps/web/package.json:17` | `apps/web/package.json:40` | **WRONG** (citation) | |
| ARCH-521 | `ai` `^7.0.77` | `apps/web/package.json:14` | `apps/web/package.json:34` | **WRONG** (citation) | |
| ARCH-522 | `@ai-sdk/anthropic` `^4.0.41` | `apps/web/package.json:2` | `apps/web/package.json:13` | **WRONG** (citation) | |
| ARCH-523 | `@ai-sdk/openai` `^4.0.64` | `apps/web/package.json:3` | `apps/web/package.json:15` | **WRONG** (citation) | |
| ARCH-524 | `@ai-sdk/mcp` `^2.0.73` | `apps/web/package.json:4` | `apps/web/package.json:14` | **WRONG** (citation) | |
| ARCH-525 | `@luxalgo/broker-sdk` `0.5.1` | `apps/web/package.json:6` | `apps/web/package.json:19` | **WRONG** (citation) | |
| ARCH-526 | Charting: Vela `^0.6.8`, ECharts `^6.1.0`, Recharts `^3.10.1` | `apps/web/package.json:7,18,34` | `apps/web/package.json:22, 41, 49` | **WRONG** (citation) | Values correct. |
| ARCH-527 | TanStack Table `^9.1.2` | `apps/web/package.json:12` | `apps/web/package.json:33` | **WRONG** (citation) | |
| ARCH-528 | Radix UI — **11 packages**, range `^1.3.x–2.3.x` | `apps/web/package.json:15,19–27` | `apps/web/package.json:24-32` — **9 packages**: checkbox `^1.3.11`, dialog `^1.1.23`, dropdown-menu `^2.1.24`, label `^2.1.15`, popover `^1.1.23`, select `^2.3.7`, slot `^1.3.3`, tabs `^1.1.21`, tooltip `^1.2.16` | **WRONG** | Count is 9, not 11. Stated range is also wrong at both ends (actual low `^1.1.21`, high `^2.3.7`). |
| ARCH-529 | Tailwind v4 `^4.3.3` | `apps/web/package.json:40` | `apps/web/package.json:61` (devDep; paired with `@tailwindcss/postcss ^4.3.3` `:55`) | **WRONG** (citation) | |
| ARCH-530 | pdf-lib `^1.17.1` | `apps/web/package.json:10` | `apps/web/package.json:44` | **WRONG** (citation) | |
| ARCH-531 | date-fns `^4.4.0` | `apps/web/package.json:16` | `apps/web/package.json:39` | **WRONG** (citation) | |
| ARCH-532 | Zod `^3.25.76` | `apps/web/package.json:47` | `apps/web/package.json:52` | **WRONG** (citation) | Value correct (Zod v3, not v4). |
| ARCH-533 | @dnd-kit core `6.3.1` / sortable `10.0.0` | `apps/web/package.json:5-6` | `apps/web/package.json:17-18` | **WRONG** (citation) | |
| ARCH-534 | @base-ui/react `^1.9.0` | `apps/web/package.json:4` | `apps/web/package.json:16` | **WRONG** (citation) | |
| ARCH-535 | §2.5 table is a complete dependency picture | (implied) | `apps/web/package.json` also has `react-dom`, `react-markdown`, `remark-gfm`, `react-day-picker`, `lucide-react`, `class-variance-authority`, `clsx`, `cn`, `tailwind-merge`, `@pdf-lib/fontkit` | PARTIALLY | §2.5 and §9 both omit 10 runtime deps. |
| ARCH-536 | tsconfig.base.json content | quoted block, `tsconfig.base.json:1-13` | `tsconfig.base.json:1-16`; settings at `:3-14` | PARTIALLY | Quoted JSON values are byte-accurate; line range is wrong. |
| ARCH-537 | Build allowlist: only `esbuild` + `better-sqlite3`; `sharp` ignored | `pnpm-workspace.yaml:7-12` | `pnpm-workspace.yaml:5-9` (`allowBuilds` `:5-7`, `ignoredOptionalDependencies` `:8-9`) | PARTIALLY | Claim true; range wrong. Report omits `minimumReleaseAgeExclude` (`:10-14`) — a real pnpm policy in the same file. |
| ARCH-538 | Mermaid: "~24 API routes" | `~24 API routes` | **43** `route.ts` files under `apps/web/src/app/api/` | **WRONG** | Understates by ~80%. Also §4 repeats "~24 route handlers". |
| ARCH-539 | Mermaid/§3: ingestion = "14 Statement Formats" | `14 Statement Formats` | `packages/importers/src/detect.ts:40` — `FORMATS = [...LEGACY_FORMATS (13 entries, :24-38), historyFormat]` = 14 | CONFIRMED | |
| ARCH-540 | Mermaid: core surface (`buildRoundTrips`, `computeMetrics`, `computeEdgeScore`, aggregate/equity, `matchesFilters`/`tradeR`) | diagram nodes | `packages/core/src/{round-trips,metrics,edge-score,aggregate,equity,analysis}.ts` — all exports present (`bySymbol`/`byWeekday`/`byMonth`/`calendarMonth`, `equityCurve`/`dailyStats`/`dailyCumulative`, `FILTER_KEYS`/`matchesFilters`/`tradeR`) | CONFIRMED | `EDGE_SCORE_VERSION = 2` at `edge-score.ts:29`. |
| ARCH-541 | Mermaid output surfaces (Dashboard, Calendar, Reports, Daily Journal, Trade detail, Prop tracker, AI Ask/Recap/Critique/Reports) | diagram | `apps/web/src/app/` pages + `app/api/ai/{ask,recap,critique,reports}/route.ts` | CONFIRMED | |
| ARCH-542 | §4 importers tree | `src/{index,detect,csv,dates,numbers,types}.ts`; `formats/{fills,simple,metatrader,ibkr,thinkorswim,tradezella,ninjatrader,generic}.ts`; `formats/history/{adapters/,generic,metatrader,mt5deals,tradingview}` | actual `src/`: adds **`position-fills.ts`**; `formats/` adds **`history.ts`**, **`pepperstone.ts`**; **`history/` is a sibling of `formats/`, not nested under it**, and contains `import.ts`, `model.ts`, `csv.ts`, `html.ts`, `aliases.ts`, `timestamps.ts`, `reconstruct.ts`, `adapters/{adapter,generic,metatrader,mt5deals,tradingview}.ts` | **WRONG** | Three missing source files, wrong nesting, 7 unlisted modules. Also two parallel pipelines exist (`formats/*` → fills; `history/*` → reconstructed trades, bridged by `formats/history.ts`) — architecturally significant and omitted. |
| ARCH-543 | §4 `api/` subdirectory list | includes `notebooks/`, `sync/`; lists 16 dirs | actual `app/api/`: `accounts, adherence, ai, analysis, attachments, auth, brokers, calendar, demo, executions, export, folders, import, journal, market-data, notes, performance-trends, playbooks, prop-firms, settings, stats, trade-explorer, trades, workspace` (24 dirs) | **WRONG** | `notebooks/` and `sync/` **do not exist** as API dirs (page dir is `app/notebook/`); 9 existing dirs omitted (`attachments`, `calendar`, `demo`, `export`, `folders`, `notes`, `performance-trends`, `trade-explorer`, `workspace`). |
| ARCH-544 | §4 `apps/web/src/` tree | lists `middleware.ts, server/, components/, app/, db/, lib/` | actual also has **`hooks/`** (`use-mobile.ts`) | PARTIALLY | Omitted directory. |
| ARCH-545 | §4 `server/` tree | lists ~12 files + `market-data/` + `ctrader-mcp/` + `ninjatrader-*.ts` | `apps/web/src/server/` has 25 top-level `.ts` files: adds `ai-contracts.ts`, `ai-report-context.ts`, `trades-query.ts`, `prop-csv.ts`, `position-import.ts`, `demo.ts`, `currency-conversion.ts`, `ids.ts`, `ibkr-sync-timezone.ts`, `ninjatrader-order.ts` | PARTIALLY | 10 files omitted. |
| ARCH-546 | §4/§12 market-data providers = "alpaca, oanda, binance, coinbase, lse, csv" | listed as per-provider files | `market-data/` files: `alpaca.ts`, `oanda.ts`, `csv.ts`, `public-crypto.ts` (holds `binance` + `coinbase`), `london-strategic-edge.ts` (`LSE_API_KEY`), `transport.ts`, `http.ts`, `estimates.ts`, `connections.ts`, `provider.ts` | PARTIALLY | Provider set is right; `binance`/`coinbase` are not separate files, and `lse` should be spelled `london-strategic-edge`. |
| ARCH-547 | §5.1 middleware = "Optional password gate + **HMAC session cookie**" | `middleware.ts:1-28` | `apps/web/src/middleware.ts:1-27` — cookie check is **presence-only** (`request.cookies.get("journal_session")?.value`); inline comment: *"validated for presence here and cryptographically in API handlers — the middleware runtime has no Node crypto"*. HMAC lives in `apps/web/src/server/auth.ts:12-15, 25-28` (`createHmac("sha256", password)`), applied by `handler()` in `server/api.ts` | **WRONG** | Security-relevant misattribution. `AGENTS.md` §Important Files states it correctly ("cookies re-verified in API handlers with HMAC"). All 43 routes use `handler()`. |
| ARCH-548 | §5.2 core `index.ts` export list | 9 `export *` lines quoted | `packages/core/src/index.ts:1-9` — identical | CONFIRMED | |
| ARCH-549 | §5.3 importer entry point | "no src/index.ts listed but `exports["."]` maps to `./src/index.ts`" | `packages/importers/src/index.ts:1-9` exists; `package.json:7-11` maps `main`/`types`/`exports["."]` → `./src/index.ts` | PARTIALLY | Wording is muddled (the file *does* exist and is cited in §4); the substance is right. |
| ARCH-550 | §5.4 Tauri sidecar "Node 24.11.0" | `AGENTS.md` §Desktop (Tauri) / `tauri.conf.json` | `AGENTS.md:88` says **"sidecar Node 22.11.0"**. `24.11.0` appears only in `desktop/README.md` (setup downloads `node-v24.11.0-win-x64.zip`). `tauri.conf.json` contains **no** node version. `devUrl: "http://localhost:3000"` at `tauri.conf.json:8` ✓ | **WRONG** | Source misattributed and the repo is internally inconsistent (AGENTS.md vs desktop/README.md). |
| ARCH-551 | §6 Docker env | `Dockerfile:1-19`; `docker-compose.yml:1-17` | `Dockerfile` = 26 lines; `docker-compose.yml` = 14 lines. Compose: port `3000:3000`, `./data:/data` volume, `JOURNAL_DATA_DIR: /data`, `restart: unless-stopped` | **WRONG** (citation) | Substance correct. |
| ARCH-552 | §8 "Next.js telemetry disabled in Dockerfile via `NEXT_TELEMETRY_DISABLED=1`" | `Dockerfile` / `README.md` §No telemetry | `Dockerfile` contains **no** `NEXT_TELEMETRY_DISABLED`. Repo-wide grep finds it only in `.omp/hooks/pre/telemetry-guard.ts` and `.omp/AGENTS.md` (tooling), never in `Dockerfile`/`docker-compose.yml`. `README.md:288` says "Next.js has its own framework telemetry setting; **set** `NEXT_TELEMETRY_DISABLED=1` to disable it" | **WRONG** | Not set by the project; it is a user-facing recommendation. |
| ARCH-553 | §10 "No telemetry — `NEXT_TELEMETRY_DISABLED=1` set in Dockerfile" | `Dockerfile` | as ARCH-552 | **WRONG** | Same false claim, restated as a hard constraint. |
| ARCH-554 | §8 WAL mode | `db/index.ts:36-38` | `db/index.ts:36` (`journal_mode = WAL`), `:37` (`busy_timeout = 5000`), `:38` (`foreign_keys = ON`) | CONFIRMED | |
| ARCH-555 | §8 `foreign_keys = ON` | `db/index.ts:98-100` | actual: `:99` journal_mode, `:100` busy_timeout, **`:101`** foreign_keys | **WRONG** (citation) | Cited range stops one line short. |
| ARCH-556 | §8 `JOURNAL_DATA_DIR` default `./data` | `README.md`; `docker-compose.yml:9` | `README.md:74` confirms "(default `./data` relative to the app process)"; `docker-compose.yml` sets `JOURNAL_DATA_DIR: /data` | CONFIRMED | Note: code default in `db/index.ts:9` is `/data/trade-journal` — README and code disagree; report follows README. Worth flagging separately. |
| ARCH-557 | §8 `JOURNAL_PASSWORD` gates UI + all API routes | `README.md`; `middleware.ts` | `middleware.ts:10` bypasses entirely when unset; API auth enforced by `handler()` → `verifySession` (`server/api.ts`, `server/auth.ts`) | CONFIRMED | |
| ARCH-558 | §8 credential encryption via `JOURNAL_SECRET` → AES-256-GCM | `README.md` | `README.md:73`; `AGENTS.md:34` (`scryptSync(JOURNAL_SECRET, …, 32)`); `server/crypto.ts` | CONFIRMED | |
| ARCH-559 | §7.2 `APICallError` → 7 plain-language categories in `ai-runtime.ts:60-96` | `ai-runtime.ts:60-96` | `mapAiRuntimeError` defined at `ai-runtime.ts:66`; 7 categories in doc comment `:61-64` — `missing_key, authentication, billing, rate_limited, model_unavailable, timeout, provider` | PARTIALLY | Category count and function confirmed; cited range truncated (function extends to ~`:105`). |
| ARCH-560 | §7.2 `handler(fn)` semantics | `AGENTS.md` §Error handling | `AGENTS.md:147` ✓; `server/api.ts:22-41` — `RequestError` → 400, other → 500, `{ public: true }` opt-out | CONFIRMED | |
| ARCH-561 | §7.3 `useApi` dedupe/abort, `useAutosave` coalesce, `startTransition` | `AGENTS.md` §Async / state | `AGENTS.md:156-158` ✓; `apps/web/src/lib/use-api.ts`, `use-autosave.ts` exist | CONFIRMED | |
| ARCH-562 | §7.4 `db.transaction(..., { behavior: "immediate" })`; `insertExecutions`, `rebuildAccount`, `mutateProp`, `commitNinjaTraderImport` in one tx | `AGENTS.md` §Error handling | `AGENTS.md:150` ✓. `behavior: "immediate"` found at `app/api/accounts/[id]/actions/route.ts:78`, `app/api/accounts/[id]/route.ts:55`, `server/ctrader-mcp/sync.ts:190`, `server/ninjatrader-import.ts:548`, `server/sync.ts:104` | CONFIRMED | |
| ARCH-563 | §7.5 next.config settings with line refs | `next.config.ts:3,4,5,6-9` | `apps/web/next.config.ts:4` output, `:5` transpilePackages, `:6` serverExternalPackages, `:8-10` outputFileTracingExcludes | **WRONG** (citation) | Values correct; all four line refs off by one. Pattern: `./data/**/*` (report writes `./data/**`). |
| ARCH-564 | §10 strict + `noUncheckedIndexedAccess` | `tsconfig.base.json:5-6`; `:6` | `tsconfig.base.json:7` (`strict`), `:8` (`noUncheckedIndexedAccess`) | **WRONG** (citation) | |
| ARCH-565 | §10 "no `import.meta` in sync/broker code" | inferred | grep over `apps/web/src/server/` and `app/api/` → **zero** `import.meta` matches | CONFIRMED | |
| ARCH-566 | §10 "AI tools limited to 4 per agent run — `maxToolCalls: 4`, `maxSteps: 4` enforced in `ai-runtime.ts`" | `ai-runtime.ts` | Values defined in `apps/web/src/server/ai-contracts.ts:47-48` and `:54-55`; enforcement at `ai-runtime.ts:165-167, 177, 195-196, 228-230, 240, 258-259` | PARTIALLY | Numbers correct; file attribution for the constants is wrong. |
| ARCH-567 | §10 "AI never streams — `streamText` not used anywhere" | `02-ai-architecture.md:§8` | grep `streamText` over `apps/web/src/` → **zero** matches; `02-ai-architecture.md:227-237` §8 | CONFIRMED | |
| ARCH-568 | §10 "No persistent chat — no `conversations`/`messages` tables" | `02-ai-architecture.md:§7` | grep `conversations` / `CREATE TABLE messages` over `apps/web/src/db/` → **zero** matches; `02-ai-architecture.md:207-225` §7 | CONFIRMED | |
| ARCH-569 | §10 execution immutability / trade key / annotations survive rebuild / prop ledger separate | `03-domain-model.md:ARCH-059 / 065 / 067 / 078` | All four IDs exist in `03-domain-model.md:66, 114, 119, 261` and say what the report claims | CONFIRMED | Cross-doc citations resolve. |
| ARCH-570 | §10 "AI BYO-key `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`" | `README.md` env table | `README.md:75-76` ✓ | CONFIRMED | |
| ARCH-571 | §11 script line refs (`package.json:5-13` and per-command) | dev `:5`, build `:6`, test `:7`, test:watch `:8`, typecheck `:9`, format `:11`, format:check `:12` | root `package.json:15-26` — dev `:15`, build `:16`, start `:17`, preview `:18`, test `:19`, test:watch `:20`, typecheck `:21`, format `:22`, format:check `:23` | **WRONG** (citation) | All seven values correct; all seven line refs wrong. `apps/web/package.json` refs (`:4`, `:5`) also wrong — actual `:7` (dev), `:8` (build). |
| ARCH-572 | §6/§11 `pnpm preview` = build then start | `README.md` | root `package.json:18` → `"preview": "pnpm build && pnpm start"` ✓ | CONFIRMED | |
| ARCH-573 | §6 CI order: format:check → typecheck → test → license check → package builds → app build | `.github/workflows/ci.yml` | `.github/workflows/ci.yml:20-25` — exactly that order ✓ | CONFIRMED | |
| ARCH-574 | §6 "Tauri desktop — standalone `.exe` via `pnpm build:app`" | `AGENTS.md` §Desktop | `AGENTS.md:83-102` lists `pnpm tauri dev`, `pnpm build:debug`, `pnpm build:app`, `pnpm build` ✓ | CONFIRMED | |
| ARCH-575 | §7.1 naming conventions | `AGENTS.md` §Naming | `AGENTS.md:139-143` ✓ — camelCase domains, kebab components/modules, snake_case DB columns | CONFIRMED | |
| ARCH-576 | §12 key files table | 18 entries | All exist: `packages/core/src/{round-trips,edge-score,metrics,analysis}.ts`, `packages/importers/src/detect.ts`, `packages/importers/src/formats/fills.ts`, `apps/web/src/db/{schema,bootstrap}.ts`, `apps/web/src/server/{executions,rebuild,sync,ai,ai-runtime,ai-prompts,ai-scope}.ts`, `market-data/`, `components/dashboard-layout.tsx`, `components/shell.tsx`, `components/charts/tokens.ts`, `scripts/check-licenses.mjs`, `scripts/verify-features.py`, `scripts/benchmark-journal.py` | CONFIRMED | `EDGE_SCORE_VERSION = 2` + `EDGE_SCORE_WEIGHTS` confirmed at `edge-score.ts:29`. `executions.ts` exports `insertExecutions`/`partitionExecutions`/`executionProblem`/`InsertResult` ✓. `scripts/` contains all three named files plus 8 `.ps1` ✓. |
| ARCH-577 | §1 License MIT / repo URL | `README.md`; `package.json` | `package.json:5` `"license": "MIT"`; `:6-9` repository `https://github.com/LuxAlgo/trade-journal.git`; `LICENSE:1` "MIT License, Copyright (c) 2026 LuxAlgo Global, LLC" | CONFIRMED | |
| ARCH-578 | §1 "npm packages `@luxalgo/journal-core`, `@luxalgo/journal-importers`" | npmjs links | Both packages declare `publishConfig.access: "public"` and `version: 0.1.0`; actual npm publication cannot be verified from the repo | INSUFFICIENT-EVIDENCE | Needs an external check or a "publish-ready" wording. |
| ARCH-579 | §1 "self-hosted only — no hosted-service assumptions, no telemetry" | `README.md` | `README.md:82` (deploy anywhere with a persistent disk; serverless unsupported) ✓. Telemetry: README:288 documents Next.js telemetry as opt-out, not "no telemetry" as a shipped property — see ARCH-552 | PARTIALLY | "No telemetry" overstates; the app does make outbound requests to brokers/market data/AI providers (`README.md:288`). |
| ARCH-580 | Report reserves evidence IDs `ARCH-500+` for this section | header: "Evidence IDs `ARCH-500+` (lines 500–599 reserved for this section)" | `01-project-overview.md` contains **zero** `ARCH-5xx` IDs of its own — all 5 `ARCH-` matches are cross-references to `03-domain-model.md` | PARTIALLY | The declared ID namespace is never used; every finding in this review therefore has no home ID in the report. |
| ARCH-581 | §4 `desktop/` tree: `src-tauri/{tauri.conf.json, binaries/}`, `scripts/` | sidecar downloaded by `pnpm --filter desktop setup:sidecar` | `desktop/package.json:14` → `"setup:sidecar": "node scripts/run-sidecar-setup.js"` ✓; `desktop/src-tauri/binaries/` contains only `.gitkeep` (sidecar not checked in ✓); setup scripts at `desktop/src-tauri/scripts/setup-sidecar-node.{ps1,sh}` and `desktop/scripts/run-sidecar-setup.js` ✓ | CONFIRMED | Note: `pnpm tauri dev` / `pnpm build:app` must be run **from `desktop/`** (scripts at `desktop/package.json:7-12`); the root `package.json` has no `tauri` script (only `desktop:build`, `mcp:tauri` at `:24-26`). §5.4/§6 imply a root-level invocation. |

---

## Section 3 spec coverage

| Required element | Present? | Assessment |
|---|---|---|
| Project summary | **Yes** | §1 — accurate; "no telemetry" overstated (ARCH-579). |
| Verified technology stack | **Yes** | §2 — all versions correct, but every line citation in §2.1–§2.5 is wrong; Radix count and apps/web TypeScript entry are false. |
| Important dependencies and versions | **Yes** | §2.5 + §9 — values correct; §9 omits 10 runtime deps; Radix count wrong. |
| High-level architecture diagram | **Yes** | §3 — Mermaid component/file names all match real modules; only the "~24 API routes" node is wrong (43). |
| Directory map with architectural responsibilities | **Partial** | §4 — accurate for `packages/core`, `apps/web/src/{db,lib,components}`, `scripts/`, `docs/`; wrong for `packages/importers` (nesting + 3 missing files), `app/api` (2 phantom dirs, 9 missing), `server/` (10 missing files), `apps/web/src` (missing `hooks/`). |
| Major application entry points | **Yes** | §5 — `next.config.ts`, `middleware.ts`, `server/api.ts`, core `index.ts`, importers `index.ts`, Tauri all present; middleware HMAC attribution is wrong (ARCH-547). |
| Major execution environments | **Yes** | §6 — dev/build/start/preview/Docker/Tauri/CI all real and correct in substance; Dockerfile/compose line ranges wrong. |
| Existing architectural conventions | **Yes** | §7 — naming, error handling, async/React, transactions, build config all verified against `AGENTS.md` and source; only line citations off. |
| Deployment and runtime assumptions | **Yes** | §8 — data dir, password, secret, WAL, BYO-key all confirmed; telemetry claim false. |
| Important technical constraints | **Yes** | §10 — 18 constraints, 13 confirmed, 3 partial, 2 false. Strongest section alongside §7/§12. |

**Not required but present:** §9 dependency map, §11 build/test commands, §12 key files reference — all useful and accurate in substance.

---

## Required fixes (ordered)

1. **Fix the `NEXT_TELEMETRY_DISABLED` claim (§8 and §10).** `Dockerfile` does not set it. Either add `ENV NEXT_TELEMETRY_DISABLED=1` to the Dockerfile (and cite it), or restate the constraint as "Next.js telemetry is opt-out; users set `NEXT_TELEMETRY_DISABLED=1` (`README.md:288`)". The current wording asserts a shipped property that does not exist.
2. **Fix the API route count (§3 diagram, §4).** 43 `route.ts` files, not ~24. Use "43 route handlers" or "43 API route handlers".
3. **Correct the middleware auth description (§5.1, §7.2 context).** `middleware.ts` performs a **presence-only** cookie check; HMAC verification lives in `server/auth.ts` and is applied by `handler()` in `server/api.ts`. Cite both files.
4. **Repair the `packages/importers` directory tree (§4).** Move `history/` out from under `formats/`; add `src/position-fills.ts`, `src/formats/history.ts`, `src/formats/pepperstone.ts`; list `history/{import,model,csv,html,aliases,timestamps,reconstruct}.ts` and `history/adapters/{adapter,generic,metatrader,mt5deals,tradingview}.ts`. Add one line noting the two parallel pipelines (`formats/*` → fills, `history/*` → reconstructed trades, bridged by `formats/history.ts`).
5. **Repair the `app/api` directory list (§4).** Remove `notebooks/` and `sync/` (neither exists); add `attachments`, `calendar`, `demo`, `export`, `folders`, `notes`, `performance-trends`, `trade-explorer`, `workspace`.
6. **Fix the Radix UI row (§2.5, §9).** 9 packages, not 11; actual range `^1.1.21`–`^2.3.7`.
7. **Remove the apps/web TypeScript row (§2.5) or restate it.** `apps/web/package.json` declares no `typescript`; the root does (`:32`). Note `apps/web` typecheck = `next typegen && tsc --noEmit`.
8. **Re-derive every file:line citation.** ~30 refs are wrong (§2.1, §2.3, §2.4, §2.5, §5.1, §7.5, §8, §10, §11). Values are right; the pointers are not. Re-run the citation pass from the current files — do not hand-offset.
9. **Correct the Tauri sidecar node version and its source (§4, §5.4).** `AGENTS.md:88` says 22.11.0; `desktop/README.md` says 24.11.0. Cite the README for 24.11.0 and flag the AGENTS.md discrepancy as a repo inconsistency.
10. **Assign `ARCH-5xx` IDs to this section's findings** (header reserves 500–599 but the section uses none), or drop the reservation statement.
11. **Correct `foreign_keys = ON` citation** to `db/index.ts:101` (singleton) — and note the pragmas are set twice (dead `createDb()` at `:31-73` + singleton at `:97-101`).
12. **Add the omitted `apps/web` runtime deps** to §2.5/§9: `react-dom`, `react-markdown`, `remark-gfm`, `react-day-picker`, `lucide-react`, `class-variance-authority`, `clsx`, `cn`, `tailwind-merge`, `@pdf-lib/fontkit`.
13. **Qualify the Tauri commands (§5.4, §6, §11).** `pnpm tauri dev` and `pnpm build:app` exist only in `desktop/package.json` — they must be run from `desktop/`. The root `package.json` exposes only `desktop:build` and `desktop:build:debug` (`:24-25`) and `mcp:tauri` (`:26`).

## Recommended additional evidence

- **`packages/core` purity claim** — currently inferred from "no `dependencies` block". Add a direct grep result: no `node:`/fs/net imports in `packages/core/src/`.
- **Two parallel importer pipelines** — worth a dedicated §4 sub-note; it is the single most confusing thing in the importers tree and directly affects any future "add a broker format" work.
- **`JOURNAL_DATA_DIR` default disagreement** — `README.md:74` says `./data`; `db/index.ts:9` defaults to `/data/trade-journal`. Flag it (it affects Docker vs pnpm runs).
- **Dead `createDb()` helper** (`db/index.ts:31-73`) — unreferenced duplicate of the singleton init at `:97-101`; note it as a drift risk.
- **npm publication status** — replace the npmjs.com links with a verifiable statement (e.g. "published as of 0.1.0" / "publish-ready: `publishConfig.access: public`"), or cite the registry response.
- **`minimumReleaseAgeExclude`** in `pnpm-workspace.yaml:10-14` — an active supply-chain policy that §2.7 omits.
- **Desktop sidecar vs. Docker runtime mismatch** — Docker builds on Node 22, the desktop sidecar is Node 24.11.0; worth one line in §8.
- **`apps/web/src/hooks/`** — `use-mobile.ts` is the only file; still belongs in the directory map for completeness.
