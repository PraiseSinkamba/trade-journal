import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import type { ChangeMode } from "../src/server/domain-events";
import {
  AI_INSIGHT_CAPABILITY_VERSION,
  type ReviewQuestionTransport,
} from "../src/server/intelligence/contracts/insights";
import { JOURNAL_CAPABILITY_IDS } from "../src/server/intelligence/contracts/capabilities";
import type { JobRecord } from "../src/server/intelligence/contracts/jobs";
import type { BackgroundEnvironmentReader } from "../src/server/intelligence/contracts/policy";
import type { IntelligenceWorker } from "../src/server/intelligence/composition";

/**
 * The exit evidence of Phase 23: the optional AI insight.
 *
 * A live trade change writes an observation, its review opportunity, one
 * background run and one durable capability job in the same transaction. The
 * worker claims that job later, re-authorises it, reserves the day's attempt,
 * asks the provider outside every write transaction and commits the answer in
 * one fenced transaction that re-checks the claim, the consent, the pinned
 * configuration, the current observation revision and the opportunity's
 * liveness.
 *
 * Every case drives the PRODUCTION worker registration with an injected
 * transport stub and asserts durable rows and observable effects, never an
 * internal call.
 */

// The journal opens its data directory when the module is evaluated, so the
// scratch directory has to exist before the journal module is imported. Every
// module that binds to the journal is therefore imported dynamically as well:
// a static import would run before the environment is in place.
const scratch = mkdtempSync(join(tmpdir(), "journal-review-insight-"));
process.env.JOURNAL_DATA_DIR = scratch;
// Event capture is off in production; the running path is proved here.
process.env.JOURNAL_EVENT_CAPTURE = "1";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const {
  db,
  accounts,
  domainOutbox,
  eventDeliveries,
  executionEvidence,
  executions,
  intelligenceBudgetReservations,
  intelligenceInsights,
  intelligenceJobs,
  intelligenceObservations,
  intelligenceOpportunities,
  intelligencePolicy,
  intelligenceRuns,
  intelligenceSeedCheckpoints,
  intelligenceWorkerLease,
  observationEvidence,
  openConnection,
  settings,
  tradeIdentities,
  tradeIdentityLinks,
  tradeProjectionRevisions,
  tradeRevisionExecutions,
  trades,
} = await import("../src/db");
const { withConnectionTransaction, withJournalTransaction } = await import("../src/db/transaction");
const { insertExecutionsInTx } = await import("../src/server/executions");
const { changeContext } = await import("../src/server/trading/reconcile");
const { setSetting } = await import("../src/server/settings");
const { createJobStore, createEffectStore, JOB_LEASE_MS, MAX_JOB_ATTEMPTS } =
  await import("../src/server/intelligence/infrastructure/jobs");
const { createPolicyStore } =
  await import("../src/server/intelligence/infrastructure/policy-store");
const { createWorkerService } = await import("../src/server/intelligence/infrastructure/worker");
const { createOutboxDispatcher } = await import("../src/server/intelligence/infrastructure/outbox");
const { createReviewQuestionTransport, REVIEW_QUESTION_PROMPT_VERSION } =
  await import("../src/server/intelligence/infrastructure/review-transport");
const { BACKGROUND_DAILY_ATTEMPT_LIMIT } =
  await import("../src/server/intelligence/contracts/policy");
const composition = await import("../src/server/intelligence/composition");
const { createReviewQuestionEnqueuer } =
  await import("../src/server/intelligence/runtime/review-enqueue");
const { createReviewInsightCapability } =
  await import("../src/server/intelligence/runtime/review-insight");
const { createObservationEvidenceReader, createReviewOpportunityReader } =
  await import("../src/server/intelligence/infrastructure/insight-store");
const { REVIEW_QUESTION_SYSTEM_PROMPT, buildReviewQuestionPrompt } =
  await import("../src/server/ai-review-insight");

const { createIntelligenceWorker, createIntelligenceServices } = composition;

const NOW = 1_800_000_000_000;
const OWNER = "review-insight-worker";
const ACCOUNT = "acct-review";
/** The account of the committed control of the rollback case. */
const CONTROL = "acct-control";
const SERVER = "http://localhost:11434/v1";
const MOVED_SERVER = "http://localhost:11435/v1";
const MODEL = "llama-fixture";
const ANSWER = "What would you change about this trade next time?";
/** The duration the stub reports for its call. */
const DURATION_MS = 42;

const jobs = createJobStore(db);
const policyStore = createPolicyStore({ db });

/** The instant the worker's clock reads. A case moves time by changing it. */
let now = NOW;

/** One recorded provider request. */
interface ProviderCall {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly system: string;
  readonly prompt: string;
}

/**
 * The gate the provider is held behind.
 *
 * The answer arrives only when the case releases it, so the world can move
 * while the provider is thinking.
 */
