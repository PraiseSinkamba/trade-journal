import type { ExecutionContext, Outcome } from "../contracts/execution";
import type { AiProvider } from "@/lib/ai-settings";
import {
  BACKGROUND_EXECUTION_LIMITS,
  BACKGROUND_FAILURE,
  BACKGROUND_RUN_FAILURE,
  backgroundPolicySchema,
  endpointFingerprint,
  type BackgroundPolicy,
  type BackgroundRunRecord,
} from "../contracts/policy";

/**
 * The background model policy (Phase 13).
 *
 * This module is the pure half of the background runtime: it decides whether a
 * queued run may still run against the *current* configuration, and it builds
 * the execution context the run would get. It never touches the database, the
 * provider or the network — the composition wires those around it.
 *
 * The rules it enforces come from the contract review:
 *
 * - background AI is opt-in, per account;
 * - a run is bound to the provider, model and endpoint it was approved
 *   against, so a configuration change makes the run unavailable rather than
 *   rerouting it;
 * - the capabilities the run needs must be declared by the operator;
 * - the context a run may read is bounded by the policy;
 * - a run that already ended is never authorised again.
 */

/** The provider configuration a background run is compared against. */
export interface CurrentProviderConfiguration {
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
}

/** What the policy store and the run ledger hand to the decision. */
export interface BackgroundAuthorizationInput {
  /** The queued run, or null when it does not exist. */
  run: BackgroundRunRecord | null;
  /** The current policy document, or null when there is none. */
  policy: BackgroundPolicy | null;
  /** True when a policy row exists but its document does not parse. */
  policyInvalid: boolean;
  /** The revision the current policy document was recorded under. */
  currentRevision: number;
  /** The provider configuration as it is configured right now. */
  current: CurrentProviderConfiguration;
  /** The accounts that still exist in the journal. */
  existingAccountIds: readonly string[];
  /** The signal that cancels the run. */
  signal: AbortSignal;
}

/** The run states a run never leaves without an explicit reschedule. */
const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "unavailable"] as const;

/**
 * Decide whether a queued background run may run, and under which authority.
 *
 * The decision is pure: everything it needs is handed in, so the same inputs
 * always produce the same verdict. A refusal names the reason; an approval
 * returns the execution context the run would run under.
 */
export const evaluateBackgroundAuthorization = (
  input: BackgroundAuthorizationInput,
): Outcome<ExecutionContext> => {
  const { run, policy, policyInvalid, currentRevision, current, existingAccountIds, signal } =
    input;
  if (!run) return { status: "failed", reason: BACKGROUND_FAILURE.runNotFound };
  if (signal.aborted) return { status: "cancelled", reason: BACKGROUND_FAILURE.cancelled };
  // A run that already ended is never authorised again: it needs an explicit
  // reschedule, not a second attempt.
  if (run.status === "cancelled")
    return { status: "cancelled", reason: BACKGROUND_FAILURE.cancelled };
  if ((TERMINAL_STATUSES as readonly string[]).includes(run.status))
    return { status: "failed", reason: BACKGROUND_RUN_FAILURE.runFinished };
  if (policyInvalid) return { status: "unavailable", reason: BACKGROUND_FAILURE.policyInvalid };
  if (!policy) return { status: "unavailable", reason: BACKGROUND_FAILURE.policyMissing };
  const parsed = backgroundPolicySchema.safeParse(policy);
  if (!parsed.success) return { status: "unavailable", reason: BACKGROUND_FAILURE.policyInvalid };
  const document = parsed.data;
  if (!document.enabled)
    return { status: "unavailable", reason: BACKGROUND_FAILURE.policyDisabled };
  // A run approved under an older policy revision does not inherit the newer
  // policy: it has to be rescheduled explicitly.
  if (run.policyRevision !== currentRevision)
    return { status: "unavailable", reason: BACKGROUND_FAILURE.policyChanged };
  for (const accountId of run.scope.accountIds) {
    if (!document.accounts.includes(accountId))
      return { status: "unavailable", reason: BACKGROUND_FAILURE.accountNotOptedIn };
    if (!existingAccountIds.includes(accountId))
      return { status: "cancelled", reason: BACKGROUND_FAILURE.accountMissing };
  }
  // The run is bound to the configuration it was approved against. When the
  // configuration changed, the run is unavailable: it is never rerouted to
  // another endpoint, and no fallback request is issued.
  if (
    run.provider !== current.provider ||
    run.model !== current.model ||
    run.endpointFingerprint !==
      endpointFingerprint(current.provider, current.model, current.baseUrl)
  )
    return { status: "unavailable", reason: BACKGROUND_FAILURE.configurationChanged };
  if (run.scope.requiredFeatures.includes("tools") && !document.capabilities.tools)
    return { status: "unavailable", reason: BACKGROUND_FAILURE.toolsUnsupported };
  if (
    run.scope.requiredFeatures.includes("structuredOutput") &&
    !document.capabilities.structuredOutput
  )
    return { status: "unavailable", reason: BACKGROUND_FAILURE.structuredOutputUnsupported };
  // The context a run may read is bounded by the policy.
  if (!Number.isFinite(document.maxInputCharacters) || document.maxInputCharacters <= 0)
    return { status: "unavailable", reason: BACKGROUND_FAILURE.capacityUnknown };
  if (run.scope.inputCharacters > document.maxInputCharacters)
    return { status: "unavailable", reason: BACKGROUND_FAILURE.contextTooLarge };
  let toolCalls = 0;
  return {
    status: "completed",
    value: {
      executionId: run.id,
      correlationId: run.effectKey,
      principal: "system",
      mode: "background",
      triggerSource: "intelligence.background",
      scope: {
        accountIds: [...run.scope.accountIds],
        filters: { ...run.scope.filters },
        timeZone: run.scope.timeZone,
        dataSources: [...run.scope.dataSources],
      },
      allowedCapabilityIds: [],
      // No background tool is registered yet: a run that needs tools is
      // authorised against the declared capability, but it has no tool to call
      // until the background capabilities are registered.
      allowedToolIds: [],
      budgets: {
        maxSteps: BACKGROUND_EXECUTION_LIMITS.maxSteps,
        maxToolCalls: BACKGROUND_EXECUTION_LIMITS.maxToolCalls,
        maxOutputTokens: BACKGROUND_EXECUTION_LIMITS.maxOutputTokens,
        timeoutMs: BACKGROUND_EXECUTION_LIMITS.timeoutMs,
        consumeToolCall: () => {
          if (toolCalls >= BACKGROUND_EXECUTION_LIMITS.maxToolCalls) return false;
          toolCalls += 1;
          return true;
        },
      },
      signal,
    },
  };
};
