import type { JournalDb } from "@/db/connection";
import { eventDeliveries } from "@/db/schema";
import { listPendingEvents, markEventDispatched } from "@/server/domain-event-store";
import type { JobStore } from "../contracts/jobs";

/**
 * The outbox fanout (Phase 04).
 *
 * One transaction turns pending events into per-handler deliveries and their
 * jobs, and marks the events dispatched. The job key is
 * `eventId:handlerId:handlerVersion`, so a repeated fanout lands on the same
 * job instead of creating a second one.
 */

/** A handler subscribed to the outbox. */
export interface OutboxHandler {
  readonly id: string;
  readonly version: string;
}

/** Fans pending events out to the registered handlers. */
export interface OutboxDispatcher {
  dispatchOutbox(limit: number, now: number): number;
}

/**
 * Creates the dispatcher.
 *
 * The dispatcher runs its fanout on the connection it is given, so a worker
 * fans out on its own connection rather than on the request thread's.
 */
export const createOutboxDispatcher = (deps: {
  db: JournalDb;
  jobs: JobStore;
  handlers: readonly OutboxHandler[];
}): OutboxDispatcher => ({
  dispatchOutbox(limit: number, now: number): number {
    return deps.db.transaction(
      (tx) => {
        const pending = listPendingEvents(tx, limit);
        for (const event of pending) {
          for (const handler of deps.handlers) {
            const key = `${event.id}:${handler.id}:${handler.version}`;
            const jobId = deps.jobs.enqueue(
              tx,
              key,
              {
                type: "evaluate_trade",
                eventId: event.id,
                handlerId: handler.id,
                handlerVersion: handler.version,
              },
              now,
            );
            tx.insert(eventDeliveries)
              .values({
                eventId: event.id,
                handlerId: handler.id,
                handlerVersion: handler.version,
                state: "pending",
                jobId,
                lastError: null,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing()
              .run();
          }
          markEventDispatched(tx, event.id, now);
        }
        return pending.length;
      },
      { behavior: "immediate" },
    );
  },
});
