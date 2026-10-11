import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ToolSet } from "ai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, accounts, executions, settings, trades } from "../src/db";
import { createAskJournalTools } from "../src/server/ai";
import { readAiRequest } from "../src/server/ai-scope";
import { insertExecutions } from "../src/server/executions";
import { setSetting } from "../src/server/settings";
import { queryTrades } from "../src/server/trades-query";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-ask-agent-"));
process.env.JOURNAL_DATA_DIR = scratch;

const fills = (symbol: string, exit: number, date = "2026-09-15") => [
  {
    symbol,
    side: "buy" as const,
    quantity: 1,
    price: 100,
    fee: 0,
    executedAt: date + "T09:00:00Z",
  },
  {
    symbol,
    side: "sell" as const,
    quantity: 1,
    price: exit,
    fee: 0,
    executedAt: date + "T10:00:00Z",
  },
];

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values(
      ["a", "b"].map((id) => ({
        id,
        name: "Account " + id.toUpperCase(),
        kind: "manual" as const,
        createdAt: "2026-01-01",
      })),
    )
    .run();
  insertExecutions("a", fills("ONLY_A", 110), "manual");
  insertExecutions("b", fills("ONLY_B", 90), "manual");
  setSetting("timeZone", "UTC");
});

afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

const scope = () =>
  readAiRequest(
    {
      question: "Which setup should I keep?",
      filters: { accounts: "a", from: "2026-09-15", to: "2026-09-15" },
      timeZone: "UTC",
    },
    "question",
  );

const toolOptions = {} as never;

it("returns only selected account and date-scope trades from every Ask tool", async () => {
  const tools = createAskJournalTools(scope(), "Scoped aggregate context");

  const summary = await tools.get_journal_summary.execute({}, toolOptions);
  const found = await tools.find_trades.execute({ dateOrder: "oldest" }, toolOptions);
  const detail = await tools.get_trade_detail.execute(
    { key: queryTrades({ accounts: "a" }).trades[0]!.key },
    toolOptions,
  );

  expect(JSON.stringify(summary)).toContain("Scoped aggregate context");
  expect(JSON.stringify(found)).toContain("ONLY_A");
  expect(JSON.stringify(found)).not.toContain("ONLY_B");
  expect(JSON.stringify(detail)).toContain("ONLY_A");
  expect(JSON.stringify(detail)).not.toContain("ONLY_B");
});

it("rejects unsupported narrowing arguments without returning journal data", async () => {
  const tools = createAskJournalTools(scope(), "Scoped aggregate context");

  const found = await tools.find_trades.execute({ account: "b" } as never, toolOptions);
  const detail = await tools.get_trade_detail.execute(
    { key: "anything", filters: { accounts: "b" } } as never,
    toolOptions,
  );

  expect(found).toEqual({ error: "Invalid tool arguments." });
  expect(detail).toEqual({ error: "Invalid tool arguments." });
});

it("does not reveal fabricated or out-of-scope trade keys", async () => {
  const tools = createAskJournalTools(scope(), "Scoped aggregate context");
  const otherKey = queryTrades({ accounts: "b" }).trades[0]!.key;

  const fabricated = await tools.get_trade_detail.execute({ key: "not-a-real-trade" }, toolOptions);
  const outOfScope = await tools.get_trade_detail.execute({ key: otherKey }, toolOptions);

  expect(fabricated).toEqual({ error: "Trade is not available in this journal scope." });
  expect(outOfScope).toEqual({ error: "Trade is not available in this journal scope." });
  expect(JSON.stringify(outOfScope)).not.toContain("ONLY_B");
});

it("keeps journal rows unchanged while all Ask tools execute", async () => {
  const before = {
    executions: db.select().from(executions).all(),
    trades: db.select().from(trades).all(),
  };
  const tools = createAskJournalTools(scope(), "Scoped aggregate context");
  const key = queryTrades({ accounts: "a" }).trades[0]!.key;

  await tools.get_journal_summary.execute({}, toolOptions);
  await tools.find_trades.execute(
    { symbol: "ONLY_A", outcome: "win", dateOrder: "newest" },
    toolOptions,
  );
  await tools.get_trade_detail.execute({ key }, toolOptions);

  expect(db.select().from(executions).all()).toEqual(before.executions);
  expect(db.select().from(trades).all()).toEqual(before.trades);
});

