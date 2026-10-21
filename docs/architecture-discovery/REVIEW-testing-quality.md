# Testing & Quality Report — Review

Reviewed: `docs/architecture-discovery/10-testing-and-quality.md`
Reviewer method: independent re-run of the full suite (`vitest run --reporter=json`), plus source-level spot-checks of every numeric, path and CI claim. Verification date: 2026-10-21.

## Overall Verdict

**PASS-WITH-MINOR-FIXES**

The report's load-bearing quantitative claims are correct and independently reproduced: **74 test files / 762 test cases**, with **every one of the 74 per-file case counts matching my own Vitest JSON run exactly** (0 mismatches across all 74 rows). The CI pipeline contents, the Vitest configuration, the "no browser automation", "no coverage tooling", and "zero `.skip`/`.todo`/`.only`" claims all verify against source. The report is honest about its own gaps.

Defects are confined to: one self-contradicting case count (§10.7), an unreproducible "observed suite result" (1 failed / 761 passed) with no committed run artifact, several off-by-one line citations, one unsupported performance figure with a broken cross-reference, and two inaccurate supporting claims in the evidence register.

---

## Findings table

| ID | Claim | Report states | Actual source | Status | Notes |
|---|---|---|---|---|---|
| F-01 | Total test files | 74 | `git ls-files "*tests/*.test.ts"` → 74 | ✅ VERIFIED | 64 under `apps/web/tests/`, 4 under `packages/core/tests/`, 6 under `packages/importers/tests/`. Exactly as reported. |
| F-02 | Total test cases | 762 | Vitest JSON reporter, my run: `numTotalTests: 762` | ✅ VERIFIED | Independent run. |
| F-03 | Per-file inventory, all 74 rows | table in §10.5 | My JSON run, machine-compared row by row | ✅ VERIFIED | 74 rows parsed from the report table, **0 mismatches**, 0 files in the run missing from the table. The table is exact. |
| F-04 | Domain group totals (§10.14) | AI 12/181, pipeline 10/125, cTrader 9/88, importers 6/92, frontend 14/80, market 5/57, engine 4/45, analytics 7/49, domain 4/33, auth 3/12 | Recomputed from my per-file counts | ✅ VERIFIED | Every group total and the 74/762 grand total recompute exactly. |
| F-05 | **Observed suite result** | `1 failed \| 73 passed (74)` / `1 failed \| 761 passed (762)` / `Duration 184.36s` | My full run: **74 passed, 762 passed, 0 failed**, duration 80.25 s | ⚠️ NOT REPRODUCIBLE | The failure does not recur — `review-export.test.ts` passes in the full suite on this machine. The report's own diagnosis (load-sensitive 8 s timeout) is credible and the isolated re-run claim is confirmed: I ran it standalone → **2.81 s for the test, 5.04 s wall** (report says 5.4 s). But presenting a stale red run as "**Observed suite result**" is misleading to a reader who will assume the suite is currently failing. Also: **184.36 s vs my 80.25 s** — a 2.3× gap that the report does not attribute to machine/load. |
| F-06 | Evidence artifact for the run | "Case counts are the authoritative per-file totals reported by Vitest's JSON reporter (`--reporter=json`) for the full-suite run of 2026-10-21"; ARCH-512 cites that run | No vitest JSON report, log, or trace exists in the repo. Only `apps/web/components.json` and `package.json` match `*.json` at repo level; `docs/architecture-discovery/` is entirely untracked (`??`) | ❌ MISSING ARTIFACT | The numbers are correct (I reproduced them independently), but the cited evidence was never persisted. ARCH-501/511a/512 are therefore not independently checkable from the repo alone. |
| F-07 | §10.7 importers case count | "`packages/importers` — **73 cases**" | **92** (§10.5, §10.14 and my run all say 92) | ❌ WRONG | Self-contradictory within the same report. Actual: 31+22+14+13+9+3 = 92. The "73" appears to be a leftover. |
| F-08 | `packages/core` case count | 45 | 18+14+9+4 = 45 | ✅ VERIFIED | |
| F-09 | cTrader carve-out | 9 files, 88 cases | 9 files, 88 cases | ✅ VERIFIED | |
| F-10 | Non-cTrader app-level remainder | "55 non-ctrader-mcp files … the remaining 537 cases" | 64−9 = 55 files; 625−88 = 537 cases | ✅ VERIFIED | |
| F-11 | Vitest config | `include`, `alias`, `setupFiles`, `pool: "forks"`, `esbuild.jsx: automatic`; no global `testTimeout` | `vitest.config.ts` (12 lines) matches the quoted block verbatim; `include` at line 8 as cited in ARCH-502 | ✅ VERIFIED | Single root project; no `vitest.workspace.*`, no per-package configs — confirmed. |
| F-12 | `vitest.config.ts` cited range | "vitest.config.ts:1-12" | File is exactly 12 lines | ✅ VERIFIED | |
| F-13 | `package.json` script line refs | §10.2 "package.json:17-19"; ARCH-504 "package.json:18-19" | `"test"` is line **19**, `"test:watch"` line **20** | ⚠️ OFF BY 2 | Content correct; line refs wrong in both places. |
| F-14 | Dependency set | `vitest@^3.2.0`, `jsdom@^26.1.0`, prettier, tsup, typescript; no coverage/ui packages | `package.json:28-34` — exact match | ✅ VERIFIED | Installed Vitest is **3.2.7**, matching §10.1's table. |
| F-15 | `packageManager` line | `package.json:13` | Line 13 = `"packageManager": "pnpm@11.0.8"` | ✅ VERIFIED | |
| F-16 | CI step list | 7 `run:` steps in the quoted order | `.github/workflows/ci.yml:19-25` — exact match, `pnpm test` at line 22 as cited in ARCH-529 | ✅ VERIFIED | `ubuntu-latest`, Node 22, pnpm cache, triggers on push-to-main + all PRs (ci.yml:3-6) — all correct. |
| F-17 | `release.yml` re-runs the suite | "`release.yml:35-36`" | `pnpm typecheck` = line 34, `pnpm test` = line **35** | ⚠️ OFF BY 1 | Should read `release.yml:34-35`. ARCH-531 repeats the wrong range. |
| F-18 | Web app typecheck script | "`apps/web/package.json:9`" | Line **10** | ⚠️ OFF BY 1 | |
| F-19 | No browser automation | no Playwright/Cypress/Puppeteer/Webdriver; `@playwright` and `@testing-library` absent | No matches in `node_modules/.pnpm` for coverage/playwright/cypress/puppeteer/testing-library; no `@vitest` scope at all | ✅ VERIFIED | |
| F-20 | No coverage tooling | absent from every package.json and from node_modules | `node_modules/.pnpm` contains no `coverage*` entry; no `@vitest` directory | ✅ VERIFIED | ARCH-530 correct. |
| F-21 | Zero `.skip`/`.todo`/`.only` | "0 hits" | Grep for `\`.skip(\|\.todo(\|\.only(` over `apps/web/tests` + both package test dirs → **0** | ✅ VERIFIED | ARCH-533 correct. The ~19 initial hits were `skippedRows`/`skippedReasons` identifiers, not skip calls. |
| F-22 | jsdom opt-in count | 6 files | Exactly 6 files carry `// @vitest-environment jsdom`; list matches | ✅ VERIFIED | |
| F-23 | Per-fork isolation | `vitest-setup.ts` sets `JOURNAL_DATA_DIR` via `mkdtemp` before static imports; `rmSync` imported but unused | File matches the quoted block verbatim; `rmSync` indeed unused in it | ✅ VERIFIED | |
| F-24 | 24 files reference `JOURNAL_DATA_DIR` | 24 | `grep -rl` → **24** | ✅ VERIFIED | ARCH-517 correct. |
| F-25 | DB isolation variants | `process.env` assignment (most) vs `vi.stubEnv` in `ibkr-sync-timezone` / `ibkr-timezone-migration` / `timezone` | All three `stubEnv("JOURNAL_DATA_DIR", …)` call sites confirmed at line 9 of each | ✅ VERIFIED | |
| F-26 | `next/headers` mocking | §10.11 table: "10 files — **always** `{ cookies: async () => ({ get: () => undefined }) }`"; §10.9 + ARCH-520: 7 files with the one-line stub | 10 files mock `next/headers`; but 3 of them (`api-auth`, `auth-gate.unit`, `market-data-connections`) use a **session-token variant**: `get: () => (session.token ? { value: session.token } : undefined)` | ⚠️ PARTLY WRONG | The count 10 is right; "always" is wrong. ARCH-520's "7 files" is the correct figure for the exact one-line form. |
| F-27 | `@/lib/use-api` mocked in | `ai-ui`, `ai-import-ui`, `broker-connect` | Also `notebook-folder-delete.test.ts:13` | ⚠️ INCOMPLETE | 4 files, not 3. |
| F-28 | `@/components/*` mocks | "14 distinct components" | 14 distinct `vi.mock("@/components/…")` targets | ✅ VERIFIED | |
| F-29 | Other mock targets | `@/server/ai` ×3, `next/navigation` ×2, `@luxalgo/vela` ×1, `@/server/ctrader-mcp/client` ×2, `@/server/executions` ×1 | All match `grep -rho 'vi.mock("…"'` counts | ✅ VERIFIED | One target not listed: `vi.mock("../src/server/ai-runtime")` (relative-path form) in `ai-runtime.test.ts`. |
| F-30 | `handler()` wraps every route | "the common gate: `handler()` … wraps every route" | **All 43** `apps/web/src/app/api/**/route.ts` files import and call `handler(`; zero exceptions | ✅ VERIFIED | Stronger than stated, and independently confirmed. |
| F-31 | Middleware uncovered | `middleware.ts` has zero test references | `grep -rn "middleware" apps/web/tests packages/*/tests` → **0** | ✅ VERIFIED | ARCH-521 correct. |
| F-32 | `currency-conversion.ts` uncovered | zero references | `grep -rn "currency-conversion"` → **0** | ✅ VERIFIED | ARCH-522 correct. |
| F-33 | Unreferenced module count | "58 of 237" | Total `.ts/.tsx` under `apps/web/src` = **237** ✅. Unreferenced: my basename match gives **60**, path match gives 119; the report's "normalised name/path" method is not specified enough to reproduce 58 | ⚠️ NOT REPRODUCIBLE (±2) | The number is directionally right and the report already flags the method as VERIFIED-method / coverage INFERRED. Named examples all check out: `middleware.ts`, `server/currency-conversion.ts`, `lib/use-ai-request.ts`, `lib/filter-description.ts`, `lib/use-account-default.ts`, `server/position-import.ts`, `server/ninjatrader-order.ts` are all unreferenced. `components/charts/` = 10 files unreferenced ✅. |
| F-34 | `components/ui/*` list | "all components/ui/* primitives (badge, date-picker, dropdown-menu, hover-card, option-select, popover, skeleton)" | 8 ui modules are unreferenced — the list omits `sheet.tsx` | ⚠️ INCOMPLETE | |
| F-35 | Tauri test | single `#[test]` at `desktop/src-tauri/src/paths.rs:23`, never run by CI | `#[test]` at line 23 ✅; `grep -rn "#\[test\]" desktop/src-tauri/src/` → **1** ✅; `grep -rn "cargo" .github/workflows/` → **0** | ✅ VERIFIED | ARCH-534 correct. |
| F-36 | "no `tests/` directory in `apps/desktop`/`desktop`" | — | There is **no `apps/desktop`** at all (only `apps/web`); the Tauri app lives at repo-root `desktop/` | ⚠️ SLOP | The conclusion (no JS/Rust suite) holds; the path phrasing "apps/desktop/desktop" describes a directory that does not exist. |
| F-37 | `verify-features.py` | 102 lines; loopback+port guard; refuses ports 3000/3001; random `uid` fixtures | 102 lines ✅; guard at lines 12-13 (report cites 10-13) ✅ behaviour; `uuid.uuid4().hex[:8]` ✅ | ✅ VERIFIED | Endpoint list in the report is a subset — the script also hits `/api/notes`, `/api/workspace/missed`, `/api/workspace/progress`, `/api/workspace/templates`. Not presented as exhaustive. |
| F-38 | `benchmark-journal.py` | 45 lines; four read routes; `--samples` 1-30; first sample discarded as warm-up | 45 lines ✅; routes `/api/stats`, `/api/analysis`, `/api/adherence`, `/api/trades?view=list` ✅; `1 <= samples <= 30` ✅; `range(samples + 1)` then drop-first ✅ | ✅ VERIFIED | The report says "Same loopback-only guard" — the port-exclusion of 3000/3001 exists **only** in `verify-features.py`; the benchmark allows any loopback port (safe, since it is read-only). Wording implies more than is there. |
| F-39 | Python scripts not in CI | not wired into any workflow | `grep -rn "python\|verify-features" .github/workflows/` → **0** | ✅ VERIFIED | |
| F-40 | Per-fork startup cost | "`pool: "forks"` … ~**4 s startup per file** (see 10.13)" | My JSON run: summed per-file wall time **58.1 s** over 74 files = **0.79 s/file** average; whole suite 80.25 s | ❌ UNSUPPORTED | No per-file 4 s startup exists in this run. Worse, the "(see 10.13)" cross-reference points at §10.13 "Critical behaviours covered", which never discusses startup — a broken pointer. The 4 s figure is likely an artefact of the author's loaded machine (the same run whose duration was 184 s vs my 80 s). |
| F-41 | `review-export.test.ts` timeout budget | `vi.setConfig({ testTimeout: 8000 })` is the only override | Only `setConfig`/`testTimeout` occurrence in the whole tree is `review-export.test.ts:6` | ✅ VERIFIED | ARCH-503 correct. |
| F-42 | AI policy constants pinned | reflection `maxOutputTokens 1200`; Ask/Reports `1200 / 30_000 / 4 / 4`; statementImport `maxRetries 0`, `timeoutMs 120_000` | `apps/web/src/server/ai-contracts.ts:42-57` matches exactly; `ai-runtime.test.ts:71-88` asserts them | ✅ VERIFIED | |
| F-43 | Prompt version regexes | `/^reflection-v\d+$/` etc. | `ai-runtime.test.ts:89-95` — four regexes as described | ✅ VERIFIED | |
| F-44 | OpenAI `store: false` | present on OpenAI requests only | `ai-runtime.ts` sets `providerOptions.openai.store = false` at 4 sites; Anthropic paths carry none | ✅ VERIFIED | |
| F-45 | AI never contacts a provider | `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic` mocked with `vi.hoisted`; `fetch` stub throws | `ai-runtime.test.ts:8-19` — partial mock with `...(await original())` preserving real `APICallError`/`LoadAPIKeyError`/`RetryError` ✅; `ai-settings.test.ts:31-36` fetch stub throws ✅ | ✅ VERIFIED | ARCH-523/525 correct. |
| F-46 | Report-context 6 KB cap | capped at 6 KB | `ai-report-context.ts:35` `MAX_OUTPUT_BYTES = 6 * 1024`; test comment at `ai-report-context.test.ts:102` | ✅ VERIFIED | |
| F-47 | Architectural guard | filesystem-scanning test, two regex layers, forbids cTrader imports in `packages/importers/src/**` | `boundary.test.ts:1-45` — `RAW_HTTP_*` + `IDENT_AXIOS_*` layers confirmed | ✅ VERIFIED | ARCH-527 correct. |
| F-48 | Never mocked | `better-sqlite3`, `@luxalgo/journal-core`, `pdf-lib` + real font | No `vi.mock` for any of these; `review-export.test.ts:9` reads the real `NotoSans-Regular.ttf` | ✅ VERIFIED | |
| F-49 | No snapshot files / MSW / nock | none | No `__snapshots__`/`.snap` files; no `msw`/`nock` in the tree | ✅ VERIFIED | |
| F-50 | `BROOTSTRAP_SQL` vs Drizzle schema | no test asserts schema↔`BOOTSTRAP_SQL` parity | 3 tests import `BOOTSTRAP_SQL` (`folder-delete`, `history-import`, `ibkr-timezone-migration`); **no test imports `db/schema` at all** | ✅ VERIFIED | ARCH-518 correct. |
| F-51 | `AGENTS.md` drift | only the `--run` wording is called out | `AGENTS.md:265` says core "5 files" (4 test files + `helpers.ts` — arguably fine) and importers "**5 files**" (actually 6); `AGENTS.md:266` says "**54** unit/integration tests" (actually 64) | ⚠️ INCOMPLETE | The report scopes AGENTS.md drift to a cosmetic flag mismatch and misses two hard count errors. ARCH-504 is correct on `--run` (`AGENTS.md:268` verified verbatim). |
| F-52 | ARCH-532 supporting claim | "`ibkr-sync-timezone.test.ts` is the **only** broker-sync file" | `apps/web/tests/sync-resilience.test.ts` is also a broker-sync suite (batch partitioning, account `kind: "sync"`) | ⚠️ WRONG SUPPORT | The *conclusion* (no dedicated Questrade/Alpaca sync suite) holds — `ibkr-sync-timezone.test.ts:373-386` does exercise rotating Questrade credentials, and Alpaca appears only as a broker label in IBKR-sync tests — but the "only broker-sync file" premise is false. |
| F-53 | Legacy-migration tests | "4 migration tests" | `folder-delete`, `history-import`, `ibkr-timezone-migration`, `market-csv-migration` — 4 | ✅ VERIFIED | |
| F-54 | Route-handler import pattern | `await import("../src/app/api/…/route")` then call `GET`/`POST` with a `Request` | Confirmed across `ai-settings`, `import-account`, `ibkr-sync-timezone` (17 route imports) | ✅ VERIFIED | |
| F-55 | Broker registry size | "exactly 22 public brokers" | `broker-connect.test.ts:106-107` `expect(brokers).toHaveLength(22)` | ✅ VERIFIED | |
| F-56 | Edge Score | stamped `formula version 2`, refuses to score < 5 closed trades | `metrics.test.ts:124` "every score is stamped with formula version 2" | ✅ VERIFIED | |

