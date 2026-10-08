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
