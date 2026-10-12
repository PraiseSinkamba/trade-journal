---
status: in-progress
phase: 4
updated: 2026-10-11
---

# Phase 4 Capability Gap Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` for this typed, read-only capability extension. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose typed, scope-bound, read-only readers for the data surfaces that the discovery report flagged as missing (Gaps 1–4: playbook rules per trade, missed-trade observations, notebook entries, progress check history). Trade detail, Missed trades, Notebook, and Playbooks agents cannot start until these capabilities exist.

**Architecture:** Add one new module per data source. Each module exposes a single typed async function that accepts the route-created `FrozenApprovedScope` (extended per source) and returns a bounded text summary suitable for AI tool results. No raw SQL. No write access. No settings, broker, or provider surface.

**Tech Stack:** Next.js App Router, TypeScript, SQLite/Drizzle, `@luxalgo/journal-core`, Vitest.

## Global Constraints

- The existing `FrozenApprovedScope` may be **extended** with a `dataSource` selector; it must remain deeply frozen and may not widen the existing account/date/filter/timezone.
- A new capability must fail closed when scope validation is incomplete: empty result, missing key, malformed input → typed error object, no raw 5xx.
- Output text must be bounded (≤6 KB) and redaction-safe (no API keys, no third-party credentials, no broker identifiers beyond account names).
- Tests must exercise behavior, not forwarding. Account isolation, empty scope, malformed scope, out-of-scope key, and frozen-scope immutability are mandatory.
- No new dependency, no telemetry, no UI changes, no agent migration in this phase.
- The new capabilities are private server modules; the public API surface for tools is the Ask Journal agent's tool set, designed separately.

---

### Task 1: Extend `FrozenApprovedScope` to carry a `dataSource` field

**Files:**

- Modify: `apps/web/src/server/ai-scope.ts`
- Modify: `apps/web/tests/ai-scope.test.ts`

**Interfaces:**

- Add `dataSource: "trades" | "trades+playbooks" | "trades+missed" | "trades+notes" | "trades+progress"` to the frozen scope.
- Add `tradeCritiqueKey?: string` to the frozen scope; only valid when `dataSource` includes `playbooks`.
- Existing routes keep `dataSource: "trades"` (default).

- [ ] **Step 1: Write failing tests** proving the new fields survive deep-freeze and that unknown `dataSource` values are rejected.
- [ ] **Step 2: Implement the extension** in `readAiRequest` only when an explicit field is supplied; default to `"trades"`.
- [ ] **Step 3: Re-run `ai-scope`, `ai-capability`, and `ai-ask-agent` suites.**

### Task 2: Implement `playbookRulesForTrade(scope, key)`

**Files:**

- Create: `apps/web/src/server/ai-capabilities.ts` (add function)
- Test: extend `apps/web/tests/ai-capability.test.ts`

**Interfaces:**

- `playbookRulesForTrade(scope: FrozenApprovedScope, key: string): Promise<{ context: string } | { error: string }>`.
- Validates the trade key inside the same scoped `queryTrades` before reading `db.rules`.
- Returns ≤6 KB summary of playbook name, rule description, pass/fail status per rule.

- [ ] **Step 1: Write failing tests** for unknown trade, out-of-scope trade, scope without `playbooks`, and bounded output.
- [ ] **Step 2: Implement** using existing `db.playbooks`/`db.rules` and `RuleChecklist` data; no raw SQL.
- [ ] **Step 3: Re-run the focused capability suite.**

### Task 3: Implement `missedObservations(scope, since, until?)`

**Files:**

- Create: `apps/web/src/server/ai-capabilities.ts` (add function)
- Test: extend `apps/web/tests/ai-capability.test.ts`

**Interfaces:**

- `missedObservations(scope: FrozenApprovedScope, since: string, until?: string): Promise<{ context: string } | { error: string }>`.
- Reads `db.missed` filtered by the same account list and the given date range (read-only).
- Returns ≤6 KB summary of archived/restore status, free-text observations, and any playbook tag.

- [ ] **Step 1: Write failing tests** for empty range, malformed date, account isolation, and output bound.
- [ ] **Step 2: Implement** using existing `GET /api/workspace/missed` query path; do not duplicate SQL.
- [ ] **Step 3: Re-run the focused capability suite.**

### Task 4: Implement `notebookEntries(scope, folderId?, q?)`

**Files:**

- Create: `apps/web/src/server/ai-capabilities.ts` (add function)
- Test: extend `apps/web/tests/ai-capability.test.ts`

**Interfaces:**

- `notebookEntries(scope: FrozenApprovedScope, folderId?: string, q?: string): Promise<{ context: string } | { error: string }>`.
- Reads `db.notes` filtered by the same account list, optional folder, and optional full-text search.
- Returns ≤6 KB summary; respects `PrivacyMode` flag in the request to redact content.

- [ ] **Step 1: Write failing tests** for empty folder, malformed query, account isolation, privacy-redaction, and output bound.
- [ ] **Step 2: Implement** using existing `/api/notes` query path; do not duplicate SQL.
- [ ] **Step 3: Re-run the focused capability suite.**

### Task 5: Implement `progressHistory(scope, weeks?)`

**Files:**

- Create: `apps/web/src/server/ai-capabilities.ts` (add function)
- Test: extend `apps/web/tests/ai-capability.test.ts`

**Interfaces:**

- `progressHistory(scope: FrozenApprovedScope, weeks?: number): Promise<{ context: string } | { error: string }>`.
- Reads `db.progressChecks` for the last `weeks` (default 13).
- Returns ≤6 KB summary of routine stage hit rates, daily completion percentages.

- [ ] **Step 1: Write failing tests** for invalid weeks, account isolation, and output bound.
- [ ] **Step 2: Implement** using existing `progressScore`/`scheduledRules` pure functions and the workspace progress query.
- [ ] **Step 3: Re-run the focused capability suite.**

### Task 6: Documentation and commit

- [ ] **Step 1: Update `docs/ai-scope.md` with the new capabilities and the `dataSource` field**
- [ ] **Step 2: Run `pnpm exec vitest run` and the relevant Prettier + typecheck commands**
- [ ] **Step 3: Commit only the task files**
