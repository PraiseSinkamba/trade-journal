# AI Capability Extraction — Phase 2 Discovery Record

**Date:** 2026-10-10
**Task:** 1 — Establish the Phase 2 capability contract from current behavior
**Status:** Complete

---

## Step 1 — Current Read-Only Data Paths

Every AI feature funnels through one of two patterns.

### Pattern A — `readAiRequest` + `queryTrades` + `runAi`

#### Ask Journal (`POST /api/ai/ask`)

```
request.json() → readAiRequest(…, "question")
               → queryTrades(filters)           [only reads trades matching filters]
               → computeMetrics(trades, {tz})
               → bySymbol / byWeekday / byHour / byDuration / byTag / byMistake / byPlaybook
               → accountContext(trades, scope)  [per-account P&L in each account's currency]
               → buildAskJournalPrompt({question, context})
               → runAi(prompt)
               → ok({answer, scope: {label, timeZone}})
```

Validation gate: `readAiRequest` rejects unknown fields, unrecognised accounts, invalid date ranges, invalid `weekdays` values, and mismatched timezones — returning a **validated but still-mutable** object. The proposed Phase 2 capability boundary adds a post-validation step: detach a deep clone and recursively `Object.freeze` it so the capability receives a genuinely immutable snapshot. The 7 bucket computations are pure transforms over `trades[]`; no database side effects.

Evidence: `apps/web/src/app/api/ai/ask/route.ts:32-62`, `apps/web/src/server/ai-scope.ts:22-127`, `apps/web/src/server/ai-prompts.ts`.

#### Daily Recap (`POST /api/ai/recap`)

```
request.json() → readAiRequest(…, "date")
               → queryTrades(filters)
               → trades.filter(t → dayKeyOf(t.closedAt, tz) === date)   [scoped to one day]
               → computeMetrics(dayTrades, {tz})
               → journalDays.note  ← only when Object.keys(filters) ⊆ {from, to}
               → buildDailyRecapPrompt({date, scopeContext, accountContext, metricsLine, tradeLines, existingNote})
               → runAi(prompt)
               → ok({recap, scope: {label, timeZone}})
```

Day notes are shared across accounts. The route explicitly gates note inclusion to `onlyDateFilters` (from/to only) — a trade subset query never receives notes. This is the **recap-note exclusion invariant**.

Evidence: `apps/web/src/app/api/ai/recap/route.ts:12-65`, `apps/web/src/server/ai-scope.ts`.

### Pattern B — Direct key lookup + `runAi`

#### Trade Critique (`POST /api/ai/critique`)

```
request.json() → {key}                   [no readAiRequest; key is the scope]
               → getTradeByKey(key)       [direct primary-key lookup, 404 if missing]
               → rowToTrade(row)          [hydrates contractMultiplier from settings]
               → listExecutions(accountId, trade.executionIds)  [sorted by executedAt]
               → buildTradeCritiquePrompt({trade:…, fills:[…]})
               → runAi(prompt)
               → ok({critique})
```

No filter, no date range, no account selection. Scope is exactly the single trade identified by `key`. The `executionIds` array is the only read-side join.

Evidence: `apps/web/src/app/api/ai/critique/route.ts:12-43`, `apps/web/src/server/trades-query.ts`, `apps/web/src/server/executions.ts`.

### What Stays Outside Every Capability

| Side effect                      | Location                        | Reason it cannot enter a capability                                                                |
| -------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `journalDays.note` read          | `recap/route.ts`                | Shared across accounts; gated by `onlyDateFilters`. Route reads note, passes `existingNote: string | undefined` to capability; capability has no DB access. |
| Trade writes / execution inserts | `executions.ts`                 | Write path not part of Phase 2                                                                     |
| Provider / API key resolution    | `ai-settings.ts`, `settings.ts` | Provider boundary is `runTextAi` / `runObjectAi`                                                   |
| Import schema / preview token    | `ai-import.ts`                  | Separate feature with its own workflow                                                             |
| Prompt text changes              | `ai-prompts.ts`                 | Pure builders; not data reads                                                                      |
| AI execution itself              | `ai-runtime.ts`                 | The execution foundation is not being moved                                                        |

---

## Step 2 — Approved Scope: Smallest Immutable Snapshot

