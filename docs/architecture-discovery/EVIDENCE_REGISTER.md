# Evidence Register

> Cross-reference of architectural findings to source locations. All citations are file paths in the form `path/to/file.ext:line` (line numbers approximate, ±3). Authoritative per-report detail is in the individual reports.

The IDs are partitioned by topic for legibility:

| Range          | Topic                                            | Source report                                                            |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| ARCH-001 – 099 | AI architecture, domain model, data architecture | `02-ai-architecture.md`, `03-domain-model.md`, `04-data-architecture.md` |
| ARCH-100 – 199 | Frontend                                         | `06-frontend-architecture.md`                                            |
| ARCH-200 – 299 | Events & background                              | `05-events-and-background-processing.md`                                 |
| ARCH-300 – 399 | Auth & security                                  | `07-authentication-and-security.md`                                      |
| ARCH-400 – 499 | Runtime & operations                             | `08-runtime-and-operations.md`                                           |
| ARCH-500 – 599 | Testing & quality                                | `10-testing-and-quality.md`                                              |
| ARCH-600 – 699 | Dependencies & coupling                          | `09-dependencies-and-coupling.md`                                        |
| ARCH-700 – 799 | Architectural readiness                          | `11-architectural-readiness.md`                                          |
| ARCH-800 – 899 | Project overview / tech stack                    | `01-project-overview.md`                                                 |
| ARCH-900 – 999 | Post-merge delta (upstream sync)                 | `ARCHITECTURE_CONTEXT.md` §O                                             |

---

## How to read an entry

```text
Finding ID:        ARCH-NNN
Claim:             what the report asserts
Status:            VERIFIED | INFERRED | UNVERIFIED | UNKNOWN
Evidence:          file:line   file:line   file:line
Implication:       why it matters
Related findings:  cross-refs
Counter-evidence:  (only present where the claim was challenged)
```

A few of the most important entries are shown explicitly below; the 250+ findings are browsed in the per-section reports themselves (each carries its own evidence index). This register indexes the high-importance findings and shared claims; no separate full dump file exists in this directory.

---

## High-importance findings (cross-report)

### AI architecture (`02-ai-architecture.md`)

```text
Finding ID:    ARCH-001
Claim:         AI runtime centralizes provider adapter construction; provider keys/settings
               live outside features and capabilities.
Status:        VERIFIED
Evidence:      apps/web/src/server/ai-runtime.ts:71-147 (buildModel provider adapters,
               mapAiRuntimeError)
               apps/web/src/server/settings.ts:61-115 (per-provider env > encrypted)
Implication:   Provider transport is one boundary; key handling is one boundary.
Related:       ARCH-002, ARCH-301, ARCH-303
```

```text
Finding ID:    ARCH-002
Claim:         OpenAI requests set store:false; Anthropic has no equivalent provider option.
Status:        VERIFIED
Evidence:      apps/web/src/server/ai-runtime.ts:181, 232, 292, 331
Implication:   Provider-side response retention is off for OpenAI; Anthropic uses its own defaults.
```

```text
Finding ID:    ARCH-004
Claim:         Tool inputs validated by jsonSchema + a manual hasOnlyKeys predicate that
               rejects any field outside the allowlist.
Status:        VERIFIED
Evidence:      apps/web/src/server/ai.ts:40-73 (hasOnlyKeys predicate and the
               isSummaryInput / isFindTradesInput / isTradeDetailInput /
               isSwitchReportModeInput validators)
Implication:   Provider-bypassing fields cannot be smuggled into a tool call.
Related:       ARCH-005
```

```text
Finding ID:    ARCH-005
Claim:         Tools call shared domain functions (queryTrades, listExecutions, getTradeByKey,
               reportContext); no AI-only data path.
Status:        VERIFIED
Evidence:      apps/web/src/server/ai.ts:93-242 (createAskJournalTools; three common tools
               plus the Reports-only fourth); reports at 03-domain-model.md
Implication:   Domain logic is not duplicated for AI.
Related:       ARCH-006, ARCH-007, ARCH-008, ARCH-009
```

```text
Finding ID:    ARCH-006
Claim:         playbookRulesForTrade exists in ai-capabilities.ts but is NOT exposed as an AI tool.
Status:        VERIFIED (gap)
Evidence:      apps/web/src/server/ai-capabilities.ts:179-207 (definition)
               (no occurrence of playbookRulesForTrade in createAskJournalTools)
Implication:   The model cannot answer "which playbook rules did I break on this trade?".
```