---

## Section 10 spec coverage

| Spec area | Report coverage | Verdict |
|---|---|---|
| **Unit test framework** | §10.2 — Vitest 3.2.7, single root project, exact config table, setup file anatomy, dependency list | ✅ Complete and accurate. Line refs off by ≤2 (F-13). |
| **Integration test framework** | §10.3 — correctly identifies there is *no separate* integration framework; six real composition seams documented with file+line examples | ✅ Complete and accurate. The "no separate framework" framing is the right answer. |
| **E2E test framework** | §10.4 — two stdlib Python scripts, loopback guards, invariants asserted, both excluded from CI, browser gap stated | ✅ Complete. "Same loopback-only guard" wording for the benchmark is loose (F-38). |
| **Test organization** | §10.5 — layout map, exact 74-row per-file inventory with per-domain grouping, fixture catalogue, shared-helper note | ✅ Outstanding. The per-file table reproduced **exactly**. One contradicting figure at §10.7 (F-07). |
| **AI tool tests** | §10.6 — 12 files / 181 cases, per-file "what it pins" column with line citations, three mocking conventions, dummy-key policy | ✅ The strongest section. Constants, caps and regexes all independently confirmed (F-42–F-46). |
| **Domain service tests** | §10.7 — core behaviour matrix (≈40 pinned invariants), importers format matrix, "never guess" rule | ✅ Strong. The importers case count in the §10.7 heading is wrong (F-07). |
| **Database tests** | §10.8 — 12 covered aspects, the isolation pattern in code, two variants, no SQL-level harness, explicit schema-drift gap | ✅ Complete, including the honest schema-drift admission (F-50). |
| **API tests** | §10.9 — 12 route/behaviour rows, the shared `handler()` gate pinned twice, `next/headers` convention, middleware gap | ✅ Complete. "wraps every route" verified across all 43 route files (F-30). |
| **Frontend tests** | §10.10 — 6 jsdom files with what each renders, 10 pure-logic files, an explicit "not tested" section | ✅ Complete and balanced. Unreferenced count is ±2 off (F-33) and the `components/ui` list omits one file (F-34). |
| **Mocking conventions** | §10.11 — five numbered conventions with code, a mock-target table, a "never mocked" list | ✅ Complete and accurate. One "always" is wrong (F-26), one target list is short (F-27). |
| **CI test execution** | §10.12 — verbatim 7-step YAML, per-step "what it proves", runner/trigger facts, `release.yml` gate, an explicit not-in-CI list | ✅ Accurate. Two off-by-one line refs (F-17, F-18). |
| **Critical behaviours covered** | §10.13 — 33-row table with ✅/⚠️/❌ verdicts and named evidence | ✅ Genuinely useful triage. One supporting premise false (F-52). |
| *(additional)* Coverage-by-domain summary | §10.14 — group totals, all recomputed | ✅ Exact. |
| *(additional)* Evidence register | §10.15 — 35 ARCH-500…534 rows | ✅ Well-formed; 3 rows carry unsupported/incorrect premises (F-06, F-51, F-52). |

