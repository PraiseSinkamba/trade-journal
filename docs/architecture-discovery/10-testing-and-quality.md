# 10 — Testing and Quality

**Evidence register:** ARCH-500–599

---

## 10.1 Frameworks at a glance

| Layer | Tool | Location | Automated in CI? |
|---|---|---|---|
| Unit | Vitest 3.2.7 | root `vitest.config.ts` | Yes — `pnpm test` |
| Integration (in-process) | Vitest + real `better-sqlite3` + real Next route handlers | `apps/web/tests/`, `packages/*/tests/` | Yes |
| Component (DOM) | Vitest + `jsdom` + `react-dom/client` | `apps/web/tests/*.test.ts` (6 files opt in via `// @vitest-environment jsdom`) | Yes |
| End-to-end | Python 3 stdlib scripts (`urllib`), **not** a browser driver | `scripts/verify-features.py`, `scripts/benchmark-journal.py` | **No** — manual only |
| Architectural guard | Vitest reading the filesystem | `apps/web/tests/ctrader-mcp/boundary.test.ts` | Yes |
| Native (Rust/Tauri) | `#[test]` in `desktop/src-tauri/src/paths.rs:23` | `desktop/` | **No** — `cargo test` is never invoked |

There is **no browser automation** anywhere in the repo: no Playwright, no Cypress, no Puppeteer, no Webdriver (`node_modules/@playwright` and `node_modules/@testing-library` are absent). E2E coverage is API-level HTTP against a running server only. `ARCH-500`

**Observed suite result** (full `pnpm test` on the development machine, 2026-10-21):

```
Test Files  1 failed | 73 passed (74)
     Tests  1 failed | 761 passed (762)
  Duration  184.36s
```

The single failure is `apps/web/tests/review-export.test.ts` — "exports a paginated PDF with embedded Unicode text using the production builder" — timing out at the 8000 ms budget the file itself sets (`apps/web/tests/review-export.test.ts:4-6`). Re-running that file in isolation **passes** in 5.4 s (`npx vitest run apps/web/tests/review-export.test.ts --testTimeout=60000`). This is a load-sensitive timeout, not a logic defect — but it is a real flake risk in CI, which runs the whole suite in one job. `ARCH-501`

---

## 10.2 Unit test framework

**Single root Vitest project.** No workspace file, no per-package configs, no separate projects.

```ts
// vitest.config.ts:1-12
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
  test: {
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
    setupFiles: ["./apps/web/tests/vitest-setup.ts"],
    pool: "forks",
  },
});
```

| Setting | Value | Consequence |
|---|---|---|
| `include` | `packages/*/tests/**/*.test.ts`, `apps/*/tests/**/*.test.ts` | Only `tests/` directories count. A file named `*.spec.ts` or `src/**/*.test.ts` would be **silently ignored**. `ARCH-502` |
| `resolve.alias` | `@` → `apps/web/src` | Tests import app code by alias; relative `../src/...` imports are also used (both styles appear). |
| `setupFiles` | `apps/web/tests/vitest-setup.ts` | Applies to **all** projects, including `packages/*`. |
| `pool` | `"forks"` | One Node process per test file → real process isolation, but ~4 s startup per file (see 10.13). |
| `esbuild.jsx` | `"automatic"` | TSX compiles without a React import. |
| `testTimeout` | **not set globally** | Vitest default (5 s) applies everywhere except one file that overrides it to 8 s. `ARCH-503` |

**Scripts** (`package.json:17-19`):

```json
"test": "vitest run",
"test:watch": "vitest",
```

`pnpm test` is `vitest run` — a single non-watch pass. (`AGENTS.md:268` describes this as "CI runs once with `--run`"; the literal flag is not used, but the semantics — one bounded pass — are correct.) `ARCH-504`

**Dependencies** (`package.json:28-34`): `vitest@^3.2.0`, `jsdom@^26.1.0`, `prettier`, `tsup`, `typescript`. No `@vitest/coverage-*`, no `@vitest/ui`, no snapshot serializer packages. `ARCH-505`

### The per-fork setup file

```ts
// apps/web/tests/vitest-setup.ts:11-16
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDataDir = mkdtempSync(join(tmpdir(), "journal-test-"));
process.env.JOURNAL_DATA_DIR = testDataDir;
```

Every fork gets its own `mkdtemp` SQLite directory, set **before** the test file's static imports so the `db` module binds to it at evaluation time (`apps/web/tests/vitest-setup.ts:1-10`). This is what makes the whole suite safe to run against a machine that also hosts a real journal. `ARCH-506`

`rmSync` is imported but unused in the setup file — the per-file teardown does the cleanup instead.

---

## 10.3 Integration test framework

There is **no separate integration-test framework**. Integration is achieved *inside* Vitest by composing real subsystems:

| Integration seam | How it is exercised | Example |
|---|---|---|
| Real SQLite + Drizzle | Real `better-sqlite3` file in a temp dir; `db.delete(...).run()` between cases | `apps/web/tests/execution-storage.test.ts:51` |
| Real Next route handlers | `await import("../src/app/api/settings/route")` then call `GET`/`POST` with a `Request` | `apps/web/tests/ai-settings.test.ts:9-24`, `apps/web/tests/import-account.test.ts:11` |
| Real round-trip engine | `insertExecutions` → `rebuildAccount` → assert on rebuilt trades | `apps/web/tests/execution-storage.test.ts:10-12` |
| Legacy schema migration | A hand-built legacy DB is created with `new Database(...)` + raw `exec` of an older `BOOTSTRAP_SQL`, then the app's own migration runs over it | `apps/web/tests/ibkr-timezone-migration.test.ts:10-12`, `apps/web/tests/history-import.test.ts:15-16`, `apps/web/tests/folder-delete.test.ts:14-15`, `apps/web/tests/market-csv-migration.test.ts:9-10` |
| Real HTTP server | `client.test.ts` boots a loopback server and speaks JSON-RPC to it | `apps/web/tests/ctrader-mcp/client.test.ts:102-105` |

Because the route handlers are imported *after* `JOURNAL_DATA_DIR` is set at module scope, the DB layer binds to the scratch directory. This is the repo's central integration pattern: **set env → dynamic `await import()` → exercise → tear down**. `ARCH-507`

---

## 10.4 End-to-end test framework

Two Python 3 scripts, both using only the standard library (`urllib`, `json`, `argparse`, `time`, `statistics`). Neither is a browser test.

### `scripts/verify-features.py` (102 lines) — functional API smoke

- Requires `--base-url` and **hard-refuses** any target that is not `http://127.0.0.1:<port>` with a port other than 3000/3001 (`scripts/verify-features.py:10-13`). It refuses the working journal's ports so it can never write to the user's real data.
- Creates its own fixtures with a random `uid` suffix (`scripts/verify-features.py:21-26`), so repeated runs do not collide.
- Exercises accounts, playbooks, settings, workspace defaults, executions, trade PATCH, advanced filters across `/api/trades`, `/api/stats`, `/api/journal`, `/api/analysis`, `/api/adherence`, and attachment upload (`scripts/verify-features.py:26-102`).
- Every call asserts both the HTTP status **and** a numeric invariant (e.g. `fees == 4 and netPnl == 996 and stopLoss == 4998`) — the same "defend product invariants" style as the Vitest suite.
- Not wired into `.github/workflows/ci.yml`. It requires a manually started `pnpm dev` / `pnpm preview` on a disposable `JOURNAL_DATA_DIR`.

`ARCH-508`

### `scripts/benchmark-journal.py` (45 lines) — read-only latency benchmark

- Measures warm read latency of four read-only routes (`/api/stats`, `/api/analysis`, `/api/adherence`, `/api/trades?view=list`), discarding the first sample as warm-up (`scripts/benchmark-journal.py:29-33`).
- Same loopback-only guard; `--samples` bounded to 1–30 (`scripts/benchmark-journal.py:19-24`).
- Explicitly creates or modifies no records (`scripts/benchmark-journal.py:3-4`).
- Not in CI.

`ARCH-509`