```text
Finding ID:    ARCH-007
Claim:         missedObservations exists in ai-capabilities.ts but is NOT exposed as an AI tool.
Status:        VERIFIED (gap)
Evidence:      apps/web/src/server/ai-capabilities.ts:211-244
Implication:   The model cannot answer "what missed opportunities did I archive?".
```

```text
Finding ID:    ARCH-008
Claim:         notebookEntries exists in ai-capabilities.ts but is NOT exposed as an AI tool.
Status:        VERIFIED (gap)
Evidence:      apps/web/src/server/ai-capabilities.ts:247-275
Implication:   The model cannot read the notebook.
```

```text
Finding ID:    ARCH-009
Claim:         progressHistory exists in ai-capabilities.ts but is NOT exposed as an AI tool.
Status:        VERIFIED (gap)
Evidence:      apps/web/src/server/ai-capabilities.ts:277-329
Implication:   The model cannot summarize routine adherence trends.
```

```text
Finding ID:    ARCH-010
Claim:         No chat persistence: every AI request is stateless.
Status:        VERIFIED (negative)
Evidence:      grep across apps/web/src/db shows no conversations/messages/chat_history tables
Implication:   No cross-session memory. Reframe any "ask the journal tomorrow" idea.
```

```text
Finding ID:    ARCH-011
Claim:         No streaming: streamText is not used.
Status:        VERIFIED (negative)
Evidence:      grep across apps/web/src/server returns no streamText / ReadableStream
Implication:   UX is "wait then render"; ~30s ceiling for Ask/Reports.
```

```text
Finding ID:    ARCH-012
Claim:         @ai-sdk/mcp is used only by the CTrader broker sync client, not by AI tooling.
Status:        VERIFIED
Evidence:      apps/web/src/server/ctrader-mcp/client.ts:2 (only MCP import)
Implication:   MCP is not the AI tool transport. Vercel AI SDK built-in tool() is.
```

```text
Finding ID:    ARCH-013
Claim:         AI execution metadata (AiExecutionMeta) is built per call and discarded.
Status:        VERIFIED
Evidence:      apps/web/src/server/ai-runtime.ts:149-167 (buildMeta), not persisted
Implication:   No AI usage history across calls.
```

```text
Finding ID:    ARCH-014
Claim:         The existing migration plan (.superpowers/plans/2026-10-08-ai-agent-architecture-migration.md)
               is dated 2026-10-08 and pre-dates the as-built implementation; the current code
               already has bounded agents; the plan's Phase 2 unregistered capabilities remain
               unregistered.
Status:        INFERRED
Evidence:      plan file vs. ai-runtime.ts:1-340, ai.ts:93-242
Implication:   Do not treat the plan as the current state; treat it as one option frozen in time.
```

### Auth (`07-authentication-and-security.md`)

```text
Finding ID:    ARCH-301
Claim:         Apps are single-tenant; no userId columns anywhere in the schema.
Status:        VERIFIED
Evidence:      grep across apps/web/src/db/schema.ts
Implication:   Multi-user is a redesign, not a configuration change.
Related:       ARCH-302
```

```text
Finding ID:    ARCH-302
Claim:         Optional password gate via JOURNAL_PASSWORD adds HMAC-SHA256 cookie.
               Middleware checks cookie presence only; verifySession in handler does the HMAC.
Status:        VERIFIED
Evidence:      apps/web/src/middleware.ts; apps/web/src/server/auth.ts:23-29
               apps/web/src/server/api.ts:20-39 (handler wrapper)
Implication:   Pure-Edge presence check + Node cryptographic verify is a deliberate split.
```

```text
Finding ID:    ARCH-303
Claim:         No server-side session expiry: the cookie's HMAC remains valid until
               JOURNAL_PASSWORD changes.
Status:        VERIFIED (negative)
Evidence:      apps/web/src/server/auth.ts:23-29 (HMAC only, no expiry check)
               apps/web/src/app/api/auth/route.ts:12-18 (30-day maxAge, browser-side)
Implication:   Captured cookies are valid indefinitely. Hardening should add server-side
               expiry and possibly rotation on password change.
```

