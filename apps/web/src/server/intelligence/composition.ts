import { eq } from "drizzle-orm";
import { domainOutbox, intelligenceJobs, tradeProjectionRevisions } from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { parseTradeChanged, type TradeChanged } from "@/server/domain-events";
import {
  evaluateTradeProjection,
  tradeProjectionEvidenceSchema,
  type ObservationResult,
} from "./contracts/observations";
import type { JobRecord } from "./contracts/jobs";
import { persistObservationInTx } from "./infrastructure/knowledge-store";
import type { OutboxHandler } from "./infrastructure/outbox";
import type { JobHandler } from "./infrastructure/worker";

/**
 * The observation composition (Phase 08).
 *
 * This module is the single wiring point of the observation path: it turns a
 * committed trade change into a durable observation, and it subscribes the
 * outbox to that work. Everything it touches lives in the caller's
 * transaction — there is no network call and no work outside it.
 */

/** The handler that subscribes to the outbox. */
export const OBSERVATION_HANDLER_ID = "trade-observation";

/** The version of that handler. */
export const OBSERVATION_HANDLER_VERSION = "1";

/**
 * Rebuilds the committed event from its outbox row.
 *
 * The stored payload holds only the event payload, so the envelope is
 * reassembled from the row and validated against the strict contract. A row
 * that does not describe a trade change never becomes an observation.
 */
const tradeChangedOf = (row: typeof domainOutbox.$inferSelect): TradeChanged =>
  parseTradeChanged({
    id: row.id,
    type: "trade.projection_changed",
    schemaVersion: row.schemaVersion,
    aggregate: {
      type: row.aggregateType,
      id: row.aggregateId,
      revision: row.aggregateRevision,
    },
    correlationId: row.correlationId,
    ...(row.causationId ? { causationId: row.causationId } : {}),
    origin: row.origin,
    recordedAt: new Date(row.recordedAt).toISOString(),
    ...(row.occurredAt !== null ? { occurredAt: new Date(row.occurredAt).toISOString() } : {}),
    payload: JSON.parse(row.payloadJson),
  });

/**
 * Creates the job handler that turns a committed trade change into a
 * persistent observation.
 */
export const createTradeObservationHandler = (deps?: {
  readonly clock?: () => number;
}): JobHandler => ({
  id: OBSERVATION_HANDLER_ID,
  version: OBSERVATION_HANDLER_VERSION,
  run: (tx: JournalTx, job: JobRecord): void => {
    if (job.payload.type !== "evaluate_trade") return;

    const now = deps?.clock?.() ?? Date.now();

    // The handler receives no claim, so the claim is rebuilt from the job row
    // inside the transaction. A job row that is gone authorises nothing.
    const jobRow = tx
      .select({
        id: intelligenceJobs.id,
        owner: intelligenceJobs.owner,
        fence: intelligenceJobs.fence,
        leaseUntil: intelligenceJobs.leaseUntil,
      })
      .from(intelligenceJobs)
      .where(eq(intelligenceJobs.id, job.id))
      .get();
    if (!jobRow) return;
    const claim = {
      jobId: jobRow.id,
      owner: jobRow.owner ?? "",
      fence: jobRow.fence,
      leaseUntil: jobRow.leaseUntil ?? 0,
    };

    const row = tx
      .select()
      .from(domainOutbox)
      .where(eq(domainOutbox.id, job.payload.eventId))
      .get();
    if (!row) return;

    const event = tradeChangedOf(row);

    let result: ObservationResult;
    if (event.payload.kind === "removed") {
      // The removal invalidates the observation of that trade; it observes
      // nothing new.
      result = { kind: "insufficient_evidence", reason: "source_removed" };
    } else {
      const revision = tx
        .select()
        .from(tradeProjectionRevisions)
        .where(eq(tradeProjectionRevisions.id, event.payload.projectionRevisionId))
        .get();
      if (!revision) {
        result = { kind: "insufficient_evidence", reason: "source_removed" };
      } else {
        // The evidence comes from the immutable revision and its snapshot,
        // never from whatever the trade happens to be now.
        const snapshot = JSON.parse(revision.snapshotJson) as Record<string, unknown>;
        const evidence = tradeProjectionEvidenceSchema.parse({
          revisionId: revision.id,
          tradeId: revision.tradeId,
          revision: revision.revision,
          accountId: revision.accountId,
          tradeKey: revision.tradeKey,
          currency: snapshot.currency,
          status: snapshot.status,
          netPnl: snapshot.netPnl,
          fees: snapshot.fees,
          openQuantity: snapshot.openQuantity,
          openedAt: snapshot.openedAt,
          closedAt: snapshot.closedAt ?? null,
          timingQuality: snapshot.timingQuality,
          durationMs: snapshot.durationMs ?? null,
          identityResolution: revision.resolution,
        });
        result = evaluateTradeProjection(evidence);
      }
    }

    persistObservationInTx(tx, claim, event, result, now);
  },
});

/** Every handler this phase registers with the worker. */
export const observationHandlers: readonly JobHandler[] = [createTradeObservationHandler()];

/** Every handler this phase registers with the outbox. */
export const observationOutboxHandlers: readonly OutboxHandler[] = [
  { id: OBSERVATION_HANDLER_ID, version: OBSERVATION_HANDLER_VERSION },
];