**Gap:** there is no browser-level E2E at all — no click-through of the Ask agent, no visual regression, no Radix interaction testing. `broker-connect.test.ts:26-27` states the omission explicitly: *"keep this focused on field semantics; the Radix picker is checked in browser QA."* That manual browser QA has **no automated counterpart** in the repo. `ARCH-510`

---

## 10.5 Existing test organization

### Layout

```
apps/web/tests/                        64 test files, 625 cases — app-level unit + integration
  └ apps/web/tests/ctrader-mcp/         9 of those 64 — cTrader MCP carve-out (88 cases)
packages/core/tests/                    4 test files + helpers.ts — engine (45 cases)
packages/importers/tests/               6 test files + fixtures/ — broker formats (92 cases)
────────────────────────────────────────────
Total                                  74 test files, 762 test cases
```

The 55 non-`ctrader-mcp` files under `apps/web/tests/` carry the remaining 537 cases. There is no `tests/` directory in `apps/desktop`/`desktop` — the Tauri app has **no** JavaScript or Rust test suite beyond the single `#[test]` in `desktop/src-tauri/src/paths.rs:23`. `ARCH-511a`

`packages/core/tests/helpers.ts` is a shared factory, not a test file — it exports a terse `fill(symbol, side, quantity, price, executedAt, overrides)` builder with a monotonic id counter (`packages/core/tests/helpers.ts:7-21`). This is the only shared test helper in the repo; the app-level tests build their own inline fixtures.

### Fixture files

`packages/importers/tests/fixtures/` holds exactly two real anonymized exports:

| Fixture | Used by |
|---|---|
| `ninjatrader-copy-trades.csv` (1.6 KB) | `packages/importers/tests/ninjatrader.test.ts:9` |
| `pepperstone-ctrader.csv` (2.3 KB) | `packages/importers/tests/pepperstone.test.ts:12` |

Both are loaded via `new URL("./fixtures/...", import.meta.url)` so resolution is independent of CWD. Every other fixture in the suite is constructed inline as a literal object. `ARCH-511`

### Per-file inventory (74 files)

| # | File | Cases | Env | Area |
|---|---|---|---|---|
| | **AI (12 files, 181 cases)** | | | |
| 1 | `apps/web/tests/ai-scope.test.ts` | 38 | node | Scope freezing, filter parity, route integration |
| 2 | `apps/web/tests/ai-capability.test.ts` | 32 | node | AI capabilities + `dataSource` gating |
| 3 | `apps/web/tests/ai-runtime.test.ts` | 22 | node | AI runtime, policies, error mapping |
| 4 | `apps/web/tests/ai-import.test.ts` | 19 | node | Statement import via AI |
| 5 | `apps/web/tests/ai-settings.test.ts` | 16 | node | Provider keys, encryption, SDK adapters |
| 6 | `apps/web/tests/ai-ask-agent.test.ts` | 13 | node | Ask tool set, tool budget |
| 7 | `apps/web/tests/ai-report-context.test.ts` | 10 | node | Report context modes, 6 KB cap |
| 8 | `apps/web/tests/ai-ui.test.ts` | 10 | **jsdom** | Ask panel UI |
| 9 | `apps/web/tests/ai-feedback.test.ts` | 7 | node | Error → user-facing message mapping |
| 10 | `apps/web/tests/ai-prompts.test.ts` | 6 | node | Prompt verbatim pinning |
| 11 | `apps/web/tests/ai-reports-route.test.ts` | 6 | node | `/api/ai/reports` route |
| 12 | `apps/web/tests/ai-import-ui.test.ts` | 2 | **jsdom** | Import AI opt-in UI |
| | **Engine — `packages/core` (4 files, 45 cases)** | | | |
| 13 | `packages/core/tests/metrics.test.ts` | 18 | node | Win rate, PF, drawdown, Edge Score |
| 14 | `packages/core/tests/round-trips.test.ts` | 14 | node | FIFO/LIFO/WAVG, split-at-flat, multipliers |
| 15 | `packages/core/tests/analysis.test.ts` | 9 | node | Risk/R, cross-tab, adherence |
| 16 | `packages/core/tests/overview-regression.test.ts` | 4 | node | Overview fast path == full computation |
| | **Importers — `packages/importers` (6 files, 92 cases)** | | | |
| 17 | `packages/importers/tests/history.test.ts` | 31 | node | History-adapter formats |
| 18 | `packages/importers/tests/dates.test.ts` | 22 | node | Fractional seconds + statement timezone |
| 19 | `packages/importers/tests/importers.test.ts` | 14 | node | TradeZella / Tradervue / IBKR / MT4 / Tradovate / TopstepX / Webull |
| 20 | `packages/importers/tests/pepperstone.test.ts` | 13 | node | Pepperstone cTrader detection + end-to-end |
| 21 | `packages/importers/tests/ninjatrader.test.ts` | 9 | node | NinjaTrader execution identity |
| 22 | `packages/importers/tests/skipped-reasons.test.ts` | 3 | node | Per-row skip reasons |
| | **cTrader MCP (9 files, 88 cases)** | | | |
| 23 | `apps/web/tests/ctrader-mcp/schemas.test.ts` | 25 | node | Zod payload schemas, asset-class mapping |
| 24 | `apps/web/tests/ctrader-mcp/deals.test.ts` | 13 | node | Deal → execution mapping |
| 25 | `apps/web/tests/ctrader-mcp/boundary.test.ts` | 11 | node | **Architectural guard (ADR 0001/0002)** |
| 26 | `apps/web/tests/ctrader-mcp/order-history.test.ts` | 10 | node | 30-day windowing, opening times |
| 27 | `apps/web/tests/ctrader-mcp/sync.test.ts` | 10 | node | Sync idempotency, synthetic entries |
| 28 | `apps/web/tests/ctrader-mcp/errors.test.ts` | 10 | node | Error classification, no credential echo |
| 29 | `apps/web/tests/ctrader-mcp/client.test.ts` | 5 | node | JSON-RPC over a real loopback server |
| 30 | `apps/web/tests/ctrader-mcp/accounts-route.test.ts` | 3 | node | `POST /api/accounts` |
| 31 | `apps/web/tests/ctrader-mcp/ctrader-mcp-preview-route.test.ts` | 1 | node | Preview route error hygiene |
| | **Import pipeline / storage / DB (10 files, 125 cases)** | | | |
| 32 | `apps/web/tests/ninjatrader-reconciliation.test.ts` | 37 | node | Source identity, fee corrections, chronology |
| 33 | `apps/web/tests/ibkr-sync-timezone.test.ts` | 28 | node | IBKR timezone provenance |
| 34 | `apps/web/tests/import-formats-regression.test.ts` | 14 | node | Fractional-timestamp reimport block |
| 35 | `apps/web/tests/execution-storage.test.ts` | 10 | node | Insert/rollback/dedup/notes |
| 36 | `apps/web/tests/ninjatrader-import.test.ts` | 10 | node | Preview → storage → rebuild |
| 37 | `apps/web/tests/folder-delete.test.ts` | 9 | node | Folder removal + rollback |
| 38 | `apps/web/tests/account-default.test.ts` | 8 | node | `currentAccountId` lifecycle |
| 39 | `apps/web/tests/history-import.test.ts` | 7 | node | Preview → commit → rebuild |
| 40 | `apps/web/tests/ibkr-timezone-migration.test.ts` | 1 | node | Additive provenance migration |
| 41 | `apps/web/tests/import-account.test.ts` | 1 | node | Import destination account |
| | **Market data (5 files, 57 cases)** | | | |
| 42 | `apps/web/tests/market-providers.test.ts` | 18 | node | Alpaca / Coinbase / Binance / OANDA adapters |
| 43 | `apps/web/tests/market-data.test.ts` | 17 | node | MFE/MAE, LSE REST contract, replay |
| 44 | `apps/web/tests/market-data-connections.test.ts` | 14 | node | Credential lifecycle, CSV datasets |
| 45 | `apps/web/tests/market-transport.test.ts` | 7 | node | Rate caps, cache, LRU eviction |
| 46 | `apps/web/tests/market-csv-migration.test.ts` | 1 | node | CSV metadata backfill |
| | **Analytics presentation (7 files, 49 cases)** | | | |
| 47 | `apps/web/tests/timezone.test.ts` | 15 | node | Statement vs display timezone |
| 48 | `apps/web/tests/calendar-insights.test.ts` | 8 | node | Calendar P&L, denominators, scope |
| 49 | `apps/web/tests/performance-trends.test.ts` | 6 | node | Trailing windows, extrema |
| 50 | `apps/web/tests/trade-explorer.test.ts` | 6 | node | Excursion axes, filtering |
| 51 | `apps/web/tests/trade-navigation.test.ts` | 6 | node | Prev/next within filters |
| 52 | `apps/web/tests/timezone-options.test.ts` | 5 | node | Timezone search |
| 53 | `apps/web/tests/trade-links.test.ts` | 3 | node | Exact trade links |
| | **Frontend / UI logic (14 files, 80 cases)** | | | |
| 54 | `apps/web/tests/broker-connect.test.ts` | 25 | **jsdom** | 22-broker registry, IBKR timezone |
| 55 | `apps/web/tests/dashboard-layout.test.ts` | 8 | node | Drag stability, layout persistence |
| 56 | `apps/web/tests/theme.test.ts` | 6 | node | Dark default, storage-blocked |
| 57 | `apps/web/tests/card-swing.test.ts` | 6 | node | Card motion physics |
| 58 | `apps/web/tests/note-formatting.test.ts` | 5 | node | Bold/italic markers |
| 59 | `apps/web/tests/sidebar-state.test.ts` | 5 | **jsdom** | Collapsed preference, cross-tab |
| 60 | `apps/web/tests/trade-interactions.test.ts` | 5 | **jsdom** | Star rating, Vela, privacy mode |
| 61 | `apps/web/tests/dictation.test.ts` | 4 | node | Speech recognition lifecycle |
| 62 | `apps/web/tests/prop-demo.test.ts` | 4 | node | Deterministic demo data |
| 63 | `apps/web/tests/notebook-folder-delete.test.ts` | 3 | **jsdom** | Notebook folder removal UI |
| 64 | `apps/web/tests/privacy-preference.test.ts` | 3 | node | Global privacy toggle |
| 65 | `apps/web/tests/date-input.test.ts` | 2 | node | Date-only round trip |
| 66 | `apps/web/tests/export-attachments.test.ts` | 2 | node | Export excludes attachment bytes |
| 67 | `apps/web/tests/review-export.test.ts` | 2 | node | PDF export (⚠ timeout-sensitive) |
| | **Domain services / settings (4 files, 33 cases)** | | | |
| 68 | `apps/web/tests/prop-firms.test.ts` | 18 | node | Prop cash arithmetic, lifecycle, payouts |
| 69 | `apps/web/tests/journal-defaults-validation.test.ts` | 6 | node | Strict settings schema |
| 70 | `apps/web/tests/journal-features.test.ts` | 5 | node | Fee rules, routines, attachment MIME |
| 71 | `apps/web/tests/sync-resilience.test.ts` | 4 | node | Partial broker batches |
| | **Auth / transport (3 files, 12 cases)** | | | |
| 72 | `apps/web/tests/auth-gate.unit.test.ts` | 5 | node | Password gate (unit) |
| 73 | `apps/web/tests/api-auth.test.ts` | 4 | node | Password gate, session invalidation |
| 74 | `apps/web/tests/api-request.test.ts` | 3 | node | Deduplicated in-flight GETs |

