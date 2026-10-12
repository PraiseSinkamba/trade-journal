# AI Foundation Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a provider-neutral, observable, policy-driven AI execution foundation while preserving every current AI route and user-visible behavior.

**Architecture:** Add a narrow server-only AI runtime that resolves the user-selected provider, model, and key; applies feature execution policy; normalizes errors and execution metadata; and invokes the Vercel AI SDK. Reflection and statement-import modules retain their feature behavior but become adapters over that runtime. Prompt construction moves out of route handlers without changing prompt text or route payloads. This plan deliberately does not add agents, tools, assistant sessions, draft persistence, or UI surfaces.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vercel AI SDK, `@ai-sdk/openai`, `@ai-sdk/anthropic`, Vitest.

## Global Constraints

- Preserve encrypted BYO-key storage and environment-key precedence in `apps/web/src/server/settings.ts`.
- Preserve OpenAI `store: false` in the provider adapter boundary.
- Preserve current `/api/ai/ask`, `/api/ai/recap`, `/api/ai/critique`, and import preview/commit response contracts. Replace the import request's transient browser API-key fields with the selected saved/environment credential resolved on the server.
- Keep fixed-context recap, critique, and statement parsing as direct model calls; do not create an agent loop or tools in this refactor.
- Preserve import preview → validation → user review → commit semantics; import commits must not call a model.
- Do not add dependencies, telemetry endpoints, external analytics, raw provider errors, or browser access to API keys.
- Never widen a validated journal/account scope because an AI request has missing or invalid context.
- Every AI execution must expose redacted metadata to server callers: feature ID, provider, model ID, duration, finish reason, usage when supplied by the SDK, retry policy, and prompt version.
- Do not persist prompt or response content in runtime metadata.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/server/ai-runtime.ts` | Server-only provider resolution, SDK invocation, policy application, normalized safe errors, and redacted execution metadata. |
| `apps/web/src/server/ai-contracts.ts` | Feature IDs, execution-policy types/constants, prompt-version identifiers, result metadata, and error discriminants. |
| `apps/web/src/server/ai-prompts.ts` | Exact reflection system instruction and feature-specific prompt builders currently assembled in AI routes. |
| `apps/web/src/server/ai.ts` | Reflection facade retaining the current `runAi` behavior while delegating to the runtime. |
| `apps/web/src/server/ai-import.ts` | Statement-import adapter retaining its extraction schema and strict validation while delegating invocation to the runtime. |
| `apps/web/src/app/api/ai/{ask,recap,critique}/route.ts` | Thin request/context adapters calling prompt builders; their HTTP response contracts do not change. |
| `apps/web/tests/ai-runtime.test.ts` | Isolated unit tests for policy, provider selection, metadata, error normalization, and redaction. |
| `apps/web/tests/ai-settings.test.ts` | Existing BYO-key/provider tests extended only where the central resolver changes public server behavior. |
| `apps/web/tests/ai-import.test.ts` | Existing import safety tests extended to prove import policy remains no-retry and time-bounded. |
| `apps/web/tests/ai-scope.test.ts` | Existing route/scope tests updated only for prompt-builder extraction seams. |

---

### Task 1: Define explicit AI contracts and feature policies

**Files:**
- Create: `apps/web/src/server/ai-contracts.ts`
- Create: `apps/web/tests/ai-runtime.test.ts`

**Interfaces:**
- Produces `AiFeature`, `AiExecutionPolicy`, `AiExecutionMeta`, `AiRuntimeError`, `AI_FEATURE_POLICIES`, and `AI_PROMPT_VERSIONS`.
- Consumed by the runtime, reflection facade, and import adapter.

- [ ] **Step 1: Write failing policy and metadata tests**

```ts
import { describe, expect, it } from "vitest";
import {
  AI_FEATURE_POLICIES,
  AI_PROMPT_VERSIONS,
} from "../src/server/ai-contracts";

