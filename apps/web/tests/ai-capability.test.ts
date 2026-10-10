import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILTER_KEYS } from "@luxalgo/journal-core";
import { db, accounts, executions, trades, settings, journalDays } from "../src/db";
import { insertExecutions } from "../src/server/executions";
import { setSetting } from "../src/server/settings";
import { queryTrades } from "../src/server/trades-query";
import { runAi } from "../src/server/ai";
import { askJournalContext, dailyRecapContext, tradeCritiqueContext } from "../src/server/ai-capabilities";
import { deepFreeze, readAiRequest } from "../src/server/ai-scope";
import type { FrozenApprovedScope } from "../src/server/ai-scope";

vi.mock("@/server/ai", () => ({ runAi: vi.fn(async () => "Controlled AI response") }));
const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-ai-capability-"));
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
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.delete(journalDays).run();
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
  vi.mocked(runAi).mockClear();
});

afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

// --- deepFreeze unit tests ---

it("deepFreeze returns primitives unchanged", () => {
  expect(deepFreeze(null)).toBeNull();
  expect(deepFreeze(42)).toBe(42);
  expect(deepFreeze("hello")).toBe("hello");
  expect(deepFreeze(true)).toBe(true);
});

it("deepFreeze freezes objects in place", () => {
  const obj = { a: 1, b: { c: 2 } };
  const result = deepFreeze(obj);
  expect(result).toBe(obj);
  expect(Object.isFrozen(obj)).toBe(true);
  expect(Object.isFrozen(obj.b)).toBe(true);
});

it("deepFreeze freezes arrays in place", () => {
  const arr = [{ x: 1 }, { x: 2 }];
  const result = deepFreeze(arr);
  expect(result).toBe(arr);
  expect(Object.isFrozen(arr)).toBe(true);
  expect(Object.isFrozen(arr[0]!)).toBe(true);
});

it("deepFreeze returns already-frozen objects unchanged", () => {
  const obj = Object.freeze({ a: Object.freeze({ b: 1 }) });
  expect(deepFreeze(obj)).toBe(obj);
});

it("deepFreeze handles circular references", () => {
  const obj: Record<string, unknown> = { a: 1 };
  // @ts-ignore circular self-reference for test coverage
  (obj as Record<string, unknown>).self = obj;
  const result = deepFreeze(obj);
  expect(result).toBe(obj);
  expect(Object.isFrozen(obj)).toBe(true);
});

// --- FrozenApprovedScope integration ---

it("readAiRequest returns a deeply frozen scope", () => {
  const scope = readAiRequest({ question: "How did I do?", filters: {} }, "question");
  expect(Object.isFrozen(scope)).toBe(true);
  expect(Object.isFrozen(scope.filters)).toBe(true);
  expect(Object.isFrozen(scope.accounts)).toBe(true);
  expect(scope.accounts.every((a) => Object.isFrozen(a))).toBe(true);
  expect(Object.isFrozen(scope.scope)).toBe(true);
});

// --- askJournal capability ---

it("askJournal returns error when no trades match filters", async () => {
  // Route (not capability) parses body and creates scope; capability only reads it
  const scope = readAiRequest({
    question: "How did I do?",
    filters: { symbol: "NOT_PRESENT" },
    timeZone: "UTC",
  }, "question");
  const result = await askJournalContext(scope);
  expect(result).toEqual({ error: "No trades match the selected accounts and filters" });
  // Capability does not call runAi — that is the route's responsibility
  expect(runAi).not.toHaveBeenCalled();
});

it("askJournal returns answer and frozen scope when trades exist", async () => {
  // Capability returns read-only context + scope; route owns the AI call
  const scope = readAiRequest({ question: "How did I do?", filters: {}, timeZone: "UTC" }, "question");
  const result = await askJournalContext(scope);
  expect(result).toHaveProperty("context");
  expect(result).toHaveProperty("scope");
  const { scope: resolvedScope } = result as { scope: FrozenApprovedScope };
  expect(Object.isFrozen(resolvedScope)).toBe(true);
  expect(Object.isFrozen(resolvedScope.filters)).toBe(true);
  expect(Object.isFrozen(resolvedScope.accounts)).toBe(true);
  // runAi is called by the route, not the capability — tested in route integration
  expect(runAi).not.toHaveBeenCalled();
});