```text
Finding ID:    ARCH-304
Claim:         AI keys encrypted at rest with AES-256-GCM; key derived via scryptSync.
Status:        VERIFIED
Evidence:      apps/web/src/server/crypto.ts:24-34
Implication:   Encryption is one boundary.
```

### Runtime (`08-runtime-and-operations.md`)

```text
Finding ID:    ARCH-401
Claim:         Docker image is node:22-slim standalone output, non-root node user.
Status:        VERIFIED
Evidence:      Dockerfile:2, 13, 25
Implication:   Self-hosted / single-container.
```

```text
Finding ID:    ARCH-402
Claim:         JOURNAL_DATA_DIR default is /data/trade-journal — a POSIX path. In Docker
               the data volume maps ./data to /data, so the app looks for /data/trade-journal
               which resolves on Windows hosts to C:\data\trade-journal.
Status:        VERIFIED (defect)
Evidence:      apps/web/src/db/index.ts:8
Implication:   Windows-local development with the default setting will fail unless
               JOURNAL_DATA_DIR is set explicitly.
```

```text
Finding ID:    ARCH-403
Claim:         NEXT_TELEMETRY_DISABLED=1 is NOT in the Dockerfile despite AGENTS.md:260 claim.
Status:        VERIFIED (negative)
Evidence:      Dockerfile (no such ENV); README.md documents user opt-in instead
Implication:   Repo invariant violated. Documentation drift, not a security bug.
```

```text
Finding ID:    ARCH-404
Claim:         AI is governed by per-feature policy table; reflection/ask/report = 1,200
               tokens × 2 retries × 30 s; statementImport = 32k × 0 × 120 s.
Status:        VERIFIED
Evidence:      apps/web/src/server/ai-contracts.ts:36-51
Implication:   Per-call cost/timeout is bounded. Cross-call budget is not.
```

```text
Finding ID:    ARCH-405
Claim:         Tauri desktop spawns `node apps/web/server.js` with PORT=0 to get an ephemeral
               port, but parseInt("0", 10) || 3000 falls back to 3000.
Status:        VERIFIED (defect)
Evidence:      desktop/src-tauri/src/server.rs:56-63 (sidecar spawn with .env("PORT", "0");
               no "3000" literal in this file)
               desktop/src-tauri/target/debug/apps/web/server.js:13 (generated standalone
               server: parseInt(process.env.PORT, 10) || 3000)
Implication:   Real port-collision risk; needs explicit env or code change.
```

### Coupling (`09-dependencies-and-coupling.md`)

```text
Finding ID:    ARCH-601
Claim:         All three monorepo boundary rules (.omp/AGENTS.md §Dependency direction) hold:
               packages/core has zero imports of apps/web or packages/importers;
               packages/importers has zero imports of apps/web and zero raw fetch/axios;
               apps/web is the only importer of @luxalgo/broker-sdk.
Status:        VERIFIED (via grep)
Evidence:      grep output reproduced in 09 §9.1
Implication:   Boundary rules are real and enforced.
```

```text
Finding ID:    ARCH-602
Claim:         AI layering is a 6-layer stack: Prompts → Capabilities → Scope → Runtime → Tools → Routes.
               Capability functions (4) and tool factory (4 active + 1 conditional) are distinct
               layers; capability functions exist that are NOT yet wired as tools.
Status:        VERIFIED
Evidence:      09-dependencies-and-coupling.md §9.3; 02-ai-architecture.md §6
Implication:   Wiring dormant capabilities is incremental, not architectural.
```

```text
Finding ID:    ARCH-603
Claim:         get_trade_detail uses queryTrades().trades.find() while the per-trade route uses
               getTradeByKey(). Behaviour difference is INFERRED.
Status:        INFERRED
Evidence:      apps/web/src/server/ai.ts:180 vs apps/web/src/app/api/trades/[key]/route.ts:14
Implication:   If the two code paths drift (e.g., annotate differently) the agent and the
               trade page could disagree.
```

```text
Finding ID:    ARCH-604
Claim:         Trade-key format is the architectural contract; protect-trade-key hook in .omp/hooks/pre/
               gates any change.
Status:        VERIFIED
Evidence:      packages/core/src/round-trips.ts:95-99; .omp/hooks/pre/protect-trade-key.ts
Implication:   Renaming the trade-key format requires an ADR + migration.
```

