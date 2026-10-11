import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, accounts, executions, trades, settings } from "../src/db";
import { insertExecutions } from "../src/server/executions";
import { setSetting } from "../src/server/settings";

import { POST as ask } from "../src/app/api/ai/ask/route";
import { POST as reports } from "../src/app/api/ai/reports/route";

const { mockReportsAgentAi, mockAskJournalAi } = vi.hoisted(() => ({
  mockReportsAgentAi: vi.fn(async () => "Reports AI response"),
  mockAskJournalAi: vi.fn(async () => "Ask AI response"),
}));
vi.mock("@/server/ai", () => ({
  runReportsAgentAi: mockReportsAgentAi,
  runAskJournalAi: mockAskJournalAi,
}));

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-reports-route-"));
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

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
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
  vi.clearAllMocks();
});

afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

it("reports route returns 200 with answer and scope", async () => {
  const response = await reports(
    request({ question: "Show me a report", filters: { accounts: "a" }, timeZone: "UTC" }),
  );

  expect(response.status).toBe(200);
  const json = await response.json();
  expect(json).toEqual({
    answer: "Reports AI response",
    scope: expect.objectContaining({ label: expect.stringContaining("Account A") }),
  });
});

it("reports route calls runReportsAgentAi (not runAskJournalAi)", async () => {
  await reports(
    request({ question: "Show me a report", filters: { accounts: "a" }, timeZone: "UTC" }),
  );

  expect(mockReportsAgentAi).toHaveBeenCalledTimes(1);
  expect(mockAskJournalAi).not.toHaveBeenCalled();
});

it("reports route returns 400 for invalid body", async () => {
  for (const body of [
    null,
    [],
    42,
    { question: 1, filters: {} },
    { question: " ", filters: {} },
    { question: "How?", filters: {}, accountIds: ["a"] },
  ]) {
    expect((await reports(request(body))).status).toBe(400);
  }
  expect(mockReportsAgentAi).not.toHaveBeenCalled();
});

it("reports route isolates selected account in reports tool set", async () => {
  mockReportsAgentAi.mockReturnValueOnce("Reports response" as never);

  await reports(
    request({ question: "Show me a report", filters: { accounts: "a" }, timeZone: "UTC" }),
  );

  expect(mockReportsAgentAi).toHaveBeenCalledTimes(1);
  expect(mockAskJournalAi).not.toHaveBeenCalled();
});

it("reports route records stepCount and toolCallCount metadata from the runtime", async () => {
  mockReportsAgentAi.mockResolvedValueOnce("Reports answer" as never);

  const response = await reports(
    request({ question: "Report on my trades", filters: { accounts: "a" }, timeZone: "UTC" }),
  );

  expect(response.status).toBe(200);
  const json = await response.json();
  expect(json.answer).toBe("Reports answer");
  expect(mockReportsAgentAi).toHaveBeenCalledTimes(1);
});

describe("Ask route is unchanged", () => {
  it("ask route still uses runAskJournalAi and not runReportsAgentAi", async () => {
    mockAskJournalAi.mockResolvedValueOnce("Ask AI response" as never);

    const response = await ask(
      request({ question: "How did I do?", filters: { accounts: "a" }, timeZone: "UTC" }),
    );

    expect(response.status).toBe(200);
    expect(mockAskJournalAi).toHaveBeenCalledTimes(1);
    expect(mockReportsAgentAi).not.toHaveBeenCalled();
  });
});
