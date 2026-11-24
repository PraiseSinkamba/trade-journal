import { and, asc, eq, isNull } from "drizzle-orm";
import type { JournalTx } from "@/db/transaction";
import { domainOutbox } from "@/db/schema";
import { parseTradeChanged, MAX_EVENT_PAYLOAD_BYTES, type TradeChanged } from "./domain-events";

/**
 * The domain event store (Phase 04).
 *
 * A committed trade change is appended here, inside the caller's transaction.
 * The event is therefore committed with the change that caused it: a rolled
 * back transaction leaves no event, and a committed one always leaves an event.
 *
 * The outbox table's persistence lives here — the contract review puts it at
 * `server/domain-event-store.ts`, so trading does not depend on the
 * intelligence runtime.
 */

/** A stored event, as the fanout sees it. */
export interface PendingEvent {
  readonly id: string;
  readonly type: string;
  readonly payloadJson: string;
}

/**
 * Appends a domain event.
 *
 * The append is idempotent: the unique key over the aggregate revision and the
 * event type means one aggregate revision never produces two events.
 */
export function appendDomainEvent(tx: JournalTx, event: TradeChanged): void {
  const parsed = parseTradeChanged(event);
  const payloadJson = JSON.stringify(parsed.payload);
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_EVENT_PAYLOAD_BYTES) {
    throw new Error(
      `Event ${parsed.id} exceeds the ${MAX_EVENT_PAYLOAD_BYTES} byte payload limit.`,
    );
  }
  tx.insert(domainOutbox)
    .values({
      id: parsed.id,
      type: parsed.type,
      schemaVersion: parsed.schemaVersion,
      aggregateType: parsed.aggregate.type,
      aggregateId: parsed.aggregate.id,
      aggregateRevision: parsed.aggregate.revision,
      correlationId: parsed.correlationId,
      causationId: parsed.causationId ?? null,
      origin: parsed.origin,
      accountId: parsed.payload.accountId,
      payloadJson,
      recordedAt: Date.parse(parsed.recordedAt),
      occurredAt: parsed.occurredAt ? Date.parse(parsed.occurredAt) : null,
      dispatchedAt: null,
    })
    .onConflictDoNothing({
      target: [
        domainOutbox.aggregateType,
        domainOutbox.aggregateId,
        domainOutbox.aggregateRevision,
        domainOutbox.type,
      ],
    })
    .run();
}

/** The events that have not been fanned out yet, oldest first. */
export function listPendingEvents(tx: JournalTx, limit: number): PendingEvent[] {
  return tx
    .select({
      id: domainOutbox.id,
      type: domainOutbox.type,
      payloadJson: domainOutbox.payloadJson,
    })
    .from(domainOutbox)
    .where(isNull(domainOutbox.dispatchedAt))
    .orderBy(asc(domainOutbox.recordedAt), asc(domainOutbox.id))
    .limit(limit)
    .all();
}

/** Marks an event as fanned out. */
export function markEventDispatched(tx: JournalTx, eventId: string, now: number): void {
  tx.update(domainOutbox)
    .set({ dispatchedAt: now })
    .where(and(eq(domainOutbox.id, eventId), isNull(domainOutbox.dispatchedAt)))
    .run();
}
