import {
  opportunityDismissActionId,
  workflowActionId,
  type EvidenceReference,
  type InputConstraint,
  type IntentActionDescriptor,
  type InteractionIntent,
  type InteractionSurface,
  type WorkflowInteractionAction,
} from "@/lib/intelligence-interactions";
import {
  REVIEW_OBSERVATION_DEFINITION,
  WORKFLOW_ACTIONS,
  nextWorkflowStatus,
  workflowDefinition,
  type OpportunityRow,
  type OpportunityStatus,
  type WorkflowRow,
} from "../contracts/experience";

/**
 * The intent builders (Phase 18).
 *
 * Pure functions that turn stored rows into the public interaction DTOs.
 * They take the rows as arguments and touch no database, no clock (the one
 * exception takes the instant it needs) and no network, so the same rows
 * always yield the same intent.
 *
 * The server offers what the workflow's own definition allows, never what the
 * client asks for: a workflow in a status with no legal user transition
 * offers no action.
 */

/** The label the operator reads for each command. */
const ACTION_LABELS: Readonly<Record<WorkflowInteractionAction, string>> = Object.freeze({
  acknowledge: "Acknowledge",
  correct: "Correct",
  defer: "Defer",
  cancel: "Cancel",
});

/** The opportunity statuses an interaction is still live in. */
const LIVE_STATUSES: readonly OpportunityStatus[] = ["pending", "eligible", "suppressed"];

/**
 * The actions a workflow offers at its current revision.
 *
 * The legal transitions of the workflow's own status decide: a definition
 * this engine does not know offers nothing at all.
 */
const legalWorkflowActions = (workflow: WorkflowRow): readonly IntentActionDescriptor[] => {
  const definition = workflowDefinition(workflow.definitionKey, workflow.definitionVersion);
  if (!definition) return [];
  const actions: IntentActionDescriptor[] = [];
  for (const action of WORKFLOW_ACTIONS) {
    if (nextWorkflowStatus(definition, workflow.status, action) === null) continue;
    actions.push({
      actionId: workflowActionId(workflow.id, action, workflow.revision),
      action,
      label: ACTION_LABELS[action],
      requiresInput: action === "correct",
    });
  }
  return actions;
};

/**
 * The review intent of a workflow that waits for the operator.
 *
 * The intent is null for a workflow that is not waiting: the server offers a
 * review only where a review is due.
 */
export const observationReviewIntent = (
  workflow: WorkflowRow,
  evidence: readonly EvidenceReference[],
  text: string,
): InteractionIntent | null => {
  if (workflow.definitionKey !== REVIEW_OBSERVATION_DEFINITION) return null;
  if (workflow.status !== "waiting_for_user") return null;
  return {
    kind: "observation-review",
    intentId: `intent:workflow:${workflow.id}:review`,
    workflowId: workflow.id,
    expectedRevision: workflow.revision,
    subject: { type: workflow.subjectType, id: workflow.subjectId },
    text,
    evidence,
    actions: legalWorkflowActions(workflow),
  };
};

/**
 * The status intent of a live opportunity.
 *
 * The opportunity offers its dismissal and nothing else: the operator may
 * dismiss what the journal offers, and the workflow commands belong to the
 * workflows.
 */
export const statusIntent = (
  opportunity: OpportunityRow,
  surface: InteractionSurface,
  now: number = Date.now(),
): InteractionIntent | null => {
  if (!LIVE_STATUSES.includes(opportunity.status)) return null;
  if (opportunity.expiresAt <= now) return null;
  return {
    kind: "status",
    intentId: `intent:opportunity:${opportunity.id}:${surface}`,
    surface,
    subject: { type: opportunity.subjectType, id: opportunity.subjectId },
    status: opportunity.status,
    updatedAt: opportunity.updatedAt,
    text: "The journal has something to show you.",
    actions: [
      {
        actionId: opportunityDismissActionId(opportunity.id),
        action: "dismiss",
        label: "Dismiss",
        requiresInput: false,
      },
    ],
  };
};

/**
 * The input intent of a workflow that waits for an answer.
 *
 * The intent is null for a workflow that is not waiting for the operator.
 */
export const inputRequestIntent = (
  workflow: WorkflowRow,
  prompt: string,
  constraint: InputConstraint,
): InteractionIntent | null => {
  if (workflow.status !== "waiting_for_user") return null;
  return {
    kind: "input-request",
    intentId: `intent:workflow:${workflow.id}:input`,
    workflowId: workflow.id,
    expectedRevision: workflow.revision,
    subject: { type: workflow.subjectType, id: workflow.subjectId },
    prompt,
    input: constraint,
    actions: legalWorkflowActions(workflow),
  };
};
