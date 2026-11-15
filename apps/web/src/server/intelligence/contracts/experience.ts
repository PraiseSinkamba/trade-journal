import { z } from "zod";
import type { intelligenceWorkflows, interactionCommands, workflowTransitions } from "@/db/schema";
import type { JournalTx } from "@/db/transaction";

/**
 * The experience contracts (Phase 16).
 *
 * A workflow is a durable, versioned process: it starts, it waits for the
 * user, it ends. This module holds the vocabulary the engine, the store and
 * the command ledger share — the statuses, the actions, the command schema,
 * the result union and the transition table. It holds no rule that needs a
 * database, so every side of the workflow can speak about it.
 */

/** The lifecycle of a workflow. */
export const WORKFLOW_STATUSES = [
  "running",
  "waiting_for_user",
  "scheduled",
  "completed",
  "cancelled",
  "failed",
] as const;

/** One workflow status. */
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/**
 * The commands a user issues.
 *
 * A command is one of these four and nothing else: `start` and `present` are
 * the actions the workflow records on its own, not commands a user can send.
 */
export const WORKFLOW_ACTIONS = ["acknowledge", "correct", "defer", "cancel"] as const;

/** One user command. */
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

/**
 * The actions a transition row records.
 *
 * The four user commands plus the two the workflow records itself: `start`
 * opens the workflow and `present` hands it to the user.
 */
export const WORKFLOW_TRANSITION_ACTIONS = [
  "start",
  "acknowledge",
  "correct",
  "defer",
  "cancel",
  "present",
] as const;

/** One recorded transition. */
export type WorkflowTransitionAction = (typeof WORKFLOW_TRANSITION_ACTIONS)[number];

/** The key of the review-observation workflow definition. */
export const REVIEW_OBSERVATION_DEFINITION = "review_observation";

/** The version of the review-observation workflow definition. */
export const REVIEW_OBSERVATION_VERSION = 1;

/** The prefix every workflow effect job key carries. */
export const WORKFLOW_EFFECT_JOB_KEY_PREFIX = "workflow-effect:";

/**
 * The key of the effect job of one workflow transition.
 *
 * One job per transition: the unique idempotency key of the job makes a
 * repeated enqueue a no-op.
 */
export const workflowEffectJobKey = (workflowId: string, revision: number): string =>
  `${WORKFLOW_EFFECT_JOB_KEY_PREFIX}${workflowId}:${revision}`;

/**
 * The strict schema of a workflow command.
 *
 * A command names the workflow it addresses, the revision it expects to find
 * and the action it applies. `correct` carries the correction and `defer`
 * carries the instant the workflow wakes up; every other action carries
 * neither.
 */
export const workflowCommandSchema = z
  .object({
    commandId: z.string().min(1).max(200),
    workflowId: z.string().min(1).max(200),
    expectedRevision: z.number().int().nonnegative(),
    action: z.enum(WORKFLOW_ACTIONS),
    correction: z.string().min(1).max(4000).optional(),
    deferUntil: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((command, ctx) => {
    if (command.action === "correct" && command.correction === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correction"],
        message: "A correct command carries a correction.",
      });
    }
    if (command.action !== "correct" && command.correction !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correction"],
        message: "Only a correct command carries a correction.",
      });
    }
    if (command.action === "defer" && command.deferUntil === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deferUntil"],
        message: "A defer command carries a deferUntil.",
      });
    }
    if (command.action !== "defer" && command.deferUntil !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deferUntil"],
        message: "Only a defer command carries a deferUntil.",
      });
    }
  });

/** One workflow command. */
export type WorkflowCommand = z.infer<typeof workflowCommandSchema>;

/**
 * The strict schema of the result of a workflow command.
 *
 * An applied command advances the workflow, an exact retry replays the stored
 * result and a conflict changes nothing.
 */
export const workflowResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("applied"), newRevision: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal("duplicate"),
      priorResult: z.object({ newRevision: z.number().int().positive() }).strict(),
    })
    .strict(),
  z
    .object({ kind: z.literal("conflict"), currentRevision: z.number().int().nonnegative() })
    .strict(),
]);

/** The result of a workflow command. */
export type WorkflowResult = z.infer<typeof workflowResultSchema>;

/**
 * The legal transitions of a user command, per status.
 *
 * A user command only ever applies to a workflow that waits for the user:
 * every other status refuses every action.
 */
export const WORKFLOW_TRANSITIONS: Readonly<
  Record<WorkflowStatus, Readonly<Partial<Record<WorkflowAction, WorkflowStatus>>>>
> = Object.freeze({
  running: Object.freeze({}),
  waiting_for_user: Object.freeze({
    acknowledge: "completed",
    correct: "completed",
    defer: "scheduled",
    cancel: "cancelled",
  }),
  scheduled: Object.freeze({}),
  completed: Object.freeze({}),
  cancelled: Object.freeze({}),
  failed: Object.freeze({}),
});

