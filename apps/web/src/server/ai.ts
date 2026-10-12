import type { AnnotatedTrade } from "@luxalgo/journal-core";
import { jsonSchema, tool, type ToolSet } from "ai";
import { AI_PROVIDER_NAMES } from "@/lib/ai-settings";
import { listExecutions } from "./executions";
import { AI_PROMPT_VERSIONS, AiRuntimeError } from "./ai-contracts";
import {
  buildAskJournalPrompt,
  buildReportsAgentPrompt,
  REFLECTION_SYSTEM_PROMPT,
} from "./ai-prompts";
import {
  runAskAgentAi,
  runReportsAgentAi as runReportsAgentAiRuntime,
  runTextAi,
} from "./ai-runtime";
import type { FrozenApprovedScope } from "./ai-scope";
import { getAiKey, getAiProvider, resolveAiConfiguration } from "./settings";
import { queryTrades } from "./trades-query";
import { reportContext, type ReportMode } from "./ai-report-context";

type FindTradesInput = Readonly<{
  symbol?: string;
  outcome?: "win" | "loss" | "breakeven" | "open";
  dateOrder?: "newest" | "oldest";
}>;

type TradeDetailInput = Readonly<{ key: string }>;

type SwitchReportModeInput = Readonly<{
  mode: ReportMode;
  primary?: string;
  secondary?: string;
}>;

const toolLimitError = { error: "AI tool limit reached." } as const;
const invalidToolArguments = { error: "Invalid tool arguments." } as const;
const unavailableTrade = { error: "Trade is not available in this journal scope." } as const;

/** Verify that a tool input is an object with no provider-bypassing fields. */
const hasOnlyKeys = (
  value: unknown,
  allowed: readonly string[],
): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => allowed.includes(key));

/** Validate the intentionally empty summary-tool input. */
const isSummaryInput = (value: unknown): value is Record<string, never> => hasOnlyKeys(value, []);

/** Validate the narrow, deterministic trade-search inputs. */
const isFindTradesInput = (value: unknown): value is FindTradesInput =>
  hasOnlyKeys(value, ["symbol", "outcome", "dateOrder"]) &&
  (value.symbol === undefined ||
    (typeof value.symbol === "string" && value.symbol.length > 0 && value.symbol.length <= 64)) &&
  (value.outcome === undefined ||
    value.outcome === "win" ||
    value.outcome === "loss" ||
    value.outcome === "breakeven" ||
    value.outcome === "open") &&
  (value.dateOrder === undefined || value.dateOrder === "newest" || value.dateOrder === "oldest");

/** Validate the sole opaque identifier accepted by the trade-detail tool. */
const isTradeDetailInput = (value: unknown): value is TradeDetailInput =>
  hasOnlyKeys(value, ["key"]) &&
  typeof value.key === "string" &&
  value.key.length > 0 &&
  value.key.length <= 300;

/** Validate switch_report_mode tool input — mode is required, no scope-widening fields allowed. */
const isSwitchReportModeInput = (value: unknown): value is SwitchReportModeInput =>
  hasOnlyKeys(value, ["mode", "primary", "secondary"]) && typeof value.mode === "string";

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

/**
 * Create the Ask-only read tools over one route-created frozen scope.
 * When feature is "reports", includes the switch_report_mode tool for report-mode queries.
 * Returns no operation capable of widening the account, filter, or timezone.
 */
