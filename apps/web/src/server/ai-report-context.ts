/**
 * Read-only report-mode query capability. Reuses the existing journal-core
 * query functions; no raw SQL, no broker SDK, no settings access.
 */

import {
  byDuration,
  byPlaybook,
  byMistake,
  bySymbol,
  byTag,
  byWeekday,
  computeMetrics,
  dayKeyOf,
  matchesFilters,
  type AnnotatedTrade,
  type BucketStats,
} from "@luxalgo/journal-core";
import { queryTrades } from "./trades-query";
import type { FrozenApprovedScope } from "./ai-scope";

export type ReportMode = "overview" | "trends" | "explorer" | "breakdown" | "compare";

const KNOWN_MODES: readonly ReportMode[] = [
  "overview",
  "trends",
  "explorer",
  "breakdown",
  "compare",
];

const MODE_PRIMARY_REQUIRED: readonly ReportMode[] = ["compare"];
const MODE_SECONDARY_ALLOWED: readonly ReportMode[] = ["compare"];

const MAX_OUTPUT_BYTES = 6 * 1024; // 6 KB
const MAX_KEY_CHARS = 64;

const bucketBlock = (title: string, buckets: BucketStats[]): string =>
  buckets.length === 0
    ? ""
    : `${title}:\n${buckets
        .map(
          (b) =>
            `  ${b.key}: ${b.trades} trades, net ${b.netPnl.toFixed(2)}, win ${b.winRate === null ? "n/a" : `${(b.winRate * 100).toFixed(0)}%`}`,
        )
        .join("\n")}\n`;

const buildOverview = (trades: AnnotatedTrade[], timeZone: string): string => {
  const m = computeMetrics(trades, { timeZone });
  return [
    `Total trades: ${m.totalTrades} | Win: ${m.winRate == null ? "n/a" : `${(m.winRate * 100).toFixed(1)}%`} | Net: $${m.netPnl.toFixed(2)} | Gross: $${m.grossPnl.toFixed(2)} | Fees: $${m.fees.toFixed(2)}`,
    `Closed: ${m.closedTrades} | Open: ${m.openTrades}`,
    `Avg win: $${m.avgWin?.toFixed(2) ?? "n/a"} | Avg loss: $${m.avgLoss?.toFixed(2) ?? "n/a"} | RR: ${m.avgWinLossRatio ?? "n/a"} | Expectancy: $${m.expectancy?.toFixed(2) ?? "n/a"}`,
    `Largest win: $${m.largestWin.toFixed(2)} | Largest loss: $${m.largestLoss.toFixed(2)}`,
    bucketBlock("By Symbol", bySymbol(trades)),
    bucketBlock("By Day", byWeekday(trades, timeZone)),
    bucketBlock("By Tag", byTag(trades)),
    bucketBlock("By Duration", byDuration(trades)),
  ]
    .filter(Boolean)
    .join("\n");
};

const buildTrends = (trades: AnnotatedTrade[], timeZone: string): string => {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime(),
  );
  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  const firstDay = first ? dayKeyOf(first.openedAt, timeZone) : "—";
  const lastDay = last ? dayKeyOf(last.openedAt, timeZone) : "—";
  const days = new Set(trades.map((t) => dayKeyOf(t.openedAt, timeZone))).size;
  const m = computeMetrics(trades, { timeZone });
  return [
    `Period: ${firstDay} → ${lastDay} | ${days} trading days | ${trades.length} trades`,
    `Net P&L: $${m.netPnl.toFixed(2)} | Win rate: ${m.winRate === null ? "n/a" : `${(m.winRate * 100).toFixed(1)}%`} | Expectancy: $${m.expectancy?.toFixed(2) ?? "n/a"}`,
    bucketBlock("By Weekday", byWeekday(trades, timeZone)),
    bucketBlock("By Symbol", bySymbol(trades)),
    bucketBlock("By Duration", byDuration(trades)),
  ]
    .filter(Boolean)
    .join("\n");
};

const buildExplorer = (trades: AnnotatedTrade[], _timeZone: string): string => {
  return [
    bucketBlock("By Tag", byTag(trades)),
    bucketBlock("By Playbook", byPlaybook(trades)),
    bucketBlock("By Mistake", byMistake(trades)),
    bucketBlock("By Symbol", bySymbol(trades)),
    bucketBlock("By Duration", byDuration(trades)),
  ]
    .filter(Boolean)
    .join("\n");
};

