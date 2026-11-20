import { z } from "zod";
import type { JournalTx } from "@/db/transaction";
import type { AiProvider } from "@/lib/ai-settings";

/**
 * The insight contracts (Phase 22).
 *
 * An insight is one generated review question, bound to the projection revision
 * it was made from. This module holds the vocabulary the run enqueue, the job
 * deduplication, the store and the retention prune share: the capability
 * version, the business key, the row shape and the store port. It holds no
 * rule that needs a database, so every side of the chain can speak about it.
 *
 * Phase 23 adds the background capability that produces one question: the
 * minimum authorised evidence it reads, the bounded answer it returns, the
 * evidence reader it needs and the provider transport it calls.
 */

/**
 * The minimum authorised evidence one review question is made from.
 *
 * It is deliberately small: the facts a question can rest on, and nothing
 * that identifies the account or the trader beyond the instrument. The
 * uncertainty travels with the facts — `durationMs` is null when the journal
 * does not know how long the trade was held, and `timingQuality` says how much
 * the timing can be trusted.
 */
export const reviewEvidenceSchema = z
  .object({
    symbol: z.string().min(1).max(32),
    direction: z.enum(["long", "short"]),
    status: z.enum(["open", "win", "loss", "breakeven"]),
    currency: z.string().min(1).max(16),
    netPnl: z.number(),
    fees: z.number(),
    durationMs: z.number().int().nonnegative().nullable(),
    timingQuality: z.enum(["source_reported", "reconstructed", "unknown"]),
  })
  .strict();

/** The evidence one review question is made from. */
export type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>;

/** The largest number of characters a stored question may hold. */
export const MAX_INSIGHT_QUESTION_LENGTH = 2000;

/**
 * The answer one review question must be: one bounded question in plain text.
 *
 * The bound is the one the insight store already enforces, so a question that
 * is too long is refused before it can reach the journal.
 */
export const reviewAnswerSchema = z.string().trim().min(1).max(MAX_INSIGHT_QUESTION_LENGTH);

/**
 * The provider transport one review question needs.
 *
 * The transport is the only place the background runtime reaches a provider.
 * It sends exactly one request, to the provider the run was pinned to, and it
 * never retries on its own: a retry would spend another allowance and reach
 * the provider again.
 */
export interface ReviewQuestionTransport {
  /** Calls the pinned provider once and returns its plain-text answer. */
  ask(input: {
    readonly provider: AiProvider;
    readonly model: string;
    /**
     * The endpoint of a compatible server, or null for a hosted provider.
     *
     * It travels with the call so the transport sends the request to the
     * endpoint the run was pinned to, and never to the one configured now.
     */
    readonly baseUrl: string | null;
    readonly system: string;
    readonly prompt: string;
    readonly signal: AbortSignal;
  }): Promise<string>;
}

/**
 * One observation, as the review question sees it.
 *
 * The identity travels with the evidence so the caller never has to look the
 * observation up twice.
 */
export interface ReviewObservation {
  readonly observationId: string;
  readonly subjectId: string;
  readonly accountId: string;
  readonly sourceRevision: string;
  readonly evidence: ReviewEvidence;
}

/**
 * The reader that answers the question "what is still true about this
 * observation?".
 *
 * It returns the observation, or null when the observation is gone, is no
 * longer active, or was derived from a revision that is no longer the
 * subject's current one. A correction therefore hides the older observation,
 * exactly as it hides the older question.
 */
export interface ObservationEvidenceReader {
  /** The current observation, or null when it is no longer current. */
  readCurrentObservationInTx(tx: JournalTx, observationId: string): ReviewObservation | null;
}

/**
 * The reader that answers whether the review opportunity of an observation is
 * still live.
 *
 * An opportunity the journal suppressed is one it decided never to show: a
 * question about that trade would push back at the trader what the journal
 * deliberately kept quiet about.
 */
export interface ReviewOpportunityReader {
  /** Whether the observation still has a review opportunity worth a question. */
  isLiveInTx(tx: JournalTx, observationId: string): boolean;
}

/** The version of the capability that produces the review questions. */
export const AI_INSIGHT_CAPABILITY_VERSION = "1";

/**
 * The key of one insight: the capability version and the source revision
 * within the account.
 *
 * The same string is the run's effect key, the job's idempotency key and the
 * row's `business_key`, so a duplicate write is one row.
 */
export const insightBusinessKey = (input: {
  accountId: string;
  sourceRevision: string;
  capabilityVersion?: string;
}): string =>
  `insight:${input.capabilityVersion ?? AI_INSIGHT_CAPABILITY_VERSION}:${input.accountId}:${input.sourceRevision}`;

/** One insight to store. */
export interface InsightInput {
  /** The account the question belongs to. */
  readonly accountId: string;
  /** The trade identity the question is about. */
  readonly subjectId: string;
  /** The observation the question was generated from. */
  readonly observationId: string;
  /** The projection revision id the question was made from. */
  readonly sourceRevision: string;
  /** The question text. It is validated at the store boundary. */
  readonly question: string;
  /** The run that produced it, when it is known. */
  readonly runId?: string | null;
  /** The version of the capability that produced it. */
  readonly capabilityVersion?: string;
  /** The creation time, in epoch milliseconds. */
  readonly createdAt?: number;
}

/** What to read. */
export interface InsightQuery {
  /** The trade identity to read the current question of. */
  readonly subjectId: string;
  /** The account, when the caller wants the question of one account only. */
  readonly accountId?: string;
  /**
   * The capability version to read. The current version by default: a newer
   * capability version is a new question, not a revision of the old one, so the
   * read names one version rather than whichever row it finds first.
   */
  readonly capabilityVersion?: string;
}

/** One stored insight. */
export interface InsightRow {
  readonly id: string;
  readonly businessKey: string;
  readonly accountId: string;
  readonly subjectId: string;
  readonly observationId: string;
  readonly sourceRevision: string;
  readonly capabilityVersion: string;
  readonly question: string;
  readonly runId: string | null;
  readonly createdAt: number;
}

/**
 * The insight store.
 *
 * The store validates, deduplicates and reads; it never decides what a
 * question means.
 */
export interface InsightStore {
  /** The id of the stored insight, or null when nothing was stored. */
  persistInsightInTx(tx: JournalTx, input: InsightInput): string | null;
  /** The current question of a subject, or null when it has none. */
  readCurrentInsightInTx(tx: JournalTx, query: InsightQuery): InsightRow | null;
}