*Case counts are the authoritative per-file totals reported by Vitest's JSON reporter (`--reporter=json`) for the full-suite run of 2026-10-21. They include cases expanded from `it.each` (e.g. `packages/importers/tests/dates.test.ts` = 22).* `ARCH-512`

---

## 10.6 AI tool tests

Twelve files, 181 cases — the largest single test cluster, and the most tightly specified.

### What each pins

| File | Pins |
|---|---|
| `ai-runtime.test.ts` | **The policy constants themselves.** `AI_FEATURE_POLICIES.reflection.maxOutputTokens === 1200`; Ask and Reports agents `maxOutputTokens 1200 / timeoutMs 30_000 / maxSteps 4 / maxToolCalls 4`; `statementImport.maxRetries === 0` and `timeoutMs === 120_000` (`:71-88`). Prompt versions match `/^reflection-v\d+$/` etc. (`:89-95`). Also: `createOpenAI` is called with only `{ apiKey }` and OpenAI requests carry `providerOptions: { openai: { store: false } }` (`:98-118`); Anthropic goes through `createAnthropic` with **no** storage options (`:119-140`); only redacted execution metadata is returned (`:141-170`); the tool loop allows exactly 4 runtime tool reservations and denies the 5th (`:172-240`, `:243-311`); the 120 s statement-import timeout composes with the caller abort signal (`:314-366`); error mapping covers missing key → `missing_key` (`:369-418`), billing/quota → user-facing text (`:419-465`), 404/model-not-found → `model_unavailable` (`:466-492`), aborted import → timeout (`:493-516`), `RetryError` unwrapping (`:517-545`), generic fallback (`:546-565`). |
| `ai-capability.test.ts` | **`dataSource` gating** — the mechanism that decides which journals an AI tool may read. `playbookRulesForTrade` errors when the trade is out of scope (`:327-342`) **or** when `dataSource` is not `trades+playbooks` (`:391-402`); `missedObservations` errors when `dataSource` omits `missed` (`:460-471`); `notebookEntries` errors when it omits `notes` (`:472-481`); `progressHistory` errors when it omits `progress` (`:588-597`); `askJournal` errors when no trades match (`:149-164`); `dailyRecapContext` throws with no closed trades (`:238-245`). Also pins `deepFreeze` semantics — primitives unchanged, in-place freezing of objects/arrays, already-frozen objects unchanged, **circular references handled** (`:99-137`) — and that `readAiRequest` returns a deeply frozen scope (`:138-148`, `:287-295`). |
| `ai-scope.test.ts` | **Scope enforcement end to end.** Exactly one Ask agent execution (`:106-176`); empty account/filter results are not widened (`:177-188`); every supported journal filter uses the same predicate as the visible day (`:189-264`); the journal timezone is applied at midnight (`:265-328`); shared notes are excluded from trade subsets (`:329-340`); invalid bodies, dates and legacy account fields are **rejected rather than ignored** (`:341-355`); single-trade critique stays scoped to its key (`:356-365`); unknown `dataSource` values are rejected (`:366-375`); `tradeCritiqueKey` is accepted only with `trades+playbooks` (`:376-389`). `readAiRequest` defaults `dataSource` to `trades` (`:408-412`). |
| `ai-ask-agent.test.ts` | **The Ask tool set.** Every Ask tool returns only the selected account and date-scope trades (`:75-91`); unsupported narrowing arguments are rejected without returning journal data (`:92-104`); fabricated/out-of-scope trade keys are not revealed (`:105-116`); journal rows stay unchanged while tools execute (`:117-135`); **no journal data is returned after the runtime tool budget is exhausted** (`:136-143`); the approved scope's frozen timezone survives a later settings change (`:144-175`). `switch_report_mode` returns `{ error }` for unknown modes, requires a primary key in compare mode, rejects keys over 64 chars, and accepts no account/date/filter/timezone arguments (`:176-249`). |
| `ai-report-context.test.ts` | Report context modes: `{ error }` for unknown mode (`:66-71`), `{ error }` for a missing required primary key (`:72-78`), `{ context }` for valid modes including `trends` (`:86-91`) and `breakdown` (`:92-97`); **output capped at 6 KB** (`:98-106`); the frozen scope is respected — trades outside it are never read (`:107-148`); primary/secondary keys over 64 chars are rejected (`:158-171`). |
| `ai-reports-route.test.ts` | The `/api/ai/reports` route returns 200 with answer + scope (`:81-93`), calls `runReportsAgentAi` (not `runAskJournalAi`) (`:94-102`), returns 400 for an invalid body (`:103-116`), isolates the selected account in the reports tool set (`:117-127`), and records `stepCount` / `toolCallCount` metadata from the runtime (`:128-140`). The Ask route is pinned to still use `runAskJournalAi` (`:141-154`). |
| `ai-settings.test.ts` | Provider settings start unconfigured and **refuse requests before contacting a provider** (`:51-60`); the legacy Anthropic key/model are preserved while OpenAI stays separate (`:61-83`); keys are encrypted and **omitted from API responses and journal exports** (`:84-99`); removing a key never falls back to another provider (`:100-113`); an OpenAI-only environment is selected when both keys exist (`:114-138`); the whole request is validated before any write (`:139-156`); unreadable saved credentials count as unconfigured (`:157-165`); reads and writes require the journal session when a password is set (`:166-173`). A second describe exercises the **real SDK adapters** and asserts OpenAI's key/model reach Responses with storage disabled (`:175-208`), Anthropic keeps its own key/model/endpoint (`:209-264`), and rate-limit guidance survives SDK retry exhaustion (`:265-288`). |
| `ai-import.test.ts` | Native parsing stays local and unchanged when AI is off (`:97-109`); the selected provider key comes from Settings and the import goes through the runtime (`:110-137`); **`apiKey`, `provider` and `model` are never serialized into the request body** (`:138-150`); the safe configuration error is returned with no key (`:151-159`); exactly the reviewed result is committed without a second AI call and zero fees are preserved (`:160-191`); a review is required and tampered/stale previews are rejected (`:192-227`); no upload without a key or over the text limit (`:228-242`); PDF bytes go as a file input (`:243-256`); **truncated model output fails closed** and provider errors are sanitized (`:257-270`); non-`stop` finish reasons produce the existing incomplete-response message (`:271-279`). |
| `ai-feedback.test.ts` | The message → user-facing-notice mapper. Empty/invalid scopes are explained without suggesting an AI connection problem; missing setup yields guidance with a direct `/settings#ai-settings` destination; credentials vs billing vs temporary provider failures are distinguished; data-specific empty states get specific guidance instead of an unhelpful retry; OpenAI credential/quota/model errors are recognised **without showing key fragments**; network and session failures get recovery; **raw provider payloads and credentials are never echoed** (`:4-73`). |
| `ai-prompts.test.ts` | Verbatim prompt pinning. `REFLECTION_SYSTEM_PROMPT` matches the literal system instruction moved out of `ai.ts` (`:14-24`); `buildAskJournalPrompt` gives initial aggregates and read-only tool guidance (`:25-42`); `buildDailyRecapPrompt` matches the template with and without notes (`:43-93`); `buildTradeCritiquePrompt` matches the critique template (`:94-133`); `buildReportsAgentPrompt` includes `switch_report_mode` guidance and the initial context (`:134-153`). |
| `ai-ui.test.ts` | jsdom. The Ask panel sends the full current filter snapshot and displays the **server-confirmed** scope (`:93-139`); stale errors are ignored and retry is allowed after a current failure (`:140-157`); duplicate submissions are prevented before a rerender (`:158-176`); a labelled recap is appended to edits made while generation is pending (`:177-219`). |
| `ai-import-ui.test.ts` | jsdom. AI import **defaults off** and never sends a chosen file until it has been explicitly previewed with a configured key (`:74-90`); all extracted rows are shown and a review is required before committing the frozen preview (`:91-173`). |

