import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import {
  accounts,
  intelligenceInsights,
  intelligenceObservations,
  intelligenceOpportunities,
  tradeIdentities,
  tradeProjectionRevisions,
} from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { newUuid } from "@/server/ids";
import {
  AI_INSIGHT_CAPABILITY_VERSION,
  MAX_INSIGHT_QUESTION_LENGTH,
  insightBusinessKey,
  reviewEvidenceSchema,
  type InsightInput,
  type InsightQuery,
  type InsightRow,
  type InsightStore,
  type ObservationEvidenceReader,
  type ReviewEvidence,
  type ReviewObservation,
  type ReviewOpportunityReader,
} from "../contracts/insights";
import { opportunityKey } from "../contracts/experience";
import type { LiveReferenceIndex } from "./experience-store";

/**
 * The insight store (Phase 22).
 *
 * One generated review question per source revision. The question is bound to
 * the projection revision it was made from, so a correction hides the older
 * question without deleting anything: the read resolves the current revision
 * of the subject inside the caller's transaction.
 *
 * The business key is the deduplication identity: the same key is the run's
 * effect key and the job's idempotency key, so a repeated write is one row.
 */

/**
 * Stores one insight, in the caller's transaction.
 *
 * An invalid question stores nothing and returns null: the caller can tell
 * "not stored" from "stored". A repeated write returns the id of the row that
 * is already there, so the id always names a row that exists.
 */
export const persistInsightInTx = (tx: JournalTx, input: InsightInput): string | null => {
  const question = input.question.trim();
  if (question.length === 0 || question.length > MAX_INSIGHT_QUESTION_LENGTH) return null;

  const capabilityVersion = input.capabilityVersion ?? AI_INSIGHT_CAPABILITY_VERSION;
  const businessKey = insightBusinessKey({
    accountId: input.accountId,
    sourceRevision: input.sourceRevision,
    capabilityVersion,
  });

  tx.insert(intelligenceInsights)
    .values({
      id: newUuid(),
      businessKey,
      accountId: input.accountId,
      subjectId: input.subjectId,
      observationId: input.observationId,
      sourceRevision: input.sourceRevision,
      capabilityVersion,
      question,
      runId: input.runId ?? null,
      createdAt: input.createdAt ?? Date.now(),
    })
    .onConflictDoNothing({ target: intelligenceInsights.businessKey })
    .run();

  // A repeated write keeps the original row, so its id is read back from the
  // business key rather than assumed.
  const stored = tx
    .select({ id: intelligenceInsights.id })
    .from(intelligenceInsights)
    .where(eq(intelligenceInsights.businessKey, businessKey))
    .get();
  return stored?.id ?? null;
};

/**
 * Reads the current insight of a subject.
 *
 * A question is visible only when its source revision is the subject's current
 * projection revision and its observation is still `active`. The revision
 * check is what hides the older question: a correction produces a new
 * projection revision, so the question bound to the old one stops being
 * readable at once.
 */
export const readCurrentInsightInTx = (tx: JournalTx, query: InsightQuery): InsightRow | null => {
  const currentRevisionId = currentProjectionRevisionId(tx, query.subjectId);
  if (!currentRevisionId) return null;

  const conditions = [
    eq(intelligenceInsights.subjectId, query.subjectId),
    eq(intelligenceInsights.sourceRevision, currentRevisionId),
    eq(
      intelligenceInsights.capabilityVersion,
      query.capabilityVersion ?? AI_INSIGHT_CAPABILITY_VERSION,
    ),
    eq(intelligenceObservations.status, "active"),
  ];
  if (query.accountId) conditions.push(eq(intelligenceInsights.accountId, query.accountId));

  const row = tx
    .select({
      id: intelligenceInsights.id,
      businessKey: intelligenceInsights.businessKey,
      accountId: intelligenceInsights.accountId,
      subjectId: intelligenceInsights.subjectId,
      observationId: intelligenceInsights.observationId,
      sourceRevision: intelligenceInsights.sourceRevision,
      capabilityVersion: intelligenceInsights.capabilityVersion,
      question: intelligenceInsights.question,
      runId: intelligenceInsights.runId,
      createdAt: intelligenceInsights.createdAt,
    })
    .from(intelligenceInsights)
    .innerJoin(
      intelligenceObservations,
      eq(intelligenceObservations.id, intelligenceInsights.observationId),
    )
    .where(and(...conditions))
    .get();
  return row ?? null;
};

