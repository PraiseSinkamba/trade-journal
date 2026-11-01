import { eq } from "drizzle-orm";
import { db, type JournalDb } from "@/db/connection";
import { accounts, domainOutbox, intelligenceJobs, tradeProjectionRevisions } from "@/db/schema";
import { withJournalTransaction, type JournalTx } from "@/db/transaction";
import { parseTradeChanged, type TradeChanged } from "@/server/domain-events";
import {
  aiProviderConfigured,
  getCurrentProviderConfiguration,
  getAiKey,
  getCompatibleBaseUrl,
} from "@/server/settings";
import { runBackgroundAi } from "@/server/ai-runtime";
import { AiRuntimeError } from "@/server/ai-contracts";
import {
  evaluateTradeProjection,
  tradeProjectionEvidenceSchema,
  type ObservationResult,
} from "./contracts/observations";
import type { JobRecord } from "./contracts/jobs";
import {
  BACKGROUND_DAILY_ATTEMPT_LIMIT,
  BACKGROUND_FAILURE,
  BACKGROUND_POLICY_ID,
  BACKGROUND_RUN_FAILURE,
  DEFAULT_BACKGROUND_POLICY,
  backgroundPolicyPatchSchema,
  endpointFingerprint,
  type BackgroundPolicy,
  type BackgroundPolicyPatch,
  type BackgroundPolicyView,
  type BackgroundRunOutput,
  type BackgroundRunRecord,
  type BackgroundScope,
} from "./contracts/policy";
import type { ExecutionContext, Outcome } from "./contracts/execution";
import { createBackfillService } from "./infrastructure/backfill";
import { createEffectStore, createJobStore, createReplayService } from "./infrastructure/jobs";
import { persistObservationInTx } from "./infrastructure/knowledge-store";
import { createOutboxDispatcher, type OutboxHandler } from "./infrastructure/outbox";
import {
  createPolicyStore,
  reserveBackgroundAttempt,
  type EnqueueRunInput,
} from "./infrastructure/policy-store";
import { evaluateBackgroundAuthorization } from "./runtime/model-policy";
import {
  createWorkerService,
  type JobHandler,
  type WorkerService,
  type WorkerStatus,
} from "./infrastructure/worker";

export type { WorkerHandle, WorkerStatus } from "./infrastructure/worker";

/** Consumer lifecycle and sanitized operational controls. */
export interface IntelligenceWorker extends WorkerService {
  tick(now: number): Promise<boolean>;
  status(): WorkerStatus;
  stop(): Promise<void>;
}

/**
 * The intelligence composition.
 *
 * This module wires historical discovery and committed trade changes into
 * durable observations. Services bind to the supplied journal connection;
 * handlers run inside the caller's transaction without provider access.
 */

/** The handler that subscribes to the outbox. */
export const OBSERVATION_HANDLER_ID = "trade-observation";

/** The version of that handler. */
export const OBSERVATION_HANDLER_VERSION = "1";

/**
 * Rebuilds the committed event from its outbox row.
 *
 * The stored payload holds only the event payload, so the envelope is
 * reassembled from the row and validated against the strict contract. A row
 * that does not describe a trade change never becomes an observation.
 */
const tradeChangedOf = (row: typeof domainOutbox.$inferSelect): TradeChanged =>
  parseTradeChanged({
    id: row.id,
    type: "trade.projection_changed",
    schemaVersion: row.schemaVersion,
    aggregate: {
      type: row.aggregateType,
      id: row.aggregateId,
      revision: row.aggregateRevision,
    },
    correlationId: row.correlationId,
    ...(row.causationId ? { causationId: row.causationId } : {}),
    origin: row.origin,
    recordedAt: new Date(row.recordedAt).toISOString(),
    ...(row.occurredAt !== null ? { occurredAt: new Date(row.occurredAt).toISOString() } : {}),
    payload: JSON.parse(row.payloadJson),
  });

/**
 * Creates the job handler that turns a committed trade change into a
 * persistent observation.
 */
