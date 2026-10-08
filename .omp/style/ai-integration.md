# AI Integration Style Guide

Authoring AI features in `apps/web/src/server/ai*.ts`. Self-hosted BYO-key model — keys are encrypted at rest, never committed to source. The current AI surface in this repository is the **server-only execution foundation** shipped by `docs/superpowers/plans/2026-10-08-ai-foundation-refactor.md`; assistant sessions, tools, draft cards, and side-sheet UI are intentionally out of scope and are described in `## Future assistant/UI/tool architecture` below. Treat that section as a design preview, not as code that exists today.

---

## Current requirements (enforced by the foundation)

These items are implemented by `apps/web/src/server/ai-runtime.ts`, `ai-contracts.ts`, `ai-prompts.ts`, and `settings.ts`. They must remain true for every new AI feature.

### Key Management — server-only BYO-key

Provider keys are resolved **only** on the server through `resolveAiConfiguration()` in `apps/web/src/server/settings.ts`. The runtime never accepts a key, model, or provider from the client. Encrypted-at-rest storage and `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env overrides are preserved. Env vars are never persisted.

```ts
// apps/web/src/server/settings.ts — server-only resolver
export const resolveAiConfiguration = (): {
  provider: AiProvider;
  modelId: string;
  apiKey: string | null;
} => { … };
```

Never log the key, a key fragment, or the decrypted key. Log the provider name and a hash of the key if needed for debugging.

### Provider isolation at the adapter boundary

OpenAI `store: false` and any other provider-specific options live in `apps/web/src/server/ai-runtime.ts`. Feature routes and prompt builders stay provider-neutral. The closed `AiFeature` union in `apps/web/src/server/ai-contracts.ts` prevents unreviewed features from inheriting unsafe defaults.

### Feature policy and prompt versions

Every feature declares its policy in `AI_FEATURE_POLICIES` and its prompt version in `AI_PROMPT_VERSIONS` (in `ai-contracts.ts`). The runtime applies `maxOutputTokens`, `maxRetries`, and `timeoutMs`; `statementImport` is `maxRetries: 0` and time-bounded at 120 seconds. New features must add a typed entry to both maps before any code calls the runtime.

### Prompt location

Prompts are authored in `apps/web/src/server/ai-prompts.ts` (or a dedicated `ai-<feature>.ts` file per feature). The reflection system prompt is exported as `REFLECTION_SYSTEM_PROMPT`; feature-specific builders (`buildAskJournalPrompt`, `buildDailyRecapPrompt`, `buildTradeCritiquePrompt`) consume only typed route-derived data and never query the database or read settings. **Do not embed prompts in route handlers.**

```ts
// apps/web/src/server/ai-prompts.ts — typed builders
export const REFLECTION_SYSTEM_PROMPT = `…` as const;
export const buildAskJournalPrompt = (input: AskJournalPromptInput): string => `…`;
// ai.ts — consume the prompt
const { output, meta } = await runTextAi({
  feature: "reflection",
  configuration: resolveAiConfiguration(),
  promptVersion: AI_PROMPT_VERSIONS.reflection,
  system: REFLECTION_SYSTEM_PROMPT,
  prompt: buildAskJournalPrompt({ question, context }),
});
```

### Runtime invocation shape

Routes and adapters call the runtime; they never call the Vercel AI SDK directly. `runTextAi` returns `{ output: string, meta: AiExecutionMeta }`; `runObjectAi` returns `{ output: T, meta: AiExecutionMeta }` for structured extraction. The runtime sets the provider options, policy, timeout, and error mapping. Pass `AbortSignal.timeout(...)` (composed with the request signal via `AbortSignal.any`) for bounded features.

### Error Translation — `AiRuntimeError`

The runtime maps provider errors into plain-language categories via `AiRuntimeError`. **Never propagate raw provider payloads to the client.** Categories map to UI-facing notices; the client does not see `status: 429` or `error.type: 'rate_limit_error'`.

```ts
// apps/web/src/server/ai-contracts.ts
export class AiRuntimeError extends Error {
  constructor(
    public readonly kind:
      | "missing_key"
      | "authentication"
      | "billing"
      | "rate_limited"
      | "model_unavailable"
      | "timeout"
      | "provider",
    message: string,
  ) {
    super(message);
  }
}
```

### Output Schema — Typed Result

Every AI feature returns a typed result object. **Never return free-form text that the UI must parse.** Structured extraction (e.g. statement import) uses `runObjectAi` with a `Output.object({ schema })` declaration; reflection returns the typed `string` from `runTextAi`.

### Redacted execution metadata

`AiExecutionMeta` is the only metadata surfaced to server callers: feature ID, provider, model ID, prompt version, duration, finish reason, input/output tokens, retry count. Prompt text, response text, and key material must never appear in metadata, logs, drafts, or traces.

### Import safety

Import is the existing extraction → validation → human review → commit workflow. The import request body is now `{ ai: true }` only; the preview endpoint resolves credentials on the server, and the commit endpoint must not call a model. The 120-second `AbortSignal.timeout(...)` and zero-retry policy are preserved.

---

## Future assistant/UI/tool architecture (not implemented)

The contextual assistant, scoped sessions, action/draft cards, side-sheet UI, and bounded read-only tools in `docs/superpowers/specs/2026-10-08-contextual-ai-workspace-design.md` are a future design, not current code. They will land in a separate plan and must re-validate the current requirements above. Specifically, the future architecture will need:

- **Streaming** responses with `ReadableStream`, backpressure, and per-chunk cancellation. Abort the underlying request on client disconnect.
- **Per-request and session token budgets** read from the encrypted settings store (`maxTokens` per request, `sessionBudget` per session). Enforce a hard cap even when settings are misconfigured.
- **Caching keyed by** the feature input hash and `EDGE_SCORE_VERSION` (defined in `packages/core/src/scoring.ts`). Soft-evict under memory pressure.
- **Telemetry** as durable local operational events (feature ID, provider/model, prompt/agent version, duration, usage, retry count, finish reason, tool/step count) — never prompt/response content, never external analytics endpoints. Currently deferred.
- **Assistant capability tools** that resolve server-side scope and emit typed draft proposals only. The browser must never grant the agent wider account or record access.
- **Privacy-aware rendering** so assistant-rendered money, executions, fees, draft fields, and prose honor the journal privacy setting before DOM and accessibility-tree rendering, including clipboard actions.

These items are documented for design parity with the spec; do not introduce them until a follow-up plan adds the matching contracts, tests, and review.

---

## Logging

Log every AI call with:

```ts
logger.info("AI request", {
  feature: "reflection",
  provider: "anthropic",
  model: "claude-sonnet",
  promptVersion: AI_PROMPT_VERSIONS.reflection,
  durationMs: meta.durationMs,
  finishReason: meta.finishReason,
  inputTokens: meta.inputTokens,
  outputTokens: meta.outputTokens,
  maxRetries: meta.maxRetries,
});
```

**Never log** the prompt text, the model response, or any key-derived value. `AiExecutionMeta` is the only metadata that may be recorded.

---

## Cite

- `apps/web/src/server/ai-contracts.ts` — `AiFeature`, `AiExecutionPolicy`, `AI_FEATURE_POLICIES`, `AI_PROMPT_VERSIONS`, `AiExecutionMeta`, `AiRuntimeError`
- `apps/web/src/server/ai-runtime.ts` — `runTextAi`, `runObjectAi`, provider isolation, `store: false`, error mapping
- `apps/web/src/server/ai-prompts.ts` — `REFLECTION_SYSTEM_PROMPT`, `buildAskJournalPrompt`, `buildDailyRecapPrompt`, `buildTradeCritiquePrompt`
- `apps/web/src/server/ai.ts` — reflection facade delegating to the runtime
- `apps/web/src/server/ai-import.ts` — statement-import adapter delegating to `runObjectAi`
- `apps/web/src/server/settings.ts` — `resolveAiConfiguration`, encrypted key storage
- `docs/superpowers/specs/2026-10-08-contextual-ai-workspace-design.md` — future assistant/UI/tool design (not the current foundation)
- `docs/ai-scope.md` — account/filter scope and execution boundary

---

## Checklist before PR

- [ ] Keys are resolved only via `resolveAiConfiguration()`; no raw `process.env` access outside `settings.ts`; no key, model, or provider is read from the client
- [ ] All provider errors map to `AiRuntimeError` categories with safe user-facing messages; raw provider payload never reaches the client
- [ ] Prompts live in `ai-prompts.ts` or a dedicated `ai-<feature>.ts`; no embedded strings in route handlers
- [ ] Every new feature adds a typed entry to `AI_FEATURE_POLICIES` and `AI_PROMPT_VERSIONS` before calling the runtime
- [ ] Runtime invoked via `runTextAi` / `runObjectAi`; routes never call the Vercel AI SDK directly
- [ ] `maxRetries`, `maxOutputTokens`, and (for bounded features) `timeoutMs` come from policy, not from caller-supplied values
- [ ] Structured extraction uses `Output.object({ schema })`; reflection returns the typed `string` from `runTextAi`
- [ ] No agent session, tool, draft persistence, or assistant UI is introduced under "current requirements"
- [ ] AI calls log `feature + provider + model + promptVersion + durationMs + finishReason + tokens + retries`; no prompt/response/key in logs
- [ ] Import request body is `{ ai: true }` only; commit does not call a model; preview enforces the 120-second timeout
