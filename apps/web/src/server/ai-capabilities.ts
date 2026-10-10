import {
  byDuration,
  byHour,
  byMistake,
  byPlaybook,
  bySymbol,
  byTag,
  byWeekday,
  computeMetrics,
  dayKeyOf,
  type BucketStats,
} from "@luxalgo/journal-core";
import { queryTrades } from "./trades-query";
import { getTradeByKey, rowToTrade } from "./trades-query";
import { listExecutions } from "./executions";
import { accountContext, type FrozenApprovedScope } from "./ai-scope";

const bucketBlock = (title: string, buckets: BucketStats[]): string =>
  buckets.length === 0
    ? ""
    : `${title}:\n${buckets
        .map(
          (b) =>
            `  ${b.key}: ${b.trades} trades, net ${b.netPnl.toFixed(2)}, win ${b.winRate === null ? "n/a" : `${(b.winRate * 100).toFixed(0)}%`}`,
        )
        .join("\n")}\n`;

/** "Ask your journal" capability — returns read-only context. */
export async function askJournalContext(
  scope: FrozenApprovedScope,
): Promise<{ error: string } | { context: string; scope: FrozenApprovedScope }> {
  const { question, timeZone, filters } = scope;

  const { trades } = queryTrades(filters);
  if (trades.length === 0) return { error: "No trades match the selected accounts and filters" };

  const m = computeMetrics(trades, { timeZone });

  const context = [
    scope.context,
    accountContext(trades, scope),
    `Overall: net ${m.netPnl.toFixed(2)} over ${m.closedTrades} closed trades (${m.tradingDays} days), win rate ${m.winRate === null ? "n/a" : `${(m.winRate * 100).toFixed(1)}%`}, profit factor ${m.profitFactorIsInfinite ? "inf" : (m.profitFactor?.toFixed(2) ?? "n/a")}, avg win ${m.avgWin?.toFixed(2) ?? "n/a"}, avg loss ${m.avgLoss?.toFixed(2) ?? "n/a"}, max drawdown ${m.maxDrawdown.toFixed(2)}, day win rate ${m.dayWinRate === null ? "n/a" : `${(m.dayWinRate * 100).toFixed(0)}%`}, fees ${m.fees.toFixed(2)}.`,
    bucketBlock("By symbol (top 12)", bySymbol(trades).slice(0, 12)),
    bucketBlock("By weekday", byWeekday(trades, timeZone)),
    bucketBlock("By hour of open", byHour(trades, timeZone)),
    bucketBlock("By holding time", byDuration(trades)),
    bucketBlock("By tag", byTag(trades).slice(0, 12)),
    bucketBlock("By mistake", byMistake(trades).slice(0, 12)),
    bucketBlock("By playbook", byPlaybook(trades)),
  ].join("\n");

  return { context, scope };
}

/** Daily recap capability — returns read-only context data. Throws when no trades match the day. */
export async function dailyRecapContext(
  scope: FrozenApprovedScope,
  date: string,
  existingNote: string | undefined,
): Promise<{
  context: {
    scopeContext: string;
    accountContext: string;
    metricsLine: string;
    tradeLines: string;
    existingNote: string | undefined;
  };
  date: string;
}> {
  const { timeZone, filters } = scope;

  const { trades } = queryTrades(filters);
  const dayTrades = trades.filter(
    (trade) => trade.closedAt && dayKeyOf(trade.closedAt, timeZone) === date,
  );
  if (dayTrades.length === 0) {
    throw new Error("No closed trades match this day and the selected filters");
  }

  const metrics = computeMetrics(dayTrades, { timeZone });

  const tradeLines = dayTrades
    .map(
      (trade) =>
        `${JSON.stringify(scope.accounts.find((a) => a.id === trade.accountId)?.name)} | ${trade.symbol} ${trade.direction} qty ${trade.quantity} | entry ${trade.avgEntry} → exit ${trade.avgExit} | net ${trade.netPnl.toFixed(2)} | held ${Math.round((trade.durationMs ?? 0) / 60_000)}m` +
        (trade.annotations?.tags?.length ? ` | tags: ${trade.annotations.tags.join(", ")}` : "") +
        (trade.annotations?.mistakes?.length
          ? ` | mistakes: ${trade.annotations.mistakes.join(", ")}`
          : ""),
    )
    .join("\n");

  return {
    context: {
      scopeContext: scope.context,
      accountContext: accountContext(dayTrades, scope),
      metricsLine: `net P&L ${metrics.netPnl.toFixed(2)}, ${metrics.closedTrades} trades,
win rate ${metrics.winRate === null ? "n/a" : (metrics.winRate * 100).toFixed(0)}%,
fees ${metrics.fees.toFixed(2)}.`,
      tradeLines,
      existingNote,
    },
    date,
  };
}

/** Trade critique capability — returns null when no trade matches the key. */
export async function tradeCritiqueContext(
  key: string,
): Promise<null | {
  trade: {
    symbol: string;
    direction: string;
    status: string;
    netPnl: number;
    grossPnl: number;
    fees: number;
    avgEntry: number;
    avgExit: number | null;
    stopLoss: number | null;
    profitTarget: number | null;
    rating: number | null;
    tags: string[];
    mistakes: string[];
    notes: string | null;
  };
  fills: string[];
}> {
  const row = getTradeByKey(key);
  if (!row) return null;

  const trade = rowToTrade(row);
  const fills = listExecutions(row.accountId, trade.executionIds).sort((a, b) =>
    a.executedAt.localeCompare(b.executedAt),
  );

  return {
    trade: {
      symbol: trade.symbol,
      direction: trade.direction,
      status: trade.status,
      netPnl: trade.netPnl,
      grossPnl: trade.grossPnl,
      fees: trade.fees,
      avgEntry: trade.avgEntry,
      avgExit: trade.avgExit ?? null,
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
  };
}
