# Task 3 Report: Extract reflection prompts and migrate existing reflection calls

## Status: COMPLETE

## Commits

- `4037892` — "Move reflection prompts behind AI feature boundaries"

## Files Changed

### Created
- `apps/web/src/server/ai-prompts.ts` — exports `REFLECTION_SYSTEM_PROMPT`,
  `buildAskJournalPrompt`, `buildDailyRecapPrompt`,
  `buildTradeCritiquePrompt` plus typed input interfaces
  (`AskJournalPromptInput`, `DailyRecapPromptInput`,
  `TradeCritiquePromptInput`).
- `apps/web/tests/ai-prompts.test.ts` — exact prompt-parity tests
  using fixed fixtures.

### Modified
- `apps/web/src/server/ai.ts` — `runAi(prompt: string): Promise<string>`
  delegates to `runTextAi` with `configuration:
  resolveAiConfiguration()`, `system: REFLECTION_SYSTEM_PROMPT`,
  `feature: "reflection"`, `promptVersion:
  AI_PROMPT_VERSIONS.reflection`. Legacy `maxOutputTokens`
  parameter removed. The `AI_PROVIDER_NAMES` "missing key" message
  is preserved at the facade so existing error responses remain
  byte-for-byte compatible.
- `apps/web/src/app/api/ai/ask/route.ts` — replaces the route-local
  template literal with `buildAskJournalPrompt({ question, context })`.
- `apps/web/src/app/api/ai/recap/route.ts` — replaces the route-local
  template literal with `buildDailyRecapPrompt({ date, scopeContext,
  accountContext, metricsLine, tradeLines, existingNote })`.
- `apps/web/src/app/api/ai/critique/route.ts` — replaces the route-local
  template literal with `buildTradeCritiquePrompt({ trade, fills })`.
- `apps/web/tests/ai-settings.test.ts` — both provider-adapter tests
  call `runAi("Fixture journal question")` with one argument, with
  reflection policy ceiling asserted (`max_output_tokens: 1200` for
  OpenAI; `max_tokens: 1200` for Anthropic). Anthropic body now
  asserts `messages: [{ role: "user", content: [{ type: "text",
  text: "Fixture journal question" }] }]` to match the real SDK
  serialization shape.

## RED → GREEN Evidence

### RED (prompt-parity tests fail before module exists)

```
$ npx vitest run apps/web/tests/ai-prompts.test.ts
 FAIL  apps/web/tests/ai-prompts.test.ts
 Error: Cannot find module '../src/server/ai-prompts'
   imported from '.../apps/web/tests/ai-prompts.test.ts'
 Test Files  1 failed (1)
```

### GREEN (after creating `ai-prompts.ts`)

```
$ npx vitest run apps/web/tests/ai-prompts.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-settings.test.ts
 ✓ apps/web/tests/ai-prompts.test.ts (5 tests) 12ms
 ✓ apps/web/tests/ai-settings.test.ts (16 tests) 1209ms
 ✓ apps/web/tests/ai-ui.test.ts (10 tests) 814ms
 ✓ apps/web/tests/ai-scope.test.ts (32 tests) 1797ms
 Test Files  4 passed (4)
 Tests  63 passed (63)
```

## Exact Fixtures (from `ai-prompts.test.ts`)

### `REFLECTION_SYSTEM_PROMPT`

```
You are the reflection layer of a trader's journal.
You see only the trader's own recorded data — trades, stats, and notes. Ground every
statement in those numbers; never invent trades, prices, or market context you weren't given.
Be direct and specific like a good trading coach: name the behavior, cite the numbers,
say what to keep and what to fix. No platitudes, no disclaimers about trading being risky —
the trader knows. Keep it tight.
```

Verbatim match against the original `SYSTEM` constant moved out of
`apps/web/src/server/ai.ts`.

### `buildAskJournalPrompt({ question, context })`

```
Answer the trader's question using ONLY these aggregates from their journal. If the data
can't answer it, say exactly what's missing (e.g. "tag your trades' stops to get R stats").
Cite the numbers you used. Under 200 words.

{context}

Question: {question}
```