/**
 * The status the workflow reaches on its own, without a command.
 *
 * A running or scheduled workflow hands itself to the user once its effect
 * has run. The transition is recorded as a `present`.
 */
export const WORKFLOW_SYSTEM_TRANSITIONS: Readonly<
  Partial<Record<WorkflowStatus, WorkflowStatus>>
> = Object.freeze({
  running: "waiting_for_user",
  scheduled: "waiting_for_user",
});

/**
 * The rules of one workflow definition version.
 *
 * A definition version owns its legal transitions, so a version bump cannot
 * silently inherit the rules of the version it replaces.
 */
export interface WorkflowDefinition {
  /** The legal user transitions, per status. */
  readonly transitions: Readonly<
    Record<WorkflowStatus, Readonly<Partial<Record<WorkflowAction, WorkflowStatus>>>>
  >;
  /** The transitions the workflow makes on its own, per status. */
  readonly systemTransitions: Readonly<Partial<Record<WorkflowStatus, WorkflowStatus>>>;
}

/**
 * The workflow definitions the domain knows, keyed by definition and version.
 *
 * The engine refuses a workflow whose definition and version are not in this
 * table: it never decides a transition with the rules of another version.
 */
export const WORKFLOW_DEFINITIONS: Readonly<
  Record<string, Readonly<Record<number, WorkflowDefinition>>>
> = Object.freeze({
  [REVIEW_OBSERVATION_DEFINITION]: Object.freeze({
    [REVIEW_OBSERVATION_VERSION]: Object.freeze({
      transitions: WORKFLOW_TRANSITIONS,
      systemTransitions: WORKFLOW_SYSTEM_TRANSITIONS,
    }),
  }),
});

/**
 * The rules of a definition version, or null when the domain does not know it.
 */
export const workflowDefinition = (
  definitionKey: string,
  definitionVersion: number,
): WorkflowDefinition | null => WORKFLOW_DEFINITIONS[definitionKey]?.[definitionVersion] ?? null;

/**
 * The status an action reaches from a status, or null when the action is not
 * legal there.
 */
export const nextWorkflowStatus = (
  definition: WorkflowDefinition,
  from: WorkflowStatus,
  action: WorkflowAction,
): WorkflowStatus | null => definition.transitions[from][action] ?? null;

/**
 * The status a workflow reaches on its own, or null when it waits for
 * something else.
 */
export const nextSystemStatus = (
  definition: WorkflowDefinition,
  from: WorkflowStatus,
): WorkflowStatus | null => definition.systemTransitions[from] ?? null;

/** A stored workflow. */
export type WorkflowRow = typeof intelligenceWorkflows.$inferSelect;

/** A stored command. */
export type CommandRow = typeof interactionCommands.$inferSelect;

/** A workflow row to store. */
export type NewWorkflowRow = typeof intelligenceWorkflows.$inferInsert;

/** A transition row to store. */
export type NewTransitionRow = typeof workflowTransitions.$inferInsert;

/** A command row to store. */
export type NewCommandRow = typeof interactionCommands.$inferInsert;

/** The mutable fields of a workflow. */
export type WorkflowUpdate = Partial<
  Pick<
    NewWorkflowRow,
    "revision" | "status" | "selfReportJson" | "deferUntil" | "effectRevision" | "updatedAt"
  >
>;

/**
 * Runs work inside one journal transaction.
 *
 * The seam is injected: the domain never opens the journal itself, so the
 * caller that owns the connection decides where the transaction runs. The
 * callback is synchronous by contract — a promise-returning callback is a
 * bug, not a supported shape.
 */
export type RunInTransaction = <T>(
  fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T,
) => T;

/**
 * The experience store.
 *
 * The engine talks to the store through this port, so the domain never
 * reaches a concrete adapter: the SQLite implementation lives in
 * `../infrastructure/experience-store.ts` and is wired in at composition.
 *
 * Every write joins the caller's transaction, so a transition and the job it
 * enqueues commit together or not at all.
 */
export interface ExperienceStore {
  /** Reads a workflow row by id. */
  loadWorkflow(tx: JournalTx, workflowId: string): WorkflowRow | null;
  /** Reads a command row by command id. */
  loadCommand(tx: JournalTx, commandId: string): CommandRow | null;
  /** Stores a workflow. */
  insertWorkflow(tx: JournalTx, workflow: NewWorkflowRow): void;
  /** Stores one transition of the transition history. */
  insertTransition(tx: JournalTx, transition: NewTransitionRow): void;
  /** Stores the ledger row of an applied command. */
  insertCommand(tx: JournalTx, command: NewCommandRow): void;
  /** Updates the mutable fields of a workflow. */
  updateWorkflow(tx: JournalTx, workflowId: string, update: WorkflowUpdate): void;
  /**
   * Cancels the pending effect jobs of a workflow.
   *
   * A job that is already running is left alone: the worker that owns it
   * finishes it.
   */
  releaseWorkflowJobs(tx: JournalTx, workflowId: string, now: number): void;
}
