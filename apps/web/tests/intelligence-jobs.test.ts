import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobPayload } from "../src/server/intelligence/contracts/jobs";

/**
 * Durable jobs and fenced claims (Phase 04).
 *
 * A job is claimed atomically, the claim carries a fencing token, and every
 * completion is guarded by that token: a worker whose lease was taken over can
 * no longer acknowledge the work it started.
 *
 * Every case runs against a disposable journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-jobs-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const {
  db,
  openConnection,
  domainOutbox,
  eventDeliveries,
  intelligenceJobs,
  withJournalTransaction,
} = await import("../src/db");
const { createJobStore, createEffectStore, JOB_LEASE_MS, MAX_JOB_ATTEMPTS } =
  await import("../src/server/intelligence/infrastructure/jobs");

const NOW = 1_800_000_000_000;
const OWNER = "worker-a";
const OTHER = "worker-b";

const payload = (
  overrides: Partial<Extract<JobPayload, { type: "evaluate_trade" }>> = {},
): JobPayload => ({
  type: "evaluate_trade",
  eventId: "evt-1",
  handlerId: "trade-evaluator",
  handlerVersion: "1",
  ...overrides,
});

/** The store under test, on the journal's own connection. */
const jobs = createJobStore(db);
const effects = createEffectStore();

const jobRows = () => db.select().from(intelligenceJobs).all();
const jobRow = (id: string) => jobRows().find((row) => row.id === id);
const deliveryRows = () => db.select().from(eventDeliveries).all();

const enqueue = (key = "evt-1:trade-evaluator:1", value = payload()): string =>
  withJournalTransaction((tx) => jobs.enqueue(tx, key, value, NOW));

/**
 * A delivery row, with the outbox event it belongs to.
 *
 * The delivery carries a foreign key to the event, so the event has to exist
 * before a delivery can point at it.
 */