`ARCH-513`

### AI testing conventions

- **The AI provider is never actually contacted.** `ai-runtime.test.ts:14-19` mocks `ai`, `@ai-sdk/openai` and `@ai-sdk/anthropic` with `vi.hoisted` factories; `ai-scope.test.ts:23-27` mocks `@/server/ai` entirely; `ai-capability.test.ts:36` mocks `@/server/ai` with `runAi: vi.fn(async () => "Controlled AI response")`.
- **No network is reachable in the AI suite.** `ai-settings.test.ts:37-41` installs a `fetch` stub that throws `"Unexpected provider request"` in `beforeEach`, so an accidental real call fails loudly.
- **The AI API keys used in tests are literal dummies** (`"secret-openai"`, `"secret-anthropic"`, `ai-runtime.test.ts:22-29`) — no real credentials anywhere.

`ARCH-514`

---

## 10.7 Domain service tests

The domain lives in `packages/core` (pure functions) and `packages/importers` (format parsers).

### `packages/core` — 45 cases, pure and dependency-free

`packages/core` has **no** database, no I/O and no framework dependency; every test is a pure function assertion. The suite is written as product statements, per `CONTRIBUTING.md:27-28` ("Tests defend product invariants, not implementations").

| Behaviour pinned | Location |
|---|---|
| A buy followed by a full sell is one closed long with the correct profit | `packages/core/tests/round-trips.test.ts` |
| Selling first opens a short; profit when price falls | same |
| A position that never returns to flat stays open with no exit stats | same |
| A fill crossing through flat splits into two trades, fee split pro-rata | same |
| Total cycle P&L is identical under FIFO / LIFO / weighted average | same |
| FIFO and LIFO attribute a partial exit to different entry lots | same |
| Results are deterministic regardless of fill arrival order | same |
| Two separately reported positions in one account/symbol do not net | same |
| A futures contract multiplier scales P&L without touching prices | same |
| Trades in different accounts never match | same |
| A cycle closed at exactly zero net P&L counts as breakeven | same |
| Annotation keys stay stable across rebuilds | same |
| Win rate, profit factor, net P&L match a hand-computed sample | `packages/core/tests/metrics.test.ts` |
| Day win rate counts winning *days*, not winning trades | same |
| Streaks track consecutive wins/losses in close order | same |
| Max drawdown is the deepest fall from an equity peak | same |
| Relative drawdown tracks every point below the running peak | same |
| Zero losing trades ⇒ profit factor is explicitly infinite (not NaN) | same |
| Realized R relates profit to the risk planned at entry | same |
| A futures trade with no known multiplier reports **no** realized R rather than a wrong one | same |
| Gross profit/loss count every closed trade, including breakeven-labelled ones | same |
| The Edge Score is transparent, refuses to score < 5 closed trades, is stamped `formula version 2`, and every component is bounded 0–100 | same |
| Monthly calendar sums weeks and month to the same total | same |
| A late-evening New York fill lands on the trader's day | same |
| Weekday buckets come back in calendar order regardless of P&L | same |
| Duration buckets classify scalps and swings separately | same |
| Futures R uses point value and rejects missing/invalid risk | `packages/core/tests/analysis.test.ts` |
| Short risk and reward direction | same |
| Close date + local entry weekday survive DST | same |
| Annotations and numeric bounds combine without treating missing values as zero | same |
| A non-numeric value lands in the Unspecified band, not the top band | same |
| Open positions are excluded from closed-trade reports | same |
| Cross-table cells sum to totals for single-valued dimensions | same |
| Tags deduplicate within a group; explicit cross-group overlap allowed | same |
| Breakeven classification does not erase monetary gains from PF or P&L | same |
| **The overview fast path produces identical results to the full computation** | `packages/core/tests/overview-regression.test.ts` |
| Cached daily totals produce the same metrics, curves and calendar as recomputing | same |
| Adherence separates fully followed / broken / incomplete; an empty checklist or a different playbook is not adherence | same |

`ARCH-515`

### `packages/importers` — 73 cases, fixture + synthetic

