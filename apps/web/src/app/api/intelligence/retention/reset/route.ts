import { z } from "zod";
import { bad, handler, ok } from "@/server/api";
import { existingAccountIds } from "@/server/intelligence/composition";
import { resetAccountIntelligence } from "@/server/trading/commands";

/**
 * The account reset (Phase 20).
 *
 * A reset purges what the journal knows about one account and suppresses its
 * reseed: the account survives, its intelligence does not. The deletion ledger
 * records the reset, so a restore of an older backup purges the account again
 * instead of bringing the deleted intelligence back.
 *
 * The route only touches accounts the journal knows: a reset of an account
 * that does not exist is a scope error, not a silent no-op.
 */

/** The body the reset route accepts: the account to reset. */
const accountSchema = z.object({ accountId: z.string().min(1) }).strict();

export const POST = handler(
  async (request: Request) => {
    const body = await request.json().catch(() => undefined);
    const parsed = accountSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_request", 400);

    // The scope check comes before the purge: an account the journal does not
    // know is refused, so the reset never writes a ledger entry for it.
    if (!existingAccountIds().includes(parsed.data.accountId)) {
      return bad("scope_denied", 403);
    }

    resetAccountIntelligence(parsed.data.accountId);

    return ok({ accountId: parsed.data.accountId, checkpoint: "suppressed" });
  },
  { origin: true, sanitize: true },
);
