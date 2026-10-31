import { jsonSchema, type JSONSchema7, type Schema, type ToolExecuteFunction } from "ai";
import { z } from "zod";
import type { ExecutionContext } from "../contracts/execution";
import type { ToolGateway } from "../contracts/tools";

/**
 * The AI SDK tool adapter (Phase 12).
 *
 * Model-specific exposure stays here: the adapter presents an approved tool
 * to the provider, lets the gateway decide whether the call is allowed and
 * maps a refused call onto the result the model sees.
 */

/** An AI SDK tool whose execute function is always present. */
export type ExecutableSdkTool<TInput, TOutput> = {
  description: string;
  inputSchema: Schema<TInput>;
  execute: ToolExecuteFunction<TInput, TOutput, Record<string, never>>;
};

/**
 * Expose one registered tool to the AI SDK.
 *
 * The provider schema describes the input to the model; the Zod contract is
 * the authority that decides whether a call is valid. A refused call never
 * reaches the tool and returns the result the caller supplies.
 */
export function createGatewayTool<TInput, TOutput>(options: {
  id: string;
  description: string;
  providerSchema: JSONSchema7;
  inputSchema: z.ZodType<TInput>;
  gateway: ToolGateway;
  context: ExecutionContext;
  onFailure: (reason: string) => TOutput;
}): ExecutableSdkTool<TInput, TOutput> {
  const sdkTool: ExecutableSdkTool<TInput, TOutput> = {
    description: options.description,
    inputSchema: jsonSchema<TInput>(options.providerSchema, {
      validate: (value: unknown) => {
        const parsed = options.inputSchema.safeParse(value);
        if (!parsed.success) {
          return { success: false, error: new Error("Invalid tool arguments.") };
        }
        return { success: true, value: parsed.data };
      },
    }),
    execute: async (input: TInput) => {
      const outcome = await options.gateway.execute(options.id, input, options.context);
      // The gateway already validated the value against the tool's output
      // schema, so the narrowed type is the registered contract.
      if (outcome.status === "completed") return outcome.value as TOutput;
      return options.onFailure(outcome.reason);
    },
  };
  return sdkTool;
}