```text
Finding ID:    ARCH-605
Claim:         No circular imports in apps/web/src/server/.
Status:        VERIFIED (negative)
Evidence:      DFS over 25 server files in 09 §9.8
Implication:   Dependency graph is a DAG.
```

```text
Finding ID:    ARCH-618
Claim:         Tauri PORT=0 defect (see ARCH-405).
Status:        VERIFIED
Evidence:      desktop/src-tauri/src/server.rs:60-72
Implication:   Same defect as ARCH-405; canonical listing in both reports.
```

### Readiness (`11-architectural-readiness.md`)

```text
Finding ID:    ARCH-701
Claim:         AI outside chat: Partially supported (all AI is synchronous HTTP-triggered;
               no background AI path).
Status:        VERIFIED
Evidence:      11-architectural-readiness.md §1
Implication:   A non-chat AI consumer pattern must be designed.
```

```text
Finding ID:    ARCH-704
Claim:         Event publishing: Not currently supported (no EventEmitter, no queue).
Status:        VERIFIED (negative)
Evidence:      05-events-and-background-processing.md (all "no infrastructure" greps)
Implication:   Any event-driven design is build-from-scratch.
```

```text
Finding ID:    ARCH-705
Claim:         Background processing: Not currently supported.
Status:        VERIFIED (negative)
Evidence:      08-runtime-and-operations.md (no workers / cron / scheduler)
Implication:   Adds infra dependency.
```

```text
Finding ID:    ARCH-712
Claim:         Strategy rule evaluation: Partially supported (manual UI + read-only
               analyzeAdherence; auto-evaluation on save is not wired).
Status:        VERIFIED
Evidence:      apps/web/src/app/api/trades/[key]/rules/route.ts (manual write);
               packages/core/src/adherence.ts (read-only)
Implication:   Auto-evaluation needs a hook into save path.
```

```text
Finding ID:    ARCH-713
Claim:         Cross-domain intelligence: Partially supported (capability functions exist
               but are not exposed as tools).
Status:        VERIFIED
Evidence:      apps/web/src/server/ai-capabilities.ts (7 exported capabilities);
               apps/web/src/server/ai.ts (3 common tools + the Reports-only fourth)
Implication:   Wiring is incremental; capabilities already data-source gated.
```

### Project overview (`01-project-overview.md`)

```text
Finding ID:    ARCH-800
Claim:         Workspace lists packages/*, apps/*, desktop.
Status:        VERIFIED
Evidence:      pnpm-workspace.yaml
Implication:   Three monorepo roots.
```

```text
Finding ID:    ARCH-801
Claim:         Node 22 minimum via engines.
Status:        VERIFIED
Evidence:      package.json:11
Implication:   Anyone below Node 22 cannot run dev/build.
```

```text
Finding ID:    ARCH-816
Claim:         Next.js transpiles the two workspace packages via transpilePackages.
Status:        VERIFIED
Evidence:      apps/web/next.config.ts
Implication:   No separate build step needed in dev.
```

```text
Finding ID:    ARCH-829
Claim:         NEXT_TELEMETRY_DISABLED=1 is NOT in the Dockerfile (AGENTS.md is wrong).
Status:        VERIFIED
Evidence:      Dockerfile (grep)
Implication:   Same defect as ARCH-403; canonical listing in both reports.
```

---

## Full evidence register (per-section)

The full per-finding detail and source citations are in each report's own "Evidence" / "Evidence Register" sections:

| Range        | Where                                                            |
| ------------ | ---------------------------------------------------------------- |
| ARCH-001-099 | `02-ai-architecture.md` §11 (Evidence Index); inline per section |
| ARCH-100-199 | `06-frontend-architecture.md`                                    |
| ARCH-200-299 | `05-events-and-background-processing.md`                         |
| ARCH-300-399 | `07-authentication-and-security.md`                              |
| ARCH-400-499 | `08-runtime-and-operations.md`                                   |
| ARCH-500-599 | `10-testing-and-quality.md`                                      |
| ARCH-600-699 | `09-dependencies-and-coupling.md`                                |
| ARCH-700-799 | `11-architectural-readiness.md`                                  |
| ARCH-800-899 | `01-project-overview.md`                                         |

No combined dump file exists; the ≈250 findings live in the per-section registers listed above.

---

## Post-merge findings (October 21 2026)