describe("AI feature policies", () => {
  it("keeps reflection bounded and statement import non-retrying", () => {
    expect(AI_FEATURE_POLICIES.reflection.maxOutputTokens).toBe(1200);
    expect(AI_FEATURE_POLICIES.statementImport.maxRetries).toBe(0);
    expect(AI_FEATURE_POLICIES.statementImport.timeoutMs).toBe(120_000);
  });

  it("versions every current feature prompt", () => {
    expect(AI_PROMPT_VERSIONS.reflection).toMatch(/^reflection-v\d+$/);
    expect(AI_PROMPT_VERSIONS.statementImport).toMatch(/^statement-import-v\d+$/);
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm test apps/web/tests/ai-runtime.test.ts
```

Expected: FAIL because `ai-contracts.ts` does not exist.

- [ ] **Step 3: Implement the minimal immutable contracts**

```ts
export type AiFeature = "reflection" | "statementImport";

export type AiExecutionPolicy = Readonly<{
  maxOutputTokens: number;
  maxRetries: number;
  timeoutMs?: number;
}>;

export type AiExecutionMeta = Readonly<{
  feature: AiFeature;
  provider: "anthropic" | "openai";
  modelId: string;
  promptVersion: string;
  durationMs: number;
  finishReason: string | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  maxRetries: number;
}>;

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

export const AI_FEATURE_POLICIES: Readonly<Record<AiFeature, AiExecutionPolicy>> = {
  reflection: { maxOutputTokens: 1200, maxRetries: 2 },
  statementImport: { maxOutputTokens: 32_000, maxRetries: 0, timeoutMs: 120_000 },
};

export const AI_PROMPT_VERSIONS: Readonly<Record<AiFeature, string>> = {
  reflection: "reflection-v1",
  statementImport: "statement-import-v1",
};
```

Do not add a generic `Record<string, ...>` policy registry: the closed `AiFeature` union prevents unreviewed features from inheriting unsafe defaults.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
pnpm test apps/web/tests/ai-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the contracts**

```bash
git add apps/web/src/server/ai-contracts.ts apps/web/tests/ai-runtime.test.ts
git commit -m "Define policy boundaries for AI execution"
```

### Task 2: Create the server-only provider runtime

**Files:**
- Create: `apps/web/src/server/ai-runtime.ts`
- Modify: `apps/web/tests/ai-runtime.test.ts`
- Modify: `apps/web/src/server/settings.ts`

**Interfaces:**
- Consumes `AiFeature`, `AiExecutionPolicy`, `AiExecutionMeta`, and `AiRuntimeError` from `ai-contracts.ts`.
- Produces `runTextAi(request)` and `runObjectAi(request)` returning `{ output, meta }`.
- `runTextAi` accepts `{ feature: "reflection"; configuration: AiRuntimeConfiguration; promptVersion: string; system: string; prompt: string }`.
- `runObjectAi` accepts `{ feature: "statementImport"; configuration: AiRuntimeConfiguration; promptVersion: string; system: string; messages: UserMessage[]; output: Output.object<T>; abortSignal?: AbortSignal }`, preserving the import module's current text/PDF message payload.

- [ ] **Step 1: Write failing runtime tests at the provider boundary**

Mock `generateText`, `createOpenAI`, and `createAnthropic` at module scope. Test all of:

```ts
it("uses the OpenAI configuration and disables OpenAI storage", async () => {
  await runTextAi({
    feature: "reflection",
    configuration: {
      provider: "openai",
      modelId: "gpt-5.2",
      apiKey: "secret",
    },
    promptVersion: "reflection-v1",
    system: "system",
    prompt: "task",
  });

  expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "secret" });
  expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
    providerOptions: { openai: { store: false } },
    maxRetries: 2,
    maxOutputTokens: 1200,
  }));
});

