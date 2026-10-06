# Task 2.1 Report — Refute-and-remap affordance

## Files modified

### `apps/web/src/app/import/page.tsx`
- Added `showManualMapper` state (line 150)
- Gate totals block: `{!showManualMapper && preview && !preview.needsMapping && preview.totals && (` — hides the detected-format summary when user clicks refute
- Gate mapper block: `{preview && (showManualMapper || preview.needsMapping) && preview.headers && (` — shows mapper when user clicks refute OR when auto-detect needs mapping
- Refute link inserted after the format `Badge`:
  ```tsx
  {preview.detected !== "ninjatrader" && !preview.aiPreviewToken && (
    <button
      className="text-xs text-muted-foreground underline hover:text-foreground"
      onClick={() => {
        setShowManualMapper(true);
        setMappingApplied(false);
        setError(null);
      }}
    >
      Wrong format? Map columns manually
    </button>
  )}
  ```
- `showManualMapper` reset in `onFile()` (new file selection) and `invalidateAiPreview()` (AI settings change)

### `apps/web/tests/import/import-page-preview.test.tsx`
- New test file (impractical to run — see below)

## Component test: impractical

`@testing-library/react` is not a dependency of `apps/web` (only `@types/react` is present). All existing `apps/web` tests are API-level integration tests using `await import()` against route handlers with a temp SQLite scratch dir. No browser rendering tests exist in this workspace. Skipped per plan guidance.

## Commit

```
a62cf2f feat(web): add refute-and-remap affordance to import preview
```

## Concerns

- The `button` element used for the refute link is bare (no `Button` component variant) to keep it visually inline with the badge/text flow. Could swap for a ghost `Button size="sm"` if a heavier visual weight is preferred.
- The test file is committed as a scaffold. It would run with `vitest` once `@testing-library/react` is added to `apps/web` devDependencies — no code changes needed in the test itself.
