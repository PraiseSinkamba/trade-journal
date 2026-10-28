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
  executions,
  trades,
  tradeIdentities,
  tradeProjectionRevisions,
} from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { defaultRisk } from "@/lib/journal-defaults";
import { newUuid } from "../ids";
import { getJournalDefaultsInTx, getMultipliersInTx } from "../settings";
import { appendDomainEvent } from "../domain-event-store";
import type { ChangeContext, TradeChanged, TradeChangedKind } from "../domain-events";
import {
  executionMembershipKey,
  recordProjectionRevision,
  resolveIdentity,
  retireIdentity,
} from "./identity";
import { fingerprintProjection, type ProjectionInput } from "./projection";

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
 * Whether production event capture is on.
 *
 * One global switch, never per path: the phase guide keeps production capture
 * off until the historical baseline exists, and a per-path switch would let the
 * event stream become partial. The tests turn it on explicitly.
 */
export const isEventCaptureEnabled = (): boolean => {
  const value = process.env.JOURNAL_EVENT_CAPTURE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on";
};

/** The projection of one rebuilt cycle, as the fingerprint sees it. */
const projectionOf = (account: { currency: string }, trip: RoundTrip): ProjectionInput => ({
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
  // Every fill in this phase carries a source-stated time. The evidence
  // sidecar (Phase 08) refines this without changing the financial facts.
  timingQuality: "source_reported",
});

/**
 * The projection the journal persisted for a rebuilt cycle, rebuilt from the
 * stored row.
 *
 * The comparison is against this prior persisted projection, not against the
 * identity chain: a journal that predates the evidence layer still knows what
 * it holds, so an unchanged projection is unchanged whether or not an identity
 * has been recorded for it yet.
 */
const projectionOfRow = (
  account: { currency: string },
  row: typeof trades.$inferSelect,
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
  timingQuality: "source_reported",
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
    const projection = projectionOf(account, trip);
    const priorRow = priorByKey.get(trip.key);
    // The journal's own prior state decides whether anything changed. A
    // projection whose facts are identical to the stored row is unchanged,
    // whether or not an identity was recorded for it before.
    const changed = priorRow
      ? fingerprintProjection(projectionOfRow(account, priorRow)) !==
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
    if (!isEventCaptureEnabled()) continue;
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
    if (!lastRevision || !isEventCaptureEnabled()) continue;
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
