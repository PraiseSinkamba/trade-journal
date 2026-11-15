import { z } from "zod";

/**
 * The public interaction DTOs (Phase 18).
 *
 * This module is the contract the client and the server share: the shapes an
 * interaction takes, the actions it offers and the strict request bodies the
 * interaction routes accept. It holds no server code and no database code, so
 * the client may import it without pulling the journal in.
 *
 * An action id is issued by the server and encodes the workflow, the action
 * and the revision it was issued at. It is a handle, not a permission: the
 * server re-resolves it against its own state before it acts.
 */

/** The actions an interaction may offer. */
export const INTERACTION_ACTIONS = [
  "acknowledge",
  "correct",
  "defer",
  "cancel",
  "dismiss",
] as const;

/** One interaction action. */
export type InteractionAction = (typeof INTERACTION_ACTIONS)[number];

/** The actions a workflow command may carry. */
export const WORKFLOW_INTERACTION_ACTIONS = ["acknowledge", "correct", "defer", "cancel"] as const;

/** One workflow command action. */
export type WorkflowInteractionAction = (typeof WORKFLOW_INTERACTION_ACTIONS)[number];

/** The surfaces an interaction may be offered on. */
export const INTERACTION_SURFACES = ["inbox", "contextual", "proactive"] as const;

/** One interaction surface. */
export type InteractionSurface = (typeof INTERACTION_SURFACES)[number];

/** The subject an interaction is about. */
export interface InteractionSubject {
  readonly type: string;
  readonly id: string;
}

/** One piece of evidence an interaction rests on. */
export interface EvidenceReference {
  /** The immutable revision the evidence rests on. */
  readonly revisionId: string;
  /** The kind of evidence, for presentation. */
  readonly kind: string;
}

/** What an input request accepts. */
export interface InputConstraint {
  readonly kind: "text";
  readonly minLength: number;
  readonly maxLength: number;
  readonly required: boolean;
  readonly hint?: string;
}

/**
 * One authorized action.
 *
 * The action id is issued by the server and encodes the workflow, the action
 * and the revision it was issued at. It is a handle, not a permission: the
 * server re-resolves it against its own state before it acts.
 */
export interface IntentActionDescriptor {
  readonly actionId: string;
  readonly action: InteractionAction;
  readonly label: string;
  readonly requiresInput: boolean;
}

/**
 * A structured interaction intent (design §15).
 *
 * A strict union of the three shapes an interaction may take. The server
 * supplies the action ids, the expected revision, the text, the evidence
 * references and the input constraints (modernization plan Task 12).
 */
export type InteractionIntent =
  | {
      readonly kind: "observation-review";
      readonly intentId: string;
      readonly workflowId: string;
      readonly expectedRevision: number;
      readonly subject: InteractionSubject;
      readonly text: string;
      readonly evidence: readonly EvidenceReference[];
      readonly actions: readonly IntentActionDescriptor[];
    }
  | {
      readonly kind: "status";
      readonly intentId: string;
      readonly surface: InteractionSurface;
      readonly subject: InteractionSubject;
      readonly status: string;
      readonly updatedAt: number;
      readonly text: string;
      readonly actions: readonly IntentActionDescriptor[];
    }
  | {
      readonly kind: "input-request";
      readonly intentId: string;
      readonly workflowId: string;
      readonly expectedRevision: number;
      readonly subject: InteractionSubject;
      readonly prompt: string;
      readonly input: InputConstraint;
      readonly actions: readonly IntentActionDescriptor[];
    };

/**
 * The action id of one workflow command.
 *
 * The revision is the revision the action was issued at: the server refuses
 * the command when the workflow has moved on.
 */
export const workflowActionId = (
  workflowId: string,
  action: WorkflowInteractionAction,
  revision: number,
): string => `act:${workflowId}:${action}:${revision}`;

/** The action id that dismisses one opportunity. */
export const opportunityDismissActionId = (opportunityId: string): string =>
  `act:opportunity:${opportunityId}:dismiss`;

/** The action id that dismisses one evidence revision. */
export const evidenceDismissActionId = (revisionId: string): string =>
  `act:evidence:${revisionId}:dismiss`;

/** An action id, resolved into what it names. */
export type ParsedActionId =
  | {
      readonly kind: "workflow";
      readonly workflowId: string;
      readonly action: WorkflowInteractionAction;
      readonly revision: number;
    }
  | { readonly kind: "opportunity-dismiss"; readonly opportunityId: string }
  | { readonly kind: "evidence-dismiss"; readonly revisionId: string };

/**
 * Resolves an action id into what it names.
 *
 * A malformed action id is a client error, never a lookup that guesses: the
 * resolution returns null and the caller refuses the request.
 */
export const parseInteractionActionId = (raw: string): ParsedActionId | null => {
  if (!raw.startsWith("act:")) return null;
  const parts = raw.slice("act:".length).split(":");
  if (parts.length < 3) return null;
  const last = parts[parts.length - 1] ?? "";
  const action = parts[parts.length - 2] ?? "";
  const head = parts.slice(0, parts.length - 2).join(":");

  if (last === "dismiss" && action.length > 0) {
    if (head === "opportunity") return { kind: "opportunity-dismiss", opportunityId: action };
    if (head === "evidence") return { kind: "evidence-dismiss", revisionId: action };
    return null;
  }

  if (head.length === 0) return null;
  if (!(WORKFLOW_INTERACTION_ACTIONS as readonly string[]).includes(action)) return null;
  if (!/^\d+$/.test(last)) return null;
  return {
    kind: "workflow",
    workflowId: head,
    action: action as WorkflowInteractionAction,
    revision: Number(last),
  };
};

/** The body the command route accepts. */
export const interactionCommandRequestSchema = z
  .object({
    actionId: z.string().min(1).max(512),
    commandId: z.string().min(1).max(200),
    expectedRevision: z.number().int().nonnegative(),
    action: z.enum(WORKFLOW_INTERACTION_ACTIONS),
    correction: z.string().min(1).max(4000).optional(),
    deferUntil: z.number().int().positive().optional(),
    scope: z.array(z.string().min(1)).max(64).optional(),
  })
  .strict();

/** The body the dismissal route accepts. */
export const dismissRequestSchema = z
  .object({
    actionId: z.string().min(1).max(512),
    scope: z.enum(["opportunity", "evidence"]),
    target: z.string().min(1).max(512),
    accounts: z.array(z.string().min(1)).max(64).optional(),
  })
  .strict();

/** The body the observation review route accepts. */
export const observationReviewRequestSchema = z
  .object({
    observationId: z.string().min(1).max(200),
    scope: z.array(z.string().min(1)).max(64).optional(),
  })
  .strict();
