import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { eq, like } from "drizzle-orm";
import type { JournalTx } from "../src/db/transaction";
// The contracts open nothing: they are safe to import statically, before the
// scratch journal is pointed at.
import {
  REVIEW_OBSERVATION_DEFINITION,
  REVIEW_OBSERVATION_VERSION,
} from "../src/server/intelligence/contracts/experience";

/**
 * The workflow engine suite (Phase 16).
 *
 * A workflow is a durable, versioned process. A command applies to it only
 * when the revision the command expects is the revision the workflow has; the
 * same command id with the same payload is answered from the ledger instead of
 * being applied twice; a command that does not apply changes nothing at all.
 *
 * The transition and the effect it enqueues commit together, so a crash can
 * neither lose the effect nor apply it twice. A workflow that waits for the
 * user holds no job, and it releases the jobs it held when the waiting
 * condition clears. A correction is a self-report: it never touches a
 * financial row.
 *
 * Every case runs against a disposable scratch journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-workflows-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
// Every module that opens the journal is imported dynamically for the same
// reason: a static import would run before the environment is set.
const {
  db,
  accounts,
  executions,
  intelligenceConversations,
  intelligenceJobs,
  intelligenceMessages,
  intelligenceOpportunities,
  intelligenceWorkflows,
  interactionCommands,
  journalMigrations,
  notes,
  trades,
  workflowConversations,
  workflowTransitions,
} = await import("../src/db");
const { createJobStore } = await import("../src/server/intelligence/infrastructure/jobs");
const { createExperienceStore } =
  await import("../src/server/intelligence/infrastructure/experience-store");
const { createWorkflowEngine } = await import("../src/server/intelligence/experience/workflows");
const { createExecutionContext } = await import("../src/server/intelligence/runtime/execution");
const { withJournalTransaction } = await import("../src/db/transaction");
const { applyMigrations } = await import("../src/db/migrations");
const checksumManifest = (
  await import("../src/db/migration-checksums.json", {
    with: { type: "json" },
  })
).default as { migrations: Record<string, { file: string; name: string; checksum: string }> };

const ACCOUNT = "acct-workflow";
const OTHER_ACCOUNT = "acct-other";
const NOW = 1_800_000_000_000;

// The journal handle is still open when the suite ends, so the scratch
// directory may not be removable yet; the scratch path is disposable anyway.
afterAll(() => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // The database file is still held by the open handle.
  }
});

/** An execution context that may act on the seeded account. */
const context = (accountIds: readonly string[] = [ACCOUNT]) =>
  createExecutionContext({
    executionId: "exec-workflow",
    correlationId: "corr-workflow",
    principal: "interactive",
    mode: "interactive",
    triggerSource: "user.command",
    scope: {
      accountIds: [...accountIds],
      filters: { accounts: accountIds.join(",") },
      timeZone: "UTC",
      dataSources: ["trades"],
    },
    allowedCapabilityIds: [],
    allowedToolIds: [],
    budgets: {
      maxSteps: 4,
      maxToolCalls: 4,
      maxOutputTokens: 512,
      consumeToolCall: () => true,
    },
    signal: new AbortController().signal,
  });

const jobs = createJobStore(db);
/**
 * The transaction seam.
 *
 * The engine never opens the journal: the caller runs its work in the
 * caller's transaction, and this seam is the caller's side of it.
 */
const runInTransaction = <T>(
  fn: (tx: JournalTx) => T extends PromiseLike<unknown> ? never : T,
): T => withJournalTransaction(fn);

/** The engine under test. The store and the transaction are injected ports. */
const engine = createWorkflowEngine({
  runInTransaction,
  jobs,
  store: createExperienceStore(),
  clock: () => NOW,
});

/** The workflow row. */
const workflow = (id: string) =>
  db.select().from(intelligenceWorkflows).where(eq(intelligenceWorkflows.id, id)).get();
