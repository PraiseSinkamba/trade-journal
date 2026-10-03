# CSV Import Enhancements — Design

**Date:** 2026-10-03
**Status:** Approved (brainstorming → writing-plans)

## Problem

Two reported pains in `apps/web/src/app/import`:

1. **AI parsing fails too eagerly.** A 9-row CSV returns either
   `complete=false` ("AI could not extract the complete statement") or is
   reported as "too many records" even though it is short. Root cause:
   the model enumerates summary rows (deposits, balances, transfers) as
   trades and then bails on `complete`, and the existing 16k token budget
   truncates mid-JSON when the model tries to enumerate generously.

2. **No override once a format is selected.** If `parseAuto` chooses
   TradeZella but `parse()` silently drops every row (skipped count
   reported as `9 of 9`), the user has no way to refute the detection and
   map columns manually. The manual mapper UI only renders when
   `parseAuto` returns null. The actual reasons for the dropped rows are
   also thrown away — `skippedRows` is a single integer.

## Goals

- Make AI parsing succeed on simple structured CSVs by preventing summary-row
  contamination and JSON truncation.
- Let users refute a wrongly-detected format and map columns manually
  from the existing preview UI, without re-uploading.
- Surface the per-row reasons parsers drop rows, so users can see *why*
  a format dropped their trades and decide whether to map manually.

## Non-goals

- No new endpoints.
- No new dependencies.
- No two-pass AI classification.
- No telemetry/feedback pipeline for "AI was wrong" data.
- Not changing the parser schema, JSON contract, or AI output schema.

## Scope summary

| Section | Change | Files | Risk |
|---|---|---|---|
| 1 | Skip-reasons surfacing | `packages/importers/src/types.ts`, parsers (8 files), `apps/web/src/app/api/import/route.ts`, `apps/web/src/app/import/page.tsx` | Low. Type widening; old count preserved. |
| 2 | Refute-and-remap affordance | `apps/web/src/app/import/page.tsx` | Low. UI-only, existing API already supports `mapping`. |
| 3 | AI prompt tightening + token bump + header context | `apps/web/src/server/ai-import.ts` | Low. Prompt-only + numeric bump. |

## Section 1 — Skip-reasons surfacing

### Current behaviour

`ParsedImport.skippedRows: number` counts silently. Example in
`packages/importers/src/formats/tradezella.ts`:

```ts
if (!symbol || !openedAt || !closedAt || ...) { skippedRows++; continue; }
```

The user sees `9 rows skipped` with no indication of *why*.

### Change

1. Add a structured form alongside the existing count. **Ponytail pick:**
   keep `skippedRows: number` (preserves downstreams that depend on the
   count); add `skippedReasons: { row: number; reason: string }[]`. Total
   kept consistent via `skippedReasons.length === skippedRows`.

2. Each parser replaces `skippedRows++` with:

   ```ts
   skippedReasons.push({
     row: rowNumber,
     reason: !symbol
       ? "missing symbol"
       : !openedAt
         ? "unparseable open timestamp"
         : !closedAt
           ? "unparseable close timestamp"
           : quantity <= 0
             ? "non-positive quantity"
             : "missing entry/exit price",
   });
   ```

   The format's `id` (e.g. `tradezella`) is added at the API boundary so
   the UI can group reasons per format.

3. The `route()` function in `detect.ts` propagates `skippedReasons`
   alongside `executions` unchanged.

4. The API route `/api/import/route.ts` includes both in the preview
   response: `skippedRows` (count) + `skippedReasons` (array, capped at
   the first 50 entries with a `skippedReasonsTruncated: boolean` flag if
   more).

5. UI in `apps/web/src/app/import/page.tsx`: replace the inline
   "· N rows skipped" text with a button that opens a small disclosure
   panel listing the first 5 reasons inline (`row 7 — unparseable open
   timestamp`) and an "and N more" expander for the remainder. Format
   matches the existing executions preview pattern
   (`preview.executions.slice(0, 5)`). No parser internals exposed.

### Files touched

- `packages/importers/src/types.ts` — add `skippedReasons` to
  `ParsedImport`.
- `packages/importers/src/formats/*.ts` — replace `skippedRows++` with
  reason push. Affected files: every file with `let skippedRows = 0;`
  pattern: `tradezella.ts`, `metatrader.ts`, `ibkr.ts`, `thinkorswim.ts`,
  `fills.ts`, plus the `history/` adapter parsers that return
  `skippedRows`.
- `packages/importers/src/detect.ts` — forward `skippedReasons`.
- `apps/web/src/app/api/import/route.ts` — surface in response.
- `apps/web/src/app/import/page.tsx` — render disclosure panel.

### Tests

- Unit: each parser produces a stable reason for at least one known-bad
  row. New tests in `packages/importers/tests/` (file-per-parser, mirror
  the existing structure).
- E2E: import page renders the disclosure panel when
  `skippedReasons.length > 0`.

## Section 2 — Refute-and-remap affordance

### Current behaviour

```tsx
{preview?.needsMapping && preview.headers && (
  // column mapper UI
)}
```

This only renders when `parseAuto` returns null. Once a format is
detected, the user is locked in: no way to fall back to manual mapping
without re-choosing the file.

