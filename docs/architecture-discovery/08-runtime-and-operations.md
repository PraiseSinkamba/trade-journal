# 08 — Runtime and Operations

**Evidence register:** ARCH-400–499

---

## 8.1 Node.js Runtime

| Concern | Value | Source |
|---------|-------|--------|
| Node version | `>= 22` (Docker: `node:22-slim`) | `package.json:10-11`, `Dockerfile:2,13` |
| Package manager | pnpm 11.0.8 | `package.json:13` |
| Module system | ESM (`"type": "module"` in `apps/web/package.json`) | `ARCH-401` |
| Build tool | Next.js 15.5.23 with Turbopack (dev) | `apps/web/package.json:7,43` |
| Output mode | `standalone` — self-contained `node apps/web/server.js` | `apps/web/next.config.ts:4`, `Dockerfile:26` |

Sources: `package.json:10-13`; `Dockerfile:2,13,26`; `apps/web/next.config.ts:4`

`ARCH-400`

---

## 8.2 Docker Deployment

**File:** `Dockerfile` (multi-stage)

```dockerfile
FROM node:22-slim AS builder            # Dockerfile:2
# pnpm install --frozen-lockfile
# pnpm --filter web build

FROM node:22-slim AS runner             # Dockerfile:13
ENV NODE_ENV=production                # :14
ENV JOURNAL_DATA_DIR=/data             # :15
WORKDIR /app
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/.next/static
RUN mkdir -p /data && chown -R node:node /data /app
USER node                              # :22
VOLUME /data                           # :23
EXPOSE 3000                            # :24
ENV PORT=3000 HOSTNAME=0.0.0.0         # :25
CMD ["node", "apps/web/server.js"]     # :26
```

Key properties:
- **Multi-stage build** — builder dependencies not present in runner image.
- **Non-root user** (`node`) in final image (`:22`).
- **Data volume** (`./data:/data`) — SQLite DB and `.secret` key file live here.
- **No environment secrets in image** — `JOURNAL_PASSWORD`, `JOURNAL_SECRET`, AI keys must be injected at runtime via `-e` or compose `environment:`.
- **Base image is an unpinned floating tag** — `node:22-slim` (`:2`, `:13`) is not pinned to a `@sha256:` digest, so the image contents can change between builds.
- **No `HEALTHCHECK` instruction** — container health must be probed externally.

`ARCH-402`

**File:** `docker-compose.yml`

```yaml
services:
  journal:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      # Optional: require a password (recommended when exposed beyond localhost)
      # JOURNAL_PASSWORD: change-me
      # Optional: stable encryption secret for broker credentials at rest
      # JOURNAL_SECRET: change-me-too
      JOURNAL_DATA_DIR: /data
    restart: unless-stopped
```

Note: `docker-compose.yml` contains **no** `NEXT_TELEMETRY_DISABLED` comment — see §8.7. There is also no `healthcheck:` block; `restart: unless-stopped` is the only restart semantics, and there is no log-rotation policy.

`ARCH-403`

---

## 8.3 Environment Variables

### Core

| Variable | Required | Default | Effect |
|----------|----------|---------|--------|
| `JOURNAL_DATA_DIR` | No | `/data/trade-journal` (code default, all platforms) | SQLite DB and `.secret` file location |
| `JOURNAL_PASSWORD` | No | — (none) | Enables password gate |
| `JOURNAL_SECRET` | No | auto-generated `.secret` | Encryption key for broker/AI credentials |

**`JOURNAL_DATA_DIR` default mismatch — live defect.** The code default is `process.env.JOURNAL_DATA_DIR ?? "/data/trade-journal"` (`apps/web/src/db/index.ts:8`) — an **absolute POSIX path on every platform**, not a dev/Docker split. Two other places disagree with the code:

- `.env.example:10` — *"Where the SQLite database lives. Default: ./data"*
- `apps/web/src/lib/export-format.ts:13` — *"(JOURNAL_DATA_DIR, default ./data)"*

Consequences:
- **Docker:** the image sets `JOURNAL_DATA_DIR=/data` explicitly (`Dockerfile:15`), and compose sets the same — so the code default never applies there.
- **Desktop (Tauri):** the child process sets `JOURNAL_DATA_DIR=%APPDATA%\TradeJournal\data` explicitly (`desktop/src-tauri/src/server.rs:61`) — the code default never applies there either.
- **Bare `pnpm dev` on Windows:** the code default **does** apply, and `/data/trade-journal` resolves to `C:\data\trade-journal` — the SQLite DB and `.secret` key file land on the system drive, not in the repo. This is the only affected path, and it is the one a developer hits first.

