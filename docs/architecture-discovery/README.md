# Architecture Discovery — Progress Tracker

> Read-only investigation of the trade-journal monorepo for downstream AI-architecture redesign.

| Phase | Report                                   | Status   | Subagent                               | Notes                                      |
| ----- | ---------------------------------------- | -------- | -------------------------------------- | ------------------------------------------ |
| 1     | `01-project-overview.md`                 | **done** | ProjectOverviewAudit (+ fix)           | rewritten after FAIL review                |
| 2     | `02-ai-architecture.md`                  | **done** | AIAudit (+ minor fix)                  | 27 KB, 25 evidence IDs                     |
| 3     | `03-domain-model.md`                     | **done** | DomainDataAudit (+ fix)                | 23 tables, Mermaid ER, lifecycle           |
| 4     | `04-data-architecture.md`                | **done** | DomainDataAudit (+ fix)                | tables, indexes, transactions, limitations |
| 5     | `05-events-and-background-processing.md` | **done** | FrontendEventsAuthRuntimeAudit (+ fix) | no event infra, no streaming               |
| 6     | `06-frontend-architecture.md`            | **done** | FrontendEventsAuthRuntimeAudit (+ fix) | AskJournal host corrected to `/reports`    |
| 7     | `07-authentication-and-security.md`      | **done** | FrontendEventsAuthRuntimeAudit (+ fix) | no server-side session expiry              |
| 8     | `08-runtime-and-operations.md`           | **done** | FrontendEventsAuthRuntimeAudit (+ fix) | Tauri runtime + JOURNAL_DATA_DIR defect    |
| 9     | `09-dependencies-and-coupling.md`        | **done** | DependenciesCouplingAudit (+ fix)      | 6-layer AI DAG; cycle-free                 |
| 10    | `10-testing-and-quality.md`              | **done** | TestingQualityAudit (+ fix)            | 74 files / 762 cases; one historical flake |
| 11    | `11-architectural-readiness.md`          | **done** | ReadinessMatrix                        | 15-row matrix; tier readiness              |
| —     | `ARCHITECTURE_CONTEXT.md`                | **done** | orchestrator                           | final consolidated package                 |
| —     | `CODE_NAVIGATION.md`                     | **done** | orchestrator                           | file map; absent components called out     |
| —     | `EVIDENCE_REGISTER.md`                   | **done** | orchestrator                           | finding ↔ source cross-ref                 |
| —     | `REVIEW-ai.md`                           | done     | Reviewer-AI                            | PASS-WITH-2-MINOR-FIXES                    |
| —     | `REVIEW-domain-data.md`                  | done     | Reviewer-DomainData                    | FAIL → all fixes applied                   |
| —     | `REVIEW-frontend-events-auth-runtime.md` | done     | Reviewer-FEAR                          | PASS-WITH-MINOR-FIXES → fixes applied      |
| —     | `REVIEW-project-overview.md`             | done     | Reviewer-ProjectOverview               | FAIL → all fixes applied                   |
| —     | `REVIEW-dependencies-coupling.md`        | done     | Reviewer-DependenciesCoupling          | FAIL → all fixes applied                   |
| —     | `REVIEW-readiness.md`                    | done     | Reviewer-Readiness                     | PASS                                       |
| —     | `REVIEW-testing-quality.md`              | done     | Reviewer-TestingQuality                | PASS-WITH-MINOR-FIXES → fixes applied      |

## Deliverables count

- 11 numbered reports (Phase 1–11)
- 7 review artifacts
- 4 synthesis documents (`ARCHITECTURE_CONTEXT.md`, `CODE_NAVIGATION.md`, `EVIDENCE_REGISTER.md`, this README)
- 1 post-merge delta section (§O of `ARCHITECTURE_CONTEXT.md`) + 20 evidence IDs `ARCH-901..ARCH-920` covering the cTrader MCP sync account model, the other pulled features, and the OpenAI-compatible AI provider delta (`ARCH-911..ARCH-920`)

## Post-merge delta — `e45707b` (2026-10-21)

The user pulled upstream into the fork after the first cut of the investigation. The following additions are documented as a delta in `ARCHITECTURE_CONTEXT.md §O`, `CODE_NAVIGATION.md` (post-merge table), and `EVIDENCE_REGISTER.md` (ARCH-901..ARCH-920 — `ARCH-901..ARCH-910` for the pulled features, `ARCH-911..ARCH-920` for the OpenAI-compatible provider).

The user-flagged gap is:

**cTrader sync accounts** — the journal already has a fully-wired broker-connect path for cTrader that operates **outside** the `@luxalgo/broker-sdk`. Key facts:

- `accountType` (the broker-defined account model, e.g., `"HEDGE"` / `"NET"`) is typed as `z.string()` in `apps/web/src/server/ctrader-mcp/schemas.ts:6-16` — it is **not** a closed enum in the journal.
- `isLive: boolean` distinguishes Live vs Demo accounts; that _is_ the discriminator the UI surfaces (`app/import/page.tsx:1223`).
- One local `accounts` row maps to one cTrader upstream account; `(kind: "sync", broker: "ctrader-mcp", credentialsEnc = AES({endpoint, authHeader?, ctraderAccountId}))` is the journal-side state.
- Creation flow (`/api/accounts` POST) seeds `initialBalance` + `currency` from `get_balance`; bad credentials delete the half-created row.
- Sync runs the same `insertExecutions + rebuildAccount` engine path used by the SDK brokers; result lands in `accounts.snapshotJson` and `accounts.lastSyncAt`.
- The `mode: "remote"|"local"` toggle that appeared in the planning doc was dropped — current implementation is local-only.
- `@ai-sdk/mcp@^2.0.73` (the only `@ai-sdk` import that is **not** AI tooling) is the transport for cTrader upstream; verified by grep that no other `@ai-sdk/mcp` import exists.

Other features added in the same merge (also documented in §O):

- **XTB** broker support (XLSX + format adapter)
- **IBKR Flex XML** import alongside the existing Flex CSV path
- **Trade ROI** endpoint + UI
- **Replay chart** rewrite with 157 dedicated tests
- **AI settings UI** rewrite
- **DB concurrent init** safety guard
- **`packages/core/src/returns.ts`** (new engine helper)
- **`broker-trades.ts`** shared sync helper
- **`import_batches`** table
- **Settings encryption flow** changes
- **OpenAI-compatible AI provider** — third `AiProvider` union member (`compatible`); `@ai-sdk/openai-compatible@3.0.46` SDK; `buildModel()` single-factory in `ai-runtime.ts:67-83`; import stays hosted-only by design. See `ARCHITECTURE_CONTEXT.md §O.5` and `EVIDENCE_REGISTER.md` ARCH-911..ARCH-920.

## Key resolved questions

**Q: Has the AI migration plan been implemented?**
A: Substantially yes. The plan in `docs/superpowers/plans/2026-10-08-ai-agent-architecture-migration.md` is dated 2026-10-08 and pre-dates the current implementation. As of 2026-10-21, the codebase has:

- A provider-neutral runtime (`ai-runtime.ts`)
- A per-feature policy table (`ai-contracts.ts`)
- Bounded tool-loop agents for Ask Journal and Reports
- Typed capabilities for 8 reports (4 dormant, awaiting wiring)
- Frozen approved scope as a load-bearing boundary

What is **not** done from the plan:

- The 4 dormant capabilities (`playbookRulesForTrade`, `missedObservations`, `notebookEntries`, `progressHistory`) are not wired as tools.
- No chat persistence.
- No streaming.
- No observability storage (metadata is ephemeral).

## Evidence conventions

Every architectural claim uses an evidence ID `ARCH-NNN` referenced from one or more reports. Status tags:

- `VERIFIED` — directly traceable to code, schema, or config as cited
- `INFERRED` — reasonable conclusion from code; indirect support
- `UNVERIFIED` — requires runtime / infrastructure not available
- `UNKNOWN` — cannot determine from repo material

## Working rules

- Only files in `docs/architecture-discovery/` were modified.
- No application code, configuration, schema, or data was touched.
- No new dependencies introduced.
- No telemetry endpoints added.
- Secrets never quoted; placeholder values used.

## Known defects surfaced (not fixed)

These are documented in the deliverables and are NOT fixed because that would be implementation, which is out of scope:

| Defect                                                              | Source                                   | Reported in                               |
| ------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `PORT=0` Tauri defect                                               | `desktop/src-tauri/src/server.rs:60-72`  | `08 §8.x`, `09 §9.10` ARCH-618 / ARCH-405 |
| `JOURNAL_DATA_DIR` default `/data/trade-journal`                    | `apps/web/src/db/index.ts:8`             | `01 §10`, `08 §8.3` ARCH-402              |
| `NEXT_TELEMETRY_DISABLED` claim in AGENTS.md contradicts Dockerfile | `AGENTS.md:260` vs `Dockerfile`          | `08 §8.x`, `01 §10` ARCH-403 / ARCH-829   |
| Tauri sidecar Node version drift                                    | `AGENTS.md:88` vs `desktop/README.md:25` | `01 §10` ARCH-818                         |
| No server-side session expiry                                       | `apps/web/src/server/auth.ts:23-29`      | `07 §7.8` ARCH-303                        |
| No coverage tooling                                                 | CI uses bare `vitest run`                | `10 §10.6`                                |
| No tests for `middleware.ts` / `currency-conversion.ts`             | grep                                     | `10 §10.9`                                |
| `prop_audit` grows indefinitely                                     | no row eviction                          | `04 §6.10`                                |

## Important next-architect decisions

These are left open in `ARCHITECTURE_CONTEXT.md §N`; the investigation does not pre-decide them.

1. Observation schema design (facts / user-reported / derived / AI-interpreted / hypothesis / confirmed).
2. Event publication model (in-tx vs after-commit vs worker).
3. Chat persistence target (per-session, scope-bound?).
4. Worker runtime on top of SQLite WAL (separate process? external queue?).
5. Hardening auth (CSRF, rotation, rate limits).
6. AI response shape (markdown / structured / generative UI).
7. Multi-tenant (in or out for self-hosted).
8. Durable workflow representation.
9. AI-initiated interaction surface (toasts / cards / inbox).
10. Telemetry policy for an AI-native direction.
