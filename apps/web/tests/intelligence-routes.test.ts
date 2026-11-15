import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, like } from "drizzle-orm";

/**
 * The interaction route suite (Phase 18).
 *
 * The routes are the authenticated surface of the intelligence loop: they
 * hand the operator the interactions that are live and apply the operator's
 * decisions to durable state. The suite drives the route handlers themselves,
 * against a disposable scratch journal.
 *
 * The state is built through the domain wherever the domain has one: the
 * workflow engine starts the workflows, the engagement coordinator records the
 * opportunities, and the account is a journal row. The observation is a
 * factual row the journal derives from a trade — no producer for it exists in
 * this phase, so it is written directly.
 */

const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (session.token ? { value: session.token } : undefined) }),
}));

// The AI runtime is mocked: the Ask contract is about the route and the
// scope it answers, not about the provider behind it.
const { mockAskJournalAi, mockReportsAgentAi, mockRunAi, mockAiConfigured } = vi.hoisted(() => ({
  mockAskJournalAi: vi.fn(async () => "Ask AI response"),
  mockReportsAgentAi: vi.fn(async () => "Reports AI response"),
  mockRunAi: vi.fn(async () => "AI response"),
  mockAiConfigured: vi.fn(() => false),
}));
vi.mock("@/server/ai", () => ({
  runAskJournalAi: mockAskJournalAi,
  runReportsAgentAi: mockReportsAgentAi,
  runAi: mockRunAi,
  aiConfigured: mockAiConfigured,
}));

