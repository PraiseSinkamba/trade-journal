import type { ToolSet } from "ai";
import { AI_PROVIDER_NAMES, type AiProvider } from "@/lib/ai-settings";
import { AI_FEATURE_POLICIES, AI_PROMPT_VERSIONS, AiRuntimeError } from "./ai-contracts";
import { createAskJournalSdkTools, createAskJournalToolDefinitions } from "./ai-capabilities";
import {
  buildAskJournalPrompt,
  buildReportsAgentPrompt,
  REFLECTION_SYSTEM_PROMPT,
} from "./ai-prompts";
import {
  runAskAgentAi,
  runReportsAgentAi as runReportsAgentAiRuntime,
  runTextAi,
} from "./ai-runtime";
import { createInteractiveContext, type FrozenApprovedScope } from "./ai-scope";
import { createToolGateway } from "./intelligence/runtime/tool-gateway";
import { aiProviderConfigured, getAiProvider, resolveAiConfiguration } from "./settings";

/**
 * Create the Ask-only read tools over one route-created frozen scope.
 *
 * The tools are registered operations: the gateway authorises each call
 * against the execution context, validates the input and the output, and
 * charges the runtime-owned tool-call budget. When feature is "reports", the
 * report-mode tool is enabled. No tool can widen the account, filter or
 * timezone of the scope.
 */
export function createAskJournalTools(
  scope: FrozenApprovedScope,
  context: string,
  reserveToolCall?: () => boolean,
  feature?: "reports",
) {
  const reportMode = feature === "reports";
  const gateway = createToolGateway(
    createAskJournalToolDefinitions(scope, context, { reportMode }),
  );
  const agentFeature = reportMode ? "reportsAgent" : "askJournalAgent";
  const policy = AI_FEATURE_POLICIES[agentFeature];
  const execution = createInteractiveContext(
    scope,
    AbortSignal.timeout(policy.timeoutMs ?? 30_000),
    { feature: agentFeature, consumeToolCall: reserveToolCall },
  );
  return createAskJournalSdkTools({ scope, context, reportMode, gateway, execution });
}

/**
 * BYO-key AI. Self-hosted means YOUR key on YOUR box: the key is read from the
 * encrypted settings store (or the selected provider's environment variable).
 * Requests go straight from this server to the selected provider.
 */
export const aiConfigured = (): boolean => aiProviderConfigured(getAiProvider());

/** Provider-aware "not configured" message. */
const notConfiguredMessage = (provider: AiProvider): string =>
  provider === "compatible"
    ? "AI is not configured — add your OpenAI-compatible server URL and model in Settings."
    : `AI is not configured — add your ${AI_PROVIDER_NAMES[provider]} API key in Settings.`;

/** Run a direct reflection without tools for recap and trade-critique workflows. */
export const runAi = async (prompt: string, maxOutputTokens?: number): Promise<string> => {
  const configuration = resolveAiConfiguration();
  if (!aiProviderConfigured(configuration.provider)) {
    throw new Error(notConfiguredMessage(configuration.provider));
  }
  try {
    const result = await runTextAi({
      feature: "reflection",
      configuration: {
        provider: configuration.provider,
        modelId: configuration.modelId,
        apiKey: configuration.apiKey,
        baseUrl: configuration.baseUrl,
      },
      promptVersion: AI_PROMPT_VERSIONS.reflection,
      system: REFLECTION_SYSTEM_PROMPT,
      prompt,
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    });
    if (!result.output.trim())
      throw new Error("AI returned no text. Check the model or try again.");
    return result.output;
  } catch (error) {
    if (error instanceof AiRuntimeError) throw new Error(error.message);
    throw error;
  }
};

/** Run the single bounded Ask Journal tool loop over a route-created frozen scope. */
export const runAskJournalAi = async (scope: FrozenApprovedScope, context: string) => {
  const configuration = resolveAiConfiguration();
  if (!aiProviderConfigured(configuration.provider)) {
    throw new Error(notConfiguredMessage(configuration.provider));
  }
  try {
    const result = await runAskAgentAi({
      feature: "askJournalAgent",
      configuration: {
        provider: configuration.provider,
        modelId: configuration.modelId,
        apiKey: configuration.apiKey,
        baseUrl: configuration.baseUrl,
      },
      promptVersion: AI_PROMPT_VERSIONS.askJournalAgent,
      system: REFLECTION_SYSTEM_PROMPT,
      prompt: buildAskJournalPrompt({ question: scope.question, context }),
      createTools: (reserveToolCall) =>
        createAskJournalTools(scope, context, reserveToolCall) as unknown as ToolSet,
    });
    return result.output;
  } catch (error) {
    if (error instanceof AiRuntimeError) throw new Error(error.message);
    throw error;
  }
};

/** Run the Reports agent: bounded tool loop with switch_report_mode available. */
export const runReportsAgentAi = async (scope: FrozenApprovedScope, context: string) => {
  const configuration = resolveAiConfiguration();
  if (!aiProviderConfigured(configuration.provider)) {
    throw new Error(notConfiguredMessage(configuration.provider));
  }
  try {
    const result = await runReportsAgentAiRuntime({
      feature: "reportsAgent",
      configuration: {
        provider: configuration.provider,
        modelId: configuration.modelId,
        apiKey: configuration.apiKey,
        baseUrl: configuration.baseUrl,
      },
      promptVersion: AI_PROMPT_VERSIONS.reportsAgent,
      system: REFLECTION_SYSTEM_PROMPT,
      prompt: buildReportsAgentPrompt({ question: scope.question, context }),
      createTools: (reserveToolCall) =>
        createAskJournalTools(scope, context, reserveToolCall, "reports") as unknown as ToolSet,
    });
    return result.output;
  } catch (error) {
    if (error instanceof AiRuntimeError) throw new Error(error.message);
    throw error;
  }
};