/** The transition history of one workflow, oldest first. */
const transitions = (id: string) =>
  db
    .select()
    .from(workflowTransitions)
    .where(eq(workflowTransitions.workflowId, id))
    .all()
    .sort((left, right) => left.revision - right.revision);
/** The command ledger. */
const commands = () => db.select().from(interactionCommands).all();
/** The effect jobs of one workflow. */
const effectJobs = (id: string) =>
  db
    .select()
    .from(intelligenceJobs)
    .where(like(intelligenceJobs.idempotencyKey, `workflow-effect:${id}:%`))
    .all();
/** The effect jobs of one workflow that are still pending. */
const pendingEffectJobs = (id: string) =>
  effectJobs(id).filter((job) => job.status === "pending" || job.status === "retry_wait");

/** Seeds the account, the note and the trade the correction must not touch. */
const seedFinancials = (): void => {
  db.insert(accounts)
    .values({ id: ACCOUNT, name: "Workflow account", kind: "manual", createdAt: "2026-01-01" })
    .run();
  db.insert(accounts)
    .values({ id: OTHER_ACCOUNT, name: "Other account", kind: "manual", createdAt: "2026-01-01" })
    .run();
  db.insert(notes)
    .values({
      id: "note-1",
      folderId: "folder-1",
      title: "A user note",
      content: "The user's own words.",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    })
    .run();
  db.insert(trades)
    .values({
      key: `${ACCOUNT}|TEST|long|2026-09-01T10:00:00Z`,
      accountId: ACCOUNT,
      symbol: "TEST",
      direction: "long",
      status: "win",
      openedAt: "2026-09-01T10:00:00Z",
      closedAt: "2026-09-01T12:00:00Z",
      quantity: 1,
      openQuantity: 0,
      avgEntry: 100,
      avgExit: 110,
      grossPnl: 10,
      fees: 0,
      netPnl: 10,
      executionCount: 0,
      executionIdsJson: "[]",
      exitsJson: "[]",
    })
    .run();
  db.insert(executions)
    .values({
      id: "exec-1",
      accountId: ACCOUNT,
      symbol: "TEST",
      side: "buy",
      quantity: 1,
      price: 100,
      fee: 0,
      executedAt: "2026-09-01T10:00:00Z",
      source: "manual",
      contentHash: "hash-1",
      createdAt: "2026-01-01",
    })
    .run();
};

/** The financial rows, exactly as they are now. */
const financialRows = () => ({
  accounts: db.select().from(accounts).all(),
  notes: db.select().from(notes).all(),
  trades: db.select().from(trades).all(),
  executions: db.select().from(executions).all(),
});

beforeEach(() => {
  db.delete(workflowConversations).run();
  db.delete(intelligenceMessages).run();
  db.delete(intelligenceConversations).run();
  db.delete(intelligenceOpportunities).run();
  db.delete(interactionCommands).run();
  db.delete(workflowTransitions).run();
  db.delete(intelligenceWorkflows).run();
  db.delete(intelligenceJobs).run();
  db.delete(executions).run();
  db.delete(trades).run();
  db.delete(notes).run();
  db.delete(accounts).run();
  seedFinancials();
});

/** Starts a workflow and hands it to the user, the way the effect does. */
const startedWorkflow = () => {
  const started = engine.startWorkflow(
    {
      subjectType: "observation",
      subjectId: "observation-1",
      accountId: ACCOUNT,
      evidenceIds: ["evidence-1"],
    },
    context(),
  );
  engine.applyWorkflowEffect(started.workflowId, started.revision);
  return started;
};

