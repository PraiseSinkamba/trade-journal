import { eq, inArray } from "drizzle-orm";
import {
  domainOutbox,
  eventDeliveries,
  executionEvidence,
  executions,
  intelligenceJobs,
} from "@/db/schema";
import type { JournalTx } from "@/db/transaction";

/**
 * Retention of the intelligence runtime (Phase 07).
 *
 * Deleting an account must take that account's intelligence with it: the
 * committed change events of its trades, the jobs those events produced and
 * the evidence sidecar of its fills. None of it is reachable from the account
 * row, so it is purged explicitly, in the caller's transaction.
 *
 * Phase 20 (Task 13) extends this file with pruning and backup; it is created
 * here because the account deletion needs it.
 */

/** SQLite's bind-parameter limit. Every statement below stays under it. */
const ID_CHUNK = 500;

/** Runs `fn` over `ids` in chunks that stay below SQLite's bind limit. */
const eachChunk = (ids: readonly string[], fn: (chunk: string[]) => void): void => {
  for (let i = 0; i < ids.length; i += ID_CHUNK) fn(ids.slice(i, i + ID_CHUNK));
};

/**
 * Purges everything one account owns in the intelligence runtime.
 *
 * The outbox rows of the account are its committed change events; their
 * deliveries cascade with them. The jobs those deliveries produced are
 * cancelled first and deleted after: a worker that still holds one is fenced,
 * because its completion finds no job row. The evidence sidecar of the
 * account's fills has no foreign key, so it would otherwise survive them.
 */
export const purgeAccountIntelligence = (tx: JournalTx, accountId: string): void => {
  const eventIds = tx
    .select({ id: domainOutbox.id })
    .from(domainOutbox)
    .where(eq(domainOutbox.accountId, accountId))
    .all()
    .map((row) => row.id);

  // The jobs are read before the events go: the deliveries that name them
  // cascade with the events.
  const jobIds = eventIds.length
    ? tx
        .selectDistinct({ jobId: eventDeliveries.jobId })
        .from(eventDeliveries)
        .where(inArray(eventDeliveries.eventId, eventIds))
        .all()
        .map((row) => row.jobId)
        .filter((jobId): jobId is string => jobId !== null)
    : [];

  eachChunk(eventIds, (chunk) => {
    tx.delete(domainOutbox).where(inArray(domainOutbox.id, chunk)).run();
  });

  if (jobIds.length) {
    const now = Date.now();
    eachChunk(jobIds, (chunk) => {
      // Cancel first: a worker that still holds the job loses its claim
      // before the row disappears under it.
      tx.update(intelligenceJobs)
        .set({
          cancelRequested: true,
          status: "cancelled",
          owner: null,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(inArray(intelligenceJobs.id, chunk))
        .run();
      tx.delete(intelligenceJobs).where(inArray(intelligenceJobs.id, chunk)).run();
    });
  }

  const executionIds = tx
    .select({ id: executions.id })
    .from(executions)
    .where(eq(executions.accountId, accountId))
    .all()
    .map((row) => row.id);
  eachChunk(executionIds, (chunk) => {
    tx.delete(executionEvidence).where(inArray(executionEvidence.executionId, chunk)).run();
  });
};
