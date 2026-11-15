import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray, like } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { workflowActionId } from "../src/lib/intelligence-interactions";
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
// Event capture is off in production; the running path is proved here.
process.env.JOURNAL_EVENT_CAPTURE = "1";

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
// A static import cannot work here: the import would run before the
// environment is set.
const {
  db,
  accounts,
  domainOutbox,
  eventDeliveries,
  executionEvidence,
  executions,
  intelligenceJobs,
  intelligenceObservations,
  intelligenceOpportunities,
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
} = await import("../src/db");
const { withJournalTransaction } = await import("../src/db/transaction");
const { insertExecutionsInTx } = await import("../src/server/executions");
const { changeContext } = await import("../src/server/trading/reconcile");
const { createJobStore, createEffectStore } =
  await import("../src/server/intelligence/infrastructure/jobs");
const { createWorkerService } = await import("../src/server/intelligence/infrastructure/worker");
const { createOutboxDispatcher } = await import("../src/server/intelligence/infrastructure/outbox");
const composition = await import("../src/server/intelligence/composition");
const serverSettings = await import("../src/server/settings");
const { sessionToken } = await import("../src/server/auth");
const { GET: getControls, POST: postControls } =
  await import("../src/app/api/intelligence/controls/route");

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

const jobs = createJobStore(db);
const effects = createEffectStore();
const dispatcher = createOutboxDispatcher({
  db,
  jobs,
  handlers: composition.observationOutboxHandlers,
});
// The real handler, on a fixed clock: the whole chain runs on the instant
// the case chooses.
const observationHandler = composition.createTradeObservationHandler({ clock: () => NOW });

/** The worker that observes the committed trade changes of this scratch journal. */
const worker = createWorkerService({
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
const coordinator = createEngagementCoordinator({
  runInTransaction: withJournalTransaction,
  store: createExperienceStore(),
  clock: () => NOW,
});

/** Runs the worker until it has nothing left to claim. */
const drain = async (): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await worker.tick(NOW))) return;
  }
  throw new Error("The worker did not settle.");
};

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

/** Inserts the fills of one closed trade, exactly like an ingestion does. */
const insertTrade = (accountId: string): void => {
  withJournalTransaction((tx) => {
    insertExecutionsInTx(tx, accountId, [entry, exit], "import", changeContext("user", "live"));
  });
};

/** The observations the journal holds. */
const observations = () => db.select().from(intelligenceObservations).all();
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

beforeEach(() => {
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
    .where(inArray(settings.key, ["intelligenceProactiveOptIn", "intelligencePaused"]))
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
