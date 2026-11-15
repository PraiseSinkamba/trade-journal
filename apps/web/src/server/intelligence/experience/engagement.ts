import {
  ENGAGEMENT_DEFAULTS,
  type EngagementDecision,
  type EngagementInput,
} from "../contracts/experience";

/**
 * The engagement policy (Phase 17).
 *
 * A pure function: it reads its input and nothing else. No clock, no
 * database, no network, no random source — every fact it decides on arrives
 * in the input, so the same input always yields the same decision.
 *
 * The rules, in the order they are evaluated:
 *
 * 1. a dismissed opportunity or evidence revision is suppressed;
 * 2. an expired opportunity is suppressed;
 * 3. an already delivered opportunity is suppressed;
 * 4. historical and baseline material is observed, never delivered;
 * 5. a current observation without an action is observed;
 * 6. an opportunity that is not eligible yet is deferred;
 * 7. an unknown or busy operator goes to the inbox — the policy never
 *    invents an idle state, so it never interrupts;
 * 8. a matching UI context is served contextually;
 * 9. without the opt-in the opportunity goes to the inbox;
 * 10. when the day's proactive allowance is spent, or the subject is inside
 *     its cooldown, the opportunity goes to the inbox;
 * 11. otherwise the opportunity is delivered proactively.
 */

/** The instant the UTC day after `now` starts. */
const nextDayStart = (now: number): number => (Math.floor(now / 86_400_000) + 1) * 86_400_000;

/**
 * Decides what happens to an opportunity.
 *
 * The decision carries the outcome, the reason for it and the next instant
 * the opportunity may be engaged, when that instant is known.
 */
export const decideEngagement = (input: EngagementInput): EngagementDecision => {
  if (input.dismissedOpportunity) {
    return { outcome: "suppress", reason: "dismissed_opportunity", nextEligibleAt: null };
  }
  if (input.dismissedEvidence) {
    return { outcome: "suppress", reason: "dismissed_evidence", nextEligibleAt: null };
  }
  if (input.now >= input.expiresAt) {
    return { outcome: "suppress", reason: "expired", nextEligibleAt: null };
  }
  if (input.alreadyDelivered) {
    return { outcome: "suppress", reason: "already_delivered", nextEligibleAt: null };
  }
  if (input.material === "historical") {
    return { outcome: "observe", reason: "historical_material", nextEligibleAt: null };
  }
  if (input.material === "baseline") {
    return { outcome: "observe", reason: "baseline_material", nextEligibleAt: null };
  }
  if (!input.actionable) {
    return { outcome: "observe", reason: "not_actionable", nextEligibleAt: null };
  }
  if (input.now < input.eligibleAt) {
    return { outcome: "defer", reason: "not_yet_eligible", nextEligibleAt: input.eligibleAt };
  }
  if (input.activity === "unknown") {
    return { outcome: "inbox", reason: "activity_unknown", nextEligibleAt: null };
  }
  if (input.activity === "busy") {
    return { outcome: "inbox", reason: "activity_busy", nextEligibleAt: null };
  }
  if (
    input.context !== null &&
    input.context.subjectType === input.subject.type &&
    input.context.subjectId === input.subject.id
  ) {
    return { outcome: "contextual", reason: "context_match", nextEligibleAt: null };
  }
  if (!input.proactiveOptIn) {
    return { outcome: "inbox", reason: "not_opted_in", nextEligibleAt: null };
  }
  if (input.proactiveDeliveriesToday >= ENGAGEMENT_DEFAULTS.proactivePerDay) {
    return { outcome: "inbox", reason: "daily_limit", nextEligibleAt: nextDayStart(input.now) };
  }
  if (
    input.lastProactiveDeliveryAt !== null &&
    input.now - input.lastProactiveDeliveryAt < ENGAGEMENT_DEFAULTS.proactiveCooldownMs
  ) {
    return {
      outcome: "inbox",
      reason: "cooldown",
      nextEligibleAt: input.lastProactiveDeliveryAt + ENGAGEMENT_DEFAULTS.proactiveCooldownMs,
    };
  }
  return { outcome: "proactive", reason: "proactive_allowed", nextEligibleAt: null };
};
