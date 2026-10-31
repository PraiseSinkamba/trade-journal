import type { AiProvider } from "@/lib/ai-settings";
import { TOOL_FAILURE } from "./intelligence/contracts/tools";

export type AiFeature = "reflection" | "askJournalAgent" | "reportsAgent" | "statementImport";

export type AiExecutionPolicy = Readonly<{
  maxOutputTokens: number;
  maxRetries: number;
  timeoutMs?: number;
  maxSteps?: number;
  maxToolCalls?: number;
}>;

export type AiExecutionMeta = Readonly<{
  feature: AiFeature;
  provider: AiProvider;
  modelId: string;
  promptVersion: string;
  durationMs: number;
  finishReason: string | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  maxRetries: number;
  stepCount: number | undefined;
  toolCallCount: number | undefined;
}>;

export class AiRuntimeError extends Error {
  constructor(
    public readonly kind:
      | "missing_key"
      | "authentication"
      | "billing"
      | "rate_limited"
      | "model_unavailable"
      | "timeout"
      | "provider",
    message: string,
  ) {
    super(message);
  }
}

export const AI_FEATURE_POLICIES: Readonly<Record<AiFeature, AiExecutionPolicy>> = {
  reflection: { maxOutputTokens: 1200, maxRetries: 2 },
  askJournalAgent: {
    maxOutputTokens: 1200,
    maxRetries: 2,
    timeoutMs: 30_000,
    maxSteps: 4,
    maxToolCalls: 4,
  },
  reportsAgent: {
    maxOutputTokens: 1200,
    maxRetries: 2,
    timeoutMs: 30_000,
    maxSteps: 4,
    maxToolCalls: 4,
  },
  statementImport: { maxOutputTokens: 32_000, maxRetries: 0, timeoutMs: 120_000 },
};

export const AI_PROMPT_VERSIONS: Readonly<Record<AiFeature, string>> = {
  reflection: "reflection-v1",
  askJournalAgent: "ask-journal-agent-v1",
  reportsAgent: "reports-agent-v1",
  statementImport: "statement-import-v1",
};

/** The registered AI tool identifiers. */
export const AI_TOOL_IDS = {
  journalSummary: "get_journal_summary",
  findTrades: "find_trades",
  tradeDetail: "get_trade_detail",
  reportMode: "switch_report_mode",
} as const;

/** The tools each AI feature may use. */
export const AI_FEATURE_TOOL_IDS: Readonly<Record<AiFeature, readonly string[]>> = {
  reflection: [],
  // The legacy tool set exposed the report-mode tool to the Ask agent too;
  // the tool refuses itself when the feature is not the reports agent.
  askJournalAgent: [
    AI_TOOL_IDS.journalSummary,
    AI_TOOL_IDS.findTrades,
    AI_TOOL_IDS.tradeDetail,
    AI_TOOL_IDS.reportMode,
  ],
  reportsAgent: [
    AI_TOOL_IDS.journalSummary,
    AI_TOOL_IDS.findTrades,
    AI_TOOL_IDS.tradeDetail,
    AI_TOOL_IDS.reportMode,
  ],
  statementImport: [],
};

/** The results the model sees when a tool call is refused. */
export const AI_TOOL_RESULTS: Readonly<{
  invalidArguments: { error: string };
  toolLimitReached: { error: string };
  tradeUnavailable: { error: string };
  reportModeDisabled: { error: string };
  invalidResult: { error: string };
  cancelled: { error: string };
}> = {
  invalidArguments: { error: "Invalid tool arguments." },
  toolLimitReached: { error: "AI tool limit reached." },
  tradeUnavailable: { error: "Trade is not available in this journal scope." },
  reportModeDisabled: { error: "Report mode is not enabled for this request." },
  invalidResult: { error: "The journal tool returned an invalid result." },
  cancelled: { error: "The journal tool call was cancelled." },
};

/** Map a gateway refusal onto the result the model sees. */
export const aiToolFailure = (reason: string): { error: string } => {
  if (reason === TOOL_FAILURE.toolBudgetExhausted) return AI_TOOL_RESULTS.toolLimitReached;
  if (reason === TOOL_FAILURE.cancelled) return AI_TOOL_RESULTS.cancelled;
  if (reason === TOOL_FAILURE.invalidOutput) return AI_TOOL_RESULTS.invalidResult;
  return AI_TOOL_RESULTS.invalidArguments;
};
