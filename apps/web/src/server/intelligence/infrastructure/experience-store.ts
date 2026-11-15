import { and, eq, inArray, like } from "drizzle-orm";
import {
  intelligenceJobs,
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
  type NewTransitionRow,
  type NewWorkflowRow,
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
});