export const createTradeObservationHandler = (deps?: {
  readonly clock?: () => number;
}): JobHandler => ({
  id: OBSERVATION_HANDLER_ID,
  version: OBSERVATION_HANDLER_VERSION,
  run: (tx: JournalTx, job: JobRecord): void => {
    if (job.payload.type !== "evaluate_trade") return;

    const now = deps?.clock?.() ?? Date.now();

    // The handler receives no claim, so the claim is rebuilt from the job row
    // inside the transaction. A job row that is gone authorises nothing.
    const jobRow = tx
      .select({
        id: intelligenceJobs.id,
        owner: intelligenceJobs.owner,
        fence: intelligenceJobs.fence,
        leaseUntil: intelligenceJobs.leaseUntil,
      })
      .from(intelligenceJobs)
      .where(eq(intelligenceJobs.id, job.id))
      .get();
    if (!jobRow) return;
    const claim = {
      jobId: jobRow.id,
      owner: jobRow.owner ?? "",
      fence: jobRow.fence,
      leaseUntil: jobRow.leaseUntil ?? 0,
    };

    const row = tx
      .select()
      .from(domainOutbox)
      .where(eq(domainOutbox.id, job.payload.eventId))
      .get();
    if (!row) return;

    const event = tradeChangedOf(row);

    let result: ObservationResult;
    if (event.payload.kind === "removed") {
      // The removal invalidates the observation of that trade; it observes
      // nothing new.
      result = { kind: "insufficient_evidence", reason: "source_removed" };
    } else {
      const revision = tx
        .select()
        .from(tradeProjectionRevisions)
        .where(eq(tradeProjectionRevisions.id, event.payload.projectionRevisionId))
        .get();
      if (!revision) {
        result = { kind: "insufficient_evidence", reason: "source_removed" };
      } else {
        // The evidence comes from the immutable revision and its snapshot,
        // never from whatever the trade happens to be now.
        const snapshot = JSON.parse(revision.snapshotJson) as Record<string, unknown>;
        const evidence = tradeProjectionEvidenceSchema.parse({
          revisionId: revision.id,
          tradeId: revision.tradeId,
          revision: revision.revision,
          accountId: revision.accountId,
          tradeKey: revision.tradeKey,
          currency: snapshot.currency,
          status: snapshot.status,
          netPnl: snapshot.netPnl,
          fees: snapshot.fees,
          openQuantity: snapshot.openQuantity,
          openedAt: snapshot.openedAt,
          closedAt: snapshot.closedAt ?? null,
          timingQuality: snapshot.timingQuality,
          durationMs: snapshot.durationMs ?? null,
          identityResolution: revision.resolution,
        });
        result = evaluateTradeProjection(evidence);
      }
    }

    persistObservationInTx(tx, claim, event, result, now);
  },
});

/** Binds historical seed, replay and observation handlers to one journal. */
export const createIntelligenceServices = (deps: {
  readonly db: JournalDb;
  readonly clock?: () => number;
  readonly seedBatchSize?: number;
}) => {
  const clock = deps.clock ?? Date.now;
  const jobs = createJobStore(deps.db);
  const backfill = createBackfillService({
    db: deps.db,
    jobs,
    clock,
    batchSize: deps.seedBatchSize,
  });
  const seedHandler: JobHandler = {
    id: "seed-account",
    version: "1",
    run: (tx, job): void => {
      if (job.payload.type !== "seed_account") return;
      backfill.seedAccountInTx(tx, job.payload.accountId, job.id);
    },
  };
  const handlers: readonly JobHandler[] = [createTradeObservationHandler({ clock }), seedHandler];
  const outboxHandlers: readonly OutboxHandler[] = [
    { id: OBSERVATION_HANDLER_ID, version: OBSERVATION_HANDLER_VERSION },
  ];
  const replay = createReplayService({ db: deps.db, jobs, handlers: outboxHandlers, clock });
  return {
    seedAccount: backfill.seedAccount,
    requestReplay: replay.requestReplay,
    handlers,
    outboxHandlers,
  };
};

/** Wires an independent consumer without starting it or changing lease policy. */
export const createIntelligenceWorker = (deps: {
  readonly db: JournalDb;
  readonly clock?: () => number;
  readonly enabled?: boolean;
  readonly owner?: string;
}): IntelligenceWorker => {
  const clock = deps.clock ?? Date.now;
  const services = createIntelligenceServices({ db: deps.db, clock });
  const jobs = createJobStore(deps.db);
  return createWorkerService({
    db: deps.db,
    clock,
    enabled: deps.enabled,
    owner: deps.owner,
    jobs,
    effects: createEffectStore(),
    dispatcher: createOutboxDispatcher({
      db: deps.db,
      jobs,
      handlers: services.outboxHandlers,
    }),
    handlers: services.handlers,
  });
};

const defaultServices = createIntelligenceServices({ db });

/** Seeds one bounded historical batch on the default journal. */
export const seedAccount = defaultServices.seedAccount;

/** Requests durable replay on the default journal. */
export const requestReplay = defaultServices.requestReplay;

/** Every handler registered with the default worker. */
export const observationHandlers: readonly JobHandler[] = defaultServices.handlers;

