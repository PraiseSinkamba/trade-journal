# Task 1.1 Review Package

## Commit
- Range: `491cfd1..5a1f0c7`
- Subject: `feat(importers): surface per-row skip reasons on ParsedImport`
- Author: Malumbo <malumbo@chrilantech.com>

## Stat
```
 packages/importers/src/types.ts | 9 +++++++++
 1 file changed, 9 insertions(+)
```

## Diff

```diff
diff --git a/packages/importers/src/types.ts b/packages/importers/src/types.ts
index 938b5d1..d2d6676 100644
--- a/packages/importers/src/types.ts
+++ b/packages/importers/src/types.ts
@@ -42,11 +42,20 @@
   assetClass?: AssetClass;
 }

+export interface SkippedReason {
+  /** 1-based row number in the parsed file, or null when the row index is unknown. */
+  row: number | null;
+  /** Human-readable, parser-internals-free explanation. */
+  reason: string;
+}
+
 export interface ParsedImport {
   format: string;
   executions: ImportedExecution[];
   /** Rows the parser saw but could not turn into executions. */
   skippedRows: number;
+  /** Per-row reasons the parser dropped a row. Length equals skippedRows. */
+  skippedReasons: SkippedReason[];
   warnings: string[];
   /** Missing source facts or malformed/truncated input block a commit. */
   errors?: string[];
```

## Plan section implemented

```markdown
### Task 1.1: Add `SkippedReason` to `ParsedImport`

**Files:**
- Modify: `packages/importers/src/types.ts:49`

**Produces:**
export interface SkippedReason {
  row: number | null;
  reason: string;
}

- [ ] **Step 1: Add the type and field**

Add SkippedReason above ParsedImport, add skippedReasons: SkippedReason[] to ParsedImport.

- [ ] **Step 2: Confirm downstream literals compile**

detect.ts has no ParsedImport literals; no edits there.

- [ ] **Step 3: Commit**
git commit -m "feat(importers): surface per-row skip reasons on ParsedImport"
```

## Implementer report path

`.superpowers/sdd/task-1-1-report.md`

## Global constraints (verbatim)

- TypeScript strict, ESM.
- `packages/importers` purity: no `fetch`/`axios`/`http.*`, no `apps/web` imports.
- No new dependencies.
- Human-facing strings only — no parser internals in reason text.
- One commit per task.

## Expected typecheck state

`types.ts` compiles. 8 downstream files fail typecheck — this is expected (Tasks 1.2-1.4 will fix).