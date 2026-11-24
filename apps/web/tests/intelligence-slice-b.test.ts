import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray, like } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import type { ReviewQuestionTransport } from "../src/server/intelligence/contracts/insights";
import type { IntelligenceWorker } from "../src/server/intelligence/composition";
import { workflowActionId, commandRequestBody } from "../src/lib/intelligence-interactions";
import type { InteractionIntent } from "../src/lib/intelligence-interactions";
import { createExperienceStore } from "../src/server/intelligence/infrastructure/experience-store";
import { createEngagementCoordinator } from "../src/server/intelligence/experience/interactions";
import { buildOpportunityRequest } from "../src/server/intelligence/experience/producer";

/**
 * The Slice B gate (Phase 19).
 *
 * The whole chain runs here: a committed trade change, the worker, the
 * observation, the opportunity, the engagement decision, the operator's
 * command and the knowledge the command leaves behind. Every case asserts
 * durable rows, never an internal call.
 */

// The session of the operator is mocked the way the Phase 18 route suite
// mocks it: the route reads the session through next/headers, so the mock
// hands out the token the holder carries.
const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (session.token ? { value: session.token } : undefined) }),
}));

const scratch = mkdtempSync(join(tmpdir(), "journal-slice-b-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
// A static import cannot work here: the import would run before the
// environment is set.
const journal = await import("../src/db");
const {
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
  intelligenceWorkflows,
  interactionCommands,
  observationEvidence,
  settings,
  tradeIdentities,
  tradeIdentityLinks,
  tradeProjectionRevisions,
  tradeRevisionExecutions,
  trades,
  workflowTransitions,
} = journal;
// The handle is rebound when a case reopens the journal, so the cleanup
// always runs against the journal that is open.
let db = journal.db;
// The modules below capture the handle when they are first evaluated, so a
// case that reopens the journal imports them again.
let { withJournalTransaction } = await import("../src/db/transaction");
let { insertExecutionsInTx } = await import("../src/server/executions");
let { changeContext } = await import("../src/server/trading/reconcile");
const { createJobStore, createEffectStore } =
  await import("../src/server/intelligence/infrastructure/jobs");
const { createWorkerService } = await import("../src/server/intelligence/infrastructure/worker");
const { createOutboxDispatcher } = await import("../src/server/intelligence/infrastructure/outbox");
let composition = await import("../src/server/intelligence/composition");
let serverSettings = await import("../src/server/settings");
const { sessionToken } = await import("../src/server/auth");
let { GET: getControls, POST: postControls } =
  await import("../src/app/api/intelligence/controls/route");
let { GET: getObservations, POST: postObservations } =
  await import("../src/app/api/intelligence/observations/route");
let { POST: postCommands } = await import("../src/app/api/intelligence/commands/route");
let { currentInsightOf } = await import("../src/app/api/intelligence/queries");
const { REVIEW_QUESTION_PROMPT_VERSION } =
  await import("../src/server/intelligence/infrastructure/review-transport");

const NOW = 1_800_000_000_000;
const OWNER = "slice-b-worker";

/**
 * The journal handle the connection module caches on globalThis.
 *
 * The restart drops the cached handle, so the re-evaluated module opens the
 * journal again instead of handing back the closed one.
 */
const journalGlobal = globalThis as unknown as {
  __journalDb?: unknown;
  __journalDbDir?: unknown;
};

let jobs = createJobStore(db);
const effects = createEffectStore();
let dispatcher = createOutboxDispatcher({
  db,
  jobs,
  handlers: composition.observationOutboxHandlers,
});
// The real handler, on a fixed clock: the whole chain runs on the instant
// the case chooses.
let observationHandler = composition.createTradeObservationHandler({ clock: () => NOW });

/** The worker that observes the committed trade changes of this scratch journal. */
let worker = createWorkerService({
  db,
  jobs,
  effects,
  dispatcher,
  handlers: [observationHandler],
  clock: () => NOW,
  owner: OWNER,
});

/**
 * The engagement coordinator on the scratch journal, on a fixed clock.
 *
 * It is the real coordinator: the case only injects the clock, so the
 * decision it reports is the decision the running path made.
 */
let coordinator = createEngagementCoordinator({
  runInTransaction: withJournalTransaction,
  store: createExperienceStore(),
  clock: () => NOW,
});

/** Runs a worker until it has nothing left to claim. */
const drainWorker = async (target: { tick(now: number): Promise<boolean> }): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await target.tick(NOW))) return;
  }
  throw new Error("The worker did not settle.");
};

/** Runs the worker until it has nothing left to claim. */
const drain = async (): Promise<void> => drainWorker(worker);

/**
 * Closes the journal, opens it again on the same directory and rebinds every
 * module that captured the closed handle.
 *
 * The route module reads the journal through the module it imported, so a
 * journal that was reopened needs a route module that was imported again.
 */
const reopenJournal = async (): Promise<{
  readonly GET: (request: Request) => Promise<Response>;
}> => {
  db.$client.close();
  delete journalGlobal.__journalDb;
  delete journalGlobal.__journalDbDir;
  vi.resetModules();
  const reopened = await import("../src/db");
  db = reopened.db;
  ({ withJournalTransaction } = await import("../src/db/transaction"));
  ({ insertExecutionsInTx } = await import("../src/server/executions"));
  ({ changeContext } = await import("../src/server/trading/reconcile"));
  composition = await import("../src/server/intelligence/composition");
  serverSettings = await import("../src/server/settings");
  ({ GET: getControls, POST: postControls } =
    await import("../src/app/api/intelligence/controls/route"));
  ({ GET: getObservations, POST: postObservations } =
    await import("../src/app/api/intelligence/observations/route"));
  ({ POST: postCommands } = await import("../src/app/api/intelligence/commands/route"));
  jobs = createJobStore(db);
  dispatcher = createOutboxDispatcher({
    db,
    jobs,
    handlers: composition.observationOutboxHandlers,
  });
  observationHandler = composition.createTradeObservationHandler({ clock: () => NOW });
  worker = createWorkerService({
    db,
    jobs,
    effects,
    dispatcher,
    handlers: [observationHandler],
    clock: () => NOW,
    owner: OWNER,
  });
  coordinator = createEngagementCoordinator({
    runInTransaction: withJournalTransaction,
    store: createExperienceStore(),
    clock: () => NOW,
  });
  return { GET: getObservations };
};

