import { bad, handler, ok } from "@/server/api";
import { runAi } from "@/server/ai";
import { buildTradeCritiquePrompt } from "@/server/ai-prompts";
import { listExecutions } from "@/server/executions";
import { getTradeByKey, rowToTrade } from "@/server/trades-query";

/** Critique one trade: entries, exits, sizing, and the trader's own annotations. */
export const POST = handler(async (request: Request) => {
  const { key } = (await request.json()) as { key?: string };
  if (!key) return bad("key is required");
  const row = getTradeByKey(key);
  if (!row) return bad("Trade not found", 404);
  const trade = rowToTrade(row);
  const fills = listExecutions(row.accountId, trade.executionIds).sort((a, b) =>
    a.executedAt.localeCompare(b.executedAt),
  );

  const critique = await runAi(
    buildTradeCritiquePrompt({
      trade: {
        symbol: trade.symbol,
        direction: trade.direction,
        status: trade.status,
        netPnl: trade.netPnl,
        grossPnl: trade.grossPnl,
        fees: trade.fees,
        avgEntry: trade.avgEntry,
        avgExit: trade.avgExit,
        stopLoss: row.stopLoss,
        profitTarget: row.profitTarget,
        rating: row.rating,
        tags: trade.annotations?.tags ?? [],
        mistakes: trade.annotations?.mistakes ?? [],
        notes: row.notes,
      },
      fills: fills.map(
        (fill) =>
          `${fill.executedAt} ${fill.side} ${fill.quantity} @ ${fill.price}${fill.fee ? ` fee ${fill.fee}` : ""}`,
      ),
    }),
  );

  return ok({ critique });
});