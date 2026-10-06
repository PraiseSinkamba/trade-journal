# Task 1.6 Report: Surface reasons in API and import page

## Files modified

### `apps/web/src/app/api/import/route.ts`
Added `skippedReasons` (capped at 50) and `skippedReasonsTruncated` flag to the preview `totals` response:

```ts
totals: {
  ...
  skippedRows: parsed.skippedRows,
  skippedReasons: (parsed.skippedReasons ?? []).slice(0, 50),
  skippedReasonsTruncated: (parsed.skippedReasons?.length ?? 0) > 50,
  ...
}
```

### `apps/web/src/app/import/page.tsx`
- Added `import type { SkippedReason } from "@luxalgo/journal-importers";`
- Extended `PreviewTotals` interface with `skippedReasons: SkippedReason[]` and `skippedReasonsTruncated: boolean`
- Replaced the plain skipped-rows `<span>` with a `<details>/<summary>` disclosure panel showing up to 5 reasons inline with row numbers

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

## Smoke check
`pnpm dev` not run (smoke check is manual per plan). TypeScript compiles cleanly — `SkippedReason` is exported from `@luxalgo/journal-importers/src/types.ts` and `parsed.skippedReasons` was added to `ParsedImport` in Task 1.1.

## Commit
```
a6c35a9 feat(web): surface per-row skip reasons in import preview
```

## Typecheck issue fixed
`apps/web/src/server/ai-import.ts:167` — `validateAiExtraction` return literal was missing `skippedReasons: []`. Fixed and folded into the same commit.

## Commit
```
89eb90f feat(web): surface per-row skip reasons in import preview
```

## Concerns
None.