/** The question the provider answers when the case does not care which one. */
const QUESTION = "What would you change about this trade next time?";
/** The question the first account's trade is answered with. */
const ALPHA_QUESTION = "What would you change about the entry of the ALPHA trade?";
/** The question the second account's trade is answered with. */
const BETA_QUESTION = "What would you change about the entry of the BETA trade?";

/** The model the journal is configured to ask. */
const MODEL = "llama-fixture";
/** The endpoint the journal is configured to ask. It never runs: the transport is a stub. */
const SERVER = "http://localhost:11434/v1";
/** The owner of the production worker that runs the provider leg. */
const PROVIDER_OWNER = "slice-b-provider";

/** One provider request the stub recorded. */
interface ProviderCall {
  readonly provider: string;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly system: string;
  readonly prompt: string;
}

/**
 * The provider stub.
 *
 * It records every call and answers the question the case asks for, so a case
 * can tell two accounts apart and can prove that no provider was reached.
 */
const createTransport = (answer: (call: ProviderCall) => string) => {
  const calls: ProviderCall[] = [];
  const transport: ReviewQuestionTransport = {
    ask: async (input) => {
      const call = {
        provider: input.provider,
        model: input.model,
        baseUrl: input.baseUrl,
        system: input.system,
        prompt: input.prompt,
      };
      calls.push(call);
      return {
        text: answer(call),
        meta: {
          promptVersion: REVIEW_QUESTION_PROMPT_VERSION,
          provider: input.provider,
          model: input.model,
          durationMs: 7,
        },
      };
    },
  };
  return { calls, transport };
};

/** The journal-side provider configuration the review question needs. */
const configureProvider = (): void => {
  serverSettings.setSetting("aiProvider", "compatible");
  serverSettings.setSetting("compatibleModel", MODEL);
  serverSettings.setSetting("compatibleBaseUrl", SERVER);
};

/** The accounts the background policy allows. */
const enablePolicy = (optedIn: readonly string[]): void => {
  composition.saveBackgroundPolicy({
    enabled: true,
    accounts: [...optedIn],
    capabilities: { tools: false, structuredOutput: false },
    maxInputCharacters: 8000,
  });
};

/** The production worker, with the stub provider behind it. */
const providerWorker = (transport: ReviewQuestionTransport): IntelligenceWorker =>
  composition.createIntelligenceWorker({
    db,
    clock: () => NOW,
    owner: PROVIDER_OWNER,
    transport,
  });

/** An account that owns nothing but the fills the case inserts. */
const createAccount = (id: string): string => {
  db.insert(accounts).values({ id, name: id, kind: "manual", createdAt: "2026-01-01" }).run();
  return id;
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

/** The fills of one closed trade, exactly like an ingestion does. */
const insertTrade = (accountId: string, symbol = "TEST"): void => {
  withJournalTransaction((tx) => {
    insertExecutionsInTx(
      tx,
      accountId,
      [
        { ...entry, symbol },
        { ...exit, symbol },
      ],
      "import",
      changeContext("user", "live"),
    );
  });
};

/** One fill on its own, the way an ingestion that arrives late does. */
const insertFill = (accountId: string, fill: ImportedExecution): void => {
  withJournalTransaction((tx) => {
    insertExecutionsInTx(tx, accountId, [fill], "import", changeContext("user", "live"));
  });
};

/** The observations the journal holds. */
const observations = () => db.select().from(intelligenceObservations).all();

/** The shape the scoped surface answers with. */
interface ServedScope {
  readonly observations: { readonly id: string; readonly accountId: string }[];
  readonly intents: InteractionIntent[];
}

/** The question a served review intent carries, when it carries one. */
const insightOf = (intent: InteractionIntent) =>
  intent.kind === "observation-review" ? intent.insight : undefined;

/** The served review intent, narrowed to the review the operator acts on. */
const reviewOf = (intent: InteractionIntent) => {
  if (intent.kind !== "observation-review") throw new Error("The served intent is not a review.");
  return intent;
};

/**
 * Everything a paid request would touch.
 *
 * Reading the inbox is free: the runs, the jobs and the daily attempt
 * reservations the provider leg writes, and the number of provider calls,
 * must be exactly the same before and after a scoped read.
 */
const spendState = (providerCalls: number) => ({
  runs: db.select().from(intelligenceRuns).all().length,
  jobs: db.select().from(intelligenceJobs).all().length,
  reservations: db.select().from(intelligenceBudgetReservations).all().length,
  providerCalls,
});

/**
 * The scoped surface, as the inbox reads it.
 *
 * The scope names one account, so the answer holds that account's reviews
 * and nothing else.
 */
const servedScope = async (account: string): Promise<ServedScope> => {
  const response = await getObservations(
    observationsGet(`/api/intelligence/observations?scope=${account}`),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ServedScope;
};
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

/** The committed trade changes, oldest revision first. */
const events = () =>
  db
    .select()
    .from(domainOutbox)
    .all()
    .sort(
      (left, right) =>
        left.aggregateRevision - right.aggregateRevision || left.id.localeCompare(right.id),
    );
/** The committed trade change that carried one projection revision. */
const eventForRevision = (revisionId: string) =>
  events().find((row) => {
    const payload = JSON.parse(row.payloadJson) as { projectionRevisionId?: string };
    return payload.projectionRevisionId === revisionId;
  });
/** The job the outbox fanned an event out to. */
const jobForEvent = (eventId: string) =>
  db
    .select()
    .from(intelligenceJobs)
    .all()
    .find((row) => {
      const payload = JSON.parse(row.payloadJson) as { eventId?: string };
      return payload.eventId === eventId;
    });

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
  if (job.payload.type !== "evaluate_trade") throw new Error("The job is not a trade evaluation.");
  withJournalTransaction((tx) => {
    observationHandler.run(tx, job);
  });
};

/** The setting as a restart would read it. */
const settingValue = (key: string): string | null =>
  db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;

/** The rows the two controls live in. */
const controlRows = () =>
  db
    .select()
    .from(settings)
    .where(inArray(settings.key, ["intelligenceProactiveOptIn", "intelligencePaused"]))
    .all();

/**
 * A mutation of the controls, as the journal's own pages send it.
 *
 * The origin header is the journal's own origin, so the origin policy lets
 * the request through; a case that means to be refused names another origin.
 */
const controlsPost = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/intelligence/controls", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost", ...headers },
    body: JSON.stringify(body),
  });

