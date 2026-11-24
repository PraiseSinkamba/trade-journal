import { JOURNAL_CAPABILITY_IDS, type BackgroundCapability } from "../contracts/capabilities";
import {
  AI_INSIGHT_CAPABILITY_VERSION,
  reviewAnswerSchema,
  reviewEvidenceSchema,
  type ReviewEvidence,
} from "../contracts/insights";

/**
 * The background capability that produces one review question (Phase 23).
 *
 * The capability reads the minimum authorised evidence of one observation and
 * asks the provider for one short question about it. It declares no tools and
 * no model features: it is a single request with a bounded plain-text answer.
 *
 * The prompt itself is not here: the prompt lives in the AI surface, and the
 * composition hands it to the capability. This module stays pure, so it can be
 * decided without a provider, a database or a clock.
 */

/** The id of the review-question capability. */
export const REVIEW_INSIGHT_CAPABILITY_ID = JOURNAL_CAPABILITY_IDS.reviewInsight;

/** The version of the review-question capability. */
export const REVIEW_INSIGHT_CAPABILITY_VERSION = AI_INSIGHT_CAPABILITY_VERSION;

/** The prompt the review question is asked under. */
export interface ReviewQuestionPrompt {
  /** The system prompt every review question is asked under. */
  readonly system: string;
  /** Builds the user prompt from one validated evidence set. */
  readonly build: (evidence: ReviewEvidence) => string;
}

/**
 * Creates the review-question capability.
 *
 * The capability validates the evidence before it builds the prompt, so a
 * caller that hands it something else never reaches a provider request.
 */
export const createReviewInsightCapability = (
  prompt: ReviewQuestionPrompt,
): BackgroundCapability => ({
  id: REVIEW_INSIGHT_CAPABILITY_ID,
  version: REVIEW_INSIGHT_CAPABILITY_VERSION,
  inputSchema: reviewEvidenceSchema,
  outputSchema: reviewAnswerSchema,
  buildPrompt: (evidence: unknown) => {
    const parsed = reviewEvidenceSchema.safeParse(evidence);
    if (!parsed.success) {
      throw new Error("Review insight evidence does not match the capability schema.");
    }
    return {
      system: prompt.system,
      prompt: prompt.build(parsed.data),
    };
  },
});
