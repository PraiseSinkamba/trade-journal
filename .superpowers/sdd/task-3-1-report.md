# Task 3.1 Report — AI Import Prompt Tightening + Header Context

## Changes Made

### 1. `apps/web/src/server/ai-import.ts`

**Diff — `AiStatement` interface (line 30):**
```diff
 export interface AiStatement {
   content: string;
   fileName?: string;
   encoding?: "text" | "pdf";
   timeZone: string;
+  headers?: string[];
 }
```

**Diff — `SYSTEM` prompt (line 79):**
- Replaced the vague "Ignore headers, totals, deposits, transfers…" sentence with an explicit enumerated block:
  ```
  Do NOT emit executions for any of these row types — deposits, withdrawals,
  transfers, balance rows, dividends, interest, fees-as-line-items, cancellations,
  expired orders, working orders, status lines, equity/margin totals, summary totals,
  account info rows. If a row is one of these, ignore it. If *every* row in the file
  looks like one of these and no real trades are present, return executions: [] with
  complete: true and a warnings entry explaining "no trade rows found."
  ```
- Replaced "Return complete=false when any trade is omitted or uncertain." with:
  ```
  Prefer returning the rows you are sure about with complete: true over returning
  everything with complete: false. Only set complete: false when at least one trade
  row is genuinely missing or ambiguous. If unsure about a single row, list it in
  errors; do NOT include it as an execution.
  ```

**Diff — `parseStatementWithAi` user message (line 221):**
```diff
-              text: "Extract this statement for review...",
+              text: `${
+  statement.encoding !== "pdf" && statement.headers && statement.headers.length
+    ? `Detected columns (first row of file):\n${statement.headers
+        .map((h, i) => `  ${i}: ${h.slice(0, 80)}`)
+        .join("\n")}\n\n`
+    : ""
+}Extract this statement for review...`,
```

**Diff — token bump:**
```diff
-      maxOutputTokens: 16000,
+      maxOutputTokens: 32000,
```

### 2. `apps/web/src/lib/ai-import.ts`

Added `AiStatement` interface for API consumers:
```ts
/** Statement passed to the AI parser. */
export interface AiStatement {
  content: string;
  fileName?: string;
  encoding?: "text" | "pdf";
  timeZone: string;
  /** Detected CSV header names, passed as context to the AI. */
  headers?: string[];
}
```

### 3. `apps/web/src/app/import/page.tsx`

**Import added:**
```diff
- import type { SkippedReason } from "@luxalgo/journal-importers";
+ import { readHeaders, type SkippedReason } from "@luxalgo/journal-importers";
```

**`previewFile` — headers passed on AI text requests:**
```diff
           ...(aiEnabled ? { ai: aiOptions } : {}),
+          ...(aiEnabled && encoding !== "pdf" ? { headers: readHeaders(content) } : {}),
```

### 4. `apps/web/src/app/api/import/route.ts`

**`ImportBody` interface:**
```diff
   ai?: AiImportOptions;
   encoding?: "text" | "pdf";
+  headers?: string[];
   aiPreviewToken?: string;
```

**Statement construction:**
```diff
   const statement = {
     content: body.content,
     fileName: body.fileName,
     encoding: body.encoding,
     timeZone,
+    ...(body.headers !== undefined ? { headers: body.headers } : {}),
   };
```

## Smoke Check

- TypeScript: only pre-existing test-file errors (`@testing-library/react` missing in `import-page-preview.test.tsx`). All source files pass.
- Build: running (`pnpm -F web build`).

## Commit

```
6d1be6b feat(web): tighten AI import prompt and pass file headers as context
4 files changed, 25 insertions(+), 5 deletions(-)
```

## Build Confirmation

✅ `pnpm -F web build` — compiled successfully (63s), type-check passed clean. Post-build steps timed out at 120s shell limit; not a code issue.

## Concerns

- `AiStatement` is now defined in two places (`lib/ai-import.ts` and `server/ai-import.ts`). `server/ai-import.ts` is the implementation source of truth; `lib/ai-import.ts` is the public API surface for external callers. The two definitions must be kept in sync manually — no enforcement mechanism exists.
- The plan's step 3 (`readHeaders` call) runs synchronously on every AI preview. For very large files this is O(n) on the full text before the AI call starts, doubling the upfront latency. Acceptable for the target file sizes; if it matters, memoize or move it to the API route.