**Gaps not covered by the spec but missing from the report:** nothing material. The report already documents every structural gap it found (coverage tooling, browser E2E, middleware, currency conversion, Rust test, non-IBKR sync).

---

## Required fixes (ordered)

1. **§10.7 — correct the importers case count from "73 cases" to "92 cases".** It contradicts §10.5 and §10.14 of the same report; 92 is the verified figure.
2. **§10.1 — correct the "Observed suite result" block.** The `1 failed | 761 passed` run is not reproducible; a fresh full run on this machine gives `74 passed (74)` / `762 passed (762)` in 80.25 s. Either re-state the block with the green run as the current state, or explicitly label the red run as a historical single observation ("observed once on 2026-10-21; not reproduced — `review-export.test.ts` passes in a full re-run"). Also reconcile the 184.36 s vs 80.25 s duration gap (machine load).
3. **Persist the run evidence.** ARCH-501/511a/512 cite a Vitest JSON report that does not exist in the repo. Commit the reporter output (or a `docs/architecture-discovery/` artifact) so the 74/762 table and the per-file counts are independently checkable, as the review protocol expects.
4. **§10.2 / ARCH-504 — fix the `package.json` script line refs** from `17-19`/`18-19` to `19-20` (`"test"` = 19, `"test:watch"` = 20).
5. **§10.12 / ARCH-531 — fix `release.yml:35-36` to `release.yml:34-35`** (`pnpm typecheck` = 34, `pnpm test` = 35). Also fix `apps/web/package.json:9` → `:10`.
6. **§10.2 — remove or substantiate the "~4 s startup per file" claim.** Measured average is 0.79 s/file (summed per-file wall time 58.1 s / 74 files; suite 80.25 s). Also fix the "(see 10.13)" pointer, which points at a section that never discusses startup.
7. **ARCH-532 — correct the premise.** `ibkr-sync-timezone.test.ts` is *not* the only broker-sync file (`sync-resilience.test.ts` covers broker batch resilience). Restate the claim as "no dedicated per-broker sync suite beyond IBKR" and keep the Questrade/Alpaca gap conclusion, which stands.
8. **§10.11 — fix the `next/headers` row.** It is 10 files, but 3 of them (`api-auth`, `auth-gate.unit`, `market-data-connections`) use a session-token variant, not the one-line constant stub. Change "always" to "7 use the one-line constant stub; 3 use a session-token variant". Add the missing `@/lib/use-api` mock in `notebook-folder-delete.test.ts` and the relative-path `../src/server/ai-runtime` mock.
9. **§10.10 — reconcile the unreferenced-module count.** State the normalisation method precisely enough to reproduce the number, or state it as "≈60 by basename match" alongside the 237 total. Add `components/ui/sheet.tsx` to the primitives list.

