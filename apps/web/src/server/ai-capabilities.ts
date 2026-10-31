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
  type AnnotatedTrade,
  type BucketStats,
} from "@luxalgo/journal-core";
import { z } from "zod";
import { queryTrades } from "./trades-query";
import { getTradeByKey, rowToTrade } from "./trades-query";
import { listExecutions } from "./executions";
import { accountContext, type FrozenApprovedScope } from "./ai-scope";
import { AI_TOOL_IDS, AI_TOOL_RESULTS, aiToolFailure } from "./ai-contracts";
import { reportContext, type ReportMode } from "./ai-report-context";
import type { JournalCapabilityPort } from "./intelligence/contracts/capabilities";
import type { ExecutionContext } from "./intelligence/contracts/execution";
import type { ToolDefinition, ToolGateway } from "./intelligence/contracts/tools";
import { createGatewayTool, type ExecutableSdkTool } from "./intelligence/runtime/ai-sdk-tools";
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

/* ---------------------------------------------------------------------------
 * The registered Ask and Reports tools.
 *
 * A tool is the model-facing view of a scoped journal read. Every tool is
 * registered with strict schemas so the gateway can refuse a malformed or
 * out-of-scope call before it reaches a query. No tool can widen the scope,
 * and no tool writes to the journal.
 * ------------------------------------------------------------------------ */

const tradeSummarySchema = z
  .object({
    key: z.string(),
    symbol: z.string(),
    direction: z.string(),
    outcome: z.string(),
    openedAt: z.string(),
    closedAt: z.string().optional(),
    quantity: z.number(),
    netPnl: z.number(),
    fees: z.number(),
  })
  .strict();

const fillSummarySchema = z
  .object({
    id: z.string(),
    symbol: z.string(),
    side: z.string(),
    quantity: z.number(),
    price: z.number(),
    fee: z.number(),
    executedAt: z.string(),
  })
  .strict();

const errorResultSchema = z.object({ error: z.string() }).strict();

const summaryOutputSchema = z.union([
  z.object({ context: z.string() }).strict(),
  errorResultSchema,
]);

const findTradesOutputSchema = z.union([
  z.object({ trades: z.array(tradeSummarySchema) }).strict(),
  errorResultSchema,
]);

const tradeDetailOutputSchema = z.union([
  z.object({ trade: tradeSummarySchema, fills: z.array(fillSummarySchema) }).strict(),
  errorResultSchema,
]);

const reportModeOutputSchema = z.union([
  z.object({ context: z.string(), mode: z.string() }).strict(),
  errorResultSchema,
]);

/** Return a bounded trade projection rather than user notes or arbitrary annotations. */
const summarizeTrade = (trade: AnnotatedTrade) => ({
  key: trade.key,
  symbol: trade.symbol,
  direction: trade.direction,
  outcome: trade.status,
  openedAt: trade.openedAt,
  closedAt: trade.closedAt,
  quantity: trade.quantity,
  netPnl: trade.netPnl,
  fees: trade.fees,
});

/** The options that decide whether the report-mode tool is enabled. */
export type AskJournalToolOptions = Readonly<{ reportMode?: boolean }>;

/**
 * Register the Ask and Reports tools over one approved scope.
 *
 * The tools are bound to the scope that the route already approved, so they
 * can only read what that scope allows. The report-mode tool stays registered
 * for every feature because the legacy tool set exposed it; it refuses
 * itself when the feature is not the reports agent.
 */
