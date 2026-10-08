import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, LoadAPIKeyError, RetryError, generateText } from "ai";
import {
  AI_FEATURE_POLICIES,
  type AiExecutionMeta,
  type AiFeature,
  AiRuntimeError,
} from "./ai-contracts";
import type { AiProvider } from "@/lib/ai-settings";

export interface AiRuntimeConfiguration {
  provider: AiProvider;
  modelId: string;
  apiKey: string;
}

export interface TextAiRequest {
  feature: Extract<AiFeature, "reflection">;
  configuration: AiRuntimeConfiguration;
  promptVersion: string;
  system: string;
  prompt: string;
}

export interface ObjectAiRequest {
  feature: Extract<AiFeature, "statementImport">;
  configuration: AiRuntimeConfiguration;
  promptVersion: string;
  system: string;
  messages: NonNullable<Parameters<typeof generateText>[0]["messages"]>;
  output: NonNullable<Parameters<typeof generateText>[0]["output"]>;
  abortSignal?: AbortSignal;
}

export interface AiRunResult<OUTPUT> {
  output: OUTPUT;
  meta: AiExecutionMeta;
}

/**
 * Provider error → safe user-facing message. Mirrors the legacy categories
 * (`missing_key`, `authentication`, `billing`, `rate_limited`,
 * `model_unavailable`, `timeout`, `provider`) and never relays the raw
 * provider response text.
 */
export const mapAiRuntimeError = (error: unknown): AiRuntimeError => {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (LoadAPIKeyError.isInstance(cause)) {
    return new AiRuntimeError("missing_key", "AI is not configured — add an API key in Settings.");
  }
  if (APICallError.isInstance(cause)) {
    const { statusCode, message } = cause;
    if (statusCode === 401 || statusCode === 403) {
      return new AiRuntimeError(
        "authentication",
        "AI authentication_error: check your provider key and permissions in Settings.",
      );
    }
    if (
      /credit balance|billing|insufficient_quota|exceeded your current quota/i.test(message) ||
      statusCode === 402
    ) {
      return new AiRuntimeError(
        "billing",
        "AI billing: check your provider account's credits and quota.",
      );
    }
    if (statusCode === 429 || statusCode === 529) {
      return new AiRuntimeError("rate_limited", "AI rate limit: please try again shortly.");
    }
    if (
      statusCode === 404 ||
      /model.*(?:not found|does not exist|access)/i.test(message)
    ) {
      return new AiRuntimeError(
        "model_unavailable",
        "AI model unavailable: check the model ID and your provider access in Settings.",
      );
    }
  }
  if (cause instanceof Error && cause.name === "AbortError") {
    return new AiRuntimeError(
      "timeout",
      "AI request timed out. Check your connection or try a smaller request.",
    );
  }
  return new AiRuntimeError(
    "provider",
    "AI request failed. Check your provider settings or try again shortly.",
  );
};

const buildMeta = (
  request: TextAiRequest | ObjectAiRequest,
  policy: { maxRetries: number },
  result: { finishReason?: string; usage?: { inputTokens?: number; outputTokens?: number } },
  startedAt: number,
): AiExecutionMeta => ({
  feature: request.feature,
  provider: request.configuration.provider,
  modelId: request.configuration.modelId,
  promptVersion: request.promptVersion,
  durationMs: Math.round(performance.now() - startedAt),
  finishReason: result.finishReason,
  inputTokens: result.usage?.inputTokens,
  outputTokens: result.usage?.outputTokens,
  maxRetries: policy.maxRetries,
});

export const runTextAi = async (request: TextAiRequest): Promise<AiRunResult<string>> => {
  const policy = AI_FEATURE_POLICIES[request.feature];
  const { provider, modelId, apiKey } = request.configuration;
  const model = provider === "openai" ? createOpenAI({ apiKey }).responses(modelId) : createAnthropic({ apiKey })(modelId);
  const startedAt = performance.now();
  try {
    const result = await generateText({
      model,
      system: request.system,
      prompt: request.prompt,
      maxOutputTokens: policy.maxOutputTokens,
      maxRetries: policy.maxRetries,
      ...(provider === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
    });
    return {
      output: result.text,
      meta: buildMeta(request, policy, result, startedAt),
    };
  } catch (error) {
    throw mapAiRuntimeError(error);
  }
};

export const runObjectAi = async <T>(request: ObjectAiRequest): Promise<AiRunResult<T>> => {
  const policy = AI_FEATURE_POLICIES[request.feature];
  const { provider, modelId, apiKey } = request.configuration;
  const model = provider === "openai" ? createOpenAI({ apiKey }).responses(modelId) : createAnthropic({ apiKey })(modelId);
  const startedAt = performance.now();
  const abortSignal = request.abortSignal
    ? AbortSignal.any([request.abortSignal, AbortSignal.timeout(policy.timeoutMs ?? 120_000)])
    : AbortSignal.timeout(policy.timeoutMs ?? 120_000);
  try {
    const result = await generateText({
      model,
      system: request.system,
      messages: request.messages,
      output: request.output,
      maxOutputTokens: policy.maxOutputTokens,
      maxRetries: policy.maxRetries,
      abortSignal,
      ...(provider === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
    });
    return {
      output: result.output as T,
      meta: buildMeta(request, policy, result, startedAt),
    };
  } catch (error) {
    throw mapAiRuntimeError(error);
  }
};
