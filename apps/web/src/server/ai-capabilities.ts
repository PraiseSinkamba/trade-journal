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
import {
  db,
  playbooks,
  tradeRuleChecks,
  missedTrades,
  notes,
  progressRules,
  progressChecks,
} from "@/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

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

  const { trades } = queryTrades(filters, timeZone);
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
export async function tradeCritiqueContext(key: string): Promise<null | {
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

/** Bound output to ≤6 KB. */
const cap = (text: string): string =>
  text.length > 6 * 1024 ? text.slice(0, 6 * 1024) + "\n[truncated]" : text;

/** Validate ISO date string (YYYY-MM-DD). */
const isIsoDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

/** playbookRulesForTrade — returns ≤6 KB summary of playbook rules for a scoped trade. */
export async function playbookRulesForTrade(
  scope: FrozenApprovedScope,
  key: string,
): Promise<{ context: string } | { error: string }> {
  if (scope.dataSource !== "trades+playbooks") {
    return { error: "Scope does not include playbook data" };
  }
  const trade = getTradeByKey(key);
  if (!trade || !scope.accounts.some((a) => a.id === trade.accountId)) {
    return { error: "Trade not found in scope" };
  }
  const checks = db.select().from(tradeRuleChecks).where(eq(tradeRuleChecks.tradeKey, key)).all();
  if (checks.length === 0) {
    return { context: cap(`Trade ${key} has no playbook rule checks recorded.`) };
  }
  const bookMap = Object.fromEntries(
    db
      .select({ id: playbooks.id, name: playbooks.name })
      .from(playbooks)
      .all()
      .map((b) => [b.id, b.name]),
  );
  const lines: string[] = [];
  for (const check of checks) {
    const bookName = bookMap[check.playbookId] ?? "Unknown playbook";
    const status = check.followed ? "✓ pass" : "✗ fail";
    lines.push(`[${bookName}] ${check.rule}: ${status}`);
  }
  return { context: cap(lines.join("\n")) };
}

/** missedObservations — returns ≤6 KB summary of archived missed-trade observations in date range. */
export async function missedObservations(
  scope: FrozenApprovedScope,
  since: string,
  until?: string,
): Promise<{ context: string } | { error: string }> {
  if (scope.dataSource !== "trades+missed") {
    return { error: "Scope does not include missed-trade data" };
  }
  if (!isIsoDate(since)) return { error: "Invalid date format" };
  const untilDate = until ?? since;
  if (!isIsoDate(untilDate) || untilDate < since) return { error: "Invalid date range" };
  const sinceDate = since;
  // observedAt is ISO timestamp; compare as ISO prefix strings
  const rows = db
    .select()
    .from(missedTrades)
    .where(sql`${missedTrades.observedAt} >= ${sinceDate}`)
    .all()
    .filter((r) => r.observedAt.slice(0, 10) <= untilDate);
  if (rows.length === 0) {
    return {
      context: cap(`No missed-trade observations recorded between ${sinceDate} and ${untilDate}.`),
    };
  }
  const lines: string[] = [`Missed observations (${rows.length} records):`];
  for (const r of rows) {
    const archived = r.archivedAt ? " [archived]" : "";
    const pbTag = r.playbookId ? ` (playbook ${r.playbookId})` : "";
    lines.push(
      `  ${r.observedAt.slice(0, 10)} ${r.direction} ${r.symbol}${pbTag}${archived}: ${r.notes || "(no notes)"}`,
    );
  }
  return { context: cap(lines.join("\n")) };
}

/** notebookEntries — returns ≤6 KB summary of notebook notes, optionally filtered by folder or query. */
export async function notebookEntries(
  scope: FrozenApprovedScope,
  folderId?: string,
  q?: string,
): Promise<{ context: string } | { error: string }> {
  if (scope.dataSource !== "trades+notes") {
    return { error: "Scope does not include notebook data" };
  }
  let rows = db.select().from(notes).all();
  if (folderId) rows = rows.filter((r) => r.folderId === folderId);
  if (q) {
    const lq = q.toLowerCase();
    rows = rows.filter(
      (r) => r.title.toLowerCase().includes(lq) || r.content.toLowerCase().includes(lq),
    );
  }
  if (rows.length === 0) {
    return { context: cap("No notebook entries found.") };
  }
  const lines: string[] = [`Notebook entries (${rows.length}):`];
  for (const r of rows) {
    const tags = r.tagsJson ? ` [${JSON.parse(r.tagsJson).join(", ")}]` : "";
    lines.push(
      `  "${r.title}"${tags}: ${r.content.slice(0, 200)}${r.content.length > 200 ? "…" : ""}`,
    );
  }
  return { context: cap(lines.join("\n")) };
}

/** progressHistory — returns ≤6 KB summary of routine stage hit rates over the last N weeks. */
export async function progressHistory(
  scope: FrozenApprovedScope,
  weeks?: number,
): Promise<{ context: string; scope: FrozenApprovedScope } | { error: string }> {
  if (scope.dataSource !== "trades+progress") {
    return { error: "Scope does not include progress data" };
  }
  const n = weeks ?? 13;
  const allRules = db.select().from(progressRules).all();
  const allChecks = db.select().from(progressChecks).all();

  // Compute cutoff: N weeks ago from today
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - n * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const scheduled = allRules.filter((r) => !r.archivedAt || r.archivedAt.slice(0, 10) > cutoffStr);
  const scheduledIds = Object.fromEntries(scheduled.map((r) => [r.id, true])) as Record<
    string,
    true
  >;

  const recentChecks = allChecks.filter((c) => c.date >= cutoffStr && c.ruleId in scheduledIds);

  // Group by rule and compute hit rates
  const ruleStats: Record<string, { total: number; done: number }> = Object.fromEntries(
    scheduled.map((r) => [r.id, { total: 0, done: 0 }]),
  );
  for (const c of recentChecks) {
    const s = ruleStats[c.ruleId];
    if (s) {
      s.total++;
      if (c.done) s.done++;
    }
  }

  if (Object.keys(ruleStats).length === 0) {
    return { context: cap("No progress routines scheduled in the last " + n + " weeks."), scope };
  }

  const statVals = Object.values(ruleStats);
  const lines: string[] = [`Progress history (last ${n} weeks, ${statVals.length} routines):`];
  for (const r of scheduled) {
    const s = ruleStats[r.id]!;
    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    lines.push(`  ${r.stage}/${r.title}: ${s.done}/${s.total} done (${pct}%)`);
  }
  const totalDone = statVals.reduce((sum, s) => sum + s.done, 0);
  const totalAll = statVals.reduce((sum, s) => sum + s.total, 0);
  const overallPct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0;
  lines.push(`Overall: ${totalDone}/${totalAll} completed (${overallPct}%)`);
  return { context: cap(lines.join("\n")), scope };
}
