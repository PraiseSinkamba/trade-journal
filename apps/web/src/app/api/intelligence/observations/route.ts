import { bad, handler, ok } from "@/server/api";
import {
  observationReviewRequestSchema,
  type EvidenceReference,
  type InteractionIntent,
  type ObservationReviewState,
} from "@/lib/intelligence-interactions";
import {
  interactiveExecutionContext,
  observationReviewIntent,
  workflowEngine,
} from "@/server/intelligence/composition";
import type { WorkflowRow } from "@/server/intelligence/contracts/experience";
import {
  evidenceOf,
  findActiveObservation,
  findWorkflow,
  listObservationReviews,
  listObservations,
  observationText,
  resolveScope,
  scopeParam,
} from "../queries";

/**
 * The observation surface (Phase 18).
 *
 * `GET` answers `{ observations, intents }`: the active observations of the
 * scope, each with the review intent of the workflow that waits for it and
 * the review state it carries.
 *
 * `POST` starts the review workflow of one active observation and answers
 * `{ workflowId, revision, intent }`. One observation carries one review: a
 * review that waits, runs, is deferred or is already given is not started
 * again.
 */

/** The evidence references of one observation. */
const referencesOf = (links: readonly { revisionId: string }[]): EvidenceReference[] =>
  links.map((link) => ({ revisionId: link.revisionId, kind: "projection_revision" }));

/** The statuses that hold a review of an observation. */
const LIVE_REVIEW_STATUSES: readonly WorkflowRow["status"][] = [
  "running",
  "waiting_for_user",
  "scheduled",
];

/**
 * The review state of an observation.
 *
 * A review that was abandoned (cancelled or failed) holds nothing: the
 * observation may be reviewed again. A review that waits, runs or is
 * deferred is live, and a review that completed is the operator's answer.
 */
const reviewStateOf = (reviews: readonly WorkflowRow[]): ObservationReviewState => {
  if (reviews.some((review) => LIVE_REVIEW_STATUSES.includes(review.status))) return "live";
  if (reviews.some((review) => review.status === "completed")) return "reviewed";
  return "unreviewed";
};

export const GET = handler(
  async (request: Request) => {
    const scope = resolveScope(scopeParam(new URL(request.url)));
    if (!scope) return bad("scope_denied", 403);

    const rows = listObservations(scope);
    const reviews = listObservationReviews(rows.map((row) => row.id));
    const links = evidenceOf(rows.map((row) => row.id));

    const intents: InteractionIntent[] = [];
    const observations = rows.map((row) => {
      const ofRow = reviews.filter((review) => review.subjectId === row.id);
      // The review the operator can act on is the one that waits for them,
      // not the first workflow of the observation: a review the operator
      // already gave is finished, and pairing that one would hide the review
      // that is due. The reviews arrive oldest first, so the newest one that
      // waits wins.
      const workflow = ofRow.filter((review) => review.status === "waiting_for_user").at(-1);
      if (workflow) {
        const intent = observationReviewIntent(
          workflow,
          referencesOf(links.filter((link) => link.observationId === row.id)),
          observationText(row),
        );
        if (intent) intents.push(intent);
      }
      return {
        id: row.id,
        subjectId: row.subjectId,
        accountId: row.accountId,
        type: row.type,
        status: row.status,
        currency: row.currency,
        netPnl: row.netPnl,
        fees: row.fees,
        tradeStatus: row.tradeStatus,
        timingQuality: row.timingQuality,
        recordedAt: row.recordedAt,
        updatedAt: row.updatedAt,
        reviewState: reviewStateOf(ofRow),
      };
    });

    return ok({ observations, intents });
  },
  { sanitize: true },
);

export const POST = handler(
  async (request: Request) => {
    const body = await request.json().catch(() => undefined);
    const parsed = observationReviewRequestSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_request", 400);

    const scope = resolveScope(parsed.data.scope);
    if (!scope) return bad("scope_denied", 403);

    // Only an active observation may be reviewed: a superseded or invalidated
    // one is refused before any evidence is read and before a workflow starts.
    const observation = findActiveObservation(parsed.data.observationId);
    if (!observation) return bad("invalid_request", 400);
    if (!scope.accountIds.includes(observation.accountId)) return bad("scope_denied", 403);

    // One observation carries one review. A review that waits, runs, is
    // deferred or is already given is refused, so a repeated start cannot
    // leak a workflow row for an observation the operator already reviewed.
    const reviews = listObservationReviews([observation.id]);
    if (reviewStateOf(reviews) !== "unreviewed") return bad("review_already_started", 409);

    const links = evidenceOf([observation.id]);
    const started = workflowEngine.startWorkflow(
      {
        subjectType: "observation",
        subjectId: observation.id,
        accountId: observation.accountId,
        evidenceIds: links.map((link) => link.revisionId),
      },
      interactiveExecutionContext(scope.accountIds),
    );
    // The effect presents the workflow to the operator, so it may be acted on
    // right away. It is idempotent: the worker that finds it applied declines.
    workflowEngine.applyWorkflowEffect(started.workflowId, started.revision);

    const workflow = findWorkflow(started.workflowId);
    const intent = workflow
      ? observationReviewIntent(workflow, referencesOf(links), observationText(observation))
      : null;
    return ok({
      workflowId: started.workflowId,
      revision: workflow?.revision ?? started.revision,
      intent,
    });
  },
  { origin: true, sanitize: true },
);
