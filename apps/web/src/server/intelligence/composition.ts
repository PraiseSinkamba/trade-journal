import { and, eq, inArray, like } from "drizzle-orm";
import { db, type JournalDb } from "@/db/connection";
import {
  accounts,
  domainOutbox,
  intelligenceJobs,
  intelligenceObservations,
  intelligenceOpportunities,
  observationEvidence,
  tradeProjectionRevisions,
} from "@/db/schema";
import {
  withConnectionTransaction,
  withJournalTransaction,
  type JournalTx,
} from "@/db/transaction";
import { parseTradeChanged, type SourceChange, type TradeChanged } from "@/server/domain-events";
import {
  aiProviderConfigured,
  getCurrentProviderConfiguration,
  getAiKey,
  getCompatibleBaseUrl,
  getIntelligenceControls,
  getIntelligenceControlsInTx,
  getTimeZone,
  getTimeZoneInTx,
} from "@/server/settings";
import { newUuid } from "@/server/ids";
import { runBackgroundAi } from "@/server/ai-runtime";
import { AiRuntimeError } from "@/server/ai-contracts";
import {
  OBSERVATION_EVALUATOR_ID,
  OBSERVATION_EVALUATOR_VERSION,
  OBSERVATION_TYPE,
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
import { createExperienceStore } from "./infrastructure/experience-store";
import { createWorkflowEngine } from "./experience/workflows";
import { createEngagementCoordinator } from "./experience/interactions";
import { createCommandService } from "./experience/commands";
import { createExecutionContext } from "./runtime/execution";
import { ENGAGEMENT_DEFAULTS, type RunInTransaction } from "./contracts/experience";
import {
  buildOpportunityRequest,
  type ProducerControls,
  type ProducerObservation,
} from "./experience/producer";
import { persistObservationInTx } from "./infrastructure/knowledge-store";
import { applySourceChange, nextSourceRevision } from "./infrastructure/knowledge-revisions";
import { createOutboxDispatcher, type OutboxHandler } from "./infrastructure/outbox";
import { createBackgroundEnvironmentReader } from "./infrastructure/environment";
import { createReviewQuestionTransport } from "./infrastructure/review-transport";
import {
  createInsightStore,
  createObservationEvidenceReader,
  createReviewOpportunityReader,
} from "./infrastructure/insight-store";
import { createCapabilityJobHandler } from "./runtime/capability-job";
import { createReviewInsightCapability } from "./runtime/review-insight";
import {
  buildReviewQuestionPrompt,
  REVIEW_QUESTION_SYSTEM_PROMPT,
} from "@/server/ai-review-insight";
import {
  createReviewQuestionEnqueuer,
  type ReviewQuestionEnqueuer,
} from "./runtime/review-enqueue";
import type { ReviewQuestionTransport } from "./contracts/insights";
import {
  createScheduleHandler,
  createScheduler,
  type ScheduleDefinition,
} from "./infrastructure/scheduler";
import {
  createPolicyStore,
  reserveBackgroundAttempt,
  type EnqueueRunInput,
} from "./infrastructure/policy-store";
import { evaluateBackgroundAuthorization } from "./runtime/model-policy";
import {
  KNOWLEDGE_RETENTION_WINDOW_MS,
  RETENTION_PRUNE_LIMIT,
  pruneIntelligenceInTx,
  pruneSupersededKnowledgeInTx,
} from "./infrastructure/retention";
import {
  createWorkerService,
  RETENTION_HANDLER_ID,
  RETENTION_HANDLER_VERSION,
  UNHANDLED_CAPABILITY,
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
  /**
   * The enqueue of the review question, bound to the same transaction.
   *
   * It is absent in the paths that only observe: the deterministic review
   * stays available, and no provider request is ever made for it.
   */
  readonly review?: ReviewQuestionEnqueuer;
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

    // The observation is read back inside the same transaction, so the
    // opportunity rests on the row the journal actually stored: a repeated
    // delivery resolves to the same row, and therefore to the same dedup key.
    if (result.kind !== "trade_projection") return;
    const stored = tx
      .select({
        id: intelligenceObservations.id,
        subjectId: intelligenceObservations.subjectId,
        accountId: intelligenceObservations.accountId,
        status: intelligenceObservations.status,
      })
      .from(intelligenceObservations)
      .where(
        and(
          eq(intelligenceObservations.subjectId, event.aggregate.id),
          eq(intelligenceObservations.sourceRevision, result.evidence.revisionId),
          eq(intelligenceObservations.evaluatorId, OBSERVATION_EVALUATOR_ID),
          eq(intelligenceObservations.evaluatorVersion, OBSERVATION_EVALUATOR_VERSION),
          eq(intelligenceObservations.type, OBSERVATION_TYPE),
        ),
      )
      .get();
    if (!stored) return;
    const evidenceRevisions = tx
      .select({ revisionId: observationEvidence.revisionId })
      .from(observationEvidence)
      .where(eq(observationEvidence.observationId, stored.id))
      .all()
      .map((link) => link.revisionId);
    produceOpportunityInTx(
      tx,
      {
        id: stored.id,
        subjectId: stored.subjectId,
        accountId: stored.accountId,
        status: stored.status,
        evidenceRevisions,
      },
      getIntelligenceControlsInTx(tx),
      now,
    );
    // The review question is queued in the same transaction as the
    // observation and its opportunity: a rollback leaves neither a run nor a
    // job behind, and a repeated delivery reuses the same business key.
    deps?.review?.enqueueInTx(tx, {
      observationId: stored.id,
      mode: event.payload.mode,
      timeZone: getTimeZoneInTx(tx),
    });
  },
});