const withDelivery = (jobId: string, eventId = "evt-1"): void => {
  withJournalTransaction((tx) => {
    tx.insert(domainOutbox)
      .values({
        id: eventId,
        type: "trade.projection_changed",
        schemaVersion: 1,
        aggregateType: "trade",
        aggregateId: "trade-1",
        aggregateRevision: 1,
        correlationId: "corr-1",
        origin: "import",
        accountId: "acct-1",
        payloadJson: "{}",
        recordedAt: NOW,
        dispatchedAt: null,
      })
      .onConflictDoNothing()
      .run();
    tx.insert(eventDeliveries)
      .values({
        eventId,
        handlerId: "trade-evaluator",
        handlerVersion: "1",
        state: "pending",
        jobId,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .onConflictDoNothing()
      .run();
  });
};

beforeEach(() => {
  db.delete(eventDeliveries).run();
  db.delete(intelligenceJobs).run();
  db.delete(domainOutbox).run();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("enqueuing a job", () => {
  it("stores the job and returns its id", () => {
    const id = enqueue();

    const rows = jobRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      idempotencyKey: "evt-1:trade-evaluator:1",
      type: "evaluate_trade",
      status: "pending",
      attempts: 0,
      owner: null,
      fence: 0,
    });
    expect(JSON.parse(rows[0]!.payloadJson)).toMatchObject({
      type: "evaluate_trade",
      eventId: "evt-1",
    });
  });

  it("keeps one job when the same idempotency key is used twice", () => {
    const first = enqueue();
    const second = enqueue();

    expect(second).toBe(first);
    expect(jobRows()).toHaveLength(1);
  });
});

describe("claiming a job", () => {
  it("returns a claim with a fencing token and takes the job out of reach", () => {
    enqueue();

    const claim = jobs.claim(OWNER, NOW);

    expect(claim).toMatchObject({ owner: OWNER, fence: 1, leaseUntil: NOW + JOB_LEASE_MS });
    expect(jobRows()[0]).toMatchObject({ status: "running", owner: OWNER, attempts: 1 });
    expect(jobs.claim(OTHER, NOW)).toBeNull();
  });

  it("lets a second connection claim nothing while the lease is live", () => {
    enqueue();
    const second = openConnection(scratch);
    try {
      const otherJobs = createJobStore(second);

      expect(jobs.claim(OWNER, NOW)).not.toBeNull();
      expect(otherJobs.claim(OTHER, NOW)).toBeNull();
    } finally {
      second.$client.close();
    }
  });

  it("reclaims an expired lease with a higher fence", () => {
    enqueue();
    const second = openConnection(scratch);
    try {
      const otherJobs = createJobStore(second);
      const first = jobs.claim(OWNER, NOW)!;

      const expired = NOW + JOB_LEASE_MS + 1;
      const takeover = otherJobs.claim(OTHER, expired);

      expect(takeover).not.toBeNull();
      expect(takeover!.owner).toBe(OTHER);
      expect(takeover!.fence).toBeGreaterThan(first.fence);
      expect(jobRows()[0]).toMatchObject({ status: "running", owner: OTHER });
    } finally {
      second.$client.close();
    }
  });

  it("does not claim a cancelled job", () => {
    const id = enqueue();
    jobs.cancel(id);

    expect(jobs.claim(OWNER, NOW)).toBeNull();
    expect(jobRow(id)).toMatchObject({ status: "cancelled", cancelRequested: true });
  });
});

describe("fenced completion", () => {
  it("rejects the completion of an owner whose lease was taken over", () => {
    enqueue();
    const second = openConnection(scratch);
    try {
      const otherJobs = createJobStore(second);
      const stale = jobs.claim(OWNER, NOW)!;
      const expired = NOW + JOB_LEASE_MS + 1;
      const takeover = otherJobs.claim(OTHER, expired)!;

      expect(() => withJournalTransaction((tx) => effects.complete(tx, stale, expired))).toThrow(
        /stale/i,
      );
      expect(() => withJournalTransaction((tx) => effects.assertClaim(tx, stale, expired))).toThrow(
        /stale/i,
      );
      expect(jobRow(stale.jobId)).toMatchObject({ owner: OTHER, fence: takeover.fence });
    } finally {
      second.$client.close();
    }
  });

  it("rejects a claim from another owner, an expired lease and a cancelled job", () => {
    const id = enqueue();
    const claim = jobs.claim(OWNER, NOW)!;

    expect(() =>
      withJournalTransaction((tx) => effects.assertClaim(tx, { ...claim, owner: OTHER }, NOW)),
    ).toThrow(/stale/i);
    expect(() =>
      withJournalTransaction((tx) =>
        effects.assertClaim(tx, { ...claim, fence: claim.fence + 1 }, NOW),
      ),
    ).toThrow(/stale/i);
    expect(() =>
      withJournalTransaction((tx) => effects.assertClaim(tx, claim, NOW + JOB_LEASE_MS + 1)),
    ).toThrow(/expired/i);

    jobs.cancel(id);
    expect(() => withJournalTransaction((tx) => effects.assertClaim(tx, claim, NOW))).toThrow(
      /cancel/i,
    );
  });

  it("renews the lease for the current owner only", () => {
    enqueue();
    const claim = jobs.claim(OWNER, NOW)!;

    expect(jobs.renew(claim, NOW + 1_000)).toBe(true);
    expect(jobs.renew({ ...claim, fence: claim.fence + 1 }, NOW + 1_000)).toBe(false);
    expect(jobs.renew({ ...claim, owner: OTHER }, NOW + 1_000)).toBe(false);
    expect(jobRow(claim.jobId)!.leaseUntil).toBe(NOW + 1_000 + JOB_LEASE_MS);
  });

  it("writes the effect and the acknowledgement in one transaction", () => {
    const id = enqueue();
    const claim = jobs.claim(OWNER, NOW)!;
    withDelivery(id);

    withJournalTransaction((tx) => effects.complete(tx, claim, NOW));

    expect(jobRow(id)).toMatchObject({ status: "completed" });
    expect(deliveryRows()[0]).toMatchObject({ state: "delivered" });
  });

  it("rolls the effect back when the acknowledgement is refused", () => {
    const id = enqueue();
    const claim = jobs.claim(OWNER, NOW)!;
    const second = openConnection(scratch);
    try {
      const otherJobs = createJobStore(second);
      const expired = NOW + JOB_LEASE_MS + 1;
      otherJobs.claim(OTHER, expired);
      withDelivery(id);

      expect(() => withJournalTransaction((tx) => effects.complete(tx, claim, expired))).toThrow(
        /stale/i,
      );
    } finally {
      second.$client.close();
    }

    // The effect and the acknowledgement died together.
    expect(deliveryRows()[0]).toMatchObject({ state: "pending" });
    expect(jobRow(id)).toMatchObject({ status: "running", owner: OTHER });
  });
});

describe("failing a job", () => {
  it("retries with the 1/5/30/120 second backoff and fails after five attempts", () => {
    const id = enqueue();
    let now = NOW;

    for (const delay of [1_000, 5_000, 30_000, 120_000]) {
      const claim = jobs.claim(OWNER, now)!;
      expect(jobs.fail(claim, "boom", now, true)).toBe(true);
      expect(jobRow(id)).toMatchObject({ status: "retry_wait", availableAt: now + delay });
      now += delay;
    }

    const last = jobs.claim(OWNER, now)!;
    expect(jobRow(id)!.attempts).toBe(MAX_JOB_ATTEMPTS);
    expect(jobs.fail(last, "boom", now, true)).toBe(true);
    expect(jobRow(id)).toMatchObject({ status: "failed", lastError: "boom" });
  });

  it("fails a validation error immediately without a retry", () => {
    const id = enqueue();
    const claim = jobs.claim(OWNER, NOW)!;

    expect(jobs.fail(claim, "invalid_payload", NOW, false)).toBe(true);
    expect(jobRow(id)).toMatchObject({ status: "failed", lastError: "invalid_payload" });
  });

  it("refuses to fail a claim that was taken over", () => {
    enqueue();
    const claim = jobs.claim(OWNER, NOW)!;

    expect(jobs.fail({ ...claim, fence: claim.fence + 1 }, "boom", NOW, true)).toBe(false);
    expect(jobRows()[0]).toMatchObject({ status: "running" });
  });
});