interface ProviderGate {
  /** Resolves once the provider has been asked and is waiting. */
  readonly entered: Promise<void>;
  /** Resolves once the case lets the provider answer. */
  readonly waiting: Promise<void>;
  /** Lets the provider answer. */
  release(): void;
  /** Marks the provider as asked. */
  signalEntered(): void;
}

const createGate = (): ProviderGate => {
  const entered = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    waiting: waiting.promise,
    release: () => waiting.resolve(),
    signalEntered: () => entered.resolve(),
  };
};

/**
 * The provider stub.
 *
 * It records every request it is given and answers what the case asks it to
 * answer: a plain answer, a failure, an answer that is held until the case
 * releases it, or an answer that only arrives when the call is cancelled.
 *
 * The answer carries the metadata of the call, exactly as the real transport
 * does: the run records the prompt version, the provider, the model and the
 * duration of the call that produced the question.
 */
const createTransport = (options: {
  readonly answer?: string;
  readonly failure?: Error;
  readonly gate?: ProviderGate;
  /** The answer waits for the abort signal instead of the case's gate. */
  readonly untilAbort?: boolean;
  /** The token counts the provider reports. */
  readonly tokens?: { readonly inputTokens: number; readonly outputTokens: number };
}): { readonly calls: ProviderCall[]; readonly transport: ReviewQuestionTransport } => {
  const calls: ProviderCall[] = [];
  const transport: ReviewQuestionTransport = {
    ask: async (input) => {
      calls.push({
        provider: input.provider,
        model: input.model,
        baseUrl: input.baseUrl,
        system: input.system,
        prompt: input.prompt,
      });
      const gate = options.gate;
      if (gate) gate.signalEntered();
      if (options.untilAbort) {
        // The answer only arrives when the call is cancelled: the case holds
        // the provider open for exactly as long as it needs.
        const { promise, reject } = Promise.withResolvers<void>();
        const abort = (): void => reject(new Error("The provider call was aborted."));
        if (input.signal.aborted) abort();
        else input.signal.addEventListener("abort", abort, { once: true });
        await promise;
      } else if (gate) {
        await gate.waiting;
      }
      if (options.failure) throw options.failure;
      return {
        text: options.answer ?? ANSWER,
        meta: {
          promptVersion: REVIEW_QUESTION_PROMPT_VERSION,
          provider: input.provider,
          model: input.model,
          durationMs: DURATION_MS,
          ...(options.tokens ?? {}),
        },
      };
    },
  };
  return { calls, transport };
};

/** The production worker registration, on the fixed clock and the stub. */
const createWorker = (transport: ReviewQuestionTransport): IntelligenceWorker =>
  createIntelligenceWorker({ db, clock: () => now, owner: OWNER, transport });

/**
 * The production worker service, with the renewal interval open.
 *
 * The composition wires the worker without the interval, so the case that
 * exercises the lease-lost branch builds the same worker here: the same
 * services, the same job store, the same dispatcher, with the interval the
 * case needs so the renewal happens in milliseconds and not in fifteen
 * seconds.
 */
const createWorkerWithRenewal = (
  transport: ReviewQuestionTransport,
  renewIntervalMs: number,
): IntelligenceWorker => {
  const services = createIntelligenceServices({ db, clock: () => now, transport });
  const store = createJobStore(db);
  return createWorkerService({
    db,
    clock: () => now,
    owner: OWNER,
    jobs: store,
    effects: createEffectStore(),
    dispatcher: createOutboxDispatcher({ db, jobs: store, handlers: services.outboxHandlers }),
    handlers: services.handlers,
    asyncHandlers: [services.capabilityHandler],
    renewIntervalMs,
  });
};

/** Runs the worker until it has nothing left to claim. */
const drain = async (worker: IntelligenceWorker): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await worker.tick(now))) return;
  }
  throw new Error("The worker did not settle.");
};

/**
 * Waits until the condition holds.
 *
 * The lease is renewed on a real timer inside the worker, so the case polls
 * for the effect it wants to observe instead of assuming a duration. Fake
 * timers are not an option here: they would freeze the very clock the worker
 * reads to renew the lease.
 */
