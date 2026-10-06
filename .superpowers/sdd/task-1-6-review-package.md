# Task 1.6 Review Package

## Commit
- Range: `6ff6920..89eb90f`
- Subject: `feat(web): surface per-row skip reasons in import preview`
- Stat: 3 files, +25/-4

## Files

- `apps/web/src/app/api/import/route.ts` — added `skippedReasons` (capped 50) and `skippedReasonsTruncated` to preview response totals.
- `apps/web/src/app/import/page.tsx` — added `SkippedReason` import; extended `PreviewTotals` interface; replaced skipped-rows text with `<details>` disclosure panel.
- `apps/web/src/server/ai-import.ts:167` — added `skippedReasons: []` to `validateAiExtraction` return literal (third invariant-violation fix in this slice).

## Sample diff (page.tsx)

```tsx
<details className="text-muted-foreground">
  <summary className="cursor-pointer">
    · {preview.totals.skippedRows} rows skipped — {preview.totals.skippedReasons.length} detailed
  </summary>
  <ul className="ml-4 mt-1 list-disc">
    {preview.totals.skippedReasons.slice(0, 5).map((reason, idx) => (
      <li key={idx}>row {reason.row ?? "?"} — {reason.reason}</li>
    ))}
    {preview.totals.skippedRows > 5 && (
      <li>and {preview.totals.skippedRows - 5} more</li>
    )}
    {preview.totals.skippedReasonsTruncated && (
      <li>showing the first 50 of {preview.totals.skippedRows} skip reasons</li>
    )}
  </ul>
</details>
```

## Implementer report path

`.superpowers/sdd/task-1-6-report.md`

## Typecheck state

`pnpm typecheck` (web) → expected clean.

## Global constraints

- TypeScript strict. ✓
- No new dependencies. ✓