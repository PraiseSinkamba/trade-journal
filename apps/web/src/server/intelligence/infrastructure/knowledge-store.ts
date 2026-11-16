import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import {
  accounts,
  intelligenceObservations,
  intelligenceSeedCheckpoints,
  knowledgeHypotheses,
  knowledgePatterns,
  observationEvidence,
  tradeIdentities,
  tradeProjectionRevisions,
} from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { newUuid } from "@/server/ids";
import type { TradeChanged } from "@/server/domain-events";
import type { JobClaim } from "../contracts/jobs";
import type { LiveReferenceIndex } from "./experience-store";
import {
  OBSERVATION_EVALUATOR_ID,
  OBSERVATION_EVALUATOR_VERSION,
  OBSERVATION_TYPE,
  type ObservationResult,
} from "../contracts/observations";

/**
 * The observation store (Phase 08).
 *
 * An observation is stored against the revision it was derived from, and it is
 * only ever stored when that revision is still the current one. The check
 * happens INSIDE the caller's transaction, never before it: a worker that read
 * the revision outside the transaction may act on a revision that is no longer
 * current, and a delayed old event must never revive old truth.
 *
 * The job and its delivery are acknowledged by the worker's effect store in
 * the same transaction, so this store writes the observation and nothing else.
 */

/**
 * Persists the observation of one trade change, in the caller's transaction.
 *
 * - a stale source (the event names a revision that is no longer the current
 *   one) cancels the output: nothing is written;
 * - a removed source invalidates the active observation of that trade;
 * - a deleted account cancels the output: nothing is written;
 * - an insufficient result writes nothing.
 */