export function createAskJournalToolDefinitions(
  scope: FrozenApprovedScope,
  context: string,
  options: AskJournalToolOptions = {},
): ToolDefinition[] {
  const scopedTrades = () => queryTrades(scope.filters, scope.timeZone).trades;

  return [
    {
      id: AI_TOOL_IDS.journalSummary,
      requiredDataSources: ["trades"],
      version: "1",
      description:
        "Return the current aggregate and bucket summary for the selected journal scope.",
      access: "read",
      inputSchema: z.object({}).strict(),
      outputSchema: summaryOutputSchema,
      execute: async () => ({ status: "completed", value: { context } }),
    },
    {
      id: AI_TOOL_IDS.findTrades,
      requiredDataSources: ["trades"],
      version: "1",
      description:
        "Find at most five trade summaries within the current journal scope, narrowed only by symbol, outcome, and chronological order.",
      access: "read",
      inputSchema: z
        .object({
          symbol: z.string().min(1).max(64).optional(),
          outcome: z.enum(["win", "loss", "breakeven", "open"]).optional(),
          dateOrder: z.enum(["newest", "oldest"]).optional(),
        })
        .strict(),
      outputSchema: findTradesOutputSchema,
      execute: async (input: unknown) => {
        // The gateway validated the input against the schema above.
        const args = input as { symbol?: string; outcome?: string; dateOrder?: string };
        const direction = args.dateOrder === "oldest" ? 1 : -1;
        const trades = scopedTrades()
          .filter(
            (trade) =>
              (args.symbol === undefined || trade.symbol === args.symbol) &&
              (args.outcome === undefined || trade.status === args.outcome),
          )
          .sort(
            (left, right) =>
              direction *
              (left.openedAt.localeCompare(right.openedAt) || left.key.localeCompare(right.key)),
          )
          .slice(0, 5)
          .map(summarizeTrade);
        return { status: "completed", value: { trades } };
      },
    },
    {
      id: AI_TOOL_IDS.tradeDetail,
      requiredDataSources: ["trades"],
      version: "1",
      description:
        "Return one scoped trade and at most fifty of its chronological fills after verifying its key.",
      access: "read",
      inputSchema: z.object({ key: z.string().min(1).max(300) }).strict(),
      outputSchema: tradeDetailOutputSchema,
      execute: async (input: unknown) => {
        // The gateway validated the input against the schema above.
        const { key } = input as { key: string };
        const trade = scopedTrades().find((candidate) => candidate.key === key);
        if (!trade) {
          return { status: "completed", value: { ...AI_TOOL_RESULTS.tradeUnavailable } };
        }
        const fills = listExecutions(trade.accountId, trade.executionIds)
          .sort(
            (left, right) =>
              left.executedAt.localeCompare(right.executedAt) || left.id.localeCompare(right.id),
          )
          .slice(0, 50)
          .map((fill) => ({
            id: fill.id,
            symbol: fill.symbol,
            side: fill.side,
            quantity: fill.quantity,
            price: fill.price,
            fee: fill.fee,
            executedAt: fill.executedAt,
          }));
        return { status: "completed", value: { trade: summarizeTrade(trade), fills } };
      },
    },
    {
      id: AI_TOOL_IDS.reportMode,
      requiredDataSources: ["trades"],
      version: "1",
      description:
        "Switch the active report mode and return its bounded context summary. " +
        "Modes: overview, trends, explorer, breakdown, compare. " +
        "compare mode requires a primary key (symbol). " +
        "Never pass account, date, filter, or timezone — the tool operates within the frozen journal scope.",
      access: "read",
      inputSchema: z
        .object({
          mode: z.string(),
          primary: z.string().optional(),
          secondary: z.string().optional(),
        })
        .strict(),
      outputSchema: reportModeOutputSchema,
      execute: async (input: unknown) => {
        // The gateway validated the input against the schema above.
        const args = input as { mode: string; primary?: string; secondary?: string };
        if (options.reportMode !== true) {
          return { status: "completed", value: { ...AI_TOOL_RESULTS.reportModeDisabled } };
        }
        // The report context validates the mode and the keys it is given.
        const result = await reportContext(scope, args.mode as ReportMode, {
          primary: args.primary,
          secondary: args.secondary,
        });
        if ("error" in result) return { status: "completed", value: { ...result } };
        return { status: "completed", value: { ...result, mode: args.mode } };
      },
    },
  ];
}

/**
 * Bind the read-only journal capabilities to one approved scope.
 *
 * The port is the only path the pure runtime has into the journal; the
 * adapter keeps the existing queries and their existing results.
 */
export function createScopedJournalPort(scope: FrozenApprovedScope): JournalCapabilityPort {
  return {
    askContext: async () => await askJournalContext(scope),
    dailyRecap: async (date: string, existingNote: string | undefined) => {
      try {
        return await dailyRecapContext(scope, date, existingNote);
      } catch (error) {
        return {
          error:
            error instanceof Error
              ? error.message
              : "No closed trades match this day and the selected filters",
        };
      }
    },
    tradeCritique: async (key: string) => {
      const scoped = queryTrades(scope.filters, scope.timeZone).trades.find(
        (trade) => trade.key === key,
      );
      if (!scoped) return undefined;
      return (await tradeCritiqueContext(key)) ?? undefined;
    },
    playbookRules: async (key: string) => await playbookRulesForTrade(scope, key),
    missedObservations: async (since: string, until: string | undefined) =>
      await missedObservations(scope, since, until),
    notebookEntries: async (folderId: string | undefined, query: string | undefined) =>
      await notebookEntries(scope, folderId, query),
    progressHistory: async (weeks: number | undefined) => await progressHistory(scope, weeks),
  };
}

/* ---------------------------------------------------------------------------
 * The AI SDK view of the Ask and Reports tools.
 *
 * The provider schema tells the model what an argument looks like; the Zod
 * contract is the authority that decides whether the call is valid. The
 * gateway decides whether the call may run at all.
 * ------------------------------------------------------------------------ */

/** The narrow, deterministic trade-search input. */
export type FindTradesInput = Readonly<{
  symbol?: string;
  outcome?: "win" | "loss" | "breakeven" | "open";
  dateOrder?: "newest" | "oldest";
}>;