Fixing it is an application-code change (out of scope for this report), but the documentation default should be `/data/trade-journal`.

`ARCH-404`

### AI Providers

| Variable | Required | Default | Effect |
|----------|----------|---------|--------|
| `OPENAI_API_KEY` | No (BYO-key) | — | OpenAI key (takes priority over saved) |
| `ANTHROPIC_API_KEY` | No (BYO-key) | — | Anthropic key (takes priority over saved) |

### Standalone server / Next.js

| Variable | Default | Effect |
|----------|---------|--------|
| `PORT` | `3000` | HTTP server port — set in the Docker runner (`Dockerfile:25`) |
| `HOSTNAME` | `0.0.0.0` | Bind address — consumed by the Next standalone server (`Dockerfile:25`), **not** a Next.js built-in |
| `NODE_ENV` | `production` | In Docker runner (`Dockerfile:14`) and in the desktop sidecar (`desktop/src-tauri/src/server.rs:63`) |
| `NEXT_TELEMETRY_DISABLED` | **Not set anywhere** | Should be `1` to disable Next.js anonymous telemetry — the repo states it is set in the Dockerfile, and it is not. See §8.7 |

`ARCH-404`

---

## 8.4 Database

| Concern | Value | ARCH |
|---------|-------|------|
| Engine | better-sqlite3 ^12.2.0 | `ARCH-405` |
| Mode | WAL (Write-Ahead Logging) — **explicitly set**, not SQLite's default (the default journal mode is `delete`) | `ARCH-405` |
| Busy timeout | `busy_timeout = 5000` (5 s) | `ARCH-405` |
| Foreign keys | `FOREIGN_KEYS = ON` enforced | `ARCH-405` |
| Location | `{JOURNAL_DATA_DIR}/journal.db` | `ARCH-405` |
| Schema tool | Drizzle ORM ^0.45.2 | `ARCH-405` |
| Migrations | Hand-rolled: `BOOTSTRAP_SQL` + additive `ALTER TABLE` upgrades. No `drizzle-kit` config | `ARCH-405a` |

Sources: `apps/web/package.json:35` (better-sqlite3), `:40` (drizzle-orm); `apps/web/src/db/index.ts:8` (data dir), `:34` (db path), `:36-38` (pragmas), `:39` (`BOOTSTRAP_SQL`), `:40-67` (upgrades), `:81-135` (singleton)

### Migration Mechanism

There is no migration runner and no `drizzle-kit` configuration. The schema is brought up to date in code:

1. `sqlite.exec(BOOTSTRAP_SQL)` (`db/index.ts:39`, `:101`) creates the base schema.
2. Additive `ALTER TABLE … ADD COLUMN` upgrades run on every start: `folders.deleted_at` (`:41-43`, `:105-107`), `accounts.ibkr_sync_time_zone` (`:44-51`, `:108-114`), `executions.import_metadata_json` (`:53-56`, `:115-119`), and the `market_csv_datasets` columns + backfill (`:57-67`, `:120-131`).

These upgrade blocks are **not uniformly transactional**: the `accounts` and `market_csv_datasets` blocks are wrapped in `sqlite.transaction(...)` (`:44-51`, `:59-67`), while the `folders` and `executions` upgrades execute directly (`:41-43`, `:53-56`). A failure in the latter leaves the schema partially upgraded.

### WAL Checkpointing on Data-Dir Change

When `JOURNAL_DATA_DIR` changes (e.g. between Vitest forks), the singleton closes the old connection, runs `wal_checkpoint(TRUNCATE)`, and removes the stale `-wal`/`-shm` files (`db/index.ts:81-96`).

`ARCH-405a`

### Database Bounded by Process

The SQLite file is local to the process. No connection pooling, no multi-process read replicas. The standalone Next.js server is a **single Node process** — one WAL writer.

`ARCH-406`

---

## 8.5 AI Execution Policies

**File:** `apps/web/src/server/ai-contracts.ts`