```text
Finding ID:    ARCH-901
Claim:         A working second broker-connect path exists outside @luxalgo/broker-sdk:
               cTrader MCP sync. The journal already supports dual broker-connect
               architectures.
Status:        VERIFIED
Evidence:      apps/web/src/server/ctrader-mcp/{sync,client,…}.ts (10 files)
               apps/web/src/app/api/accounts/ctrader-mcp-preview/route.ts
               apps/web/src/app/api/accounts/route.ts:74-110
Implication:   A generalised broker-connect orchestrator is feasible — the shared
               shape is SyncOutcome ∪ accounts.snapshotJson.
```

```text
Finding ID:    ARCH-902
Claim:         The cTrader MCP account type is broker-defined and exposed as a
               free-form string (accountType: z.string()). Most brokers return
               "HEDGE" or "NET". The journal does not narrow this to a closed enum.
Status:        VERIFIED
Evidence:      apps/web/src/server/ctrader-mcp/schemas.ts:6-16 (accountType: z.string())
               apps/web/src/app/import/page.tsx:1222-1224 (UI does not display accountType)
Implication:   Future hedging-vs-netting reasoning needs a schema upgrade.
```

```text
Finding ID:    ARCH-903
Claim:         CTrader sync uses two credentials fields: endpoint (http(s) URL,
               validated regex) and optional authHeader. Bearer-token support
               exists in the client but is no longer surfaced in the public API.
Status:        VERIFIED
Evidence:      apps/web/src/server/ctrader-mcp/client.ts:7-13 (mode: remote|local,
               bearerToken?, authHeader?)
               apps/web/src/app/api/accounts/route.ts:79-87 (route validates endpoint
               only; no bearerToken)
               apps/web/src/app/api/accounts/ctrader-mcp-preview/route.ts:6-10 (body
               accepts endpoint + authHeader only)
Implication:   The merge dropped a `mode: "remote"|"local"` plan field; current
               implementation is local-only.
Related:       ARCH-901
```

```text
Finding ID:    ARCH-904
Claim:         XTB is now a first-class broker. The new code path includes an
               XLSX reader (packages/importers/src/xlsx.ts) and a 351-line
               format adapter (formats/xtb.ts), plus 373-line parser tests
               (13 it() cases) and 174- + 122-line app tests.
Status:        VERIFIED
Evidence:      packages/importers/src/formats/xtb.ts (351 lines)
               packages/importers/src/xlsx.ts (289 lines)
               packages/importers/tests/xtb.test.ts (373 lines)
               packages/importers/tests/xtb-fixture.ts (361 lines)
               apps/web/tests/xtb-import.test.ts (174 lines)
               apps/web/tests/xtb-import-ui.test.ts (122 lines)
Implication:   XLSX reading is now built into the importers, with no new package
               dependency: packages/importers/src/xlsx.ts reads ZIP entries and
               worksheet XML itself (inflating via DecompressionStream("deflate-raw")
               at :132) and packages/importers/package.json declares only
               @luxalgo/journal-core.
Related:       ARCH-905
```

```text
Finding ID:    ARCH-905
Claim:         The IBKR Flex import path now has two flavours: the original
               CSV (ibkr-sync-timezone) and a new XML parser.
Status:        VERIFIED
Evidence:      apps/web/src/server/ibkr-flex-xml-import.ts (132 lines)
               apps/web/tests/ibkr-flex-xml-import.test.ts (268 lines)
Implication:   A future broker-connect UI must select between CSV and XML.
Related:       ARCH-904
```

```text
Finding ID:    ARCH-906
Claim:         A new import_batches table records import operations by
               (accountId, format, fingerprint) with a unique index. It is NOT a
               universal event ledger for every import type: only the NinjaTrader
               import writes it.
Status:        VERIFIED
Evidence:      apps/web/src/db/schema.ts:38 (importBatches table)
               apps/web/src/db/bootstrap.ts:194-200 (import_batches DDL)
               apps/web/src/server/ninjatrader-import.ts:105,538 (the only writer)
Implication:   The schema catalog in 04-data-architecture.md is now incomplete.
               (This entry documents the new entity for future re-validation.) Do
               not use its fingerprint as ingestion idempotency for other brokers.
```

```text
Finding ID:    ARCH-907
Claim:         Trade ROI is a new endpoint + UI surface, added in this merge.
Status:        VERIFIED
Evidence:      apps/web/src/app/api/trades/route.ts (modified)
               apps/web/tests/trade-roi-api.test.ts (87 lines)
               apps/web/tests/trade-roi-ui.test.ts (88 lines)
Implication:   The AI/dashboard reports do not mention ROI; it is a small surface
               but worth surfacing in any dashboard-surface reconciliation.
```