/** Only observations subscribe to committed trade-change events. */
export const observationOutboxHandlers: readonly OutboxHandler[] = defaultServices.outboxHandlers;

/**
 * The background policy service (Phase 13).
 *
 * It is the only place that binds the background policy, the run ledger, the
 * daily reservation and the provider adapter together. Everything it refuses,
 * it refuses before a provider request is made.
 */

const backgroundStore = createPolicyStore({ db });

/** The account ids that still exist in the journal. */
const existingAccountIds = (): string[] =>
  db.select({ id: accounts.id }).from(accounts).all().map((row) => row.id);

/** The policy as the settings surface sees it. */
export const getBackgroundPolicy = (): BackgroundPolicyView => {
  const stored = backgroundStore.readPolicy(BACKGROUND_POLICY_ID);
  const settings = stored?.settings ?? DEFAULT_BACKGROUND_POLICY;
  return {
    enabled: settings.enabled,
    accounts: [...settings.accounts],
    capabilities: { ...settings.capabilities },
    maxInputCharacters: settings.maxInputCharacters,
    revision: stored?.revision ?? 0,
  };
};

/**
 * Records a new policy revision.
 *
 * Every write is a new revision: a queued run is pinned to the revision it
 * was approved under, so a policy change never applies to a run retroactively.
 *
 * An account that no longer exists is dropped rather than refused: the
 * operator deleted it, and a stale reference must not lock the settings
 * surface out of saving.
 */
export const saveBackgroundPolicy = (patch: BackgroundPolicyPatch): BackgroundPolicyView => {
  const current = getBackgroundPolicy();
  const known = existingAccountIds();
  const accounts = (patch.accounts ?? current.accounts).filter((id) => known.includes(id));
  const settings: BackgroundPolicy = {
    schemaVersion: 1,
    enabled: patch.enabled ?? current.enabled,
    accounts: [...accounts],
    capabilities: {
      tools: patch.capabilities?.tools ?? current.capabilities.tools,
      structuredOutput:
        patch.capabilities?.structuredOutput ?? current.capabilities.structuredOutput,
    },
    maxInputCharacters: patch.maxInputCharacters ?? current.maxInputCharacters,
  };
  withJournalTransaction((tx) =>
    backgroundStore.writePolicyInTx(tx, BACKGROUND_POLICY_ID, settings, Date.now()),
  );
  return getBackgroundPolicy();
};

/**
 * Queues a background run against the current configuration.
 *
 * The run pins the provider, the model and the fingerprint of the endpoint it
 * was queued against, so a later configuration change cannot reroute it.
 */
export const enqueueBackgroundRun = (input: {
  effectKey: string;
  scope: BackgroundScope;
  meta?: Record<string, unknown>;
}): string => {
  const configuration = getCurrentProviderConfiguration();
  const policy = backgroundStore.readPolicy(BACKGROUND_POLICY_ID);
  const run = withJournalTransaction((tx) =>
    backgroundStore.enqueueRunInTx(
      tx,
      {
        effectKey: input.effectKey,
        provider: configuration.provider,
        model: configuration.modelId,
        endpointFingerprint: endpointFingerprint(
          configuration.provider,
          configuration.modelId,
          configuration.baseUrl,
        ),
        policyRevision: policy?.revision ?? 0,
        scope: input.scope,
        meta: input.meta,
      },
      Date.now(),
    ),
  );
  return run.id;
};

/**
 * Re-authorises a queued run against the current configuration.
 *
 * The decision is the same one the pure policy makes, plus the daily
 * allowance: a run whose day is already spent is refused before any attempt
 * is reserved.
 *
 * A refusal that will not change on its own — the configuration changed, or
 * the policy was revised — is recorded on the run, so the run stays
 * unavailable until it is explicitly rescheduled.
 */
export const authorizeBackgroundRun = (
  runId: string,
  now: number,
  signal: AbortSignal,
): Outcome<ExecutionContext> => {
  const run = backgroundStore.readRun(runId);
  const policy = backgroundStore.readPolicy(BACKGROUND_POLICY_ID);
  const configuration = getCurrentProviderConfiguration();
  const decision = evaluateBackgroundAuthorization({
    run,
    policy: policy?.settings ?? null,
    policyInvalid: policy?.invalid ?? false,
    currentRevision: policy?.revision ?? 0,
    current: {
      provider: configuration.provider,
      model: configuration.modelId,
      baseUrl: configuration.baseUrl,
    },
    existingAccountIds: existingAccountIds(),
    signal,
  });
  if (decision.status === "unavailable" && run && decision.reason !== "daily_budget_exhausted") {
    const terminal =
      decision.reason === "configuration_changed" || decision.reason === "policy_changed";
    if (terminal)
      withJournalTransaction((tx) => {
        backgroundStore.updateRunStatusInTx(tx, runId, "unavailable", now);
        backgroundStore.updateRunMetaInTx(tx, runId, { refusalReason: decision.reason }, now);
      });
  }
  if (decision.status !== "completed") return decision;
  if (backgroundStore.attemptsReservedOnDay(now) >= BACKGROUND_DAILY_ATTEMPT_LIMIT)
    return { status: "unavailable", reason: BACKGROUND_RUN_FAILURE.dailyBudgetExhausted };
  return decision;
};