export function createAskJournalTools(
  scope: FrozenApprovedScope,
  context: string,
  reserveToolCall?: () => boolean,
  feature?: "reports",
) {
  const withinToolBudget = () => reserveToolCall === undefined || reserveToolCall();

  return {
    get_journal_summary: tool({
      description:
        "Return the current aggregate and bucket summary for the selected journal scope.",
      inputSchema: jsonSchema<Record<string, never>>(
        { type: "object", additionalProperties: false, properties: {} },
        {
          validate: (value) =>
            isSummaryInput(value)
              ? { success: true, value }
              : { success: false, error: new Error("Invalid tool arguments.") },
        },
      ),
      execute: (input) => {
        if (!withinToolBudget()) return toolLimitError;
        if (!isSummaryInput(input)) return invalidToolArguments;
        return { context };
      },
    }),
    find_trades: tool({
      description:
        "Find at most five trade summaries within the current journal scope, narrowed only by symbol, outcome, and chronological order.",
      inputSchema: jsonSchema<FindTradesInput>(
        {
          type: "object",
          additionalProperties: false,
          properties: {
            symbol: { type: "string", minLength: 1, maxLength: 64 },
            outcome: { type: "string", enum: ["win", "loss", "breakeven", "open"] },
            dateOrder: { type: "string", enum: ["newest", "oldest"] },
          },
        },
        {
          validate: (value) =>
            isFindTradesInput(value)
              ? { success: true, value }
              : { success: false, error: new Error("Invalid tool arguments.") },
        },
      ),
      execute: (input) => {
        if (!withinToolBudget()) return toolLimitError;
        if (!isFindTradesInput(input)) return invalidToolArguments;
        const direction = input.dateOrder === "oldest" ? 1 : -1;
        const trades = queryTrades(scope.filters, scope.timeZone)
          .trades.filter(
            (trade) =>
              (input.symbol === undefined || trade.symbol === input.symbol) &&
              (input.outcome === undefined || trade.status === input.outcome),
          )
          .sort(
            (left, right) =>
              direction *
              (left.openedAt.localeCompare(right.openedAt) || left.key.localeCompare(right.key)),
          )
          .slice(0, 5)
          .map(summarizeTrade);
        return { trades };
      },
    }),
    get_trade_detail: tool({
      description:
        "Return one scoped trade and at most fifty of its chronological fills after verifying its key.",
      inputSchema: jsonSchema<TradeDetailInput>(
        {
          type: "object",
          additionalProperties: false,
          properties: { key: { type: "string", minLength: 1, maxLength: 300 } },
          required: ["key"],
        },
        {
          validate: (value) =>
            isTradeDetailInput(value)
              ? { success: true, value }
              : { success: false, error: new Error("Invalid tool arguments.") },
        },
      ),
      execute: (input) => {
        if (!withinToolBudget()) return toolLimitError;
        if (!isTradeDetailInput(input)) return invalidToolArguments;
        const trade = queryTrades(scope.filters, scope.timeZone).trades.find(
          (candidate) => candidate.key === input.key,
        );
        if (!trade) return unavailableTrade;
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
        return { trade: summarizeTrade(trade), fills };
      },
    }),
    switch_report_mode: tool({
      description:
        "Switch the active report mode and return its bounded context summary. " +
        "Modes: overview, trends, explorer, breakdown, compare. " +
        "compare mode requires a primary key (symbol). " +
        "Never pass account, date, filter, or timezone — the tool operates within the frozen journal scope.",
      inputSchema: jsonSchema<SwitchReportModeInput>(
        {
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
        {
          validate: (value) =>
            isSwitchReportModeInput(value)
              ? { success: true, value }
              : { success: false, error: new Error("Invalid tool arguments.") },
        },
      ),
      execute: async (input) => {
        if (!withinToolBudget()) return toolLimitError;
        if (!isSwitchReportModeInput(input)) return invalidToolArguments;
        if (feature !== "reports") return { error: "Report mode is not enabled for this request." };
        const result = await reportContext(scope, input.mode, {
          primary: input.primary,
          secondary: input.secondary,
        });
        if ("error" in result) return result;
        return { ...result, mode: input.mode };
      },
    }),
  };
}

/**
 * BYO-key AI. Self-hosted means YOUR key on YOUR box: the key is read from the
 * encrypted settings store (or the selected provider's environment variable).
 * Requests go straight from this server to the selected provider.
 */
export const aiConfigured = (): boolean => getAiKey(getAiProvider()) !== null;

/** Run a direct reflection without tools for recap and trade-critique workflows. */
export const runAi = async (prompt: string): Promise<string> => {
  const configuration = resolveAiConfiguration();
  if (!configuration.apiKey) {
    throw new Error(
      `AI is not configured — add your ${AI_PROVIDER_NAMES[configuration.provider]} API key in Settings.`,
    );
  }
  try {
    const result = await runTextAi({
      feature: "reflection",
      configuration: {
        provider: configuration.provider,
        modelId: configuration.modelId,
        apiKey: configuration.apiKey,
      },
      promptVersion: AI_PROMPT_VERSIONS.reflection,
      system: REFLECTION_SYSTEM_PROMPT,
      prompt,
    });
    if (!result.output.trim())
      throw new Error("AI returned no text. Check the model or try again.");
    return result.output;
  } catch (error) {
    if (error instanceof AiRuntimeError) throw new Error(error.message);
    throw error;
  }
};

/** Run the single bounded Ask Journal tool loop over a route-created frozen scope. */
export const runAskJournalAi = async (scope: FrozenApprovedScope, context: string) => {
  const configuration = resolveAiConfiguration();
  if (!configuration.apiKey) {
    throw new Error(
      `AI is not configured — add your ${AI_PROVIDER_NAMES[configuration.provider]} API key in Settings.`,
    );
  }
  try {
    const result = await runAskAgentAi({
      feature: "askJournalAgent",
      configuration: {
        provider: configuration.provider,
        modelId: configuration.modelId,
        apiKey: configuration.apiKey,
      },
      promptVersion: AI_PROMPT_VERSIONS.askJournalAgent,
      system: REFLECTION_SYSTEM_PROMPT,
      prompt: buildAskJournalPrompt({ question: scope.question, context }),
      createTools: (reserveToolCall) =>
        createAskJournalTools(scope, context, reserveToolCall) as unknown as ToolSet,
    });
    return result.output;
  } catch (error) {
    if (error instanceof AiRuntimeError) throw new Error(error.message);
    throw error;
  }
};

/** Run the Reports agent: bounded tool loop with switch_report_mode available. */
export const runReportsAgentAi = async (scope: FrozenApprovedScope, context: string) => {
  const configuration = resolveAiConfiguration();
  if (!configuration.apiKey) {
    throw new Error(
      `AI is not configured — add your ${AI_PROVIDER_NAMES[configuration.provider]} API key in Settings.`,
    );
  }
  try {
    const result = await runReportsAgentAiRuntime({
      feature: "reportsAgent",
      configuration: {
        provider: configuration.provider,
        modelId: configuration.modelId,
        apiKey: configuration.apiKey,
      },
      promptVersion: AI_PROMPT_VERSIONS.reportsAgent,
      system: REFLECTION_SYSTEM_PROMPT,
      prompt: buildReportsAgentPrompt({ question: scope.question, context }),
      createTools: (reserveToolCall) =>
        createAskJournalTools(scope, context, reserveToolCall, "reports") as unknown as ToolSet,
    });
    return result.output;
  } catch (error) {
    if (error instanceof AiRuntimeError) throw new Error(error.message);
    throw error;
  }
};