it("returns only redacted execution metadata", async () => {
  mockGenerateText.mockResolvedValue({
    text: "answer",
    finishReason: "stop",
    usage: { inputTokens: 12, outputTokens: 7 },
  });

  const result = await runTextAi({
    feature: "reflection",
    configuration: {
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      apiKey: "secret",
    },
    promptVersion: "reflection-v1",
    system: "system secret",
    prompt: "user secret",
  });

  expect(result.meta).toMatchObject({ feature: "reflection", promptVersion: "reflection-v1" });
  expect(JSON.stringify(result.meta)).not.toContain("secret");
});
```

Also test Anthropic resolution and every normalized safe error mapping: missing key, authentication, billing/quota, rate limit, model unavailable, timeout from an aborted statement-import signal, and generic provider failure. Add facade-parity tests asserting the existing exact user-facing messages for billing and model-unavailable remain unchanged.

- [ ] **Step 2: Run the focused runtime suite to verify it fails**

Run:

```bash
pnpm test apps/web/tests/ai-runtime.test.ts
```

Expected: FAIL because `ai-runtime.ts` does not exist.

- [ ] **Step 3: Extract one resolved server-only configuration function from settings**

In `apps/web/src/server/settings.ts`, add a server-only resolver with this exact shape:

```ts
export const resolveAiConfiguration = (): {
  provider: AiProvider;
  modelId: string;
  apiKey: string | null;
} => {
  const provider = getAiProvider();
  return {
    provider,
    modelId: getAiModel(provider),
    apiKey: getAiKey(provider),
  };
};
```

Use the existing encrypted-key/environment-override helpers already in this file; do not move encryption logic into the runtime. The import path retains its existing caller-selected `AiImportOptions`; it converts its already-validated provider, model, and key into `AiRuntimeConfiguration` so its public API remains unchanged.


- [ ] **Step 4: Implement the runtime with the current SDK semantics**

```ts
export async function runTextAi(request: TextAiRequest): Promise<AiRunResult<string>> {
  const policy = AI_FEATURE_POLICIES[request.feature];
  const model = createModel(request.configuration);
  const startedAt = performance.now();

  try {
    const result = await generateText({
      model,
      system: request.system,
      prompt: request.prompt,
      maxOutputTokens: policy.maxOutputTokens,
      maxRetries: policy.maxRetries,
      ...(request.configuration.provider === "openai"
        ? { providerOptions: { openai: { store: false } } }
        : {}),
    });
    return {
      output: result.text,
      meta: createMeta(request, policy, result, startedAt),
    };
  } catch (error) {
    throw mapAiRuntimeError(error);
  }
}
```

`runObjectAi` must apply the same provider-model factory and `store: false` boundary, pass `request.messages`, `request.output`, and `request.abortSignal`, and use its feature policy. `mapAiRuntimeError` must preserve the current safe user-facing categories: missing key, invalid key, quota/rate limit, and generic provider failure. It must never expose raw provider response text.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm test apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-settings.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the runtime**

```bash
git add apps/web/src/server/ai-contracts.ts apps/web/src/server/ai-runtime.ts apps/web/src/server/settings.ts apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-settings.test.ts
git commit -m "Centralize provider-safe AI execution"
```

### Task 3: Extract reflection prompts and migrate existing reflection calls

**Files:**
- Create: `apps/web/src/server/ai-prompts.ts`
- Modify: `apps/web/src/server/ai.ts`
- Modify: `apps/web/src/app/api/ai/ask/route.ts`
- Modify: `apps/web/src/app/api/ai/recap/route.ts`
- Modify: `apps/web/src/app/api/ai/critique/route.ts`
- Modify: `apps/web/tests/ai-scope.test.ts`
- Modify: `apps/web/tests/ai-ui.test.ts`
- Modify: `apps/web/tests/ai-settings.test.ts`

**Interfaces:**
- `buildAskJournalPrompt(input: AskJournalPromptInput): string`
- `buildDailyRecapPrompt(input: DailyRecapPromptInput): string`
- `buildTradeCritiquePrompt(input: TradeCritiquePromptInput): string`
- `runAi(prompt: string): Promise<string>` remains available during this foundation phase and resolves its server-only configuration before delegating to `runTextAi`. The existing second parameter is test-only—LSP references show no production caller—so this refactor removes it and makes the closed reflection feature policy the sole token ceiling.

- [ ] **Step 1: Add failing exact prompt-parity tests**

Use the existing fixed route fixtures to build each expected string exactly as it exists before extraction. Assert exact equality for all three builders and the reflection system instruction; do not use substring assertions for prompt parity. Keep the invalid-request assertion proving no provider invocation occurs.

```ts
expect(buildAskJournalPrompt(fixture)).toBe(expectedAskPrompt);
expect(buildDailyRecapPrompt(fixture)).toBe(expectedRecapPrompt);
expect(buildTradeCritiquePrompt(fixture)).toBe(expectedCritiquePrompt);
expect(REFLECTION_SYSTEM_PROMPT).toBe(expectedReflectionSystemPrompt);
expect(runAi).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run focused reflection tests to verify they fail**

