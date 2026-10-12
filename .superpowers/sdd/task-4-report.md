# Task 4 Report: Migrate structured statement parsing without changing its safety protocol

## Status: COMPLETE

## Commits

- (pending) — "Keep AI import credentials on the server"

## Files Changed

### Modified
- `apps/web/src/server/ai-import.ts` — `parseStatementWithAi` now
  accepts only `(statement, signal?)`. Provider, model, and key are
  resolved via `resolveAiConfiguration()`. The `requireValue(apiKey, ...)`
  guard now uses `AI_PROVIDER_NAMES[provider]` to produce the safe
  user-facing "Add your {Provider} API key in Settings" message. The
  direct `generateText` call is replaced with `runObjectAi({ feature:
  "statementImport", configuration, promptVersion, system, messages,
  output, abortSignal })`. The `AbortSignal.any([signal,
  AbortSignal.timeout(120_000)])` composition is preserved verbatim.
  The non-`stop` finish-reason check was moved outside the try/catch
  so the "AI response was incomplete" message survives into the route
  response. `AiRuntimeError` is mapped to its `error.message` at the
  module boundary; other failures fall back to the legacy safe
  "AI parsing failed or returned an incomplete response" message.
  The `finally` cleanup was intentionally not added because
  `AbortSignal.timeout(...)` exposes no clearable handle.
- `apps/web/src/app/api/import/route.ts` — `ImportBody.ai` is now
  `boolean` (intent only). Validation rejects anything other than
  `undefined | true` with "AI parsing flag must be a boolean." The
  call site is now `parseStatementWithAi(statement, request.signal)`.
