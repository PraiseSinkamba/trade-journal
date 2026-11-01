import { createHash } from "node:crypto";
import { z } from "zod";
import type { AiProvider } from "@/lib/ai-settings";
import { DATA_SOURCES } from "./execution";

/**
 * Background policy contracts (Phase 13).
 *
 * A background run is authorised against a *policy*: a revisioned document that
 * says whether background AI is enabled at all, which accounts opted in, which
 * model capabilities the operator declared, and how much context a run may
 * read.
 *
 * The provider, the model and the endpoint a run uses are not part of the
 * policy document: they come from the journal's AI settings, and a run pins
 * the fingerprint of the configuration it was queued against. When that
 * configuration changes, the queued run becomes unavailable instead of being
 * rerouted to another endpoint (contract review §6).
 *
 * The documents are strict: an unknown field is a corrupt policy, not a
 * silently ignored one. A policy that does not parse authorises nothing.
 */

/** The key of the single background policy the journal keeps. */
export const BACKGROUND_POLICY_ID = "background";

/**
 * How many background attempts a journal may spend per day.
 *
 * The allowance is journal-wide, not per account: it bounds the provider
 * spend of the whole journal (contract review §6).
 */
export const BACKGROUND_DAILY_ATTEMPT_LIMIT = 10;

/** The execution limits a background run gets. */
export const BACKGROUND_EXECUTION_LIMITS = {
  maxOutputTokens: 1200,
  maxSteps: 4,
  maxToolCalls: 4,
  timeoutMs: 30_000,
  // A background run never retries on its own: a retry spends another
  // allowance and would issue another request to the provider.
  maxRetries: 0,
} as const;

/** The model capabilities a background run may require. */
export const BACKGROUND_FEATURES = ["tools", "structuredOutput"] as const;

/** One model capability a background run may require. */
export type BackgroundFeature = (typeof BACKGROUND_FEATURES)[number];

/**
 * The fingerprint of an approved provider, model and endpoint.
 *
 * It is a digest, not the endpoint: the fingerprint proves that the
 * configuration a run was approved against is still the configured one,
 * without copying the endpoint into every run row.
 */
export const endpointFingerprint = (
  provider: AiProvider,
  model: string,
  baseUrl: string | null,
): string =>
  createHash("sha256")
    .update(`${provider}\n${model}\n${baseUrl ?? ""}`)
    .digest("hex");

/** The background policy document. */
export const backgroundPolicySchema = z
  .object({
    /** The shape version of the document. */
    schemaVersion: z.literal(1),
    /** Whether the operator opted background AI in at all. */
    enabled: z.boolean(),
    /** The accounts that opted in. A run outside this list authorises nothing. */
    accounts: z.array(z.string().min(1)),
    /**
     * The model capabilities the operator declared.
     *
     * They are declared, never probed: a background run never contacts a
     * provider to find out what it can do.
     */
    capabilities: z
      .object({ tools: z.boolean(), structuredOutput: z.boolean() })
      .strict(),
    /** How many characters of context a background run may read. */
    maxInputCharacters: z.number().int().positive(),
  })
  .strict();

/** The background policy document. */
export type BackgroundPolicy = z.infer<typeof backgroundPolicySchema>;

/**
 * The reasons the background run service refuses outside the policy decision.
 *
 * They are stable identifiers, like the policy decision reasons.
 */
export const BACKGROUND_RUN_FAILURE = {
  dailyBudgetExhausted: "daily_budget_exhausted",
  providerNotConfigured: "provider_not_configured",
  runFinished: "run_finished",
} as const;

/**
 * The reasons the policy decision refuses a run.
 *
 * They are stable identifiers.
 */
