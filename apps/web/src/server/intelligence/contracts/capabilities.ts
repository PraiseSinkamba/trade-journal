import { z } from "zod";
import type { ExecutionContext, Outcome } from "./execution";

/**
 * Capability contracts (Phase 12).
 *
 * A capability is a registered, versioned unit of work with a deterministic
 * eligibility rule, strict input and output schemas and an explicit
 * dependency list. Capabilities are registered explicitly; nothing is
 * discovered or executed dynamically.
 */

/** The identifiers of the registered journal capabilities. */
export const JOURNAL_CAPABILITY_IDS = {
  askContext: "journal.ask-context",
  dailyRecap: "journal.daily-recap",
  tradeCritique: "journal.trade-critique",
  playbookRules: "journal.playbook-rules",
  missedObservations: "journal.missed-observations",
  notebookEntries: "journal.notebook-entries",
  progressHistory: "journal.progress-history",
  /**
   * The background capability that asks the provider for one review question.
   *
   * It is registered here so the journal has one registry of capability ids,
   * but it is never granted to an interactive scope: the background runtime
   * executes it under its own policy decision.
   */
  reviewInsight: "journal.review-insight",
} as const;

/** How a capability reaches its result. */
export type CapabilityMode = "deterministic" | "ai-assisted";

/** The deterministic eligibility verdict of a capability. */
export type Eligibility =
  | { status: "eligible" }
  | { status: "defer"; until: number }
  | { status: "ineligible"; reason: string };

/** What a capability sees while it decides whether it may run. */
export type CapabilityEvaluationContext = Readonly<{
  execution: ExecutionContext;
  input: unknown;
}>;

/** One registered capability. */
export type Capability = Readonly<{
  id: string;
  version: string;
  mode: CapabilityMode;
  /** The events or requests that may select this capability. */
  triggers: readonly string[];
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  /** The tools this capability may use. */
  toolIds: readonly string[];
  /** The capabilities this capability depends on. */
  dependencyIds: readonly string[];
  /** The model features this capability needs, if any. */
  requiredModelFeatures: readonly string[];
  /** Application-authored instructions, loaded only when the capability runs. */
  loadInstructions?: () => Promise<string>;
  /**
   * The deterministic eligibility verdict. It must not depend on the input:
   * the dispatcher evaluates a capability before it knows what it will run.
   */
  evaluate: (context: CapabilityEvaluationContext) => Promise<Eligibility>;
  execute: (input: unknown, context: ExecutionContext) => Promise<Outcome<unknown>>;
}>;

/** The registry of explicitly registered capabilities. */
export interface CapabilityRegistry {
  register(capability: Capability): void;
  /** The newest registered version of a capability, or the exact one asked for. */
  get(id: string, version?: string): Capability | undefined;
  /** Every registered capability, ordered by id and then version. */
  list(): readonly Capability[];
}

/**
 * One background capability: a versioned unit of work the background runtime
 * may run.
 *
 * It is a smaller shape than the interactive {@link Capability}: the background
 * runtime has no tools and no dispatcher, so a capability only declares what
 * it reads, what it answers and how it asks. Its id comes from
 * {@link JOURNAL_CAPABILITY_IDS}, so the journal keeps one registry of
 * capability ids.
 */
export interface BackgroundCapability {
  readonly id: string;
  readonly version: string;
  /** The strict schema of the evidence the capability reads. */
  readonly inputSchema: z.ZodTypeAny;
  /** The strict schema of the answer the capability returns. */
  readonly outputSchema: z.ZodTypeAny;
  /** Builds the provider request for one validated evidence set. */
  readonly buildPrompt: (evidence: unknown) => {
    readonly system: string;
    readonly prompt: string;
  };
}

/**
 * The read-only journal operations the pure runtime may call.
 *
 * The runtime never reaches the database; a composition-supplied adapter
 * implements this port over the existing scoped queries.
 */
export interface JournalCapabilityPort {
  askContext(): Promise<unknown>;
  dailyRecap(date: string, existingNote: string | undefined): Promise<unknown>;
  tradeCritique(key: string): Promise<unknown>;
  playbookRules(key: string): Promise<unknown>;
  missedObservations(since: string, until: string | undefined): Promise<unknown>;
  notebookEntries(folderId: string | undefined, query: string | undefined): Promise<unknown>;
  progressHistory(weeks: number | undefined): Promise<unknown>;
}
