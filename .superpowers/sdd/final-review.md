# Final Branch Review — CSV Import Enhancements

**Branch:** 13 commits, 24 files, +1315/-47 lines
**Reviewer:** Final-Review (subagent)
**Date:** 2026-10-03

---

## 1. Invariant Check — `skippedReasons.length === skippedRows`

The spec states this equality must hold everywhere. The diff was walked file-by-file.

### VIOLATION (1 finding)

**`filterByStatus` in `packages/importers/src/history/adapters/generic.ts`**

```ts
// Lines 2348-2363 (diff notation):
for (const record of table.records) {
  if (NON_FILLED_STATUS.test(status)) {
    skipped++;          // increments per-row
    continue;           // NO skippedReasons push here
  }
  ...
}
if (skipped > 0) {
  issues.push(issue("info", "cancelled-row-ignored",
    `${skipped} row(s) with a non-filled status were ignored.`));
  skippedReasons.push({ row: null, reason: issues[issues.length - 1]!.message });
  // BUG: one reason pushed for N skipped rows
}
return { records, skipped, skippedReasons };
```

If 50 rows are cancelled/rejected/expired, `skipped` = 50 but `skippedReasons` = `[{ row: null, reason: "…cancelled-row-ignored…"}]` (length 1). **Confidence: 1.0. Severity: Critical.** The aggregate at the bottom of `parseHistory` then incorporates this mismatch:
```ts
skippedReasons: [...history.stats.skippedReasons, ...skippedReasons]
```
and the API surface checks `skippedReasons.length` to display "N detailed". A user sees "50 rows skipped — 1 detailed" and "and 0 more" — broken UI.

### KNOWN ACCEPTABLE — Cascading conditions (no violation)

`rowsToFills` (fills.ts), `parseHistory` (history.ts), and `tradezella.ts` use cascading `if/else if` — only one branch fires per row. So `skippedRows++` and exactly one `skippedReasons.push` always occur together. **Invariant holds** in these paths.

### ALL OTHER SITES — Clean

