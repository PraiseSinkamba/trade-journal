import { and, eq, inArray } from "drizzle-orm";
import {
  buildRoundTrips,
  type ExitAttribution,
  type Execution,
  type ProfitCalcMethod,
  type RoundTrip,
} from "@luxalgo/journal-core";
import {
  accounts,
  executionEvidence,
  executions,
  trades,
  tradeIdentities,
  tradeProjectionRevisions,
} from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { defaultRisk } from "@/lib/journal-defaults";
import { newUuid } from "../ids";
import {
  getJournalDefaultsInTx,
  getJournalEventCaptureInTx,
  getMultipliersInTx,
} from "../settings";
import { appendDomainEvent } from "../domain-event-store";
import type { ChangeContext, TradeChanged, TradeChangedKind } from "../domain-events";
import {
  executionMembershipKey,
  recordProjectionRevision,
  resolveIdentity,
  retireIdentity,
} from "./identity";
import {
  fingerprintProjection,
  isSyntheticExecutionId,
  type ProjectionInput,
  type TimingQuality,
} from "./projection";

/**
 * The trade reconciliation boundary (Phase 05).
 *
 * One transaction, one writer: the prior persisted projections are read, the
 * account is reconstructed through the existing round-trip engine, the two are
 * compared, and the projection rows, the immutable projection revisions and the
 * durable domain events are written together. A projection that did not change
 * writes no revision and raises no event.
 */

export type { ChangeContext } from "../domain-events";

/**
 * Builds the context of one change: who made it, and whether it is live.
 *
 * `operationId` ties every event of one mutation together, and `recordedAt` is
 * the commit time — never a broker close time.
 */
export const changeContext = (
  origin: ChangeContext["origin"],
  mode: ChangeContext["mode"],
): ChangeContext => ({
  operationId: newUuid(),
  origin,
  mode,
  recordedAt: new Date().toISOString(),
});

/** What one reconciliation changed. */
export interface ReconcileResult {
  discovered: number;
  opened: number;
  closed: number;
  revised: number;
  removed: number;
  unchanged: number;
  ambiguous: number;
}

/**
 * How strong a quality is.
 *
 * The weakest quality wins: `unknown` beats `reconstructed`, which beats
 * `source_reported`. One fill the source could not time makes the timing of
 * the whole projection unproven.
 */
const QUALITY_RANK: Record<TimingQuality, number> = {
  source_reported: 0,
  reconstructed: 1,
  unknown: 2,
};

/** The weakest of the given qualities. */
const weakestQuality = (qualities: readonly TimingQuality[]): TimingQuality => {
  let weakest: TimingQuality = "source_reported";
  for (const quality of qualities) {
    if (QUALITY_RANK[quality] > QUALITY_RANK[weakest]) weakest = quality;
  }
  return weakest;
};

/**
 * The quality the journal recorded for one projection, read from the snapshot
 * of the identity's current revision.
 *
 * A projection the journal never recorded a revision for has no recorded
 * quality; the journal falls back to the assumption it made for every
 * ordinary source fill.
 */