```typescript
export const AI_FEATURE_POLICIES: Readonly<Record<AiFeature, AiExecutionPolicy>> = {
  reflection:      { maxOutputTokens: 1200, maxRetries: 2 },
  askJournalAgent:{ maxOutputTokens: 1200, maxRetries: 2, timeoutMs: 30_000, maxSteps: 4, maxToolCalls: 4 },
  reportsAgent:   { maxOutputTokens: 1200, maxRetries: 2, timeoutMs: 30_000, maxSteps: 4, maxToolCalls: 4 },
  statementImport:{ maxOutputTokens: 32_000, maxRetries: 0, timeoutMs: 120_000 },
};
```

| Feature | Max output tokens | Retries | Timeout | Tool loop |
|---------|------------------|---------|---------|-----------|
| `reflection` | 1,200 | 2 | — | No |
| `askJournalAgent` | 1,200 | 2 | 30 s | 4 steps × 4 calls |
| `reportsAgent` | 1,200 | 2 | 30 s | 4 steps × 4 calls |
| `statementImport` | 32,000 | 0 | 120 s | **No** |

`statementImport` has **no tool loop**: it runs through `runObjectAi` (`apps/web/src/server/ai-runtime.ts:284`), whose request type `ObjectAiRequest` (`:45-53`) has no `createTools` field — a single `generateText` call with an `output` schema. The policy also declares no `maxSteps`/`maxToolCalls` (`ai-contracts.ts:57`).

No budget enforcement, no spend alerts — cost is borne by the user's provider account.

`ARCH-407`

---

## 8.6 Streaming

**Finding:** Streaming is NOT implemented for any AI feature.

`VERIFIED` — `runTextAi` in `ai-runtime.ts` uses `@ai-sdk/anthropic` / `@ai-sdk/openai` in non-streaming mode. All four AI routes return `ok({ ... })` — fully buffered `NextResponse.json(...)`.

`ARCH-408`

---

## 8.7 Telemetry — Documented Invariant Violated

**Finding:** `NEXT_TELEMETRY_DISABLED=1` is **not set anywhere in the repository's runtime configuration**, contradicting the repo's own stated invariant.

`VERIFIED` (fact) — repo-wide grep for `NEXT_TELEMETRY_DISABLED` finds **zero** occurrences in `Dockerfile`, `docker-compose.yml`, and `.env.example`. The Docker runner stage sets `NODE_ENV=production` (`Dockerfile:14`) but not the telemetry flag, so Next.js anonymous telemetry remains enabled in the shipped image.

`VERIFIED` (violation) — the repo documents the opposite:

| Claim | Location |
|-------|----------|
| *"**No telemetry:** `NEXT_TELEMETRY_DISABLED=1` in the Dockerfile; `set NEXT_TELEMETRY_DISABLED=1` locally if desired."* | `AGENTS.md:260` |
| *"Next.js telemetry. The project ships with NEXT_TELEMETRY_DISABLED=1."* | `.omp/hooks/pre/telemetry-guard.ts:7` |

The enforcement hook blocks outbound calls to telemetry endpoints on the premise that the project already disables Next.js telemetry (`.omp/hooks/pre/telemetry-guard.ts:10,29`). That premise is false for the Docker image.

This is therefore **not** an optional recommendation — it is a **documented project invariant that the shipped artifact violates**. The remediation is a one-line change to the Dockerfile runner stage (`ENV NEXT_TELEMETRY_DISABLED=1`), which is application configuration and therefore outside this report's read-only scope.

`ARCH-409`

---

## 8.8 Rate Limiting

**Finding:** No **inbound** application-level rate limiting exists.

`VERIFIED` — No `rate-limit`, `upstash-ratelimit`, or equivalent dependency in `apps/web/package.json:12-52` or the root `package.json:28-34`. No custom rate-limiting middleware. Provider-side limits (OpenAI/Anthropic) are relied upon for abuse prevention.

The one concrete exposure is the login endpoint: `POST /api/auth` (`apps/web/src/app/api/auth/route.ts:7-19`) has **no attempt counter, delay, or lockout** — password guesses are unbounded. This matters because the password is the *only* credential protecting the whole journal.

Note the distinction: the market-data transport's limits (6 concurrent, 2 per host, 64 queue depth, 350 ms per-host interval — `apps/web/src/server/market-data/transport.ts:9,27,44`) **are** a rate limit, but they throttle **outbound** calls to the data provider, not inbound requests.

`ARCH-410`

---