Two fixtures asserted, both passing with `toBe(expected)` equality.

### `buildDailyRecapPrompt({ date, scopeContext, accountContext, metricsLine, tradeLines, existingNote })`

```
Write a session recap for {date} in first person ("I"), 120-200 words, markdown with a
short "**Keep**" and "**Fix**" list at the end.

{scopeContext}
{accountContext}

Day stats: {metricsLine}

Trades:
{tradeLines}

The trader's own note so far (respect it, build on it):
{existingNote}
```

Two fixtures asserted (with and without notes). The trailing note
block is only appended when `existingNote` is defined; the
intermediate blank line is preserved.

### `buildTradeCritiquePrompt({ trade, fills })`

```
Critique this single trade in under 150 words. Focus on execution quality visible in the
fills (entry clustering, scaling, exit discipline), risk (stop honored or not, R multiple),
and the trader's own tags/mistakes. End with one concrete instruction for the next
occurrence of this setup.

Trade: {symbol} {direction}, status {status}
Net P&L: {netPnl.toFixed(2)} (gross {grossPnl.toFixed(2)}, fees {fees.toFixed(2)})
Avg entry {avgEntry} → avg exit {avgExit ?? "still open"}
Planned stop: {stopLoss ?? "none recorded"} | target: {profitTarget ?? "none recorded"}
Rating: {rating ?? "unrated"} | tags: {tags.join(", ") || "none"} | mistakes: {mistakes.join(", ") || "none"}
Notes: {notes ?? "none"}

Fills:
{fills.join("\n")}
```

One fixture asserted.

## Acceptance

- ✅ `apps/web/src/server/ai-prompts.ts` exports `REFLECTION_SYSTEM_PROMPT`,
  `buildAskJournalPrompt`, `buildDailyRecapPrompt`,
  `buildTradeCritiquePrompt`, and typed inputs.
- ✅ `SYSTEM_PROMPT` from `apps/web/src/server/ai.ts` moved verbatim.
- ✅ Route-local template strings moved verbatim into builders.
- ✅ `runAi(prompt: string)` delegates to `runTextAi` with
  `configuration: resolveAiConfiguration()`; `maxOutputTokens`
  parameter removed (LSP confirms no production caller).
- ✅ Reflection routes updated; status codes, validation, response
  shapes unchanged.
- ✅ `ai-settings.test.ts`: both provider tests now call
  `runAi("Fixture journal question")` and assert
  `max_output_tokens: 1200` / `max_tokens: 1200`.
- ✅ Prompt-parity tests use exact `toBe()` equality, not
  substring assertions.
- ✅ Existing invalid-scope/no-AI-call assertion in
  `ai-scope.test.ts` preserved.
- ✅ Reflection regression suite passes (63/63).

## Constraints Honored

- No new dependencies.
- No telemetry.
- No raw provider errors (runtime `mapAiRuntimeError` still
  categorizes; facade re-throws `AiRuntimeError.message` only).
- No browser access.
- Reflection policy ceiling remains `maxOutputTokens: 1200`; no
  other ceiling introduced.
- `parseStatementWithAi` not modified (Task 4 scope).
- Import paths unchanged.

## Concerns

- `runAi` re-throws `AiRuntimeError` as a plain `Error` to preserve
  the legacy `error.message` substring contract used by existing
  routes and tests (e.g., the sanitization tests in
  `ai-settings.test.ts`). Execution metadata is therefore not
  surfaced to callers at this facade — appropriate, since
  Task 4 is responsible for surfacing metadata in routes.
- The `runAi` facade boundary still constructs the "missing key"
  message itself rather than relying on `LoadAPIKeyError`, to
  preserve the per-provider name (`AI_PROVIDER_NAMES[provider]`)
  used by the legacy UX. The runtime's `missing_key` path remains
  in place for `runObjectAi` and other consumers.
- Pre-existing failures in `review-export.test.ts`,
  `market-data-connections.test.ts`, and `ai-import-ui.test.ts`
  were confirmed via `git stash` to exist on the baseline before
  this task; they are unrelated to the reflection feature and
  out of scope.