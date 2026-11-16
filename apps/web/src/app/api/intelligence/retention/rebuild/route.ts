import { z } from "zod";
import { bad, handler, ok } from "@/server/api";
import { existingAccountIds } from "@/server/intelligence/composition";
import { requestAccountIntelligenceRebuild } from "@/server/trading/commands";

/**
 * The account rebuild (Phase 20).
 *
 * A rebuild undoes a reset: the seed checkpoint moves back to `pending`, the
 * seed job is enqueued and the deletion ledger forgets the reset, because the
 * account's intelligence is meant to come back.
 *
 * The route only touches accounts the journal knows, exactly like the reset.
 */

/** The body the rebuild route accepts: the account to rebuild. */
const accountSchema = z.object({ accountId: z.string().min(1) }).strict();

export const POST = handler(
  async (request: Request) => {
    const body = await request.json().catch(() => undefined);
    const parsed = accountSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_request", 400);

    // The scope check comes before the rebuild: an account the journal does
    // not know is refused, so no checkpoint and no ledger entry is touched.
    if (!existingAccountIds().includes(parsed.data.accountId)) {
      return bad("scope_denied", 403);
    }

    requestAccountIntelligenceRebuild(parsed.data.accountId);

    return ok({ accountId: parsed.data.accountId, checkpoint: "pending" });
  },
  { origin: true, sanitize: true },
);