`readAiRequest` returns this type (inferred, not exported as an interface):

```typescript
{
  filters: AnalysisFilters;          // validated whitelist of FILTER_KEYS
  timeZone: string;                 // journal timezone, echoed or rejected
  accounts: { id: string; name: string; currency: string }[];
  question?: string;                // only when field === "question"
  date?: string;                   // only when field === "date"; YYYY-MM-DD validated
  scope: { label: string; timeZone: string };
  context: string;                 // "Journal scope: … Only the filtered data below…"
}
```

**Cloning / freezing:** TypeScript `Readonly<T>` is a compile-time annotation only — it has no runtime effect. A malicious or buggy caller can still mutate a plain object reference. Effective immutability requires two steps:

1. **Clone** every nested value that participates in query scope (`filters`, `accounts`, `scope`) using a deep-copy utility.
2. **Freeze** the result recursively with `Object.freeze` on every nested object and array.

`filters` is the most critical: it is the direct input to `queryTrades`. If it is not frozen, a capability that holds a reference and awaits an async turn can be surprised by a caller that mutated the original. `accounts` is the scope set used in `accountContext`. Both must be frozen.

The approved scope is produced once, immediately after validation, before any data is read. No caller receives a mutable reference to it.

**`FrozenApprovedScope` — runtime-immutable snapshot:**

```typescript
type FrozenApprovedScope = Readonly<{
  filters: Readonly<AnalysisFilters>;
  timeZone: string;
  accounts: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly currency: string;
  }>;
  date?: string;
  question?: string;
  scope: Readonly<{ label: string; timeZone: string }>;
  context: string;
}>;
```

Evidence: `apps/web/src/server/ai-scope.ts:107-127` — return object constructed inline; `apps/web/src/app/api/ai/ask/route.ts:33-36`, `apps/web/src/app/api/ai/recap/route.ts:12-16` — immediate destructuring.

---

## Step 3 — Minimum Capability Operations and Data Bounds

### Capability 1: `askJournal(scope: FrozenApprovedScope, question: string) → AskJournalContext`

`askJournal` is the read-only data-preparation pipeline for the Ask route. It accepts a frozen scope snapshot and returns a typed context object containing the pre-computed buckets, metrics, and account totals. The capability calls `queryTrades(scope.filters)` internally; callers never pass a trade query object. The route retains prompt construction and the `runAi` call.

```typescript
type AskJournalContext = Readonly<{
  filters: Readonly<AnalysisFilters>;
  metrics: ReturnType<typeof computeMetrics>;
  buckets: {
    bySymbol: ReturnType<typeof bySymbol>;
    byWeekday: ReturnType<typeof byWeekday>;
    byHour: ReturnType<typeof byHour>;
    byDuration: ReturnType<typeof byDuration>;
    byTag: ReturnType<typeof byTag>;
    byMistake: ReturnType<typeof byMistake>;
    byPlaybook: ReturnType<typeof byPlaybook>;
  };
  accountContext: ReturnType<typeof accountContext>;
  scope: AskScope;
}>;

type AskScope = Readonly<{
  label: string;
  timeZone: string;
}>;
```

| Field                           | Value                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Accepted scope**              | `FrozenApprovedScope` from `readAiRequest(…, "question")` (deep-frozen after validation)                                |
| **Data read**                   | `queryTrades(scope.filters)` → `AnnotatedTrade[]`                                                                       |
| **Transforms**                  | `computeMetrics`, `bySymbol`, `byWeekday`, `byHour`, `byDuration`, `byTag`, `byMistake`, `byPlaybook`, `accountContext` |
| **Typed output**                | `AskJournalContext` (structured data; no raw trade list)                                                                |
| **Route retains**               | `buildAskJournalPrompt`, `runAi`                                                                                        |
| **No raw SQL**                  | `queryTrades` applies `matchesFilters` from `@luxalgo/journal-core`; no custom WHERE clause                             |
| **No generic query language**   | Filters are whitelisted `AnalysisFilters`; no arbitrary key/value                                                       |
| **No writes**                   | Metrics are computed in-memory; no DB writes                                                                            |
| **No provider/settings access** | Prompt string only; `runAi` resolves provider server-side                                                               |