- **Format matrix** (`importers.test.ts`): TradeZella (net P&L preserved to the cent), Tradervue (three fee columns summed), TradingView (filled kept, cancelled dropped), IBKR activity statement (fill rows only, signed quantity → side), NinjaTrader (contract month stripped), MetaTrader HTML (closed trades reconstructed, swap folded into fees), Tradovate (Filled only, `Product` → symbol), TopstepX (Bid/Ask → buy/sell), IBKR Flex Query (`YYYYMMDD;HHmmss`), TradeZella timezone-abbreviation time fields, Webull.
- **Money and timestamp primitives**: symbols, parenthesised negatives, thousands separators; naive timestamps interpreted in the trader timezone; cross-checked against real-world parsers.
- **Never guess**: an unknown file goes to the column mapper instead of being detected (`importers.test.ts`).
- **Pepperstone cTrader** (`pepperstone.test.ts`): auto-detection, two executions per row, synthetic opening fill at `open_time` with the opposite side, broker carried, entry/close linked via `importMetadata.group`, asset-class table lookup with digit fallback, all five `deal_kinds` covered, multi-row positions grouped, per-row skip reasons, unknown `deal_kind` imported with a warning rather than skipped, detection never stolen from IBKR, and an end-to-end pass through the round-trip engine where every position closes and net P&L matches the source.
- **NinjaTrader identity** (`ninjatrader.test.ts`): all 26 copy-traded fills preserved including same-account repetitions; identity stable across reordering; execution IDs (not order IDs) used for identical partial fills; reused execution IDs namespaced by account/connection/full contract; contradictory rows with the same identity rejected; malformed rows skipped without shifting valid identities.
- **Skipped reasons** (`skipped-reasons.test.ts`): TradeZella reports a reason per skipped row; `parseWithMapping` does the same; `parseHistory` propagates adapter reasons.
- **Dates** (`dates.test.ts`): fractional seconds preserved while a statement timezone is applied.

`ARCH-516`

---

## 10.8 Database tests

No separate DB test harness — DB behaviour is asserted through the real Drizzle/better-sqlite3 layer against a scratch file.

| Aspect | Covered | Location |
|---|---|---|
| Account/fill validation before insert | "Account not found" rejected; invalid fills rejected before any write | `apps/web/tests/execution-storage.test.ts:52-53` |
| Transactional rollback | Fills rolled back if trade calculation fails; new executions rolled back if appending notes exceeds the limit; invalid notes rejected before insert | `apps/web/tests/execution-storage.test.ts` |
| Idempotent re-import | Repeated imports deduplicated while the calculated total is preserved | same |
| Note integrity | Markdown notes preserved through rebuild + retry; exit notes appended to the correct position only; no duplicate notes; batch notes attached to each formed trade | same |
| Folder deletion | "Not found" for a missing folder; rollback when folder removal fails; notes cannot be created or moved into a removed folder | `apps/web/tests/folder-delete.test.ts` |
| Legacy-schema migration | Additive upgrade of `folders`, `ibkr_sync_time_zone` provenance, and `market_csv_datasets` metadata | `folder-delete.test.ts:13-15`, `ibkr-timezone-migration.test.ts:10-12`, `market-csv-migration.test.ts:9-10` |
| Import source metadata | `import_sources`, `import_source_aliases`, `import_batches` created on an existing DB without removing the account | `apps/web/tests/history-import.test.ts:57-60` |
| Settings persistence | `currentAccountId` starts unset, round-trips through `/api/settings` GET/PATCH, is cleared when the matching account is deleted or archived, and left alone for a different account | `apps/web/tests/account-default.test.ts:54-113` |
| Strict settings schema | Unknown top-level fields rejected; unknown fee/risk fields rejected; non-finite numbers and non-positive distances rejected; an account reference must exist; non-object payloads rejected | `apps/web/tests/journal-defaults-validation.test.ts:12-62` |
| Credential storage | AI keys and market-data keys encrypted at rest and never returned from status/save responses or the export | `apps/web/tests/ai-settings.test.ts:60-73`, `apps/web/tests/market-data-connections.test.ts` |
| Export shape | JSON export lists attachment metadata without embedding file contents | `apps/web/tests/export-attachments.test.ts:4-35` |

**Isolation pattern** — every DB test follows the same shape:

```ts
// apps/web/tests/execution-storage.test.ts:7-9
const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-storage-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
```

with `db.$client.close()` and `rmSync(scratch, { recursive: true, force: true })` in `afterAll`. Two variants exist — direct `process.env` assignment (most files) and `vi.stubEnv("JOURNAL_DATA_DIR", scratch)` (`ibkr-sync-timezone.test.ts:9`, `ibkr-timezone-migration.test.ts:9`, `timezone.test.ts:9`). 24 of the 74 test files reference `JOURNAL_DATA_DIR`. `ARCH-517`

**No SQL-level test framework exists** — there is no `pgTAP`, no snapshot of the schema, and no assertion that the Drizzle schema and `BOOTSTRAP_SQL` stay in sync except indirectly, by the migration tests booting a legacy DB and letting the app migrate it. `ARCH-518`

---

## 10.9 API tests

Route handlers are tested by importing the module and calling the exported `GET`/`POST`/`PATCH` with a real `Request` object.

| Route | Covered behaviour | Location |
|---|---|---|
| `POST/GET /api/settings` | Provider selection, key encryption, validation-before-write, session required when a password is set | `apps/web/tests/ai-settings.test.ts` |
| `GET /api/export` | Keys and ciphertext excluded from the export | `apps/web/tests/ai-settings.test.ts` |
| `POST /api/ai/ask` | One agent execution, scope enforcement, rejects invalid bodies/dates/legacy account fields | `apps/web/tests/ai-scope.test.ts` |
| `POST /api/ai/recap` | Recap scope and note plumbing | `apps/web/tests/ai-scope.test.ts` |
| `POST /api/ai/critique` | Single-trade critique scope | `apps/web/tests/ai-scope.test.ts` |
| `GET /api/journal/[date]` | Date-scoped journal read inside the approved scope | `apps/web/tests/ai-scope.test.ts` |
| `POST /api/ai/reports` | 200 + answer + scope; 400 on invalid body; correct agent selected; `stepCount`/`toolCallCount` recorded | `apps/web/tests/ai-reports-route.test.ts` |
| `POST /api/accounts` | Import destination account with chosen currency/balance; fills accepted under the returned id | `apps/web/tests/import-account.test.ts:11` |
| `POST /api/import` | Re-import blocked over rounded fractional timestamps; manual entries unaffected | `apps/web/tests/import-formats-regression.test.ts:11` |
| `POST /api/accounts` (cTrader) | Seeds `initialBalance`/currency from `get_balance`; respects a user-supplied value; **502 and deletes the half-created account** when `get_balance` fails | `apps/web/tests/ctrader-mcp/accounts-route.test.ts:58-150` |
| `POST /api/accounts/ctrader-mcp-preview` | Does not echo a sensitive upstream error message to the response body | `apps/web/tests/ctrader-mcp/ctrader-mcp-preview-route.test.ts:10-38` |
| `GET/POST` market history + CSV | Preview without writes, import candles, replay, persist estimates, remove derived results; currency mismatch stays unavailable even when confirmed; hundreds of saved estimates validated with bounded DB reads | `apps/web/tests/market-data-connections.test.ts` |

**The shared API wrapper** (`apps/web/src/server/api.ts`) is the common gate: `handler()` in `apps/web/src/server/api.ts` wraps every route. Its auth behaviour is pinned twice — `api-auth.test.ts` (integration-style, 4 cases) and `auth-gate.unit.test.ts` (unit, 5 cases). Together they assert: local access allowed with no password; missing **and** forged cookies rejected **before** the handler body executes; a real signed session accepted; the session invalidated when the password changes; a route marked `{ public: true }` skips the gate so login works. `apps/web/tests/api-auth.test.ts:14-42`, `apps/web/tests/auth-gate.unit.test.ts:17-45`. `ARCH-519`

**`next/headers` is mocked, never the whole request pipeline** — the convention is a single line:

```ts
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
```

used in `account-default.test.ts:17`, `ai-settings.test.ts:15`, `folder-delete.test.ts:12`, `ibkr-sync-timezone.test.ts:11`, `import-account.test.ts:10`, `prop-firms.test.ts:18`, `timezone.test.ts:11`. `ARCH-520`

**Not covered at the API level:** `apps/web/src/middleware.ts` has **zero** references in the test tree — the navigation gate (redirect to `/login` for non-API paths, 401 JSON for `/api/*`, the `matcher` exclusion list) is exercised only indirectly through the handler-level gate. `apps/web/src/middleware.ts:9-25`. `ARCH-521`

---

## 10.10 Frontend tests

### DOM-level tests (jsdom)

Six files opt in with a file-level `// @vitest-environment jsdom` pragma: `ai-import-ui.test.ts:1`, `ai-ui.test.ts:1`, `broker-connect.test.ts:1`, `notebook-folder-delete.test.ts:1`, `sidebar-state.test.ts:1`, `trade-interactions.test.ts:1`.