/**
 * Prunes the insights nothing keeps alive.
 *
 * An insight is prunable when it is older than the knowledge cutoff, when it
 * is no longer current (its observation is no longer `active`, or its source
 * revision is no longer the current projection revision of its subject) and
 * when nothing live names it — neither its observation nor its revision.
 *
 * Returns how many rows were removed.
 */
export const pruneInsightsInTx = (
  tx: JournalTx,
  before: number,
  limit: number,
  live: LiveReferenceIndex,
): number => {
  if (limit <= 0) return 0;
  let removed = 0;

  const candidates = tx
    .select({
      id: intelligenceInsights.id,
      observationId: intelligenceInsights.observationId,
      sourceRevision: intelligenceInsights.sourceRevision,
      subjectId: intelligenceInsights.subjectId,
    })
    .from(intelligenceInsights)
    .where(lt(intelligenceInsights.createdAt, before))
    .all();

  for (const candidate of candidates) {
    if (removed >= limit) break;
    // Nothing live may name the insight, by either of the ids it carries.
    // The index holds observation ids and projection revision ids, and those
    // are the two spaces the insight's ids live in.
    if (live.observationIds.has(candidate.observationId)) continue;
    if (live.revisionIds.has(candidate.sourceRevision)) continue;
    if (!isSuperseded(tx, candidate.observationId, candidate.subjectId, candidate.sourceRevision)) {
      continue;
    }
    tx.delete(intelligenceInsights).where(eq(intelligenceInsights.id, candidate.id)).run();
    removed += 1;
  }

  return removed;
};

/**
 * Whether an insight is no longer current.
 *
 * It is no longer current when its observation is gone or no longer `active`,
 * or when its source revision is not the subject's current projection
 * revision.
 */
const isSuperseded = (
  tx: JournalTx,
  observationId: string,
  subjectId: string,
  sourceRevision: string,
): boolean => {
  const observation = tx
    .select({ status: intelligenceObservations.status })
    .from(intelligenceObservations)
    .where(eq(intelligenceObservations.id, observationId))
    .get();
  if (!observation || observation.status !== "active") return true;
  const currentRevisionId = currentProjectionRevisionId(tx, subjectId);
  return currentRevisionId !== sourceRevision;
};

/**
 * The SQLite insight store.
 *
 * The factory is the only public surface of this module: a sibling domain
 * injects the port from `../contracts/insights` and never reaches the adapter
 * directly, so the boundary rule holds.
 */
export const createInsightStore = (): InsightStore => ({
  persistInsightInTx,
  readCurrentInsightInTx,
});

/**
 * The permissive shape of a projection snapshot.
 *
 * The snapshot carries many more facts than a review question may rest on, so
 * only the fields the evidence needs are picked out of it and the picked
 * object is what the strict evidence schema validates.
 */
const reviewEvidencePickSchema = z.object({
  symbol: z.string(),
  direction: z.string(),
  status: z.string(),
  currency: z.string(),
  netPnl: z.number(),
  fees: z.number(),
  durationMs: z.number().nullish(),
  timingQuality: z.string(),
});

/**
 * The evidence of one observation, read from its snapshot.
 *
 * The holding time comes from the observation row, not from the snapshot: the
 * journal nulls the duration unless the source stated the times, and a
 * question must not state a holding time the journal deliberately withheld.
 *
 * A snapshot that does not parse into the evidence schema is no evidence: the
 * reader returns null rather than a guess.
 */
