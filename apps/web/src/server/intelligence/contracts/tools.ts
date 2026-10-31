import { z } from "zod";
import type { DataSource, ExecutionContext, JsonValue, Outcome } from "./execution";

/**
 * Tool contracts (Phase 12).
 *
 * Tool registration is separate from model exposure. A tool is a registered
 * operation with strict schemas; the gateway decides whether an execution may
 * run it; the AI SDK adapter decides which of the approved tools a model sees.
 */

/** What a tool may do to journal state. */
export type ToolAccess = "read" | "propose" | "write";

/**
 * The reasons a tool call can fail. They are stable identifiers, not prose:
 * a caller may branch on them, a model may not.
 */
export const TOOL_FAILURE = {
  unknownTool: "unknown_tool",
  toolNotPermitted: "tool_not_permitted",
  writeNotPermitted: "write_not_permitted",
  scopeNotPermitted: "scope_not_permitted",
  toolBudgetExhausted: "tool_budget_exhausted",
  invalidInput: "invalid_input",
  invalidOutput: "invalid_output",
  cancelled: "cancelled",
} as const;

/** One registered tool. */
export type ToolDefinition = Readonly<{
  id: string;
  version: string;
  description: string;
  access: ToolAccess;
  /** The data sources an execution must allow before this tool may run. */
  requiredDataSources: readonly DataSource[];
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  execute: (input: unknown, context: ExecutionContext) => Promise<Outcome<unknown>>;
}>;

/** The gateway that authorises and runs registered tools. */
export interface ToolGateway {
  register(tool: ToolDefinition): void;
  get(id: string): ToolDefinition | undefined;
  /** Every registered tool, ordered by id. */
  list(): readonly ToolDefinition[];
  execute(id: string, input: unknown, context: ExecutionContext): Promise<Outcome<JsonValue>>;
}