Every other `skippedRows++` site has a corresponding single `skippedReasons.push`. Adapters (metatrader, mt5deals, tradingview, generic's `parseTradePerRow/parseEventRows/parseExecutions`) all push per-row. ✅

### `needsSymbol` edge in `parseHistory`

When `needsSymbol` is true (user must choose symbol), `skippedReasons` accumulates fill-skip and trade-skip reasons, then the function returns early with an error message. The error is surfaced separately (`errors: [...]`) not via `skippedReasons`. The invariant still holds for the rows that were processed. **No violation.** Minor: the user sees an error rather than a reason for those rows, but that matches the existing design.

---

## 2. Spec Coverage

| Acceptance Criterion | Implementation | Covered |
|---|---|---|
| **Spec §1**: Per-row reasons surfaced in disclosure panel | `route.ts` exposes `skippedReasons[:50]` + `skippedReasonsTruncated`; UI renders `<details>` with first 5 + "and N more" + truncation note | ✅ |
| **Spec §1**: `skippedRows` count preserved | `route.ts` still returns `parsed.skippedRows` unchanged | ✅ |
| **Spec §2**: "Wrong format? Map columns manually" link | `page.tsx` adds link, hidden for `ninjatrader` and when `aiPreviewToken` set | ✅ |
| **Spec §2**: Link click collapses totals, shows mapper | `!showManualMapper && preview && !preview.needsMapping && preview.totals` guards the totals block | ✅ |
| **Spec §2**: `showManualMapper` resets on new file | `onFile` calls `setShowManualMapper(false)` | ✅ |
| **Spec §3**: `maxOutputTokens` 16000 → 32000 | `ai-import.ts` `maxOutputTokens: 32000` | ✅ |
| **Spec §3**: Header block in user message | `headers` field added to `AiStatement`; user message prepends `Detected columns (first row of file):\n  0: Ticket…` | ✅ |
| **Spec §3**: Non-trade inventory concrete list | SYSTEM prompt extended with full row-type list (deposits, withdrawals, transfers, balance rows, dividends, interest, fees-as-line-items, cancellations, expired orders, working orders, status lines, equity/margin totals, summary totals, account info rows) | ✅ |
| **Spec §3**: Tighter `complete` semantics | SYSTEM prompt: "Prefer returning the rows you are sure about with complete: true over returning everything with complete: false" | ✅ |
| **Spec §3**: `validateAiExtraction` returns `skippedReasons: []` | Line: `return { format: "AI-assisted", executions, sources, skippedRows: 0, skippedReasons: [], warnings }` | ✅ |
| **Spec §4**: No HTTP in `packages/importers` | grepped; no fetch/axios/http imports added | ✅ |
| **Spec §4**: No new dependencies | stat confirms no new deps | ✅ |

**Uncovered items:** None. All acceptance criteria are addressed.

---

## 3. Code Quality

### 3a. Reason strings that leak internals

All reason strings are human-facing. No column names (e.g. "symbol", "side", "quantity"), no raw field paths, no types. One borderline case:

- **ibkr.ts**: `"row was not an Order fill (skipped discriminator)"` — the word "discriminator" is an internal IBKR/Flex report concept, not a user-facing term. The message would be clearer as `"row was not a filled order"`. Minor severity since the concept is described and no internal field name is exposed. **Confidence: 0.9. Severity: Minor.**

### 3b. Unnecessary duplication

- The `SkippedReason` interface is defined in `types.ts` and re-imported across every parser and adapter file that uses it. This is unavoidable with the current structure (no shared barrel re-export from `types.ts` is used). Not a bug — TypeScript requires the import. No functional duplication.
- The plan document (656 lines) is duplicated verbatim in the diff as a doc commit. This is intentional per the spec process, not code duplication.

### 3c. Edge cases not exercised by tests

The test file `skipped-reasons.test.ts` has **3 cases** (tradezella, parseWithMapping, parseHistory) and the UI test `import-page-preview.test.tsx` has **4 cases** (refute link visible, refute link hidden for ninjatrader, refute click shows mapper, refute click hides totals). Several gaps:

| Edge case | Risk | Covered? |
|---|---|---|
| `filterByStatus` with 2+ cancelled rows | Wrong reason count in UI | **NO** — the bug itself means there's no test for it |
| `skippedReasonsTruncated: true` path | UI shows "showing first 50 of N" message | **NO** — mock data has `skippedReasons: []`, never tests truncation |
| `needsSymbol` path in `parseHistory` | No reasons accumulated, error returned | **NO** |
| `historyFormat.parse` fallback (no executions, no history) | Returns `skippedReasons: []` | **NO** |
| UI when `skippedReasons.length === 0` but `skippedRows > 0` (the `filterByStatus` bug in production) | Disclosure shows "0 detailed" | **NO** |
| `"Wrong format?"` link when `preview.detected` is null | Would render in unexpected state | **NO** |
| `aiPreviewToken` path — link correctly hidden | Covered by test condition `!preview.aiPreviewToken` | ✅ |

### 3d. Tests that don't test what they claim

**`import-page-preview.test.tsx` — "renders the refute link after a detected non-ninjatrader format"**

The mock `mockPostJson.mockResolvedValueOnce(tradezellaPreview)` provides `totals.skippedRows: 0` and `totals.skippedReasons: []`. The test never asserts anything about the skip-reasons disclosure panel — it only tests the refute link. The test name and description don't claim to test skip reasons, but the test file is described in the plan as covering "the disclosure panel and the refute-and-remap link." The disclosure panel is **not actually tested**.

**`skipped-reasons.test.ts` — "parseHistory propagates reasons from adapters"**

```ts
const result = parseHistory(csv, {});
expect(result?.skippedRows).toBeGreaterThanOrEqual(1);
expect(result?.skippedReasons.length).toBe(result?.skippedRows ?? 0);
```

This test passes if `skippedRows >= 1` and the invariant holds. But it doesn't test which reason was given, whether the reason is human-facing, or whether `parseHistory`'s own skip paths (trade-skip, open-trade-skip) are exercised. The test depends on the MT5 fixture triggering specific adapter conditions — if the fixture changes, the test may no longer exercise the intended code path.

---

## 4. Risk Register

### Risk 1: `filterByStatus` broken invariant (Critical)
- **What:** One `skippedReasons` entry for N filtered rows in generic adapter.
- **Impact:** User sees "N rows skipped — 1 detailed" and "and 0 more" when many rows are filtered. UI is misleading.
- **Likely environment:** Files with a "Status" column where many rows are cancelled/working/expired orders — common in TradeVue/generic CSV exports.
- **Mitigation needed:** Fix `filterByStatus` to push one reason per filtered row (or push the aggregated count as the reason string).
- **Missed by reviewers:** The per-task reviewers tested individual parsers with single skip rows; the aggregate `filterByStatus` path with multiple skipped rows was not exercised.

### Risk 2: `needsSymbol` path returns early with partial `skippedReasons` (Minor)
- **What:** `parseHistory` can return with `skippedReasons` accumulated only from fill/trade skip sites, before reaching the `needsSymbol` check. The `needsSymbol` error is surfaced via `errors`, not `skippedReasons`, so rows that were skipped for any reason before the symbol check are correctly recorded, but the `needsSymbol` itself contributes no per-row reason.
- **Impact:** User sees an error "Choose the symbol" and the skip reasons from prior rows. The symbol-missing rows don't appear in `skippedReasons`.
- **Severity:** Minor — this is a pre-existing design choice; the spec doesn't mandate a per-row reason for `needsSymbol`.

### Risk 3: No AI-path skip reasons surfaced to UI (Minor)
- **What:** `validateAiExtraction` returns `skippedReasons: []` always (AI parser doesn't produce per-row reasons). The API route only surfaces `skippedReasons` from the non-AI parse path.
- **Impact:** If a user uploads a file and AI parsing drops rows (hypothetically), no reason is shown. In practice, AI parsing either succeeds with `skippedRows: 0` or fails with `complete=false` — it doesn't produce skip reasons.
- **Severity:** Minor — by design. AI parsing has its own error model (`complete`, `warnings`, `errors`).

### Risk 4: Cascade condition divergence in UI "and N more" (Minor)
- **What:** The UI displays `skippedReasons.length - 5` as "and N more". With cascading skip conditions (e.g., a row with both missing symbol and unparseable timestamp — which can't happen due to `if/else if`), `skippedReasons.length` would be less than `skippedRows`. The "and N more" would show the wrong number.
- **Impact:** Cosmetic — "and N more" could undercount. Since cascading conditions are exclusive, in practice `skippedReasons.length === skippedRows`.
- **Severity:** Minor — latent, only visible if a future code change introduces a non-cascading double-skip.

### Risk 5: `readHeaders` imported from `@luxalgo/journal-importers` in web component (Minor)
- **What:** `apps/web/src/app/import/page.tsx` now imports `readHeaders` from the importers package for the AI preview path.
- **Impact:** This is the correct design (importers package is a dependency of web). No functional risk.
- **Note:** This was in the plan; no deviation.

### Risk 6: `packages/importers` purity maintained (Confirmed clean)
- Confirmed: no `fetch`, `axios`, `http`, or `apps/web` imports in any modified `packages/importers` file.

---

## 5. Verdict

**REQUEST CHANGES**

### Critical (blocks merge)

| # | File | Finding | Confidence |
|---|---|---|---|
| C1 | `packages/importers/src/history/adapters/generic.ts` — `filterByStatus` | `skippedReasons.push` called once after the loop for all N filtered rows; `skipped` counts per-row. Violates `skippedReasons.length === skippedRows` invariant. User sees "N rows skipped — 1 detailed" in UI. | 1.0 |

### Important (should fix before merge)

| # | File | Finding | Confidence |
|---|---|---|---|
| I1 | `apps/web/tests/import/import-page-preview.test.tsx` | Mock data has `skippedReasons: []`; the skip-reasons disclosure panel is never asserted. The plan promised disclosure panel coverage; it is not tested. | 0.9 |
| I2 | `packages/importers/src/history/adapters/generic.ts` — `filterByStatus` | The `if (skipped > 0)` block that pushes the aggregated reason fires only when `skipped > 0` — but `skippedReasons` is returned even when `skipped === 0` (returns `[]`). This is correct but fragile; the next developer might "optimize" it away. A comment or a dedicated return path would clarify intent. | 0.8 |

### Minor (non-blocking)

| # | File | Finding | Confidence |
|---|---|---|---|
| M1 | `packages/importers/src/formats/ibkr.ts` | Reason string `"row was not an Order fill (skipped discriminator)"` uses internal term "discriminator" — user-facing text would be clearer as `"row was not a filled order"`. No spec violation; just suboptimal copy. | 0.9 |
| M2 | `apps/web/tests/import/import-page-preview.test.tsx` | `skippedReasonsTruncated: true` path never tested; no test exercises the "showing first 50 of N" truncation message in the UI. | 0.85 |
| M3 | `packages/importers/tests/skipped-reasons.test.ts` | `parseHistory` test uses a specific MT5 fixture whose skip-triggering properties aren't explicitly documented or asserted — could silently stop exercising the intended path if fixture format changes. | 0.8 |
| M4 | `packages/importers/src/formats/history.ts` | `needsSymbol` error path surfaces via `errors` array, not `skippedReasons`. Rows skipped before the `needsSymbol` check are recorded correctly, but the `needsSymbol` condition itself contributes no per-row reason. Spec doesn't require this; minor latent. | 0.9 |

---

## Summary

The branch implements all three spec sections correctly. The `filterByStatus` bug is a genuine invariant violation that produces broken UI output in a real scenario (files with many cancelled/working rows). It must be fixed before merge.

All other findings are either pre-existing design choices acknowledged in the spec (cascading conditions, `filterByStatus` pushing one aggregated reason), test coverage gaps that don't affect correctness, or minor copy improvements.

**Next step:** Fix `filterByStatus` to push one reason per filtered row (the reason string can remain the aggregate message, but it must be pushed N times for N filtered rows, or the design must be updated to use `row: null, reason: "${skipped} row(s) with non-filled status were ignored"` and acknowledge the count divergence in the UI).
