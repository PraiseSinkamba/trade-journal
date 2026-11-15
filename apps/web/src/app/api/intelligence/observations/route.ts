import { bad, handler, ok } from "@/server/api";
import {
  observationReviewRequestSchema,
  type EvidenceReference,
  type InteractionIntent,
} from "@/lib/intelligence-interactions";
import {
  interactiveExecutionContext,
  observationReviewIntent,
  workflowEngine,
} from "@/server/intelligence/composition";
import {
  evidenceOf,
  findActiveObservation,
  findWorkflow,
  listObservations,
  listWorkflows,
  observationText,
  resolveScope,
  scopeParam,
} from "../queries";

/**
 * The observation surface (Phase 18).
 *
 * `GET` answers `{ observations, intents }`: the active observations of the
 * scope, each with the review intent of the workflow that waits for it.
 *
 * `POST` starts the review workflow of one active observation and answers
 * `{ workflowId, revision, intent }`.
 */

/** The evidence references of one observation. */
const referencesOf = (links: readonly { revisionId: string }[]): EvidenceReference[] =>
  links.map((link) => ({ revisionId: link.revisionId, kind: "projection_revision" }));

export const GET = handler(
  async (request: Request) => {
    const scope = resolveScope(scopeParam(new URL(request.url)));
    if (!scope) return bad("scope_denied", 403);

    const rows = listObservations(scope);
    const workflows = listWorkflows(
      scope,
      rows.map((row) => row.id),
    );
    const links = evidenceOf(rows.map((row) => row.id));

    const intents: InteractionIntent[] = [];
    for (const row of rows) {
      const workflow = workflows.find((candidate) => candidate.subjectId === row.id);
      if (!workflow) continue;
      const intent = observationReviewIntent(
        workflow,
        referencesOf(links.filter((link) => link.observationId === row.id)),
        observationText(row),
      );
      if (intent) intents.push(intent);
    }

    return ok({
      observations: rows.map((row) => ({
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
      })),
      intents,
    });
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
