# Final Review Fix Report

## C1 (CRITICAL) — `filterByStatus` invariant violation
**Status:** ✅ FIXED
**File:** `packages/importers/src/history/adapters/generic.ts`
**Commit:** `filterByStatus: push one skippedReason per filtered row`

`skippedReasons.length === skipped` is now guaranteed. Per-row reasons are pushed
inside the loop; the aggregate `issues.push(...)` summary remains (user-facing
signal) but no longer duplicates reasons into the array.

```diff
-      skipped++;
-      continue;
+      skipped++;
+      skippedReasons.push({
+        row: null,
+        reason: "row with a non-filled status was ignored",
+      });
+      continue;
```
```diff
-  if (skipped > 0) {
-    issues.push(issue(...));
-    skippedReasons.push({ row: null, reason: issues[issues.length - 1]!.message });
-  }
+  if (skipped > 0) {
+    issues.push(issue(...));
+  }
```

---

## I2 (IMPORTANT) — `filterByStatus` fragility
**Status:** ✅ FIXED (same commit as C1)
**File:** `packages/importers/src/history/adapters/generic.ts`

Added JSDoc on `filterByStatus`:
```ts
/**
 * Drop rows whose status column marks them as never-filled.
 * Per-row skip reasons are pushed inside the loop so skippedReasons.length === skipped.
 */
```

---

## M1 (MINOR) — IBKR discriminator wording
**Status:** ✅ FIXED
**File:** `packages/importers/src/formats/ibkr.ts`
**Commit:** `ibkr: improve skipped-row reason text`

```diff
- reason: "row was not an Order fill (skipped discriminator)"
+ reason: "row was not a filled order"
```

---

## I1 (IMPORTANT) — Test coverage gap
**Status:** ⚠️ DEFERRED
**File:** `apps/web/tests/import/import-page-preview.test.tsx`

`@testing-library/react` is NOT in `apps/web/package.json` devDependencies — the
test file cannot run as-is. Adding the test case would require adding the
dependency (and likely `vitest` config adjustments). That decision belongs to
the implementer or project lead. Skipping per instructions.

---

## Typecheck

```
$ npx tsc --noEmit -p packages/importers/tsconfig.json
(no output — clean)
```

---

## Deferred (M2, M3, M4)

- **M2** — IBKR parse path latent concern (not mechanically actionable)
- **M3** — Doc concern (not mechanically actionable)
- **M4** — Latent concern (not mechanically actionable)

These are not fixable without scope expansion or new requirements.
