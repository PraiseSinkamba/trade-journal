import { AI_PROVIDER_NAMES } from "@/lib/ai-settings";
import { getAiKey, getAiProvider, resolveAiConfiguration } from "./settings";
import { AI_PROMPT_VERSIONS, AiRuntimeError } from "./ai-contracts";
import { runTextAi } from "./ai-runtime";
import { REFLECTION_SYSTEM_PROMPT } from "./ai-prompts";

/**
 * BYO-key AI. Self-hosted means YOUR key on YOUR box: the key is read from the
 * encrypted settings store (or the selected provider's environment variable).
 * Requests go straight from this server to the selected provider.
 */
export const aiConfigured = (): boolean => getAiKey(getAiProvider()) !== null;

export const runAi = async (prompt: string): Promise<string> => {
  const configuration = resolveAiConfiguration();
  if (!configuration.apiKey) {
    throw new Error(
      `AI is not configured — add your ${AI_PROVIDER_NAMES[configuration.provider]} API key in Settings.`,
    );
  }
  try {
    const result = await runTextAi({
      feature: "reflection",
      configuration: { provider: configuration.provider, modelId: configuration.modelId, apiKey: configuration.apiKey },
      promptVersion: AI_PROMPT_VERSIONS.reflection,
      system: REFLECTION_SYSTEM_PROMPT,
      prompt,
    });
    if (!result.output.trim()) throw new Error("AI returned no text. Check the model or try again.");
    return result.output;
  } catch (error) {
    if (error instanceof AiRuntimeError) throw new Error(error.message);
    throw error;
  }
};