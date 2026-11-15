import { NextResponse } from "next/server";
import { bad, handler, ok } from "@/server/api";
import { interactionCommands } from "@/server/intelligence/composition";

/**
 * The command surface (Phase 18).
 *
 * `POST` applies one workflow command and answers the engine's
 * `WorkflowResult` verbatim: `{ kind: "applied", newRevision }` or
 * `{ kind: "duplicate", priorResult }`.
 *
 * A request that does not parse is `400`, a revoked scope is `403` and a
 * stale revision (or a workflow that is gone) is `409`.
 */
export const POST = handler(
  async (request: Request) => {
    // A body that is not JSON is a client error, not an internal failure: the
    // service parses it and refuses it.
    const body = await request.json().catch(() => undefined);
    const outcome = interactionCommands.apply(body);

    if (outcome.status === 200) return ok(outcome.result);
    if (outcome.status === 400) return bad("invalid_request", 400);
    if (outcome.status === 403) return bad("scope_denied", 403);
    return NextResponse.json(
      { error: "stale_revision", currentRevision: outcome.currentRevision },
      { status: 409 },
    );
  },
  { origin: true, sanitize: true },
);