## 8.9 Long-Running Processes

**Finding:** No background workers, cron jobs, or daemon processes.

All processing is synchronous and user-driven:

| Scenario | Mechanism |
|----------|-----------|
| Trade import | HTTP POST → sync DB write → return |
| AI recap | HTTP POST → sync model call → return |
| Daily recap generation | HTTP POST → sync model call → return |
| Broker sync (ctrader MCP) | HTTP POST → **MCP JSON-RPC over an HTTP transport** to the configured endpoint → return |
| Notebook autosave | Debounced HTTP PATCH (500 ms) |
| Market data polling | `setTimeout` rate-limited queue (in-process) |

No `setInterval`, no cron, no message queue, no worker threads.

**Broker sync is an external process call, not an internal worker.** `CTraderMcpClient` (`apps/web/src/server/ctrader-mcp/client.ts:21-31`) builds a `type: "http"` MCP transport pointing at `options.endpoint` and drives it with `createMCPClient` from `@ai-sdk/mcp`. `mode: "local"` implies a **separately running local MCP server process** that the journal talks to over HTTP — so "no background processes" means *the journal spawns none*, not *the journal never talks to another process*.

`ARCH-411`

---

## 8.10 Startup and Lifecycle

```
Docker start
    ↓
node apps/web/server.js  (Next.js standalone server)
    ↓
next.js handler registers routes
    ↓
module import → db singleton IIFE opens SQLite, applies pragmas,
    BOOTSTRAP_SQL, and the additive ALTER TABLE upgrades
    ↓
runtime: handle HTTP requests (stateless per-request)
    ↓
on SIGTERM → graceful HTTP shutdown (Next.js default)
```

The database is **not** opened lazily on first request. `db` is a module-level IIFE (`apps/web/src/db/index.ts:81-135`) that runs at import time: it resolves `dataDir()`, opens `journal.db`, applies `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON` (`:98-100`), executes `BOOTSTRAP_SQL` (`:101`), then runs the additive `ALTER TABLE` upgrades (`:105-131`). A hot-reload singleton on `globalThis` keeps the connection across Next dev reloads (`:16`, `:92-96`).

There is no migration runner — schema management is `BOOTSTRAP_SQL` plus the hand-written upgrades described in §8.4.

`ARCH-412`

---

## 8.11 CI / Build Gates

**File:** `.github/workflows/ci.yml`

```yaml
steps:
  - pnpm install --frozen-lockfile
  - pnpm format:check        # Prettier
  - pnpm typecheck           # tsc --noEmit
  - pnpm test                # vitest run
  - node scripts/check-licenses.mjs
  - pnpm -r --filter "./packages/*" build
  - pnpm build               # Next.js web build
```

| Gate | Tool | Fail-on |
|------|------|---------|
| Format | Prettier | Any diff |
| Types | TypeScript (`tsc --noEmit`) | Type errors |
| Tests | Vitest | Any test failure |
| License check | `check-licenses.mjs` | Unknown/unlisted license |
| Package build | `pnpm -r build` | Build failure |
| Web build | `next build` | Build failure |

No security scanning (e.g., `npm audit`, SARIF upload), no CodeQL, no Lighthouse CI, no bundle size gate — confirmed absent from both `ci.yml` and `release.yml`.

`ARCH-413`

### Release Workflow

**File:** `.github/workflows/release.yml`

A second workflow publishes the two public workspace packages to npm. It is `workflow_dispatch`-only (`:15`) — tags never publish — and uses **OIDC trusted publishing** rather than an npm token (`:19` `id-token: write` for npm provenance).

| Step | Command |
|------|---------|
| Install | `pnpm install --frozen-lockfile` |
| Types | `pnpm typecheck` |
| Tests | `pnpm test` |
| Package build | `pnpm -r --filter "./packages/*" build` |
| Publish | `pnpm -r --filter "./packages/*" publish --access public --no-git-checks` |

Published package contract:

| Package | `publishConfig` | Notes |
|---------|-----------------|-------|
| `@luxalgo/journal-core` | `packages/core/package.json:39-51` | `dist/index.js` (ESM) + `dist/index.cjs` (CJS) + `.d.ts` |
| `@luxalgo/journal-importers` | `packages/importers/package.json:42` | Depends on `journal-core` via `workspace:*`, rewritten to a real version at publish time |