Run:

```bash
pnpm test apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-settings.test.ts
```

Expected: FAIL because prompt builders do not exist.

- [ ] **Step 3: Move exact prompt text without semantic redesign**

Move `SYSTEM_PROMPT` from `ai.ts` and the three route-local template strings into `ai-prompts.ts`. The builders receive typed route-derived data only; they do not query the database, read settings, or widen scope.

Change `runAi` to:

```ts
export async function runAi(prompt: string): Promise<string> {
  const result = await runTextAi({
    feature: "reflection",
    configuration: resolveAiConfiguration(),
    promptVersion: AI_PROMPT_VERSIONS.reflection,
    system: REFLECTION_SYSTEM_PROMPT,
    prompt,
  });
  return result.output;
}
```

The reflection policy's `maxOutputTokens: 1200` remains a hard per-request ceiling. Update both existing provider-adapter tests in `ai-settings.test.ts` to call `runAi` with one argument and assert `max_output_tokens: 1200` for OpenAI and `max_tokens: 1200` for Anthropic; no production caller uses the removed override.

Keep the existing safe-error behavior at this facade boundary so current route error responses remain byte-for-byte compatible where tests specify them.

- [ ] **Step 4: Make routes thin context adapters**

Replace each route-local template literal with its prompt builder. Retain the existing validation, trade queries, scope snapshots, metric calculation, status codes, response JSON fields, and response text. Do not expose execution metadata in HTTP responses in this task.

- [ ] **Step 5: Run reflection regression tests**

Run:

```bash
pnpm test apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-feedback.test.ts apps/web/tests/ai-settings.test.ts
```

Expected: PASS; invalid scopes still never call the provider and UI stale-response protections remain intact.

- [ ] **Step 6: Commit reflection migration**

```bash
git add apps/web/src/server/ai-prompts.ts apps/web/src/server/ai.ts apps/web/src/app/api/ai/ask/route.ts apps/web/src/app/api/ai/recap/route.ts apps/web/src/app/api/ai/critique/route.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-settings.test.ts
git commit -m "Move reflection prompts behind AI feature boundaries"
```

### Task 4: Migrate structured statement parsing without changing its safety protocol

**Files:**
- Modify: `apps/web/src/server/ai-import.ts`
- Modify: `apps/web/src/app/api/import/route.ts`
- Modify: `apps/web/src/app/import/page.tsx`
- Modify: `apps/web/src/components/ai-import-options.tsx`
- Modify: `apps/web/tests/ai-import.test.ts`
- Modify: `apps/web/tests/ai-runtime.test.ts`
- Modify: `apps/web/tests/ai-import-ui.test.ts`

