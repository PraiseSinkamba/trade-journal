# AI Integration Style Guide

Authoring AI features in `apps/web/src/server/ai*.ts`. Self-hosted BYO-key model — keys are encrypted at rest, never committed to source.

---

## Key Management — BYO-key

AI provider keys live encrypted in the user settings store. The system supports `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` env vars as overrides for development — **env vars are never persisted** to the settings store.

```ts
// apps/web/src/server/settings.ts pattern
export function getEffectiveApiKey(provider: 'anthropic' | 'openai'): string | null {
  // Env var override (dev/test) — not stored
  if (process.env[`${provider.toUpperCase()}_API_KEY`]) {
    return process.env[`${provider.toUpperCase()}_API_KEY`];
  }
  // Encrypted key from settings store
  return decryptSetting(`ai_${provider}_key`);
}
```

**Never log** the key value, a key fragment, or the decrypted key. Log the provider name and a hash of the key if needed for debugging.

---

## Error Translation — `APICallError`

`runAi` in `apps/web/src/server/ai.ts` maps provider errors into plain-language categories via `APICallError`. **Never propagate raw provider payloads to the client.**

```ts
// apps/web/src/server/ai.ts — error mapping
export class APICallError extends Error {
  constructor(
    message: string,
    public readonly category: 'auth' | 'quota' | 'rate_limit' | 'upstream' | 'unknown',
  ) { super(message); }
}

// Client receives only category + message
const feedback = mapToUserFacing(result); // → { notice: string; severity: 'info' | 'warn' }
```

Categories map to UI-facing notices. The client does not receive `status: 429` or `error.type: 'rate_limit_error'` — it receives `notice: "AI critique is temporarily unavailable"` with `severity: 'warn'`.

---

## Prompt Location

Prompts are authored in `apps/web/src/server/ai-scope.ts` (or a dedicated `ai-*.ts` file per feature). **Do not embed prompts in route handlers.**

```ts
// ai-scope.ts
export const TRADE_CRITIQUE_PROMPT = `...` as const;
export const SESSION_RECAP_PROMPT = `...` as const;

// ai.ts — consume the prompt
const result = await runAi({
  prompt: TRADE_CRITIQUE_PROMPT,
  model: 'claude-sonnet',
  maxTokens: 1024,
});
```

This keeps prompts testable in isolation and versioned alongside the feature that uses them.

---

## Output Schema — Typed Result with Confidence

Every AI feature returns a typed result object. **Never return free-form text that the UI must parse.**

```ts
// ai-import.ts pattern
export interface ImportSuggestion {
  suggestedSymbol?: string;
  suggestedDirection?: 'buy' | 'sell';
  confidence: number;        // 0–1, absent if unavailable
  unavailable?: boolean;     // true → AI could not produce a useful result
  reason?: string;           // human-readable why, not a code
}

export async function suggestFromHistory(...) : Promise<ImportSuggestion> {
  // ...
}
```

UI components receive a typed `ImportSuggestion`. They do not inspect or parse raw model output.

---

## Streaming

When streaming is needed, use `ReadableStream` with proper backpressure and a cancellation check on each chunk. Abort the underlying request on client disconnect.

```ts
// Pattern from ai.ts streaming response
const stream = new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder();
    for await (const chunk of stream_response) {
      if (controller.desiredSize <= 0) await controller.ready;
      controller.enqueue(encoder.encode(chunk));
    }
    controller.close();
  },
  cancel() {
    underlyingAbortController.abort();
  },
});
```

---

## Cost Guards

Cap `maxTokens` per request and enforce a session-level token budget from settings. Both are read from the encrypted settings store.

```ts
const maxTokens = settings.aiMaxTokensPerRequest ?? 2048;
const sessionBudget = settings.aiMaxTokensPerSession ?? 8192;

if (sessionTokenCount + maxTokens > sessionBudget) {
  throw new APICallError('Session AI budget exhausted', 'quota');
}
```

If the setting is absent, use the defaults above. **Never allow unlimited tokens** even when the setting is misconfigured.

---

## Caching

Trade critiques and recaps cache by compound key:

```ts
// apps/web/src/server/ai.ts — cache key
const cacheKey = `${tradeKey}|${sessionId}|v${EDGE_SCORE_VERSION}`;
const cached = await aiCache.get(cacheKey);
if (cached) return cached;
```

Invalidate the cache when `EDGE_SCORE_VERSION` bumps (defined in `packages/core/src/scoring.ts`). Cache entries are soft — they may be evicted under memory pressure.

---

## Logging

Log every AI call with:

```ts
logger.info('AI request', {
  requestId,
  provider: 'anthropic',
  model: 'claude-sonnet',
  promptVersion: TRADE_CRITIQUE_VERSION,
  tokenCount: result.usage.total_tokens,
  durationMs: Date.now() - start,
});
```

**Never log** the prompt text, the model response, or any key-derived value.

---

## Cite

- `apps/web/src/server/ai.ts` — `runAi`, `APICallError`, caching, cost guards
- `apps/web/src/server/ai-import.ts` — typed output schema, import suggestion feature
- `apps/web/src/server/ai-scope.ts` — prompt constants, version constants
- `apps/web/src/server/settings.ts` — key management, `getEffectiveApiKey`

---

## Checklist before PR

- [ ] Keys are read via `getEffectiveApiKey`; no raw `process.env` access outside `settings.ts`
- [ ] All `APICallError` categories are mapped to UI notices; raw provider payload never reaches the client
- [ ] Prompts live in `ai-scope.ts` or a dedicated `ai-*.ts`; no embedded strings in route handlers
- [ ] Every AI feature returns a typed result with `confidence` or `unavailable`; no free-form text
- [ ] `maxTokens` cap enforced per request; session budget enforced per session
- [ ] Cache key includes `EDGE_SCORE_VERSION`; cache invalidates on version bump
- [ ] AI calls log `requestId + provider + model + token count + durationMs`; no prompt/response/key in logs
- [ ] Streaming responses handle client disconnect via `ReadableStream.cancel()` / `AbortController`