/** The observation surface, as the inbox reads it. */
const observationsGet = (path: string) => new Request(`http://localhost${path}`);

/** A review the inbox starts, as the inbox posts it. */
const observationsPost = (body: unknown) =>
  new Request("http://localhost/api/intelligence/observations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });

/** The operator's command, as the card sends it. */
const commandsPost = (body: unknown) =>
  new Request("http://localhost/api/intelligence/commands", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });

/** The workflows of the scratch journal. */
const workflowRows = () => db.select().from(intelligenceWorkflows).all();

beforeEach(() => {
  db.delete(intelligenceInsights).run();
  db.delete(intelligenceBudgetReservations).run();
  db.delete(intelligencePolicy).run();
  db.delete(interactionCommands).run();
  db.delete(workflowTransitions).run();
  db.delete(intelligenceWorkflows).run();
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
  db.delete(intelligenceRuns).run();
  db.delete(settings)
    .where(
      inArray(settings.key, [
        "intelligenceProactiveOptIn",
        "intelligencePaused",
        "aiProvider",
        "compatibleModel",
        "compatibleBaseUrl",
      ]),
    )
    .run();
});

afterAll(() => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // The database file is still held by the open handle.
  }
});

describe("the running path", () => {
  it("records the observation and its opportunity together, and offers it in the inbox", async () => {
    const account = createAccount("acct-running");
    insertTrade(account);
    await drain();

    const stored = observations();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.status).toBe("active");

    const opportunities = opportunityRows();
    expect(opportunities).toHaveLength(1);
    const opportunity = opportunities[0]!;
    expect(opportunity.subjectType).toBe("observation");
    expect(opportunity.subjectId).toBe(stored[0]!.id);
    expect(opportunity.dedupKey).toBe(`opportunity/observation/${stored[0]!.id}`);
    expect(JSON.parse(opportunity.evidenceIdsJson)).toEqual([stored[0]!.sourceRevision]);
    // The policy never invents an idle operator: an unknown-activity
    // opportunity goes to the inbox, never to a proactive delivery.
    expect(opportunity.status).toBe("eligible");
    expect(deliveryRows()).toHaveLength(0);

    const produced = buildOpportunityRequest({
      observation: {
        id: stored[0]!.id,
        subjectId: stored[0]!.subjectId,
        accountId: stored[0]!.accountId,
        status: stored[0]!.status,
        evidenceRevisions: [stored[0]!.sourceRevision],
      },
      controls: { proactiveOptIn: true, paused: false },
      now: NOW,
    });
    expect(produced.kind).toBe("produced");
    if (produced.kind !== "produced") throw new Error("The producer raised nothing.");
    expect(produced.request.activity).toBe("unknown");
    expect(coordinator.engage(produced.request).decision).toEqual({
      outcome: "inbox",
      reason: "activity_unknown",
      nextEligibleAt: null,
    });
    expect(deliveryRows()).toHaveLength(0);
  });
});

describe("the producer's idempotence", () => {
  it("raises no second opportunity when the same event is delivered again", async () => {
    const account = createAccount("acct-idempotent");
    insertTrade(account);
    await drain();

    const first = opportunityRows();
    expect(first).toHaveLength(1);
    const observation = observations()[0]!;

    const event = eventForRevision(observation.sourceRevision);
    if (!event) throw new Error("The trade change was never committed.");
    const job = jobForEvent(event.id);
    if (!job) throw new Error("The event was never fanned out.");
    deliver(job.id);

    expect(observations()).toHaveLength(1);
    expect(observations()[0]!.id).toBe(observation.id);
    expect(opportunityRows()).toHaveLength(1);
    expect(opportunityRows()[0]!.id).toBe(first[0]!.id);
    // The dedup key holds: the same observation names the same opportunity.
    expect(opportunityRows()[0]!.dedupKey).toBe(`opportunity/observation/${observation.id}`);
    expect(opportunityRows()[0]!.status).toBe("eligible");
    expect(engagementRows()).toHaveLength(1);
  });
});

describe("the controls", () => {
  it("raises nothing while the journal is paused and nothing without the opt-in", async () => {
    serverSettings.setIntelligenceControls({ paused: true });
    insertTrade(createAccount("acct-paused"));
    await drain();
    expect(observations()).toHaveLength(1);
    expect(opportunityRows()).toHaveLength(0);

    serverSettings.setIntelligenceControls({ paused: false, proactiveOptIn: false });
    insertTrade(createAccount("acct-not-opted-in"));
    await drain();
    expect(observations()).toHaveLength(2);
    expect(opportunityRows()).toHaveLength(0);

    serverSettings.setIntelligenceControls({ paused: false, proactiveOptIn: true });
    insertTrade(createAccount("acct-opted-in"));
    await drain();
    expect(observations()).toHaveLength(3);
    expect(opportunityRows()).toHaveLength(1);
    expect(opportunityRows()[0]!.status).toBe("eligible");
  });
});