They render real React components with `react-dom/client` + `act`:

```ts
// apps/web/tests/sidebar-state.test.ts:1-5
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
```

- `sidebar-state.test.ts:39-43` stubs `IS_REACT_ACT_ENVIRONMENT` and `matchMedia` because jsdom has no media-query evaluator — the desktop branch is what gets exercised.
- `trade-interactions.test.ts` covers star-rating hover/focus preview, animation before save, restoring the saved value when a save fails, toggling a rating off, the Vela chart revealing only completed candles, and privacy mode hiding amounts and controls.
- `broker-connect.test.ts` asserts the broker registry contains exactly 22 public brokers including the six newer integrations, shows the effective IBKR timezone, reports skipped fills, surfaces connection failures, and blocks IBKR connection when its effective timezone cannot be loaded. It mocks the Radix `Select`/`Tabs` primitives (`:27-50`) — the picker itself is explicitly deferred to manual browser QA (`:26`).
- `notebook-folder-delete.test.ts` covers the cancellable confirmation, deletion of custom and built-in folders, redirect to "My notes", and failure handling that leaves the folder retryable.
- `ai-ui.test.ts` and `ai-import-ui.test.ts` cover the Ask panel and the AI import opt-in (see 10.6).

### Pure-UI-logic tests (no DOM)

`dashboard-layout.test.ts` (drag stability + layout persistence), `card-swing.test.ts` (motion physics), `dictation.test.ts` (speech recognition lifecycle), `note-formatting.test.ts` (Markdown markers), `theme.test.ts` (dark default, blocked storage), `privacy-preference.test.ts` (global privacy precedence over saved layouts), `date-input.test.ts` (date-only round trip without UTC conversion), `timezone-options.test.ts` (searchable timezone list), `trade-links.test.ts` (exact trade links), `trade-navigation.test.ts` (prev/next within filters, 404 for unknown trade).

### What is NOT tested on the frontend

58 of 237 source modules under `apps/web/src` are never referenced by any test file (normalised name/path match). The unreferenced set is dominated by presentational components — every file in `apps/web/src/components/charts/` (10 files, including `echart.tsx`, `gauge.tsx`, `edge-radar.tsx`, `time-heatmap.tsx`), all `components/ui/*` primitives (`badge`, `date-picker`, `dropdown-menu`, `hover-card`, `option-select`, `popover`, `skeleton`), and the feature panels (`ai-recap.tsx`, `adherence-report.tsx`, `calendar-pnl.tsx`, `calendar-day-preview.tsx`, `report-overview.tsx`, `report-market-estimates.tsx`, `rule-checklist.tsx`, `prop-firm-tracker.tsx`, `prop-firm-forms.tsx`, `prop-cash-overview.tsx`, `currency-*.tsx`, `market-data-settings.tsx`, `journal-settings.tsx`, `dashboard-customizer.tsx`, `dashboard-saved-layouts.tsx`, `filter-fields.tsx`, `shell.tsx`, `trade-chart.tsx`).

Notable server-side omissions on the same list: `apps/web/src/middleware.ts`, `apps/web/src/server/currency-conversion.ts`, `apps/web/src/lib/use-ai-request.ts`, `apps/web/src/lib/filter-description.ts`, `apps/web/src/lib/use-account-default.ts`, `apps/web/src/server/position-import.ts`, `apps/web/src/server/ninjatrader-order.ts`. `ARCH-522`

---

## 10.11 Mocking conventions

Five conventions, applied consistently:

### 1. `vi.hoisted` for mock factories referenced by `vi.mock`

Required because `vi.mock` is hoisted above the imports:

```ts
// apps/web/tests/ai-runtime.test.ts:8-19
const { mockGenerateText, mockCreateOpenAI, mockCreateAnthropic } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockCreateOpenAI: vi.fn(),
  mockCreateAnthropic: vi.fn(),
}));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: mockGenerateText,
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mockCreateOpenAI }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: mockCreateAnthropic }));
```

Note the **partial mock** of `ai` — `...(await original())` preserves the real `APICallError`, `LoadAPIKeyError` and `RetryError` classes so the error-mapping tests can throw genuine SDK errors (`:2`, `:370`). `ARCH-523`

### 2. Module mocks at the alias boundary (`@/...`)

| Mocked | Files |
|---|---|
| `next/headers` | 10 files — always `{ cookies: async () => ({ get: () => undefined }) }` |
| `@/server/ai` | `ai-capability.test.ts:36`, `ai-scope.test.ts:23-27`, `ai-reports-route.test.ts:16-19` |
| `next/navigation` | `ai-import-ui.test.ts:7`, `broker-connect.test.ts:13` |
| `@/lib/use-api` | `ai-ui.test.ts:22`, `ai-import-ui.test.ts:16`, `broker-connect.test.ts:15` |
| `@/components/*` | 14 distinct components stubbed to `() => null` or a minimal shim |
| `@/server/ctrader-mcp/client` | `ctrader-mcp/accounts-route.test.ts:19`, `ctrader-mcp-preview-route.test.ts:6` |
| `@/server/executions` | `ctrader-mcp/sync.test.ts:33-35` |
| `@luxalgo/vela` | 1 file |

**Dominant UI pattern:** heavy children are replaced with `() => null` so the test exercises the parent logic, not the child tree — e.g. `ai-ui.test.ts:14-49` stubs `FilterBar`, `use-api`, `use-autosave`, `RichEditor`, `EquityArea`, `Pnl`, `MonetaryValue`, `VoiceNote`, `Attachments` and `ReviewExport` in one block. `ARCH-524`

### 3. `vi.stubEnv` / `vi.stubGlobal` for environment and network

```ts
// apps/web/tests/ai-settings.test.ts:33-41
vi.stubEnv("ANTHROPIC_API_KEY", "");
vi.stubEnv("OPENAI_API_KEY", "");
vi.stubEnv("JOURNAL_PASSWORD", "");
vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected provider request"); }));
```

Cleaned up with `vi.unstubAllEnvs()` / `vi.unstubAllGlobals()` in `afterEach`. `JOURNAL_PASSWORD` is emptied in nearly every DB test so the auth gate does not interfere. `ARCH-525`

### 4. `vi.fn()` for outbound calls

`fetch`, `insertExecutions`, `syncAccount`, `postJson`, `useRouter().push`, `save` and the AI SDK entry points are all `vi.fn()` with `mockReset()` / `mockResolvedValueOnce` / `mockImplementation` set in `beforeEach`. `ai-runtime.test.ts:57-68` shows the canonical reset-and-re-stub preamble. `ARCH-526`

### 5. Filesystem-scanning tests for architectural rules

`apps/web/tests/ctrader-mcp/boundary.test.ts:1-45` reads the source tree with `readFileSync` + `glob` and enforces ADR 0001/0002 with two regex layers (a bare-call scan and an identifier scan) so that both `axios(...)` and `axios.get(...)`/`import axios` are caught, and it forbids cTrader MCP module imports inside `packages/importers/src/**`. This is a **lint implemented as a test** — it runs in CI but produces no lint output. `ARCH-527`

### What is never mocked

- `better-sqlite3` — always real, against a temp file.
- `@luxalgo/journal-core` — always real; the engine is the subject under test.
- `pdf-lib` — real in `review-export.test.ts`, with the real `NotoSans-Regular.ttf` from `apps/web/public/fonts/` (`:9`).
- No `jest.mock`-style manual module registry, no snapshot files, no MSW, no nock.

`ARCH-528`

---

## 10.12 CI test execution

```yaml
# .github/workflows/ci.yml:19-25
- run: pnpm install --frozen-lockfile
- run: pnpm format:check
- run: pnpm typecheck
- run: pnpm test
- run: node scripts/check-licenses.mjs
- run: pnpm -r --filter "./packages/*" build
- run: pnpm build
```