## Recommended additional evidence

- **§10.2 / ARCH-504 — record the full `AGENTS.md` drift, not just the `--run` wording.** `AGENTS.md:265` says importers has "5 files" (there are 6) and `AGENTS.md:266` says "54 unit/integration tests" under `apps/web/tests` (there are 64). Both are hard count errors in the same file the report already flags for a cosmetic flag mismatch.
- **§10.5 — clarify the `apps/desktop` reference.** There is no `apps/desktop`; the Tauri app is at repo-root `desktop/`. The conclusion is right, the path is not.
- **§10.4 — state precisely that the 3000/3001 port exclusion lives only in `verify-features.py`.** `benchmark-journal.py` accepts any loopback port; it is safe because it is strictly read-only, but "same guard" overstates the symmetry.
- **§10.9 — strengthen the `handler()` claim to what it actually is.** All 43 `apps/web/src/app/api/**/route.ts` files route through `handler()` — that is a stronger, checkable statement than "the common gate", and worth stating because it is the repo's most load-bearing untested-in-CI-only path.
- **§10.3 — note that `client.test.ts` starts a real loopback server**, i.e. the suite has exactly one real socket server, and that it is the sole reason `pool: "forks"` (not `threads`) matters for that file.
- **Optional, high value:** the two gaps the report itself names — no coverage tooling and no browser E2E — are the only items on its own §10.13 list that would change a reader's decision. If any follow-up work is scoped from this report, those two (plus the `middleware.ts` navigation gate) are the cheapest structural wins: `middleware.ts` is 25 lines with four branches and zero tests.
- **Optional:** record the Vitest JSON reporter artifact location as a stable path in `docs/architecture-discovery/` (e.g. `evidence/vitest-2026-10-21.json`) so future reviews can diff per-file counts rather than re-derive them.
