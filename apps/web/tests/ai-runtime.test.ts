import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError, LoadAPIKeyError, RetryError } from "ai";
import { runTextAi, runObjectAi } from "../src/server/ai-runtime";
import { AiRuntimeError } from "../src/server/ai-contracts";
import {
  AI_FEATURE_POLICIES,
  AI_PROMPT_VERSIONS,
} from "../src/server/ai-contracts";
import { resolveAiConfiguration } from "../src/server/settings";

const { mockGenerateText, mockCreateOpenAI, mockCreateAnthropic } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockCreateOpenAI: vi.fn(),
  mockCreateAnthropic: vi.fn(),
}));

vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: mockGenerateText,
}));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mockCreateOpenAI }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: mockCreateAnthropic }));

const openAiConfig = {
  provider: "openai" as const,
  modelId: "gpt-5.2",
  apiKey: "secret-openai",
};
const anthropicConfig = {
  provider: "anthropic" as const,
  modelId: "claude-sonnet-4-20250514",
  apiKey: "secret-anthropic",
};

const openAiModel = { provider: "openai.responses", modelId: "gpt-5.2" };
const anthropicModel = { provider: "anthropic.messages", modelId: "claude-sonnet-4-20250514" };

const captureError = async (promise: Promise<unknown>): Promise<AiRuntimeError> => {
  try {
    await promise;
  } catch (e) {
    return e as AiRuntimeError;
  }
  throw new Error("expected rejection");
};

const stubOutput = () =>
  ({
    parseCompleteOutput: vi.fn(),
    parsePartialOutput: vi.fn(),
  }) as unknown as Parameters<typeof runObjectAi>[0]["output"];

beforeEach(() => {
  mockGenerateText.mockReset();
  mockCreateOpenAI.mockReset();
  mockCreateAnthropic.mockReset();
  mockCreateOpenAI.mockReturnValue({ responses: () => openAiModel });
  mockCreateAnthropic.mockReturnValue(() => anthropicModel);
  mockGenerateText.mockResolvedValue({
    text: "answer",
    finishReason: "stop",
    usage: { inputTokens: 12, outputTokens: 7 },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

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

describe("runTextAi provider boundary", () => {
  it("uses the OpenAI configuration and disables OpenAI storage", async () => {
    await runTextAi({
      feature: "reflection",
      configuration: openAiConfig,
      promptVersion: "reflection-v1",
      system: "system",
      prompt: "task",
    });

    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "secret-openai" });
    expect(mockCreateAnthropic).not.toHaveBeenCalled();
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: openAiModel,
        providerOptions: { openai: { store: false } },
        maxRetries: 2,
        maxOutputTokens: 1200,
      }),
    );
  });

  it("routes Anthropic requests through createAnthropic without storage options", async () => {
    await runTextAi({
      feature: "reflection",
      configuration: anthropicConfig,
      promptVersion: "reflection-v1",
      system: "system",
      prompt: "task",
    });

    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: "secret-anthropic" });
    expect(mockCreateOpenAI).not.toHaveBeenCalled();
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: anthropicModel,
        maxRetries: 2,
        maxOutputTokens: 1200,
      }),
    );
    const call = mockGenerateText.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("providerOptions");
  });

  it("returns only redacted execution metadata", async () => {
    mockGenerateText.mockResolvedValue({
      text: "answer",
      finishReason: "stop",
      usage: { inputTokens: 12, outputTokens: 7 },
    });

    const result = await runTextAi({
      feature: "reflection",
      configuration: anthropicConfig,
      promptVersion: "reflection-v1",
      system: "system secret",
      prompt: "user secret",
    });

    expect(result.output).toBe("answer");
    expect(result.meta).toMatchObject({
      feature: "reflection",
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      promptVersion: "reflection-v1",
      finishReason: "stop",
      inputTokens: 12,
      outputTokens: 7,
      maxRetries: 2,
    });
    expect(JSON.stringify(result.meta)).not.toContain("secret");
  });
});

describe("runObjectAi provider boundary", () => {
  it("applies the same provider factory and storage guard for structured output", async () => {
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "extract this" }],
      },
    ];
    const output = stubOutput();

    await runObjectAi({
      feature: "statementImport",
      configuration: openAiConfig,
      promptVersion: "statement-import-v1",
      system: "system",
      messages,
      output,
    });

    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "secret-openai" });
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: openAiModel,
        providerOptions: { openai: { store: false } },
        output,
        messages,
        maxRetries: 0,
        maxOutputTokens: 32_000,
      }),
    );
  });

  it("composes the 120s timeout with the caller-provided abort signal", async () => {
    const caller = new AbortController();
    const messages = [{ role: "user" as const, content: "parse" }];
    const output = stubOutput();

    await runObjectAi({
      feature: "statementImport",
      configuration: anthropicConfig,
      promptVersion: "statement-import-v1",
      system: "system",
      messages,
      output,
      abortSignal: caller.signal,
    });

    const call = mockGenerateText.mock.calls[0]![0] as { abortSignal: AbortSignal };
    expect(call.abortSignal).toBeDefined();
    expect(call.abortSignal.aborted).toBe(false);
    caller.abort();
    expect(call.abortSignal.aborted).toBe(true);
  });
});