export const persistObservationInTx = (
  tx: JournalTx,
  claim: JobClaim,
  event: TradeChanged,
  result: ObservationResult,
  now: number,
): void => {
  // The claim is part of the fixed contract of this store, but the
  // acknowledgement of the job and its delivery belongs to the effect store.
  void claim;

  // The fence: the trade identity must still exist, the event's revision must
  // still be the identity's current revision, and the account must still exist.
  const identity = tx
    .select({ id: tradeIdentities.id, revision: tradeIdentities.revision })
    .from(tradeIdentities)
    .where(eq(tradeIdentities.id, event.aggregate.id))
    .get();
  if (!identity) return;

  const current = tx
    .select({ id: tradeProjectionRevisions.id })
    .from(tradeProjectionRevisions)
    .where(
      and(
        eq(tradeProjectionRevisions.tradeId, identity.id),
        eq(tradeProjectionRevisions.revision, identity.revision),
      ),
    )
    .get();
  if (!current || current.id !== event.payload.projectionRevisionId) return;

  const account = tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, event.payload.accountId))
    .get();
  if (!account) return;

  const checkpoint = tx
    .select({ status: intelligenceSeedCheckpoints.status })
    .from(intelligenceSeedCheckpoints)
    .where(eq(intelligenceSeedCheckpoints.accountId, account.id))
    .get();
  if (checkpoint?.status === "suppressed") return;

  if (event.payload.kind === "removed") {
    // A removal invalidates what the journal observed: the trade is gone, so
    // the observation of it must never be active again.
    tx.update(intelligenceObservations)
      .set({ status: "invalidated", updatedAt: now })
      .where(
        and(
          eq(intelligenceObservations.subjectId, event.aggregate.id),
          eq(intelligenceObservations.evaluatorId, OBSERVATION_EVALUATOR_ID),
          eq(intelligenceObservations.evaluatorVersion, OBSERVATION_EVALUATOR_VERSION),
          eq(intelligenceObservations.type, OBSERVATION_TYPE),
          eq(intelligenceObservations.status, "active"),
        ),
      )
      .run();
    return;
  }

  if (result.kind === "insufficient_evidence") return;

  // The direct fact is the revision's own snapshot: what the journal computed,
  // verbatim. The derived observation is what the evaluator concluded.
  const direct = tx
    .select({ snapshotJson: tradeProjectionRevisions.snapshotJson })
    .from(tradeProjectionRevisions)
    .where(eq(tradeProjectionRevisions.id, result.evidence.revisionId))
    .get();
  if (!direct) return;

  tx.insert(intelligenceObservations)
    .values({
      id: newUuid(),
      subjectId: event.aggregate.id,
      sourceRevision: result.evidence.revisionId,
      evaluatorId: OBSERVATION_EVALUATOR_ID,
      evaluatorVersion: OBSERVATION_EVALUATOR_VERSION,
      type: OBSERVATION_TYPE,
      status: "active",
      accountId: result.evidence.accountId,
      currency: result.evidence.currency,
      netPnl: result.evidence.netPnl,
      fees: result.evidence.fees,
      tradeStatus: result.evidence.status,
      timingQuality: result.evidence.timingQuality,
      durationMs: result.evidence.durationMs,
      directFactsJson: direct.snapshotJson,
      observationJson: JSON.stringify(result),
      recordedAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        intelligenceObservations.subjectId,
        intelligenceObservations.sourceRevision,
        intelligenceObservations.evaluatorId,
        intelligenceObservations.evaluatorVersion,
        intelligenceObservations.type,
      ],
    })
    .run();

  // A repeated delivery keeps the original observation, so its id is read
  // back from the unique key rather than assumed.
  const stored = tx
    .select({ id: intelligenceObservations.id })
    .from(intelligenceObservations)
    .where(
      and(
        eq(intelligenceObservations.subjectId, event.aggregate.id),
        eq(intelligenceObservations.sourceRevision, result.evidence.revisionId),
        eq(intelligenceObservations.evaluatorId, OBSERVATION_EVALUATOR_ID),
        eq(intelligenceObservations.evaluatorVersion, OBSERVATION_EVALUATOR_VERSION),
        eq(intelligenceObservations.type, OBSERVATION_TYPE),
      ),
    )
    .get();
  if (!stored) return;

  // The new observation supersedes the older active ones of the same subject.
  // The observation of this very revision is never superseded: a repeated
  // delivery must leave it active.
  tx.update(intelligenceObservations)
    .set({ status: "superseded", updatedAt: now })
    .where(
      and(
        eq(intelligenceObservations.subjectId, event.aggregate.id),
        eq(intelligenceObservations.evaluatorId, OBSERVATION_EVALUATOR_ID),
        eq(intelligenceObservations.evaluatorVersion, OBSERVATION_EVALUATOR_VERSION),
        eq(intelligenceObservations.type, OBSERVATION_TYPE),
        eq(intelligenceObservations.status, "active"),
        ne(intelligenceObservations.sourceRevision, result.evidence.revisionId),
      ),
    )
    .run();

  tx.insert(observationEvidence)
    .values({ observationId: stored.id, revisionId: result.evidence.revisionId })
    .onConflictDoNothing()
    .run();
};

/**
 * Prunes the superseded and invalidated knowledge records nothing refers to.
 *
 * A record is prunable when it is not the newest version of its subject — a
 * newer version says what the subject is now — and when it is older than the
 * cutoff. A record that is still the newest of its subject stays: it is the
 * current knowledge of that subject, whatever its status.
 *
 * Returns how many rows were removed.
 */
export const pruneKnowledgeInTx = (
  tx: JournalTx,
  before: number,
  limit: number,
  live: LiveReferenceIndex,
): number => {
  if (limit <= 0) return 0;
  let removed = 0;

  for (const record of knowledgeHypothesesInTx(tx, before)) {
    if (removed >= limit) break;
    if (isNewestOfSubject(tx, knowledgeHypotheses, record)) continue;
    if (isCitedByLive(record, live)) continue;
    tx.delete(knowledgeHypotheses).where(eq(knowledgeHypotheses.id, record.id)).run();
    removed += 1;
  }

  for (const record of knowledgePatternsInTx(tx, before)) {
    if (removed >= limit) break;
    if (isNewestOfSubject(tx, knowledgePatterns, record)) continue;
    if (isCitedByLive(record, live)) continue;
    tx.delete(knowledgePatterns).where(eq(knowledgePatterns.id, record.id)).run();
    removed += 1;
  }

  return removed;
};

