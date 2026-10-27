import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { JobPayload, JobRecord } from "../src/server/intelligence/contracts/jobs";

/**
 * The durable worker (Phase 04).
 *
 * One worker holds the journal's lease, claims one job at a time, and commits
 * the effect together with the acknowledgement. A worker that lost the lease
 * cannot take work, and a worker whose job was taken over cannot acknowledge
 * it.
 *
 * Every case runs against a disposable journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-worker-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const {
  db,
  openConnection,
  eventDeliveries,
  intelligenceJobs,
  intelligenceWorkerLease,
  withJournalTransaction,
} = await import("../src/db");
const { createJobStore, createEffectStore } =
  await import("../src/server/intelligence/infrastructure/jobs");
const { createWorkerService } = await import("../src/server/intelligence/infrastructure/worker");
const { createOutboxDispatcher } = await import("../src/server/intelligence/infrastructure/outbox");

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

const jobs = createJobStore(db);
const effects = createEffectStore();

/** The worker's own view of the journal, with a table the test can count. */
db.$client.exec("CREATE TABLE IF NOT EXISTS worker_effects (job_id TEXT PRIMARY KEY)");

const effectCount = () =>
  (db.$client.prepare("SELECT count(*) AS n FROM worker_effects").get() as { n: number }).n;

const jobRows = () => db.select().from(intelligenceJobs).all();
const jobRow = (id: string) => jobRows().find((row) => row.id === id);

const enqueue = (value = payload()): string =>
  withJournalTransaction((tx) => jobs.enqueue(tx, `evt-1:trade-evaluator:1`, value, NOW));

/** A worker that records one effect row per executed job. */
const worker = (overrides: Partial<Parameters<typeof createWorkerService>[0]> = {}) =>
  createWorkerService({
    db,
    jobs,
    effects,
    dispatcher: createOutboxDispatcher({ db, jobs, handlers: [] }),
    handlers: [
      {
        id: "trade-evaluator",
        version: "1",
        run: (tx: Parameters<Parameters<typeof withJournalTransaction>[0]>[0], job: JobRecord) => {
          tx.run(sql`INSERT INTO worker_effects (job_id) VALUES (${job.id})`);
        },
      },
    ],
    clock: () => NOW,
    owner: OWNER,
    ...overrides,
  });

beforeEach(() => {
  db.$client.exec("DELETE FROM worker_effects");
  db.delete(eventDeliveries).run();
  db.delete(intelligenceJobs).run();
  // The worker lease is a singleton row; every case starts without one.
  db.delete(intelligenceWorkerLease).run();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("the worker lease", () => {
  it("takes the lease and reports its state and heartbeat", async () => {
    const service = worker();

    expect(await service.tick(NOW)).toBe(false);

    expect(service.status()).toMatchObject({
      state: "idle",
      owner: OWNER,
      leaseHeld: true,
      lastHeartbeatAt: NOW,
    });
  });

  it("blocks a second worker while the lease is live", async () => {
    const first = worker();
    await first.tick(NOW);

    const second = worker({ owner: OTHER });
    expect(await second.tick(NOW)).toBe(false);

    expect(second.status()).toMatchObject({ state: "blocked", leaseHeld: false });
  });

  it("lets a second worker take over an expired lease", async () => {
    const first = worker();
    await first.tick(NOW);

    const expired = NOW + 30_001;
    const second = worker({ owner: OTHER });
    await second.tick(expired);

    expect(second.status()).toMatchObject({ state: "idle", leaseHeld: true, owner: OTHER });
    // The first worker lost the lease and can no longer renew it.
    await first.tick(expired + 1);
    expect(first.status()).toMatchObject({ state: "blocked", leaseHeld: false });
  });
});

describe("executing a job", () => {
  it("runs the handler once and commits the effect with the acknowledgement", async () => {
    const id = enqueue();
    const service = worker();

    expect(await service.tick(NOW)).toBe(true);

    expect(effectCount()).toBe(1);
    expect(jobRow(id)).toMatchObject({ status: "completed", owner: OWNER });
    expect(service.status()).toMatchObject({ processed: 1, failed: 0 });
  });

  it("does not execute a job another worker holds", async () => {
    const id = enqueue();
    const second = openConnection(scratch);
    try {
      // Another worker holds the job with a live lease.
      createJobStore(second).claim(OTHER, NOW);

      const service = worker();
      expect(await service.tick(NOW)).toBe(false);

      expect(effectCount()).toBe(0);
      expect(jobRow(id)).toMatchObject({ status: "running", owner: OTHER });
    } finally {
      second.$client.close();
    }
  });

  it("never executes a cancelled job", async () => {
    const id = enqueue();
    jobs.cancel(id);

    const service = worker();
    expect(await service.tick(NOW)).toBe(false);

    expect(effectCount()).toBe(0);
    expect(jobRow(id)).toMatchObject({ status: "cancelled" });
  });

  it("fails a job whose handler is unknown instead of retrying it forever", async () => {
    const id = enqueue(payload({ handlerId: "missing-handler" }));
    const service = worker();

    expect(await service.tick(NOW)).toBe(true);

    expect(effectCount()).toBe(0);
    expect(jobRow(id)).toMatchObject({ status: "failed", attempts: 1, lastError: "unhandled_job" });
    expect(service.status()).toMatchObject({ failed: 1 });
  });

  it("retries a failing handler with the backoff and gives up after five attempts", async () => {
    const id = enqueue();
    const service = worker({
      handlers: [
        {
          id: "trade-evaluator",
          version: "1",
          run: () => {
            throw new Error("handler exploded");
          },
        },
      ],
    });

    let now = NOW;
    for (const delay of [1_000, 5_000, 30_000, 120_000]) {
      await service.tick(now);
      expect(jobRow(id)).toMatchObject({ status: "retry_wait", availableAt: now + delay });
      now += delay;
    }

    await service.tick(now);
    expect(jobRow(id)).toMatchObject({ status: "failed" });
  });
});

describe("a disabled worker", () => {
  it("leaves the pending work untouched", async () => {
    const id = enqueue();
    const service = worker({ enabled: false });

    expect(await service.tick(NOW)).toBe(false);

    expect(jobRow(id)).toMatchObject({ status: "pending", owner: null });
    expect(effectCount()).toBe(0);
    expect(service.status()).toMatchObject({ state: "disabled", leaseHeld: false });
  });
});

describe("the worker lifecycle", () => {
  it("starts, processes the backlog and stops", async () => {
    const id = enqueue();
    let processed: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      processed = resolve;
    });
    const service = worker({
      pollIntervalMs: 5,
      handlers: [
        {
          id: "trade-evaluator",
          version: "1",
          run: (
            tx: Parameters<Parameters<typeof withJournalTransaction>[0]>[0],
            job: JobRecord,
          ) => {
            tx.run(sql`INSERT INTO worker_effects (job_id) VALUES (${job.id})`);
            processed();
          },
        },
      ],
    });

    const handle = await service.start(new AbortController().signal);
    await done;
    await handle.stop();

    expect(effectCount()).toBe(1);
    expect(jobRow(id)).toMatchObject({ status: "completed" });
  });
});
