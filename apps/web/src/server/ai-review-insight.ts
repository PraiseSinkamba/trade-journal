import type { ReviewEvidence } from "./intelligence/contracts/insights";

/**
 * The review-question prompt (Phase 23).
 *
 * The prompt asks the provider for exactly one question the trader can answer
 * about their own behaviour on one recorded trade. It carries only the facts
 * the journal holds and states what the journal does not know, so the model
 * never assumes a fact the journal never had.
 *
 * It lives in the AI surface beside the other prompts, and it is pure: the
 * same evidence always builds the same prompt.
 */

/** The system prompt every review question is asked under. */
export const REVIEW_QUESTION_SYSTEM_PROMPT = `You are the review layer of a trader's journal.

You are given one recorded trade and nothing else. Reply with exactly one short question the trader
can answer about their own behaviour on that trade: the question a good trading coach asks before the
trader moves on. Not advice, not a summary, not a verdict, and not a second question.

Plain text only: no markdown, no headings, no bullet points, no preamble, no closing remark, and no
quotation marks around the question.

Ask only about what the journal actually knows. When the journal says a fact is unknown or may not be
trusted, do not assume it, do not fill the gap with a plausible story, and do not ask the question as
if you knew it.`;

/**
 * The lines that tell the model what the journal does not know.
 *
 * The uncertainty travels with the facts: an unknown holding time and an
 * untrusted timing are stated, so the question does not rest on a fact the
 * journal never had.
 */
const uncertaintyLines = (evidence: ReviewEvidence): string[] => {
  const lines: string[] = [];
  if (evidence.durationMs === null) {
    lines.push(
      "The journal does not know how long the trade was held: do not assume the holding time was short or long, and do not ask about it as if you knew it.",
    );
  }
  if (evidence.timingQuality === "unknown") {
    lines.push(
      "The journal does not know the timing of this trade: the timing may not be trusted, so do not assume anything about when it was opened or closed.",
    );
  } else if (evidence.timingQuality === "reconstructed") {
    lines.push(
      "The timing of this trade was reconstructed from the data instead of being reported by the source, so it may not be trusted: do not assume anything about when it was opened or closed.",
    );
  }
  return lines;
};

/**
 * Builds the prompt for one validated evidence set.
 *
 * Only the evidence travels into the prompt: the symbol, the direction, the
 * status, the money, the holding time and how far the timing can be trusted.
 */
export const buildReviewQuestionPrompt = (evidence: ReviewEvidence): string =>
  [
    "One recorded trade:",
    "",
    `symbol: ${evidence.symbol}`,
    `direction: ${evidence.direction}`,
    `status: ${evidence.status}`,
    `net pnl: ${evidence.netPnl.toFixed(2)} ${evidence.currency}`,
    `fees: ${evidence.fees.toFixed(2)} ${evidence.currency}`,
    `holding time: ${evidence.durationMs === null ? "unknown" : `${evidence.durationMs} ms`}`,
    `timing quality: ${evidence.timingQuality}`,
    "",
    "The journal holds these facts about this trade and nothing else.",
    ...uncertaintyLines(evidence),
    "",
    "Ask the trader exactly one question about this trade.",
    "Reply with the question only.",
  ].join("\n");