/**
 * Reserves one attempt of the daily background allowance.
 *
 * The reservation is taken in the caller's transaction and commits before any
 * provider request: a crashed attempt keeps its reservation, so a fresh retry
 * spends another allowance.
 */
export { reserveBackgroundAttempt };

/**
 * Executes one background run against its pinned provider.
 *
 * The order is fixed: authorise, reserve, then call the provider. The
 * reservation is committed before the request, the provider is the one the
 * run was approved against, and the caller's abort signal stops the request.
 */
export const executeBackgroundRun = async (input: {
  runId: string;
  system: string;
  prompt: string;
  signal: AbortSignal;
  now?: number;
}): Promise<Outcome<BackgroundRunOutput>> => {
  const now = input.now ?? Date.now();
  const authorization = authorizeBackgroundRun(input.runId, now, input.signal);
  if (authorization.status !== "completed")
    return { status: authorization.status, reason: authorization.reason };
  const run = backgroundStore.readRun(input.runId);
  if (!run) return { status: "failed", reason: BACKGROUND_FAILURE.runNotFound };
  // The provider, the model and the endpoint are the ones the run was approved
  // against. The fingerprint is checked again here, so a configuration change
  // between the authorisation and the request cannot reroute the request.
  const configuration = getCurrentProviderConfiguration();
  if (
    endpointFingerprint(configuration.provider, configuration.modelId, configuration.baseUrl) !==
    run.endpointFingerprint
  )
    return { status: "unavailable", reason: BACKGROUND_FAILURE.configurationChanged };
  // A hosted provider without a key, or a compatible server without its URL,
  // never reaches the provider: the run is unavailable before any request.
  if (!aiProviderConfigured(run.provider))
    return { status: "unavailable", reason: BACKGROUND_RUN_FAILURE.providerNotConfigured };
  const reserved = withJournalTransaction((tx) =>
    reserveBackgroundAttempt(tx, input.runId, now),
  );
  if (!reserved)
    return { status: "unavailable", reason: BACKGROUND_RUN_FAILURE.dailyBudgetExhausted };
  withJournalTransaction((tx) =>
    backgroundStore.updateRunStatusInTx(tx, input.runId, "running", now),
  );
  const meta: Record<string, unknown> = {
    provider: run.provider,
    model: run.model,
    attempts: backgroundStore.reservationsForRun(input.runId).length,
  };
  try {
    const result = await runBackgroundAi({
      configuration: {
        provider: run.provider,
        modelId: run.model,
        apiKey: getAiKey(run.provider),
        baseUrl: run.provider === "compatible" ? configuration.baseUrl : null,
      },
      promptVersion: "background-v1",
      system: input.system,
      prompt: input.prompt,
      abortSignal: input.signal,
    });
    Object.assign(meta, {
      durationMs: result.meta.durationMs,
      finishReason: result.meta.finishReason,
      inputTokens: result.meta.inputTokens,
      outputTokens: result.meta.outputTokens,
    });
    withJournalTransaction((tx) => {
      backgroundStore.updateRunStatusInTx(tx, input.runId, "completed", Date.now());
      backgroundStore.updateRunMetaInTx(tx, input.runId, meta, Date.now());
    });
    return {
      status: "completed",
      value: { runId: input.runId, status: "completed", output: result.output, meta },
    };
  } catch (error) {
    const cancelled = input.signal.aborted;
    // A cancelled run is a cancellation, not a provider timeout.
    const kind = cancelled
      ? "cancelled"
      : error instanceof AiRuntimeError
        ? error.kind
        : "provider";
    Object.assign(meta, { errorKind: kind });
    withJournalTransaction((tx) => {
      backgroundStore.updateRunStatusInTx(
        tx,
        input.runId,
        cancelled ? "cancelled" : "failed",
        Date.now(),
      );
      backgroundStore.updateRunMetaInTx(tx, input.runId, meta, Date.now());
    });
    return { status: cancelled ? "cancelled" : "failed", reason: kind };
  }
};
