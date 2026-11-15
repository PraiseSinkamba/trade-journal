import { and, count, eq, gte, inArray, like, max } from "drizzle-orm";
import {
  intelligenceJobs,
  intelligenceOpportunities,
  intelligenceWorkflows,
  interactionCommands,
  workflowTransitions,
} from "@/db/schema";
import type { JournalTx } from "@/db/transaction";
import { newUuid } from "@/server/ids";
import {
  WORKFLOW_EFFECT_JOB_KEY_PREFIX,
  type CommandRow,
  type ExperienceStore,
  type NewCommandRow,
  type NewOpportunityRow,
  type NewTransitionRow,
  type NewWorkflowRow,
  type OpportunityRow,
  type OpportunityStatus,
  type WorkflowRow,
  type WorkflowUpdate,
} from "../contracts/experience";

/**
 * The experience store (Phase 16).
 *
 * The workflow, its transition history and the command ledger, in SQL and
 * nothing else. The rules live in the engine: this adapter writes and reads
 * what the engine asks for, and never decides anything itself.
 */

export type {
  CommandRow,
  ExperienceStore,
  NewCommandRow,
  NewTransitionRow,
  NewWorkflowRow,
  WorkflowRow,
  WorkflowUpdate,
};

/**
 * Cancels the pending effect jobs of a workflow.
 *
 * The idempotency key of a workflow effect job starts with the workflow id,
 * so the release never touches the jobs of another workflow — and never a job
 * that is already running.
 */
const releaseJobs = (tx: JournalTx, workflowId: string, now: number): void => {
  tx.update(intelligenceJobs)
    .set({ cancelRequested: true, status: "cancelled", updatedAt: now })
    .where(
      and(
        inArray(intelligenceJobs.status, ["pending", "retry_wait"]),
        like(intelligenceJobs.idempotencyKey, `${WORKFLOW_EFFECT_JOB_KEY_PREFIX}${workflowId}:%`),
      ),
    )
    .run();
};

/**
 * The SQLite experience store.
 *
 * Every read and write joins the caller's transaction, so the adapter never
 * opens a connection of its own.
 */
export const createExperienceStore = (): ExperienceStore => ({
  loadWorkflow(tx: JournalTx, workflowId: string): WorkflowRow | null {
    return (
      tx
        .select()
        .from(intelligenceWorkflows)
        .where(eq(intelligenceWorkflows.id, workflowId))
        .get() ?? null
    );
  },

  loadCommand(tx: JournalTx, commandId: string): CommandRow | null {
    return (
      tx
        .select()
        .from(interactionCommands)
        .where(eq(interactionCommands.commandId, commandId))
        .get() ?? null
    );
  },

  insertWorkflow(tx: JournalTx, workflow: NewWorkflowRow): void {
    tx.insert(intelligenceWorkflows).values(workflow).run();
  },

  insertTransition(tx: JournalTx, transition: NewTransitionRow): void {
    tx.insert(workflowTransitions).values(transition).run();
  },

  insertCommand(tx: JournalTx, command: NewCommandRow): void {
    tx.insert(interactionCommands).values(command).run();
  },

  updateWorkflow(tx: JournalTx, workflowId: string, update: WorkflowUpdate): void {
    tx.update(intelligenceWorkflows)
      .set(update)
      .where(eq(intelligenceWorkflows.id, workflowId))
      .run();
  },

  releaseWorkflowJobs(tx: JournalTx, workflowId: string, now: number): void {
    releaseJobs(tx, workflowId, now);
  },

  loadEngagement(tx: JournalTx, dedupKey: string): OpportunityRow | null {
    return (
      tx
        .select()
        .from(intelligenceOpportunities)
        .where(eq(intelligenceOpportunities.dedupKey, dedupKey))
        .get() ?? null
    );
  },

  loadOpportunityById(tx: JournalTx, id: string): OpportunityRow | null {
    return (
      tx
        .select()
        .from(intelligenceOpportunities)
        .where(
          and(
            eq(intelligenceOpportunities.id, id),
            like(intelligenceOpportunities.dedupKey, "opportunity/%"),
          ),
        )
        .get() ?? null
    );
  },

  insertEngagement(
    tx: JournalTx,
    row: NewOpportunityRow,
  ): { row: OpportunityRow; created: boolean } {
    // The unique dedup key keeps the first row: the same dedup key can never
    // produce two opportunities.
    tx.insert(intelligenceOpportunities)
      .values(row)
      .onConflictDoNothing({ target: intelligenceOpportunities.dedupKey })
      .run();
    const stored =
      tx
        .select()
        .from(intelligenceOpportunities)
        .where(eq(intelligenceOpportunities.dedupKey, row.dedupKey))
        .get() ?? null;
    if (!stored) {
      throw new Error("An engagement row must be readable after it was stored.");
    }
    return { row: stored, created: stored.id === row.id };
  },

  advanceOpportunity(
    tx: JournalTx,
    dedupKey: string,
    from: readonly OpportunityStatus[],
    to: OpportunityStatus,
    now: number,
  ): boolean {
    const result = tx
      .update(intelligenceOpportunities)
      .set({ status: to, updatedAt: now })
      .where(
        and(
          eq(intelligenceOpportunities.dedupKey, dedupKey),
          inArray(intelligenceOpportunities.status, [...from]),
        ),
      )
      .run();
    return result.changes > 0;
  },

  findOpportunitiesBySubject(
    tx: JournalTx,
    subjectType: string,
    subjectId: string,
  ): OpportunityRow[] {
    return tx
      .select()
      .from(intelligenceOpportunities)
      .where(
        and(
          eq(intelligenceOpportunities.subjectType, subjectType),
          eq(intelligenceOpportunities.subjectId, subjectId),
          like(intelligenceOpportunities.dedupKey, "opportunity/%"),
        ),
      )
      .all();
  },

  countProactiveDeliveriesSince(tx: JournalTx, since: number): number {
    const counted = tx
      .select({ value: count() })
      .from(intelligenceOpportunities)
      .where(
        and(
          // A delivery row is written with the status "delivered" and no move
          // ever takes a row out of that status, so this filter does not
          // change what is counted: every row that carries the
          // "delivery/proactive/" namespace carries that status, and the
          // namespace alone already decides the set. It lets the existing
          // (status, eligible_at) index serve the query, which the namespace
          // prefix alone cannot: SQLite only applies its LIKE optimisation
          // to an indexed column when `case_sensitive_like` is on, and this
          // journal never sets it.
          eq(intelligenceOpportunities.status, "delivered"),
          like(intelligenceOpportunities.dedupKey, "delivery/proactive/%"),
          gte(intelligenceOpportunities.eligibleAt, since),
        ),
      )
      .get();
    return counted?.value ?? 0;
  },

  lastProactiveDeliveryAt(tx: JournalTx, subjectType: string, subjectId: string): number | null {
    const latest = tx
      .select({ at: max(intelligenceOpportunities.eligibleAt) })
      .from(intelligenceOpportunities)
      .where(
        and(
          // The same status filter as the daily count: it does not change
          // which rows qualify, and it routes the read through the
          // eligibility index instead of the whole table.
          eq(intelligenceOpportunities.status, "delivered"),
          like(intelligenceOpportunities.dedupKey, "delivery/proactive/%"),
          eq(intelligenceOpportunities.subjectType, subjectType),
          eq(intelligenceOpportunities.subjectId, subjectId),
        ),
      )
      .get();
    return latest?.at ?? null;
  },
});