### Capability 2: `dailyRecapContext(scope: FrozenApprovedScope, date: string, existingNote: string | undefined) → RecapContext`

`dailyRecapContext` is the read-only data-preparation pipeline for the Recap route. It accepts a frozen scope snapshot, the target date, and the already-route-authorized note (or `undefined` when not authorized). The capability calls `queryTrades(scope.filters)` internally; callers never pass a trade query object. The route retains the `onlyDateFilters` gate, the note database read, and the `runAi` call.

```typescript
type RecapContext = Readonly<{
  date: string; // YYYY-MM-DD
  metrics: ReturnType<typeof computeMetrics>;
  tradeLines: string; // pre-formatted: "AccountName | Symbol Direction qty N | entry X → exit Y | net ±0.00 | held Nm" — one line per trade, same format buildDailyRecapPrompt consumes
  accountContext: ReturnType<typeof accountContext>;
  existingNote: string | undefined; // undefined when onlyDateFilters is false
  scope: RecapScope;
}>;

type RecapScope = Readonly<{
  label: string;
  timeZone: string;
}>;
```

| Field                        | Value                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accepted scope**           | `FrozenApprovedScope` from `readAiRequest(…, "date")` (deep-frozen after validation)                                                                                |
| **Note read**                | **The capability does not read the database.** Route performs the `onlyDateFilters` guard, reads `journalDays.note` if authorized, and passes `existingNote: string | undefined` as a parameter. |
| **Data read**                | `queryTrades(scope.filters).trades` then `dayTrades = filter(closedAt → dayKeyOf === date)`                                                                         |
| **Transforms**               | `computeMetrics(dayTrades, {tz})`, `accountContext(dayTrades, scope)`                                                                                               |
| **Typed output**             | `RecapContext` (structured data; no raw DB access)                                                                                                                  |
| **Route retains**            | `onlyDateFilters` guard, `journalDays.note` read, `buildDailyRecapPrompt`, `runAi`                                                                                  |
| **Note exclusion guarantee** | Gate is in the route; capability receives `undefined` for any non-date-only filter                                                                                  |
| **No writes**                | Read-only                                                                                                                                                           |

### Capability 3: `tradeCritiqueContext(tradeKey) → TradeCritiqueContext`

`tradeCritiqueContext` is the read-only data-preparation pipeline for the Critique route. The route retains prompt construction and `runAi`.

```typescript
type TradeCritiqueContext = Readonly<{
  trade: Trade; // hydrated via rowToTrade + settings.contractMultiplier
  fills: Fill[]; // sorted by executedAt, scoped to trade.executionIds only
  scope: CritiqueScope;
}>;

type CritiqueScope = Readonly<{
  key: string; // the trade key; sole isolation boundary
}>;
```

| Field                      | Value                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Accepted input**         | `string` trade key (primary key, validated non-empty)                                                                   |
| **Data read**              | `getTradeByKey(key)` (one row, direct lookup, 404 if absent) + `listExecutions(accountId, executionIds)` (sorted fills) |
| **Transforms**             | `rowToTrade` (hydrates `contractMultiplier` from settings)                                                              |
| **Typed output**           | `TradeCritiqueContext` (trade + fills; route builds prompt and calls `runAi`)                                           |
| **Route retains**          | `buildTradeCritiquePrompt`, `runAi`                                                                                     |
| **No account/date filter** | Trade key is the sole scope; no filter expansion possible                                                               |
| **No writes**              | Read-only                                                                                                               |

### Size Constraints Already Enforced

| Constraint                      | Location              | Value               |
| ------------------------------- | --------------------- | ------------------- |
| Question length                 | `readAiRequest`       | ≤ 10,000 characters |
| Output tokens (reflection)      | `AI_FEATURE_POLICIES` | 1,200               |
| Output tokens (statementImport) | `AI_FEATURE_POLICIES` | 32,000              |
| Statement import timeout        | `AI_FEATURE_POLICIES` | 120,000 ms          |
| Retry policy (reflection)       | `AI_FEATURE_POLICIES` | maxRetries: 2       |
| Retry policy (statementImport)  | `AI_FEATURE_POLICIES` | maxRetries: 0       |
| Import PDF size                 | `ai-import.ts`        | 8 MB                |
| Import text size                | `ai-import.ts`        | 150,000 characters  |

