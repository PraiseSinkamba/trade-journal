import { createHash } from "node:crypto";
import type { JournalTx } from "@/db/transaction";
import { newUuid } from "@/server/ids";
import type { ExecutionContext } from "../contracts/execution";
import {
  REVIEW_OBSERVATION_DEFINITION,
  REVIEW_OBSERVATION_VERSION,
  WORKFLOW_EFFECT_HANDLER_ID,
  WORKFLOW_EFFECT_HANDLER_VERSION,
  nextSystemStatus,
  nextWorkflowStatus,
  workflowCommandSchema,
  workflowDefinition,
  workflowEffectJobKey,
  workflowResultSchema,
  type ExperienceStore,
  type RunInTransaction,
  type WorkflowCommand,
  type WorkflowResult,
  type WorkflowStatus,
  type WorkflowUpdate,
} from "../contracts/experience";
import type { JobRecord, JobStore } from "../contracts/jobs";

/**
 * The workflow engine (Phase 16).
 *
 * A workflow is durable, versioned and auditable: every applied transition
 * writes a row, advances the revision and enqueues its effect in the same
 * transaction. A command that does not apply changes nothing at all, and the
 * same command id with the same payload is answered from the ledger instead
 * of being applied twice.
 *
 * The engine writes workflow rows, transition rows, command rows and effect
 * jobs. It writes no trade, no execution, no annotation, no hash and no key.
 */

export { REVIEW_OBSERVATION_DEFINITION, REVIEW_OBSERVATION_VERSION };

/** The workflow engine. */
export interface WorkflowEngine {
  /** Starts a workflow in `running` and enqueues its first effect. */
  startWorkflow(
    input: {
      subjectType: string;
      subjectId: string;
      accountId: string | null;
      evidenceIds?: readonly string[];
    },
    context: ExecutionContext,
  ): { workflowId: string; revision: number };
  /** Applies a user command. Never mutates on a conflict. */
  transitionWorkflow(command: WorkflowCommand, context: ExecutionContext): WorkflowResult;
  /** Applies the durable effect of a transition. Idempotent. */
  applyWorkflowEffect(workflowId: string, transitionRevision: number): void;
  /** Applies the durable effect of a transition inside the caller's transaction. */
  applyWorkflowEffectInTx(
    tx: JournalTx,
    workflowId: string,
    transitionRevision: number,
    now: number,
  ): void;
  /** The handler that runs a workflow effect job. */
  effectHandler(): WorkflowEffectHandler;
}

/**
 * The handler that runs a workflow effect job.
 *
 * The shape is the worker's handler shape; the engine declares it itself so
 * the domain never reaches into the infrastructure layer.
 */
export interface WorkflowEffectHandler {
  readonly id: string;
  readonly version: string;
  run(tx: JournalTx, job: JobRecord): void;
}

/**
 * The digest of a command payload.
 *
 * The command id is the key, not part of the payload: the same id with a
 * different payload is a conflict, never a second application.
 */
const commandDigest = (command: WorkflowCommand): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        workflowId: command.workflowId,
        expectedRevision: command.expectedRevision,
        action: command.action,
        correction: command.correction,
        deferUntil: command.deferUntil,
      }),
    )
    .digest("hex");

/**
 * Creates the workflow engine.
 *
 * The engine is bound to the transaction seam, the job store and the
 * experience store it is given, so the transition and the effect it enqueues
 * commit together. Every one of those is an injected port: the engine never
 * reaches the database, a concrete adapter or a connection of its own, and
 * composition wires the SQLite ones.
 */