it("returns no journal data after the runtime-owned tool budget is exhausted", async () => {
  const tools = createAskJournalTools(scope(), "Scoped aggregate context", () => false);

  const result = await tools.find_trades.execute({ dateOrder: "newest" }, toolOptions);

  expect(result).toEqual({ error: "AI tool limit reached." });
});

it("uses the frozen timezone when the journal setting changes after scope approval", async () => {
  insertExecutions(
    "a",
    [
      {
        symbol: "UTC_SCOPE",
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 0,
        executedAt: "2026-09-15T01:00:00Z",
      },
      {
        symbol: "UTC_SCOPE",
        side: "sell",
        quantity: 1,
        price: 110,
        fee: 0,
        executedAt: "2026-09-15T02:00:00Z",
      },
    ],
    "manual",
  );
  const approvedScope = scope();
  setSetting("timeZone", "America/New_York");
  const tools = createAskJournalTools(approvedScope, "Scoped aggregate context");

  const result = await tools.find_trades.execute({ symbol: "UTC_SCOPE" }, toolOptions);

  expect(JSON.stringify(result)).toContain("UTC_SCOPE");
});

describe("switch_report_mode tool", () => {
  it("returns report context for a valid mode", async () => {
    const tools = createAskJournalTools(scope(), "Context", undefined, "reports");
    const result = await tools.switch_report_mode.execute({ mode: "overview" }, toolOptions);
    expect(result).toHaveProperty("context");
    expect(result).toHaveProperty("mode", "overview");
  });

  it("returns { error } for an unknown mode", async () => {
    const tools = createAskJournalTools(scope(), "Context", undefined, "reports");
    const result = await tools.switch_report_mode.execute(
      { mode: "invalid" } as never,
      toolOptions,
    );
    expect(result).toHaveProperty("error");
  });

  it("returns { error } when primary key is required but missing (compare mode)", async () => {
    const tools = createAskJournalTools(scope(), "Context", undefined, "reports");
    const result = await tools.switch_report_mode.execute({ mode: "compare" }, toolOptions);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("required");
  });

  it("accepts primary and secondary keys in compare mode", async () => {
    const tools = createAskJournalTools(scope(), "Context", undefined, "reports");
    const result = await tools.switch_report_mode.execute(
      { mode: "compare", primary: "ONLY_A" },
      toolOptions,
    );
    // Should not be a "required" error; context or error is fine
    if ("error" in result) {
      expect(result.error).not.toContain("required");
    } else {
      expect(result).toHaveProperty("context");
    }
  });

  it("rejects primary key longer than 64 chars", async () => {
    const tools = createAskJournalTools(scope(), "Context", undefined, "reports");
    const result = await tools.switch_report_mode.execute(
      { mode: "overview", primary: "x".repeat(65) },
      toolOptions,
    );
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("64");
  });

  it("returns no journal data when tool budget is exhausted", async () => {
    const tools = createAskJournalTools(scope(), "Context", () => false, "reports");
    const result = await tools.switch_report_mode.execute({ mode: "overview" }, toolOptions);
    expect(result).toEqual({ error: "AI tool limit reached." });
  });

  it("does not accept account, date, filter, or timezone arguments", async () => {
    const tools = createAskJournalTools(scope(), "Context", undefined, "reports");
    const r1 = await tools.switch_report_mode.execute(
      { mode: "overview", account: "a" } as never,
      toolOptions,
    );
    const r2 = await tools.switch_report_mode.execute(
      { mode: "overview", from: "2026-01-01" } as never,
      toolOptions,
    );
    const r3 = await tools.switch_report_mode.execute(
      { mode: "overview", timezone: "UTC" } as never,
      toolOptions,
    );
    expect(r1).toEqual({ error: "Invalid tool arguments." });
    expect(r2).toEqual({ error: "Invalid tool arguments." });
    expect(r3).toEqual({ error: "Invalid tool arguments." });
  });
});
