import type { JournalTx } from "@/db/transaction";
import type { BackgroundCapability } from "../contracts/capabilities";
import {
  insightBusinessKey,
  type ObservationEvidenceReader,
  type ReviewOpportunityReader,
} from "../contracts/insights";
import type { JobStore } from "../contracts/jobs";
import {
  BACKGROUND_POLICY_ID,
  endpointFingerprint,
  type BackgroundEnvironmentReader,
  type BackgroundRunStore,
} from "../contracts/policy";

/**
 * The enqueue of one review question (Phase 23).
 *
 * The run and its job are written in the transaction that persists the
 * observation and raises its review opportunity, so a rollback leaves neither
 * behind and a repeated delivery reuses the same business key.
 *
 * Every gate is read inside that transaction: the policy that carries the
 * consent, the accounts that still exist, the opportunity that is still live
 * and the observation that is still the current truth. A gate that fails ends
 * the enqueue quietly: the deterministic review is unaffected and no provider
 * request is ever made for a trade nobody will look at.
 */

/** What the enqueue needs from the outside world. */
export interface ReviewQuestionEnqueueDeps {
  /** The capability the run will execute. */
  readonly capability: BackgroundCapability;
  /** The run ledger the run is written to. */
  readonly runs: BackgroundRunStore;
  /** The job store the job is written to. */
  readonly jobs: JobStore;
  /** The reader that answers what is still true about the observation. */
  readonly observations: ObservationEvidenceReader;
  /** The reader that answers whether the review opportunity is still live. */
  readonly opportunities: ReviewOpportunityReader;
  /** The reader that answers which accounts exist and how the journal is configured. */
  readonly environment: BackgroundEnvironmentReader;
  /** The clock the run and the job are stamped with. */
  readonly clock: () => number;
}

/** What the caller knows about the observation it just persisted. */
export interface ReviewQuestionEnqueueInput {
  /** The observation the question is made from. */
  readonly observationId: string;
  /** How the change that produced the observation arrived. */
  readonly mode: "live" | "historical" | "maintenance";
  /** The time zone of the journal, as the caller's transaction sees it. */
  readonly timeZone: string;
}

/** The enqueuer of one review question. */
export interface ReviewQuestionEnqueuer {
  /**
   * Queues the run and its job, or queues nothing.
   *
   * It never throws for an ineligible trade: the deterministic review stays
   * available, and no provider request is spent on it.
   */
  enqueueInTx(tx: JournalTx, input: ReviewQuestionEnqueueInput): void;
}

/**
 * Creates the enqueuer of one review question.
 *
 * The business key is the identity of the whole effect: it is the run's effect
 * key, the job's idempotency key and the key of the stored question. One
 * source revision therefore yields exactly one run, one job and one question.
 */
export const createReviewQuestionEnqueuer = (
  deps: ReviewQuestionEnqueueDeps,
): ReviewQuestionEnqueuer => ({
  enqueueInTx: (tx, input) => {
    // A reconstruction is not the trader's own experience, and a maintenance
    // change is not a trade at all.
    if (input.mode !== "live") return;

    const policy = deps.runs.readPolicyInTx(tx, BACKGROUND_POLICY_ID);
    if (!policy?.settings || policy.invalid) return;
    if (!policy.settings.enabled) return;

    // The observation must still be the current truth: a superseded one is not
    // what the trader traded.
    const observation = deps.observations.readCurrentObservationInTx(tx, input.observationId);
    if (!observation) return;

    // The consent is per account.
    if (!policy.settings.accounts.includes(observation.accountId)) return;

    // An opportunity the journal suppressed is one it decided never to show:
    // a question about that trade would push back at the trader what the
    // journal deliberately kept quiet about.
    if (!deps.opportunities.isLiveInTx(tx, input.observationId)) return;

    const environment = deps.environment.readEnvironmentInTx(tx);
    if (!environment.providerConfigured) return;
    if (!environment.existingAccountIds.includes(observation.accountId)) return;

    // The context the run reads is bounded by the operator's policy.
    const parsed = deps.capability.inputSchema.safeParse(observation.evidence);
    if (!parsed.success) return;
    const { system, prompt } = deps.capability.buildPrompt(parsed.data);
    const inputCharacters = system.length + prompt.length;
    if (inputCharacters > policy.settings.maxInputCharacters) return;

    const now = deps.clock();
    const capabilityVersion = deps.capability.version;
    const businessKey = insightBusinessKey({
      accountId: observation.accountId,
      sourceRevision: observation.sourceRevision,
      capabilityVersion,
    });
    const configuration = environment.providerConfiguration;
    const run = deps.runs.enqueueRunOnceInTx(
      tx,
      {
        effectKey: businessKey,
        provider: configuration.provider,
        model: configuration.model,
        endpointFingerprint: endpointFingerprint(
          configuration.provider,
          configuration.model,
          configuration.baseUrl,
        ),
        policyRevision: policy.revision,
        scope: {
          accountIds: [observation.accountId],
          filters: {},
          timeZone: input.timeZone,
          dataSources: ["trades"],
          requiredFeatures: [],
          inputCharacters,
        },
        meta: { capabilityId: deps.capability.id, capabilityVersion },
      },
      now,
    );
    deps.jobs.enqueue(
      tx,
      businessKey,
      {
        type: "run_capability",
        runId: run.id,
        capabilityId: deps.capability.id,
        capabilityVersion,
        observationId: input.observationId,
      },
      now,
    );
  },
});