it("askJournal scope label reflects selected accounts", async () => {
  // Route creates scope via readAiRequest; capability receives pre-validated scope
  const scope = readAiRequest({ question: "How did I do?", filters: { accounts: "a" }, timeZone: "UTC" }, "question");
  const result = await askJournalContext(scope);
  expect(result).toHaveProperty("context");
  const { scope: resolvedScope } = result as { scope: FrozenApprovedScope };
  expect(resolvedScope.scope.label).toContain("Account A");
  expect(resolvedScope.scope.label).not.toContain("Account B");
  expect(runAi).not.toHaveBeenCalled();
});

// --- dailyRecapContext capability ---

it("dailyRecapContext throws when no closed trades for the day", async () => {
  const scope = readAiRequest({ date: "2026-01-01", filters: {}, timeZone: "UTC" }, "date");
  await expect(dailyRecapContext(scope, "2026-01-01", undefined)).rejects.toThrow(
    "No closed trades match this day and the selected filters",
  );
  expect(runAi).not.toHaveBeenCalled();
});

it("dailyRecapContext returns recap and frozen scope from route for a valid day", async () => {
  // dailyRecapContext receives scope from route; returns read-only context — route owns runAi
  const scope = readAiRequest({ date: "2026-09-15", filters: {}, timeZone: "UTC" }, "date");
  const result = await dailyRecapContext(scope, "2026-09-15", undefined);
  // Capability returns typed context data, not a recap string
  expect(result).toHaveProperty("context");
  expect(result).toHaveProperty("date", "2026-09-15");
  const { context } = result;
  expect(context).toHaveProperty("scopeContext");
  expect(context).toHaveProperty("accountContext");
  expect(context).toHaveProperty("metricsLine");
  expect(context).toHaveProperty("tradeLines");
  expect(context).toHaveProperty("existingNote", undefined);
  // runAi is called by the route, not the capability
  expect(runAi).not.toHaveBeenCalled();
});

it("dailyRecapContext note is passed from route when onlyDateFilters, undefined otherwise", async () => {
  const note = "SHARED_NOTE";
  db.insert(journalDays).values({ date: "2026-09-15", note, updatedAt: "2026-09-15" }).run();

  // With account filter: route passes existingNote=undefined (onlyDateFilters=false)
  // Capability embeds whatever existingNote it receives into context.existingNote
  const scopeWithAccount = readAiRequest(
    { date: "2026-09-15", filters: { accounts: "a" }, timeZone: "UTC" },
    "date",
  );
  const resultWithoutNote = await dailyRecapContext(scopeWithAccount, "2026-09-15", undefined);
  expect(resultWithoutNote.context.existingNote).toBeUndefined();
  expect(runAi).not.toHaveBeenCalled();

  // With only date filters: route reads note from DB and passes it to capability
  const scopeDateOnly = readAiRequest(
    { date: "2026-09-15", filters: { from: "2026-09-15", to: "2026-09-15" }, timeZone: "UTC" },
    "date",
  );
  const resultWithNote = await dailyRecapContext(scopeDateOnly, "2026-09-15", note);
  expect(resultWithNote.context.existingNote).toBe(note);
  expect(runAi).not.toHaveBeenCalled();
});

it("readAiRequest scope is deeply frozen for recap", async () => {
  const scope = readAiRequest({ date: "2026-09-15", filters: {}, timeZone: "UTC" }, "date");
  expect(Object.isFrozen(scope)).toBe(true);
  expect(Object.isFrozen(scope.filters)).toBe(true);
  expect(scope.accounts.every((a) => Object.isFrozen(a))).toBe(true);
});

// --- tradeCritiqueContext capability ---

it("tradeCritiqueContext returns null for unknown key", async () => {
  const result = await tradeCritiqueContext("not-a-real-key");
  expect(result).toBeNull();
  expect(runAi).not.toHaveBeenCalled();
});

it("tradeCritiqueContext returns trade+fills for valid key", async () => {
  // Capability returns typed read-only trade data; route owns the AI critique call
  const key = queryTrades({ accounts: "a" }).trades[0]!.key;
  const result = await tradeCritiqueContext(key);
  expect(result).not.toBeNull();
  expect(result).toHaveProperty("trade");
  expect(result).toHaveProperty("fills");
  expect(result!.trade).toHaveProperty("symbol");
  expect(Array.isArray(result!.fills)).toBe(true);
  // runAi is called by the route, not the capability
  expect(runAi).not.toHaveBeenCalled();
});
