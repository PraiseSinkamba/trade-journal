import {
  allowsDataSource,
  type ExecutionContext,
  type JsonValue,
  type Outcome,
} from "../contracts/execution";
import { TOOL_FAILURE, type ToolDefinition, type ToolGateway } from "../contracts/tools";

/**
 * The tool gateway (Phase 12).
 *
 * The gateway is the only way to run a registered tool. It checks the tool
 * allowlist of the execution, the access category, the tool-call budget and
 * cancellation before the call, validates the input before it reaches the
 * tool and validates the output before it leaves the gateway.
 */
export function createToolGateway(tools: readonly ToolDefinition[] = []): ToolGateway {
  const registered = new Map<string, ToolDefinition>();

  const register = (tool: ToolDefinition): void => {
    if (registered.has(tool.id)) throw new Error(`Tool ${tool.id} is already registered.`);
    registered.set(tool.id, tool);
  };

  for (const tool of tools) register(tool);

  const execute = async (
    id: string,
    input: unknown,
    context: ExecutionContext,
  ): Promise<Outcome<JsonValue>> => {
    const tool = registered.get(id);
    if (!tool) return { status: "failed", reason: TOOL_FAILURE.unknownTool };
    if (!context.allowedToolIds.includes(tool.id)) {
      return { status: "failed", reason: TOOL_FAILURE.toolNotPermitted };
    }
    // Write access stays with the trusted system principal; an interactive
    // request never reaches a mutating tool through this gateway. A propose
    // tool only suggests a change for approval, so it needs no extra gate —
    // no propose tool is registered in this phase.
    if (tool.access === "write" && context.principal !== "system") {
      return { status: "failed", reason: TOOL_FAILURE.writeNotPermitted };
    }
    const scopeCovers = tool.requiredDataSources.every((required) =>
      allowsDataSource(context.scope.dataSources, required),
    );
    if (!scopeCovers) return { status: "failed", reason: TOOL_FAILURE.scopeNotPermitted };
    if (context.signal.aborted) return { status: "cancelled", reason: TOOL_FAILURE.cancelled };
    if (!context.budgets.consumeToolCall()) {
      return { status: "failed", reason: TOOL_FAILURE.toolBudgetExhausted };
    }
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) return { status: "failed", reason: TOOL_FAILURE.invalidInput };
    const outcome = await tool.execute(parsed.data, context);
    if (outcome.status !== "completed") return outcome;
    const output = tool.outputSchema.safeParse(outcome.value);
    if (!output.success) return { status: "failed", reason: TOOL_FAILURE.invalidOutput };
    // The registered output schema narrows the payload to serialisable JSON.
    return { status: "completed", value: output.data };
  };

  return {
    register,
    get: (id: string) => registered.get(id),
    list: () => [...registered.values()].sort((left, right) => left.id.localeCompare(right.id)),
    execute,
  };
}