### Where No Explicit Bound Exists Today

| Behaviour                  | Current constraint                                   | Smallest compatibility-preserving bound decision                                                                                                                         |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trade count in Ask context | Unbounded; `queryTrades` returns all matching trades | No compatible cap exists today. An explicit user-visible behavior decision (truncate silently, error, or paginate) is required before any truncation logic can be added. |
| Bucket top-N               | `slice(0, 12)` hard-coded                            | Extract to a named constant `MAX_BUCKET_ITEMS = 12`; promote to `AI_FEATURE_POLICIES` if it needs runtime configuration                                                  |
| Fill count in critique     | `executionIds.length` (unbounded)                    | No compatible cap exists today. A trade with more fills is pathological; an explicit user-visible behavior decision is required before any bound can be added.           |
| `journalDays.note`         | Single string, no size constraint in DB schema       | No action needed; the note field is a user-authored string bounded by the editor                                                                                         |

---

## Step 4 — Parity and Adversarial Tests

### Existing Tests That Protect Each Contract

| Contract                            | Test file            | Test name(s)                                                                         |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| Account isolation in Ask            | `ai-scope.test.ts`   | `sends only the selected account's data to the provider`                             |
| Account isolation in Recap          | `ai-scope.test.ts`   | `sends only the selected account's data to the provider`                             |
| Named account totals                | `ai-scope.test.ts`   | `respects single, multiple and all accounts with named totals`                       |
| Malformed filter snapshot rejection | `ai-scope.test.ts`   | `rejects malformed filter snapshots before any AI call`                              |
| Empty result guard                  | `ai-scope.test.ts`   | `does not widen an empty account or empty filter result`                             |
| Journal filter predicate parity     | `ai-scope.test.ts`   | `applies every supported journal filter using the same predicate as the visible day` |
| Timezone behaviour                  | `ai-scope.test.ts`   | `uses the journal timezone at midnight and keeps date filters in recaps`             |
| Recap note exclusion                | `ai-scope.test.ts`   | `excludes shared notes from any trade subset, and leaves saved notes untouched`      |
| Request validation                  | `ai-scope.test.ts`   | `rejects invalid request bodies, dates and legacy account fields`                    |
| Critique key scope                  | `ai-scope.test.ts`   | `keeps single-trade critique scoped to its key`                                      |
| Ask scope confirmed in UI           | `ai-ui.test.ts`      | `sends the full current filter snapshot and displays the server-confirmed scope`     |
| Stale answer discard                | `ai-ui.test.ts`      | `discards late answers after changing accounts, symbol, or timezone`                 |
| Recap append correctness            | `ai-ui.test.ts`      | `appends a labeled recap to edits made while generation is pending`                  |
| Provider/key separation             | `ai-runtime.test.ts` | OpenAI + Anthropic routing, redacted metadata, storage disabled                      |
| Feature policy limits               | `ai-runtime.test.ts` | `keeps reflection bounded and statement import non-retrying`                         |
| Prompt versioning                   | `ai-runtime.test.ts` | `versions every current feature prompt`                                              |

### Required New Deterministic Tests for Phase 2

These tests exercise capability behaviour, not forwarding. They belong in `apps/web/tests/ai-capability.test.ts` (new file).

