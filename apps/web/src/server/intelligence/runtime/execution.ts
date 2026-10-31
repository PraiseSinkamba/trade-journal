import {
  executionContextSchema,
  type ExecutionContext,
  type ExecutionContextInput,
} from "../contracts/execution";

/**
 * The execution context factory (Phase 12).
 *
 * Only the composition layer builds a context. Event JSON never grants
 * permission: a context is created from an approved scope and a runtime
 * policy, and the factory refuses anything that widens it.
 */

/** Freeze plain objects and arrays; native objects stay untouched. */
const freezeValue = <T>(value: T): T => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    Object.freeze(value);
    for (const item of value) freezeValue(item);
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) freezeValue((value as Record<string, unknown>)[key]);
  return value;
};

/**
 * Build the one authority an execution may act under.
 *
 * The principal and the mode must agree: an interactive request may not claim
 * the trusted system principal, and a background run always carries concrete
 * account ids. Unknown fields are refused rather than ignored, so a forged
 * payload can never widen the scope of an execution.
 *
 * The declared tool-call budget is the ceiling: the context stops reserving
 * tool calls once `maxToolCalls` is spent, whatever the runtime hook says.
 */
export function createExecutionContext(input: ExecutionContextInput): ExecutionContext {
  const parsed = executionContextSchema.parse(input);
  if (parsed.mode === "background" && parsed.scope.accountIds.length === 0) {
    throw new Error("A background execution requires concrete account ids.");
  }
  if (parsed.mode === "background" && parsed.principal !== "system") {
    throw new Error("A background execution requires the trusted system principal.");
  }
  if (parsed.mode === "interactive" && parsed.principal !== "interactive") {
    throw new Error("An interactive execution requires the interactive principal.");
  }

  let reserved = 0;
  const reserve = parsed.budgets.consumeToolCall;
  const context = {
    ...parsed,
    budgets: {
      ...parsed.budgets,
      consumeToolCall: () => {
        if (reserved >= parsed.budgets.maxToolCalls) return false;
        if (!reserve()) return false;
        reserved += 1;
        return true;
      },
    },
  };

  return freezeValue(context);
}
