import { tradeRisk, tradeR, plannedR } from "@luxalgo/journal-core";
import { eq } from "drizzle-orm";
import { db, trades, playbooks, accounts } from "@/db";
import { bad, handler, ok, requireValue } from "@/server/api";
import { listExecutions } from "@/server/executions";
import { newUuid, nowIso } from "@/server/ids";
import { getTradeByKey, rowToTrade } from "@/server/trades-query";
import { getTimeZone } from "@/server/settings";
import { deleteTrades } from "@/server/trading/commands";
import { changeContext } from "@/server/trading/reconcile";
import { recordSourceChanges } from "@/server/intelligence/composition";

type Params = { params: Promise<{ key: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { key } = await params;
  const row = getTradeByKey(key);
  if (!row) return bad("Trade not found", 404);
  const trade = rowToTrade(row);
  const fills = listExecutions(row.accountId, trade.executionIds);
  return ok({
    timeZone: getTimeZone(),
    trade: {
      ...row,
      status: trade.status,
      riskAmount: tradeRisk(trade),
      realizedR: tradeR(trade),
      plannedR: plannedR(trade),
      contractMultiplier: trade.contractMultiplier ?? null,
      currency:
        db
          .select({ currency: accounts.currency })
          .from(accounts)
          .where(eq(accounts.id, row.accountId))
          .get()?.currency ?? "USD",
    },
    executions: fills,
  });
});

interface AnnotateBody {
  notes?: string | null;
  tags?: string[];
  mistakes?: string[];
  playbookId?: string | null;
  rating?: number | null;
  stopLoss?: number | null;
  profitTarget?: number | null;
  reviewed?: boolean;
}

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { key } = await params;
  const decoded = key;
  const row = getTradeByKey(decoded);
  if (!row) return bad("Trade not found", 404);

  const body = (await request.json()) as AnnotateBody;
  for (const field of ["stopLoss", "profitTarget", "rating"] as const)
    requireValue(
      body[field] == null || (typeof body[field] === "number" && Number.isFinite(body[field])),
      `Invalid ${field}.`,
    );
  requireValue(
    body.rating == null || (Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5),
    "Rating must be 1–5.",
  );
  requireValue(
    body.notes == null || (typeof body.notes === "string" && body.notes.length <= 100000),
    "Notes must be at most 100,000 characters.",
  );
  for (const field of ["tags", "mistakes"] as const)
    requireValue(
      body[field] === undefined ||
        (Array.isArray(body[field]) &&
          body[field]!.length <= 100 &&
          body[field]!.every((s) => typeof s === "string" && s.length <= 200)),
      `Invalid ${field}.`,
    );
  requireValue(
    !body.playbookId || db.select().from(playbooks).where(eq(playbooks.id, body.playbookId)).get(),
    "Playbook not found.",
  );
  const patch: Partial<typeof trades.$inferInsert> = {};
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.tags !== undefined) patch.tagsJson = JSON.stringify(body.tags);
  if (body.mistakes !== undefined) patch.mistakesJson = JSON.stringify(body.mistakes);
  if (body.playbookId !== undefined) patch.playbookId = body.playbookId;
  if (body.rating !== undefined) patch.rating = body.rating;
  if (body.stopLoss !== undefined) patch.stopLoss = body.stopLoss;
  if (body.profitTarget !== undefined) patch.profitTarget = body.profitTarget;
  if (body.reviewed !== undefined) patch.reviewedAt = body.reviewed ? nowIso() : null;

  if (!Object.keys(patch).length) return ok({ updated: true });
  // The annotation and its source revision commit together. The annotation
  // belongs to the account of the trade.
  recordSourceChanges((tx) => {
    tx.update(trades).set(patch).where(eq(trades.key, decoded)).run();
    return [
      {
        kind: "annotation",
        action: "revised",
        sourceId: decoded,
        accountId: row.accountId,
        correlationId: newUuid(),
      },
    ];
  });
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { key } = await params;
  const row = getTradeByKey(key);
  if (!row) return bad("Trade not found", 404);
  // The command owns the transaction: the fills go, the account is rebuilt and
  // the projection disappears. The annotation goes with the trade, so the
  // deletion and its source revision commit together.
  recordSourceChanges(() => {
    deleteTrades([key], changeContext("user", "live"));
    return [
      {
        kind: "annotation",
        action: "deleted",
        sourceId: key,
        accountId: row.accountId,
        correlationId: newUuid(),
      },
    ];
  });
  return ok({ deleted: true });
});