/** Binds historical seed, replay and observation handlers to one journal. */
export const createIntelligenceServices = (deps: {
  readonly db: JournalDb;
  readonly clock?: () => number;
  readonly seedBatchSize?: number;
  /** The schedules the durable scheduler drives. */
  readonly schedules?: readonly ScheduleDefinition[];
  /**
   * The transport the review question is asked through.
   *
   * It is the real provider transport by default and an injected one in the
   * tests, so the tests drive the production registration with a stub
   * provider.
   */
  readonly transport?: ReviewQuestionTransport;
}) => {
  const clock = deps.clock ?? Date.now;
  const jobs = createJobStore(deps.db);
  // The run ledger of this journal: the run, the policy and the attempts.
  const runs = createPolicyStore({ db: deps.db });
  const capability = createReviewInsightCapability({
    system: REVIEW_QUESTION_SYSTEM_PROMPT,
    build: buildReviewQuestionPrompt,
  });
  const transport = deps.transport ?? createReviewQuestionTransport();
  const environment = createBackgroundEnvironmentReader();
  const observations = createObservationEvidenceReader();
  const opportunities = createReviewOpportunityReader();
  // The handler of the capability job: the slow half asks the provider, the
  // fast half writes the question.
  const capabilityHandler = createCapabilityJobHandler({
    capability,
    runs,
    insights: createInsightStore(),
    observations,
    opportunities,
    transport,
    environment,
    clock,
  });
  // The enqueue of the review question, bound to the transaction that
  // persists the observation and raises its opportunity.
  const review = createReviewQuestionEnqueuer({
    capability,
    runs,
    jobs,
    observations,
    opportunities,
    environment,
    clock,
  });
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
  // The retention run: the transport and the diagnostics class at the cutoff
  // the payload names, and the knowledge class at its own, longer window. The
  // whole run stays inside one bound.
  const retentionHandler: JobHandler = {
    id: RETENTION_HANDLER_ID,
    version: RETENTION_HANDLER_VERSION,
    run: (tx, job): void => {
      if (job.payload.type !== "retention") return;
      const removed = pruneIntelligenceInTx(tx, job.payload.before, RETENTION_PRUNE_LIMIT);
      pruneSupersededKnowledgeInTx(
        tx,
        clock() - KNOWLEDGE_RETENTION_WINDOW_MS,
        RETENTION_PRUNE_LIMIT - removed.removed,
      );
    },
  };
  const handlers: readonly JobHandler[] = [
    createTradeObservationHandler({ clock, review }),
    seedHandler,
  ];
  const outboxHandlers: readonly OutboxHandler[] = [
    { id: OBSERVATION_HANDLER_ID, version: OBSERVATION_HANDLER_VERSION },
  ];
  const replay = createReplayService({ db: deps.db, jobs, handlers: outboxHandlers, clock });
  const schedules = deps.schedules ?? [];
  const scheduler = createScheduler({ db: deps.db, jobs, definitions: schedules });
  const scheduleHandler = createScheduleHandler({ definitions: schedules, clock });
  // The workflow engine of this journal: the deferred workflow resumes
  // through its effect handler, on the journal this worker serves.
  const workflows = createWorkflowEngine({
    runInTransaction: <T>(fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T): T =>
      withConnectionTransaction(deps.db, fn) as T,
    jobs,
    store: createExperienceStore(),
    clock,
  });
  return {
    seedAccount: backfill.seedAccount,
    requestReplay: replay.requestReplay,
    handlers: [...handlers, scheduleHandler, retentionHandler, workflows.effectHandler()],
    outboxHandlers,
    scheduler,
    workflows,
    /** The handler of the capability job, bound to this journal. */
    capabilityHandler,
  };
};