```text
Finding ID:    ARCH-908
Claim:         The replay chart was rewritten and now has 157 dedicated tests.
Status:        VERIFIED (negative about prior code)
Evidence:      apps/web/tests/replay-chart.test.ts
Implication:   The 08-runtime-and-operations.md replay section is now stale.
```

```text
Finding ID:    ARCH-909
Claim:         The CTrader MCP module is the only consumer of @ai-sdk/mcp and
               uses it as an HTTP transport for the upstream MCP server. The
               AI agent path continues to use Vercel AI SDK's built-in tool().
Status:        VERIFIED (corroborates ARCH-012)
Evidence:      apps/web/src/server/ctrader-mcp/client.ts:2
               (no other @ai-sdk/mcp imports anywhere)
Related:       ARCH-012
```

```text
Finding ID:    ARCH-910
Claim:         The .omp boundary rule for raw fetch is explicitly carved out
               for the cTrader MCP subsystem.
Status:        VERIFIED
Evidence:      apps/web/tests/ctrader-mcp/boundary.test.ts:67-69
Implication:   09-dependencies-and-coupling.md should list this carve-out under
               boundary exceptions.
```

```text
Finding ID:    ARCH-911
Claim:         AI_PROVIDERS widened from ["anthropic","openai"] to
               ["anthropic","openai","compatible"]. AiProvider union has 3
               members; future-proofing must anticipate N+ providers.
Status:        VERIFIED
Evidence:      apps/web/src/lib/ai-settings.ts:1-2
Implication:   02-ai-architecture.md §2.1 needs revision; any consumer that
               assumed a 2-member union needs an audit.
Related:       ARCH-002 (OpenAI store:false), ARCH-913 (URL change clears key)
```

```text
Finding ID:    ARCH-912
Claim:         "AI server unreachable" is emitted specifically when provider is
               compatible AND the cause has no statusCode. Distinguishes
               "server down or wrong URL" from "5xx from a hosted provider".
Status:        VERIFIED
Evidence:      apps/web/src/server/ai-runtime.ts:130-139
               apps/web/src/lib/ai-feedback.ts:74-83 (regex match for /AI server unreachable/i)
Implication:   Ask / Reports / Recap / Critique / Import can never mistake a
               network failure for an auth, billing, or rate-limit failure.
```

```text
Finding ID:    ARCH-913
Claim:         Changing the compatible base URL clears the saved compatible key.
               A key is bound to one server; the saved encrypted key is wiped on
               URL change unless the call site passes keepKey=true (key replacement).
Status:        VERIFIED
Evidence:      apps/web/src/server/settings.ts:98-103
               apps/web/tests/ai-settings.test.ts:226-243
Implication:   Reduces the risk of a key bound to server A being sent to server B.
```

```text
Finding ID:    ARCH-914
Claim:         AI statement import is hosted-only. Compatible servers are
               explicitly excluded; when the selected provider is compatible
               and a hosted provider has a key, that hosted provider is used
               instead, otherwise the request fails with "Choose OpenAI or
               Anthropic."
Status:        VERIFIED
Evidence:      apps/web/src/server/settings.ts:162-178
               apps/web/src/server/ai-import.ts:174-178 (parseStatementWithAi reject)
               apps/web/tests/ai-import.test.ts:160-165
Implication:   Safety boundary: a third-party compatible server cannot be used
               for the import path (PDF input + strict structured output).
```

```text
Finding ID:    ARCH-915
Claim:         Compatible AI has no environment variable override. AI_KEY_VARIABLES
               only lists ANTHROPIC_API_KEY and OPENAI_API_KEY.
Status:        VERIFIED
Evidence:      apps/web/src/lib/ai-settings.ts:17-20
Implication:   Aligns with the threat model — env keys are for shared operational
               credentials; a compatible key is server-specific and lives only
               in the encrypted settings store.
```

```text
Finding ID:    ARCH-916
Claim:         Provider adapter construction is now a single buildModel()
               helper, called from all four run* functions (TextAi, AskAgentAi,
               ReportsAgentAi, ObjectAi).
Status:        VERIFIED (corroborates ARCH-001)
Evidence:      apps/web/src/server/ai-runtime.ts:71-83
Implication:   Provider-bound code outside ai-runtime.ts is impossible. Future
               providers add a single arm to buildModel().
Related:       ARCH-001
```