describe("the controls route", () => {
  beforeEach(() => {
    // The journal asks for a password here, so the gate is a real one: the
    // session the case carries is the only way in.
    vi.stubEnv("JOURNAL_PASSWORD", "test-password");
    session.token = sessionToken();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    session.token = undefined;
  });

  it("serves the defaults of a journal that was never configured", async () => {
    const response = await getControls();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ controls: { proactiveOptIn: true, paused: false } });
    expect(controlRows()).toHaveLength(0);
  });

  it("merges the patch into the served state and persists it", async () => {
    const paused = await postControls(controlsPost({ paused: true }));
    expect(paused.status).toBe(200);
    expect(await paused.json()).toEqual({ controls: { proactiveOptIn: true, paused: true } });

    // The switch the patch does not name keeps the value it had.
    const optedOut = await postControls(controlsPost({ proactiveOptIn: false }));
    expect(optedOut.status).toBe(200);
    expect(await optedOut.json()).toEqual({ controls: { proactiveOptIn: false, paused: true } });

    // Durable: the settings rows hold what the route wrote.
    expect(settingValue("intelligenceProactiveOptIn")).toBe("false");
    expect(settingValue("intelligencePaused")).toBe("true");
    expect(serverSettings.getIntelligenceControls()).toEqual({
      proactiveOptIn: false,
      paused: true,
    });

    // A later read of the journal sees the same state.
    const after = await getControls();
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ controls: { proactiveOptIn: false, paused: true } });
  });

  it("keeps the route alive when the journal may raise insights", async () => {
    // The opt-in leaves the journal allowed to raise insights, so the route
    // produces the opportunities of the observations it holds. The journal
    // holds none here, and the route answers either way.
    const response = await postControls(controlsPost({ proactiveOptIn: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ controls: { proactiveOptIn: true, paused: false } });
    expect(serverSettings.getIntelligenceControls()).toEqual({
      proactiveOptIn: true,
      paused: false,
    });
  });

  it("refuses a mutation without a session", async () => {
    session.token = undefined;

    const response = await postControls(controlsPost({ paused: true }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(controlRows()).toHaveLength(0);
    expect(serverSettings.getIntelligenceControls()).toEqual({
      proactiveOptIn: true,
      paused: false,
    });
  });

  it("refuses a foreign origin and persists nothing", async () => {
    const response = await postControls(
      controlsPost({ paused: true }, { Origin: "https://evil.example" }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_denied" });
    expect(controlRows()).toHaveLength(0);
    expect(serverSettings.getIntelligenceControls()).toEqual({
      proactiveOptIn: true,
      paused: false,
    });
  });

  it("refuses a body that is not the schema and persists nothing", async () => {
    const unknownKey = await postControls(controlsPost({ proactiveOptIn: true, loud: true }));
    expect(unknownKey.status).toBe(400);
    expect(await unknownKey.json()).toEqual({ error: "invalid_request" });

    const wrongType = await postControls(controlsPost({ paused: "yes" }));
    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toEqual({ error: "invalid_request" });

    expect(controlRows()).toHaveLength(0);
    expect(serverSettings.getIntelligenceControls()).toEqual({
      proactiveOptIn: true,
      paused: false,
    });
  });
});

describe("the operator's command", () => {
  it("persists the correction in the transition history, the ledger and the self report", async () => {
    const account = createAccount("acct-command");
    insertTrade(account);
    await drain();
    const observation = observations()[0]!;

    const started = composition.workflowEngine.startWorkflow(
      {
        subjectType: "observation",
        subjectId: observation.id,
        accountId: account,
        evidenceIds: [observation.sourceRevision],
      },
      composition.interactiveExecutionContext([account]),
    );
    composition.workflowEngine.applyWorkflowEffect(started.workflowId, started.revision);

    const waiting = db
      .select()
      .from(intelligenceWorkflows)
      .where(eq(intelligenceWorkflows.id, started.workflowId))
      .get();
    expect(waiting?.status).toBe("waiting_for_user");
    expect(waiting?.revision).toBe(2);

    const outcome = composition.interactionCommands.apply({
      actionId: workflowActionId(started.workflowId, "correct", waiting!.revision),
      commandId: "cmd-correct-1",
      expectedRevision: waiting!.revision,
      action: "correct",
      correction: "The exit filled at 103, not 102.",
    });
    expect(outcome.status).toBe(200);

    const transitions = db
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowId, started.workflowId))
      .all()
      .sort((left, right) => left.revision - right.revision);
    expect(transitions.map((row) => row.action)).toEqual(["start", "present", "correct"]);

    const commands = db.select().from(interactionCommands).all();
    expect(commands).toHaveLength(1);
    expect(commands[0]!.commandId).toBe("cmd-correct-1");

    const corrected = db
      .select()
      .from(intelligenceWorkflows)
      .where(eq(intelligenceWorkflows.id, started.workflowId))
      .get();
    expect(corrected?.status).toBe("completed");
    expect(JSON.parse(corrected!.selfReportJson!).text).toBe("The exit filled at 103, not 102.");
  });
});

describe("the observation reviews", () => {
  it("pairs the review that waits, refuses a second one and leaks no row", async () => {
    const account = createAccount("acct-review");
    insertTrade(account);
    await drain();
    const observation = observations()[0]!;

    // The inbox starts the review of the observation.
    const started = await postObservations(observationsPost({ observationId: observation.id }));
    expect(started.status).toBe(200);
    const answer = (await started.json()) as {
      workflowId: string;
      intent: {
        kind: string;
        expectedRevision: number;
        actions: { action: string; actionId: string }[];
      } | null;
    };
    expect(answer.intent?.kind).toBe("observation-review");

    // The surface serves the review that waits for the operator.
    const served = await getObservations(observationsGet("/api/intelligence/observations"));
    expect(served.status).toBe(200);
    const body = (await served.json()) as {
      observations: { id: string; reviewState: string }[];
      intents: { kind: string; workflowId: string }[];
    };
    expect(body.intents).toHaveLength(1);
    expect(body.intents[0]!.workflowId).toBe(answer.workflowId);
    expect(body.observations).toHaveLength(1);
    expect(body.observations[0]!.reviewState).toBe("live");

    // Exactly one workflow, and it waits for the operator.
    expect(workflowRows()).toHaveLength(1);
    expect(workflowRows()[0]!.status).toBe("waiting_for_user");

    // A second start is refused while the review is live, and writes nothing.
    const repeated = await postObservations(observationsPost({ observationId: observation.id }));
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toEqual({ error: "review_already_started" });
    expect(workflowRows()).toHaveLength(1);

    // The operator gives the review.
    const acknowledge = answer.intent!.actions.find((action) => action.action === "acknowledge")!;
    const outcome = composition.interactionCommands.apply({
      actionId: acknowledge.actionId,
      commandId: "cmd-acknowledge-review",
      expectedRevision: answer.intent!.expectedRevision,
      action: "acknowledge",
    });
    expect(outcome.status).toBe(200);
    expect(workflowRows()[0]!.status).toBe("completed");

    // The review is given: the surface serves no intent, the observation
    // says it was reviewed, and the start is refused again. No row leaked.
    const after = await getObservations(observationsGet("/api/intelligence/observations"));
    const afterBody = (await after.json()) as {
      observations: { id: string; reviewState: string }[];
      intents: { kind: string }[];
    };
    expect(afterBody.intents).toHaveLength(0);
    expect(afterBody.observations[0]!.reviewState).toBe("reviewed");

    const refused = await postObservations(observationsPost({ observationId: observation.id }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "review_already_started" });
    expect(workflowRows()).toHaveLength(1);
  });

  it("serves the review that waits after an abandoned one was replaced", async () => {
    const account = createAccount("acct-replaced-review");
    insertTrade(account);
    await drain();
    const observation = observations()[0]!;

    // The first review is started and then abandoned by the operator.
    const first = await postObservations(observationsPost({ observationId: observation.id }));
    expect(first.status).toBe(200);
    const firstAnswer = (await first.json()) as {
      workflowId: string;
      intent: { expectedRevision: number; actions: { action: string; actionId: string }[] } | null;
    };
    const cancel = firstAnswer.intent!.actions.find((action) => action.action === "cancel")!;
    const cancelled = composition.interactionCommands.apply({
      actionId: cancel.actionId,
      commandId: "cmd-cancel-review",
      expectedRevision: firstAnswer.intent!.expectedRevision,
      action: "cancel",
    });
    expect(cancelled.status).toBe(200);
    expect(workflowRows()[0]!.status).toBe("cancelled");

    // An abandoned review holds nothing: the observation may be reviewed
    // again, and the new review waits for the operator.
    const second = await postObservations(observationsPost({ observationId: observation.id }));
    expect(second.status).toBe(200);
    const secondAnswer = (await second.json()) as { workflowId: string };
    expect(secondAnswer.workflowId).not.toBe(firstAnswer.workflowId);

    // The surface serves the review that waits, not the abandoned one.
    const served = await getObservations(observationsGet("/api/intelligence/observations"));
    const body = (await served.json()) as {
      observations: { id: string; reviewState: string }[];
      intents: { kind: string; workflowId: string }[];
    };
    expect(body.intents).toHaveLength(1);
    expect(body.intents[0]!.workflowId).toBe(secondAnswer.workflowId);
    expect(body.observations[0]!.reviewState).toBe("live");

    // Exactly one live workflow, and no leaked row.
    expect(workflowRows().filter((row) => row.status === "waiting_for_user")).toHaveLength(1);
    expect(workflowRows()).toHaveLength(2);
  });
});

describe("a dismissed insight", () => {
  it("keeps a later engagement suppressed", async () => {
    const account = createAccount("acct-dismissed");
    insertTrade(account);
    await drain();
    const opportunity = opportunityRows()[0]!;

    composition.engagementCoordinator.dismiss("opportunity", opportunity.id);

    expect(dismissalRows()).toHaveLength(1);
    expect(opportunityRows()[0]!.status).toBe("dismissed");

    // The journal raises the insight again, and the dismissal holds.
    expect(composition.produceOpportunitiesForActiveObservations()).toBe(0);
    expect(opportunityRows()).toHaveLength(1);
    expect(opportunityRows()[0]!.status).toBe("dismissed");
    expect(deliveryRows()).toHaveLength(0);
  });
});

describe("the provider-free chain", () => {
  it("runs the whole chain with no AI provider configured", async () => {
    const anthropic = process.env.ANTHROPIC_API_KEY;
    const openai = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const requests = vi.spyOn(globalThis, "fetch");
    try {
      expect(serverSettings.getAiSettings().aiConfigured).toBe(false);

      const account = createAccount("acct-no-provider");
      insertTrade(account);
      await drain();

      expect(observations()).toHaveLength(1);
      expect(opportunityRows()).toHaveLength(1);
      expect(opportunityRows()[0]!.status).toBe("eligible");
      // The journey never reached for a provider: no run was queued and no
      // request was made.
      expect(db.select().from(intelligenceRuns).all()).toHaveLength(0);
      expect(requests).not.toHaveBeenCalled();
    } finally {
      requests.mockRestore();
      if (anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = anthropic;
      if (openai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = openai;
    }
  });
});

describe("the review question on the card", () => {
  it("serves each account its own question", async () => {
    const alpha = createAccount("acct-alpha");
    const beta = createAccount("acct-beta");
    configureProvider();
    enablePolicy([alpha, beta]);
    insertTrade(alpha, "ALPHA");
    insertTrade(beta, "BETA");
    const { calls, transport } = createTransport((call) =>
      call.prompt.includes("symbol: ALPHA") ? ALPHA_QUESTION : BETA_QUESTION,
    );
    await drainWorker(providerWorker(transport));

    // Both accounts were asked, and each account got its own answer.
    expect(calls).toHaveLength(2);
    expect(db.select().from(intelligenceInsights).all()).toHaveLength(2);

    const alphaObservation = observations().find((row) => row.accountId === alpha)!;
    const betaObservation = observations().find((row) => row.accountId === beta)!;
    expect(alphaObservation).toBeDefined();
    expect(betaObservation).toBeDefined();

    const alphaStart = await postObservations(
      observationsPost({ observationId: alphaObservation.id }),
    );
    expect(alphaStart.status).toBe(200);
    const betaStart = await postObservations(
      observationsPost({ observationId: betaObservation.id }),
    );
    expect(betaStart.status).toBe(200);

    // Reading the inbox is free. The runs, the jobs and the attempt
    // reservations a paid request would write are counted BEFORE the scoped
    // reads, and the provider must not be called by a read.
    const before = spendState(calls.length);
    expect(before.runs).toBeGreaterThan(0);
    expect(before.reservations).toBeGreaterThan(0);

    // The scoped surface serves the question of the account it names, and
    // nothing else crosses the scope.
    const alphaBody = await servedScope(alpha);
    expect(alphaBody.intents).toHaveLength(1);
    expect(alphaBody.intents[0]!.subject.id).toBe(alphaObservation.id);
    expect(insightOf(alphaBody.intents[0]!)).toEqual({
      question: ALPHA_QUESTION,
      sourceRevision: alphaObservation.sourceRevision,
    });

    const betaBody = await servedScope(beta);
    expect(betaBody.intents).toHaveLength(1);
    expect(betaBody.intents[0]!.subject.id).toBe(betaObservation.id);
    expect(insightOf(betaBody.intents[0]!)).toEqual({
      question: BETA_QUESTION,
      sourceRevision: betaObservation.sourceRevision,
    });

    // The reads spent nothing: no run, no job, no reserved attempt and no
    // provider call. Opening the inbox never buys a question.
    expect(spendState(calls.length)).toEqual(before);
  });

  it("links the question to the source revision it was made from", async () => {
    const account = createAccount("acct-source");
    configureProvider();
    enablePolicy([account]);
    insertTrade(account);
    const { transport } = createTransport(() => QUESTION);
    await drainWorker(providerWorker(transport));

    const observation = observations()[0]!;
    const start = await postObservations(observationsPost({ observationId: observation.id }));
    expect(start.status).toBe(200);

    const body = await servedScope(account);
    expect(insightOf(body.intents[0]!)).toEqual({
      question: QUESTION,
      sourceRevision: observation.sourceRevision,
    });
  });

  it("hides the question of a corrected source and keeps the stored row", async () => {
    const account = createAccount("acct-corrected");
    configureProvider();
    enablePolicy([account]);
    // The first change opens the trade; the second one closes it and moves
    // the source the question was made from.
    insertFill(account, entry);
    const { calls, transport } = createTransport(() => QUESTION);
    await drainWorker(providerWorker(transport));

    const first = observations()[0]!;
    const start = await postObservations(observationsPost({ observationId: first.id }));
    expect(start.status).toBe(200);
    const before = await servedScope(account);
    expect(insightOf(before.intents[0]!)?.question).toBe(QUESTION);

    // The correction: the trade closes, so the projection moves on.
    insertFill(account, exit);

    const after = await servedScope(account);
    // The review still waits for the operator, but the older question is no
    // longer served: its source is no longer the current one.
    expect(after.intents).toHaveLength(1);
    expect(insightOf(after.intents[0]!)).toBeUndefined();
    // The question was asked once, and the stored row survives: it is
    // hidden, not deleted.
    expect(calls).toHaveLength(1);
    const stored = db.select().from(intelligenceInsights).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.question).toBe(QUESTION);
    expect(stored[0]!.sourceRevision).toBe(first.sourceRevision);
  });

  it("serves the question only for a revision the review shows as evidence", async () => {
    const account = createAccount("acct-evidence");
    configureProvider();
    enablePolicy([account]);
    insertTrade(account);
    const { transport } = createTransport(() => QUESTION);
    await drainWorker(providerWorker(transport));

    const observation = observations()[0]!;
    const subject = {
      id: observation.id,
      subjectId: observation.subjectId,
      accountId: observation.accountId,
    };

    // The revision the question rests on is served when the review shows it.
    expect(currentInsightOf(subject, [observation.sourceRevision])).toEqual({
      question: QUESTION,
      sourceRevision: observation.sourceRevision,
    });

    // A revision the review does not show serves nothing.
    expect(currentInsightOf(subject, ["rev-the-review-never-shows"])).toBeNull();
    // Another observation's id serves nothing either.
    expect(
      currentInsightOf({ ...subject, id: "obs-other" }, [observation.sourceRevision]),
    ).toBeNull();
  });

  it("stores no question without a provider and leaves the review usable", async () => {
    const account = createAccount("acct-unconfigured");
    const anthropic = process.env.ANTHROPIC_API_KEY;
    const openai = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      // The account opted in, so the policy gate passes: the only thing that
      // refuses the question is that no provider is configured.
      enablePolicy([account]);
      insertTrade(account);
      const { calls, transport } = createTransport(() => QUESTION);
      await drainWorker(providerWorker(transport));

      // The provider was never reached, and no question was stored.
      expect(calls).toHaveLength(0);
      expect(db.select().from(intelligenceInsights).all()).toHaveLength(0);
      expect(db.select().from(intelligenceRuns).all()).toHaveLength(0);
      // The deterministic chain is untouched: the observation and its
      // opportunity are still there.
      expect(observations()).toHaveLength(1);
      expect(opportunityRows()).toHaveLength(1);

      // The review is still usable: it starts and the operator can give it.
      const observation = observations()[0]!;
      const start = await postObservations(observationsPost({ observationId: observation.id }));
      expect(start.status).toBe(200);

      // The inbox is read as well, and the read is free: it reaches no
      // provider and spends no allowance. The review is served without a
      // question.
      const before = spendState(calls.length);
      const read = await servedScope(account);
      expect(read.intents).toHaveLength(1);
      expect(insightOf(read.intents[0]!)).toBeUndefined();
      expect(spendState(calls.length)).toEqual(before);

      const answer = (await start.json()) as {
        intent: {
          kind: string;
          expectedRevision: number;
          actions: { action: string; actionId: string }[];
        } | null;
      };
      expect(answer.intent?.kind).toBe("observation-review");
      const acknowledge = answer.intent!.actions.find((action) => action.action === "acknowledge")!;
      const outcome = composition.interactionCommands.apply({
        actionId: acknowledge.actionId,
        commandId: "cmd-acknowledge-unconfigured",
        expectedRevision: answer.intent!.expectedRevision,
        action: "acknowledge",
      });
      expect(outcome.status).toBe(200);
      expect(workflowRows()[0]!.status).toBe("completed");
    } finally {
      if (anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = anthropic;
      if (openai === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = openai;
    }
  });

  it("stores no question for an account the policy does not list", async () => {
    const account = createAccount("acct-not-opted-in");
    configureProvider();
    // The policy is enabled, but this account never opted in.
    enablePolicy([]);
    insertTrade(account);
    const { calls, transport } = createTransport(() => QUESTION);
    await drainWorker(providerWorker(transport));

    // The provider was never reached, and no question was stored.
    expect(calls).toHaveLength(0);
    expect(db.select().from(intelligenceInsights).all()).toHaveLength(0);
    expect(db.select().from(intelligenceRuns).all()).toHaveLength(0);
    expect(observations()).toHaveLength(1);

    // The review is still usable.
    const observation = observations()[0]!;
    const start = await postObservations(observationsPost({ observationId: observation.id }));
    expect(start.status).toBe(200);

    // The inbox is read as well, and the read is free: it reaches no
    // provider and spends no allowance.
    const before = spendState(calls.length);
    const read = await servedScope(account);
    expect(read.intents).toHaveLength(1);
    expect(insightOf(read.intents[0]!)).toBeUndefined();
    expect(spendState(calls.length)).toEqual(before);

    const answer = (await start.json()) as {
      intent: {
        kind: string;
        expectedRevision: number;
        actions: { action: string; actionId: string }[];
      } | null;
    };
    expect(answer.intent?.kind).toBe("observation-review");
    const acknowledge = answer.intent!.actions.find((action) => action.action === "acknowledge")!;
    const outcome = composition.interactionCommands.apply({
      actionId: acknowledge.actionId,
      commandId: "cmd-acknowledge-not-opted-in",
      expectedRevision: answer.intent!.expectedRevision,
      action: "acknowledge",
    });
    expect(outcome.status).toBe(200);
    expect(workflowRows()[0]!.status).toBe("completed");
  });

  it("serves a question only inside the scope of its own account", async () => {
    const owner = createAccount("acct-owner");
    const other = createAccount("acct-other");
    configureProvider();
    enablePolicy([owner]);
    insertTrade(owner);
    const { transport } = createTransport(() => QUESTION);
    await drainWorker(providerWorker(transport));

    const observation = observations()[0]!;
    const start = await postObservations(observationsPost({ observationId: observation.id }));
    expect(start.status).toBe(200);

    // Another account's scope never serves this account's question.
    const otherScope = await servedScope(other);
    expect(otherScope.intents).toHaveLength(0);
    expect(JSON.stringify(otherScope)).not.toContain(QUESTION);

    // A scope that names an account that does not exist is refused.
    const refused = await getObservations(
      observationsGet("/api/intelligence/observations?scope=acct-missing"),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "scope_denied" });
  });

  it("takes the operator's command while the question is on the card", async () => {
    const account = createAccount("acct-command-with-question");
    configureProvider();
    enablePolicy([account]);
    insertTrade(account);
    const { transport } = createTransport(() => QUESTION);
    await drainWorker(providerWorker(transport));

    const observation = observations()[0]!;
    const start = await postObservations(observationsPost({ observationId: observation.id }));
    expect(start.status).toBe(200);

    // The card the operator acts on carries the question.
    const body = await servedScope(account);
    expect(body.intents).toHaveLength(1);
    expect(insightOf(body.intents[0]!)?.question).toBe(QUESTION);

    // The command the card would send: the action id and the revision the
    // server issued, with the question neither changing nor demanding
    // anything.
    const intent = reviewOf(body.intents[0]!);
    const acknowledge = intent.actions.find((action) => action.action === "acknowledge")!;
    const request = commandRequestBody(intent, acknowledge, {
      commandId: "cmd-acknowledge-with-question",
    });
    expect(request).not.toBeNull();
    expect(request).toEqual({
      actionId: acknowledge.actionId,
      commandId: "cmd-acknowledge-with-question",
      expectedRevision: intent.expectedRevision,
      action: "acknowledge",
    });

    // The command route accepts it and the review completes.
    const outcome = await postCommands(
      commandsPost({
        actionId: request!.actionId,
        commandId: request!.commandId,
        expectedRevision: request!.expectedRevision,
        action: request!.action,
      }),
    );
    expect(outcome.status).toBe(200);
    expect(workflowRows()[0]!.status).toBe("completed");

    // The question is still the journal's, and it never crossed the wire
    // inside the command.
    const stored = db.select().from(intelligenceInsights).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.question).toBe(QUESTION);
    expect(JSON.stringify(request)).not.toContain(QUESTION);
  });

  it("still refuses a stale command while the question is on the card", async () => {
    const account = createAccount("acct-stale-with-question");
    configureProvider();
    enablePolicy([account]);
    insertTrade(account);
    const { transport } = createTransport(() => QUESTION);
    await drainWorker(providerWorker(transport));

    const observation = observations()[0]!;
    const start = await postObservations(observationsPost({ observationId: observation.id }));
    expect(start.status).toBe(200);

    const body = await servedScope(account);
    expect(insightOf(body.intents[0]!)?.question).toBe(QUESTION);
    const intent = reviewOf(body.intents[0]!);
    const acknowledge = intent.actions.find((action) => action.action === "acknowledge")!;
    const defer = intent.actions.find((action) => action.action === "defer")!;

    // The revision the card carries is the one the workflow is on.
    expect(intent.expectedRevision).toBe(workflowRows()[0]!.revision);

    // The operator defers the review: the workflow leaves for `scheduled` and
    // its revision moves on. The effect then brings it back to wait, so the
    // workflow is again in a status where ACKNOWLEDGE is legal — only the
    // revision is now wrong. That is what makes the next command a test of
    // the revision check and of nothing else.
    const deferred = await postCommands(
      commandsPost({
        actionId: defer.actionId,
        commandId: "cmd-defer-with-question",
        expectedRevision: intent.expectedRevision,
        action: "defer",
        deferUntil: NOW,
      }),
    );
    expect(deferred.status).toBe(200);
    expect(workflowRows()[0]!.status).toBe("scheduled");
    composition.workflowEngine.applyWorkflowEffect(intent.workflowId, intent.expectedRevision + 1);
    expect(workflowRows()[0]!.status).toBe("waiting_for_user");
    expect(workflowRows()[0]!.revision).toBeGreaterThan(intent.expectedRevision);

    // The card the operator holds is now stale. Its command is refused by the
    // REVISION check: the question does not make that check go soft.
    const stale = await postCommands(
      commandsPost({
        actionId: acknowledge.actionId,
        commandId: "cmd-stale-with-question",
        expectedRevision: intent.expectedRevision,
        action: "acknowledge",
      }),
    );
    expect(stale.status).toBe(409);
    const refusal = (await stale.json()) as { error: string; currentRevision: number };
    expect(refusal.error).toBe("stale_revision");
    expect(refusal.currentRevision).toBe(workflowRows()[0]!.revision);

    // The refusal changed nothing: the workflow still waits for the operator.
    expect(workflowRows()[0]!.status).toBe("waiting_for_user");
    expect(workflowRows()[0]!.revision).toBeGreaterThan(intent.expectedRevision);
  });
});

describe("a restart before the question is served", () => {
  it("serves the question again after the journal is reopened", async () => {
    const account = createAccount("acct-restarted");
    configureProvider();
    enablePolicy([account]);
    insertTrade(account);
    const { transport } = createTransport(() => QUESTION);
    await drainWorker(providerWorker(transport));

    const observation = observations()[0]!;
    const start = await postObservations(observationsPost({ observationId: observation.id }));
    expect(start.status).toBe(200);
    const before = await servedScope(account);
    expect(insightOf(before.intents[0]!)?.question).toBe(QUESTION);

    // The journal is closed and opened again on the same directory.
    const restarted = await reopenJournal();

    // The route that was imported again reads the reopened journal, and the
    // question is still there: it was stored, not held in memory.
    const response = await restarted.GET(
      observationsGet(`/api/intelligence/observations?scope=${account}`),
    );
    expect(response.status).toBe(200);
    const after = (await response.json()) as ServedScope;
    expect(after.intents).toHaveLength(1);
    expect(insightOf(after.intents[0]!)).toEqual({
      question: QUESTION,
      sourceRevision: observation.sourceRevision,
    });
  });
});

describe("a restart before the continuation", () => {
  it("applies the pending effect exactly once", async () => {
    const account = createAccount("acct-restart");
    insertTrade(account);
    await drain();
    const observation = observations()[0]!;

    const started = composition.workflowEngine.startWorkflow(
      {
        subjectType: "observation",
        subjectId: observation.id,
        accountId: account,
        evidenceIds: [observation.sourceRevision],
      },
      composition.interactiveExecutionContext([account]),
    );

    // KNOWN GAP (a Phase 20 input): the committed worker resolves no handler
    // for a workflow_effect job
    // (apps/web/src/server/intelligence/infrastructure/worker.ts), so a
    // deferred workflow never resumes in production. The resume leg is
    // proved at the ENGINE level here: the effect is applied directly.
    const pending = db
      .select()
      .from(intelligenceJobs)
      .where(like(intelligenceJobs.idempotencyKey, `workflow-effect:${started.workflowId}:%`))
      .all();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe("pending");

    // The journal is closed and reopened on the same data directory.
    db.$client.close();
    delete journalGlobal.__journalDb;
    delete journalGlobal.__journalDbDir;
    vi.resetModules();
    const restartedJournal = await import("../src/db");
    const restarted = await import("../src/server/intelligence/composition");

    restarted.workflowEngine.applyWorkflowEffect(started.workflowId, started.revision);

    const transitionsOf = () =>
      restartedJournal.db
        .select()
        .from(restartedJournal.workflowTransitions)
        .where(eq(restartedJournal.workflowTransitions.workflowId, started.workflowId))
        .all();
    const presentRows = () => transitionsOf().filter((row) => row.action === "present");
    expect(presentRows()).toHaveLength(1);

    const afterFirst = transitionsOf();
    const workflowAfterFirst = restartedJournal.db
      .select()
      .from(restartedJournal.intelligenceWorkflows)
      .where(eq(restartedJournal.intelligenceWorkflows.id, started.workflowId))
      .get();
    expect(workflowAfterFirst?.status).toBe("waiting_for_user");

    // Applying the same effect again changes nothing.
    restarted.workflowEngine.applyWorkflowEffect(started.workflowId, started.revision);

    expect(transitionsOf()).toEqual(afterFirst);
    expect(presentRows()).toHaveLength(1);
    expect(
      restartedJournal.db
        .select()
        .from(restartedJournal.intelligenceWorkflows)
        .where(eq(restartedJournal.intelligenceWorkflows.id, started.workflowId))
        .get()?.revision,
    ).toBe(workflowAfterFirst?.revision);
  });
});