/** The sole opaque identifier accepted by the trade-detail tool. */
export type TradeDetailInput = Readonly<{ key: string }>;

/** The report-mode input; the report context validates the mode and the keys. */
export type ReportModeInput = Readonly<{ mode: string; primary?: string; secondary?: string }>;

/** The bounded trade projection the tools return. */
export type TradeSummary = Readonly<{
  key: string;
  symbol: string;
  direction: string;
  outcome: string;
  openedAt: string;
  closedAt?: string;
  quantity: number;
  netPnl: number;
  fees: number;
}>;

/** The bounded fill projection the trade-detail tool returns. */
export type FillSummary = Readonly<{
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
}>;

/** The result a refused call returns. */
export type ToolErrorResult = Readonly<{ error: string }>;

/** The Ask and Reports tool set as the AI SDK sees it. */
export type AskJournalSdkTools = {
  get_journal_summary: ExecutableSdkTool<
    Record<string, never>,
    { context: string } | ToolErrorResult
  >;
  find_trades: ExecutableSdkTool<FindTradesInput, { trades: TradeSummary[] } | ToolErrorResult>;
  get_trade_detail: ExecutableSdkTool<
    TradeDetailInput,
    { trade: TradeSummary; fills: FillSummary[] } | ToolErrorResult
  >;
  switch_report_mode: ExecutableSdkTool<
    ReportModeInput,
    { context: string; mode: string } | ToolErrorResult
  >;
};

/**
 * Expose the registered Ask and Reports tools to the AI SDK.
 *
 * Only the registered tools are exposed, and every call runs through the
 * gateway, so the model can never reach an operation that the execution
 * context does not allow.
 */
export function createAskJournalSdkTools(options: {
  scope: FrozenApprovedScope;
  context: string;
  reportMode: boolean;
  gateway: ToolGateway;
  execution: ExecutionContext;
}): AskJournalSdkTools {
  const shared = {
    gateway: options.gateway,
    context: options.execution,
    onFailure: aiToolFailure,
  };

  return {
    get_journal_summary: createGatewayTool<
      Record<string, never>,
      { context: string } | ToolErrorResult
    >({
      ...shared,
      id: AI_TOOL_IDS.journalSummary,
      description:
        "Return the current aggregate and bucket summary for the selected journal scope.",
      providerSchema: { type: "object", additionalProperties: false, properties: {} },
      inputSchema: z.object({}).strict(),
    }),
    find_trades: createGatewayTool<FindTradesInput, { trades: TradeSummary[] } | ToolErrorResult>({
      ...shared,
      id: AI_TOOL_IDS.findTrades,
      description:
        "Find at most five trade summaries within the current journal scope, narrowed only by symbol, outcome, and chronological order.",
      providerSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          symbol: { type: "string", minLength: 1, maxLength: 64 },
          outcome: { type: "string", enum: ["win", "loss", "breakeven", "open"] },
          dateOrder: { type: "string", enum: ["newest", "oldest"] },
        },
      },
      inputSchema: z
        .object({
          symbol: z.string().min(1).max(64).optional(),
          outcome: z.enum(["win", "loss", "breakeven", "open"]).optional(),
          dateOrder: z.enum(["newest", "oldest"]).optional(),
        })
        .strict(),
    }),
    get_trade_detail: createGatewayTool<
      TradeDetailInput,
      { trade: TradeSummary; fills: FillSummary[] } | ToolErrorResult
    >({
      ...shared,
      id: AI_TOOL_IDS.tradeDetail,
      description:
        "Return one scoped trade and at most fifty of its chronological fills after verifying its key.",
      providerSchema: {
        type: "object",
        additionalProperties: false,
        properties: { key: { type: "string", minLength: 1, maxLength: 300 } },
        required: ["key"],
      },
      inputSchema: z.object({ key: z.string().min(1).max(300) }).strict(),
    }),
    switch_report_mode: createGatewayTool<
      ReportModeInput,
      { context: string; mode: string } | ToolErrorResult
    >({
      ...shared,
      id: AI_TOOL_IDS.reportMode,
      description:
        "Switch the active report mode and return its bounded context summary. " +
        "Modes: overview, trends, explorer, breakdown, compare. " +
        "compare mode requires a primary key (symbol). " +
        "Never pass account, date, filter, or timezone — the tool operates within the frozen journal scope.",
      providerSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: {
            type: "string",
            enum: ["overview", "trends", "explorer", "breakdown", "compare"],
          },
          primary: { type: "string", minLength: 1, maxLength: 64 },
          secondary: { type: "string", minLength: 1, maxLength: 64 },
        },
        required: ["mode"],
      },
      // The report context validates the mode and the keys it is given, so the
      // contract stays permissive here and the report context stays the
      // authority on its own arguments.
      inputSchema: z
        .object({
          mode: z.string(),
          primary: z.string().optional(),
          secondary: z.string().optional(),
        })
        .strict(),
    }),
  };
}
