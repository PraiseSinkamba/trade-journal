import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  JOURNAL_CAPABILITY_IDS,
  type JournalCapabilityPort,
} from "../src/server/intelligence/contracts/capabilities";
import type { ExecutionContext } from "../src/server/intelligence/contracts/execution";
import { TOOL_FAILURE, type ToolDefinition } from "../src/server/intelligence/contracts/tools";
import { createExecutionContext } from "../src/server/intelligence/runtime/execution";
import { createCapabilityRegistry } from "../src/server/intelligence/runtime/registry";
import {
  CAPABILITY_FAILURE,
  createCapabilityDispatcher,
} from "../src/server/intelligence/runtime/dispatcher";
import { createToolGateway } from "../src/server/intelligence/runtime/tool-gateway";
import { createJournalCapabilities } from "../src/server/intelligence/runtime/journal-capabilities";
import { createGatewayTool } from "../src/server/intelligence/runtime/ai-sdk-tools";

/*
 * The pure intelligence runtime (Phase 12).
 *
 * These tests never open a journal: the runtime only knows the query ports
 * and the execution context it is given.
 */

const scopeSnapshot = {
  filters: { accounts: "a" },
  timeZone: "UTC",
  accounts: [{ id: "a", name: "Account A", currency: "USD" }],
  question: "How did the session go?",
  date: undefined,
  scope: { label: "All accounts · UTC", timeZone: "UTC" },
  context: "Journal scope: All accounts · UTC.",
  dataSource: "trades" as const,
  tradeCritiqueKey: undefined,
};

const interactiveContext = (
  options: {
    allowedToolIds?: readonly string[];
    allowedCapabilityIds?: readonly string[];
    consumeToolCall?: () => boolean;
    signal?: AbortSignal;
    dataSources?: ExecutionContext["scope"]["dataSources"];
  } = {},
): ExecutionContext =>
  createExecutionContext({
    executionId: "exec-1",
    correlationId: "corr-1",
    principal: "interactive",
    mode: "interactive",
    triggerSource: "user.request",
    scope: {
      accountIds: ["a"],
      filters: { accounts: "a" },
      timeZone: "UTC",
      dataSources: [...(options.dataSources ?? ["trades"])],
    },
    allowedCapabilityIds: [...(options.allowedCapabilityIds ?? [])],
    allowedToolIds: [...(options.allowedToolIds ?? [])],
    budgets: {
      maxSteps: 4,
      maxToolCalls: 4,
      maxOutputTokens: 1200,
      consumeToolCall: options.consumeToolCall ?? (() => true),
    },
    signal: options.signal ?? new AbortController().signal,
  });

const journalPort = (overrides: Partial<JournalCapabilityPort> = {}): JournalCapabilityPort => ({
  askContext: async () => ({ context: "scoped context", scope: scopeSnapshot }),
  dailyRecap: async () => ({
    context: { scopeContext: "s", accountContext: "a", metricsLine: "m", tradeLines: "t" },
    date: "2026-09-15",
  }),
  tradeCritique: async () => undefined,
  playbookRules: async () => ({ context: "rule checks" }),
  missedObservations: async () => ({ context: "missed observations" }),
  notebookEntries: async () => ({ context: "notebook entries" }),
  progressHistory: async () => ({ context: "progress history", scope: scopeSnapshot }),
  ...overrides,
});

describe("capability registry", () => {
  it("refuses a duplicate capability registration", () => {
    const registry = createCapabilityRegistry();
    const capability = {
      id: "journal.ask-context",
      version: "1",
      mode: "deterministic" as const,
      triggers: [],
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({}).passthrough(),
      toolIds: [],
      dependencyIds: [],
      requiredModelFeatures: [],
      evaluate: async () => ({ status: "eligible" as const }),
      execute: async () => ({ status: "completed" as const, value: {} }),
    };
    registry.register(capability);
    expect(() => registry.register(capability)).toThrow(/already registered/);
  });

  it("treats a higher version number as the newer capability", () => {
    const registry = createCapabilityRegistry();
    const base = {
      mode: "deterministic" as const,
      triggers: [],
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({}).passthrough(),
      toolIds: [],
      dependencyIds: [],
      requiredModelFeatures: [],
      evaluate: async () => ({ status: "eligible" as const }),
      execute: async () => ({ status: "completed" as const, value: {} }),
    };
    registry.register({ ...base, id: "a.capability", version: "2" });
    registry.register({ ...base, id: "a.capability", version: "10" });

    expect(registry.get("a.capability")?.version).toBe("10");
    expect(registry.list().map((capability) => capability.version)).toEqual(["2", "10"]);
  });

  it("answers in a stable id and version order", () => {
    const registry = createCapabilityRegistry();
    const base = {
      mode: "deterministic" as const,
      triggers: [],
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({}).passthrough(),
      toolIds: [],
      dependencyIds: [],
      requiredModelFeatures: [],
      evaluate: async () => ({ status: "eligible" as const }),
      execute: async () => ({ status: "completed" as const, value: {} }),
    };
    registry.register({ ...base, id: "b.capability", version: "1" });
    registry.register({ ...base, id: "a.capability", version: "2" });
    registry.register({ ...base, id: "a.capability", version: "1" });

    expect(registry.list().map((capability) => `${capability.id}@${capability.version}`)).toEqual([
      "a.capability@1",
      "a.capability@2",
      "b.capability@1",
    ]);
    expect(registry.get("a.capability")?.version).toBe("2");
    expect(registry.get("a.capability", "1")?.version).toBe("1");
    expect(registry.get("missing.capability")).toBeUndefined();
  });
});

