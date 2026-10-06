# Task 1.6 Fix Report

## Diff

```diff
- {preview.totals.skippedRows > 5 && (
-   <li>and {preview.totals.skippedRows - 5} more</li>
+ {preview.totals.skippedReasons.length > 5 && (
+   <li>and {preview.totals.skippedReasons.length - 5} more</li>
  )}
```

## Typecheck

```
pnpm tsc --noEmit ✓ (0 errors)
```

## Commit

```
4119314 fix(import): count 'more' from skippedReasons.length not skippedRows
```
