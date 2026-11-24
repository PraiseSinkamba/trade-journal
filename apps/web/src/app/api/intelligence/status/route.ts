import { handler, ok } from "@/server/api";
import { ENGAGEMENT_DEFAULTS, getBackgroundPolicy } from "@/server/intelligence/composition";

/**
 * The status surface (Phase 18).
 *
 * `GET` answers `{ status }`: the background policy the journal runs under,
 * the worker status and the engagement defaults.
 *
 * The view carries no provider key, no endpoint credential and no raw error:
 * it is what the settings surface may show.
 */
export const GET = handler(
  async () => {
    // The status view needs no request: it is the journal's own state.
    return ok({
      status: {
        backgroundPolicy: getBackgroundPolicy(),
        // No worker runs in the web process: the status is reported as absent
        // rather than guessed.
        worker: null,
        engagementDefaults: ENGAGEMENT_DEFAULTS,
      },
    });
  },
  { sanitize: true },
);
