import { and, eq, ne } from "drizzle-orm";
import {
  accounts,
  intelligenceObservations,
  observationEvidence,
  tradeIdentities,
  tradeProjectionRevisions,
} from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { newUuid } from "@/server/ids";
import type { TradeChanged } from "@/server/domain-events";
import type { JobClaim } from "../contracts/jobs";
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