const scratch = mkdtempSync(join(tmpdir(), "journal-intelligence-routes-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal opens the database when it is first evaluated, so every module
// that opens it is imported dynamically, after the data dir is set.
const {
  db,
  accounts,
  intelligenceJobs,
  intelligenceObservations,
  intelligenceOpportunities,
  intelligenceWorkflows,
  interactionCommands,
  observationEvidence,
  workflowTransitions,
} = await import("../src/db");
const { sessionToken } = await import("../src/server/auth");
const { engagementCoordinator, interactiveExecutionContext, workflowEngine } =
  await import("../src/server/intelligence/composition");
const { GET: getObservations, POST: postObservations } =
  await import("../src/app/api/intelligence/observations/route");
const { GET: getOpportunities, POST: postOpportunities } =
  await import("../src/app/api/intelligence/opportunities/route");
const { POST: postCommands } = await import("../src/app/api/intelligence/commands/route");
const { GET: getConversations } = await import("../src/app/api/intelligence/conversations/route");
const { GET: getStatus } = await import("../src/app/api/intelligence/status/route");
const { DELETE: deleteAccountRoute } = await import("../src/app/api/accounts/[id]/route");
const { insertExecutions } = await import("../src/server/executions");
const { setSetting } = await import("../src/server/settings");
const { POST: postAsk } = await import("../src/app/api/ai/ask/route");

const ACCOUNT = "acct-alpha";
const OTHER_ACCOUNT = "acct-beta";
const NOW = 1_800_000_000_000;

/** The account row the scope refers to. */
const seedAccount = (id: string) =>
  db
    .insert(accounts)
    .values({
      id,
      name: id,
      kind: "manual",
      broker: "",
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    .run();

/** Two fills that close one round trip. */
const fills = (symbol: string, exit: number, date = "2026-09-15") => [
  {
    symbol,
    side: "buy" as const,
    quantity: 1,
    price: 100,
    fee: 0,
    executedAt: date + "T09:00:00Z",
  },
  {
    symbol,
    side: "sell" as const,
    quantity: 1,
    price: exit,
    fee: 0,
    executedAt: date + "T10:00:00Z",
  },
];

/** One observation of an account, with its evidence link. */
const seedObservation = (
  id: string,
  accountId: string,
  status: "active" | "superseded" | "invalidated" = "active",
): void => {
  const evidence = {
    revisionId: `revision-${id}`,
    tradeId: `trade-${id}`,
    revision: 1,
    accountId,
    tradeKey: `${accountId}|TEST|long|2026-09-01T10:00:00Z`,
    currency: "EUR",
    status: "win",
    netPnl: 10,
    fees: 1,
    openQuantity: 0,
    openedAt: "2026-09-01T10:00:00Z",
    closedAt: "2026-09-01T12:00:00Z",
    timingQuality: "source_reported",
    durationMs: 7_200_000,
    identityResolution: "exact_key",
  };
  db.insert(intelligenceObservations)
    .values({
      id,
      subjectId: `trade-${id}`,
      sourceRevision: evidence.revisionId,
      evaluatorId: "trade.projection-observed",
      evaluatorVersion: "1",
      type: "trade_projection",
      status,
      accountId,
      currency: "EUR",
      netPnl: 10,
      fees: 1,
      tradeStatus: "win",
      timingQuality: "source_reported",
      durationMs: 7_200_000,
      directFactsJson: JSON.stringify(evidence),
      observationJson: JSON.stringify({ kind: "trade_projection", evidence }),
      recordedAt: NOW,
      updatedAt: NOW,
    })
    .run();
  db.insert(observationEvidence)
    .values({ observationId: id, revisionId: evidence.revisionId })
    .run();
};

/**
 * Starts a workflow and hands it to the user, the way the effect does.
 *
 * The workflow waits for the user at revision 2.
 */
const openWorkflow = (accountId: string | null, subjectId = "observation-1"): string => {
  const started = workflowEngine.startWorkflow(
    { subjectType: "observation", subjectId, accountId, evidenceIds: [] },
    interactiveExecutionContext(accountId ? [accountId] : []),
  );
  workflowEngine.applyWorkflowEffect(started.workflowId, started.revision);
  return started.workflowId;
};

/** One engagement, recorded through the coordinator. */
const engageOpportunity = (accountId: string, subjectId = "observation-1") =>
  engagementCoordinator.engage({
    dedupKey: `producer-${subjectId}`,
    subject: { type: "observation", id: subjectId },
    accountId,
    evidenceRevisions: [`revision-${subjectId}`],
    material: "current",
    actionable: true,
    proactiveOptIn: false,
    activity: "idle",
  });

/** The workflow row. */
const workflowRow = (id: string) =>
  db.select().from(intelligenceWorkflows).where(eq(intelligenceWorkflows.id, id)).get();

/** The transitions of one workflow. */
const transitionsOf = (workflowId: string) =>
  db.select().from(workflowTransitions).where(eq(workflowTransitions.workflowId, workflowId)).all();

/** The command ledger rows of one workflow. */
const commandsOf = (workflowId: string) =>
  db.select().from(interactionCommands).where(eq(interactionCommands.workflowId, workflowId)).all();

/** The effect jobs of one workflow. */
const jobsOf = (workflowId: string) =>
  db
    .select()
    .from(intelligenceJobs)
    .where(like(intelligenceJobs.idempotencyKey, `workflow-effect:${workflowId}:%`))
    .all();

/** One command body, addressed to the workflow at its current revision. */
const commandBody = (
  workflowId: string,
  action: "acknowledge" | "correct" | "defer" | "cancel",
  revision = 2,
  extra: Record<string, unknown> = {},
) => ({
  actionId: `act:${workflowId}:${action}:${revision}`,
  commandId: `command-${workflowId}-${action}-${revision}`,
  expectedRevision: revision,
  action,
  ...extra,
});

const get = (path: string) => new Request(`http://localhost${path}`);

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  db.delete(workflowTransitions).run();
  db.delete(interactionCommands).run();
  db.delete(intelligenceWorkflows).run();
  db.delete(intelligenceOpportunities).run();
  db.delete(intelligenceObservations).run();
  db.delete(observationEvidence).run();
  db.delete(intelligenceJobs).run();
  db.delete(accounts).run();
  session.token = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // The database file is still held by the open handle.
  }
});

describe("the authentication gate", () => {
  it("refuses every route without a session and admits every route with one", async () => {
    seedAccount(ACCOUNT);
    seedObservation("observation-1", ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT, "observation-1");
    const opportunity = engageOpportunity(ACCOUNT, "observation-1");
    const target = opportunity.opportunity.id;

    const requests = [
      () => getObservations(get("/api/intelligence/observations")),
      () =>
        postObservations(
          post("/api/intelligence/observations", { observationId: "observation-1" }),
        ),
      () => getOpportunities(get("/api/intelligence/opportunities")),
      () =>
        postOpportunities(
          post("/api/intelligence/opportunities", {
            actionId: `act:opportunity:${target}:dismiss`,
            scope: "opportunity",
            target,
          }),
        ),
      () =>
        postCommands(post("/api/intelligence/commands", commandBody(workflowId, "acknowledge"))),
      () => getConversations(get("/api/intelligence/conversations")),
      () => getStatus(),
    ];

    vi.stubEnv("JOURNAL_PASSWORD", "test-password");
    session.token = undefined;
    for (const request of requests) {
      const response = await request();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }

    session.token = sessionToken();
    for (const request of requests) {
      const response = await request();
      expect(response.status).toBe(200);
    }
  });
});

describe("the origin policy", () => {
  it("refuses a foreign origin and changes nothing", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);
    const before = db.select().from(workflowTransitions).all().length;

    const response = await postCommands(
      post("/api/intelligence/commands", commandBody(workflowId, "acknowledge"), {
        Origin: "https://evil.example",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_denied" });
    expect(db.select().from(workflowTransitions).all()).toHaveLength(before);
    expect(commandsOf(workflowId)).toHaveLength(0);
  });

  it("allows a request without an origin and without a fetch site", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);

    const response = await postCommands(
      post("/api/intelligence/commands", commandBody(workflowId, "acknowledge")),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "applied", newRevision: 3 });
  });

  it("refuses a request without an origin that declares a cross-site fetch", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);

    const response = await postCommands(
      post("/api/intelligence/commands", commandBody(workflowId, "acknowledge"), {
        "Sec-Fetch-Site": "cross-site",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "origin_denied" });
    expect(commandsOf(workflowId)).toHaveLength(0);
  });

  it("allows a same-origin request", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);

    const response = await postCommands(
      post("/api/intelligence/commands", commandBody(workflowId, "acknowledge"), {
        Origin: "http://localhost",
        "Sec-Fetch-Site": "same-origin",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "applied", newRevision: 3 });
  });
});