**Interfaces:**
- Consumes `runObjectAi` with `feature: "statementImport"` and the server-only `resolveAiConfiguration()` result.
- Changes `parseStatementWithAi` to accept only `statement` and an optional cancellation signal; it no longer accepts caller-provided provider/model/key data.
- The import API accepts only the existing AI-preview intent flag, never an API key, model ID, or provider ID.
- Produces the existing `parseStatementWithAi` return shape and existing typed import errors.

- [ ] **Step 1: Write failing server-key and safety-regression tests**

Add route/component tests in `ai-import.test.ts` and `ai-import-ui.test.ts` proving the import request never serializes `apiKey`, `provider`, or `model`, and that an AI preview with no saved/environment key returns the existing safe configuration error directing the user to Settings. Replace the existing provider-bearing preview request assertion with exact AI-preview intent and explicit absence checks for `apiKey`, `provider`, and `model`. Preserve tests that prove no model call occurs during commit.

Add runtime/import assertions:

```ts
expect(mockRunObjectAi).toHaveBeenCalledWith(expect.objectContaining({
  feature: "statementImport",
  promptVersion: "statement-import-v1",
  output: expect.anything(),
  abortSignal: expect.any(AbortSignal),
}));

expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
  maxRetries: 0,
  maxOutputTokens: 32_000,
}));

mockRunObjectAi.mockResolvedValueOnce({
  output: validExtraction,
  meta: { finishReason: "length" },
});
await expect(parseStatementWithAi(statement)).rejects.toThrow(
  "AI response was incomplete",
);
```

Keep existing cases for empty result, multiple accounts, malformed execution values, duplicate fills, missing source references, and no model call during commit.

- [ ] **Step 2: Run focused import tests to verify they fail**

Run:

```bash
pnpm test apps/web/tests/ai-import.test.ts apps/web/tests/ai-import-ui.test.ts apps/web/tests/ai-runtime.test.ts
```

Expected: FAIL because import still accepts browser key/model options and invokes `generateText` directly.

- [ ] **Step 3: Remove transient browser credentials from the import path**

Delete the API-key input and local key state from `ai-import-options.tsx` and `import/page.tsx`. Retain an AI-preview control only when Settings reports a configured selected provider; otherwise render a Settings link and no client key input.

Remove provider/model/key fields from the import request body validation and call shape. Resolve the currently selected encrypted/environment key only in `parseStatementWithAi`:

```ts
const configuration = resolveAiConfiguration();
requireValue(
  configuration.apiKey,
  `Add your ${AI_PROVIDER_NAMES[configuration.provider]} API key in Settings.`,
);
```

The caller does not supply `configuration`, and the browser never receives its API key.

- [ ] **Step 4: Replace only the provider invocation seam**

Retain the import system prompt, `statementParseSchema`, source-reference validation, all post-processing helpers, and the existing `AbortSignal.timeout(120_000)` composition. Replace direct provider/model construction and `generateText` with:

```ts
const { output, meta } = await runObjectAi({
  feature: "statementImport",
  configuration,
  promptVersion: AI_PROMPT_VERSIONS.statementImport,
  system: STATEMENT_PARSE_SYSTEM_PROMPT,
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
requireValue(
  meta.finishReason === "stop",
  "AI response was incomplete. Split the statement into smaller files.",
);
```

Map `AiRuntimeError` into the import module's existing user-safe import error response. Do not add a `finally` timeout cleanup: `AbortSignal.timeout(...)` exposes no clearable handle.

- [ ] **Step 5: Run import regression suite**

Run:

```bash
pnpm test apps/web/tests/ai-import.test.ts apps/web/tests/ai-import-ui.test.ts apps/web/tests/ai-runtime.test.ts
```

Expected: PASS; preview remains the only model-call phase, provider credentials never traverse browser/API payloads, and every deterministic validation remains unchanged.

- [ ] **Step 6: Commit import migration**