describe("capability dispatcher", () => {
  it("runs an eligible capability and validates its output", async () => {
    const registry = createCapabilityRegistry();
    for (const capability of createJournalCapabilities(journalPort()))
      registry.register(capability);
    const dispatcher = createCapabilityDispatcher(registry);
    const context = interactiveContext({
      allowedCapabilityIds: [JOURNAL_CAPABILITY_IDS.askContext],
    });

    const outcome = await dispatcher.execute(JOURNAL_CAPABILITY_IDS.askContext, {}, context);

    expect(outcome.status).toBe("completed");
    expect(outcome.status === "completed" && outcome.value).toMatchObject({
      context: "scoped context",
    });
  });

  it("refuses a capability the execution does not allow", async () => {
    const registry = createCapabilityRegistry();
    for (const capability of createJournalCapabilities(journalPort()))
      registry.register(capability);
    const dispatcher = createCapabilityDispatcher(registry);

    const outcome = await dispatcher.execute(
      JOURNAL_CAPABILITY_IDS.askContext,
      {},
      interactiveContext(),
    );

    expect(outcome).toEqual({
      status: "failed",
      reason: CAPABILITY_FAILURE.capabilityNotPermitted,
    });
  });

  it("refuses an unknown capability", async () => {
    const dispatcher = createCapabilityDispatcher(createCapabilityRegistry());
    const outcome = await dispatcher.execute("journal.nope", {}, interactiveContext());
    expect(outcome).toEqual({
      status: "failed",
      reason: CAPABILITY_FAILURE.unknownCapability,
    });
  });

  it("reports a capability whose data source is out of scope as missing evidence", async () => {
    const registry = createCapabilityRegistry();
    for (const capability of createJournalCapabilities(journalPort()))
      registry.register(capability);
    const dispatcher = createCapabilityDispatcher(registry);
    const context = interactiveContext({
      allowedCapabilityIds: [JOURNAL_CAPABILITY_IDS.playbookRules],
      dataSources: ["trades"],
    });

    const outcome = await dispatcher.execute(
      JOURNAL_CAPABILITY_IDS.playbookRules,
      { key: "k" },
      context,
    );

    expect(outcome.status).toBe("insufficient_evidence");
  });

  it("refuses an invalid capability input", async () => {
    const registry = createCapabilityRegistry();
    for (const capability of createJournalCapabilities(journalPort()))
      registry.register(capability);
    const dispatcher = createCapabilityDispatcher(registry);
    const context = interactiveContext({
      allowedCapabilityIds: [JOURNAL_CAPABILITY_IDS.tradeCritique],
    });

    const outcome = await dispatcher.execute(
      JOURNAL_CAPABILITY_IDS.tradeCritique,
      { key: "abc", account: "b" },
      context,
    );

    expect(outcome).toEqual({ status: "failed", reason: CAPABILITY_FAILURE.invalidInput });
  });

  it("rejects a capability output that does not match its schema", async () => {
    const registry = createCapabilityRegistry();
    registry.register({
      id: "journal.broken",
      version: "1",
      mode: "deterministic",
      triggers: [],
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ count: z.number() }).strict(),
      toolIds: [],
      dependencyIds: [],
      requiredModelFeatures: [],
      evaluate: async () => ({ status: "eligible" }),
      execute: async () => ({ status: "completed", value: { count: "not a number" } }),
    });
    const dispatcher = createCapabilityDispatcher(registry);
    const context = interactiveContext({ allowedCapabilityIds: ["journal.broken"] });

    const outcome = await dispatcher.execute("journal.broken", {}, context);

    expect(outcome).toEqual({ status: "failed", reason: CAPABILITY_FAILURE.invalidOutput });
  });

  it("selects the eligible capabilities of an execution in registry order", async () => {
    const registry = createCapabilityRegistry();
    for (const capability of createJournalCapabilities(journalPort()))
      registry.register(capability);
    const dispatcher = createCapabilityDispatcher(registry);

    const selected = await dispatcher.select(
      interactiveContext({
        allowedCapabilityIds: [
          JOURNAL_CAPABILITY_IDS.tradeCritique,
          JOURNAL_CAPABILITY_IDS.askContext,
        ],
      }),
    );

    expect(selected.map((capability) => capability.id)).toEqual([
      JOURNAL_CAPABILITY_IDS.askContext,
      JOURNAL_CAPABILITY_IDS.tradeCritique,
    ]);
  });

  it("loads the capability instructions only when they are asked for", async () => {
    const loadInstructions = vi.fn(async () => "answer from the scope only");
    const registry = createCapabilityRegistry();
    registry.register({
      id: "journal.lazy",
      version: "1",
      mode: "ai-assisted",
      triggers: [],
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({}).passthrough(),
      toolIds: [],
      dependencyIds: [],
      requiredModelFeatures: [],
      loadInstructions,
      evaluate: async () => ({ status: "eligible" }),
      execute: async () => ({ status: "completed", value: {} }),
    });

    expect(loadInstructions).not.toHaveBeenCalled();
    const capability = registry.get("journal.lazy");
    expect(await capability?.loadInstructions?.()).toBe("answer from the scope only");
    expect(loadInstructions).toHaveBeenCalledTimes(1);
  });
});