export const BACKGROUND_FAILURE = {
  runNotFound: "run_not_found",
  cancelled: "cancelled",
  policyMissing: "policy_missing",
  policyInvalid: "policy_invalid",
  policyDisabled: "policy_disabled",
  policyChanged: "policy_changed",
  accountNotOptedIn: "account_not_opted_in",
  accountMissing: "account_missing",
  configurationChanged: "configuration_changed",
  toolsUnsupported: "tools_unsupported",
  structuredOutputUnsupported: "structured_output_unsupported",
  capacityUnknown: "capacity_unknown",
  contextTooLarge: "context_too_large",
} as const;

/**
 * The policy a journal starts with: background AI is off until the operator
 * opts in, and no capability is declared.
 */
export const DEFAULT_BACKGROUND_POLICY: BackgroundPolicy = {
  schemaVersion: 1,
  enabled: false,
  accounts: [],
  capabilities: { tools: false, structuredOutput: false },
  maxInputCharacters: 8000,
};

/**
 * The policy as the settings surface sees it.
 *
 * It is the document plus the revision it was recorded under: the revision is
 * what a queued run is pinned to.
 */
export interface BackgroundPolicyView {
  /** Whether the operator opted background AI in at all. */
  enabled: boolean;
  /** The accounts that opted in. */
  accounts: string[];
  /** The model capabilities the operator declared. */
  capabilities: { tools: boolean; structuredOutput: boolean };
  /** How many characters of context a background run may read. */
  maxInputCharacters: number;
  /** The revision the document was recorded under. */
  revision: number;
}

/** The patch the settings API accepts for the background policy. */
export const backgroundPolicyPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    accounts: z.array(z.string().min(1)).optional(),
    capabilities: z
      .object({ tools: z.boolean().optional(), structuredOutput: z.boolean().optional() })
      .strict()
      .optional(),
    maxInputCharacters: z.number().int().positive().optional(),
  })
  .strict();

/** The patch the settings API accepts for the background policy. */
export type BackgroundPolicyPatch = z.infer<typeof backgroundPolicyPatchSchema>;

/**
 * The scope a background run may read.
 *
 * A background run always stores concrete account ids: an empty scope is not
 * an "all accounts" request, it is an invalid one.
 */
export const backgroundScopeSchema = z
  .object({
    accountIds: z.array(z.string().min(1)).min(1),
    filters: z.record(z.string(), z.string()),
    timeZone: z.string().min(1),
    dataSources: z.array(z.enum(DATA_SOURCES)).min(1),
    /** The model capabilities the run needs. */
    requiredFeatures: z.array(z.enum(BACKGROUND_FEATURES)).default([]),
    /** How many characters of context the run wants to read. */
    inputCharacters: z.number().int().positive(),
  })
  .strict();

/** The scope a background run may read. */
export type BackgroundScope = z.infer<typeof backgroundScopeSchema>;

/** The lifecycle of a background run. */
export const backgroundRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "unavailable",
]);

/** The lifecycle of a background run. */
export type BackgroundRunStatus = z.infer<typeof backgroundRunStatusSchema>;

/** One queued background run, as it is stored. */
export interface BackgroundRunRecord {
  id: string;
  /** The idempotency key of the run: the same effect is queued once. */
  effectKey: string;
  status: BackgroundRunStatus;
  /** The provider the run was approved against. */
  provider: AiProvider;
  /** The model the run was approved against. */
  model: string;
  /** The fingerprint of the approved provider, model and endpoint. */
  endpointFingerprint: string;
  /** The policy revision the run was approved under. */
  policyRevision: number;
  /** The scope the run may read. */
  scope: BackgroundScope;
  /** Sanitized diagnostics: never a prompt, a response or a credential. */
  meta: Record<string, unknown>;
}

/**
 * The result of a background run.
 *
 * The output is the model's answer; the metadata is minimal and sanitized: no
 * prompt, no credential, no raw provider response.
 */
export interface BackgroundRunOutput {
  /** The run the result belongs to. */
  readonly runId: string;
  /** The state the run ended in. */
  readonly status: BackgroundRunStatus;
  /** The model's answer, or null when the run produced none. */
  readonly output: string | null;
  /** Sanitized diagnostics. */
  readonly meta: Record<string, unknown>;
}