### Change

In the `!preview.needsMapping && preview.totals` block (around line 516
of `apps/web/src/app/import/page.tsx`):

1. Add a "Wrong format? Map columns manually" link next to the detected
   format badge. Hidden if `preview.detected === 'ninjatrader'` (the
   reconciliation flow owns that case).

2. Click → local state `showManualMapper = true`. The detected-format
   summary collapses (single source of truth: don't show parallel
   totals); the existing mapper UI renders with the file's headers
   already populated.

3. Click "Preview with mapping" → POST `/api/import` with `mapping`. On
   success, `mappingApplied` becomes true. The detected-format summary
   does not return; the user is in manual-mode for this session.

4. AI preview path: if the user already previewed with AI
   (`preview.aiPreviewToken` set), the link is hidden. The mapper uses
   the same `body.mapping` parameter, which the API already accepts in
   the non-AI branch.

### Files touched

- `apps/web/src/app/import/page.tsx` only.

### Tests

- Component: link visible when `preview.detected !== 'ninjatrader'` and
  `!preview.aiPreviewToken`; click toggles `showManualMapper`; mapper
  renders.

## Section 3 — AI prompt tightening + token bump + header context

### Current behaviour

`parseStatementWithAi` in `apps/web/src/server/ai-import.ts`:

- `maxOutputTokens: 16000`.
- System prompt is detailed; says "ignore headers, totals, deposits,
  transfers, cancelled/unfilled orders and balances" but the inventory is
  not concrete (no examples). Models still enumerate summary rows.
- User message: one generic text + the file content. The header row is
  embedded in the file; if the model reads just the bottom half, it
  misses it.

### Change

1. **`maxOutputTokens: 32000`** (was 16000). A 9-row CSV with the 200-
   execution cap should never hit this, but generous models that
   enumerate summary rows can. 32k is still well below provider limits.

2. **Inline the header list in the user message.** Before the file
   content, append a text block listing the first row of the file (the
   header row), each column truncated to 80 chars, one per line:

   ```
   Detected columns (first row of file):
     0: Ticket
     1: Open Time
     ...
   ```

   Build this client-side from `readHeaders()` and include it in the
   preview request. For PDFs, skip (the model sees headers natively).

3. **System prompt: non-trade inventory.** Add a concrete list to the
   existing ignore rule: do not emit executions for any of these row
   types — deposits, withdrawals, transfers, balance rows, dividends,
   interest, fees-as-line-items, cancellations, expired orders, working
   orders, status lines, equity/margin totals, summary totals, account
   info rows. If a row in the statement is one of these, ignore it; if
   *every* row could plausibly be one of these and no real trades are
   present, return `executions: []` with `complete: true` and a
   `warnings` entry explaining "no trade rows found."

4. **Tighter `complete` semantics.** Add: prefer returning the rows the
   model is sure about with `complete: true` over returning everything
   with `complete: false`. Only set `complete: false` when at least one
   row is genuinely missing or ambiguous. Reason: today's eager
   `complete=false` is the user's primary failure mode.

5. **No schema changes.** Same `Extraction` interface, same
   `validateAiExtraction()`.

### Files touched

- `apps/web/src/server/ai-import.ts` — prompt + token bump + accept
  `headers?: string[]` in `AiStatement`.
- `apps/web/src/lib/ai-import.ts` — type widening (optional headers).
- `apps/web/src/app/import/page.tsx` — pass `headers` in preview
  requests.

### Tests

- Unit: build a fixture 9-row CSV that includes a "Balances" section
  after the trade rows; assert `parseStatementWithAi` (mocked provider)
  returns executions only for trade rows.
- Manual smoke: run the dev server, upload the user's failing file,
  confirm the AI path now returns `complete: true` with the right
  executions.

## Acceptance criteria

1. A user-uploaded file that `parseAuto` routes to TradeZella but
   silently drops (0 rows imported) now shows the per-row reasons in a
   disclosure panel. The user can click "Wrong format? Map columns
   manually" to switch to the manual mapper without re-uploading.

2. After mapping manually, the preview shows the user's mapped totals.
   Commit uses the manual mapping. No duplicate execution IDs vs. the
   rejected auto-detection (manual path never wrote anything).

3. The AI path on a structured CSV with a clear header row and a
   summary section after the trades returns `complete: true` with
   executions only for the trade rows. The "AI could not extract the
   complete statement" error appears only when the model genuinely
   cannot resolve the file.

4. All work lands in existing style guides: no raw HTTP in
   `packages/importers`, no telemetry endpoints, no new dependencies.

## Risk register

- **Type widening on `ParsedImport`**: external callers in `apps/web`
  read `skippedRows` as a number. Confirmed by grep; all readers will
  continue to work after the addition of `skippedReasons`. Keep both.
- **AI prompt regression**: tightening the prompt could shift behaviour
  on previously-working files. Mitigation: keep the existing rules
  verbatim; only *add* the inventory list and the header-context block.
- **UI layout**: the refute-and-remap disclosure sits inside an already-
  crowded card. Mitigation: replace the totals row, not stack beneath
  it.