describe("the scope policy", () => {
  it("refuses a request that names an account that does not exist", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);

    const read = await getObservations(get("/api/intelligence/observations?scope=ghost"));
    expect(read.status).toBe(403);
    expect(await read.json()).toEqual({ error: "scope_denied" });

    const command = await postCommands(
      post("/api/intelligence/commands", {
        ...commandBody(workflowId, "acknowledge"),
        scope: ["ghost"],
      }),
    );
    expect(command.status).toBe(403);
    expect(await command.json()).toEqual({ error: "scope_denied" });
    expect(commandsOf(workflowId)).toHaveLength(0);
  });

  it("refuses a command that names an unknown account against a journal-wide workflow", async () => {
    seedAccount(ACCOUNT);
    // A workflow with no account is journal-wide: the workflow-scope rule
    // alone would admit it, so only the revoked-scope rule can refuse it.
    const workflowId = openWorkflow(null);
    const engine = vi.spyOn(workflowEngine, "transitionWorkflow");

    const response = await postCommands(
      post("/api/intelligence/commands", {
        ...commandBody(workflowId, "acknowledge"),
        scope: ["ghost"],
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "scope_denied" });
    // The revoked scope is refused before the engine runs, so nothing was written.
    expect(engine).not.toHaveBeenCalled();
    expect(commandsOf(workflowId)).toHaveLength(0);
  });

  it("returns only the rows of the scope", async () => {
    seedAccount(ACCOUNT);
    seedAccount(OTHER_ACCOUNT);
    seedObservation("observation-alpha", ACCOUNT);
    seedObservation("observation-beta", OTHER_ACCOUNT);

    const response = await getObservations(get(`/api/intelligence/observations?scope=${ACCOUNT}`));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      observations: { id: string }[];
      intents: { workflowId: string }[];
    };
    expect(body.observations.map((row) => row.id)).toEqual(["observation-alpha"]);
  });

  it("refuses a command on a workflow outside the scope", async () => {
    seedAccount(ACCOUNT);
    seedAccount(OTHER_ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);

    const response = await postCommands(
      post("/api/intelligence/commands", {
        ...commandBody(workflowId, "acknowledge"),
        scope: [OTHER_ACCOUNT],
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "scope_denied" });
    expect(commandsOf(workflowId)).toHaveLength(0);
  });

  it("refuses to dismiss an evidence revision that belongs to no account when the request names accounts", async () => {
    seedAccount(ACCOUNT);
    const target = "revision-unowned";
    const body = {
      actionId: `act:evidence:${target}:dismiss`,
      scope: "evidence",
      target,
    };

    const denied = await postOpportunities(
      post("/api/intelligence/opportunities", { ...body, accounts: [ACCOUNT] }),
    );

    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "scope_denied" });
    // The refusal happens before the dismissal is recorded.
    expect(
      db
        .select()
        .from(intelligenceOpportunities)
        .all()
        .filter((row) => row.dedupKey.startsWith("dismissal/")),
    ).toHaveLength(0);

    // The same dismissal is allowed when the request is about every account.
    const allowed = await postOpportunities(post("/api/intelligence/opportunities", body));

    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ kind: "dismissed", scope: "evidence", target });
  });
});

