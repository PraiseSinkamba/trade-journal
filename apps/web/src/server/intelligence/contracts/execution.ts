import { z } from "zod";

/**
 * Execution contracts (Phase 12).
 *
 * The trusted authority carried by every scoped operation: who runs it, what
 * data it may read, which capabilities and tools it may use, what it may
 * spend and how it is cancelled. This module is pure — no database, no Next,
 * no AI SDK — so the runtime can be exercised without a journal.
 */

/** A JSON value that survives a round trip through a tool or capability. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The trusted principal an execution runs as. */
export type Principal = "interactive" | "system";

/** How an execution was invoked. */
export type ExecutionMode = "interactive" | "background";

/** The read-only data sources an execution may use. */
export const DATA_SOURCES = [
  "trades",
  "trades+playbooks",
  "trades+missed",
  "trades+notes",
  "trades+progress",
] as const;

/** One allowed data source. */
export type DataSource = (typeof DATA_SOURCES)[number];

/**
 * Whether an allowed data source covers a required one.
 *
 * Every data source starts with the trades scope, so an execution that may
 * read trades plus playbooks may also read plain trades.
 */
export const allowsDataSource = (sources: readonly DataSource[], required: DataSource): boolean =>
  sources.includes(required) ||
  (required === "trades" && sources.some((source) => source.startsWith("trades")));

/** The validated data scope of one execution. */
export type ExecutionScope = Readonly<{
  /** Empty means every account, and only an interactive request may say so. */
  accountIds: readonly string[];
  filters: Readonly<Record<string, string>>;
  timeZone: string;
  dataSources: readonly DataSource[];
}>;

/** The resource limits and the tool-call reservation of one execution. */
export type ExecutionBudgets = Readonly<{
  maxSteps: number;
  maxToolCalls: number;
  maxOutputTokens: number;
  timeoutMs?: number;
  /** Reserves one tool call; false once the budget is exhausted. */
  consumeToolCall: () => boolean;
}>;

/** The validated authority of one operation. */
export type ExecutionContext = Readonly<{
  executionId: string;
  correlationId: string;
  principal: Principal;
  mode: ExecutionMode;
  triggerSource: string;
  scope: ExecutionScope;
  allowedCapabilityIds: readonly string[];
  allowedToolIds: readonly string[];
  budgets: ExecutionBudgets;
  signal: AbortSignal;
}>;

/** The typed result of an execution. */
export type Outcome<T> =
  | { status: "completed"; value: T }
  | { status: "insufficient_evidence"; reason: string }
  | { status: "unavailable"; reason: string }
  | { status: "cancelled"; reason: string }
  | { status: "failed"; reason: string };

/** The scope snapshot a capability may hand back to the caller. */
export const approvedScopeSchema = z
  .object({
    filters: z.record(z.string(), z.string()),
    timeZone: z.string(),
    accounts: z.array(
      z.object({ id: z.string(), name: z.string(), currency: z.string() }).strict(),
    ),
    question: z.string(),
    date: z.string().optional(),
    scope: z.object({ label: z.string(), timeZone: z.string() }).strict(),
    context: z.string(),
    dataSource: z.enum(DATA_SOURCES),
    tradeCritiqueKey: z.string().optional(),
  })
  .strict();

/** The scope snapshot type. */
export type ApprovedScope = z.infer<typeof approvedScopeSchema>;

const executionScopeSchema = z
  .object({
    accountIds: z.array(z.string().min(1)),
    filters: z.record(z.string(), z.string()),
    timeZone: z.string().min(1),
    dataSources: z.array(z.enum(DATA_SOURCES)).min(1),
  })
  .strict();

const executionBudgetsSchema = z
  .object({
    maxSteps: z.number().int().positive(),
    maxToolCalls: z.number().int().nonnegative(),
    maxOutputTokens: z.number().int().positive(),
    timeoutMs: z.number().int().positive().optional(),
    consumeToolCall: z.custom<() => boolean>((value) => typeof value === "function"),
  })
  .strict();

/** The strict shape of an execution context. */
export const executionContextSchema = z
  .object({
    executionId: z.string().min(1).max(200),
    correlationId: z.string().min(1).max(200),
    principal: z.enum(["interactive", "system"]),
    mode: z.enum(["interactive", "background"]),
    triggerSource: z.string().min(1).max(64),
    scope: executionScopeSchema,
    allowedCapabilityIds: z.array(z.string().min(1)).max(64),
    allowedToolIds: z.array(z.string().min(1)).max(64),
    budgets: executionBudgetsSchema,
    signal: z.custom<AbortSignal>(
      (value) => typeof AbortSignal !== "undefined" && value instanceof AbortSignal,
    ),
  })
  .strict();

/** The input accepted by the execution context factory. */
export type ExecutionContextInput = z.input<typeof executionContextSchema>;
