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
 * The AI-generated review question of one observation.
 *
 * The question is the only text the provider produced that the journal
 * keeps: the prompt, the raw response and every credential stay out of the
 * journal. It is served only where a review of the observation is offered.
 */
export interface InsightView {
  /** The question, as the provider answered it. */
  readonly question: string;
  /** The projection revision the question was made from. */
  readonly sourceRevision: string;
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
      /**
       * The current question of this observation, when the journal has one.
       *
       * It is absent when no question was produced, and absent again once the
       * source it was made from is corrected: the older question is not served
       * any more.
       */
      readonly insight?: InsightView;
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

/* ------------------------------------------------------------------------ *
 * The client-side response DTOs (Phase 19).
 *
 * The summaries the surfaces serve, so the client reads them without
 * inventing a shape of its own. They hold no server code: the client imports
 * this module and the server imports it too.
 * ------------------------------------------------------------------------ */

/**
 * The review state of one observation.
 *
 * `unreviewed` — the observation carries no review, so the operator may start
 * one. `live` — a review is in progress: it waits for the operator, it runs,
 * or it is deferred. `reviewed` — the operator already gave the review.
 */
export const OBSERVATION_REVIEW_STATES = ["unreviewed", "live", "reviewed"] as const;

/** The review state of one observation. */
export type ObservationReviewState = (typeof OBSERVATION_REVIEW_STATES)[number];

/** The summary of one observation the observation surface serves. */
export interface ObservationSummary {
  readonly id: string;
  readonly subjectId: string;
  readonly accountId: string | null;
  readonly type: string;
  readonly status: string;
  readonly currency: string;
  readonly netPnl: number;
  readonly fees: number;
  readonly tradeStatus: string;
  readonly timingQuality: string;
  readonly recordedAt: number;
  readonly updatedAt: number;
  /** The review the observation carries, so the client never re-offers one. */
  readonly reviewState: ObservationReviewState;
}

/** The summary of one opportunity the opportunity surface serves. */
export interface OpportunitySummary {
  readonly id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly accountId: string | null;
  readonly status: string;
  readonly eligibleAt: number;
  readonly expiresAt: number;
  readonly evidenceIds: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** The two journal switches the operator controls. */
export interface IntelligenceControls {
  readonly proactiveOptIn: boolean;
  readonly paused: boolean;
}

/** What the observation surface answers. */
export interface ObservationsResponse {
  readonly observations: readonly ObservationSummary[];
  readonly intents: readonly InteractionIntent[];
}

/** What the opportunity surface answers. */
export interface OpportunitiesResponse {
  readonly opportunities: readonly OpportunitySummary[];
  readonly intents: readonly InteractionIntent[];
}

/** What the controls surface answers. */
export interface ControlsResponse {
  readonly controls: IntelligenceControls;
}

/** The engagement defaults the status surface serves. */
export interface EngagementDefaultsView {
  readonly proactiveCooldownMs: number;
  readonly proactivePerDay: number;
  readonly opportunityExpiryMs: number;
  readonly neverExpires: number;
}

/** The background policy the status surface serves. */
export interface BackgroundPolicyView {
  readonly enabled: boolean;
  readonly accounts: readonly string[];
  readonly capabilities: { readonly tools: boolean; readonly structuredOutput: boolean };
  readonly maxInputCharacters: number;
  readonly revision: number;
}

/** What the status surface answers. */
export interface IntelligenceStatusResponse {
  readonly status: {
    readonly backgroundPolicy: BackgroundPolicyView;
    readonly worker: WorkerStatusView | null;
    readonly engagementDefaults: EngagementDefaultsView;
  };
}

/** The sanitized state of the journal's worker. */
export interface WorkerStatusView {
  readonly state: string;
  readonly owner: string;
  readonly leaseHeld: boolean;
  readonly leaseUntil: number | null;
  readonly lastHeartbeatAt: number | null;
  readonly processed: number;
  readonly failed: number;
  readonly lastErrorCode: string | null;
}

/** The body the command route accepts. */
export type CommandRequestBody = z.infer<typeof interactionCommandRequestSchema>;

/** The body the dismissal route accepts. */
export type DismissRequestBody = z.infer<typeof dismissRequestSchema>;

/**
 * The command body one action descriptor asks for.
 *
 * The action id, the action and the revision all come from the server: the
 * client never assembles a handle of its own. The status intent carries no
 * revision and never sends a command, so the body is null for it.
 */
export const commandRequestBody = (
  intent: InteractionIntent,
  descriptor: IntentActionDescriptor,
  opts: { commandId: string; correction?: string; deferUntil?: number },
): CommandRequestBody | null => {
  if (!("expectedRevision" in intent)) return null;
  if (!(WORKFLOW_INTERACTION_ACTIONS as readonly string[]).includes(descriptor.action)) return null;
  const body: CommandRequestBody = {
    actionId: descriptor.actionId,
    commandId: opts.commandId,
    expectedRevision: intent.expectedRevision,
    action: descriptor.action as WorkflowInteractionAction,
  };
  // The correction and the instant are the operator's: the intent carries
  // neither, so the card asks for them instead of inventing them.
  if (opts.correction !== undefined) body.correction = opts.correction;
  if (opts.deferUntil !== undefined) body.deferUntil = opts.deferUntil;
  return body;
};

/**
 * The dismissal body one server-issued action id asks for.
 *
 * The scope and the target are parsed out of the action id the server issued:
 * the client never builds a handle of its own, and an action id that names
 * nothing dismissable yields no body at all.
 */
export const dismissalRequestBody = (actionId: string): DismissRequestBody | null => {
  const parsed = parseInteractionActionId(actionId);
  if (!parsed) return null;
  if (parsed.kind === "opportunity-dismiss")
    return { actionId, scope: "opportunity", target: parsed.opportunityId };
  if (parsed.kind === "evidence-dismiss")
    return { actionId, scope: "evidence", target: parsed.revisionId };
  return null;
};
