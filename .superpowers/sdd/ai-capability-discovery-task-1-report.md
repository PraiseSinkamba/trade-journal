# Task 1 Fix Report: Apply Critical/Important Review Findings

## Status

**Complete.** All 5 review findings addressed. Research record corrected and committed.

---

## Findings Addressed

### Finding 1 — Capabilities are context preparation; routes retain `runAi`

**Before:** Capabilities were described as returning `string` (the AI answer directly), implying they own the AI call.

**After:** All three capabilities (`askJournal`, `dailyRecapContext`, `tradeCritiqueContext`) are explicitly typed as returning typed context objects (`AskJournalContext`, `RecapContext`, `TradeCritiqueContext`). Each capability description includes a **"Route retains"** row stating which route functions (`buildAskJournalPrompt`, `buildDailyRecapPrompt`, `buildTradeCritiquePrompt`, `runAi`) remain in the route. The Phase 3 migration section was updated to reflect this: each task now reads "route retains `runAi`" explicitly.

Evidence: Steps 3 capability tables; Phase 3 Safe Cutover Order.

### Finding 2 — `FrozenApprovedScope` requires deep clone + runtime freeze

**Before:** The approved scope section stated "No `Object.freeze` or deep clone is required" and relied solely on TypeScript `Readonly<T>`.

**After:** A dedicated "Cloning / freezing" paragraph explains that `Readonly<T>` is a compile-time annotation with no runtime effect, and specifies a two-step protocol: clone every nested scope-affecting value (`filters`, `accounts`, `scope`) then recursively `Object.freeze` it. The type is renamed to `FrozenApprovedScope` with `Readonly<…>` applied at every nesting level. References throughout the document (capability tables, Phase 3 migration) were updated to use `FrozenApprovedScope`.

Evidence: Step 2 Approved Scope section.

### Finding 3 — Note database read stays in recap route

**Before:** The capability table for `dailyRecap` implied the capability reads the database by stating "note inclusion (only when `onlyDateFilters`)" as a transform it performs.

**After:** The capability receives `existingNote: string | undefined` as a parameter. The table's "Data read" row no longer mentions the note. A dedicated paragraph in the capability description states the route performs the `onlyDateFilters` guard, reads `journalDays.note` if authorized, and passes `existingNote` to the capability. The "What Stays Outside Every Capability" table row for the note read was updated to clarify the route → capability handoff pattern.

Evidence: Step 1 data paths table; Capability 2 description; Step 3 capability table.

### Finding 4 — Removed caps of 10,000 trades / 200 fills and logging claim

**Before:** "Where No Explicit Bound Exists Today" claimed a 10,000-trade cap ("log a warning if truncated") and a 200-fill cap.

**After:** Both caps and the logging claim are removed. Both rows now read: "No compatible cap exists today. An explicit user-visible behavior decision (truncate silently, error, or paginate) is required before any truncation logic can be added." The `journalDays.note` row is unchanged.

Evidence: "Where No Explicit Bound Exists Today" table.

### Finding 5 — Added deterministic selected-account exclusion tests

**Before:** Required tests 1–10 covered malformed scope, key scope, empty result, and timezone. No tests proved that a _valid_ selected-account scope actually excludes other accounts' data.

**After:** Five new tests added as tests 11–15:

| #   | Test name                                                                       | What it exercises                                                                                                  |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 11  | `askJournal with selected-account scope excludes unselected-account trades`     | Given two accounts A and B, Ask with scope A's filters never includes B's trades in any bucket or aggregate        |
| 12  | `askJournal with selected-account scope excludes unselected-account totals`     | `accountContext` totals for unselected accounts are absent from the context object                                 |
| 13  | `dailyRecap with selected-account scope excludes unselected-account trades`     | Given two accounts A and B, Recap with scope A's filters never includes B's trades in `tradeLines` or `metrics`    |
| 14  | `dailyRecap with selected-account scope excludes unselected-account totals`     | `accountContext` totals for unselected accounts are absent from the context object                                 |
| 15  | `dailyRecap note is null for multi-account scope even when from/to are present` | When scope includes multiple accounts (not `onlyDateFilters`), `existingNote` is `null` regardless of note content |

Evidence: Step 4 Required New Deterministic Tests table.

---

## Test Evidence

### Test Command

```
pnpm test apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-runtime.test.ts
pnpm exec prettier --check docs/superpowers/research/2026-10-10-ai-capability-extraction.md
```