- `apps/web/src/app/import/page.tsx` — removed `aiOptions` state,
  removed API-key/model/provider selector from the import surface.
  The AI-preview control is only rendered when Settings reports the
  selected provider as configured. Otherwise a Settings link is
  rendered (e.g. "Add your OpenAI API key in Settings to parse with
  AI."). Both the preview and commit request bodies now send
  `ai: true` — never a key, provider, or model.
- `apps/web/src/components/ai-import-options.tsx` — replaced the
  Popover-based `AiImportOptions` with a minimal `AiImportToggle`
  (checkbox + provider label + help hint). The browser never sees a
  key, model, or provider field.
- `apps/web/tests/ai-import.test.ts` — replaced the
  `vi.mock("ai", generateText)` seam with a `mockRunObjectAi` seam
  that targets the runtime. Tests now:
  - assert the import request never serializes `apiKey`, `provider`,
    or `model`;
  - assert the runtime receives `feature: "statementImport"`,
    `promptVersion: "statement-import-v1"`, `output`, and an
    `AbortSignal`;
  - assert the safe configuration error when no saved/environment
    key is configured (defaults to "Add your OpenAI API key in
    Settings" once `aiProvider` is set);
  - assert that wiping a saved key via Settings causes the next
    preview to return 400 without ever calling the runtime;
  - assert that the `finishReason !== "stop"` path throws
    "AI response was incomplete";
  - preserve the no-AI-call-on-commit and zero-fee preservation
    assertions;
  - preserve the empty result, multiple accounts, malformed
    execution values, duplicate fills, missing source references,
    text-limit-exceeded, and PDF file-input assertions.
- `apps/web/tests/ai-import-ui.test.ts` — updated to the new UI
  contract: when Settings reports an unconfigured selected provider,
  the AI checkbox is not rendered and a Settings link is shown
  instead. The preview and commit request bodies are asserted to
  contain only `ai: true` — never `apiKey`, `provider`, or `model`.
  Pre-existing fragility with the test mock's `setDefault` PATCH
  call (returning `undefined`, which has no `.catch()`) was fixed
  by making the `postJson` mock return a resolved promise.

### Not Modified
- `apps/web/src/server/ai-runtime.ts` — covered by Task 2.
- `apps/web/src/server/ai-contracts.ts` — covered by Task 1.
- `apps/web/src/server/ai.ts` — covered by Task 3.
- `apps/web/src/server/ai-prompts.ts` — covered by Task 3.

## RED → GREEN Evidence

### RED (failing tests against the old generateText seam)

The original `ai-import.test.ts` mocked `generateText`. After updating
to the new contract (mock `runObjectAi`, expect `ai: true` in the
request body, expect the runtime invocation shape), the test suite
returned:

```
RUN  v3.2.7 E:/4004/orca/trade-journal
❯ apps/web/tests/ai-import.test.ts (19 tests | 7 failed) 259ms
  ✓ keeps native parsing local and unchanged when AI is off
  × uses the selected provider key from Settings and sends the import through the runtime
  × never serializes apiKey, provider, or model in the import request body
  × returns the safe configuration error when no saved or environment key is configured
  × commits exactly the reviewed result without calling AI again and preserves zero fees
  × does not send an upload without a key, or when it exceeds the text limit
  × sends PDF bytes as a file input
  × rejects non-stop finish reasons with the existing incomplete-response message
  … 11 other tests passing
```

The `ai-import-ui.test.ts` tests also failed because the request body
shape (`ai: { provider, model, apiKey }`) and the rendered
`#ai-import-enabled` checkbox no longer exist.

### GREEN (after migrating `parseStatementWithAi` to the runtime)

```
RUN  v3.2.7 E:/4004/orca/trade-journal
✓ apps/web/tests/ai-runtime.test.ts (18 tests) 57ms
✓ apps/web/tests/ai-import.test.ts (19 tests) 657ms
✓ apps/web/tests/ai-import-ui.test.ts (2 tests) 518ms
Test Files  3 passed (3)
Tests       39 passed (39)
```

Related AI/regression suites also continue to pass:

```
$ npx vitest run apps/web/tests/ai-settings.test.ts apps/web/tests/ai-prompts.test.ts \
>                  apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts \
>                  apps/web/tests/ai-feedback.test.ts
✓ apps/web/tests/ai-feedback.test.ts (7 tests) 17ms
✓ apps/web/tests/ai-prompts.test.ts (5 tests) 10ms
✓ apps/web/tests/ai-settings.test.ts (16 tests) 697ms
✓ apps/web/tests/ai-scope.test.ts (32 tests) 1716ms
✓ apps/web/tests/ai-ui.test.ts (10 tests) 514ms
Test Files  5 passed (5)
Tests       70 passed (70)
```

```
$ npx vitest run apps/web/tests/import-account.test.ts \
>                  apps/web/tests/import-formats-regression.test.ts \
>                  apps/web/tests/ninjatrader-import.test.ts
✓ apps/web/tests/import-account.test.ts (1 test) 99ms
✓ apps/web/tests/import-formats-regression.test.ts (14 tests) 564ms
✓ apps/web/tests/ninjatrader-import.test.ts (10 tests) 1051ms
Test Files  3 passed (3)
Tests       25 passed (25)
```

## Runtime Invocation Shape

`parseStatementWithAi` now calls the runtime with:

```ts
runObjectAi({
  feature: "statementImport",
  configuration: {
    provider: configuration.provider,
    modelId: configuration.modelId,
    apiKey: configuration.apiKey,
  },
  promptVersion: AI_PROMPT_VERSIONS.statementImport,
  system: SYSTEM,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: detectedColumnPrefixAndInstruction },
        ...input,
      ],
    },
  ],
  output: Output.object({ schema }),
  abortSignal: signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000),
});
```

`AI_FEATURE_POLICIES.statementImport` provides
`maxRetries: 0, maxOutputTokens: 32_000, timeoutMs: 120_000` — the
runtime applies these so the import path stays deterministic and
non-retrying. The non-`stop` finish-reason check is performed
immediately after the runtime call so the "AI response was incomplete"
message propagates out of the function (it would otherwise be
swallowed by the surrounding `try/catch` that exists to map provider
errors to safe user-facing text).

## Acceptance

- ✅ `parseStatementWithAi(statement, signal?)` signature — caller no
  longer supplies provider/model/key.
- ✅ `runObjectAi` invoked with `feature: "statementImport"`,
  server-only configuration, `promptVersion:
  AI_PROMPT_VERSIONS.statementImport`, the existing `SYSTEM` prompt,
  the existing messages payload, `Output.object({ schema })`, and the
  `AbortSignal.any([signal, AbortSignal.timeout(120_000)])`
  composition.
- ✅ Non-`stop` finish reason rejected with "AI response was
  incomplete" before `validateAiExtraction`.
- ✅ `AiRuntimeError` mapped to a plain `Error` carrying the
  runtime's safe user-facing message.
- ✅ Import route accepts only `ai: true | undefined`; rejects
  non-boolean values with a clear 400.
- ✅ Import page: API-key input, model field, and provider selector
  removed. The AI-preview toggle is rendered only when Settings
  reports the selected provider as configured; otherwise a Settings
  link is rendered.
- ✅ Tests assert no `apiKey`/`provider`/`model` in import request
  body, safe configuration error on missing key, runtime
  invocation shape, `finishReason !== "stop"` rejection, and
  preserved no-model-call-on-commit.
- ✅ `AbortSignal.timeout(...)` is the timeout; no `finally` cleanup
  added.
- ✅ Existing import safety assertions (empty result, multiple
  accounts, malformed executions, duplicate fills, missing source
  references, text limit, PDF file input) preserved.

## Constraints Honored

- No new dependencies.
- No telemetry.
- No raw provider errors — `AiRuntimeError.message` is the only
  string surfaced from the runtime, and the fallback message never
  includes provider response text.
- No browser access to API keys, model IDs, or provider IDs — the
  preview/commit request bodies only carry `ai: true`.
- PDF and text message payload preserved.
- 120-second timeout preserved.
- Zero retries preserved (runtime policy).
- Deterministic validation preserved (`validateAiExtraction`
  unchanged).
- Human-review gate preserved (commit still requires
  `aiPreviewToken` and `aiReviewed === true`).
- `AbortSignal.timeout(...)` retained with no `finally` cleanup
  (no clearable handle).

## Concerns

- **Typecheck noise:** `pnpm typecheck` still reports a pre-existing
  error in `apps/web/src/app/api/ai/critique/route.ts(28,9)` — a
  `number | undefined` to `number | null` mismatch that exists on
  the baseline before this task and is unrelated to the import
  refactor. Confirmed via `git stash`.
- **Pre-existing test fragility:** `ai-import-ui.test.ts` was
  already failing on the baseline before this task (confirmed via
  `git stash`); the failing test attempted to assert on
  `mock.calls[1]` while `setDefault` was inserting a PATCH on
  `/api/settings` between the preview and commit calls. The test
  was updated to locate the preview/commit by `mode` discriminator
  rather than by call index, which both makes it correct for the
  new contract and incidentally fixes the pre-existing brittleness.
- **Default `aiProvider`:** the test setup now explicitly sets
  `aiProvider: "openai"` (via `setSetting("aiProvider", "openai")`)
  in cases that assert the OpenAI safe-error message. Without
  that, the default is Anthropic and the message would say
  "Anthropic" — also correct, but the brief's example uses OpenAI
  in its expectations.