const parseReviewEvidence = (raw: string, durationMs: number | null): ReviewEvidence | null => {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    return null;
  }
  const picked = reviewEvidencePickSchema.safeParse(snapshot);
  if (!picked.success) return null;
  const parsed = reviewEvidenceSchema.safeParse({
    symbol: picked.data.symbol,
    direction: picked.data.direction,
    status: picked.data.status,
    currency: picked.data.currency,
    netPnl: picked.data.netPnl,
    fees: picked.data.fees,
    durationMs,
    timingQuality: picked.data.timingQuality,
  });
  return parsed.success ? parsed.data : null;
};

/**
 * The current observation of one id, with the evidence a question may rest on.
 *
 * The observation is current only when it is still `active`, when it was
 * derived from the subject's current projection revision and when its account
 * still exists. A correction hides the older observation, exactly as it hides
 * the older question.
 */
const readCurrentObservationInTx = (
  tx: JournalTx,
  observationId: string,
): ReviewObservation | null => {
  const observation = tx
    .select({
      id: intelligenceObservations.id,
      subjectId: intelligenceObservations.subjectId,
      accountId: intelligenceObservations.accountId,
      sourceRevision: intelligenceObservations.sourceRevision,
      status: intelligenceObservations.status,
      durationMs: intelligenceObservations.durationMs,
      directFactsJson: intelligenceObservations.directFactsJson,
    })
    .from(intelligenceObservations)
    .where(eq(intelligenceObservations.id, observationId))
    .get();
  if (!observation || observation.status !== "active") return null;

  const currentRevisionId = currentProjectionRevisionId(tx, observation.subjectId);
  if (!currentRevisionId || currentRevisionId !== observation.sourceRevision) return null;

  const account = tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, observation.accountId))
    .get();
  if (!account) return null;

  const evidence = parseReviewEvidence(observation.directFactsJson, observation.durationMs);
  if (!evidence) return null;

  return {
    observationId: observation.id,
    subjectId: observation.subjectId,
    accountId: observation.accountId,
    sourceRevision: observation.sourceRevision,
    evidence,
  };
};

/**
 * The opportunity statuses that are still live.
 *
 * A suppressed opportunity is one the journal decided never to show, so it is
 * not live here: a question about that trade would push back at the trader
 * what the journal deliberately kept quiet about.
 */
const LIVE_REVIEW_OPPORTUNITY_STATUSES = ["pending", "eligible"] as const;

/**
 * Whether the observation still has a review opportunity worth a question.
 *
 * The opportunity of an observation is the one the producer named after it,
 * so its stored key is the producer key under the opportunity prefix.
 */
const isLiveInTx = (tx: JournalTx, observationId: string): boolean => {
  const row = tx
    .select({ id: intelligenceOpportunities.id })
    .from(intelligenceOpportunities)
    .where(
      and(
        eq(intelligenceOpportunities.dedupKey, opportunityKey(`observation/${observationId}`)),
        inArray(intelligenceOpportunities.status, [...LIVE_REVIEW_OPPORTUNITY_STATUSES]),
      ),
    )
    .get();
  return row !== undefined;
};

/** The reader that answers what is still true about an observation. */
export const createObservationEvidenceReader = (): ObservationEvidenceReader => ({
  readCurrentObservationInTx,
});

/** The reader that answers whether a review opportunity is still live. */
export const createReviewOpportunityReader = (): ReviewOpportunityReader => ({
  isLiveInTx,
});

/**
 * The id of the current projection revision of a trade identity.
 *
 * The identity names its current revision ordinal; the revision row of that
 * ordinal names the revision id.
 */
const currentProjectionRevisionId = (tx: JournalTx, subjectId: string): string | null => {
  const identity = tx
    .select({ revision: tradeIdentities.revision })
    .from(tradeIdentities)
    .where(eq(tradeIdentities.id, subjectId))
    .get();
  if (!identity) return null;
  const revision = tx
    .select({ id: tradeProjectionRevisions.id })
    .from(tradeProjectionRevisions)
    .where(
      and(
        eq(tradeProjectionRevisions.tradeId, subjectId),
        eq(tradeProjectionRevisions.revision, identity.revision),
      ),
    )
    .get();
  return revision?.id ?? null;
};