| #   | Test name                                                                            | What it exercises                                                                                                       |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `askJournal rejects scope with unknown account id`                                   | Capabilities built from a tampered `FrozenApprovedScope` (account id not in DB)                                         |
| 2   | `askJournal with zero trades returns error not empty string`                         | Empty result is a 400, not a silent empty-prompt call                                                                   |
| 3   | `askJournal applies top-N to each bucket independently`                              | Bucket arrays are independently sliced; no cross-bucket bleed                                                           |
| 4   | `dailyRecap note excluded when filters contain account`                              | `onlyDateFilters` gate fires correctly; note absent from prompt                                                         |
| 5   | `dailyRecap note included when filters are only from/to`                             | Note included for date-only recap                                                                                       |
| 6   | `dailyRecap returns 400 when no closed trades on that day`                           | Empty day trades → 400, no AI call                                                                                      |
| 7   | `tradeCritique returns 404 for unknown key`                                          | Direct key lookup is the only guard                                                                                     |
| 8   | `tradeCritique never sees fills from other trades`                                   | `executionIds` array is the only execution scope                                                                        |
| 9   | `approvedScope filters cannot be widened after readAiRequest`                        | Deep-frozen snapshot prevents mutation; `queryTrades` output is unaffected by post-freeze mutations to the original     |
| 10  | `askJournal timezone mismatch rejected`                                              | `body.timeZone !== getTimeZone()` → error before any data read                                                          |
| 11  | `askJournal with selected-account scope excludes unselected-account trades`          | Given two accounts A and B, Ask with scope A's filters never includes B's trades in any bucket or aggregate             |
| 12  | `askJournal with selected-account scope excludes unselected-account totals`          | `accountContext` totals for unselected accounts are absent from the context object                                      |
| 13  | `dailyRecap with selected-account scope excludes unselected-account trades`          | Given two accounts A and B, Recap with scope A's filters never includes B's trades in `tradeLines` or `metrics`         |
| 14  | `dailyRecap with selected-account scope excludes unselected-account totals`          | `accountContext` totals for unselected accounts are absent from the context object                                      |
| 15  | `dailyRecap note is undefined for multi-account scope even when from/to are present` | When scope includes multiple accounts (not `onlyDateFilters`), `existingNote` is `undefined` regardless of note content |

---

## Step 5 — Migration Order and Phase 3 Gate

### Safe Cutover Order

**Phase 3 Task A — `tradeCritiqueContext` (simplest)**
No `readAiRequest`, no filter, no account subset, no timezone. Input is one validated key. Cutover extracts the `getTradeByKey` + `listExecutions` + `rowToTrade` sequence into `tradeCritiqueContext(key)`. The route retains `buildTradeCritiquePrompt` and `runAi`. This is the lowest-risk cutover.

**Phase 3 Task B — `dailyRecapContext`**
Uses `readAiRequest(…, "date")`. Scope snapshot is deep-frozen after validation. Cutover extracts `queryTrades` + day-filter + `computeMetrics` + `accountContext` into `dailyRecapContext(scope: FrozenApprovedScope, date: string, existingNote: string | undefined)`. The capability internally calls `queryTrades(scope.filters)`. The route retains the `onlyDateFilters` guard, the `journalDays.note` database read, `buildDailyRecapPrompt`, and `runAi`. Note authorization remains route-controlled.

**Phase 3 Task C — `askJournal`**
Uses `readAiRequest(…, "question")` with the full filter + account + bucket + context pipeline. Cutover extracts `queryTrades` + all bucket computations + `accountContext` into `askJournal(scope: FrozenApprovedScope, question: string)`. The capability internally calls `queryTrades(scope.filters)`. The route retains `buildAskJournalPrompt` and `runAi`. This is the most complex cutover; it should be last.

### Phase 3 Ask-Journal Agent Loop Gate

The discovery record establishes that Ask today:

- Accepts a validated `ApprovedScope` (no widening possible from the client)
- Reads only `queryTrades(scope.filters)` — already account/filter-scoped
- Produces aggregates, not raw trade lists
- Is bounded by 1,200 output tokens

**The evidence threshold for an agent loop in Ask is:** a user question that requires trade-level detail not expressible through the existing bucket/top-N aggregates, AND that cannot be answered by extending the bucket computations within the current capability model.

**Absence of this evidence means Ask remains a direct call.** No agent loop, tool-calling infrastructure, or MCP-style dynamic invocation is added to Ask without a specific, user-visible gap documented in the Phase 3 plan and approved through the normal review process.

---

## Step 6 — Verification

### Validation Commands Run

```bash
pnpm test apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-runtime.test.ts
pnpm exec prettier --check docs/superpowers/research/2026-10-10-ai-capability-extraction.md
```

### Existing Reviewer Report

`.omp/reviewer-report.md` contains `## Verdict: PASS` for the Phase 1 foundation. This discovery record does not modify production behaviour and introduces no new tests; no change to that verdict is required. The new file is a research artifact only.

### Commit Scope

Only the following files are committed:

- `docs/superpowers/research/2026-10-10-ai-capability-extraction.md` (new)
- `docs/superpowers/plans/2026-10-10-ai-capability-discovery.md` (plan, already in-progress)

No production source, test, or configuration files are modified.
