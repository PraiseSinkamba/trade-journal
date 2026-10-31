import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, accounts, executions, trades, settings, journalDays } from "../src/db";
import { insertExecutions } from "../src/server/executions";
import { queryTrades } from "../src/server/trades-query";
import { setSetting } from "../src/server/settings";
import { createScopedJournalPort } from "../src/server/ai-capabilities";
import { createInteractiveContext, readAiRequest } from "../src/server/ai-scope";
import { AI_FEATURE_TOOL_IDS, AI_TOOL_IDS } from "../src/server/ai-contracts";
import { JOURNAL_CAPABILITY_IDS } from "../src/server/intelligence/contracts/capabilities";
import { createCapabilityRegistry } from "../src/server/intelligence/runtime/registry";
import { createCapabilityDispatcher } from "../src/server/intelligence/runtime/dispatcher";
import { createJournalCapabilities } from "../src/server/intelligence/runtime/journal-capabilities";
import { createExecutionContext } from "../src/server/intelligence/runtime/execution";

/*
 * The execution scope (Phase 12).
 *
 * The approved request scope decides what an execution may read; nothing in
 * the execution context may widen it.
 */

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-intelligence-scope-"));
process.env.JOURNAL_DATA_DIR = scratch;

const fills = (symbol: string, exit: number) => [
  {
    symbol,
    side: "buy" as const,
    quantity: 1,
    price: 100,
    fee: 0,
    executedAt: "2026-09-15T09:00:00Z",
  },
  {
    symbol,
    side: "sell" as const,
    quantity: 1,
    price: exit,
    fee: 0,
    executedAt: "2026-09-15T10:00:00Z",
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
  insertExecutions("b", fills("ONLY_B", 50), "manual");
  setSetting("timeZone", "UTC");
});