describe("runTextAi error mapping", () => {
  it("maps a missing API key to a missing_key error", async () => {
    mockGenerateText.mockRejectedValue(
      new LoadAPIKeyError({ message: "OpenAI API key is missing." }),
    );

    await expect(
      runTextAi({
        feature: "reflection",
        configuration: openAiConfig,
        promptVersion: "reflection-v1",
        system: "s",
        prompt: "p",
      }),
    ).rejects.toBeInstanceOf(AiRuntimeError);

    await expect(
      runTextAi({
        feature: "reflection",
        configuration: openAiConfig,
        promptVersion: "reflection-v1",
        system: "s",
        prompt: "p",
      }),
    ).rejects.toMatchObject({ kind: "missing_key" });
  });

  it.each([401, 403])("maps %s to authentication", async (status) => {
    mockGenerateText.mockRejectedValue(
      new APICallError({
        message: "Incorrect API key provided: secret-openai",
        url: "https://api.openai.com/v1/responses",
        statusCode: status,
        requestBodyValues: { model: "gpt-5.2" },
        responseBody: "secret-openai",
      }),
    );

    const error = await captureError(
      runTextAi({
        feature: "reflection",
        configuration: openAiConfig,
        promptVersion: "reflection-v1",
        system: "s",
        prompt: "p",
      }),
    );
    expect(error.kind).toBe("authentication");
    expect(error.message).not.toContain("secret-openai");
  });

  it("maps billing/quota messages with the same user-facing text as the facade", async () => {
    mockGenerateText.mockRejectedValue(
      new APICallError({
        message: "You exceeded your current quota: secret-openai",
        url: "https://api.openai.com/v1/responses",
        statusCode: 429,
        requestBodyValues: {},
        responseBody: "secret-openai",
      }),
    );

    const error = await captureError(
      runTextAi({
        feature: "reflection",
        configuration: openAiConfig,
        promptVersion: "reflection-v1",
        system: "s",
        prompt: "p",
      }),
    );
    expect(error.kind).toBe("billing");
    expect(error.message).toBe("AI billing: check your provider account's credits and quota.");
    expect(error.message).not.toContain("secret-openai");
  });

  it.each([429, 529])("maps %s to rate_limited", async (status) => {
    mockGenerateText.mockRejectedValue(
      new APICallError({
        message: "Rate limit",
        url: "https://api.openai.com/v1/responses",
        statusCode: status,
        requestBodyValues: {},
        responseBody: "secret-openai",
      }),
    );
    const error = await captureError(
      runTextAi({
        feature: "reflection",
        configuration: openAiConfig,
        promptVersion: "reflection-v1",
        system: "s",
        prompt: "p",
      }),
    );
    expect(error.kind).toBe("rate_limited");
  });

  it("maps 404 and model-not-found to model_unavailable", async () => {
    mockGenerateText.mockRejectedValue(
      new APICallError({
        message: "Model does not exist: gpt-5.2",
        url: "https://api.openai.com/v1/responses",
        statusCode: 404,
        requestBodyValues: {},
        responseBody: "secret-openai",
      }),
    );

    const error = await captureError(
      runTextAi({
        feature: "reflection",
        configuration: openAiConfig,
        promptVersion: "reflection-v1",
        system: "s",
        prompt: "p",
      }),
    );
    expect(error.kind).toBe("model_unavailable");
    expect(error.message).toBe(
      "AI model unavailable: check the model ID and your provider access in Settings.",
    );
    expect(error.message).not.toContain("gpt-5.2");
  });

  it("maps an aborted statement-import signal to a timeout error", async () => {
    const controller = new AbortController();
    const messages = [{ role: "user" as const, content: "parse" }];
    const output = stubOutput();
    mockGenerateText.mockImplementation(async (_options: { abortSignal: AbortSignal }) => {
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });

    const error = await captureError(
      runObjectAi({
        feature: "statementImport",
        configuration: openAiConfig,
        promptVersion: "statement-import-v1",
        system: "s",
        messages,
        output,
        abortSignal: controller.signal,
      }),
    );
    expect(error.kind).toBe("timeout");
    expect(error.message).not.toContain("secret-openai");
  });

  it("unwraps RetryError to the underlying cause before mapping", async () => {
    const last = new APICallError({
      message: "Incorrect API key provided: secret-openai",
      url: "https://api.openai.com/v1/responses",
      statusCode: 401,
      requestBodyValues: {},
      responseBody: "secret-openai",
    });
    mockGenerateText.mockRejectedValue(
      new RetryError({
        message: "retries exhausted",
        reason: "maxRetriesExceeded",
        errors: [last],
      }),
    );

    const error = await captureError(
      runTextAi({
        feature: "reflection",
        configuration: openAiConfig,
        promptVersion: "reflection-v1",
        system: "s",
        prompt: "p",
      }),
    );
    expect(error.kind).toBe("authentication");
    expect(error.message).not.toContain("secret-openai");
  });

  it("falls back to a generic provider error for unknown failures", async () => {
    mockGenerateText.mockRejectedValue(new Error("provider: private-key fragments"));

    const error = await captureError(
      runTextAi({
        feature: "reflection",
        configuration: openAiConfig,
        promptVersion: "reflection-v1",
        system: "s",
        prompt: "p",
      }),
    );
    expect(error.kind).toBe("provider");
    expect(error.message).toBe(
      "AI request failed. Check your provider settings or try again shortly.",
    );
    expect(error.message).not.toContain("private-key");
  });
});

describe("resolveAiConfiguration", () => {
  it("returns the configured provider, model, and key (or null when unconfigured)", () => {
    const resolved = resolveAiConfiguration();
    expect(["anthropic", "openai"]).toContain(resolved.provider);
    expect(typeof resolved.modelId).toBe("string");
    expect(resolved.modelId.length).toBeGreaterThan(0);
    // Without a saved key, this should be null.
    expect(resolved.apiKey === null || typeof resolved.apiKey === "string").toBe(true);
  });
});