describe("tool gateway", () => {
  const readTool = (execute: ToolDefinition["execute"]): ToolDefinition => ({
    id: "journal.read",
    version: "1",
    description: "read",
    access: "read",
    requiredDataSources: ["trades"],
    inputSchema: z.object({ key: z.string().min(1) }).strict(),
    outputSchema: z.object({ value: z.string() }).strict(),
    execute,
  });

  it("runs a permitted tool", async () => {
    const gateway = createToolGateway([
      readTool(async () => ({ status: "completed", value: { value: "ok" } })),
    ]);

    const outcome = await gateway.execute(
      "journal.read",
      { key: "k" },
      interactiveContext({ allowedToolIds: ["journal.read"] }),
    );

    expect(outcome).toEqual({ status: "completed", value: { value: "ok" } });
  });

  it("refuses an unknown tool", async () => {
    const gateway = createToolGateway([]);
    const outcome = await gateway.execute(
      "journal.missing",
      { key: "k" },
      interactiveContext({ allowedToolIds: ["journal.missing"] }),
    );
    expect(outcome).toEqual({ status: "failed", reason: TOOL_FAILURE.unknownTool });
  });

  it("refuses a tool the execution does not allow", async () => {
    const execute = vi.fn(async () => ({ status: "completed" as const, value: { value: "ok" } }));
    const gateway = createToolGateway([readTool(execute)]);

    const outcome = await gateway.execute(
      "journal.read",
      { key: "k" },
      interactiveContext({ allowedToolIds: [] }),
    );

    expect(outcome).toEqual({ status: "failed", reason: TOOL_FAILURE.toolNotPermitted });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a write tool for an interactive principal", async () => {
    const execute = vi.fn(async () => ({ status: "completed" as const, value: { value: "ok" } }));
    const gateway = createToolGateway([{ ...readTool(execute), access: "write" }]);

    const outcome = await gateway.execute(
      "journal.read",
      { key: "k" },
      interactiveContext({ allowedToolIds: ["journal.read"] }),
    );

    expect(outcome).toEqual({ status: "failed", reason: TOOL_FAILURE.writeNotPermitted });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns no journal data after the tool-call budget is exhausted", async () => {
    const execute = vi.fn(async () => ({ status: "completed" as const, value: { value: "ok" } }));
    const gateway = createToolGateway([readTool(execute)]);

    const outcome = await gateway.execute(
      "journal.read",
      { key: "k" },
      interactiveContext({ allowedToolIds: ["journal.read"], consumeToolCall: () => false }),
    );

    expect(outcome).toEqual({ status: "failed", reason: TOOL_FAILURE.toolBudgetExhausted });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects unknown input fields", async () => {
    const execute = vi.fn(async () => ({ status: "completed" as const, value: { value: "ok" } }));
    const gateway = createToolGateway([readTool(execute)]);

    const outcome = await gateway.execute(
      "journal.read",
      { key: "k", account: "b" },
      interactiveContext({ allowedToolIds: ["journal.read"] }),
    );

    expect(outcome).toEqual({ status: "failed", reason: TOOL_FAILURE.invalidInput });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an invalid tool output", async () => {
    const gateway = createToolGateway([
      readTool(async () => ({ status: "completed", value: { value: 42 } })),
    ]);

    const outcome = await gateway.execute(
      "journal.read",
      { key: "k" },
      interactiveContext({ allowedToolIds: ["journal.read"] }),
    );

    expect(outcome).toEqual({ status: "failed", reason: TOOL_FAILURE.invalidOutput });
  });

  it("returns cancelled when the execution is aborted", async () => {
    const execute = vi.fn(async () => ({ status: "completed" as const, value: { value: "ok" } }));
    const gateway = createToolGateway([readTool(execute)]);
    const controller = new AbortController();
    controller.abort();

    const outcome = await gateway.execute(
      "journal.read",
      { key: "k" },
      interactiveContext({
        allowedToolIds: ["journal.read"],
        signal: controller.signal,
      }),
    );

    expect(outcome).toEqual({ status: "cancelled", reason: TOOL_FAILURE.cancelled });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a tool whose data source is out of scope", async () => {
    const execute = vi.fn(async () => ({ status: "completed" as const, value: { value: "ok" } }));
    const gateway = createToolGateway([
      { ...readTool(execute), requiredDataSources: ["trades+playbooks"] },
    ]);

    const outcome = await gateway.execute(
      "journal.read",
      { key: "k" },
      interactiveContext({ allowedToolIds: ["journal.read"] }),
    );

    expect(outcome).toEqual({ status: "failed", reason: TOOL_FAILURE.scopeNotPermitted });
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a duplicate tool registration", () => {
    const gateway = createToolGateway();
    const tool = readTool(async () => ({ status: "completed", value: { value: "ok" } }));
    gateway.register(tool);
    expect(() => gateway.register(tool)).toThrow(/already registered/);
  });
});

