import type { CapabilityRegistry, Eligibility } from "../contracts/capabilities";
import type { ExecutionContext, JsonValue, Outcome } from "../contracts/execution";

/** The reasons a capability call can fail. */
export const CAPABILITY_FAILURE = {
  unknownCapability: "unknown_capability",
  capabilityNotPermitted: "capability_not_permitted",
  invalidInput: "invalid_input",
  invalidOutput: "invalid_output",
} as const;

/** The dispatcher that runs registered capabilities under one execution. */
export interface CapabilityDispatcher {
  execute(id: string, input: unknown, context: ExecutionContext): Promise<Outcome<JsonValue>>;
  /** The eligible capabilities of an execution, in registry order. */
  select(context: ExecutionContext): Promise<readonly { id: string; version: string }[]>;
}

/**
 * The capability dispatcher (Phase 12).
 *
 * Selection is deterministic: a capability runs only when the execution
 * allows it, its input validates and its own eligibility rule says so. The
 * dispatcher never asks a model which capability to run.
 */
export function createCapabilityDispatcher(registry: CapabilityRegistry): CapabilityDispatcher {
  const evaluate = async (
    id: string,
    input: unknown,
    context: ExecutionContext,
  ): Promise<Outcome<JsonValue>> => {
    const capability = registry.get(id);
    if (!capability) return { status: "failed", reason: CAPABILITY_FAILURE.unknownCapability };
    if (!context.allowedCapabilityIds.includes(capability.id)) {
      return { status: "failed", reason: CAPABILITY_FAILURE.capabilityNotPermitted };
    }
    if (context.signal.aborted) return { status: "cancelled", reason: "cancelled" };
    const parsed = capability.inputSchema.safeParse(input);
    if (!parsed.success) return { status: "failed", reason: CAPABILITY_FAILURE.invalidInput };
    const eligibility: Eligibility = await capability.evaluate({
      execution: context,
      input: parsed.data,
    });
    if (eligibility.status === "ineligible") {
      return { status: "insufficient_evidence", reason: eligibility.reason };
    }
    if (eligibility.status === "defer") {
      return { status: "unavailable", reason: `deferred_until_${eligibility.until}` };
    }
    const outcome = await capability.execute(parsed.data, context);
    if (outcome.status !== "completed") return outcome;
    const output = capability.outputSchema.safeParse(outcome.value);
    if (!output.success) return { status: "failed", reason: CAPABILITY_FAILURE.invalidOutput };
    // The registered output schema narrows the payload to serialisable JSON.
    return { status: "completed", value: output.data };
  };

  return {
    execute: evaluate,
    select: async (context: ExecutionContext) => {
      const eligible: { id: string; version: string }[] = [];
      for (const capability of registry.list()) {
        if (!context.allowedCapabilityIds.includes(capability.id)) continue;
        const verdict = await capability.evaluate({ execution: context, input: undefined });
        if (verdict.status === "eligible")
          eligible.push({ id: capability.id, version: capability.version });
      }
      return eligible;
    },
  };
}