describe("the observation reviews", () => {
  it("refuses to start a review of an observation that is no longer active", async () => {
    seedAccount(ACCOUNT);
    seedObservation("observation-invalidated", ACCOUNT, "invalidated");
    seedObservation("observation-superseded", ACCOUNT, "superseded");
    const engine = vi.spyOn(workflowEngine, "startWorkflow");

    for (const observationId of ["observation-invalidated", "observation-superseded"]) {
      const response = await postObservations(
        post("/api/intelligence/observations", { observationId }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }

    // The refusal happens before the workflow is started, so nothing was written.
    expect(engine).not.toHaveBeenCalled();
    expect(db.select().from(intelligenceWorkflows).all()).toHaveLength(0);
  });
});

describe("the stale actions", () => {
  it("applies a command at the current revision", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);

    const response = await postCommands(
      post("/api/intelligence/commands", commandBody(workflowId, "acknowledge")),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "applied", newRevision: 3 });
    expect(workflowRow(workflowId)?.status).toBe("completed");
  });

  it("answers a repeated command with a duplicate and applies it once", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);
    const body = commandBody(workflowId, "acknowledge");

    const first = await postCommands(post("/api/intelligence/commands", body));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ kind: "applied", newRevision: 3 });

    const second = await postCommands(post("/api/intelligence/commands", body));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ kind: "duplicate", priorResult: { newRevision: 3 } });

    expect(transitionsOf(workflowId)).toHaveLength(3);
    expect(commandsOf(workflowId)).toHaveLength(1);
  });

  it("refuses a command at an old revision and writes nothing", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);
    const engine = vi.spyOn(workflowEngine, "transitionWorkflow");

    const response = await postCommands(
      post("/api/intelligence/commands", commandBody(workflowId, "acknowledge", 1)),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "stale_revision", currentRevision: 2 });
    // The stale check happens before the engine runs, so nothing was written.
    expect(engine).not.toHaveBeenCalled();
    expect(transitionsOf(workflowId)).toHaveLength(2);
    expect(commandsOf(workflowId)).toHaveLength(0);
  });
});