describe("AI SDK exposure", () => {
  it("returns the tool output for an allowed call", async () => {
    const gateway = createToolGateway([
      {
        id: "journal.read",
        version: "1",
        description: "read",
        access: "read",
        requiredDataSources: ["trades"],
        inputSchema: z.object({ key: z.string().min(1) }).strict(),
        outputSchema: z.object({ value: z.string() }).strict(),
        execute: async () => ({ status: "completed", value: { value: "ok" } }),
      },
    ]);
    const sdkTool = createGatewayTool<{ key: string }, { value: string } | { error: string }>({
      id: "journal.read",
      description: "read",
      providerSchema: {
        type: "object",
        additionalProperties: false,
        properties: { key: { type: "string" } },
        required: ["key"],
      },
      inputSchema: z.object({ key: z.string().min(1) }).strict(),
      gateway,
      context: interactiveContext({ allowedToolIds: ["journal.read"] }),
      onFailure: () => ({ error: "Invalid tool arguments." }),
    });

    const result = await sdkTool.execute({ key: "k" }, {} as never);

    expect(result).toEqual({ value: "ok" });
  });

  it("returns the failure result instead of running a refused tool", async () => {
    const execute = vi.fn(async () => ({ status: "completed" as const, value: { value: "ok" } }));
    const gateway = createToolGateway([
      {
        id: "journal.read",
        version: "1",
        description: "read",
        access: "read",
        requiredDataSources: ["trades"],
        inputSchema: z.object({ key: z.string().min(1) }).strict(),
        outputSchema: z.object({ value: z.string() }).strict(),
        execute,
      },
    ]);
    const sdkTool = createGatewayTool<{ key: string }, { value: string } | { error: string }>({
      id: "journal.read",
      description: "read",
      providerSchema: {
        type: "object",
        additionalProperties: false,
        properties: { key: { type: "string" } },
        required: ["key"],
      },
      inputSchema: z.object({ key: z.string().min(1) }).strict(),
      gateway,
      context: interactiveContext({ allowedToolIds: [] }),
      onFailure: () => ({ error: "Invalid tool arguments." }),
    });

    const result = await sdkTool.execute({ key: "k" }, {} as never);

    expect(result).toEqual({ error: "Invalid tool arguments." });
    expect(execute).not.toHaveBeenCalled();
  });
});