const buildBreakdown = (trades: AnnotatedTrade[], timeZone: string): string => {
  const m = computeMetrics(trades, { timeZone });
  const days = new Set(trades.map((t) => dayKeyOf(t.openedAt, timeZone))).size;
  const symbols = new Set(trades.map((t) => t.symbol)).size;
  return [
    `Summary: ${trades.length} trades over ${days} days, ${symbols} symbols`,
    `Net: $${m.netPnl.toFixed(2)} | Gross: $${m.grossPnl.toFixed(2)} | Fees: $${m.fees.toFixed(2)}`,
    `Win ${m.winRate === null ? "n/a" : `${(m.winRate * 100).toFixed(1)}%`} | Avg win $${m.avgWin?.toFixed(2) ?? "n/a"} | Avg loss $${m.avgLoss?.toFixed(2) ?? "n/a"}`,
    bucketBlock("By Symbol", bySymbol(trades)),
    bucketBlock("By Tag", byTag(trades)),
    bucketBlock("By Playbook", byPlaybook(trades)),
  ]
    .filter(Boolean)
    .join("\n");
};

const buildCompare = (
  trades: AnnotatedTrade[],
  timeZone: string,
  primary: string,
  secondary?: string,
): string => {
  const primaryTrades = trades.filter((t) => t.symbol === primary);
  const secondaryTrades = secondary ? trades.filter((t) => t.symbol === secondary) : [];
  const primaryMetrics = computeMetrics(primaryTrades, { timeZone });
  const secondaryMetrics =
    secondaryTrades.length > 0 ? computeMetrics(secondaryTrades, { timeZone }) : null;

  const lines = [
    `Compare: ${primary} vs ${secondary ?? "all others"}`,
    `${primary}: ${primaryTrades.length} trades | net $${primaryMetrics.netPnl.toFixed(2)} | win ${primaryMetrics.winRate === null ? "n/a" : `${(primaryMetrics.winRate * 100).toFixed(0)}%`}`,
  ];
  if (secondaryMetrics !== null) {
    lines.push(
      `${secondary}: ${secondaryTrades.length} trades | net $${secondaryMetrics.netPnl.toFixed(2)} | win ${secondaryMetrics.winRate === null ? "n/a" : `${(secondaryMetrics.winRate * 100).toFixed(0)}%`}`,
    );
  }
  return lines.join("\n");
};

/**
 * Validate mode and keys, then build the bounded text summary.
 * Returns { error } for invalid inputs; { context } on success (capped at 6 KB).
 */
export async function reportContext(
  scope: FrozenApprovedScope,
  mode: ReportMode,
  params: { primary?: string; secondary?: string } = {},
): Promise<{ context: string } | { error: string }> {
  if (!KNOWN_MODES.includes(mode)) {
    return { error: `Unknown report mode: ${mode}` };
  }

  const { primary, secondary } = params;

  if (primary !== undefined && primary.length > MAX_KEY_CHARS) {
    return { error: `primary key exceeds ${MAX_KEY_CHARS} characters` };
  }
  if (secondary !== undefined && secondary.length > MAX_KEY_CHARS) {
    return { error: `secondary key exceeds ${MAX_KEY_CHARS} characters` };
  }

  if (MODE_PRIMARY_REQUIRED.includes(mode) && !primary) {
    return { error: `primary key is required for ${mode} mode` };
  }
  if (!MODE_SECONDARY_ALLOWED.includes(mode) && secondary !== undefined) {
    return { error: `secondary key is not supported in ${mode} mode` };
  }

  const { trades } = queryTrades(scope.filters, scope.timeZone);

  let context: string;
  switch (mode) {
    case "overview":
      context = buildOverview(trades, scope.timeZone);
      break;
    case "trends":
      context = buildTrends(trades, scope.timeZone);
      break;
    case "explorer":
      context = buildExplorer(trades, scope.timeZone);
      break;
    case "breakdown":
      context = buildBreakdown(trades, scope.timeZone);
      break;
    case "compare":
      context = buildCompare(trades, scope.timeZone, primary!, secondary);
      break;
    default:
      return { error: `Unknown report mode: ${mode}` };
  }

  if (context.length > MAX_OUTPUT_BYTES) {
    context = context.slice(0, MAX_OUTPUT_BYTES);
  }

  return { context };
}