```bash
git add apps/web/src/server/ai-import.ts apps/web/src/app/api/import/route.ts apps/web/src/app/import/page.tsx apps/web/src/components/ai-import-options.tsx apps/web/tests/ai-import.test.ts apps/web/tests/ai-import-ui.test.ts apps/web/tests/ai-runtime.test.ts
git commit -m "Keep AI import credentials on the server"
```

### Task 5: Verify foundation parity and document the migration boundary

**Files:**
- Modify: `docs/ai-scope.md`
- Modify: `docs/superpowers/specs/2026-10-08-contextual-ai-workspace-design.md`
- Modify: `.omp/style/ai-integration.md`

**Interfaces:**
- Produces documentation that distinguishes implemented execution foundation from future assistant-session, tool/capability, draft-card, and UI work.

- [ ] **Step 1: Write documentation assertions as a review checklist**

Add a checklist section to the design spec stating all of the following implementation facts must be true after Tasks 1–4:

```markdown
- [ ] Provider/model/key resolution occurs only in the server runtime.
- [ ] Provider options do not leak into AI feature routes.
- [ ] Reflection and import have explicit policy and prompt versions.
- [ ] No feature route returns provider credentials or raw provider errors.
- [ ] No agent session, tool, draft persistence, or assistant UI ships in this foundation refactor.
```

- [ ] **Step 2: Document the actual boundary**

Update `docs/ai-scope.md` to describe the current user privacy boundary plus the new execution boundary: server-only key resolution, redacted metadata, direct-model classification, and future bounded capabilities. Update `.omp/style/ai-integration.md` so requirements marked as current are implementable by this plan; move assistant/UI/tool policy to its future-architecture section rather than implying it already exists.

- [ ] **Step 3: Run all affected tests and static checks**

Run:

```bash
pnpm test apps/web/tests/ai-runtime.test.ts apps/web/tests/ai-settings.test.ts apps/web/tests/ai-import.test.ts apps/web/tests/ai-import-ui.test.ts apps/web/tests/ai-scope.test.ts apps/web/tests/ai-ui.test.ts apps/web/tests/ai-feedback.test.ts
pnpm typecheck
pnpm format:check
```

Expected: all commands exit 0.

- [ ] **Step 4: Perform the changed-path smoke check**

With valid local BYO credentials, use the running web application to:

1. ask a scoped journal question;
2. generate one recap or critique;
3. create an import preview from a supported statement fixture;
4. confirm the import commit reuses the reviewed preview and does not issue a second model call;
5. verify no UI exposes key material or raw provider failure text.

Expected: each existing interaction retains its current UX and API shape. Do not record prompts, responses, or credentials in a log.

- [ ] **Step 5: Request the required code review**

Run the repository reviewer after all tests pass. Resolve every `FAIL`/`BLOCK` finding before committing.

- [ ] **Step 6: Commit verification and documentation**

```bash
git add docs/ai-scope.md docs/superpowers/specs/2026-10-08-contextual-ai-workspace-design.md .omp/style/ai-integration.md
git commit -m "Document the AI execution foundation"
```

## Plan Self-Review

- **Spec coverage:** Tasks 1–4 implement provider-neutral execution, policy, prompt versions, redacted observability, provider isolation, direct-call preservation, and import safety. Task 5 documents explicit non-goals and validates the current feature contracts. Agent sessions, tools, side-sheet UI, draft cards, direct writes, and user-flow expansion remain intentionally outside this foundation plan.
- **Placeholder scan:** No task uses an undefined future feature as a dependency; all proposed runtime types, functions, files, tests, and validation commands are named above.
- **Type consistency:** `AiFeature`, `AI_FEATURE_POLICIES`, `AI_PROMPT_VERSIONS`, `runTextAi`, `runObjectAi`, `AiExecutionMeta`, and `AiRuntimeError` are defined in Tasks 1–2 and used under those exact names in Tasks 3–4.
