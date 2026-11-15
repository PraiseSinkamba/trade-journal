import { z } from "zod";
import { bad, handler, ok } from "@/server/api";
import { produceOpportunitiesForActiveObservations } from "@/server/intelligence/composition";
import { getIntelligenceControls, setIntelligenceControls } from "@/server/settings";

/**
 * The controls surface (Phase 19).
 *
 * `GET` answers `{ controls }`: the journal's own control state.
 * `POST` accepts a partial patch and answers the merged state.
 *
 * The two controls are the journal's self-restraint: the proactive opt-in
 * (may the journal raise an insight it noticed on its own) and the pause
 * (the journal raises nothing while paused).
 */

/** The body the controls route accepts: a partial patch of the two controls. */
const controlsPatchSchema = z
  .object({
    proactiveOptIn: z.boolean().optional(),
    paused: z.boolean().optional(),
  })
  .strict();

export const GET = handler(
  async () => {
    // The controls are the journal's own state: no request body, no scope.
    return ok({ controls: getIntelligenceControls() });
  },
  { sanitize: true },
);

export const POST = handler(
  async (request: Request) => {
    // A body that is not JSON is a client error, not an internal failure.
    const body = await request.json().catch(() => undefined);
    const parsed = controlsPatchSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_request", 400);

    const controls = setIntelligenceControls(parsed.data);

    // Raising the opportunities the journal already noticed is best-effort:
    // the controls are saved either way, and a failure here must neither
    // fail the request nor leak its cause to the operator.
    if (controls.proactiveOptIn && !controls.paused) {
      try {
        produceOpportunitiesForActiveObservations();
      } catch (error) {
        console.error("intelligence controls: opportunity production failed", error);
      }
    }

    return ok({ controls });
  },
  { origin: true, sanitize: true },
);