Both packages are `MIT`-licensed and marked `publishConfig.access: "public"` — i.e. they are part of the public npm surface of this project.

`ARCH-413b`

---

## 8.12 Hosting Constraints

| Constraint | Implication |
|-----------|-------------|
| SQLite on a local volume | The data directory must be on a **persistent local volume**; not suitable for ephemeral rootfs hosts (Fargate, Heroku-style dynos, some Kubernetes CSI setups) |
| Single Node process | No horizontal scaling via multi-process Next.js; a manual process manager is needed for restarts (`restart: unless-stopped` in compose) |
| Single WAL writer | All DB operations serialise through one SQLite writer; `busy_timeout = 5000` bounds lock waits |
| No connection pooling | better-sqlite3 is synchronous and in-process — there is no pool to configure |
| No CDN configuration | Static assets served by Next.js standalone; a CDN must be added externally |
| Port 3000 default | Must be mapped via `ports: 3000:3000` in compose or `-p 3000:3000` on `docker run` |
| No health endpoint | `app/api/` contains no `health` route; liveness/readiness probes require a custom route that does not exist |
| No TLS termination in-repo | `docker-compose.yml` publishes `3000:3000` in plain HTTP; TLS must be provided by an external reverse proxy |
| Unpinned base image | `node:22-slim` is a floating tag — pin to `@sha256:` for reproducible production builds |

### Database Deployment Assumption — SQLite Only

The runtime assumes **SQLite on a local disk**, not a managed Postgres. There is no Postgres driver, no `DATABASE_URL`, no Drizzle Postgres dialect, and no `drizzle-kit` migration config — the entire persistence layer is `better-sqlite3` (`apps/web/package.json:35`) with a Drizzle `better-sqlite3` driver (`apps/web/src/db/index.ts:1-2`).

For a VPS deployment this means: one host, one container, one persistent bind-mounted volume (`./data:/data`), and **no** multi-host topology. Running two replicas against a shared volume is unsafe (two writers, `busy_timeout` contention). Migrating to Postgres would be an application-code change (schema dialect, driver, migrations), not a configuration change.

`ARCH-414`

---

## 8.13 Memory and Performance Characteristics

- **better-sqlite3**: Synchronous, direct V8 ↔ SQLite via native addon. No ORM query batching overhead beyond what Drizzle generates.
- **ECharts 6.1.0**: Canvas-based; large trade histories require client-side pagination or date-range filtering to avoid O(n) renders.
- **Bundle size**: `next build` produces standalone output with all Next.js server code, pruned `node_modules`, and static assets. Exact size UNVERIFIED — not measured in this investigation.
- **AI token budgets**: Statement import capped at 32,000 output tokens; other features at 1,200. The ask/reports context builders emit **aggregate and bucket text, not raw trade rows** — a metrics line plus capped bucket blocks (`apps/web/src/server/ai-capabilities.ts:50-61`, e.g. "By symbol (top 12)"), keeping prompt sizes bounded regardless of history length. The statement-import path is different by design: it sends the statement content itself, which is why it needs the 32k budget.

`ARCH-415`

---

## 8.14 Desktop (Tauri) Runtime

The Docker image is **one of two** supported runtimes. The second is a Windows desktop application built with Tauri 2 (`desktop/`, a first-class pnpm workspace member — `pnpm-workspace.yaml:4`; root scripts `desktop:build` / `desktop:build:debug` at `package.json:24-25`).

### Architecture: Rust shell + bundled Node sidecar

```
trade-journal-desktop.exe  (Rust / Tauri 2)
  ├── spawns: node-x86_64-pc-windows-msvc.exe apps/web/server.js
  │     ├── PORT=0            → OS-assigned ephemeral port
  │     ├── JOURNAL_DATA_DIR=%APPDATA%\TradeJournal\data
  │     ├── NODE_ENV=production
  │     └── stdout → regex 127\.0\.0\.1:(\d+) extracts the bound port
  │        → Tauri event "server-ready" { url }
  └── webview window → http://127.0.0.1:<discovered-port>
```

