import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, like } from "drizzle-orm";
import type { JournalTx } from "../src/db/transaction";
// The contracts open nothing: they are safe to import statically, before the
// scratch journal is pointed at.
import {
  ENGAGEMENT_DEFAULTS,
  type EngagementInput,
} from "../src/server/intelligence/contracts/experience";

/**
 * The engagement suite (Phase 17).
 *
 * The policy is pure: the same input always yields the same decision, and it
 * never reads a clock, a database or a random source. The coordinator persists
 * the opportunity, the delivery and the dismissal that follow, so a retry
 * cannot notify twice.
 *
 * Every case runs against a disposable scratch journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-engagement-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const { db, accounts, executions, intelligenceOpportunities, notes, trades } =
  await import("../src/db");
const { withJournalTransaction } = await import("../src/db/transaction");
const { createExperienceStore } =
  await import("../src/server/intelligence/infrastructure/experience-store");
const { decideEngagement } = await import("../src/server/intelligence/experience/engagement");
const { createEngagementCoordinator } =
  await import("../src/server/intelligence/experience/interactions");

const ACCOUNT = "acct-engagement";
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

// The journal handle is still open when the suite ends, so the scratch
// directory may not be removable yet; the scratch path is disposable anyway.
afterAll(() => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // The database file is still held by the open handle.
  }
});

/**
 * The transaction seam.
 *
 * The coordinator never opens the journal: the caller runs its work in the
 * caller's transaction, and this seam is the caller's side of it.
 */
const runInTransaction = <T>(
  fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T,
): T => withJournalTransaction(fn);

/** The coordinator under test, on a fixed clock. */
let now = NOW;
const coordinator = createEngagementCoordinator({
  runInTransaction,
  store: createExperienceStore(),
  clock: () => now,
});

/** Every engagement row, whatever its kind. */
const engagementRows = () => db.select().from(intelligenceOpportunities).all();
/** The opportunity rows only. */
const opportunityRows = () =>
  engagementRows().filter((row) => row.dedupKey.startsWith("opportunity/"));
/** The proactive delivery rows only. */
const deliveryRows = () =>
  engagementRows().filter((row) => row.dedupKey.startsWith("delivery/proactive/"));
/** The dismissal rows only. */
const dismissalRows = () => engagementRows().filter((row) => row.dedupKey.startsWith("dismissal/"));

/** A request that would be delivered proactively. */
const proactiveRequest = (
  overrides: Partial<Parameters<typeof coordinator.engage>[0]> = {},
): Parameters<typeof coordinator.engage>[0] => ({
  dedupKey: "producer-1",
  subject: { type: "observation", id: "observation-1" },
  accountId: ACCOUNT,
  evidenceRevisions: ["evidence-1"],
  material: "current",
  actionable: true,
  proactiveOptIn: true,
  activity: "idle",
  ...overrides,
});

/** The policy input a proactive engagement would carry. */
const proactiveInput = (overrides: Partial<EngagementInput> = {}): EngagementInput => ({
  now: NOW,
  material: "current",
  actionable: true,
  subject: { type: "observation", id: "observation-1" },
  eligibleAt: NOW,
  expiresAt: NOW + ENGAGEMENT_DEFAULTS.opportunityExpiryMs,
  proactiveOptIn: true,
  activity: "idle",
  context: null,
  dismissedOpportunity: false,
  dismissedEvidence: false,
  alreadyDelivered: false,
  proactiveDeliveriesToday: 0,
  lastProactiveDeliveryAt: null,
  ...overrides,
});

beforeEach(() => {
  db.delete(intelligenceOpportunities).run();
  db.delete(executions).run();
  db.delete(trades).run();
  db.delete(notes).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({ id: ACCOUNT, name: "Engagement account", kind: "manual", createdAt: "2026-01-01" })
    .run();
  now = NOW;
});