```text
Finding ID:    ARCH-917
Claim:         The "store: false" provider option is set ONLY when
               provider === "openai" (hosted). Compatible servers do NOT
               receive it.
Status:        VERIFIED (narrows ARCH-002)
Evidence:      apps/web/src/server/ai-runtime.ts:181, 232, 292, 331
               (ternary: provider === "openai" ? { openai: { store: false } } : {})
Implication:   Any future guard that needs to extend "store: false" must check
               whether the compatible adapter would honour it; today the journal
               assumes it does not.
Related:       ARCH-002
```

```text
Finding ID:    ARCH-918
Claim:         New SDK package @ai-sdk/openai-compatible@3.0.46 added to
               dependencies; the only consumer is buildModel().
Status:        VERIFIED
Evidence:      apps/web/package.json:16
               apps/web/src/server/ai-runtime.ts:3 (single import of @ai-sdk/openai-compatible)
Implication:   One new outbound provider-shape dependency; pnpm allowBuilds rules
               and license check (scripts/check-licenses.mjs) must cover it.
```

```text
Finding ID:    ARCH-919
Claim:         aiModelSetting(provider) uses "aiModel" only for Anthropic
               (legacy key) and `${provider}Model` for every other provider.
               For compatible, the setting key is "compatibleModel".
Status:        VERIFIED
Evidence:      apps/web/src/server/settings.ts:115-117
Implication:   Existing saved model choices for Anthropic and OpenAI survive the
               migration; new entries for compatible land in `compatibleModel`.
```

```text
Finding ID:    ARCH-920
Claim:         AiImportProvider = Exclude<AiProvider, "compatible"> narrows the
               import-level union; statement import can never type-accept a
               compatible provider at the boundary.
Status:        VERIFIED
Evidence:      apps/web/src/lib/ai-import.ts:11-13
Implication:   A future effort to add compatible for imports would have to
               change the type — the boundary is intentionally closed today.
Related:       ARCH-914
```

---

## Counter-evidence register (claims that were challenged in review)

| Finding                | Original claim                                                                        | Counter-evidence                                                                                                                                                        | Outcome                                                          |
| ---------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ARCH-076 (early draft) | `trade_rule_checks` rows are written only by the AI/adherence pass with no manual UI. | `apps/web/src/app/api/trades/[key]/rules/route.ts` (POST handler) + `components/rule-checklist.tsx` (UI) exist as a manual write path; `analyzeAdherence` is read-only. | Renumbered/replaced. See `03-domain-model.md` §5.5/§5.7.         |
| ARCH-106 (early draft) | `trade_rule_checks` has CASCADE FK to `trades`.                                       | Schema shows no FK; only `trade_excursions` has the CASCADE FK to `trades`.                                                                                             | Removed from later editions. See `04-data-architecture.md` §6.5. |
| ARCH-113 (early draft) | `settings` table is NOT in BOOTSTRAP_SQL.                                             | `BOOTSTRAP_SQL` at `bootstrap.ts:132-135` does include it.                                                                                                              | Renumbered. See `04-data-architecture.md` §6.2.                  |
| ARCH-077 (early draft) | Index `trade_rule_checks_trade` defined in Drizzle.                                   | Defined in `bootstrap.ts` only, not in Drizzle schema.                                                                                                                  | Removed from `04`.                                               |
| Reader-cited           | `~24 API routes`                                                                      | 43 `route.ts` files actually present.                                                                                                                                   | Updated. See `01-project-overview.md` §4.                        |
| Reader-cited           | Sidecar Node 22.11.0                                                                  | `desktop/README.md` says 24.11.0; `AGENTS.md` says 22.11.0; `tauri.conf.json` pins neither.                                                                             | Reported as drift. See `01-project-overview.md` ARCH-818.        |
| Reader-cited           | `isStepCount(maxSteps)` matches `steps.length === maxSteps`                           | `stopWhen: isStepCount(maxSteps)` returns `true` only when `steps.length >= maxSteps`.                                                                                  | Verified precise.                                                |

The full review artifacts (`REVIEW-*.md`) are also part of the package; they preserve the provenance of every counter-claim.