| Concern | Detail | Evidence |
|---------|--------|----------|
| Sidecar binary | Node **v24.11.0** win-x64, downloaded (not committed) and SHA-256-verified, renamed to the Tauri triple-suffixed form `binaries/node-x86_64-pc-windows-msvc.exe` | `desktop/src-tauri/scripts/setup-sidecar-node.ps1:20,23-24`; dispatcher `desktop/scripts/run-sidecar-setup.js` |
| Sidecar launch | Tauri's shell sidecar API — handles the platform/triple suffix and bundled-path lookup | `desktop/src-tauri/src/server.rs:57-70` |
| Bundled server | The Next.js standalone output, copied to `.next/tauri-dist/apps/web/` and bundled as a Tauri resource (`tauri.conf.json` `bundle.resources`) | `apps/web/scripts/copy-static-build.js`; `desktop/src-tauri/tauri.conf.json` |
| Port discovery | Regex on the sidecar's stdout; emits the `server-ready` Tauri event, and the main window navigates to the URL | `desktop/src-tauri/src/server.rs:72-88`; `desktop/src-tauri/src/lib.rs:151-159` |
| IPC contract | Three Tauri commands — `get_server_status`, `restart_server`, `open_data_folder` — plus the `server-ready` / `server-error` events | `desktop/src-tauri/src/lib.rs:13-46`, `:171-175` |
| Lifecycle | Tray menu: Show / Restart Server / Open Data Folder / Quit. Close hides the window instead of exiting; Quit kills the sidecar then exits | `desktop/src-tauri/src/lib.rs:50-120`, `:124-134` |

### Dev vs prod URLs

| Mode | URL | Detail |
|------|-----|--------|
| `tauri dev` | `http://localhost:3000` | `tauri.conf.json` `build.devUrl` — the webview loads a **separately running** Next dev server (`pnpm --filter web dev`); no sidecar is spawned for the UI |
| `tauri build` | `http://127.0.0.1:<ephemeral>` | The bundled standalone server is spawned as a sidecar and its port discovered at runtime |

### Data directory behaviour

The desktop runtime **overrides** `JOURNAL_DATA_DIR` explicitly, so the `/data/trade-journal` code default never applies here:

| Path | Value | Evidence |
|------|-------|----------|
| Data dir | `%APPDATA%\TradeJournal\data` | `desktop/src-tauri/src/paths.rs:8-16`; `desktop/src-tauri/src/lib.rs:127-129` |
| SQLite file | `%APPDATA%\TradeJournal\data\journal.db` | `apps/web/src/db/index.ts:8,34` |
| `.secret` key | same directory | `apps/web/src/server/crypto.ts:16-19` |
| Env passed to child | `JOURNAL_DATA_DIR=<data dir>` | `desktop/src-tauri/src/server.rs:61` |

The data directory lives **outside** the install directory, so app upgrades do not touch user data.

### Windows-specific concerns

| Concern | Detail |
|---------|--------|
| Path prefix | The Rust side strips the Windows extended-length prefix `\\?\` from the resource path — Node 24's `realpathSync` otherwise resolves only to the drive root and fails `EISDIR` (`desktop/src-tauri/src/server.rs:48-55`) |
| Native module ABI | `better-sqlite3` is a native addon compiled against a specific Node ABI. Changing the Node version used to build requires `node-gyp rebuild` in `apps/web/node_modules/better-sqlite3` (`desktop/README.md`, "Build fails — better-sqlite3 ABI mismatch") |
| Node version mismatch | The sidecar is Node 24 while the Docker image is Node 22; `next build` is documented to crash under some Node 24 patch versions, which is why the sidecar pins v24.11.0 |
| Windows-only bundling | `bundle.targets: ["msi", "nsis"]` — no macOS or Linux desktop builds are configured (`desktop/src-tauri/tauri.conf.json`) |
| No auto-update | No Tauri updater is configured — upgrades require reinstalling the installer |
| No code signing | Installers are unsigned; Windows SmartScreen will warn |
| MSI needs a GUI session | The MSI install cannot run silently in every environment |
| CSP disabled | `app.security.csp: null` in `tauri.conf.json` — the webview runs without a Content-Security-Policy |
| Tray-only lifecycle | Closing the window hides it; the Node sidecar keeps running until Quit is chosen from the tray |

### Security posture on the desktop transport

The desktop webview talks to `http://127.0.0.1:<port>` — plain HTTP on loopback. Consequences:

- The session cookie's `secure` flag is **never** set (the request URL is not HTTPS) — see `07` §7.1.
- `JOURNAL_PASSWORD` still applies and the middleware/HMAC split is unchanged, but the threat model is different: any local process on the machine can reach the loopback port.
- `NEXT_TELEMETRY_DISABLED` is likewise not set for the sidecar — the same invariant violation as §8.7 applies to the desktop runtime.

