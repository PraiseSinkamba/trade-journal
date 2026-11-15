import { ENGAGEMENT_DEFAULTS } from "../contracts/experience";
import type { EngageRequest } from "./interactions";

/**
 * The opportunity producer (Phase 19).
 *
 * A pure function: it reads one persisted observation and the operator's
 * controls, and returns the engagement request the observation deserves — or
 * the reason it does not deserve one. It holds no database, no clock and no
 * network, so the same input always yields the same outcome.
 */

/** The persisted observation the producer reads. */
export interface ProducerObservation {
  /** The observation row's id. */
  readonly id: string;
  /** The trade the observation is about. */
  readonly subjectId: string;
  /** The account the observation belongs to. */
  readonly accountId: string | null;
  /** The observation's lifecycle status. */
  readonly status: string;
  /** The evidence revisions the observation rests on. */
  readonly evidenceRevisions: readonly string[];
}

/** The switches the operator owns. */
export interface ProducerControls {
  /** Whether the journal may raise insights on its own. */
  readonly proactiveOptIn: boolean;
  /** Whether the journal raises nothing at all. */
  readonly paused: boolean;
}

/** What the producer decided. */
export type ProducerOutcome =
  | { readonly kind: "skipped"; readonly reason: "paused" | "not_opted_in" | "inactive" }
  | { readonly kind: "produced"; readonly request: EngageRequest };

/**
 * Turns one persisted observation into one engagement request.
 *
 * The switches are read in the order the operator reads them: a paused
 * journal raises nothing, a journal without the opt-in raises nothing of its
 * own, and an observation that is no longer active is not worth raising.
 */
export const buildOpportunityRequest = (input: {
  readonly observation: ProducerObservation;
  readonly controls: ProducerControls;
  readonly now: number;
}): ProducerOutcome => {
  const { observation, controls, now } = input;
  if (controls.paused) return { kind: "skipped", reason: "paused" };
  if (!controls.proactiveOptIn) return { kind: "skipped", reason: "not_opted_in" };
  if (observation.status !== "active") return { kind: "skipped", reason: "inactive" };
  return {
    kind: "produced",
    request: {
      // The observation's own id names the opportunity, so a repeated
      // delivery of the same observation resolves to the same opportunity.
      dedupKey: `observation/${observation.id}`,
      subject: { type: "observation", id: observation.id },
      accountId: observation.accountId,
      evidenceRevisions: observation.evidenceRevisions,
      material: "current",
      actionable: true,
      proactiveOptIn: controls.proactiveOptIn,
      // The journal cannot know what the operator is doing, and it never
      // invents an idle operator: the activity stays unknown, so the
      // opportunity waits in the inbox.
      activity: "unknown",
      context: null,
      eligibleAt: now,
      // The journal never invents a lifetime either: the opportunity expires
      // with the engagement default.
      expiresAt: now + ENGAGEMENT_DEFAULTS.opportunityExpiryMs,
    },
  };
};
