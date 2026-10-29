import { eq } from "drizzle-orm";
import { db, type JournalDb } from "@/db/connection";
import { domainOutbox, intelligenceJobs, tradeProjectionRevisions } from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { parseTradeChanged, type TradeChanged } from "@/server/domain-events";
import {
  evaluateTradeProjection,
  tradeProjectionEvidenceSchema,
  type ObservationResult,
} from "./contracts/observations";
import type { JobRecord } from "./contracts/jobs";
import { createBackfillService } from "./infrastructure/backfill";
import { createJobStore, createReplayService } from "./infrastructure/jobs";
import { persistObservationInTx } from "./infrastructure/knowledge-store";
import type { OutboxHandler } from "./infrastructure/outbox";
import type { JobHandler } from "./infrastructure/worker";

/**
 * The intelligence composition.
 *
 * This module wires historical discovery and committed trade changes into
 * durable observations. Services bind to the supplied journal connection;
 * handlers run inside the caller's transaction without provider access.
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

/** Binds historical seed, replay and observation handlers to one journal. */
export const createIntelligenceServices = (deps: {
  readonly db: JournalDb;
  readonly clock?: () => number;
  readonly seedBatchSize?: number;
}) => {
  const clock = deps.clock ?? Date.now;
  const jobs = createJobStore(deps.db);
  const backfill = createBackfillService({
    db: deps.db,
    jobs,
    clock,
    batchSize: deps.seedBatchSize,
  });
  const seedHandler: JobHandler = {
    id: "seed-account",
    version: "1",
    run: (tx, job): void => {
      if (job.payload.type !== "seed_account") return;
      backfill.seedAccountInTx(tx, job.payload.accountId, job.id);
    },
  };
  const handlers: readonly JobHandler[] = [createTradeObservationHandler({ clock }), seedHandler];
  const outboxHandlers: readonly OutboxHandler[] = [
    { id: OBSERVATION_HANDLER_ID, version: OBSERVATION_HANDLER_VERSION },
  ];
  const replay = createReplayService({ db: deps.db, jobs, handlers: outboxHandlers, clock });
  return {
    seedAccount: backfill.seedAccount,
    requestReplay: replay.requestReplay,
    handlers,
    outboxHandlers,
  };
};

const defaultServices = createIntelligenceServices({ db });

/** Seeds one bounded historical batch on the default journal. */
export const seedAccount = defaultServices.seedAccount;

/** Requests durable replay on the default journal. */
export const requestReplay = defaultServices.requestReplay;

/** Every handler registered with the default worker. */
export const observationHandlers: readonly JobHandler[] = defaultServices.handlers;

/** Only observations subscribe to committed trade-change events. */
export const observationOutboxHandlers: readonly OutboxHandler[] = defaultServices.outboxHandlers;
