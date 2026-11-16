import { z } from "zod";
import { bad, handler, ok } from "@/server/api";
import { checkRequestOrigin } from "@/server/request-origin";
import { accounts, db, dataDir, intelligenceSeedCheckpoints } from "@/db";
import {
  KNOWLEDGE_RETENTION_WINDOW_MS,
  readPurgeLedger,
  RETENTION_PRUNE_LIMIT,
  RETENTION_WINDOW_MS,
  pruneIntelligence,
  pruneSupersededKnowledge,
} from "@/server/intelligence/infrastructure/retention";

/**
 * The retention surface (Phase 20).
 *
 * `GET` answers the retention state: the windows, the bound, the deletion
 * ledger and the seed checkpoint of every account.
 * `POST` runs a prune: the finished transport rows and the diagnostics older
 * than the cutoff go, and then the knowledge older than its own window.
 *
 * The prune is the operator's own decision, so the route runs it on request
 * rather than on a schedule the operator cannot see.
 */

/** The body the retention route accepts: the cutoff and the bound of a run. */
const retentionRunSchema = z
  .object({
    before: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

/** The milliseconds of a day, to express a window in days. */
const DAY_MS = 86_400_000;

export const GET = handler(
  async (request: Request) => {
    // The origin policy is the route's own: the retention state says what was
    // purged, and a page of another site must not learn it.
    if (!checkRequestOrigin(request).allowed) return bad("origin_denied", 403);

    // The ledger lives beside the database, not inside it: a restore replaces
    // the database, and the ledger must survive that.
    const purgedAccounts = readPurgeLedger(dataDir()).map((entry) => ({
      accountId: entry.accountId,
      kind: entry.kind,
    }));

    // The checkpoint of an account that has none is `null`: the account has
    // not been seeded yet, which is not the same as a suppressed seed.
    const checkpoints = new Map(
      db
        .select({
          accountId: intelligenceSeedCheckpoints.accountId,
          status: intelligenceSeedCheckpoints.status,
        })
        .from(intelligenceSeedCheckpoints)
        .all()
        .map((row) => [row.accountId, row.status]),
    );
    const accountStates = db
      .select({ id: accounts.id })
      .from(accounts)
      .all()
      .map((row) => ({ id: row.id, checkpoint: checkpoints.get(row.id) ?? null }));

    return ok({
      retention: {
        windows: {
          transportDays: Math.round(RETENTION_WINDOW_MS / DAY_MS),
          knowledgeDays: Math.round(KNOWLEDGE_RETENTION_WINDOW_MS / DAY_MS),
        },
        limit: RETENTION_PRUNE_LIMIT,
        purgedAccounts,
        accounts: accountStates,
      },
    });
  },
  { sanitize: true },
);

export const POST = handler(
  async (request: Request) => {
    // A body that is not JSON is a client error, not an internal failure.
    const body = await request.json().catch(() => undefined);
    const parsed = retentionRunSchema.safeParse(body);
    if (!parsed.success) return bad("invalid_request", 400);

    const before = parsed.data.before ?? Date.now() - RETENTION_WINDOW_MS;
    const limit = parsed.data.limit ?? RETENTION_PRUNE_LIMIT;

    // The transport and the diagnostics go first: the knowledge prune runs on
    // what the first prune left, so it gets the rows that are left of the
    // bound.
    const { removed } = pruneIntelligence(before, limit);
    const knowledge = pruneSupersededKnowledge(
      Date.now() - KNOWLEDGE_RETENTION_WINDOW_MS,
      limit - removed,
    );

    return ok({ removed, knowledgeRemoved: knowledge.removed, before });
  },
  { origin: true, sanitize: true },
);
