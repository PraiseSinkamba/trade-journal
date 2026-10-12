import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { FILTER_KEYS } from "@luxalgo/journal-core";
import { db, accounts, executions, trades, settings, journalDays } from "../src/db";
import { insertExecutions } from "../src/server/executions";
import { setSetting } from "../src/server/settings";
import { queryTrades } from "../src/server/trades-query";
import { runAi, runAskJournalAi } from "../src/server/ai";
import { POST as ask } from "../src/app/api/ai/ask/route";
import { POST as recap } from "../src/app/api/ai/recap/route";
import { POST as critique } from "../src/app/api/ai/critique/route";
import { GET as day } from "../src/app/api/journal/[date]/route";
import { readAiRequest } from "../src/server/ai-scope";

const { mockAskJournalAi, mockReportsAgentAi, mockRunAi } = vi.hoisted(() => ({
  mockAskJournalAi: vi.fn(async () => "Controlled AI response"),
  mockReportsAgentAi: vi.fn(async () => "Controlled Reports response"),
  mockRunAi: vi.fn(async () => "Controlled AI response"),
}));
vi.mock("@/server/ai", () => ({
  runAi: mockRunAi,
  runAskJournalAi: mockAskJournalAi,
  runReportsAgentAi: mockReportsAgentAi,
}));
const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-ai-scope-"));
process.env.JOURNAL_DATA_DIR = scratch;
const request = (body: unknown) =>
  new Request("http://localhost/api/ai/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
const prompt = () => {
  const directCall = vi.mocked(runAi).mock;
  const agentCall = vi.mocked(runAskJournalAi).mock;
  const directOrder = directCall.invocationCallOrder.at(-1) ?? 0;
  const agentOrder = agentCall.invocationCallOrder.at(-1) ?? 0;
  return directOrder > agentOrder ? directCall.calls.at(-1)![0] : agentCall.calls.at(-1)![1];
};
beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.delete(journalDays).run();
  db.insert(accounts)
    .values(
      ["a", "b", "empty"].map((id) => ({
        id,
        name: "Account " + id.toUpperCase(),
        kind: "manual" as const,
        createdAt: "2026-01-01",
      })),
    )
    .run();
  insertExecutions("a", fills("ONLY_A", 110), "manual");
  insertExecutions("b", fills("ONLY_B", 50), "manual");
  setSetting("timeZone", "UTC");
  vi.mocked(runAi).mockClear();
  vi.mocked(runAskJournalAi).mockClear();
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

it.each([
  ["ask", ask, { question: "How did I do?" }],
  ["recap", recap, { date: "2026-09-15" }],
] as const)("%s sends only the selected account's data to the provider", async (_, route, body) => {
  const response = await route(request({ ...body, filters: { accounts: "a" }, timeZone: "UTC" }));
  expect(response.status).toBe(200);
  expect(prompt()).toContain("ONLY_A");
  expect(prompt()).toContain("10.00");
  expect(prompt()).not.toContain("ONLY_B");
  expect(prompt()).not.toContain("-40.00");
  expect((await response.json()).scope.label).toContain("Account A");
});

it("runs exactly one Ask agent execution and preserves the Ask response shape", async () => {
  const response = await ask(
    request({ question: "How did I do?", filters: { accounts: "a" }, timeZone: "UTC" }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    answer: "Controlled AI response",
    scope: expect.objectContaining({ timeZone: "UTC" }),
  });
  expect(runAskJournalAi).toHaveBeenCalledTimes(1);
  expect(runAi).not.toHaveBeenCalled();
});

it.each(["ask", "recap"])(
  "%s respects single, multiple and all accounts with named totals",
  async (name) => {
    const route = name === "ask" ? ask : recap;
    for (const filters of [{ accounts: "b" }, { accounts: " a, b,a " }, {}]) {
      const response = await route(
        request({
          question: "Compare accounts",
          ...(name === "recap" ? { question: undefined, date: "2026-09-15" } : {}),
          filters,
        }),
      );
      expect(response.status).toBe(200);
      expect(prompt()).toContain('"Account B" (USD): 1 closed trades, net -50.00');
      if ("accounts" in filters && filters.accounts === "b")
        expect(prompt()).not.toContain("ONLY_A");
      else {
        expect(prompt()).toContain('"Account A" (USD): 1 closed trades, net 10.00');
        expect(prompt()).toContain("-40.00");
      }
    }
  },
);

it.each([
  undefined,
  null,
  [],
  "a",
  { accounts: "" },
  { accounts: "  " },
  { accounts: [] },
  { accounts: "a," },
  { accounts: "a,missing" },
  { accounts: "missing" },
  { accountIds: ["a"] },
  { accounts: "a", extra: "ignored" },
  { direction: "sideways" },
  { reviewed: "false" },
  { status: "unknown" },
  { from: "2026-02-30" },
  { from: "2026-09-16", to: "2026-09-15" },
  { entryAfter: "25:00" },
  { weekdays: "7" },
  { pnlMin: "NaN" },
  { quantityMax: "Infinity" },
  { ratingMin: "5", ratingMax: "1" },
])("rejects malformed filter snapshots before any AI call: %j", async (filters) => {
  for (const [route, body] of [
    [ask, { question: "How did I do?" }],
    [recap, { date: "2026-09-15" }],
  ] as const) {
    expect((await route(request({ ...body, filters }))).status).toBe(400);
  }
  expect(runAi).not.toHaveBeenCalled();
});

it("does not widen an empty account or empty filter result", async () => {
  for (const filters of [
    { accounts: "empty" },
    { symbol: "NOT_PRESENT" },
    { accounts: "a", status: "loss" },
  ]) {
    expect((await ask(request({ question: "Any trades?", filters }))).status).toBe(400);
    expect((await recap(request({ date: "2026-09-15", filters }))).status).toBe(400);
  }
  expect(runAi).not.toHaveBeenCalled();
});

it("applies every supported journal filter using the same predicate as the visible day", async () => {
  db.update(trades)
    .set({
      tagsJson: '["setup"]',
      mistakesJson: '["early"]',
      rating: 4,
      reviewedAt: "2026-09-15",
      stopLoss: 90,
      profitTarget: 120,
      assetClass: "equity",
      playbookId: "strategy-a",
    })
    .where(eq(trades.accountId, "a"))
    .run();
  const examples: Record<(typeof FILTER_KEYS)[number], string> = {
    accounts: "a",
    from: "2026-09-15",
    to: "2026-09-15",
    symbol: "ONLY_A",
    excludeSymbol: "ONLY_B",
    tag: "setup",
    mistake: "early",
    playbookId: "strategy-a",
    direction: "long",
    status: "win",
    assetClass: "equity",
    reviewed: "yes",
    ratingMin: "4",
    ratingMax: "4",
    quantityMin: "1",
    quantityMax: "1",
    entryMin: "100",
    entryMax: "100",
    exitMin: "110",
    exitMax: "110",
    durationMin: "60",
    durationMax: "60",
    rMin: "1",
    rMax: "1",
    plannedRMin: "2",
    plannedRMax: "2",
    pnlMin: "10",
    pnlMax: "10",
    weekdays: "2",
    entryAfter: "09:00",
    entryBefore: "09:00",
    exitAfter: "10:00",
    exitBefore: "10:00",
  };
  for (const key of FILTER_KEYS) {
    const filters = { [key]: examples[key] };
    const selected = queryTrades(filters).trades;
    const expectedSymbols = selected.map((t) => t.symbol);
    const visible = await day(
      new Request("http://localhost/api/journal/2026-09-15?" + new URLSearchParams(filters)),
      { params: Promise.resolve({ date: "2026-09-15" }) },
    );
    expect(
      (await visible.json()).trades.map((t: { symbol: string }) => t.symbol),
      key,
    ).toEqual(expectedSymbols);
    for (const [route, body] of [
      [ask, { question: "How did I do?" }],
      [recap, { date: "2026-09-15" }],
    ] as const) {
      const response = await route(request({ ...body, filters }));
      expect(response.status, key).toBe(200);
      for (const symbol of ["ONLY_A", "ONLY_B"]) {
        // Exclusion labels may mention the symbol, so inspect data after the scope header.
        const data = prompt().split("By account")[1]!;
        expect(data.includes(symbol), key + ": " + symbol).toBe(expectedSymbols.includes(symbol));
      }
    }
  }
});

it("uses the journal timezone at midnight and keeps date filters in recaps", async () => {
  setSetting("timeZone", "America/New_York");
  insertExecutions(
    "a",
    [
      {
        symbol: "LATE_LOCAL",
        side: "buy",
        quantity: 1,
        price: 10,
        fee: 0,
        executedAt: "2026-09-16T02:00:00Z",
      },
      {
        symbol: "LATE_LOCAL",
        side: "sell",
        quantity: 1,
        price: 12,
        fee: 0,
        executedAt: "2026-09-16T03:59:00Z",
      },
      {
        symbol: "NEXT_LOCAL",
        side: "buy",
        quantity: 1,
        price: 10,
        fee: 0,
        executedAt: "2026-09-16T04:00:00Z",
      },
      {
        symbol: "NEXT_LOCAL",
        side: "sell",
        quantity: 1,
        price: 12,
        fee: 0,
        executedAt: "2026-09-16T04:01:00Z",
      },
    ],
    "manual",
  );
  const filters = {
    accounts: "a",
    from: "2026-09-15",
    to: "2026-09-15",
    exitAfter: "23:00",
    exitBefore: "01:00",
  };
  for (const [route, body] of [
    [ask, { question: "How did I do?" }],
    [recap, { date: "2026-09-15" }],
  ] as const) {
    expect((await route(request({ ...body, filters, timeZone: "America/New_York" }))).status).toBe(
      200,
    );
    expect(prompt()).toContain("LATE_LOCAL");
    expect(prompt()).not.toContain("NEXT_LOCAL");
    expect(prompt()).not.toContain("ONLY_A");
  }
  vi.mocked(runAi).mockClear();
  expect((await recap(request({ date: "2026-09-16", filters }))).status).toBe(400);
  expect((await ask(request({ question: "How?", filters, timeZone: "UTC" }))).status).toBe(400);
  expect(runAi).not.toHaveBeenCalled();
});

it("excludes shared notes from any trade subset, and leaves saved notes untouched", async () => {
  const note = "PRIVATE_OTHER_ACCOUNT_NOTE";
  db.insert(journalDays).values({ date: "2026-09-15", note, updatedAt: "2026-09-15" }).run();
  for (const filters of [{ accounts: "a" }, { symbol: "ONLY_A" }, { status: "win" }]) {
    await recap(request({ date: "2026-09-15", filters }));
    expect(prompt()).not.toContain(note);
  }
  await recap(request({ date: "2026-09-15", filters: { from: "2026-09-15", to: "2026-09-15" } }));
  expect(prompt()).toContain(note);
  expect(db.select().from(journalDays).get()?.note).toBe(note);
});

it("rejects invalid request bodies, dates and legacy account fields instead of silently ignoring them", async () => {
  for (const body of [
    null,
    [],
    42,
    { question: 1, filters: {} },
    { question: " ", filters: {} },
    { question: "How?", filters: {}, accountIds: ["a"] },
  ])
    expect((await ask(request(body))).status).toBe(400);
  for (const date of ["2026-02-30", "no", 42])
    expect((await recap(request({ date, filters: {} }))).status).toBe(400);
  expect(runAi).not.toHaveBeenCalled();
});

it("keeps single-trade critique scoped to its key", async () => {
  expect(
    (await critique(request({ key: queryTrades({ accounts: "a" }).trades[0]!.key }))).status,
  ).toBe(200);
  expect(prompt()).toContain("ONLY_A");
  expect(prompt()).not.toContain("ONLY_B");
});

// --- dataSource extension ---

it("rejects unknown dataSource values", async () => {
  for (const ds of ["trades+unknown", "TRADES", "playbooks", 1, null]) {
    const response = await ask(
      request({ question: "How did I do?", filters: {}, dataSource: ds, timeZone: "UTC" }),
    );
    expect(response.status, `dataSource=${JSON.stringify(ds)}`).toBe(400);
  }
  expect(runAi).not.toHaveBeenCalled();
});

it("rejects tradeCritiqueKey without trades+playbooks dataSource", async () => {
  const response = await ask(
    request({
      question: "How did I do?",
      filters: {},
      dataSource: "trades",
      tradeCritiqueKey: "some-key",
      timeZone: "UTC",
    }),
  );
  expect(response.status).toBe(400);
  expect(runAi).not.toHaveBeenCalled();
});

it("readAiRequest accepts valid dataSource and passes it through deep-frozen", async () => {
  for (const ds of [
    "trades",
    "trades+playbooks",
    "trades+missed",
    "trades+notes",
    "trades+progress",
  ] as const) {
    const scope = readAiRequest(
      { question: "How?", filters: {}, dataSource: ds, timeZone: "UTC" },
      "question",
    );
    expect(scope.dataSource).toBe(ds);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.filters)).toBe(true);
  }
});

it("readAiRequest defaults dataSource to trades when absent", async () => {
  const scope = readAiRequest({ question: "How?", filters: {}, timeZone: "UTC" }, "question");
  expect(scope.dataSource).toBe("trades");
});

it("readAiRequest accepts tradeCritiqueKey only when dataSource is trades+playbooks", async () => {
  // Invalid: tradeCritiqueKey with trades
  expect(() =>
    readAiRequest(
      { question: "How?", filters: {}, dataSource: "trades", tradeCritiqueKey: "k" },
      "question",
    ),
  ).toThrow();
  // Valid: tradeCritiqueKey with trades+playbooks
  const scope = readAiRequest(
    { question: "How?", filters: {}, dataSource: "trades+playbooks", tradeCritiqueKey: "k" },
    "question",
  );
  expect(scope.tradeCritiqueKey).toBe("k");
  expect(Object.isFrozen(scope)).toBe(true);
});