afterAll(() => {
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

const scopeFor = (filters: Record<string, string>) =>
  readAiRequest({ question: "How did it go?", filters, timeZone: "UTC" }, "question");

it("keeps only the approved account, filters and timezone in the execution context", () => {
  const scope = scopeFor({ accounts: "a" });

  const execution = createInteractiveContext(scope, new AbortController().signal);

  expect(execution.scope.accountIds).toEqual(["a"]);
  expect(execution.scope.filters).toEqual({ accounts: "a" });
  expect(execution.scope.timeZone).toBe("UTC");
  expect(execution.scope.dataSources).toEqual(["trades"]);
  expect(execution.principal).toBe("interactive");
  expect(execution.mode).toBe("interactive");
});

it("carries every account when the request names no account", () => {
  const scope = scopeFor({});

  const execution = createInteractiveContext(scope, new AbortController().signal);

  expect(execution.scope.accountIds).toEqual(["a", "b"]);
});

it("refuses a selected account that no longer exists", () => {
  db.delete(accounts).run();
  db.insert(accounts)
    .values([{ id: "b", name: "Account B", kind: "manual" as const, createdAt: "2026-01-01" }])
    .run();

  expect(() => scopeFor({ accounts: "a" })).toThrow(/no longer exists/);
});

it("refuses an unknown request field instead of ignoring it", () => {
  expect(() =>
    readAiRequest(
      { question: "How did it go?", filters: {}, timeZone: "UTC", account: "b" },
      "question",
    ),
  ).toThrow(/Unknown AI request field/);
});

it("refuses a forged principal", () => {
  const base = {
    executionId: "exec-1",
    correlationId: "corr-1",
    mode: "interactive" as const,
    triggerSource: "user.request",
    scope: {
      accountIds: ["a"],
      filters: {},
      timeZone: "UTC",
      dataSources: ["trades" as const],
    },
    allowedCapabilityIds: [],
    allowedToolIds: [],
    budgets: {
      maxSteps: 1,
      maxToolCalls: 1,
      maxOutputTokens: 100,
      consumeToolCall: () => true,
    },
    signal: new AbortController().signal,
  };

  expect(() => createExecutionContext({ ...base, principal: "system" })).toThrow(
    /interactive principal/,
  );
  expect(() => createExecutionContext({ ...base, principal: "root" as never })).toThrow();
});

it("refuses a background execution without concrete account ids", () => {
  expect(() =>
    createExecutionContext({
      executionId: "exec-1",
      correlationId: "corr-1",
      principal: "system",
      mode: "background",
      triggerSource: "worker.job",
      scope: { accountIds: [], filters: {}, timeZone: "UTC", dataSources: ["trades"] },
      allowedCapabilityIds: [],
      allowedToolIds: [],
      budgets: {
        maxSteps: 1,
        maxToolCalls: 1,
        maxOutputTokens: 100,
        consumeToolCall: () => true,
      },
      signal: new AbortController().signal,
    }),
  ).toThrow(/concrete account ids/);
});

it("refuses unknown execution context fields", () => {
  // The forged field is a runtime attack, so the shape check has to bypass the
  // compiler on purpose.
  const forged = {
    executionId: "exec-1",
    correlationId: "corr-1",
    principal: "interactive",
    mode: "interactive",
    triggerSource: "user.request",
    scope: {
      accountIds: ["a"],
      filters: {},
      timeZone: "UTC",
      dataSources: ["trades"],
    },
    allowedCapabilityIds: [],
    allowedToolIds: [],
    budgets: {
      maxSteps: 1,
      maxToolCalls: 1,
      maxOutputTokens: 100,
      consumeToolCall: () => true,
    },
    signal: new AbortController().signal,
    accountIds: ["b"],
  } as unknown as Parameters<typeof createExecutionContext>[0];

  expect(() => createExecutionContext(forged)).toThrow();
});

it("never reads a trade outside the approved scope", async () => {
  const scope = scopeFor({ accounts: "a" });
  const registry = createCapabilityRegistry();
  for (const capability of createJournalCapabilities(createScopedJournalPort(scope))) {
    registry.register(capability);
  }
  const dispatcher = createCapabilityDispatcher(registry);
  const execution = createInteractiveContext(scope, new AbortController().signal);
  expect(execution.allowedCapabilityIds).toContain(JOURNAL_CAPABILITY_IDS.tradeCritique);
  const otherAccountKey = queryTrades({ accounts: "b" }).trades[0]!.key;

  const outcome = await dispatcher.execute(
    JOURNAL_CAPABILITY_IDS.tradeCritique,
    { key: otherAccountKey },
    execution,
  );

  expect(outcome.status).toBe("insufficient_evidence");
  expect(JSON.stringify(outcome)).not.toContain("ONLY_B");
});

it("stops reserving tool calls at the declared budget", () => {
  const scope = scopeFor({ accounts: "a" });
  const execution = createInteractiveContext(scope, new AbortController().signal);

  expect(execution.budgets.maxToolCalls).toBe(4);
  expect(execution.budgets.consumeToolCall()).toBe(true);
  expect(execution.budgets.consumeToolCall()).toBe(true);
  expect(execution.budgets.consumeToolCall()).toBe(true);
  expect(execution.budgets.consumeToolCall()).toBe(true);
  expect(execution.budgets.consumeToolCall()).toBe(false);
});

it("freezes the execution context", () => {
  const execution = createInteractiveContext(
    scopeFor({ accounts: "a" }),
    new AbortController().signal,
  );

  expect(Object.isFrozen(execution)).toBe(true);
  expect(Object.isFrozen(execution.scope)).toBe(true);
});

it("allows only the tools of the requested feature", () => {
  const scope = scopeFor({ accounts: "a" });
  const signal = new AbortController().signal;

  const ask = createInteractiveContext(scope, signal, { feature: "askJournalAgent" });
  const reports = createInteractiveContext(scope, signal, { feature: "reportsAgent" });

  expect(ask.allowedToolIds).toEqual(AI_FEATURE_TOOL_IDS.askJournalAgent);
  expect(reports.allowedToolIds).toEqual(AI_FEATURE_TOOL_IDS.reportsAgent);
  expect(ask.allowedToolIds).toContain(AI_TOOL_IDS.tradeDetail);
  expect(reports.allowedToolIds).toContain(AI_TOOL_IDS.reportMode);
});

it("charges the runtime-owned tool budget through the execution context", () => {
  const scope = scopeFor({ accounts: "a" });
  let remaining = 1;

  const execution = createInteractiveContext(scope, new AbortController().signal, {
    consumeToolCall: () => {
      if (remaining <= 0) return false;
      remaining -= 1;
      return true;
    },
  });

  expect(execution.budgets.consumeToolCall()).toBe(true);
  expect(execution.budgets.consumeToolCall()).toBe(false);
});