const recordedQualityOf = (snapshotJson: string): TimingQuality | null => {
  try {
    const snapshot = JSON.parse(snapshotJson) as { timingQuality?: unknown };
    const quality = snapshot.timingQuality;
    if (quality === "source_reported" || quality === "reconstructed" || quality === "unknown") {
      return quality;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * The quality context of one reconciliation.
 *
 * `derivedOf` answers what the source can prove about a projection's fills
 * right now. `recordedOf` answers what the journal recorded for a trade the
 * last time it recorded a revision. The two are compared against each other:
 * an unchanged projection stays unchanged, and a corrected quality produces
 * exactly one revision.
 */
interface QualityContext {
  /** The weakest quality among the given fills. */
  derivedOf: (executionIds: readonly string[]) => TimingQuality;
  /** The quality the journal recorded for a trade key. */
  recordedOf: (tradeKey: string) => TimingQuality;
}

/**
 * Reads source-only timing quality without loading recorded projection history.
 *
 * The evidence sidecar holds what the source could prove about a fill; a fill
 * without a sidecar row is an ordinary source fill, whose time the source
 * stated, unless the journal invented the fill — a synthetic opening fill is
 * never source-reported timing, and without a sidecar row nothing is known
 * about it.
 */
export const derivedQualityOf = (
  tx: JournalTx,
  rows: readonly (typeof executions.$inferSelect)[],
): QualityContext["derivedOf"] => {
  const evidenceByExecution = new Map<string, TimingQuality>();
  const executionIds = rows.map((row) => row.id);
  for (let i = 0; i < executionIds.length; i += 500) {
    const chunk = executionIds.slice(i, i + 500);
    if (chunk.length === 0) continue;
    const evidenceRows = tx
      .select({
        executionId: executionEvidence.executionId,
        timingQuality: executionEvidence.timingQuality,
      })
      .from(executionEvidence)
      .where(inArray(executionEvidence.executionId, chunk))
      .all();
    for (const row of evidenceRows) evidenceByExecution.set(row.executionId, row.timingQuality);
  }

  const syntheticByExecution = new Map<string, boolean>();
  for (const row of rows) {
    const metadata = row.importMetadataJson
      ? (JSON.parse(row.importMetadataJson) as { id?: string })
      : undefined;
    syntheticByExecution.set(row.id, isSyntheticExecutionId(metadata?.id ?? null));
  }

  return (ids: readonly string[]): TimingQuality => {
    if (ids.length === 0) return "unknown";
    const qualities: TimingQuality[] = [];
    for (const id of ids) {
      const proven = evidenceByExecution.get(id);
      if (proven) {
        qualities.push(proven);
        continue;
      }
      qualities.push(syntheticByExecution.get(id) ? "unknown" : "source_reported");
    }
    return weakestQuality(qualities);
  };
};

/** Combines source quality with the account's previously recorded projection quality. */
const qualityContextOf = (
  tx: JournalTx,
  accountId: string,
  rows: readonly (typeof executions.$inferSelect)[],
): QualityContext => {
  const derivedOf = derivedQualityOf(tx, rows);

  // The quality the journal recorded: the snapshot of the identity's current
  // revision. A projection the journal never recorded a revision for has no
  // recorded quality.
  const identities = tx
    .select()
    .from(tradeIdentities)
    .where(eq(tradeIdentities.accountId, accountId))
    .all();
  const snapshotByRevision = new Map<string, string>();
  const identityIds = identities.map((identity) => identity.id);
  for (let i = 0; i < identityIds.length; i += 500) {
    const chunk = identityIds.slice(i, i + 500);
    if (chunk.length === 0) continue;
    const revisions = tx
      .select({
        tradeId: tradeProjectionRevisions.tradeId,
        revision: tradeProjectionRevisions.revision,
        snapshotJson: tradeProjectionRevisions.snapshotJson,
      })
      .from(tradeProjectionRevisions)
      .where(inArray(tradeProjectionRevisions.tradeId, chunk))
      .all();
    for (const revision of revisions) {
      snapshotByRevision.set(`${revision.tradeId}:${revision.revision}`, revision.snapshotJson);
    }
  }
  const recordedByKey = new Map<string, TimingQuality>();
  for (const identity of identities) {
    if (!identity.currentKey) continue;
    const snapshotJson = snapshotByRevision.get(`${identity.id}:${identity.revision}`);
    if (!snapshotJson) continue;
    const recorded = recordedQualityOf(snapshotJson);
    if (recorded) recordedByKey.set(identity.currentKey, recorded);
  }

  return {
    derivedOf,
    recordedOf: (tradeKey: string): TimingQuality =>
      recordedByKey.get(tradeKey) ?? "source_reported",
  };
};

/** The projection of one rebuilt cycle, as the fingerprint sees it. */
const projectionOf = (
  account: { currency: string },
  trip: RoundTrip,
  timingQuality: TimingQuality,
): ProjectionInput => ({
  accountId: trip.accountId,
  tradeKey: trip.key,
  symbol: trip.symbol,
  assetClass: trip.assetClass ?? null,
  direction: trip.direction,
  status: trip.status,
  openedAt: trip.openedAt,
  closedAt: trip.closedAt ?? null,
  quantity: trip.quantity,
  openQuantity: trip.openQuantity,
  avgEntry: trip.avgEntry,
  avgExit: trip.avgExit ?? null,
  grossPnl: trip.grossPnl,
  fees: trip.fees,
  netPnl: trip.netPnl,
  executionCount: trip.executionCount,
  executionIds: trip.executionIds,
  exits: trip.exits,
  durationMs: trip.durationMs ?? null,
  currency: account.currency,
  timingQuality,
});

/**
 * The projection the journal persisted for a rebuilt cycle, rebuilt from the
 * stored row.
 *
 * The comparison is against this prior persisted projection, not against the
 * identity chain: a journal that predates the evidence layer still knows what
 * it holds, so an unchanged projection is unchanged whether or not an identity
 * has been recorded for it yet. The quality is the one the journal recorded,
 * so the comparison is recorded against derived.
 */
export const projectionOfRow = (
  account: { currency: string },
  row: typeof trades.$inferSelect,
  timingQuality: TimingQuality,
): ProjectionInput => ({
  accountId: row.accountId,
  tradeKey: row.key,
  symbol: row.symbol,
  assetClass: row.assetClass,
  direction: row.direction,
  status: row.status,
  openedAt: row.openedAt,
  closedAt: row.closedAt,
  quantity: row.quantity,
  openQuantity: row.openQuantity,
  avgEntry: row.avgEntry,
  avgExit: row.avgExit,
  grossPnl: row.grossPnl,
  fees: row.fees,
  netPnl: row.netPnl,
  executionCount: row.executionCount,
  executionIds: JSON.parse(row.executionIdsJson) as string[],
  exits: JSON.parse(row.exitsJson) as ExitAttribution[],
  durationMs: row.durationMs,
  currency: account.currency,
  timingQuality,
});

/**
 * How a changed projection is classified.
 *
 * A projection the journal holds for the first time is `discovered`, or
 * `opened` when it is still open and the change is live. A cycle the journal
 * observed open and that is now closed is `closed`. Every other change to a
 * known projection is `revised`.
 */
const changeKind = (
  priorStatus: string | undefined,
  status: string,
  mode: ChangeContext["mode"],
): TradeChangedKind => {
  if (priorStatus === undefined) {
    if (status === "open" && mode === "live") return "opened";
    return "discovered";
  }
  if (priorStatus === "open" && status !== "open") return "closed";
  return "revised";
};

const emptyResult = (): ReconcileResult => ({
  discovered: 0,
  opened: 0,
  closed: 0,
  revised: 0,
  removed: 0,
  unchanged: 0,
  ambiguous: 0,
});

/**
 * How one reconciliation is told about a proven transfer.
 */
export interface ReconcileOptions {
  /**
   * The identities a proven transfer continues, keyed by the execution
   * membership of the projection (`executionMembershipKey`).
   */
  readonly transfers?: ReadonlyMap<string, string>;
}

/**
 * Reconciles one account inside the caller's transaction.
 *
 * The caller must not do any external work here: fetch and parse outside, then
 * enter this function with a transaction that is already open.
 */
export const reconcileAccountInTx = (
  tx: JournalTx,
  accountId: string,
  context: ChangeContext,
  options: ReconcileOptions = {},
): ReconcileResult => {
  const result = emptyResult();
  const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) return result;
  const captureEvents = getJournalEventCaptureInTx(tx);

  // The prior persisted projections, read before they are overwritten.
  const priorRows = tx.select().from(trades).where(eq(trades.accountId, accountId)).all();
  const priorByKey = new Map(priorRows.map((row) => [row.key, row]));

  const rows = tx.select().from(executions).where(eq(executions.accountId, accountId)).all();
  const executionInputs: Execution[] = rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    executedAt: row.executedAt,
    assetClass: (row.assetClass ?? undefined) as Execution["assetClass"],
    source: row.source,
    importMetadata: row.importMetadataJson ? JSON.parse(row.importMetadataJson) : undefined,
  }));

  const defaults = getJournalDefaultsInTx(tx);
  const trips = buildRoundTrips(executionInputs, {
    method: account.profitCalcMethod as ProfitCalcMethod,
    multipliers: getMultipliersInTx(tx),
  });

  // The quality of the account's fills and the quality the journal recorded
  // for its projections. Both are read once: a reconcile of a long history
  // must not query per fill and per trade.
  const quality = qualityContextOf(tx, accountId, rows);

  // The projection rows. Only the computed columns are written, so the
  // annotations the user owns survive every rebuild.
  const liveKeys = new Set(trips.map((trip) => trip.key));
  for (const trip of trips) {
    const computed = {
      accountId: trip.accountId,
      symbol: trip.symbol,
      assetClass: trip.assetClass ?? null,
      direction: trip.direction,
      status: trip.status,
      openedAt: trip.openedAt,
      closedAt: trip.closedAt ?? null,
      quantity: trip.quantity,
      openQuantity: trip.openQuantity,
      avgEntry: trip.avgEntry,
      avgExit: trip.avgExit ?? null,
      grossPnl: trip.grossPnl,
      fees: trip.fees,
      netPnl: trip.netPnl,
      executionCount: trip.executionCount,
      executionIdsJson: JSON.stringify(trip.executionIds),
      exitsJson: JSON.stringify(trip.exits),
      durationMs: trip.durationMs ?? null,
    };
    tx.insert(trades)
      .values({
        key: trip.key,
        ...computed,
        ...defaultRisk(trip.avgEntry, trip.direction, accountId, trip.symbol, defaults),
      })
      .onConflictDoUpdate({ target: trades.key, set: computed })
      .run();
  }
  const vanished = priorRows.filter((row) => !liveKeys.has(row.key)).map((row) => row.key);
  // Keep each statement below SQLite's bind-parameter limit, even for long histories.
  for (let i = 0; i < vanished.length; i += 500) {
    tx.delete(trades)
      .where(and(eq(trades.accountId, accountId), inArray(trades.key, vanished.slice(i, i + 500))))
      .run();
  }

  // The revision chain is the factual evidence of what the journal recorded, and
  // it is written whether or not the events are captured: it is what makes an
  // unchanged projection recognisable as unchanged.
  for (const trip of trips) {
    const projection = projectionOf(account, trip, quality.derivedOf(trip.executionIds));
    const priorRow = priorByKey.get(trip.key);
    // The journal's own prior state decides whether anything changed. A
    // projection whose facts are identical to the stored row is unchanged,
    // whether or not an identity was recorded for it before. The quality the
    // journal recorded is compared against the quality the source can prove
    // now, so a corrected quality is one revision — never two.
    const changed = priorRow
      ? fingerprintProjection(projectionOfRow(account, priorRow, quality.recordedOf(trip.key))) !==
        fingerprintProjection(projection)
      : true;
    if (!changed) {
      result.unchanged++;
      continue;
    }
    // A projection a proven transfer claims continues the identity it had: the
    // facts are the same, only the account they belong to changed.
    const transferSourceId = options.transfers?.get(executionMembershipKey(trip.executionIds));
    const resolution = resolveIdentity(tx, {
      accountId,
      tradeKey: trip.key,
      executionIds: trip.executionIds,
      operationId: context.operationId,
      explicitTransferSourceId: transferSourceId ?? null,
    });
    if (resolution.kind === "ambiguous") {
      // The projection is written; the identity is not guessed.
      result.ambiguous++;
      continue;
    }
    const recorded = recordProjectionRevision(tx, {
      resolution,
      accountId,
      tradeKey: trip.key,
      projection,
      operationId: context.operationId,
      recordedAt: Date.parse(context.recordedAt),
    });
    if (!recorded.changed) {
      result.unchanged++;
      continue;
    }
    // A projection a proven transfer claims is revised, not discovered: its
    // facts are the same and only the account they belong to changed.
    const kind: TradeChangedKind = transferSourceId
      ? "revised"
      : changeKind(priorRow?.status, trip.status, context.mode);
    result[kind]++;
    if (!captureEvents) continue;
    const event: TradeChanged = {
      id: newUuid(),
      type: "trade.projection_changed",
      schemaVersion: 1,
      aggregate: { type: "trade", id: recorded.tradeId, revision: recorded.revision },
      correlationId: context.operationId,
      origin: context.origin,
      recordedAt: context.recordedAt,
      ...(kind === "closed" && trip.closedAt ? { occurredAt: trip.closedAt } : {}),
      payload: {
        accountId,
        tradeKey: trip.key,
        kind,
        mode: context.mode,
        projectionRevisionId: recorded.revisionId,
      },
    };
    appendDomainEvent(tx, event);
  }

  // A projection that disappeared is retired: its identity ends, so a later
  // reappearance of the same key gets a new identity and the old conclusions
  // never revive silently.
  for (const row of priorRows) {
    if (liveKeys.has(row.key)) continue;
    result.removed++;
    const identity = tx
      .select()
      .from(tradeIdentities)
      .where(and(eq(tradeIdentities.currentKey, row.key), eq(tradeIdentities.state, "active")))
      .get();
    // A projection the journal never recorded evidence for has no identity to
    // end and no revision to announce. Its disappearance is still counted.
    if (!identity) continue;
    const lastRevision = tx
      .select()
      .from(tradeProjectionRevisions)
      .where(
        and(
          eq(tradeProjectionRevisions.tradeId, identity.id),
          eq(tradeProjectionRevisions.revision, identity.revision),
        ),
      )
      .get();
    retireIdentity(tx, { tradeId: identity.id });
    if (!lastRevision || !captureEvents) continue;
    const event: TradeChanged = {
      id: newUuid(),
      type: "trade.projection_changed",
      schemaVersion: 1,
      // The next revision number: the last revision already has its own event,
      // and the outbox key allows one event per aggregate revision.
      aggregate: { type: "trade", id: identity.id, revision: identity.revision + 1 },
      correlationId: context.operationId,
      origin: context.origin,
      recordedAt: context.recordedAt,
      payload: {
        accountId,
        tradeKey: row.key,
        kind: "removed",
        mode: context.mode,
        projectionRevisionId: lastRevision.id,
      },
    };
    appendDomainEvent(tx, event);
  }

  return result;
};
