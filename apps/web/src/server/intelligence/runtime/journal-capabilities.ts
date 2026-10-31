import { z } from "zod";
import {
  JOURNAL_CAPABILITY_IDS,
  type Capability,
  type CapabilityEvaluationContext,
  type JournalCapabilityPort,
} from "../contracts/capabilities";
import {
  allowsDataSource,
  approvedScopeSchema,
  type DataSource,
  type Outcome,
} from "../contracts/execution";

/**
 * The registered journal capabilities (Phase 12).
 *
 * Each capability is a deterministic, scoped read over the journal. The
 * runtime never touches the database: the operations arrive through the
 * query port a composition supplies.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const scopeContextSchema = z
  .object({
    scopeContext: z.string(),
    accountContext: z.string(),
    metricsLine: z.string(),
    tradeLines: z.string(),
    existingNote: z.string().optional(),
  })
  .strict();

const tradeCritiqueSchema = z
  .object({
    trade: z
      .object({
        symbol: z.string(),
        direction: z.string(),
        status: z.string(),
        netPnl: z.number(),
        grossPnl: z.number(),
        fees: z.number(),
        avgEntry: z.number(),
        avgExit: z.number().nullable(),
        stopLoss: z.number().nullable(),
        profitTarget: z.number().nullable(),
        rating: z.number().nullable(),
        tags: z.array(z.string()),
        mistakes: z.array(z.string()),
        notes: z.string().nullable(),
      })
      .strict(),
    fills: z.array(z.string()),
  })
  .strict();

const notAllowed = (required: DataSource) => ({
  status: "ineligible" as const,
  reason: `The execution scope does not include ${required} data.`,
});

const errorResultSchema = z.object({ error: z.string() }).passthrough();

/** Map a port result onto an outcome; a missing result is missing evidence. */
const toOutcome = (result: unknown): Outcome<unknown> => {
  if (result === undefined) return { status: "insufficient_evidence", reason: "no_data" };
  const failed = errorResultSchema.safeParse(result);
  if (failed.success) return { status: "unavailable", reason: failed.data.error };
  return { status: "completed", value: result };
};

/**
 * Build the registered capabilities over one query port.
 *
 * The port is bound to one approved scope by the composition, so a capability
 * can never widen the scope of the execution it runs under.
 */
export function createJournalCapabilities(port: JournalCapabilityPort): readonly Capability[] {
  const capability = <TInput>(definition: {
    id: string;
    required: DataSource;
    inputSchema: z.ZodType<TInput>;
    outputSchema: z.ZodTypeAny;
    instructions: string;
    run: (input: TInput) => Promise<unknown>;
  }): Capability => ({
    id: definition.id,
    version: "1",
    mode: "deterministic",
    triggers: ["user.request"],
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    toolIds: [],
    dependencyIds: [],
    requiredModelFeatures: [],
    loadInstructions: async () => definition.instructions,
    evaluate: async ({ execution }: CapabilityEvaluationContext) =>
      allowsDataSource(execution.scope.dataSources, definition.required)
        ? { status: "eligible" }
        : notAllowed(definition.required),
    execute: async (input: unknown) => {
      const parsed = definition.inputSchema.safeParse(input);
      if (!parsed.success) return { status: "failed", reason: "invalid_input" };
      return toOutcome(await definition.run(parsed.data));
    },
  });

  return [
    capability({
      id: JOURNAL_CAPABILITY_IDS.askContext,
      required: "trades",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ context: z.string(), scope: approvedScopeSchema }).strict(),
      instructions:
        "Answer only from the returned journal scope context. Never infer results for excluded accounts or dates.",
      run: async () => port.askContext(),
    }),
    capability({
      id: JOURNAL_CAPABILITY_IDS.dailyRecap,
      required: "trades",
      inputSchema: z.object({ date: isoDate, existingNote: z.string().optional() }).strict(),
      outputSchema: z.object({ context: scopeContextSchema, date: z.string() }).strict(),
      instructions: "Summarise the day from the returned context only.",
      run: async (input: { date: string; existingNote?: string }) =>
        port.dailyRecap(input.date, input.existingNote),
    }),
    capability({
      id: JOURNAL_CAPABILITY_IDS.tradeCritique,
      required: "trades",
      inputSchema: z.object({ key: z.string().min(1).max(300) }).strict(),
      outputSchema: tradeCritiqueSchema,
      instructions: "Critique the trade from the returned facts only.",
      run: async (input: { key: string }) => port.tradeCritique(input.key),
    }),
    capability({
      id: JOURNAL_CAPABILITY_IDS.playbookRules,
      required: "trades+playbooks",
      inputSchema: z.object({ key: z.string().min(1).max(300) }).strict(),
      outputSchema: z.object({ context: z.string() }).strict(),
      instructions: "Report the recorded playbook rule checks only.",
      run: async (input: { key: string }) => port.playbookRules(input.key),
    }),
    capability({
      id: JOURNAL_CAPABILITY_IDS.missedObservations,
      required: "trades+missed",
      inputSchema: z.object({ since: isoDate, until: isoDate.optional() }).strict(),
      outputSchema: z.object({ context: z.string() }).strict(),
      instructions: "Report the archived missed-trade observations only.",
      run: async (input: { since: string; until?: string }) =>
        port.missedObservations(input.since, input.until),
    }),
    capability({
      id: JOURNAL_CAPABILITY_IDS.notebookEntries,
      required: "trades+notes",
      inputSchema: z
        .object({ folderId: z.string().optional(), query: z.string().optional() })
        .strict(),
      outputSchema: z.object({ context: z.string() }).strict(),
      instructions: "Quote the returned notebook entries only.",
      run: async (input: { folderId?: string; query?: string }) =>
        port.notebookEntries(input.folderId, input.query),
    }),
    capability({
      id: JOURNAL_CAPABILITY_IDS.progressHistory,
      required: "trades+progress",
      inputSchema: z.object({ weeks: z.number().int().positive().max(104).optional() }).strict(),
      outputSchema: z.object({ context: z.string(), scope: approvedScopeSchema }).strict(),
      instructions: "Report the recorded routine hit rates only.",
      run: async (input: { weeks?: number }) => port.progressHistory(input.weeks),
    }),
  ];
}