describe("Phase 17 engagement", () => {
  describe("the policy", () => {
    it("delivers proactively only when the operator opted in", () => {
      expect(decideEngagement(proactiveInput()).outcome).toBe("proactive");
      expect(decideEngagement(proactiveInput({ proactiveOptIn: false }))).toEqual({
        outcome: "inbox",
        reason: "not_opted_in",
        nextEligibleAt: null,
      });
    });

    it("never invents an idle state: unknown activity goes to the inbox", () => {
      expect(decideEngagement(proactiveInput({ activity: "unknown" }))).toEqual({
        outcome: "inbox",
        reason: "activity_unknown",
        nextEligibleAt: null,
      });
      expect(decideEngagement(proactiveInput({ activity: "busy" }))).toEqual({
        outcome: "inbox",
        reason: "activity_busy",
        nextEligibleAt: null,
      });
    });

    it("observes historical and baseline material and never delivers it", () => {
      expect(decideEngagement(proactiveInput({ material: "historical" }))).toEqual({
        outcome: "observe",
        reason: "historical_material",
        nextEligibleAt: null,
      });
      expect(decideEngagement(proactiveInput({ material: "baseline" }))).toEqual({
        outcome: "observe",
        reason: "baseline_material",
        nextEligibleAt: null,
      });
    });

    it("suppresses a dismissed opportunity or a dismissed evidence revision", () => {
      expect(decideEngagement(proactiveInput({ dismissedOpportunity: true }))).toEqual({
        outcome: "suppress",
        reason: "dismissed_opportunity",
        nextEligibleAt: null,
      });
      expect(decideEngagement(proactiveInput({ dismissedEvidence: true }))).toEqual({
        outcome: "suppress",
        reason: "dismissed_evidence",
        nextEligibleAt: null,
      });
    });

    it("suppresses an expired opportunity", () => {
      expect(decideEngagement(proactiveInput({ expiresAt: NOW, now: NOW })).outcome).toBe(
        "suppress",
      );
    });

    it("defers an opportunity that is not eligible yet", () => {
      const eligibleAt = NOW + 3_600_000;
      expect(decideEngagement(proactiveInput({ eligibleAt }))).toEqual({
        outcome: "defer",
        reason: "not_yet_eligible",
        nextEligibleAt: eligibleAt,
      });
    });

    it("serves a matching UI context contextually", () => {
      expect(
        decideEngagement(
          proactiveInput({
            context: { subjectType: "observation", subjectId: "observation-1" },
          }),
        ),
      ).toEqual({ outcome: "contextual", reason: "context_match", nextEligibleAt: null });
    });

    it("allows one proactive delivery per day", () => {
      expect(decideEngagement(proactiveInput({ proactiveDeliveriesToday: 1 }))).toEqual({
        outcome: "inbox",
        reason: "daily_limit",
        nextEligibleAt: (Math.floor(NOW / DAY) + 1) * DAY,
      });
    });

    it("keeps a subject inside its 24-hour cooldown", () => {
      const lastProactiveDeliveryAt = NOW - 3_600_000;
      expect(decideEngagement(proactiveInput({ lastProactiveDeliveryAt }))).toEqual({
        outcome: "inbox",
        reason: "cooldown",
        nextEligibleAt: lastProactiveDeliveryAt + ENGAGEMENT_DEFAULTS.proactiveCooldownMs,
      });
      expect(
        decideEngagement(
          proactiveInput({
            lastProactiveDeliveryAt: NOW - ENGAGEMENT_DEFAULTS.proactiveCooldownMs,
          }),
        ).outcome,
      ).toBe("proactive");
    });

    it("decides only from its input", () => {
      // The same input yields the same decision, and the instant the policy
      // reads is the one in the input, not a clock of its own.
      const input = proactiveInput();
      expect(decideEngagement(input)).toEqual(decideEngagement(input));
      expect(decideEngagement({ ...input })).toEqual(decideEngagement(input));
      expect(decideEngagement(proactiveInput({ expiresAt: NOW - 1 })).outcome).toBe("suppress");
      expect(decideEngagement(proactiveInput({ expiresAt: NOW + 1 })).outcome).toBe("proactive");
    });
  });

  describe("the coordinator", () => {
    it("records one opportunity for the same dedup key", () => {
      // The evidence differs, so only the dedup key can keep this one
      // opportunity: a second row would be a second opportunity.
      const first = coordinator.engage(
        proactiveRequest({ dedupKey: "producer-1", evidenceRevisions: ["evidence-1"] }),
      );
      const second = coordinator.engage(
        proactiveRequest({ dedupKey: "producer-1", evidenceRevisions: ["evidence-2"] }),
      );

      expect(second.opportunity.id).toBe(first.opportunity.id);
      expect(opportunityRows()).toHaveLength(1);
    });

    it("consolidates two capabilities that offer the same subject on the same evidence", () => {
      const first = coordinator.engage(proactiveRequest({ dedupKey: "producer-a" }));
      const second = coordinator.engage(proactiveRequest({ dedupKey: "producer-b" }));

      expect(second.opportunity.id).toBe(first.opportunity.id);
      expect(opportunityRows()).toHaveLength(1);
      expect(deliveryRows()).toHaveLength(1);
    });

    it("reserves one proactive delivery and refuses the retry", () => {
      const first = coordinator.engage(proactiveRequest());
      expect(first.delivered).toBe(true);
      expect(first.decision.outcome).toBe("proactive");
      expect(first.intent?.kind).toBe("proactive");

      const retry = coordinator.engage(proactiveRequest());
      expect(retry.delivered).toBe(false);
      expect(retry.decision.outcome).toBe("suppress");
      expect(retry.intent).toBeNull();
      expect(deliveryRows()).toHaveLength(1);
    });

    it("allows one proactive delivery per day", () => {
      coordinator.engage(proactiveRequest({ dedupKey: "producer-a" }));
      const second = coordinator.engage(
        proactiveRequest({
          dedupKey: "producer-b",
          subject: { type: "observation", id: "observation-2" },
          evidenceRevisions: ["evidence-2"],
        }),
      );

      expect(second.decision.outcome).toBe("inbox");
      expect(second.decision.reason).toBe("daily_limit");
      expect(second.delivered).toBe(false);
      expect(deliveryRows()).toHaveLength(1);
    });

    it("keeps a subject inside its cooldown and lets another subject through", () => {
      coordinator.engage(proactiveRequest({ dedupKey: "producer-a" }));
      // The next day, so the day's proactive allowance is fresh again and only
      // the per-subject cooldown can hold the subject back.
      now = Math.floor(NOW / DAY) * DAY + DAY + 3_600_000;

      const cooled = coordinator.engage(
        proactiveRequest({
          dedupKey: "producer-b",
          subject: { type: "observation", id: "observation-1" },
          evidenceRevisions: ["evidence-2"],
        }),
      );
      expect(cooled.decision.outcome).toBe("inbox");
      expect(cooled.decision.reason).toBe("cooldown");
      expect(cooled.delivered).toBe(false);

      const other = coordinator.engage(
        proactiveRequest({
          dedupKey: "producer-c",
          subject: { type: "observation", id: "observation-2" },
          evidenceRevisions: ["evidence-3"],
        }),
      );
      expect(other.decision.outcome).toBe("proactive");
      expect(other.delivered).toBe(true);
    });

    it("suppresses a dismissed opportunity", () => {
      coordinator.dismiss("opportunity", "producer-1");
      const outcome = coordinator.engage(proactiveRequest());

      expect(outcome.decision.outcome).toBe("suppress");
      expect(outcome.decision.reason).toBe("dismissed_opportunity");
      expect(outcome.delivered).toBe(false);
      expect(dismissalRows()).toHaveLength(1);
    });

    it("suppresses a consolidated opportunity after it was dismissed", () => {
      const first = coordinator.engage(proactiveRequest({ dedupKey: "producer-a" }));
      coordinator.dismiss("opportunity", first.opportunity.dedupKey);
      const second = coordinator.engage(proactiveRequest({ dedupKey: "producer-b" }));

      expect(second.decision.outcome).toBe("suppress");
      expect(second.decision.reason).toBe("dismissed_opportunity");
      expect(second.delivered).toBe(false);
    });

    it("honours a dismissal made against the opportunity's row id", () => {
      // The interaction is in the inbox, so nothing has been delivered yet:
      // the dismissal is the only thing that can suppress it.
      const first = coordinator.engage(
        proactiveRequest({ dedupKey: "producer-a", proactiveOptIn: false }),
      );
      expect(first.decision.outcome).toBe("inbox");

      coordinator.dismiss("opportunity", first.opportunity.id);
      const second = coordinator.engage(proactiveRequest({ dedupKey: "producer-b" }));

      expect(second.decision.outcome).toBe("suppress");
      expect(second.decision.reason).toBe("dismissed_opportunity");
      expect(second.delivered).toBe(false);
      expect(deliveryRows()).toHaveLength(0);
      expect(opportunityRows()[0]?.status).toBe("dismissed");
    });

    it("honours a dismissal of a revision a later request cites", () => {
      // The opportunity was recorded against one revision; a later request
      // under the same dedup key cites another one, which was dismissed.
      const first = coordinator.engage(
        proactiveRequest({ dedupKey: "producer-a", evidenceRevisions: ["evidence-1"] }),
      );
      expect(first.decision.outcome).toBe("proactive");
      coordinator.dismiss("evidence", "evidence-2");

      const second = coordinator.engage(
        proactiveRequest({ dedupKey: "producer-a", evidenceRevisions: ["evidence-2"] }),
      );

      expect(second.decision.outcome).toBe("suppress");
      expect(second.decision.reason).toBe("dismissed_evidence");
      expect(second.delivered).toBe(false);
    });

    it("holds a dismissal across a capability that offers the same interaction later", () => {
      // The first capability takes the interaction to the inbox; the
      // operator dismisses it there.
      const first = coordinator.engage(
        proactiveRequest({ dedupKey: "producer-a", proactiveOptIn: false }),
      );
      expect(first.decision.outcome).toBe("inbox");
      coordinator.dismiss("opportunity", first.opportunity.dedupKey);

      // A second capability offers the same subject on the same evidence.
      // It must not slip the interaction past the dismissal.
      const second = coordinator.engage(proactiveRequest({ dedupKey: "producer-b" }));

      expect(second.decision.outcome).toBe("suppress");
      expect(second.decision.reason).toBe("dismissed_opportunity");
      expect(second.delivered).toBe(false);
      expect(deliveryRows()).toHaveLength(0);
      expect(opportunityRows()).toHaveLength(1);
    });

    it("reports the status the store persisted, not the status it wanted", () => {
      // The opportunity was already delivered, so it is terminal: the report
      // must not claim a newer status than the stored row holds.
      const first = coordinator.engage(proactiveRequest());
      const retry = coordinator.engage(proactiveRequest());

      expect(retry.delivered).toBe(false);
      expect(retry.opportunity.status).toBe("delivered");
      expect(opportunityRows().every((row) => row.status === "delivered")).toBe(true);
    });

    it("keeps the stored status of a delivered opportunity when it expires", () => {
      coordinator.engage(proactiveRequest());
      // Past the expiry, the opportunity is suppressed — but its stored
      // status stays "delivered", because that is what the store holds.
      now = NOW + ENGAGEMENT_DEFAULTS.opportunityExpiryMs + 1;

      const outcome = coordinator.engage(proactiveRequest());

      expect(outcome.decision.outcome).toBe("suppress");
      expect(outcome.decision.reason).toBe("expired");
      expect(outcome.opportunity.status).toBe("delivered");
      expect(opportunityRows()[0]?.status).toBe("delivered");
    });

    it("sends unknown activity to the inbox even when the context matches", () => {
      const outcome = coordinator.engage(
        proactiveRequest({
          activity: "unknown",
          context: { subjectType: "observation", subjectId: "observation-1" },
        }),
      );

      expect(outcome.decision.outcome).toBe("inbox");
      expect(outcome.decision.reason).toBe("activity_unknown");
      expect(outcome.delivered).toBe(false);
    });

    it("suppresses an opportunity that rests on a dismissed evidence revision", () => {
      coordinator.dismiss("evidence", "evidence-1");
      const outcome = coordinator.engage(proactiveRequest());

      expect(outcome.decision.outcome).toBe("suppress");
      expect(outcome.decision.reason).toBe("dismissed_evidence");
      expect(outcome.delivered).toBe(false);
    });

    it("suppresses an opportunity recorded after its evidence revision was dismissed", () => {
      coordinator.dismiss("evidence", "evidence-1");
      const outcome = coordinator.engage(
        proactiveRequest({ dedupKey: "producer-later", evidenceRevisions: ["evidence-1"] }),
      );

      expect(outcome.decision.outcome).toBe("suppress");
      expect(outcome.decision.reason).toBe("dismissed_evidence");
    });

    it("never delivers an expired opportunity", () => {
      const outcome = coordinator.engage(proactiveRequest({ expiresAt: NOW - 1 }));

      expect(outcome.decision.outcome).toBe("suppress");
      expect(outcome.decision.reason).toBe("expired");
      expect(outcome.delivered).toBe(false);
      expect(deliveryRows()).toHaveLength(0);
    });

    it("records the default expiry as seven days", () => {
      const outcome = coordinator.engage(proactiveRequest());

      expect(outcome.opportunity.expiresAt).toBe(NOW + ENGAGEMENT_DEFAULTS.opportunityExpiryMs);
      expect(ENGAGEMENT_DEFAULTS.opportunityExpiryMs).toBe(604_800_000);
    });

    it("defers an opportunity that is not eligible yet", () => {
      const eligibleAt = NOW + 3_600_000;
      const outcome = coordinator.engage(proactiveRequest({ eligibleAt }));

      expect(outcome.decision.outcome).toBe("defer");
      expect(outcome.decision.nextEligibleAt).toBe(eligibleAt);
      expect(deliveryRows()).toHaveLength(0);
    });

    it("sends an unknown-activity opportunity to the inbox", () => {
      const outcome = coordinator.engage(proactiveRequest({ activity: "unknown" }));

      expect(outcome.decision.outcome).toBe("inbox");
      expect(outcome.decision.reason).toBe("activity_unknown");
      expect(outcome.intent?.kind).toBe("inbox");
      expect(deliveryRows()).toHaveLength(0);
    });

    it("leaves the financial rows untouched", () => {
      const before = {
        accounts: db.select().from(accounts).all(),
        notes: db.select().from(notes).all(),
        trades: db.select().from(trades).all(),
        executions: db.select().from(executions).all(),
      };

      coordinator.engage(proactiveRequest());
      coordinator.dismiss("evidence", "evidence-1");

      expect(db.select().from(accounts).all()).toEqual(before.accounts);
      expect(db.select().from(notes).all()).toEqual(before.notes);
      expect(db.select().from(trades).all()).toEqual(before.trades);
      expect(db.select().from(executions).all()).toEqual(before.executions);
    });
  });

  describe("the domain boundary", () => {
    it("performs no database side effect when the domain layer is imported", async () => {
      // The journal opens — and migrates — when its module is evaluated, so
      // the domain layer must not reach it at all. The import runs against
      // an empty data directory: a journal that opens leaves its files
      // behind.
      const isolated = mkdtempSync(join(tmpdir(), "journal-engagement-domain-"));
      const previous = process.env.JOURNAL_DATA_DIR;
      process.env.JOURNAL_DATA_DIR = isolated;
      vi.resetModules();
      try {
        const policy = await import("../src/server/intelligence/experience/engagement");
        const interactions = await import("../src/server/intelligence/experience/interactions");
        expect(policy.decideEngagement).toBeTypeOf("function");
        expect(interactions.createEngagementCoordinator).toBeTypeOf("function");
        expect(readdirSync(isolated)).toEqual([]);
      } finally {
        process.env.JOURNAL_DATA_DIR = previous;
        vi.resetModules();
        try {
          rmSync(isolated, { recursive: true, force: true });
        } catch {
          // The journal file is still held by the open handle.
        }
      }
    });

    it("runs its work through the injected transaction seam", () => {
      let calls = 0;
      const seam = <T>(fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T): T => {
        calls += 1;
        return withJournalTransaction(fn);
      };
      const seamCoordinator = createEngagementCoordinator({
        runInTransaction: seam,
        store: createExperienceStore(),
        clock: () => NOW,
      });

      seamCoordinator.engage(proactiveRequest());
      expect(calls).toBe(1);
      seamCoordinator.dismiss("evidence", "evidence-1");
      expect(calls).toBe(2);
    });
  });

  describe("the stored rows", () => {
    it("keeps the opportunity, the delivery and the dismissal apart", () => {
      coordinator.engage(proactiveRequest());
      coordinator.dismiss("evidence", "evidence-1");

      expect(opportunityRows()).toHaveLength(1);
      expect(deliveryRows()).toHaveLength(1);
      expect(dismissalRows()).toHaveLength(1);
      // Each kind holds the status that belongs to it, and no other kind's.
      expect(opportunityRows()[0]?.status).toBe("delivered");
      expect(deliveryRows()[0]?.status).toBe("delivered");
      expect(dismissalRows()[0]?.status).toBe("dismissed");
    });

    it("holds two inserts of the same dedup key to one row", () => {
      const store = createExperienceStore();
      const row = {
        id: "row-1",
        dedupKey: "opportunity/producer-1",
        subjectType: "observation",
        subjectId: "observation-1",
        accountId: ACCOUNT,
        status: "pending" as const,
        eligibleAt: NOW,
        expiresAt: NOW + ENGAGEMENT_DEFAULTS.opportunityExpiryMs,
        evidenceIdsJson: "[]",
        createdAt: NOW,
        updatedAt: NOW,
      };

      const first = withJournalTransaction((tx) => store.insertEngagement(tx, row));
      const second = withJournalTransaction((tx) =>
        store.insertEngagement(tx, { ...row, id: "row-2" }),
      );

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.row.id).toBe("row-1");
      expect(
        db
          .select()
          .from(intelligenceOpportunities)
          .where(eq(intelligenceOpportunities.dedupKey, "opportunity/producer-1"))
          .all(),
      ).toHaveLength(1);
    });

    it("never lets a producer key collide with a reserved namespace", () => {
      coordinator.engage(proactiveRequest({ dedupKey: "delivery/proactive/hostile" }));

      expect(
        engagementRows().filter((row) => row.dedupKey === "delivery/proactive/hostile"),
      ).toHaveLength(0);
      expect(opportunityRows()).toHaveLength(1);
      expect(opportunityRows()[0]?.dedupKey).toBe("opportunity/delivery/proactive/hostile");
    });

    it("reads a delivery row back by its key", () => {
      const outcome = coordinator.engage(proactiveRequest());
      const stored = db
        .select()
        .from(intelligenceOpportunities)
        .where(eq(intelligenceOpportunities.id, outcome.opportunity.id))
        .get();

      expect(stored?.status).toBe("delivered");
      expect(
        db
          .select()
          .from(intelligenceOpportunities)
          .where(like(intelligenceOpportunities.dedupKey, "delivery/proactive/%"))
          .all(),
      ).toHaveLength(1);
    });
  });
});
