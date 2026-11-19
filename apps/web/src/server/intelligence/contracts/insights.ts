import type { JournalTx } from "@/db/transaction";

/**
 * The insight contracts (Phase 22).
 *
 * An insight is one generated review question, bound to the projection revision
 * it was made from. This module holds the vocabulary the run enqueue, the job
 * deduplication, the store and the retention prune share: the capability
 * version, the business key, the row shape and the store port. It holds no
 * rule that needs a database, so every side of the chain can speak about it.
 */

/** The version of the capability that produces the review questions. */
export const AI_INSIGHT_CAPABILITY_VERSION = "1";

/** The largest number of characters a stored question may hold. */
export const MAX_INSIGHT_QUESTION_LENGTH = 2000;

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
