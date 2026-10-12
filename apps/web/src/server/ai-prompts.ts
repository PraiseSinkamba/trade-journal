/**
 * Reflection prompt construction. Builders receive typed route-derived data only;
 * they do not query the database, read settings, or widen scope. Provider selection,
 * key handling, policy application, and execution live in the AI runtime.
 */

export interface AskJournalPromptInput {
  question: string;
  context: string;
}

export interface ReportsAgentPromptInput {
  question: string;
  context: string;
}

export interface DailyRecapPromptInput {
  date: string;
  scopeContext: string;
  accountContext: string;
  metricsLine: string;
  tradeLines: string;
  existingNote: string | undefined;
}

export interface TradeCritiquePromptInput {
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
}

export const REFLECTION_SYSTEM_PROMPT = `You are the reflection layer of a trader's journal.
You see only the trader's own recorded data — trades, stats, and notes. Ground every
statement in those numbers; never invent trades, prices, or market context you weren't given.
Be direct and specific like a good trading coach: name the behavior, cite the numbers,
say what to keep and what to fix. No platitudes, no disclaimers about trading being risky —
the trader knows. Keep it tight.`;

/**
 * Build the initial Ask-agent prompt. The aggregate is visible immediately;
 * the model may request the bounded read-only tools for specific trade context.
 */
export const buildAskJournalPrompt = (input: AskJournalPromptInput): string =>
  `Answer the trader's question using ONLY this aggregate journal context and any data returned by the read-only journal tools. If the data
can't answer it, say exactly what's missing (e.g. "tag your trades' stops to get R stats").
Cite the numbers you used. Under 200 words. Do not infer results for excluded accounts or dates.

Initial aggregate context:
${input.context}

Question: ${input.question}`;

export const buildDailyRecapPrompt = (input: DailyRecapPromptInput): string =>
  `Write a session recap for ${input.date} in first person ("I"), 120-200 words, markdown with a
short "**Keep**" and "**Fix**" list at the end.

${input.scopeContext}
${input.accountContext}

Day stats: ${input.metricsLine}

Trades:
${input.tradeLines}${
    input.existingNote
      ? `

The trader's own note so far (respect it, build on it):
${input.existingNote}`
      : ""
  }`;

export const buildTradeCritiquePrompt = (input: TradeCritiquePromptInput): string =>
  `Critique this single trade in under 150 words. Focus on execution quality visible in the
fills (entry clustering, scaling, exit discipline), risk (stop honored or not, R multiple),
and the trader's own tags/mistakes. End with one concrete instruction for the next
occurrence of this setup.

Trade: ${input.trade.symbol} ${input.trade.direction}, status ${input.trade.status}
Net P&L: ${input.trade.netPnl.toFixed(2)} (gross ${input.trade.grossPnl.toFixed(2)}, fees ${input.trade.fees.toFixed(2)})
Avg entry ${input.trade.avgEntry} → avg exit ${input.trade.avgExit ?? "still open"}
Planned stop: ${input.trade.stopLoss ?? "none recorded"} | target: ${input.trade.profitTarget ?? "none recorded"}
Rating: ${input.trade.rating ?? "unrated"} | tags: ${input.trade.tags.join(", ") || "none"} | mistakes: ${input.trade.mistakes.join(", ") || "none"}
Notes: ${input.trade.notes ?? "none"}

Fills:
${input.fills.join("\n")}`;

/**
 * Build the Reports agent prompt. The model sees the aggregate context and can
 * call switch_report_mode to drill into specific report modes before answering.
 */
export const buildReportsAgentPrompt = (input: ReportsAgentPromptInput): string =>
  `Answer the trader's analytical question using the journal aggregate context and the switch_report_mode tool.
Call switch_report_mode to get the relevant report-mode data before answering.
If the data can't answer the question, say exactly what's missing.
Cite the numbers you used. Under 200 words. Do not infer results for excluded accounts or dates.

Initial aggregate context:
${input.context}

Question: ${input.question}`;