describe("the inconsistent commands", () => {
  it("refuses a command whose action id and expected revision disagree and writes nothing", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);
    const engine = vi.spyOn(workflowEngine, "transitionWorkflow");
    const body = commandBody(workflowId, "acknowledge");

    const response = await postCommands(
      post("/api/intelligence/commands", {
        ...body,
        actionId: `act:${workflowId}:acknowledge:1`,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    // The inconsistency is caught before the engine runs, so nothing was written.
    expect(engine).not.toHaveBeenCalled();
    expect(transitionsOf(workflowId)).toHaveLength(2);
    expect(commandsOf(workflowId)).toHaveLength(0);
  });
});

describe("the corrections, dismissals and deferrals", () => {
  it("records a correction on the workflow and advances the revision", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);

    const response = await postCommands(
      post(
        "/api/intelligence/commands",
        commandBody(workflowId, "correct", 2, {
          correction: "The stop was wider than the journal thinks.",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "applied", newRevision: 3 });
    const row = workflowRow(workflowId);
    expect(row?.status).toBe("completed");
    expect(row?.revision).toBe(3);
    expect(JSON.parse(row?.selfReportJson ?? "{}")).toMatchObject({
      text: "The stop was wider than the journal thinks.",
    });
  });

  it("defers the workflow until the given instant", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);
    const deferUntil = NOW + 60_000;

    const response = await postCommands(
      post("/api/intelligence/commands", commandBody(workflowId, "defer", 2, { deferUntil })),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "applied", newRevision: 3 });
    const row = workflowRow(workflowId);
    expect(row?.status).toBe("scheduled");
    expect(row?.deferUntil).toBe(deferUntil);
  });

  it("dismisses an opportunity, records the dismissal and keeps it dismissed", async () => {
    seedAccount(ACCOUNT);
    const opportunity = engageOpportunity(ACCOUNT);
    const target = opportunity.opportunity.id;
    const body = {
      actionId: `act:opportunity:${target}:dismiss`,
      scope: "opportunity",
      target,
    };

    const first = await postOpportunities(post("/api/intelligence/opportunities", body));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      kind: "dismissed",
      scope: "opportunity",
      target,
    });

    const dismissed = db
      .select()
      .from(intelligenceOpportunities)
      .where(eq(intelligenceOpportunities.id, target))
      .get();
    expect(dismissed?.status).toBe("dismissed");
    const dismissals = db
      .select()
      .from(intelligenceOpportunities)
      .all()
      .filter((row) => row.dedupKey.startsWith("dismissal/"));
    expect(dismissals).toHaveLength(1);

    const second = await postOpportunities(post("/api/intelligence/opportunities", body));
    expect(second.status).toBe(200);
    const still = db
      .select()
      .from(intelligenceOpportunities)
      .where(eq(intelligenceOpportunities.id, target))
      .get();
    expect(still?.status).toBe("dismissed");
    expect(
      db
        .select()
        .from(intelligenceOpportunities)
        .all()
        .filter((row) => row.dedupKey.startsWith("dismissal/")),
    ).toHaveLength(1);
  });

  it("no longer lists an opportunity that was dismissed", async () => {
    seedAccount(ACCOUNT);
    const opportunity = engageOpportunity(ACCOUNT);
    const target = opportunity.opportunity.id;

    const listed = await getOpportunities(get("/api/intelligence/opportunities"));
    expect(listed.status).toBe(200);
    const before = (await listed.json()) as { opportunities: { id: string }[] };
    expect(before.opportunities.map((row) => row.id)).toContain(target);

    const dismissed = await postOpportunities(
      post("/api/intelligence/opportunities", {
        actionId: `act:opportunity:${target}:dismiss`,
        scope: "opportunity",
        target,
      }),
    );
    expect(dismissed.status).toBe(200);

    const after = await getOpportunities(get("/api/intelligence/opportunities"));
    expect(after.status).toBe(200);
    const body = (await after.json()) as { opportunities: { id: string }[] };
    expect(body.opportunities).toEqual([]);
    // The dismissal is still recorded, but it is not an opportunity.
    expect(
      db
        .select()
        .from(intelligenceOpportunities)
        .all()
        .filter((row) => row.dedupKey.startsWith("dismissal/")),
    ).toHaveLength(1);
  });
});

describe("the purge race", () => {
  it("refuses the command of a purged workflow and writes nothing", async () => {
    seedAccount(ACCOUNT);
    const workflowId = openWorkflow(ACCOUNT);
    const jobsBefore = jobsOf(workflowId);
    const engine = vi.spyOn(workflowEngine, "transitionWorkflow");

    const deleted = await deleteAccountRoute(new Request("http://localhost/api/accounts/x"), {
      params: Promise.resolve({ id: ACCOUNT }),
    });
    expect(deleted.status).toBe(200);

    const response = await postCommands(
      post("/api/intelligence/commands", commandBody(workflowId, "acknowledge")),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "stale_revision", currentRevision: 0 });
    // The purge is detected before the engine runs, so nothing was written.
    expect(engine).not.toHaveBeenCalled();
    expect(transitionsOf(workflowId)).toHaveLength(0);
    expect(commandsOf(workflowId)).toHaveLength(0);
    expect(jobsOf(workflowId)).toEqual(jobsBefore);
  });
});

describe("the existing AI contracts", () => {
  it("the Ask route still answers with the answer and the scope", async () => {
    db.insert(accounts)
      .values({ id: "a", name: "Account A", kind: "manual", createdAt: "2026-01-01" })
      .run();
    insertExecutions("a", fills("ONLY_A", 110), "manual");
    setSetting("timeZone", "UTC");

    const response = await postAsk(
      post("/api/ai/ask", {
        question: "How did I do?",
        filters: { accounts: "a" },
        timeZone: "UTC",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      answer: "Ask AI response",
      scope: expect.objectContaining({ label: expect.stringContaining("Account A") }),
    });
    expect(mockAskJournalAi).toHaveBeenCalledTimes(1);
    expect(mockReportsAgentAi).not.toHaveBeenCalled();
  });
});