export const createWorkflowEngine = (deps: {
  runInTransaction: RunInTransaction;
  jobs: JobStore;
  store: ExperienceStore;
  clock?: () => number;
}): WorkflowEngine => {
  const clock = deps.clock ?? (() => Date.now());
  const store = deps.store;

  /**
   * Applies the effect of one transition.
   *
   * The effect belongs to the revision it was enqueued for: an effect that
   * arrives late finds the workflow on a later revision and is declined, so
   * an effect can never be applied twice. The applied effect advances the
   * marker, and a workflow that is running or scheduled hands itself to the
   * user.
   */
  const applyEffect = (
    tx: JournalTx,
    workflowId: string,
    transitionRevision: number,
    now: number,
  ): void => {
    const workflow = store.loadWorkflow(tx, workflowId);
    if (!workflow) return;
    if (workflow.revision !== transitionRevision) return;

    // The workflow's own definition decides its transitions. A workflow whose
    // definition or version this engine does not support is never advanced
    // by the rules of another version: its effect is released, not applied.
    const definition = workflowDefinition(workflow.definitionKey, workflow.definitionVersion);
    if (!definition) {
      store.releaseWorkflowJobs(tx, workflowId, now);
      return;
    }

    const target: WorkflowStatus | null = nextSystemStatus(definition, workflow.status);
    if (target) {
      const newRevision = workflow.revision + 1;
      store.insertTransition(tx, {
        id: newUuid(),
        workflowId,
        revision: newRevision,
        fromStatus: workflow.status,
        toStatus: target,
        action: "present",
        commandId: null,
        payloadDigest: null,
        payloadJson: "{}",
        createdAt: now,
      });
      store.updateWorkflow(tx, workflowId, {
        revision: newRevision,
        status: target,
        effectRevision: transitionRevision,
        updatedAt: now,
      });
    } else {
      store.updateWorkflow(tx, workflowId, { effectRevision: transitionRevision, updatedAt: now });
    }
    store.releaseWorkflowJobs(tx, workflowId, now);
  };

  return {
    startWorkflow(input, context) {
      const scope = context.scope.accountIds;
      if (scope.length > 0 && (input.accountId === null || !scope.includes(input.accountId))) {
        throw new Error("A workflow may not be created outside the execution scope.");
      }

      const now = clock();
      const workflowId = newUuid();
      return deps.runInTransaction((tx) => {
        store.insertWorkflow(tx, {
          id: workflowId,
          definitionKey: REVIEW_OBSERVATION_DEFINITION,
          definitionVersion: REVIEW_OBSERVATION_VERSION,
          revision: 1,
          status: "running",
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          accountId: input.accountId,
          evidenceIdsJson: JSON.stringify(input.evidenceIds ?? []),
          selfReportJson: null,
          deferUntil: null,
          effectRevision: 0,
          createdAt: now,
          updatedAt: now,
        });
        store.insertTransition(tx, {
          id: newUuid(),
          workflowId,
          revision: 1,
          fromStatus: null,
          toStatus: "running",
          action: "start",
          commandId: null,
          payloadDigest: null,
          payloadJson: "{}",
          createdAt: now,
        });
        deps.jobs.enqueue(
          tx,
          workflowEffectJobKey(workflowId, 1),
          { type: "workflow_effect", workflowId, transitionRevision: 1 },
          now,
        );
        return { workflowId, revision: 1 };
      });
    },

    transitionWorkflow(command, context): WorkflowResult {
      // An invalid command is a client error, not a conflict: it throws.
      const parsed = workflowCommandSchema.parse(command);
      const digest = commandDigest(parsed);

      return deps.runInTransaction((tx): WorkflowResult => {
        const workflow = store.loadWorkflow(tx, parsed.workflowId);
        if (!workflow) return { kind: "conflict", currentRevision: 0 };

        // The scope comes before the ledger: a caller that may not act on the
        // workflow learns nothing about it, not even from a command id it
        // already knows.
        const scope = context.scope.accountIds;
        if (
          workflow.accountId !== null &&
          scope.length > 0 &&
          !scope.includes(workflow.accountId)
        ) {
          return { kind: "conflict", currentRevision: workflow.revision };
        }

        // The workflow's own definition decides which transitions are legal.
        // A workflow stored under a definition or a version this engine does
        // not support is refused, never advanced.
        const definition = workflowDefinition(workflow.definitionKey, workflow.definitionVersion);
        if (!definition) {
          return { kind: "conflict", currentRevision: workflow.revision };
        }

        const recorded = store.loadCommand(tx, parsed.commandId);
        if (recorded) {
          if (recorded.payloadDigest !== digest) {
            return { kind: "conflict", currentRevision: workflow.revision };
          }
          const stored: unknown = JSON.parse(recorded.resultJson);
          const prior = workflowResultSchema.parse(stored);
          if (prior.kind === "applied") {
            return { kind: "duplicate", priorResult: { newRevision: prior.newRevision } };
          }
          return { kind: "conflict", currentRevision: workflow.revision };
        }

        if (workflow.revision !== parsed.expectedRevision) {
          return { kind: "conflict", currentRevision: workflow.revision };
        }

        const target = nextWorkflowStatus(definition, workflow.status, parsed.action);
        if (target === null) {
          return { kind: "conflict", currentRevision: workflow.revision };
        }

        const now = clock();
        const newRevision = workflow.revision + 1;
        store.insertTransition(tx, {
          id: newUuid(),
          workflowId: workflow.id,
          revision: newRevision,
          fromStatus: workflow.status,
          toStatus: target,
          action: parsed.action,
          commandId: parsed.commandId,
          payloadDigest: digest,
          payloadJson: JSON.stringify(parsed),
          createdAt: now,
        });

        const update: WorkflowUpdate = { revision: newRevision, status: target, updatedAt: now };
        if (parsed.action === "correct" && parsed.correction !== undefined) {
          update.selfReportJson = JSON.stringify({
            text: parsed.correction,
            recordedAt: now,
            executionId: context.executionId,
            correlationId: context.correlationId,
          });
        }
        if (parsed.action === "defer" && parsed.deferUntil !== undefined) {
          update.deferUntil = parsed.deferUntil;
        }
        store.updateWorkflow(tx, workflow.id, update);

        // Every transition releases the jobs of the state it leaves. A running
        // job is never touched: the worker that owns it finishes it.
        store.releaseWorkflowJobs(tx, workflow.id, now);

        if (target === "scheduled") {
          deps.jobs.enqueue(
            tx,
            workflowEffectJobKey(workflow.id, newRevision),
            { type: "workflow_effect", workflowId: workflow.id, transitionRevision: newRevision },
            parsed.deferUntil ?? now,
          );
        }

        store.insertCommand(tx, {
          id: newUuid(),
          commandId: parsed.commandId,
          workflowId: workflow.id,
          payloadDigest: digest,
          resultJson: JSON.stringify({ kind: "applied", newRevision }),
          createdAt: now,
        });

        return { kind: "applied", newRevision };
      });
    },

    applyWorkflowEffect(workflowId: string, transitionRevision: number): void {
      const now = clock();
      deps.runInTransaction((tx) => {
        applyEffect(tx, workflowId, transitionRevision, now);
      });
    },

    applyWorkflowEffectInTx(
      tx: JournalTx,
      workflowId: string,
      transitionRevision: number,
      now: number,
    ): void {
      applyEffect(tx, workflowId, transitionRevision, now);
    },

    effectHandler(): WorkflowEffectHandler {
      return {
        id: WORKFLOW_EFFECT_HANDLER_ID,
        version: WORKFLOW_EFFECT_HANDLER_VERSION,
        run(tx: JournalTx, job: JobRecord): void {
          if (job.payload.type !== "workflow_effect") return;
          applyEffect(tx, job.payload.workflowId, job.payload.transitionRevision, clock());
        },
      };
    },
  };
};