const waitFor = async (condition: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("The condition never held.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** An account that owns nothing but the fills the case inserts. */
const createAccount = (id: string): void => {
  db.insert(accounts).values({ id, name: id, kind: "manual", createdAt: "2026-01-01" }).run();
};

const ENTRY_AT = "2026-09-01T10:00:00Z";
const EXIT_AT = "2026-09-01T11:00:00Z";

const entry: ImportedExecution = {
  symbol: "TEST",
  side: "buy",
  quantity: 10,
  price: 100,
  fee: 0,
  executedAt: ENTRY_AT,
};
const exit: ImportedExecution = {
  symbol: "TEST",
  side: "sell",
  quantity: 10,
  price: 102,
  fee: 0,
  executedAt: EXIT_AT,
};

/** Inserts the fill of one open trade, exactly like an ingestion does. */
const insertEntry = (accountId: string, mode: ChangeMode = "live"): void => {
  withJournalTransaction((tx) => {
    insertExecutionsInTx(tx, accountId, [entry], "import", changeContext("user", mode));
  });
};

/** Inserts the fills of one closed trade, exactly like an ingestion does. */
const insertTrade = (accountId: string, mode: ChangeMode = "live"): void => {
  withJournalTransaction((tx) => {
    insertExecutionsInTx(tx, accountId, [entry, exit], "import", changeContext("user", mode));
  });
};

/**
 * The provider configuration of the journal.
 *
 * The compatible server is a fake local URL, so no real network call can ever
 * happen: the transport is a stub.
 */
const configureProvider = (): void => {
  setSetting("aiProvider", "compatible");
  setSetting("compatibleModel", MODEL);
  setSetting("compatibleBaseUrl", SERVER);
};

/** Opts the accounts in to the background policy. */
const enablePolicy = (optedIn: readonly string[]): void => {
  composition.saveBackgroundPolicy({
    enabled: true,
    accounts: [...optedIn],
    capabilities: { tools: false, structuredOutput: false },
    maxInputCharacters: 8000,
  });
};

/** The background runs the journal holds. */
const runRows = () => db.select().from(intelligenceRuns).all();
/** The jobs the journal holds. */
const jobRows = () => db.select().from(intelligenceJobs).all();
/** The capability jobs only: the review question's own job. */
const capabilityJobs = () => jobRows().filter((row) => row.type === "run_capability");
/** The stored questions. */
const insightRows = () => db.select().from(intelligenceInsights).all();
/** The observations the journal holds. */
const observationRows = () => db.select().from(intelligenceObservations).all();
/** The reason a run recorded for its refusal. */
const refusalReason = (): string | null => {
  const raw = runRows()[0]?.metaJson;
  if (!raw) return null;
  const meta = JSON.parse(raw) as { refusalReason?: string };
  return meta.refusalReason ?? null;
};
/** The review opportunities only. */
const opportunityRows = () =>
  db
    .select()
    .from(intelligenceOpportunities)
    .all()
    .filter((row) => row.dedupKey.startsWith("opportunity/"));

/** The delivery job of one committed trade change. */
const deliveryJobFor = (eventId: string) =>
  jobRows().find((row) => {
    const payload = JSON.parse(row.payloadJson) as { eventId?: string };
    return payload.eventId === eventId;
  });

/**
 * The observation handler of the production services.
 *
 * It is the handler the worker runs, with the review enqueue bound to it.
 */
const observationHandler = (() => {
  const services = createIntelligenceServices({ db, clock: () => now });
  const handler = services.handlers.find(
    (candidate) => candidate.id === composition.OBSERVATION_HANDLER_ID,
  );
  if (!handler) throw new Error("The observation handler is not registered.");
  return handler;
})();

/**
 * Hands one job to the observation handler again, the way a redelivery does.
 *
 * The handler reads the committed event and the current revision inside the
 * caller's transaction, so a redelivery is judged by the same fence as the
 * first delivery.
 */
const deliver = (jobId: string): void => {
  const job = jobs.load(jobId);
  if (!job) throw new Error(`No job ${jobId}.`);
  withJournalTransaction((tx) => {
    observationHandler.run(tx, job);
  });
};

/**
 * Runs the observation handler over one live change, in one transaction.
 *
 * The fill, its committed event, its delivery job and the handler's work are
 * one transaction: the throw at the end decides whether it commits.
 */
const deliverChange = (accountId: string, throwAfter: boolean): void => {
  withJournalTransaction((tx) => {
    insertExecutionsInTx(tx, accountId, [entry, exit], "import", changeContext("user", "live"));
    const event = tx.select().from(domainOutbox).all().at(-1);
    if (!event) throw new Error("The trade change was not recorded.");
    const jobId = `job-review-${accountId}`;
    const job: JobRecord = {
      id: jobId,
      type: "evaluate_trade",
      payload: {
        type: "evaluate_trade",
        eventId: event.id,
        handlerId: composition.OBSERVATION_HANDLER_ID,
        handlerVersion: composition.OBSERVATION_HANDLER_VERSION,
      },
      status: "pending",
      attempts: 0,
      availableAt: now,
      owner: null,
      fence: 0,
      leaseUntil: null,
      cancelRequested: false,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(intelligenceJobs)
      .values({
        id: jobId,
        idempotencyKey: `${event.id}:${composition.OBSERVATION_HANDLER_ID}:1`,
        type: "evaluate_trade",
        payloadJson: JSON.stringify(job.payload),
        status: "pending",
        attempts: 0,
        availableAt: now,
        owner: null,
        fence: 0,
        leaseUntil: null,
        cancelRequested: false,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    observationHandler.run(tx, job);
    if (throwAfter) throw new Error("The transaction is rolled back.");
  });
};

beforeEach(() => {
  db.delete(intelligenceInsights).run();
  db.delete(intelligenceBudgetReservations).run();
  db.delete(intelligenceRuns).run();
  db.delete(intelligencePolicy).run();
  db.delete(intelligenceOpportunities).run();
  db.delete(observationEvidence).run();
  db.delete(intelligenceObservations).run();
  db.delete(intelligenceJobs).run();
  db.delete(intelligenceWorkerLease).run();
  db.delete(intelligenceSeedCheckpoints).run();
  db.delete(eventDeliveries).run();
  db.delete(domainOutbox).run();
  db.delete(executionEvidence).run();
  db.delete(tradeRevisionExecutions).run();
  db.delete(tradeProjectionRevisions).run();
  db.delete(tradeIdentityLinks).run();
  db.delete(tradeIdentities).run();
  db.delete(executions).run();
  db.delete(trades).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  now = NOW;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  try {
    db.$client.close();
  } catch {
    // The database file is still held by the open handle.
  }
  rmSync(scratch, { recursive: true, force: true });
});

describe("the review insight", () => {
  it("queues one run and one job for a live trade change", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const { transport } = createTransport({});
    await drain(createWorker(transport));

    const runs = runRows();
    expect(runs).toHaveLength(1);
    const capability = capabilityJobs();
    expect(capability).toHaveLength(1);
    const sourceRevision = observationRows()[0]?.sourceRevision;
    expect(sourceRevision).toBeDefined();
    // The business key is the run's effect key and the job's idempotency key.
    expect(runs[0]?.effectKey).toBe(`insight:1:${ACCOUNT}:${sourceRevision}`);
    expect(capability[0]?.idempotencyKey).toBe(`insight:1:${ACCOUNT}:${sourceRevision}`);
    // The stored question carries the very same key, so one source revision
    // yields one run, one job and one question: the key is the identity of the
    // whole effect, not of one of its rows.
    const insights = insightRows();
    expect(insights).toHaveLength(1);
    expect(insights[0]?.businessKey).toBe(runs[0]?.effectKey);
    expect(insights[0]?.businessKey).toBe(capability[0]?.idempotencyKey);
  });

  it("leaves neither a run nor a job behind when the transaction rolls back", () => {
    createAccount(ACCOUNT);
    createAccount(CONTROL);
    configureProvider();
    enablePolicy([ACCOUNT, CONTROL]);

    // The control: the same work, committed, writes the run and its job.
    deliverChange(CONTROL, false);
    expect(runRows()).toHaveLength(1);
    // The delivery job of the change and the capability job of the question.
    expect(jobRows()).toHaveLength(2);
    expect(capabilityJobs()).toHaveLength(1);

    // The rollback: the same work, thrown away, leaves neither behind.
    expect(() => deliverChange(ACCOUNT, true)).toThrow("The transaction is rolled back.");
    expect(runRows()).toHaveLength(1);
    expect(jobRows()).toHaveLength(2);
    expect(capabilityJobs()).toHaveLength(1);
    // The rolled back change wrote no run, no job, no observation and no
    // opportunity: the control's rows are the only ones left.
    expect(runRows().filter((row) => row.effectKey.includes(ACCOUNT))).toHaveLength(0);
    expect(capabilityJobs().filter((row) => row.idempotencyKey.includes(ACCOUNT))).toHaveLength(0);
    expect(observationRows().filter((row) => row.accountId === ACCOUNT)).toHaveLength(0);
    expect(opportunityRows().filter((row) => row.accountId === ACCOUNT)).toHaveLength(0);
  });

  it("stores the provider's answer as one insight and completes the run", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const { transport, calls } = createTransport({ tokens: { inputTokens: 11, outputTokens: 7 } });
    await drain(createWorker(transport));

    expect(calls).toHaveLength(1);
    const insights = insightRows();
    expect(insights).toHaveLength(1);
    expect(insights[0]?.question).toBe(ANSWER);
    expect(runRows()[0]?.status).toBe("completed");
    // The run records the call that produced the question: the capability, the
    // prompt version, the provider, the model, the duration and the token
    // counts the provider reported. The refusal of an earlier attempt is
    // cleared with an explicit null.
    const meta = JSON.parse(runRows()[0]?.metaJson ?? "{}") as Record<string, unknown>;
    expect(meta).toMatchObject({
      capabilityId: JOURNAL_CAPABILITY_IDS.reviewInsight,
      capabilityVersion: AI_INSIGHT_CAPABILITY_VERSION,
      promptVersion: REVIEW_QUESTION_PROMPT_VERSION,
      provider: "compatible",
      model: MODEL,
      durationMs: DURATION_MS,
      inputTokens: 11,
      outputTokens: 7,
      refusalReason: null,
    });
    // The attempt is reserved and committed before the provider is called, so
    // a crashed attempt keeps its allowance.
    const reservations = db.select().from(intelligenceBudgetReservations).all();
    expect(reservations).toHaveLength(1);
    expect(reservations[0]?.runId).toBe(runRows()[0]?.id);
    expect(reservations[0]?.attempt).toBe(1);
  });

  it("lets another connection write while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);
    // A second, genuinely independent connection to the same journal.
    const second = openConnection(scratch);
    try {
      await worker.tick(now);
      const pending = worker.tick(now);
      await gate.entered;
      // The provider is thinking: no write transaction may be open, so this
      // write must not hit a busy journal.
      withConnectionTransaction(second, (tx) => {
        tx.insert(accounts)
          .values({
            id: "acct-second",
            name: "acct-second",
            kind: "manual",
            createdAt: "2026-01-01",
          })
          .run();
      });
      gate.release();
      await pending;
    } finally {
      second.$client.close();
    }

    expect(insightRows()).toHaveLength(1);
    expect(runRows()[0]?.status).toBe("completed");
  });

  it("stores nothing when the consent is revoked while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    // The operator revokes the consent of the account.
    enablePolicy([]);
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("unavailable");
    expect(refusalReason()).toBe("account_not_opted_in");
  });

  it("stores nothing when the policy is revised while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    // The operator changes what the background policy allows while the
    // provider is thinking: a new revision, the same consent.
    composition.saveBackgroundPolicy({
      enabled: true,
      accounts: [ACCOUNT],
      capabilities: { tools: false, structuredOutput: false },
      maxInputCharacters: 4000,
    });
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("unavailable");
    expect(refusalReason()).toBe("policy_changed");
  });

  it("stores nothing when the endpoint changes while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    // The operator moves the server to another URL.
    setSetting("compatibleBaseUrl", MOVED_SERVER);
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("unavailable");
    expect(refusalReason()).toBe("configuration_changed");
  });

  it("stores nothing when the observation is corrected while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    // The first change opens the trade; the second one closes it and
    // supersedes the observation the answer was made from.
    insertEntry(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    insertTrade(ACCOUNT);
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).not.toBe("completed");
  });

  it("stores nothing when the account is deleted while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    db.delete(accounts).where(eq(accounts.id, ACCOUNT)).run();
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("cancelled");
    expect(refusalReason()).toBe("account_missing");
  });

  it("stores nothing when the claim expires while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    // The lease of the claim runs out while the provider is thinking.
    now += JOB_LEASE_MS + 1;
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    const capability = capabilityJobs()[0];
    expect(capability?.status).not.toBe("completed");
    expect(runRows()[0]?.status).not.toBe("completed");
  });

  it("renews the lease while the provider is thinking and writes nothing when the lease is lost", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    // The answer only arrives when the call is cancelled.
    const { transport } = createTransport({ gate, untilAbort: true });
    // The renewal runs every five milliseconds, so the case never waits the
    // fifteen seconds production waits.
    const worker = createWorkerWithRenewal(transport, 5);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    // The lease is renewed while the provider is thinking: the claim's lease
    // moves forward with the clock.
    const leaseBefore = capabilityJobs()[0]?.leaseUntil ?? 0;
    now += 1_000;
    await waitFor(() => (capabilityJobs()[0]?.leaseUntil ?? 0) > leaseBefore);
    // The lease then runs out: the renewal cannot extend it any more, so the
    // worker loses its claim, cancels the call and throws the answer away.
    now += JOB_LEASE_MS + 1;
    await pending;

    expect(insightRows()).toHaveLength(0);
    const capability = capabilityJobs()[0];
    expect(capability?.lastError).toBe("lease_lost");
    expect(capability?.status).not.toBe("completed");
    expect(runRows()[0]?.status).not.toBe("completed");
  });

  it("stores nothing when the review opportunity is withdrawn while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    // The journal withdraws the review the question was made for: a question
    // about a review nobody will see is a question nobody asked for.
    const opportunity = opportunityRows()[0];
    db.update(intelligenceOpportunities)
      .set({ status: "dismissed", updatedAt: now })
      .where(eq(intelligenceOpportunities.id, opportunity?.id ?? ""))
      .run();
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("cancelled");
    expect(refusalReason()).toBe("opportunity_not_live");
  });

  it("stores nothing when the policy is switched off while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    // The operator switches background AI off while the provider is thinking.
    composition.saveBackgroundPolicy({
      enabled: false,
      accounts: [ACCOUNT],
      capabilities: { tools: false, structuredOutput: false },
      maxInputCharacters: 8000,
    });
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("unavailable");
    expect(refusalReason()).toBe("policy_disabled");
  });

  it("stores nothing when the policy is deleted while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    // The policy document is gone: a run that has no policy authorises
    // nothing.
    db.delete(intelligencePolicy).run();
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("unavailable");
    expect(refusalReason()).toBe("policy_missing");
  });

  it("stores nothing when the policy is corrupted while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    // The newest revision of the policy does not parse: a policy that does
    // not parse authorises nothing either.
    db.insert(intelligencePolicy)
      .values({
        id: "background",
        revision: 99,
        settingsJson: JSON.stringify({ schemaVersion: 1 }),
        recordedAt: now,
      })
      .run();
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("unavailable");
    expect(refusalReason()).toBe("policy_invalid");
  });

  it("stores nothing when the pinned model changes while the answer is held", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const gate = createGate();
    const { transport } = createTransport({ gate });
    const worker = createWorker(transport);

    await worker.tick(now);
    const pending = worker.tick(now);
    await gate.entered;
    // The operator moves the run to another model: the run stays bound to the
    // model it was approved against and is never rerouted.
    setSetting("compatibleModel", "llama-other");
    gate.release();
    await pending;

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("unavailable");
    expect(refusalReason()).toBe("configuration_changed");
  });

  it("keeps one run, one job, one insight and one request after a duplicate delivery", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const { transport, calls } = createTransport({});
    const worker = createWorker(transport);

    await worker.tick(now);
    // The same delivery, again, in a fresh transaction.
    const event = db.select().from(domainOutbox).all().at(-1);
    expect(event).toBeDefined();
    const delivery = deliveryJobFor(event?.id ?? "");
    expect(delivery).toBeDefined();
    deliver(delivery?.id ?? "");
    await drain(worker);

    expect(runRows()).toHaveLength(1);
    expect(capabilityJobs()).toHaveLength(1);
    expect(insightRows()).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("fails the job within the attempt bound when the provider times out", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const { transport, calls } = createTransport({ failure: new Error("The provider timed out.") });
    const worker = createWorker(transport);

    await worker.tick(now);
    // Every attempt spends one job attempt and waits for its retry delay.
    for (let attempt = 0; attempt < MAX_JOB_ATTEMPTS; attempt += 1) {
      await worker.tick(now);
      const capability = capabilityJobs()[0];
      if (!capability || capability.status !== "retry_wait") break;
      now = capability.availableAt;
    }

    const capability = capabilityJobs()[0];
    expect(capability?.status).toBe("failed");
    expect(runRows()[0]?.status).not.toBe("completed");
    expect(insightRows()).toHaveLength(0);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("stores nothing and fails the run when the provider answers with something unusable", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    // The answer is longer than the question the store accepts. The empty
    // answer fails the same schema.
    const { transport } = createTransport({ answer: "x".repeat(5000) });
    await drain(createWorker(transport));

    expect(insightRows()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("failed");
    expect(capabilityJobs()[0]?.status).toBe("failed");
  });

  it("fails a job that names a capability nobody registered", async () => {
    const { transport, calls } = createTransport({});
    const worker = createWorker(transport);
    withJournalTransaction((tx) => {
      jobs.enqueue(
        tx,
        "hand:journal.nope:9",
        {
          type: "run_capability",
          runId: "run-unknown",
          capabilityId: "journal.nope",
          capabilityVersion: "9",
          observationId: "observation-unknown",
        },
        now,
      );
    });

    await worker.tick(now);

    const job = jobRows().find((row) => row.idempotencyKey === "hand:journal.nope:9");
    expect(job?.status).toBe("failed");
    expect(calls).toHaveLength(0);
    expect(runRows()).toHaveLength(0);
    expect(insightRows()).toHaveLength(0);
  });

  it("fails a job that names a capability version nobody registered", async () => {
    const { transport, calls } = createTransport({});
    const worker = createWorker(transport);
    // The right capability id, a version nobody registered: a job is refused
    // for the version it names, never silently upgraded.
    const key = `hand:${JOURNAL_CAPABILITY_IDS.reviewInsight}:999`;
    withJournalTransaction((tx) => {
      jobs.enqueue(
        tx,
        key,
        {
          type: "run_capability",
          runId: "run-unknown",
          capabilityId: JOURNAL_CAPABILITY_IDS.reviewInsight,
          capabilityVersion: "999",
          observationId: "observation-unknown",
        },
        now,
      );
    });

    await worker.tick(now);

    const job = jobRows().find((row) => row.idempotencyKey === key);
    expect(job?.status).toBe("failed");
    expect(job?.lastError).toBe("unhandled_capability");
    expect(calls).toHaveLength(0);
    expect(runRows()).toHaveLength(0);
    expect(insightRows()).toHaveLength(0);
  });

  it("asks no provider and ends the run when the day's allowance is spent", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    const { transport, calls } = createTransport({});
    const worker = createWorker(transport);

    await worker.tick(now);
    const run = runRows()[0];
    expect(run).toBeDefined();
    // The day's allowance is spent before the job runs.
    withJournalTransaction((tx) => {
      for (let attempt = 0; attempt < BACKGROUND_DAILY_ATTEMPT_LIMIT; attempt += 1) {
        policyStore.reserveAttemptInTx(tx, run?.id ?? "", now);
      }
    });
    await worker.tick(now);

    expect(calls).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("unavailable");
    expect(insightRows()).toHaveLength(0);
  });

  it("queues nothing when the account never opted in", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([]);
    insertTrade(ACCOUNT);
    const { transport, calls } = createTransport({});
    await drain(createWorker(transport));

    expect(runRows()).toHaveLength(0);
    expect(capabilityJobs()).toHaveLength(0);
    expect(insightRows()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("queues neither a run nor a job for a historical or a maintenance delivery", async () => {
    createAccount(ACCOUNT);
    createAccount(CONTROL);
    configureProvider();
    enablePolicy([ACCOUNT, CONTROL]);
    // A reconstruction is not the trader's own experience, and a maintenance
    // change is not a trade at all: neither is worth a question.
    insertTrade(ACCOUNT, "historical");
    insertTrade(CONTROL, "maintenance");
    const { transport, calls } = createTransport({});
    await drain(createWorker(transport));

    // The changes are observed all the same: only the question is withheld.
    expect(observationRows()).toHaveLength(2);
    expect(runRows()).toHaveLength(0);
    expect(capabilityJobs()).toHaveLength(0);
    expect(insightRows()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("refuses the whole delivery when the account no longer exists", () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    // The operator deletes the account before the change is delivered.
    db.delete(accounts).where(eq(accounts.id, ACCOUNT)).run();
    // The change belongs to an account that is gone, so the journal refuses it
    // and keeps neither a run nor a job for it.
    // The delivery itself is refused before the enqueue is ever reached: the
    // executions write requires the account row, so the transaction rolls
    // back earlier than the enqueue's own account gate. That gate has its
    // own case below.
    expect(() => deliverChange(ACCOUNT, false)).toThrow();
    expect(runRows()).toHaveLength(0);
    expect(capabilityJobs()).toHaveLength(0);
    expect(insightRows()).toHaveLength(0);
  });

  it("queues neither a run nor a job when the enqueue's own account gate refuses the account", () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    // The review-free handler: the production enqueue never runs, so the
    // enqueue's own account gate is the only check that can refuse the trade.
    const reviewFreeHandler = composition.createTradeObservationHandler({ clock: () => now });
    withJournalTransaction((tx) => {
      insertExecutionsInTx(tx, ACCOUNT, [entry, exit], "import", changeContext("user", "live"));
      const event = tx.select().from(domainOutbox).all().at(-1);
      if (!event) throw new Error("The trade change was not recorded.");
      const jobId = `job-review-${ACCOUNT}`;
      const job: JobRecord = {
        id: jobId,
        type: "evaluate_trade",
        payload: {
          type: "evaluate_trade",
          eventId: event.id,
          handlerId: composition.OBSERVATION_HANDLER_ID,
          handlerVersion: composition.OBSERVATION_HANDLER_VERSION,
        },
        status: "pending",
        attempts: 0,
        availableAt: now,
        owner: null,
        fence: 0,
        leaseUntil: null,
        cancelRequested: false,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(intelligenceJobs)
        .values({
          id: jobId,
          idempotencyKey: `${event.id}:${composition.OBSERVATION_HANDLER_ID}:1`,
          type: "evaluate_trade",
          payloadJson: JSON.stringify(job.payload),
          status: "pending",
          attempts: 0,
          availableAt: now,
          owner: null,
          fence: 0,
          leaseUntil: null,
          cancelRequested: false,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      reviewFreeHandler.run(tx, job);
    });

    const observationId = observationRows()[0]?.id;
    if (!observationId) throw new Error("The observation was not persisted.");

    // The journal reports that it holds no account at all, so the enqueue's
    // own account gate refuses the trade even though the row is still there.
    const environment: BackgroundEnvironmentReader = {
      readEnvironmentInTx: () => ({
        existingAccountIds: [],
        providerConfigured: true,
        providerConfiguration: { provider: "compatible", model: MODEL, baseUrl: SERVER },
      }),
    };
    const enqueuer = createReviewQuestionEnqueuer({
      capability: createReviewInsightCapability({
        system: REVIEW_QUESTION_SYSTEM_PROMPT,
        build: buildReviewQuestionPrompt,
      }),
      runs: policyStore,
      jobs,
      observations: createObservationEvidenceReader(),
      opportunities: createReviewOpportunityReader(),
      environment,
      clock: () => now,
    });
    withJournalTransaction((tx) => {
      enqueuer.enqueueInTx(tx, { observationId, mode: "live", timeZone: "UTC" });
    });

    // The trade was observed and its opportunity is live, so the refusal came
    // from the enqueue's own account gate and from nothing else.
    expect(observationRows()).toHaveLength(1);
    expect(opportunityRows()).toHaveLength(1);
    expect(runRows()).toHaveLength(0);
    expect(capabilityJobs()).toHaveLength(0);
    expect(insightRows()).toHaveLength(0);
  });

  it("keeps the deterministic review working without a background policy", async () => {
    createAccount(ACCOUNT);
    insertTrade(ACCOUNT);
    const { transport, calls } = createTransport({});
    await drain(createWorker(transport));

    expect(observationRows()).toHaveLength(1);
    expect(opportunityRows()).toHaveLength(1);
    expect(runRows()).toHaveLength(0);
    expect(capabilityJobs()).toHaveLength(0);
    expect(insightRows()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("states that the holding time is unknown when the journal did not know it", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    // The source did not report the times, so the journal nulls the holding
    // time: the question must not state one the journal never had.
    withJournalTransaction((tx) => {
      insertExecutionsInTx(
        tx,
        ACCOUNT,
        [entry, exit],
        "import",
        changeContext("user", "live"),
        undefined,
        {
          quality: () => ({
            timingQuality: "reconstructed",
            sourceKind: "ctrader_synthetic_open",
          }),
        },
      );
    });
    const { transport, calls } = createTransport({});
    await drain(createWorker(transport));

    expect(calls).toHaveLength(1);
    const prompt = calls.at(0)?.prompt ?? "";
    expect(prompt).toContain("holding time: unknown");
    expect(prompt).toContain("timing quality: reconstructed");
    expect(prompt).not.toContain("3600000");
    expect(prompt).not.toContain("3600000 ms");
  });

  it("asks the pinned provider and hides the account from the prompt", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    insertTrade(ACCOUNT);
    // A credential that must never reach the prompt.
    vi.stubEnv("OPENAI_API_KEY", "sk-review-secret");
    const { transport, calls } = createTransport({});
    await drain(createWorker(transport));

    expect(calls).toHaveLength(1);
    const call = calls.at(0);
    expect(call?.provider).toBe("compatible");
    expect(call?.model).toBe(MODEL);
    expect(call?.baseUrl).toBe(SERVER);
    // The prompt carries the trade and nothing that identifies the account.
    expect(call?.prompt).toContain("symbol: TEST");
    expect(call?.prompt).toContain("status: win");
    expect(call?.prompt).not.toContain(ACCOUNT);
    expect(call?.prompt).not.toContain("sk-review-secret");
    expect(call?.system).not.toContain(ACCOUNT);
    expect(call?.system).not.toContain("sk-review-secret");
    const observation = observationRows()[0];
    expect(call?.prompt).not.toContain(observation?.id ?? "");
    const tradeKey = db.select().from(tradeProjectionRevisions).all()[0]?.tradeKey;
    expect(tradeKey).toBeDefined();
    expect(call?.prompt).not.toContain(tradeKey ?? "");
  });

  it("asks the real transport against a local server", async () => {
    // A local server answers the provider request, so the real adapter runs
    // without a request ever leaving the machine.
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "chatcmpl_local",
            object: "chat.completion",
            created: 1,
            model: MODEL,
            choices: [
              { index: 0, message: { role: "assistant", content: ANSWER }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      const transport = createReviewQuestionTransport();
      const answer = await transport.ask({
        provider: "compatible",
        model: MODEL,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        system: "System",
        prompt: "Prompt",
        signal: new AbortController().signal,
      });

      expect(answer.text).toBe(ANSWER);
      expect(answer.meta.promptVersion).toBe(REVIEW_QUESTION_PROMPT_VERSION);
      expect(answer.meta.provider).toBe("compatible");
      expect(answer.meta.model).toBe(MODEL);
    } finally {
      // The server leaves no handle behind: the pooled connection is closed
      // with it.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses a capability job's run in the legacy background path", async () => {
    createAccount(ACCOUNT);
    configureProvider();
    enablePolicy([ACCOUNT]);
    // The change that raises the observation and queues the capability job.
    deliverChange(ACCOUNT, false);
    const run = runRows()[0];
    expect(run).toBeDefined();

    // The legacy path handles no capability: it refuses the run before it
    // reserves an attempt and before it reaches a provider, so a bare
    // provider response can never complete a capability job's run.
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await composition.executeBackgroundRun({
      runId: run?.id ?? "",
      system: "System",
      prompt: "Prompt",
      signal: new AbortController().signal,
      now: NOW,
    });

    expect(result).toMatchObject({ status: "failed", reason: "unhandled_capability" });
    expect(fetcher).not.toHaveBeenCalled();
    // The run is untouched: the fenced final transaction of the capability
    // job is the only way to finish it.
    expect(runRows()[0]?.status).not.toBe("completed");
    expect(db.select().from(intelligenceBudgetReservations).all()).toHaveLength(0);
    expect(insightRows()).toHaveLength(0);
  });
});