`ARCH-415a`

---

## Evidence Register

| ID | Source | Status |
|----|--------|--------|
| ARCH-400 | `package.json:10-13`; `Dockerfile:2,13,26`; `apps/web/package.json:5,7,43`; `apps/web/next.config.ts:4` | VERIFIED |
| ARCH-401 | `apps/web/package.json:5` | VERIFIED |
| ARCH-402 | `Dockerfile:2,13,14,15,22,23,24,25,26` | VERIFIED — quote now includes `ENV PORT=3000 HOSTNAME=0.0.0.0` |
| ARCH-403 | `docker-compose.yml:1-16` | VERIFIED |
| ARCH-404 | `apps/web/src/db/index.ts:8` (`/data/trade-journal`); `.env.example:10`; `apps/web/src/lib/export-format.ts:13`; `Dockerfile:15` | VERIFIED — **default corrected** to `/data/trade-journal` |
| ARCH-404a | Grep `NEXT_TELEMETRY_DISABLED` in `Dockerfile`, `docker-compose.yml`, `.env.example` → zero hits | VERIFIED |
| ARCH-405 | `apps/web/package.json:35,40`; `apps/web/src/db/index.ts:8,34,36-38` | VERIFIED |
| ARCH-405a | `apps/web/src/db/index.ts:39` (`BOOTSTRAP_SQL`), `:40-67` and `:105-131` (additive `ALTER TABLE` upgrades) | VERIFIED — hand-rolled migration path, no `drizzle-kit` |
| ARCH-406 | `Dockerfile:26`; `apps/web/src/db/index.ts:81-135` | VERIFIED |
| ARCH-407 | `apps/web/src/server/ai-contracts.ts:41-58` | VERIFIED — all values exact |
| ARCH-407a | `apps/web/src/server/ai-contracts.ts:57`; `apps/web/src/server/ai-runtime.ts:45-53,284` | VERIFIED — `statementImport` has **no** tool loop |
| ARCH-408 | `apps/web/src/server/ai-runtime.ts:130-313`; 4 AI routes return `ok({...})` | VERIFIED |
| ARCH-409 | `Dockerfile` — `NEXT_TELEMETRY_DISABLED` not set; contradicts `AGENTS.md:260` and `.omp/hooks/pre/telemetry-guard.ts:7` | VERIFIED — **documented invariant violated** |
| ARCH-410 | `apps/web/package.json:12-52`, `package.json:28-34` — no rate-limit dep; `apps/web/src/app/api/auth/route.ts:7-19` — no lockout | VERIFIED |
| ARCH-411 | Grep `setInterval\|cron\|worker_threads` — no background schedulers; `apps/web/src/server/ctrader-mcp/client.ts:21-31` — MCP over HTTP | VERIFIED |
| ARCH-412 | `apps/web/src/db/index.ts:81-135` — module-level IIFE, not `db.open()` | VERIFIED — **mechanism corrected** |
| ARCH-413 | `.github/workflows/ci.yml:19-25` | VERIFIED — exact order and commands |
| ARCH-413b | `.github/workflows/release.yml:15,19,26-41`; `packages/core/package.json:39-51`; `packages/importers/package.json:42` | VERIFIED — release pipeline now covered |
| ARCH-414 | `Dockerfile`; `docker-compose.yml`; `apps/web/next.config.ts:4`; `apps/web/src/db/index.ts:1-2` | VERIFIED — garbled token removed |
| ARCH-415 | `apps/web/package.json:35,41`; `apps/web/src/server/ai-contracts.ts:42,57`; `apps/web/src/server/ai-capabilities.ts:50-61` | VERIFIED — context builders emit aggregate/bucket text, not raw rows |
| ARCH-415a | `desktop/src-tauri/src/server.rs:48-70,72-88`; `desktop/src-tauri/src/lib.rs:13-46,124-134,151-159`; `desktop/src-tauri/src/paths.rs:8-16`; `desktop/src-tauri/tauri.conf.json`; `desktop/src-tauri/scripts/setup-sidecar-node.ps1:20,23-24`; `pnpm-workspace.yaml:4`; `package.json:24-25` | VERIFIED — Tauri desktop runtime documented |