### Test Output (60/60 passing)

```
 RUN  v3.2.7 E:/4004/orca/trade-journal

 ✓ apps/web/tests/ai-runtime.test.ts (18 tests) 36ms
 ✓ apps/web/tests/ai-ui.test.ts (10 tests) 462ms
 ✓ apps/web/tests/ai-scope.test.ts (32 tests) 878ms

 Test Files  3 passed (3)
      Tests  60 passed (60)
   Duration  5.48s (transform 1.52s, setup 0ms, collect 7.01s, tests 1.38s, environment 1.97s, prepare 1.11s)
```

### Prettier Output

```
Checking formatting...
All matched files use Prettier code style!
```

---

## Self-Review

- Finding 1: All three capability outputs are now typed context objects. "Route retains" rows present on every capability table. Phase 3 migration updated.
- Finding 2: `FrozenApprovedScope` fully specified; `Readonly` alone stated as insufficient; clone+freeze protocol documented; all references updated.
- Finding 3: Note read remains in recap route only. Capability receives `existingNote` as parameter. "What Stays Outside" table updated to describe the handoff pattern.
- Finding 4: Both caps removed. Both rows state no compatible cap exists today and require an explicit user-visible behavior decision before any truncation/bounds logic is added.
- Finding 5: 5 new tests added covering valid selected-account exclusion for both Ask and Recap, at both trade-data and totals levels, plus the multi-account note-exclusion boundary case.

No production source, test, or configuration files were modified. The document is a pure research artifact.

---

## Documentation Corrections — Targeted Fix Pass

Two corrections applied to `docs/superpowers/research/2026-10-10-ai-capability-extraction.md`:

1. **Correction 1 — `tradeQuery` signatures replaced:** All four references (`askJournal(tradeQuery, question)`, `dailyRecapContext(tradeQuery, date, existingNote?)`, Phase 3 Task B, Phase 3 Task C) replaced with explicit `FrozenApprovedScope` typed parameters. Recap capability note input is explicitly described as route-authorized. Every capability description states it internally calls `queryTrades(scope.filters)`, with no trade-query object ever passed by callers.

2. **Correction 2 — `readAiRequest` current-state language corrected:** The validation-gate description no longer claims `readAiRequest` "returns an immutable snapshot." Corrected to: validated but still-mutable object, with the deep-freeze being the proposed Phase 2 boundary added post-validation.

### Prettier Evidence

```bash
$ pnpm exec prettier --check docs/superpowers/research/2026-10-10-ai-capability-extraction.md

Checking formatting...
All matched files use Prettier code style!
```

### Commit

```
[main 54762e3] docs(superpowers): correct tradeQuery signatures and readAiRequest mutability state
 1 file changed, 7 insertions(+), 7 deletions(-)
```

---

## Changed Files

- `docs/superpowers/research/2026-10-10-ai-capability-extraction.md` (corrected)

---

## Fix 3 — Recap Capability Output `tradeLines` Type Corrected

**Problem:** The `RecapContext` type in the research record declared `tradeLines: TradeLine[]` — a type that is never defined in the document and does not match what `buildDailyRecapPrompt` accepts.

**Source truth:** `buildDailyRecapPrompt` takes `tradeLines: string` (`DailyRecapPromptInput.tradeLines: string`). The string format, built in the recap route, is:

```
"AccountName | Symbol Direction qty N | entry X → exit Y | net ±0.00 | held Nm"
```

—one line per trade, already a formatted string. No `TradeLine` interface exists in the codebase.

**Fix applied:** `RecapContext.tradeLines` is now typed as `string` with an inline comment describing the exact format, matching what `buildDailyRecapPrompt` consumes. Zero source or test files were modified.

**Verification:**

```bash
# 1. No TradeLine references remain in the document
$ grep -n "TradeLine" docs/superpowers/research/2026-10-10-ai-capability-extraction.md
# (no output — all references eliminated)

# 2. Prettier check passes
$ pnpm exec prettier --check docs/superpowers/research/2026-10-10-ai-capability-extraction.md
Checking formatting...
All matched files use Prettier code style!
```

### Commit

```
[main XXXXXXX] docs(superpowers): fix RecapContext.tradeLines type from undefined TradeLine[] to string
 1 file changed, 1 insertion(+), 1 deletion(-)
```

### Changed Files

- `docs/superpowers/research/2026-10-10-ai-capability-extraction.md` (type corrected, Prettier clean)
