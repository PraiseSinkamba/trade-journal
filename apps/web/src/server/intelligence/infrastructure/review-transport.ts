import { runBackgroundAi } from "@/server/ai-runtime";
import { getAiKey } from "@/server/settings";
import type { ReviewQuestionTransport } from "../contracts/insights";

/**
 * The review-question transport (Phase 23).
 *
 * It is the only place the background runtime reaches a provider. The request
 * goes to the provider the run was pinned to, with the key that belongs to
 * that provider, and it is issued exactly once: the background runtime never
 * retries on its own, because a retry would spend another allowance and reach
 * the provider again.
 */

/** The version of the prompt the transport sends. */
export const REVIEW_QUESTION_PROMPT_VERSION = "review-insight-v1";

/**
 * Creates the transport.
 *
 * The factory is the only public surface of this module: the background
 * runtime injects the port from `../contracts/insights` and never reaches the
 * adapter directly, so the boundary rule holds.
 */
export const createReviewQuestionTransport = (): ReviewQuestionTransport => ({
  ask: async ({ provider, model, baseUrl, system, prompt, signal }) => {
    const result = await runBackgroundAi({
      configuration: {
        provider,
        modelId: model,
        apiKey: getAiKey(provider),
        baseUrl: provider === "compatible" ? baseUrl : null,
      },
      promptVersion: REVIEW_QUESTION_PROMPT_VERSION,
      system,
      prompt,
      abortSignal: signal,
    });
    // The raw answer travels back untouched: the capability validates it.
    return result.output;
  },
});