describe("Phase 16 workflow commands", () => {
  describe("migration 0007", () => {
    it("creates the seven tables the phase owns", () => {
      const tables = db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];
      const names = tables.map((row) => row.name);
      expect(names).toContain("intelligence_workflows");
      expect(names).toContain("workflow_transitions");
      expect(names).toContain("interaction_commands");
      expect(names).toContain("intelligence_opportunities");
      expect(names).toContain("intelligence_conversations");
      expect(names).toContain("intelligence_messages");
      expect(names).toContain("workflow_conversations");
    });

    it("binds the registered checksum of 0007 to the migration source and the ledger", () => {
      const source = readFileSync(
        new URL("../src/db/migrations/0007-intelligence-experience.ts", import.meta.url),
        "utf8",
      )
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+$/gm, "")
        .replace(/\n*$/, "\n");
      const checksum = createHash("sha256").update(source, "utf8").digest("hex");
      expect(checksumManifest.migrations["7"]?.checksum).toBe(checksum);
      const ledger = db
        .select()
        .from(journalMigrations)
        .all()
        .find((row) => row.version === 7);
      expect(ledger?.checksum).toBe(checksum);
    });

    it("upgrades a journal that is at 0006 to the same seven tables", async () => {
      // A journal that predates this phase: the tables do not exist and the
      // ledger holds nothing past 0006.
      db.$client.exec("DROP TABLE workflow_conversations");
      db.$client.exec("DROP TABLE intelligence_messages");
      db.$client.exec("DROP TABLE intelligence_conversations");
      db.$client.exec("DROP TABLE intelligence_opportunities");
      db.$client.exec("DROP TABLE interaction_commands");
      db.$client.exec("DROP TABLE workflow_transitions");
      db.$client.exec("DROP TABLE intelligence_workflows");
      // The insights arrived with migration 0008, so a journal that predates
      // this phase does not have them either and the ledger holds nothing
      // past 0006.
      db.$client.exec("DROP TABLE intelligence_insights");
      db.$client.exec("DELETE FROM journal_migrations WHERE version >= 7");

      applyMigrations(db.$client);

      const tables = db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];
      const names = tables.map((row) => row.name);
      expect(names).toContain("intelligence_workflows");
      expect(names).toContain("workflow_transitions");
      expect(names).toContain("interaction_commands");
      expect(names).toContain("intelligence_opportunities");
      expect(names).toContain("intelligence_conversations");
      expect(names).toContain("intelligence_messages");
      expect(names).toContain("workflow_conversations");
    });
  });

  describe("the command contract", () => {
    it("refuses a correction without a correction and a deferral without an instant", () => {
      const started = engine.startWorkflow(
        { subjectType: "observation", subjectId: "observation-1", accountId: ACCOUNT },
        context(),
      );
      expect(() =>
        engine.transitionWorkflow(
          {
            commandId: "cmd-1",
            workflowId: started.workflowId,
            expectedRevision: 1,
            action: "correct",
          },
          context(),
        ),
      ).toThrow();
      expect(() =>
        engine.transitionWorkflow(
          {
            commandId: "cmd-2",
            workflowId: started.workflowId,
            expectedRevision: 1,
            action: "defer",
          },
          context(),
        ),
      ).toThrow();
    });

    it("refuses the actions the workflow records on its own", () => {
      const started = engine.startWorkflow(
        { subjectType: "observation", subjectId: "observation-1", accountId: ACCOUNT },
        context(),
      );
      // `start` and `present` are recorded transitions, not commands a user
      // can send: they are refused as invalid input, not as a conflict.
      for (const action of ["start", "present"]) {
        const command = {
          commandId: `cmd-${action}`,
          workflowId: started.workflowId,
          expectedRevision: 1,
          action,
        } as unknown as Parameters<typeof engine.transitionWorkflow>[0];
        expect(() => engine.transitionWorkflow(command, context())).toThrow();
      }
    });
  });

  describe("the state machine", () => {
    it("applies a command and records the transition", () => {
      const started = startedWorkflow();
      expect(workflow(started.workflowId)?.status).toBe("waiting_for_user");

      const result = engine.transitionWorkflow(
        {
          commandId: "cmd-ack",
          workflowId: started.workflowId,
          expectedRevision: 2,
          action: "acknowledge",
        },
        context(),
      );

      expect(result).toEqual({ kind: "applied", newRevision: 3 });
      expect(workflow(started.workflowId)?.status).toBe("completed");
      expect(workflow(started.workflowId)?.revision).toBe(3);
      const history = transitions(started.workflowId);
      expect(
        history.map((row) => [row.revision, row.fromStatus, row.toStatus, row.action]),
      ).toEqual([
        [1, null, "running", "start"],
        [2, "running", "waiting_for_user", "present"],
        [3, "waiting_for_user", "completed", "acknowledge"],
      ]);
    });

    it("refuses a command that is not legal from the current status", () => {
      const started = engine.startWorkflow(
        { subjectType: "observation", subjectId: "observation-1", accountId: ACCOUNT },
        context(),
      );
      // The workflow is still running: the user has nothing to answer yet.
      const result = engine.transitionWorkflow(
        {
          commandId: "cmd-early",
          workflowId: started.workflowId,
          expectedRevision: 1,
          action: "acknowledge",
        },
        context(),
      );
      expect(result).toEqual({ kind: "conflict", currentRevision: 1 });
      expect(workflow(started.workflowId)?.revision).toBe(1);
      expect(transitions(started.workflowId)).toHaveLength(1);
    });
  });

  describe("the compare-and-swap", () => {
    it("refuses a stale expected revision and changes nothing", () => {
      const started = startedWorkflow();
      const before = workflow(started.workflowId);

      const result = engine.transitionWorkflow(
        {
          commandId: "cmd-stale",
          workflowId: started.workflowId,
          expectedRevision: 1,
          action: "acknowledge",
        },
        context(),
      );

      expect(result).toEqual({ kind: "conflict", currentRevision: 2 });
      expect(workflow(started.workflowId)).toEqual(before);
      expect(transitions(started.workflowId)).toHaveLength(2);
      expect(commands()).toHaveLength(0);
    });
  });

  describe("the command ledger", () => {
    it("returns the stored prior result for the same command id and the same payload", () => {
      const started = startedWorkflow();
      const command = {
        commandId: "cmd-retry",
        workflowId: started.workflowId,
        expectedRevision: 2,
        action: "acknowledge",
      } as const;

      const first = engine.transitionWorkflow(command, context());
      const second = engine.transitionWorkflow(command, context());

      expect(first).toEqual({ kind: "applied", newRevision: 3 });
      expect(second).toEqual({ kind: "duplicate", priorResult: { newRevision: 3 } });
      expect(workflow(started.workflowId)?.revision).toBe(3);
      expect(transitions(started.workflowId)).toHaveLength(3);
      expect(commands()).toHaveLength(1);
    });

    it("refuses the same command id with a different payload and changes nothing", () => {
      const started = startedWorkflow();
      engine.transitionWorkflow(
        {
          commandId: "cmd-bound",
          workflowId: started.workflowId,
          expectedRevision: 2,
          action: "acknowledge",
        },
        context(),
      );
      const before = workflow(started.workflowId);

      // The same command id, a different meaning: a conflict, never a second
      // application.
      const result = engine.transitionWorkflow(
        {
          commandId: "cmd-bound",
          workflowId: started.workflowId,
          expectedRevision: 2,
          action: "cancel",
        },
        context(),
      );

      expect(result).toEqual({ kind: "conflict", currentRevision: 3 });
      expect(workflow(started.workflowId)).toEqual(before);
      expect(transitions(started.workflowId)).toHaveLength(3);
      expect(commands()).toHaveLength(1);
    });
  });

  describe("the durable effect", () => {
    it("keeps the effect pending when the worker crashes and applies it exactly once", () => {
      const started = engine.startWorkflow(
        { subjectType: "observation", subjectId: "observation-1", accountId: ACCOUNT },
        context(),
      );

      // The worker never came: the effect is still owed, and the workflow is
      // still running.
      expect(pendingEffectJobs(started.workflowId)).toHaveLength(1);
      expect(workflow(started.workflowId)?.status).toBe("running");

      engine.applyWorkflowEffect(started.workflowId, started.revision);
      engine.applyWorkflowEffect(started.workflowId, started.revision);
      // A stale effect that arrives late must not move the marker backwards.
      engine.applyWorkflowEffect(started.workflowId, 0);

      expect(workflow(started.workflowId)?.status).toBe("waiting_for_user");
      expect(workflow(started.workflowId)?.revision).toBe(2);
      expect(workflow(started.workflowId)?.effectRevision).toBe(1);
      const presented = transitions(started.workflowId).filter((row) => row.action === "present");
      expect(presented).toHaveLength(1);
    });

    it("runs the effect of a job inside the caller's transaction", () => {
      const started = engine.startWorkflow(
        { subjectType: "observation", subjectId: "observation-1", accountId: ACCOUNT },
        context(),
      );
      const handler = engine.effectHandler();
      const job = jobs.load(
        withJournalTransaction((tx) =>
          jobs.enqueue(
            tx,
            `workflow-effect:${started.workflowId}:1`,
            { type: "workflow_effect", workflowId: started.workflowId, transitionRevision: 1 },
            NOW,
          ),
        ),
      );
      expect(job).not.toBeNull();

      withJournalTransaction((tx) => handler.run(tx, job!));

      expect(workflow(started.workflowId)?.status).toBe("waiting_for_user");
      expect(workflow(started.workflowId)?.revision).toBe(2);
      expect(
        transitions(started.workflowId).filter((row) => row.action === "present"),
      ).toHaveLength(1);
    });

    it("applies the transition and the effect enqueue in one transaction", () => {
      const started = startedWorkflow();
      const failing = {
        ...jobs,
        enqueue: () => {
          throw new Error("The job store refused the enqueue.");
        },
      };
      const broken = createWorkflowEngine({
        runInTransaction,
        jobs: failing,
        store: createExperienceStore(),
        clock: () => NOW,
      });

      expect(() =>
        broken.transitionWorkflow(
          {
            commandId: "cmd-crash",
            workflowId: started.workflowId,
            expectedRevision: 2,
            action: "defer",
            deferUntil: NOW + 60_000,
          },
          context(),
        ),
      ).toThrow("The job store refused the enqueue.");

      // The transition rolled back with the enqueue: nothing was applied and
      // nothing was recorded.
      expect(workflow(started.workflowId)?.revision).toBe(2);
      expect(workflow(started.workflowId)?.status).toBe("waiting_for_user");
      expect(transitions(started.workflowId)).toHaveLength(2);
      expect(commands()).toHaveLength(0);
    });
  });

  describe("the waiting workflow", () => {
    it("holds no job while it waits for the user", () => {
      const started = startedWorkflow();
      expect(workflow(started.workflowId)?.status).toBe("waiting_for_user");
      expect(pendingEffectJobs(started.workflowId)).toHaveLength(0);
    });

    it("releases the workflow's job when the waiting condition clears", () => {
      const started = startedWorkflow();
      // A job left pending from an earlier attempt.
      const stale = withJournalTransaction((tx) =>
        jobs.enqueue(
          tx,
          `workflow-effect:${started.workflowId}:99`,
          { type: "workflow_effect", workflowId: started.workflowId, transitionRevision: 99 },
          NOW,
        ),
      );
      expect(stale).toBeTruthy();
      expect(pendingEffectJobs(started.workflowId)).toHaveLength(1);

      engine.transitionWorkflow(
        {
          commandId: "cmd-release",
          workflowId: started.workflowId,
          expectedRevision: 2,
          action: "acknowledge",
        },
        context(),
      );

      expect(pendingEffectJobs(started.workflowId)).toHaveLength(0);
      const released = effectJobs(started.workflowId).find((job) => job.id === stale);
      expect(released?.status).toBe("cancelled");
    });

    it("returns a deferred workflow to the user when the deferred condition clears", () => {
      const started = startedWorkflow();
      const deferUntil = NOW + 60_000;

      const result = engine.transitionWorkflow(
        {
          commandId: "cmd-defer",
          workflowId: started.workflowId,
          expectedRevision: 2,
          action: "defer",
          deferUntil,
        },
        context(),
      );

      expect(result).toEqual({ kind: "applied", newRevision: 3 });
      expect(workflow(started.workflowId)?.status).toBe("scheduled");
      expect(workflow(started.workflowId)?.deferUntil).toBe(deferUntil);
      const deferred = pendingEffectJobs(started.workflowId);
      expect(deferred).toHaveLength(1);
      expect(deferred[0]?.availableAt).toBe(deferUntil);

      // The deferred condition clears: the workflow waits for the user again
      // and holds no job.
      engine.applyWorkflowEffect(started.workflowId, 3);
      expect(workflow(started.workflowId)?.status).toBe("waiting_for_user");
      expect(workflow(started.workflowId)?.revision).toBe(4);
      expect(pendingEffectJobs(started.workflowId)).toHaveLength(0);
    });
  });

  describe("the correction", () => {
    it("records a self-report and leaves the financial rows untouched", () => {
      const started = startedWorkflow();
      const before = financialRows();

      const result = engine.transitionWorkflow(
        {
          commandId: "cmd-correct",
          workflowId: started.workflowId,
          expectedRevision: 2,
          action: "correct",
          correction: "I was wrong: the setup was never valid.",
        },
        context(),
      );

      expect(result).toEqual({ kind: "applied", newRevision: 3 });
      const row = workflow(started.workflowId);
      expect(row?.status).toBe("completed");
      const report = JSON.parse(row?.selfReportJson ?? "null") as {
        text: string;
        executionId: string;
        correlationId: string;
      } | null;
      expect(report?.text).toBe("I was wrong: the setup was never valid.");
      expect(report?.executionId).toBe("exec-workflow");
      expect(report?.correlationId).toBe("corr-workflow");
      expect(row?.evidenceIdsJson).toBe(JSON.stringify(["evidence-1"]));

      // The correction is a self-report: no trade, execution, note or account
      // row moved.
      expect(financialRows()).toEqual(before);
    });
  });

  describe("the scope", () => {
    it("refuses a command for a workflow outside the commander's scope", () => {
      const started = startedWorkflow();
      const before = workflow(started.workflowId);

      const result = engine.transitionWorkflow(
        {
          commandId: "cmd-out-of-scope",
          workflowId: started.workflowId,
          expectedRevision: 2,
          action: "acknowledge",
        },
        context([OTHER_ACCOUNT]),
      );

      expect(result).toEqual({ kind: "conflict", currentRevision: 2 });
      expect(workflow(started.workflowId)).toEqual(before);
      expect(transitions(started.workflowId)).toHaveLength(2);
      expect(commands()).toHaveLength(0);
    });

    it("refuses an out-of-scope replay of a command it already knows", () => {
      const started = startedWorkflow();
      engine.transitionWorkflow(
        {
          commandId: "cmd-known",
          workflowId: started.workflowId,
          expectedRevision: 2,
          action: "acknowledge",
        },
        context(),
      );
      // The command id is known, but the caller may not act on this
      // workflow: the ledger must not answer it either.
      const result = engine.transitionWorkflow(
        {
          commandId: "cmd-known",
          workflowId: started.workflowId,
          expectedRevision: 2,
          action: "acknowledge",
        },
        context([OTHER_ACCOUNT]),
      );

      expect(result).toEqual({ kind: "conflict", currentRevision: 3 });
      expect(transitions(started.workflowId)).toHaveLength(3);
    });
  });

  describe("the domain boundary", () => {
    it("performs no database side effect when the domain layer is imported", async () => {
      // The journal opens — and migrates — when its module is evaluated, so
      // the domain layer must not reach it at all. The import runs against
      // an empty data directory: a journal that opens leaves its files
      // behind.
      const isolated = mkdtempSync(join(tmpdir(), "journal-domain-"));
      const previous = process.env.JOURNAL_DATA_DIR;
      process.env.JOURNAL_DATA_DIR = isolated;
      vi.resetModules();
      try {
        const domain = await import("../src/server/intelligence/experience/workflows");
        expect(domain.createWorkflowEngine).toBeTypeOf("function");
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
      const seamEngine = createWorkflowEngine({
        runInTransaction: seam,
        jobs,
        store: createExperienceStore(),
        clock: () => NOW,
      });

      const started = seamEngine.startWorkflow(
        { subjectType: "observation", subjectId: "observation-1", accountId: ACCOUNT },
        context(),
      );
      expect(calls).toBe(1);
      expect(pendingEffectJobs(started.workflowId)).toHaveLength(1);

      seamEngine.applyWorkflowEffect(started.workflowId, started.revision);
      expect(calls).toBe(2);
      expect(workflow(started.workflowId)?.status).toBe("waiting_for_user");
    });
  });

  describe("the definition version", () => {
    /** Stores a workflow the engine was never written for. */
    const storeWorkflow = (values: {
      id: string;
      definitionKey: string;
      definitionVersion: number;
      status: "running" | "waiting_for_user";
      revision: number;
    }): void => {
      db.insert(intelligenceWorkflows)
        .values({
          id: values.id,
          definitionKey: values.definitionKey,
          definitionVersion: values.definitionVersion,
          revision: values.revision,
          status: values.status,
          subjectType: "observation",
          subjectId: "observation-1",
          accountId: ACCOUNT,
          evidenceIdsJson: "[]",
          selfReportJson: null,
          deferUntil: null,
          effectRevision: 0,
          createdAt: NOW,
          updatedAt: NOW,
        })
        .run();
    };

    it("refuses a command for a workflow under a definition it does not support", () => {
      storeWorkflow({
        id: "workflow-foreign",
        definitionKey: "foreign_definition",
        definitionVersion: 1,
        status: "waiting_for_user",
        revision: 2,
      });

      const result = engine.transitionWorkflow(
        {
          commandId: "cmd-foreign",
          workflowId: "workflow-foreign",
          expectedRevision: 2,
          action: "acknowledge",
        },
        context(),
      );

      expect(result).toEqual({ kind: "conflict", currentRevision: 2 });
      expect(workflow("workflow-foreign")?.status).toBe("waiting_for_user");
      expect(workflow("workflow-foreign")?.revision).toBe(2);
      expect(transitions("workflow-foreign")).toHaveLength(0);
      expect(commands()).toHaveLength(0);
    });

    it("refuses a command for a workflow under a version it does not support", () => {
      storeWorkflow({
        id: "workflow-old-version",
        definitionKey: REVIEW_OBSERVATION_DEFINITION,
        definitionVersion: REVIEW_OBSERVATION_VERSION + 1,
        status: "waiting_for_user",
        revision: 2,
      });

      const result = engine.transitionWorkflow(
        {
          commandId: "cmd-old-version",
          workflowId: "workflow-old-version",
          expectedRevision: 2,
          action: "acknowledge",
        },
        context(),
      );

      expect(result).toEqual({ kind: "conflict", currentRevision: 2 });
      expect(workflow("workflow-old-version")?.revision).toBe(2);
      expect(transitions("workflow-old-version")).toHaveLength(0);
      expect(commands()).toHaveLength(0);
    });

    it("does not advance a workflow it does not support when its effect runs", () => {
      storeWorkflow({
        id: "workflow-foreign-running",
        definitionKey: "foreign_definition",
        definitionVersion: 1,
        status: "running",
        revision: 1,
      });

      engine.applyWorkflowEffect("workflow-foreign-running", 1);

      expect(workflow("workflow-foreign-running")?.status).toBe("running");
      expect(workflow("workflow-foreign-running")?.revision).toBe(1);
      expect(transitions("workflow-foreign-running")).toHaveLength(0);
    });
  });
});
