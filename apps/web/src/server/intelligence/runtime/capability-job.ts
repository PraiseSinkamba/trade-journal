import type { JournalTx } from "@/db/transaction";
import type { BackgroundCapability } from "../contracts/capabilities";
import type {
  InsightStore,
  ObservationEvidenceReader,
  ReviewOpportunityReader,
  ReviewQuestionTransport,
} from "../contracts/insights";
import type {
  AsyncJobContext,
  AsyncJobHandler,
  AsyncJobOutcome,
  JobPayload,
  JobRecord,
} from "../contracts/jobs";
import {
  BACKGROUND_FAILURE,
  BACKGROUND_POLICY_ID,
  BACKGROUND_RUN_FAILURE,
  endpointFingerprint,
  type BackgroundEnvironmentReader,
  type BackgroundRunStatus,
  type BackgroundRunStore,
  type StoredPolicy,
} from "../contracts/policy";
import { evaluateBackgroundAuthorization } from "./model-policy";

/**
 * The durable capability job (Phase 23).
 *
 * The job runs one background capability for one observation. It is split in
 * two halves, because the provider call must not sit inside a write
 * transaction:
 *
 * - `prepare` does the slow work with no transaction open: it authorises the
 *   run again, reserves the daily attempt, reads the current evidence and
 *   asks the provider once;
 * - `commit` writes the outcome inside the caller's transaction: it rechecks
 *   the account, the consent, the pinned configuration and the observation,
 *   then stores the question and finishes the run.
 *
 * Every refusal is a stable reason code. No prompt, no provider answer and no
 * credential is ever stored: the run meta holds a reason and the capability
 * id and version, nothing else.
 */

/** The reason a job records when its payload is not a capability job. */
const INVALID_PAYLOAD = "invalid_payload";

/** The reason a job records when the evidence does not match the schema. */
const INVALID_EVIDENCE = "invalid_evidence";

/** The reason a job records when the provider's answer is not a question. */
const INVALID_OUTPUT = "invalid_output";

/** The reason a job records when the provider call failed. */
const PROVIDER_ERROR = "provider_error";

/** The reason a run records when its observation is no longer current. */
const TARGET_STALE = "target_stale";

/** The reason a run records when the review opportunity is no longer live. */
const OPPORTUNITY_NOT_LIVE = "opportunity_not_live";

/** The payload of the job this handler runs. */
type CapabilityJobPayload = Extract<JobPayload, { type: "run_capability" }>;

/** What the capability job needs from the outside world. */
export interface CapabilityJobDeps {
  /** The capability this handler runs. */
  readonly capability: BackgroundCapability;
  /** The run ledger: the run, the policy and the attempt reservations. */
  readonly runs: BackgroundRunStore;
  /** The store the question is written to. */
  readonly insights: InsightStore;
  /** The reader that answers what is still true about the observation. */
  readonly observations: ObservationEvidenceReader;
  /** The reader that answers whether the review opportunity is still live. */
  readonly opportunities: ReviewOpportunityReader;
  /** The provider transport the question is asked through. */
  readonly transport: ReviewQuestionTransport;
  /** The reader that answers which accounts exist and how the journal is configured. */
  readonly environment: BackgroundEnvironmentReader;
  /** The clock the attempt reservation and the creation time are taken from. */
  readonly clock: () => number;
}

/**
 * The reason the current policy refuses the account, or null when it allows it.
 *
 * A missing policy, an invalid one, a disabled one and a revoked consent are
 * four different refusals, because the operator has to be able to tell them
 * apart.
 */
const policyRefusal = (stored: StoredPolicy | null, accountId: string): string | null => {
  if (!stored) return BACKGROUND_FAILURE.policyMissing;
  if (stored.invalid || !stored.settings) return BACKGROUND_FAILURE.policyInvalid;
  if (!stored.settings.enabled) return BACKGROUND_FAILURE.policyDisabled;
  if (!stored.settings.accounts.includes(accountId)) return BACKGROUND_FAILURE.accountNotOptedIn;
  return null;
};

/**
 * Creates the handler of the capability job.
 *
 * The handler is bound to one capability: its id and version are the
 * capability's, and a job that names another one is refused before it reaches
 * a provider.
 */