/**
 * Whether a live record still cites a knowledge record.
 *
 * A knowledge record has its own id, but the live records name **observations**
 * and **projection revisions** — never a knowledge id. A record is therefore
 * cited when its subject is an observation a live record names, or when its
 * evidence names a revision a live record rests on.
 */
const isCitedByLive = (
  record: { subjectType: string; subjectId: string; evidenceIdsJson: string },
  live: LiveReferenceIndex,
): boolean => {
  if (record.subjectType === "observation" && live.observationIds.has(record.subjectId)) {
    return true;
  }
  return evidenceIdsOf(record.evidenceIdsJson).some((id) => live.revisionIds.has(id));
};

/**
 * Reads the ids of a stored evidence list.
 *
 * A list that cannot be read names nothing: a record with unreadable evidence
 * rests on no evidence, so nothing has to survive for it.
 */
const evidenceIdsOf = (raw: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
};

/**
 * Prunes the superseded and invalidated observations nothing refers to.
 *
 * An observation is prunable when it is not `active`, when it is older than
 * the cutoff, and when no live record names it — neither the observation
 * itself nor one of the revisions it carries.
 */
export const pruneObservationsInTx = (
  tx: JournalTx,
  before: number,
  limit: number,
  live: LiveReferenceIndex,
): number => {
  if (limit <= 0) return 0;
  let removed = 0;

  const candidates = tx
    .select({ id: intelligenceObservations.id })
    .from(intelligenceObservations)
    .where(
      and(
        inArray(intelligenceObservations.status, ["superseded", "invalidated"]),
        lt(intelligenceObservations.updatedAt, before),
      ),
    )
    .limit(limit)
    .all();

  for (const candidate of candidates) {
    if (removed >= limit) break;
    if (live.observationIds.has(candidate.id)) continue;
    const links = tx
      .select({ revisionId: observationEvidence.revisionId })
      .from(observationEvidence)
      .where(eq(observationEvidence.observationId, candidate.id))
      .all();
    if (links.some((link) => live.revisionIds.has(link.revisionId))) continue;
    tx.delete(intelligenceObservations).where(eq(intelligenceObservations.id, candidate.id)).run();
    removed += 1;
  }

  return removed;
};

/** The superseded and invalidated hypotheses older than the cutoff. */
const knowledgeHypothesesInTx = (tx: JournalTx, before: number) =>
  tx
    .select({
      id: knowledgeHypotheses.id,
      subjectType: knowledgeHypotheses.subjectType,
      subjectId: knowledgeHypotheses.subjectId,
      version: knowledgeHypotheses.version,
      evidenceIdsJson: knowledgeHypotheses.evidenceIdsJson,
    })
    .from(knowledgeHypotheses)
    .where(
      and(
        inArray(knowledgeHypotheses.status, ["superseded", "invalidated"]),
        lt(knowledgeHypotheses.updatedAt, before),
      ),
    )
    .all();

/** The superseded and invalidated patterns older than the cutoff. */
const knowledgePatternsInTx = (tx: JournalTx, before: number) =>
  tx
    .select({
      id: knowledgePatterns.id,
      subjectType: knowledgePatterns.subjectType,
      subjectId: knowledgePatterns.subjectId,
      version: knowledgePatterns.version,
      evidenceIdsJson: knowledgePatterns.evidenceIdsJson,
    })
    .from(knowledgePatterns)
    .where(
      and(
        inArray(knowledgePatterns.status, ["superseded", "invalidated"]),
        lt(knowledgePatterns.updatedAt, before),
      ),
    )
    .all();

/**
 * Whether a record is the newest version of its subject.
 *
 * The newest version is the current knowledge of the subject, so it survives
 * whatever its status says.
 */
const isNewestOfSubject = (
  tx: JournalTx,
  table: typeof knowledgeHypotheses | typeof knowledgePatterns,
  record: { subjectType: string; subjectId: string; version: number },
): boolean => {
  const newest = tx
    .select({ version: sql<number>`max(${table.version})` })
    .from(table)
    .where(and(eq(table.subjectType, record.subjectType), eq(table.subjectId, record.subjectId)))
    .get();
  return (newest?.version ?? record.version) === record.version;
};
