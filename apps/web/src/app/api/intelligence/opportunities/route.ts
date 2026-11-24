import { bad, handler, ok } from "@/server/api";
import {
  dismissRequestSchema,
  parseInteractionActionId,
  type InteractionIntent,
} from "@/lib/intelligence-interactions";
import { engagementCoordinator, statusIntent } from "@/server/intelligence/composition";
import {
  findOpportunity,
  listOpportunities,
  observationOfRevision,
  resolveScope,
  scopeParam,
} from "../queries";

/**
 * The opportunity surface (Phase 18).
 *
 * `GET` answers `{ opportunities, intents }`: the live opportunities of the
 * scope, each with the dismissal intent the operator may act on.
 *
 * `POST` dismisses one opportunity or one evidence revision and answers
 * `{ kind: "dismissed", scope, target }`.
 */

/** The evidence revisions an opportunity rests on. */
const evidenceOf = (raw: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
};

export const GET = handler(
  async (request: Request) => {
    const scope = resolveScope(scopeParam(new URL(request.url)));
    if (!scope) return bad("scope_denied", 403);

    const rows = listOpportunities(scope);
    const intents: InteractionIntent[] = [];
    for (const row of rows) {
      const intent = statusIntent(row, "inbox");
      if (intent) intents.push(intent);
    }

    return ok({
      opportunities: rows.map((row) => ({
        id: row.id,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        accountId: row.accountId,
        status: row.status,
        eligibleAt: row.eligibleAt,
        expiresAt: row.expiresAt,
        evidenceIds: evidenceOf(row.evidenceIdsJson),
        createdAt: row.createdAt,
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
    const parsed = dismissRequestSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_request", 400);
    const dismissal = parsed.data;

    const scope = resolveScope(dismissal.accounts);
    if (!scope) return bad("scope_denied", 403);

    // The action id is a handle: it must name the target that is dismissed.
    const actionId = parseInteractionActionId(dismissal.actionId);
    if (!actionId) return bad("invalid_request", 400);

    if (dismissal.scope === "opportunity") {
      if (actionId.kind !== "opportunity-dismiss" || actionId.opportunityId !== dismissal.target) {
        return bad("invalid_request", 400);
      }
      const opportunity = findOpportunity(dismissal.target);
      if (!opportunity) return bad("invalid_request", 400);
      if (opportunity.accountId !== null && !scope.accountIds.includes(opportunity.accountId)) {
        return bad("scope_denied", 403);
      }
      engagementCoordinator.dismiss("opportunity", opportunity.id);
    } else {
      if (actionId.kind !== "evidence-dismiss" || actionId.revisionId !== dismissal.target) {
        return bad("invalid_request", 400);
      }
      const observation = observationOfRevision(dismissal.target);
      if (observation) {
        if (!scope.accountIds.includes(observation.accountId)) {
          return bad("scope_denied", 403);
        }
      } else if (!scope.all) {
        // A revision that belongs to no observation belongs to no account:
        // only a request about every account may dismiss it.
        return bad("scope_denied", 403);
      }
      engagementCoordinator.dismiss("evidence", dismissal.target);
    }

    return ok({ kind: "dismissed", scope: dismissal.scope, target: dismissal.target });
  },
  { origin: true, sanitize: true },
);