export const createCapabilityJobHandler = (deps: CapabilityJobDeps): AsyncJobHandler => {
  /** A refusal that ends the run without a question. */
  const refusal = (
    reason: string,
    runStatus: BackgroundRunStatus,
    retryable = false,
  ): AsyncJobOutcome => ({ status: "failed", reason, retryable, runStatus });

  /** Whether the payload names the capability this handler runs. */
  const isOurPayload = (payload: JobPayload): payload is CapabilityJobPayload =>
    payload.type === "run_capability" &&
    payload.capabilityId === deps.capability.id &&
    payload.capabilityVersion === deps.capability.version;

  /**
   * The slow half: the authorisation, the reservation and the provider call.
   *
   * No write transaction is open while the provider is asked. The only
   * transactions here are the short reads and the reservation, and each one
   * commits before the next step starts.
   */
  const prepare = async (context: AsyncJobContext): Promise<AsyncJobOutcome> => {
    const payload = context.job.payload;
    if (payload.type !== "run_capability") return refusal(INVALID_PAYLOAD, "failed");
    // The worker only dispatches a payload that names this capability, so a
    // payload this handler will not run is an invalid payload and nothing
    // else: one condition, one reason code.
    if (!isOurPayload(payload)) return refusal(INVALID_PAYLOAD, "failed");

    const run = context.runInTransaction((tx) => deps.runs.readRunInTx(tx, payload.runId));
    if (!run) return refusal(BACKGROUND_FAILURE.runNotFound, "failed");

    // The authorisation is recomputed at execution time: the world moved
    // between the enqueue and now.
    const environment = context.runInTransaction((tx) => deps.environment.readEnvironmentInTx(tx));
    const decision = context.runInTransaction((tx) => {
      const stored = deps.runs.readPolicyInTx(tx, BACKGROUND_POLICY_ID);
      return evaluateBackgroundAuthorization({
        run,
        policy: stored?.settings ?? null,
        policyInvalid: stored?.invalid ?? false,
        currentRevision: stored?.revision ?? 0,
        current: environment.providerConfiguration,
        existingAccountIds: environment.existingAccountIds,
        signal: context.signal,
      });
    });
    if (decision.status !== "completed") {
      // The run ends in the state the refusal means: a target that is gone is
      // cancelled, a run that cannot be found or failed is failed, and
      // everything else is unavailable.
      const runStatus =
        decision.status === "cancelled"
          ? "cancelled"
          : decision.status === "failed"
            ? "failed"
            : "unavailable";
      return refusal(decision.reason, runStatus);
    }

    // A provider nobody configured cannot answer: the refusal is terminal and
    // costs no attempt.
    if (!environment.providerConfigured)
      return refusal(BACKGROUND_RUN_FAILURE.providerNotConfigured, "unavailable");

    // The current evidence is read before the attempt is reserved: a target
    // that went stale costs no allowance.
    const observation = context.runInTransaction((tx) =>
      deps.observations.readCurrentObservationInTx(tx, payload.observationId),
    );
    if (!observation) return refusal(TARGET_STALE, "cancelled");

    // The opportunity the question belongs to must still be live: a question
    // about a review the journal withdrew is a question nobody asked for.
    const opportunityLive = context.runInTransaction((tx) =>
      deps.opportunities.isLiveInTx(tx, payload.observationId),
    );
    if (!opportunityLive) return refusal(OPPORTUNITY_NOT_LIVE, "cancelled");

    const parsedEvidence = deps.capability.inputSchema.safeParse(observation.evidence);
    if (!parsedEvidence.success) return refusal(INVALID_EVIDENCE, "failed");

    const now = deps.clock();
    const reserved = context.runInTransaction((tx) => {
      const ok = deps.runs.reserveAttemptInTx(tx, run.id, now);
      // The attempt is taken and the run is running in the same transaction:
      // a crashed attempt keeps its reservation.
      if (ok) deps.runs.updateRunStatusInTx(tx, run.id, "running", now);
      return ok;
    });
    if (!reserved) return refusal(BACKGROUND_RUN_FAILURE.dailyBudgetExhausted, "unavailable");

    const { system, prompt } = deps.capability.buildPrompt(parsedEvidence.data);
    const raw = await deps.transport
      .ask({
        provider: run.provider,
        model: run.model,
        // The endpoint the run was pinned to: the authorisation just proved
        // that the configured endpoint is the pinned one.
        baseUrl: environment.providerConfiguration.baseUrl,
        system,
        prompt,
        signal: context.signal,
      })
      .catch(() => null);
    if (raw === null) {
      // The attempt stays spent: the reservation is never given back. The
      // job's own retry policy bounds the attempts.
      return refusal(PROVIDER_ERROR, "queued", true);
    }

    const parsedAnswer = deps.capability.outputSchema.safeParse(raw);
    if (!parsedAnswer.success) return refusal(INVALID_OUTPUT, "failed");
    const question: unknown = parsedAnswer.data;
    if (typeof question !== "string") return refusal(INVALID_OUTPUT, "failed");

    return {
      status: "completed",
      answer: {
        accountId: observation.accountId,
        subjectId: observation.subjectId,
        observationId: observation.observationId,
        sourceRevision: observation.sourceRevision,
        question,
        runId: run.id,
        capabilityVersion: deps.capability.version,
        createdAt: now,
      },
    };
  };

  /**
   * The fast half: the writes, inside the caller's transaction.
   *
   * The claim fence, the writes and the acknowledgement commit together, so a
   * worker that lost its claim writes nothing. Nothing here opens a
   * transaction of its own.
   */
  const commit = (tx: JournalTx, job: JobRecord, outcome: AsyncJobOutcome): void => {
    const payload = job.payload;
    if (!isOurPayload(payload)) return;

    const run = deps.runs.readRunInTx(tx, payload.runId);
    if (!run) return;

    const now = deps.clock();
    const meta = (entry: Record<string, unknown>): Record<string, unknown> => ({
      ...run.meta,
      ...entry,
    });

    if (outcome.status === "failed") {
      deps.runs.updateRunStatusInTx(tx, run.id, outcome.runStatus, now);
      deps.runs.updateRunMetaInTx(tx, run.id, meta({ refusalReason: outcome.reason }), now);
      return;
    }

    const answer = outcome.answer;
    if (!answer) {
      deps.runs.updateRunStatusInTx(tx, run.id, "failed", now);
      deps.runs.updateRunMetaInTx(tx, run.id, meta({ refusalReason: INVALID_OUTPUT }), now);
      return;
    }

    // The account and its consent are checked again: the answer was produced
    // while the world could still change.
    const environment = deps.environment.readEnvironmentInTx(tx);
    if (!environment.existingAccountIds.includes(answer.accountId)) {
      deps.runs.updateRunStatusInTx(tx, run.id, "cancelled", now);
      deps.runs.updateRunMetaInTx(
        tx,
        run.id,
        meta({ refusalReason: BACKGROUND_FAILURE.accountMissing }),
        now,
      );
      return;
    }

    const storedPolicy = deps.runs.readPolicyInTx(tx, BACKGROUND_POLICY_ID);
    const refusalReason = policyRefusal(storedPolicy, answer.accountId);
    if (refusalReason) {
      deps.runs.updateRunStatusInTx(tx, run.id, "unavailable", now);
      deps.runs.updateRunMetaInTx(tx, run.id, meta({ refusalReason }), now);
      return;
    }

    // The policy the run was approved under must still be the current one: a
    // revision that landed while the provider was thinking changes what the
    // operator allows, so the run does not inherit it.
    if (storedPolicy && storedPolicy.revision !== run.policyRevision) {
      deps.runs.updateRunStatusInTx(tx, run.id, "unavailable", now);
      deps.runs.updateRunMetaInTx(
        tx,
        run.id,
        meta({ refusalReason: BACKGROUND_FAILURE.policyChanged }),
        now,
      );
      return;
    }

    // The run stays bound to the configuration it was approved against: a
    // changed configuration makes the run unavailable, never rerouted.
    const current = environment.providerConfiguration;
    const configurationMatches =
      current.provider === run.provider &&
      current.model === run.model &&
      run.endpointFingerprint === endpointFingerprint(run.provider, run.model, current.baseUrl);
    if (!configurationMatches) {
      deps.runs.updateRunStatusInTx(tx, run.id, "unavailable", now);
      deps.runs.updateRunMetaInTx(
        tx,
        run.id,
        meta({ refusalReason: BACKGROUND_FAILURE.configurationChanged }),
        now,
      );
      return;
    }

    const observation = deps.observations.readCurrentObservationInTx(tx, answer.observationId);
    if (!observation) {
      deps.runs.updateRunStatusInTx(tx, run.id, "cancelled", now);
      deps.runs.updateRunMetaInTx(tx, run.id, meta({ refusalReason: TARGET_STALE }), now);
      return;
    }

    // The opportunity is checked again: a review the journal withdrew while
    // the provider was thinking yields no visible question.
    if (!deps.opportunities.isLiveInTx(tx, answer.observationId)) {
      deps.runs.updateRunStatusInTx(tx, run.id, "cancelled", now);
      deps.runs.updateRunMetaInTx(tx, run.id, meta({ refusalReason: OPPORTUNITY_NOT_LIVE }), now);
      return;
    }

    const insightId = deps.insights.persistInsightInTx(tx, {
      ...answer,
      runId: run.id,
      capabilityVersion: deps.capability.version,
    });
    deps.runs.updateRunStatusInTx(tx, run.id, "completed", now);
    if (insightId !== null) {
      deps.runs.updateRunMetaInTx(
        tx,
        run.id,
        meta({
          capabilityId: deps.capability.id,
          capabilityVersion: deps.capability.version,
        }),
        now,
      );
    }
  };

  return {
    id: deps.capability.id,
    version: deps.capability.version,
    prepare,
    commit,
  };
};