/** Wires an independent consumer without starting it or changing lease policy. */
export const createIntelligenceWorker = (deps: {
  readonly db: JournalDb;
  readonly clock?: () => number;
  readonly enabled?: boolean;
  readonly owner?: string;
  readonly schedules?: readonly ScheduleDefinition[];
  /**
   * The transport the review question is asked through.
   *
   * It is the real provider transport by default and an injected one in the
   * tests, so the tests drive the production registration with a stub
   * provider.
   */
  readonly transport?: ReviewQuestionTransport;
}): IntelligenceWorker => {
  const clock = deps.clock ?? Date.now;
  const services = createIntelligenceServices({
    db: deps.db,
    clock,
    schedules: deps.schedules,
    transport: deps.transport,
  });
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
    asyncHandlers: [services.capabilityHandler],
    scheduler: services.scheduler,
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
export const existingAccountIds = (): string[] =>
  db
    .select({ id: accounts.id })
    .from(accounts)
    .all()
    .map((row) => row.id);

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
 *
 * The legacy path has no production caller: the only caller in the
 * repository is the existing provider-policy test, so the function is
 * retained for that test alone. The guard below is what keeps a
 * capability-job run out of it: such a run belongs to the capability job,
 * which finishes it in a fenced final transaction, and it must never be
 * completed by a bare provider response.
 */
export const executeBackgroundRun = async (input: {
  runId: string;
  system: string;
  prompt: string;
  signal: AbortSignal;
  now?: number;
}): Promise<Outcome<BackgroundRunOutput>> => {
  const now = input.now ?? Date.now();
  // A capability job's run carries the capability it was queued for
  // (`runtime/review-enqueue.ts` writes `meta.capabilityId`). This path
  // handles no capability at all, so it refuses the run before it reserves
  // an attempt and before it reaches a provider, and it never marks such a
  // run completed.
  const run = backgroundStore.readRun(input.runId);
  if (run && typeof run.meta.capabilityId === "string")
    return { status: "failed", reason: UNHANDLED_CAPABILITY };
  const authorization = authorizeBackgroundRun(input.runId, now, input.signal);
  if (authorization.status !== "completed")
    return { status: authorization.status, reason: authorization.reason };
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
  const reserved = withJournalTransaction((tx) => reserveBackgroundAttempt(tx, input.runId, now));
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

/**
 * The source-revision service (Phase 14).
 *
 * A user-authored source changes in one transaction: the write itself and the
 * source revision that describes it. `recordSourceChanges` allocates the
 * knowledge revision of the source inside that transaction, so two concurrent
 * writers cannot allocate the same one, and it applies the revision through
 * the same adapter the rest of the intelligence runtime uses.
 */
/** A source change without its revision: the caller does not choose it. */
export type SourceChangeRequest = SourceChange extends infer T
  ? T extends SourceChange
    ? Omit<T, "revision">
    : never
  : never;

/** The source change with the revision the transaction allocated. */
const withRevision = (change: SourceChangeRequest, revision: number): SourceChange =>
  change.accountId === null
    ? {
        kind: change.kind,
        action: change.action,
        sourceId: change.sourceId,
        accountId: null,
        revision,
        correlationId: change.correlationId,
      }
    : {
        kind: change.kind,
        action: change.action,
        sourceId: change.sourceId,
        accountId: change.accountId,
        revision,
        correlationId: change.correlationId,
      };

/**
 * Runs a source write and records its source revisions, atomically.
 *
 * The write callback reads what it needs inside the transaction and returns
 * the revisions it caused, so a write that changes nothing returns no
 * revision. The write and its revisions commit together or not at all: a
 * rolled-back write leaves no revision and invalidates no knowledge.
 */
export const recordSourceChanges = (
  write: (tx: JournalTx) => readonly SourceChangeRequest[],
): void =>
  withJournalTransaction((tx) => {
    for (const change of write(tx)) {
      applySourceChange(
        tx,
        withRevision(change, nextSourceRevision(tx, change.kind, change.sourceId)),
      );
    }
  });

export { applySourceChange };
export type { SourceChange };

/**
 * The interaction services (Phase 18).
 *
 * The wiring point of the operator-facing surface: the workflow engine, the
 * engagement coordinator, the stores they share and the command service the
 * interaction routes call. The routes import composition; composition never
 * imports a route.
 *
 * Only composition builds an execution context, and only an interactive one
 * for an interactive request: the principal is the operator, the scope is
 * the resolved one, and the budget is small.
 */

/** The experience store on the default journal. */
export const experienceStore = createExperienceStore();

/** The job store on the default journal. */
export const jobStore = createJobStore(db);

/** The workflow engine on the default journal. */
export const workflowEngine = defaultServices.workflows;

/** The engagement coordinator on the default journal. */
export const engagementCoordinator = createEngagementCoordinator({
  runInTransaction: withJournalTransaction,
  store: experienceStore,
});

/**
 * Raises the opportunity of one persisted observation, in the caller's transaction.
 *
 * The engagement runs on the transaction the caller already owns: the worker
 * holds the write lock on its own connection, so a second connection would
 * deadlock the journal instead of committing the observation and its
 * opportunity together.
 */
export const produceOpportunityInTx = (
  tx: JournalTx,
  observation: ProducerObservation,
  controls: ProducerControls,
  now: number,
): void => {
  const outcome = buildOpportunityRequest({ observation, controls, now });
  if (outcome.kind !== "produced") return;
  const runOnAmbientTransaction: RunInTransaction = <T>(
    fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T,
  ): T => {
    const result: unknown = fn(tx);
    return result as T;
  };
  const coordinator = createEngagementCoordinator({
    runInTransaction: runOnAmbientTransaction,
    store: experienceStore,
    clock: () => now,
  });
  coordinator.engage(outcome.request);
};

/**
 * Raises the opportunities of the observations the journal already holds.
 *
 * The consent path: when the operator grants the opt-in or resumes the
 * journal, the insights it noticed become visible at once. Every engagement
 * runs in its own transaction, so one refused opportunity never holds the
 * rest back.
 *
 * Answers how many opportunities this raised: a re-engagement of an
 * opportunity the journal already holds raises nothing new, so it is not
 * counted again.
 */
export const produceOpportunitiesForActiveObservations = (): number => {
  const controls = getIntelligenceControls();
  const now = Date.now();
  const observations = db
    .select({
      id: intelligenceObservations.id,
      subjectId: intelligenceObservations.subjectId,
      accountId: intelligenceObservations.accountId,
      status: intelligenceObservations.status,
    })
    .from(intelligenceObservations)
    .where(eq(intelligenceObservations.status, "active"))
    .all();
  if (observations.length === 0) return 0;
  const scope = observations.map((observation) => observation.id);
  // Only the links of the observations in scope are read: the whole
  // evidence table would be loaded and filtered here for nothing.
  const links = db
    .select({
      observationId: observationEvidence.observationId,
      revisionId: observationEvidence.revisionId,
    })
    .from(observationEvidence)
    .where(inArray(observationEvidence.observationId, scope))
    .all();
  const evidenceByObservation = new Map<string, string[]>();
  for (const link of links) {
    const revisions = evidenceByObservation.get(link.observationId) ?? [];
    revisions.push(link.revisionId);
    evidenceByObservation.set(link.observationId, revisions);
  }
  // The opportunities the journal already holds for these observations: an
  // engagement of one of them raises nothing new.
  const known = new Set(
    db
      .select({ id: intelligenceOpportunities.id })
      .from(intelligenceOpportunities)
      .where(
        and(
          inArray(intelligenceOpportunities.subjectId, scope),
          like(intelligenceOpportunities.dedupKey, "opportunity/%"),
        ),
      )
      .all()
      .map((row) => row.id),
  );
  let raised = 0;
  for (const observation of observations) {
    const outcome = buildOpportunityRequest({
      observation: {
        ...observation,
        evidenceRevisions: evidenceByObservation.get(observation.id) ?? [],
      },
      controls,
      now,
    });
    if (outcome.kind !== "produced") continue;
    const engagement = engagementCoordinator.engage(outcome.request);
    // A suppressed engagement raised nothing: the operator dismissed it.
    if (engagement.decision.outcome === "suppress") continue;
    // A re-engagement raised nothing new either: the journal already holds
    // this opportunity.
    if (known.has(engagement.opportunity.id)) continue;
    known.add(engagement.opportunity.id);
    raised += 1;
  }
  return raised;
};

/**
 * The execution context of one interactive request.
 *
 * The scope is the one the request resolved; an empty scope means every
 * account, which only an interactive request may say.
 */
export const interactiveExecutionContext = (accountIds: readonly string[]): ExecutionContext =>
  createExecutionContext({
    executionId: `exec-interactive-${newUuid()}`,
    correlationId: `corr-interactive-${newUuid()}`,
    principal: "interactive",
    mode: "interactive",
    triggerSource: "user.command",
    scope: {
      accountIds: [...accountIds],
      filters: {},
      timeZone: getTimeZone(),
      dataSources: ["trades"],
    },
    allowedCapabilityIds: [],
    allowedToolIds: [],
    budgets: {
      maxSteps: 4,
      maxToolCalls: 4,
      maxOutputTokens: 512,
      consumeToolCall: () => true,
    },
    signal: new AbortController().signal,
  });

/** The command service the interaction routes apply their commands through. */
export const interactionCommands = createCommandService({
  engine: workflowEngine,
  store: experienceStore,
  runInTransaction: withJournalTransaction,
  accountIds: existingAccountIds,
  context: interactiveExecutionContext,
});

/** The engagement defaults the status surface serves. */
export { ENGAGEMENT_DEFAULTS };

/** The intent builders the interaction routes build their intents with. */
export { observationReviewIntent, statusIntent, inputRequestIntent } from "./experience/intents";
