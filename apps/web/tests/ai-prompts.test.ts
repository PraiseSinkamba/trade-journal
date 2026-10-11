import { describe, expect, it } from "vitest";
import {
  REFLECTION_SYSTEM_PROMPT,
  buildAskJournalPrompt,
  buildDailyRecapPrompt,
  buildTradeCritiquePrompt,
  type AskJournalPromptInput,
  type DailyRecapPromptInput,
  type TradeCritiquePromptInput,
} from "../src/server/ai-prompts";

describe("REFLECTION_SYSTEM_PROMPT", () => {
  it("matches the verbatim system instruction moved from ai.ts", () => {
    expect(REFLECTION_SYSTEM_PROMPT).toBe(`You are the reflection layer of a trader's journal.
You see only the trader's own recorded data — trades, stats, and notes. Ground every
statement in those numbers; never invent trades, prices, or market context you weren't given.
Be direct and specific like a good trading coach: name the behavior, cite the numbers,
say what to keep and what to fix. No platitudes, no disclaimers about trading being risky —
the trader knows. Keep it tight.`);
  });
});

describe("buildAskJournalPrompt", () => {
  it("gives the Ask agent initial aggregates and read-only tool guidance", () => {
    const input: AskJournalPromptInput = {
      question: "What is my edge?",
      context: "FIXTURE_CONTEXT_BLOCK",
    };
    expect(buildAskJournalPrompt(input))
      .toBe(`Answer the trader's question using ONLY this aggregate journal context and any data returned by the read-only journal tools. If the data
can't answer it, say exactly what's missing (e.g. "tag your trades' stops to get R stats").
Cite the numbers you used. Under 200 words. Do not infer results for excluded accounts or dates.

Initial aggregate context:
FIXTURE_CONTEXT_BLOCK

Question: What is my edge?`);
  });
});

describe("buildDailyRecapPrompt", () => {
  it("matches the verbatim recap template with notes", () => {
    const input: DailyRecapPromptInput = {
      date: "2026-09-15",
      scopeContext: "FIXTURE_SCOPE_CONTEXT",
      accountContext: "FIXTURE_ACCOUNT_CONTEXT",
      tradeLines: "FIXTURE_TRADE_LINE_1\nFIXTURE_TRADE_LINE_2",
      metricsLine: "FIXTURE_METRICS_LINE",
      existingNote: "FIXTURE_NOTE",
    };
    expect(buildDailyRecapPrompt(input))
      .toBe(`Write a session recap for 2026-09-15 in first person ("I"), 120-200 words, markdown with a
short "**Keep**" and "**Fix**" list at the end.

FIXTURE_SCOPE_CONTEXT
FIXTURE_ACCOUNT_CONTEXT

Day stats: FIXTURE_METRICS_LINE

Trades:
FIXTURE_TRADE_LINE_1
FIXTURE_TRADE_LINE_2

The trader's own note so far (respect it, build on it):
FIXTURE_NOTE`);
  });

  it("matches the verbatim recap template without notes", () => {
    const input: DailyRecapPromptInput = {
      date: "2026-09-15",
      scopeContext: "FIXTURE_SCOPE_CONTEXT",
      accountContext: "FIXTURE_ACCOUNT_CONTEXT",
      tradeLines: "FIXTURE_TRADE_LINE_1\nFIXTURE_TRADE_LINE_2",
      metricsLine: "FIXTURE_METRICS_LINE",
      existingNote: undefined,
    };
    expect(buildDailyRecapPrompt(input))
      .toBe(`Write a session recap for 2026-09-15 in first person ("I"), 120-200 words, markdown with a
short "**Keep**" and "**Fix**" list at the end.

FIXTURE_SCOPE_CONTEXT
FIXTURE_ACCOUNT_CONTEXT

Day stats: FIXTURE_METRICS_LINE

Trades:
FIXTURE_TRADE_LINE_1
FIXTURE_TRADE_LINE_2`);
  });
});

describe("buildTradeCritiquePrompt", () => {
  it("matches the verbatim critique template", () => {
    const input: TradeCritiquePromptInput = {
      trade: {
        symbol: "AAPL",
        direction: "long",
        status: "closed",
        netPnl: 12.5,
        grossPnl: 14.0,
        fees: 1.5,
        avgEntry: 100,
        avgExit: 112,
        stopLoss: 95,
        profitTarget: 120,
        rating: 4,
        tags: ["setup"],
        mistakes: ["early"],
        notes: "Looked clean",
      },
      fills: ["2026-09-15T09:00:00Z buy 1 @ 100", "2026-09-15T10:00:00Z sell 1 @ 112"],
    };
    expect(buildTradeCritiquePrompt(input))
      .toBe(`Critique this single trade in under 150 words. Focus on execution quality visible in the
fills (entry clustering, scaling, exit discipline), risk (stop honored or not, R multiple),
and the trader's own tags/mistakes. End with one concrete instruction for the next
occurrence of this setup.

Trade: AAPL long, status closed
Net P&L: 12.50 (gross 14.00, fees 1.50)
Avg entry 100 → avg exit 112
Planned stop: 95 | target: 120
Rating: 4 | tags: setup | mistakes: early
Notes: Looked clean

Fills:
2026-09-15T09:00:00Z buy 1 @ 100
2026-09-15T10:00:00Z sell 1 @ 112`);
  });
});
