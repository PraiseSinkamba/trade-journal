import { newUuid } from "@/server/ids";
import {
  ENGAGEMENT_DEFAULTS,
  deliveryKey,
  dismissalKey,
  opportunityKey,
  type EngagementActivity,
  type EngagementDecision,
  type EngagementMaterial,
  type ExperienceStore,
  type OpportunityRow,
  type OpportunityStatus,
  type RunInTransaction,
} from "../contracts/experience";
import { decideEngagement } from "./engagement";

/**
 * The engagement coordinator (Phase 17).
 *
 * It owns the three reservations the contract needs:
 *
 * - the **opportunity reservation** — one row per deduplication key, so the
 *   same dedup key can never produce two opportunities, and two capabilities
 *   offering the same subject on the same evidence resolve to one;
 * - the **delivery reservation** — one immutable row per proactive delivery,
 *   so a retried delivery cannot notify twice and the daily allowance and
 *   the per-subject cooldown read a history nothing can rewrite;
 * - the **dismissal record** — one immutable row per dismissed opportunity or
 *   evidence revision, so a dismissal holds even for opportunities that do
 *   not exist yet.
 *
 * The `dedup_key` namespace says which kind a row is; its status says what
 * happened to that row.
 *
 * The coordinator depends on the injected store port and the injected
 * transaction seam, exactly like the workflow engine: it opens no connection
 * of its own and imports nothing that opens the journal.
 */

/** What the coordinator is asked to engage. */
export interface EngageRequest {
  /** The producer's dedup key. The same key is the same opportunity. */
  readonly dedupKey: string;
  /** The subject the opportunity is about. */
  readonly subject: { readonly type: string; readonly id: string };
  /** The account the opportunity belongs to. */
  readonly accountId: string | null;
  /** The evidence revisions the opportunity rests on. */
  readonly evidenceRevisions: readonly string[];
  /** The material the opportunity rests on. */
  readonly material: EngagementMaterial;
  /** Whether a current observation carries an action the operator can take. */
  readonly actionable: boolean;
  /** The instant the opportunity may be surfaced; defaults to now. */
  readonly eligibleAt?: number;
  /** The instant the opportunity expires; defaults to now plus seven days. */
  readonly expiresAt?: number;
  /** Whether the operator opted in to proactive delivery. */
  readonly proactiveOptIn: boolean;
  /** The operator's trading activity, when it is reliably known. */
  readonly activity: EngagementActivity;
  /** The UI context the operator has open, if any. */
  readonly context?: { readonly subjectType: string; readonly subjectId: string } | null;
}

/** A structured interaction intent (design §15). */
export interface InteractionIntent {
  /** The surface the interaction is offered on. */
  readonly kind: "inbox" | "contextual" | "proactive";
  /** The subject the interaction is about. */
  readonly subject: { readonly type: string; readonly id: string };
  /** The evidence the interaction rests on. */
  readonly evidenceRevisions: readonly string[];
  /** The instant the interaction stops being valid. */
  readonly expiresAt: number;
  /** The actions the operator may take. */
  readonly actions: readonly ["dismiss"];
}

/** What the coordinator decided. */
export interface EngagementOutcome {
  /** The policy decision. */
  readonly decision: EngagementDecision;
  /** The opportunity the decision is about. */
  readonly opportunity: OpportunityRow;
  /**
   * True only when this call reserved the proactive delivery. A retry of the
   * same delivery finds the reservation and gets false, so it must not notify.
   */
  readonly delivered: boolean;
  /** The interaction the operator is offered, or null when none is. */
  readonly intent: InteractionIntent | null;
}

/** The engagement coordinator. */
export interface EngagementCoordinator {
  /** Records the opportunity, decides, and reserves a proactive delivery when the policy allows it. */
  engage(request: EngageRequest): EngagementOutcome;
  /** Records the dismissal of an opportunity or an evidence revision. */
  dismiss(scope: "opportunity" | "evidence", target: string): void;
}

/** The engagement coordinator's dependencies. */
export interface EngagementCoordinatorDeps {
  /** The transaction seam: the coordinator never opens the journal itself. */
  readonly runInTransaction: RunInTransaction;
  /** The experience store. */
  readonly store: ExperienceStore;
  /** The clock; defaults to the wall clock. */
  readonly clock?: () => number;
}

/**
 * The evidence revisions of a stored opportunity, parsed from its row.
 *
 * A row with unreadable evidence rests on no evidence, so nothing can be
 * dismissed on its account.
 */