| Step | What it proves | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` | The lockfile is complete and unmodified | pnpm 11.0.8 from the `packageManager` field (`package.json:13`) |
| `pnpm format:check` | Prettier formatting | `prettier --check .` |
| `pnpm typecheck` | Types across all workspace packages | `pnpm -r --parallel typecheck`; the web app runs `next typegen && tsc --noEmit` (`apps/web/package.json:9`) |
| **`pnpm test`** | **The entire Vitest suite, 74 files / 762 cases** | `vitest run` — single pass, non-watch. **No `--coverage`, no shard/retry flags, no `--reporter` override, no JUnit output.** `ARCH-529` |
| `node scripts/check-licenses.mjs` | Dependency licence allow-list | Not a test, but a supply-chain gate |
| `pnpm -r --filter "./packages/*" build` | Both published packages build | |
| `pnpm build` | The Next.js app builds (`next build` + static copy) | |

**Runner:** `ubuntu-latest`, Node 22, pnpm cache enabled (`ci.yml:8-18`). Triggers: push to `main` and every pull request (`ci.yml:3-6`). One job, sequential steps — **a test failure blocks the build**, and nothing after `pnpm test` runs.

**`release.yml`** repeats `pnpm typecheck` and `pnpm test` before publishing (`release.yml:35-36`), so a broken suite blocks an npm release.

**Not in CI:**
- `scripts/verify-features.py` (functional E2E) — manual only.
- `scripts/benchmark-journal.py` (latency) — manual only.
- `cargo test` for the Tauri desktop crate — the single Rust test at `desktop/src-tauri/src/paths.rs:23` is never executed by any workflow.
- Any browser/E2E suite — none exists.
- Any coverage report — **no coverage tooling is installed anywhere in the repo** (`@vitest/coverage-v8` / `@vitest/coverage-istanbul` are absent from `package.json`, `apps/web/package.json` and every `packages/*/package.json`, and absent from `node_modules`). `ARCH-530`

`ARCH-531`

---

## 10.13 Critical behaviours covered

| Domain | Critical behaviour | Covered? | Evidence |
|---|---|---|---|
| Engine | Round-trip accounting: FIFO/LIFO/WAVG equivalence, split-at-flat, per-account isolation, multipliers, breakeven | ✅ Strong | `packages/core/tests/round-trips.test.ts` |
| Engine | Metrics truthfulness: win rate, PF, drawdown, realized R, Edge Score refusal below 5 trades | ✅ Strong | `packages/core/tests/metrics.test.ts` |
| Engine | Overview fast path == full computation (regression guard) | ✅ Strong | `packages/core/tests/overview-regression.test.ts` |
| Engine | Risk/R, cross-tab analysis, adherence classification | ✅ Strong | `packages/core/tests/analysis.test.ts` |
| Importers | 11+ broker formats; money/timestamp primitives; unknown files never guessed | ✅ Strong | `packages/importers/tests/importers.test.ts` |
| Importers | Execution identity stability across reordering / re-import | ✅ Strong | `packages/importers/tests/ninjatrader.test.ts` |
| Importers | Per-row skip reasons propagated to the user | ✅ Strong | `packages/importers/tests/skipped-reasons.test.ts` |
| AI | Policy limits (steps, tool calls, timeouts, output tokens) pinned as constants | ✅ Strong | `apps/web/tests/ai-runtime.test.ts:70-90` |
| AI | `dataSource` gating per capability | ✅ Strong | `apps/web/tests/ai-capability.test.ts:143-317` |
| AI | Scope cannot be widened; frozen scope; filter parity with the visible day | ✅ Strong | `apps/web/tests/ai-scope.test.ts` |
| AI | Tool budget exhaustion returns no journal data | ✅ Strong | `apps/web/tests/ai-ask-agent.test.ts:127-140` |
| AI | Provider errors never echo keys or raw payloads | ✅ Strong | `apps/web/tests/ai-feedback.test.ts`, `ai-import.test.ts` |
| AI | AI import defaults off; explicit preview + review required | ✅ Strong | `apps/web/tests/ai-import-ui.test.ts` |
| AI | Prompt text pinned verbatim (guards against silent prompt drift) | ✅ Strong | `apps/web/tests/ai-prompts.test.ts` |
| AI | Reports agent is a distinct bounded agent from the Ask agent | ✅ Strong | `apps/web/tests/ai-reports-route.test.ts` |
| Auth | Forged/missing session rejected before the handler runs; password change invalidates sessions; `public` routes bypass | ✅ Strong | `api-auth.test.ts`, `auth-gate.unit.test.ts` |
| Auth | **Middleware navigation gate** (`middleware.ts`) | ❌ **Gap** | No test references `middleware.ts` (`ARCH-521`) |
| Security | Keys encrypted at rest and absent from API responses and exports | ✅ Strong | `ai-settings.test.ts`, `market-data-connections.test.ts` |
| Security | Upstream error text never echoed to the client | ✅ Strong | `ctrader-mcp/errors.test.ts:23`, `ctrader-mcp-preview-route.test.ts` |
| Storage | Insert validation, rollback, dedup, note integrity | ✅ Strong | `apps/web/tests/execution-storage.test.ts` |
| Storage | Legacy-schema additive migrations | ✅ Good | 4 migration tests |
| Storage | Schema ↔ `BOOTSTRAP_SQL` drift | ⚠️ Partial | Asserted only indirectly via migration tests (`ARCH-518`) |
| Sync | One bad broker record does not fail the batch; skip reasons capped | ✅ Strong | `apps/web/tests/sync-resilience.test.ts` |
| Sync | IBKR timezone provenance cannot be silently mixed or diluted | ✅ Strong | `apps/web/tests/ibkr-sync-timezone.test.ts` |
| Sync | **Non-IBKR broker syncs** (Alpaca, Questrade, cTrader over the broker SDK) | ⚠️ Partial | `ibkr-sync-timezone.test.ts` mentions rotating Questrade credentials; there is no dedicated Questrade/Alpaca sync suite (`ARCH-532`) |
| Prop firms | Cash arithmetic, precision, refund caps, payout receipt integrity, corrections, idempotency | ✅ Strong | `apps/web/tests/prop-firms.test.ts` |
| Market data | MFE/MAE estimation honesty; provider adapters; transport rate caps and LRU | ✅ Strong | `market-data.test.ts`, `market-providers.test.ts`, `market-transport.test.ts` |
| Market data | **Currency conversion** (`server/currency-conversion.ts`) | ❌ **Gap** | Zero references in any test (`ARCH-522`) |
| Analytics UI | Calendar denominators, extrema, trailing windows, scope intersection | ✅ Strong | `calendar-insights.test.ts`, `performance-trends.test.ts`, `trade-explorer.test.ts` |
| Timezone | Statement vs display timezone independence; midnight/DST alignment | ✅ Strong | `apps/web/tests/timezone.test.ts` |
| UI | Dashboard layout persistence; sidebar state; theme; privacy; dictation; note formatting | ✅ Good | 10 files |
| UI | **58 presentational / chart components** | ❌ **Gap** | Unreferenced by any test (`ARCH-522`) |
| UI | Radix `Select`/`Tabs`/`Dialog` interaction behaviour | ❌ **Gap** | Explicitly deferred to manual browser QA (`broker-connect.test.ts:26`) |
| Architecture | ADR 0001/0002 HTTP boundary enforcement | ✅ Strong | `ctrader-mcp/boundary.test.ts` |
| E2E | **Automated browser / end-to-end suite** | ❌ **Gap** | None exists (`ARCH-510`) |
| E2E | **Functional API smoke in CI** | ❌ **Gap** | `verify-features.py` is manual (`ARCH-508`) |
| Quality | **Coverage measurement** | ❌ **Gap** | No coverage tool installed (`ARCH-530`) |
| Quality | **Flaky timeout under parallel load** | ⚠️ Risk | `review-export.test.ts` failed at the 8 s budget under full-suite load; passes in isolation (`ARCH-501`, `ARCH-503`) |
| Quality | **Tauri desktop Rust code** | ❌ **Gap** | `cargo test` never runs in CI |
| Quality | **Test skips** | ✅ Clean | No `.skip`, `.todo` or `.only` anywhere in `apps/web/tests` or `packages/*/tests` — every case is live. `ARCH-533` |

---

## 10.14 Coverage-by-domain summary

| Domain | Test files | Cases | Strength |
|---|---|---|---|
| AI (runtime, scope, capabilities, import, UI) | 12 | 181 | Strong |
| Import pipeline / storage / DB | 10 | 125 | Strong |
| cTrader MCP | 9 | 88 | Strong |
| Importers / broker formats | 6 | 92 | Strong |
| Frontend UI logic | 14 | 80 | Good (no chart/panel coverage) |
| Market data | 5 | 57 | Strong |
| Engine (`packages/core`) | 4 | 45 | Strong |
| Analytics presentation | 7 | 49 | Good |
| Domain services (prop firms, settings, routines) | 4 | 33 | Good |
| Auth / transport | 3 | 12 | Good (middleware uncovered) |
| **E2E / browser** | **0** | **0** | **None** |
| **Coverage measurement** | **0** | **0** | **None** |
| **Total** | **74** | **762** | |

---

## 10.15 Evidence register

| ID | Claim | Source | Status |
|---|---|---|---|
| ARCH-500 | No browser automation (Playwright/Cypress/Puppeteer) in the repo | `node_modules/@playwright`, `node_modules/@testing-library` absent; `package.json:28-34`; `apps/web/package.json` | VERIFIED |
| ARCH-501 | Full suite observed: 1 failed / 761 passed of 762 across 74 files; failure is `review-export.test.ts` at the 8 s budget; passes in isolation in 5.4 s | `pnpm test` run 2026-10-21; `apps/web/tests/review-export.test.ts:4-6`; `npx vitest run apps/web/tests/review-export.test.ts --testTimeout=60000` | VERIFIED |
| ARCH-502 | Vitest `include` is limited to `packages/*/tests/**` and `apps/*/tests/**` | `vitest.config.ts:8` | VERIFIED |
| ARCH-503 | No global `testTimeout`; the only override is `vi.setConfig({ testTimeout: 8000 })` | `vitest.config.ts:6-11`; `apps/web/tests/review-export.test.ts:6` | VERIFIED |
| ARCH-504 | `pnpm test` = `vitest run`; `AGENTS.md:268` says "`--run`" | `package.json:18-19`; `AGENTS.md:268` | VERIFIED |
| ARCH-505 | Test deps are only vitest, jsdom, prettier, tsup, typescript — no coverage package | `package.json:28-34` | VERIFIED |
| ARCH-506 | Per-fork temp `JOURNAL_DATA_DIR` set before static imports | `apps/web/tests/vitest-setup.ts:1-16` | VERIFIED |
| ARCH-507 | Integration = real SQLite + real route handlers under one Vitest project | `apps/web/tests/execution-storage.test.ts:10-12`; `apps/web/tests/ai-settings.test.ts:9`; `apps/web/tests/ibkr-timezone-migration.test.ts:10-12` | VERIFIED |
| ARCH-508 | `verify-features.py` is a manual, loopback-only, disposable-data functional smoke | `scripts/verify-features.py:1-13,21-102` | VERIFIED |
| ARCH-509 | `benchmark-journal.py` is a manual read-only latency benchmark | `scripts/benchmark-journal.py:1-45` | VERIFIED |
| ARCH-510 | Browser QA is manual and has no automated counterpart | `apps/web/tests/broker-connect.test.ts:26`; no browser driver in deps | VERIFIED |
| ARCH-511 | Two fixture files, loaded via `import.meta.url` | `packages/importers/tests/fixtures/`; `ninjatrader.test.ts:9`; `pepperstone.test.ts:12` | VERIFIED |
| ARCH-511a | 64 files / 625 cases under `apps/web/tests/` (9 of them `ctrader-mcp/`); no test directory for the Tauri app; single Rust `#[test]` never run | Vitest JSON reporter; `desktop/src-tauri/src/paths.rs:23`; glob of `desktop/**` | VERIFIED |
| ARCH-512 | 74 test files / 762 cases; per-file inventory with domains | `pnpm test` and `vitest run --reporter=json` runs of 2026-10-21 | VERIFIED |
| ARCH-513 | Each AI test file's pinned behaviours | 12 files cited individually in §10.6 | VERIFIED |
| ARCH-514 | AI providers are never contacted; `fetch` stub throws on any call | `ai-runtime.test.ts:14-19`; `ai-scope.test.ts:23-27`; `ai-capability.test.ts:36`; `ai-settings.test.ts:37-41` | VERIFIED |
| ARCH-515 | `packages/core` invariants (round trips, metrics, analysis, overview regression) | `packages/core/tests/*.test.ts` cited in §10.7 | VERIFIED |
| ARCH-516 | `packages/importers` format matrix, identity, skip reasons, dates | `packages/importers/tests/*.test.ts` cited in §10.7 | VERIFIED |
| ARCH-517 | DB isolation pattern; 24 files reference `JOURNAL_DATA_DIR` | `apps/web/tests/execution-storage.test.ts:7-9`; grep across `apps/web/tests` | VERIFIED |
| ARCH-518 | No schema-drift assertion between Drizzle schema and `BOOTSTRAP_SQL` | `apps/web/src/db/`; no test file references both | VERIFIED |
| ARCH-519 | API gate behaviour pinned twice (integration + unit) | `apps/web/tests/api-auth.test.ts:14-42`; `auth-gate.unit.test.ts:17-45` | VERIFIED |
| ARCH-520 | `next/headers` mocked with the one-line cookie stub in 7 files | grep of `apps/web/tests` | VERIFIED |
| ARCH-521 | `apps/web/src/middleware.ts` has no test reference | grep of `apps/web/tests` for "middleware" → 0 hits; `apps/web/src/middleware.ts:9-25` | VERIFIED |
| ARCH-522 | 58 of 237 `apps/web/src` modules unreferenced by tests, incl. `server/currency-conversion.ts` and every chart component | Normalised name/path match of test corpus against `apps/web/src` | VERIFIED (method); coverage itself is INFERRED — a module can be exercised indirectly without being named |
| ARCH-523 | `vi.hoisted` + partial `vi.mock("ai")` preserving real SDK error classes | `apps/web/tests/ai-runtime.test.ts:8-19,2` | VERIFIED |
| ARCH-524 | 14 distinct `@/components/*` mocks; children stubbed to `() => null` | `apps/web/tests/ai-ui.test.ts:14-49`; grep of `vi.mock` targets | VERIFIED |
| ARCH-525 | `vi.stubEnv` / `vi.stubGlobal` with cleanup in `afterEach` | `apps/web/tests/ai-settings.test.ts:33-41` | VERIFIED |
| ARCH-526 | `vi.fn()` for outbound calls, reset in `beforeEach` | `apps/web/tests/ai-runtime.test.ts:57-68` | VERIFIED |
| ARCH-527 | Architectural rules enforced as a filesystem-scanning test | `apps/web/tests/ctrader-mcp/boundary.test.ts:1-45` | VERIFIED |
| ARCH-528 | SQLite, `@luxalgo/journal-core`, `pdf-lib` and the real font are never mocked | test imports across `apps/web/tests`, `packages/*/tests` | VERIFIED |
| ARCH-529 | CI runs `pnpm test` with no coverage/retry/shard/reporter flags | `.github/workflows/ci.yml:22`; `package.json:18` | VERIFIED |
| ARCH-530 | No coverage tooling installed anywhere | `package.json`, `apps/web/package.json`, `packages/*/package.json`, `node_modules` | VERIFIED |
| ARCH-531 | `release.yml` also runs `pnpm test` before publishing | `.github/workflows/release.yml:35-36` | VERIFIED |
| ARCH-532 | No dedicated non-IBKR broker sync suite | `apps/web/tests/` inventory; `ibkr-sync-timezone.test.ts` is the only broker-sync file | VERIFIED (by inventory) |
| ARCH-533 | Zero `.skip` / `.todo` / `.only` in the entire test tree | grep of `apps/web/tests` and `packages/*/tests` → 0 hits | VERIFIED |
| ARCH-534 | The single Rust test (`desktop/src-tauri/src/paths.rs:23`) is never run by CI | `.github/workflows/ci.yml`; `.github/workflows/release.yml` | VERIFIED |
