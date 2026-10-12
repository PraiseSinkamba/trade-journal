---
status: in-progress
phase: 2
updated: 2026-10-10
---

# AI Capability Extraction Discovery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` for this bounded discovery task before writing the Phase 2 implementation plan.

**Goal:** Produce evidence required to extract read-only, scope-bound AI journal capabilities without changing AI behavior or widening journal access.

**Architecture:** The completed execution foundation remains the only provider boundary. This discovery task traces the existing route-owned journal queries and prompt data preparation to define a minimal capability interface backed by existing services. It does not create tools, agents, a new route, or a capability implementation.

**Tech Stack:** Next.js App Router, TypeScript, SQLite/Drizzle, `@luxalgo/journal-core`, Vitest.

## Global Constraints

- The completed AI execution foundation is already present in `apps/web/src/server/ai-runtime.ts`, `ai-contracts.ts`, and `ai-prompts.ts`; do not modify it.
- Preserve validated account/filter/date/timezone scope from `readAiRequest`; missing or invalid input must never widen scope.
- Recap and critique remain direct calls. AI import remains a schema-bound preview/review/commit workflow.
- Do not add an agent loop, tool calling, raw database capability, provider configuration, persistence side effect, dependency, telemetry endpoint, or external analytics.
- Do not change API response contracts, prompt text, user-visible behavior, or existing tests during discovery.
- Do not write, stage, amend, or delete unrelated user changes.

---

### Task 1: Establish the Phase 2 capability contract from current behavior

**Files:**
- Create: `docs/superpowers/research/2026-10-10-ai-capability-extraction.md`
- Test: no new tests; discovery validates against existing source and focused test evidence only.

**Interfaces:**
- Consumes: `readAiRequest`, `accountContext`, `queryTrades`, `getTradeByKey`, `listExecutions`, the current Ask/recap/critique routes, and AI scope/UI tests.
- Produces: an evidence-cited discovery record that a follow-up implementation plan can use to define exact capability inputs, outputs, ownership, bounds, and route cutovers.

- [ ] **Step 1: Trace the current read-only data paths**

Use language-server references for exported symbols that Phase 2 would move or expose. Record each current flow:

```text
validated request → approved scope → query/service → metrics/context transformation → prompt builder
```

Cover Ask Journal, daily recap, and single-trade critique. Identify the exact data each route reads, every existing scope validation point, and every persistence side effect that must stay outside capabilities.

- [ ] **Step 2: Establish the immutable approved-scope boundary**

Specify the smallest type/value that capabilities can accept. It must be created only after `readAiRequest` validation and contain, at minimum, validated filters, selected accounts, timezone, display scope/context, and any request-specific date or key constraint. State whether the current return value needs a cloned/frozen snapshot, with evidence from its fields and callers.

- [ ] **Step 3: Define the minimum capability set and data bounds**

For each current feature, propose only the extracted read-only operation(s) needed to reproduce its current context:

```text
capability name → accepted approved scope → data read → typed output → maximum/result bound → current route consumer
```

Do not propose raw SQL, generic query language input, write capability, provider access, settings access, or model-selected scope changes. Where current behavior has no explicit safe size bound, state the exact existing constraint and identify the smallest compatibility-preserving bound decision needed before implementation.

- [ ] **Step 4: Define parity and adversarial tests**

Name the existing tests that protect each contract and specify additional deterministic capability tests required for Phase 2. Include malformed scope, selected-account isolation, empty result handling, timezone behavior, recap-note exclusion, and critique key scope. Tests must exercise capability behavior rather than merely verifying forwarding calls.

- [ ] **Step 5: Record migration order and Phase 3 gate**

State the smallest route cutover order that keeps the application usable after each task. State precisely what evidence would justify a later Ask Journal tool/agent loop, and state that its absence means Ask remains a direct call.

- [ ] **Step 6: Verify and commit discovery record**

Run:

```bash
pnpm test apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-runtime.test.ts
pnpm exec prettier --check docs/superpowers/research/2026-10-10-ai-capability-extraction.md
```

Expected: the focused suites pass and the new Markdown document is formatted. Commit only the new discovery record and this plan, using a reviewer-readable subject that explains the migration decision it preserves.