const evidenceOf = (row: OpportunityRow): string[] => {
  try {
    const parsed: unknown = JSON.parse(row.evidenceIdsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
};

/**
 * The producer key inside a stored opportunity key.
 *
 * A stored key is `opportunity/{producerKey}`; the producer key is what a
 * dismissal names, so a consolidated opportunity is dismissed under every key
 * that reaches it.
 */
const producerKeyOf = (row: OpportunityRow): string =>
  row.dedupKey.startsWith("opportunity/")
    ? row.dedupKey.slice("opportunity/".length)
    : row.dedupKey;

/**
 * The opportunity statuses an engagement may still move away from.
 *
 * `suppressed` is the observed state, not a terminal one: the same
 * opportunity may become actionable later. `dismissed`, `expired` and
 * `delivered` are terminal, so nothing moves a row out of them.
 */
const ENGAGEABLE_STATUSES: readonly OpportunityStatus[] = ["pending", "eligible", "suppressed"];

/**
 * The order in which a consolidation picks between the rows it matches.
 *
 * One interaction is one row, whatever status that row holds. When more than
 * one row matches, a dismissal and a delivery win: they are decisions about
 * the interaction, so the operator must not be offered again what they
 * dismissed or already received. An expired row comes last: its window
 * closed, so a live row describes the interaction better.
 */
const CONSOLIDATION_PRIORITY: readonly OpportunityStatus[] = [
  "dismissed",
  "delivered",
  "pending",
  "eligible",
  "suppressed",
  "expired",
];

/**
 * Creates the engagement coordinator.
 *
 * Every engagement runs in one immediate transaction: the coordinator reads
 * the dismissals, the daily allowance and the subject cooldown, decides, and
 * reserves the delivery in the same transaction, so two concurrent
 * engagements cannot both spend the day's single proactive slot.
 */
export const createEngagementCoordinator = (
  deps: EngagementCoordinatorDeps,
): EngagementCoordinator => {
  const clock = deps.clock ?? (() => Date.now());
  const store = deps.store;

  /**
   * Engages one opportunity, or re-engages the one a previous call recorded.
   *
   * The dedup key names the opportunity, so a repeated call never writes a
   * second row: it re-evaluates the recorded one, and the delivery
   * reservation keeps a retried push from notifying twice.
   */
  const engage = (request: EngageRequest): EngagementOutcome =>
    deps.runInTransaction((tx): EngagementOutcome => {
      const now = clock();

      const recorded = store.loadEngagement(tx, opportunityKey(request.dedupKey));
      // Two capabilities that offer the same subject on the same evidence
      // describe one interaction, not two. A dismissed or delivered row still
      // matches: the interaction it named stays suppressed and cannot be
      // side-stepped under another producer key.
      const overlapping =
        recorded ??
        store
          .findOpportunitiesBySubject(tx, request.subject.type, request.subject.id)
          .filter(
            (row) =>
              evidenceOf(row).slice().sort().join(" ") ===
              request.evidenceRevisions.slice().sort().join(" "),
          )
          .sort(
            (left, right) =>
              CONSOLIDATION_PRIORITY.indexOf(left.status) -
              CONSOLIDATION_PRIORITY.indexOf(right.status),
          )[0];

      const opportunity =
        overlapping ??
        store.insertEngagement(tx, {
          id: newUuid(),
          dedupKey: opportunityKey(request.dedupKey),
          subjectType: request.subject.type,
          subjectId: request.subject.id,
          accountId: request.accountId,
          status: "pending",
          eligibleAt: request.eligibleAt ?? now,
          expiresAt: request.expiresAt ?? now + ENGAGEMENT_DEFAULTS.opportunityExpiryMs,
          evidenceIdsJson: JSON.stringify(request.evidenceRevisions),
          createdAt: now,
          updatedAt: now,
        }).row;

      const evidenceRevisions = evidenceOf(opportunity);
      const dismissedOpportunity =
        opportunity.status === "dismissed" ||
        store.loadEngagement(tx, dismissalKey("opportunity", request.dedupKey)) !== null ||
        store.loadEngagement(tx, dismissalKey("opportunity", producerKeyOf(opportunity))) !== null;
      // A dismissal of an evidence revision is honoured against the revisions
      // the row recorded and the revisions this request cites: a producer
      // cannot slip a dismissed revision past the row that was recorded first.
      const dismissedEvidence = [
        ...new Set([...evidenceRevisions, ...request.evidenceRevisions]),
      ].some((revision) => store.loadEngagement(tx, dismissalKey("evidence", revision)) !== null);
      const alreadyDelivered = store.loadEngagement(tx, deliveryKey(opportunity.id)) !== null;
      const proactiveDeliveriesToday = store.countProactiveDeliveriesSince(
        tx,
        Math.floor(now / 86_400_000) * 86_400_000,
      );
      const lastProactiveDeliveryAt = store.lastProactiveDeliveryAt(
        tx,
        opportunity.subjectType,
        opportunity.subjectId,
      );

      const decision = decideEngagement({
        now,
        material: request.material,
        actionable: request.actionable,
        subject: { type: opportunity.subjectType, id: opportunity.subjectId },
        eligibleAt: opportunity.eligibleAt,
        expiresAt: opportunity.expiresAt,
        proactiveOptIn: request.proactiveOptIn,
        activity: request.activity,
        context: request.context ?? null,
        dismissedOpportunity,
        dismissedEvidence,
        alreadyDelivered,
        proactiveDeliveriesToday,
        lastProactiveDeliveryAt,
      });

      /**
       * Moves the opportunity to a status and reports the row as it now is.
       *
       * A row that does not move keeps its status: the report never claims a
       * state the store did not persist.
       */
      const advance = (to: OpportunityStatus): OpportunityRow => {
        const moved = store.advanceOpportunity(
          tx,
          opportunity.dedupKey,
          ENGAGEABLE_STATUSES,
          to,
          now,
        );
        return moved ? { ...opportunity, status: to, updatedAt: now } : opportunity;
      };

      if (decision.outcome === "proactive") {
        // The delivery reservation is the record that the push happened: the
        // unique key keeps the first push and refuses the retry.
        const reservation = store.insertEngagement(tx, {
          id: newUuid(),
          dedupKey: deliveryKey(opportunity.id),
          subjectType: opportunity.subjectType,
          subjectId: opportunity.subjectId,
          accountId: opportunity.accountId,
          status: "delivered",
          eligibleAt: now,
          expiresAt: ENGAGEMENT_DEFAULTS.neverExpires,
          evidenceIdsJson: opportunity.evidenceIdsJson,
          createdAt: now,
          updatedAt: now,
        });
        if (!reservation.created) {
          return {
            decision: {
              outcome: "suppress",
              reason: "already_delivered",
              nextEligibleAt: null,
            },
            opportunity,
            delivered: false,
            intent: null,
          };
        }
        return {
          decision,
          opportunity: advance("delivered"),
          delivered: true,
          intent: {
            kind: "proactive",
            subject: { type: opportunity.subjectType, id: opportunity.subjectId },
            evidenceRevisions,
            expiresAt: opportunity.expiresAt,
            actions: ["dismiss"],
          },
        };
      }

      if (decision.outcome === "suppress") {
        // A dismissal and an expiry are terminal; an already delivered
        // opportunity keeps the state its delivery gave it.
        const terminal =
          decision.reason === "expired"
            ? "expired"
            : decision.reason === "dismissed_opportunity" ||
                decision.reason === "dismissed_evidence"
              ? "dismissed"
              : null;
        return {
          decision,
          opportunity: terminal ? advance(terminal) : opportunity,
          delivered: false,
          intent: null,
        };
      }

      if (decision.outcome === "observe") {
        // Observed material is recorded and never delivered.
        return {
          decision,
          opportunity: advance("suppressed"),
          delivered: false,
          intent: null,
        };
      }

      if (decision.outcome === "inbox" || decision.outcome === "contextual") {
        return {
          decision,
          opportunity: advance("eligible"),
          delivered: false,
          intent: {
            kind: decision.outcome === "contextual" ? "contextual" : "inbox",
            subject: { type: opportunity.subjectType, id: opportunity.subjectId },
            evidenceRevisions,
            expiresAt: opportunity.expiresAt,
            actions: ["dismiss"],
          },
        };
      }

      // Deferred: the opportunity waits for its eligible instant.
      return { decision, opportunity, delivered: false, intent: null };
    });

  /**
   * Records a dismissal.
   *
   * The dismissal outlives the opportunity it was made against: it is stored
   * with no expiry, so it also suppresses opportunities recorded later.
   */
  const dismiss = (scope: "opportunity" | "evidence", target: string): void => {
    const now = clock();
    deps.runInTransaction((tx) => {
      // An opportunity is known by its stored key, by the key that created
      // it, or by its row id; all three name the same opportunity. A target
      // that names no opportunity still records the dismissal, so a
      // dismissal made before the opportunity exists is honoured later.
      const stored =
        scope === "opportunity"
          ? (store.loadEngagement(tx, target) ??
            store.loadEngagement(tx, opportunityKey(target)) ??
            store.loadOpportunityById(tx, target))
          : null;
      const key = stored ? producerKeyOf(stored) : target;
      store.insertEngagement(tx, {
        id: newUuid(),
        dedupKey: dismissalKey(scope, key),
        subjectType: scope,
        subjectId: key,
        accountId: null,
        status: "dismissed",
        eligibleAt: now,
        expiresAt: ENGAGEMENT_DEFAULTS.neverExpires,
        evidenceIdsJson: "[]",
        createdAt: now,
        updatedAt: now,
      });
      if (stored) {
        store.advanceOpportunity(tx, stored.dedupKey, ENGAGEABLE_STATUSES, "dismissed", now);
      }
    });
  };

  return { engage, dismiss };
};
