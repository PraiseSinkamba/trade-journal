import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";

/**
 * The source-revision suite (Phase 14).
 *
 * A user-authored source — a note, a rule check, a playbook, a journal day
 * note or a trade annotation — changes in one transaction with the revision
 * that describes it. A correction marks the knowledge that was derived from
 * the old content stale and asks for a re-evaluation; a deletion invalidates
 * it, because a source that no longer exists cannot be re-derived.
 *
 * Every case runs against a disposable scratch journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-knowledge-revisions-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
// A static import cannot work here: the import would run before the
// environment is set.
const {
  db,
  accounts,
  executions,
  folders,
  journalDays,
  journalMigrations,
  knowledgeHypotheses,
  knowledgePatterns,
  knowledgeSources,
  notes,
  playbooks,
  tradeRuleChecks,
  trades,
} = await import("../src/db");
const { withJournalTransaction } = await import("../src/db/transaction");
const { recordManualTrades } = await import("../src/server/trading/commands");
const { changeContext } = await import("../src/server/trading/reconcile");
const { rebuildAccount } = await import("../src/server/rebuild");
const { recordSourceChanges } = await import("../src/server/intelligence/composition");
const { listKnowledgeInScope } =
  await import("../src/server/intelligence/infrastructure/knowledge-revisions");
const { evaluatePattern, patternEvaluationSchema } =
  await import("../src/server/intelligence/contracts/knowledge");
const { parseSourceChange } = await import("../src/server/domain-events");
// The route modules open the journal when they are first evaluated, so they
// are imported dynamically for the same reason the database module is.
const { POST: createNote } = await import("../src/app/api/notes/route");
const { PATCH: patchNote, DELETE: deleteNote } = await import("../src/app/api/notes/[id]/route");
const { PUT: putJournal } = await import("../src/app/api/journal/[date]/route");
const { POST: createPlaybook } = await import("../src/app/api/playbooks/route");
const { PATCH: patchPlaybook, DELETE: deletePlaybook } =
  await import("../src/app/api/playbooks/[id]/route");
const { PATCH: patchTrade, DELETE: deleteTrade } =
  await import("../src/app/api/trades/[key]/route");
const { POST: postRule } = await import("../src/app/api/trades/[key]/rules/route");
const { POST: bulkTrades } = await import("../src/app/api/trades/bulk/route");
const { DELETE: deleteFolder } = await import("../src/app/api/folders/[id]/route");
const checksumManifest = (
  await import("../src/db/migration-checksums.json", {
    with: { type: "json" },
  })
).default as { migrations: Record<string, { file: string; name: string; checksum: string }> };

const ACCOUNT = "acct-knowledge";
const TRADE_KEY = `${ACCOUNT}|TEST|long|2026-09-01T10:00:00Z`;

// The journal handle is still open when the suite ends, so the scratch
// directory may not be removable yet; the scratch path is disposable anyway.
afterAll(() => {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // The database file is still held by the open handle.
  }
});

/** The source revisions the journal holds. */
const sources = () => db.select().from(knowledgeSources).all();
/** The hypotheses the journal holds. */
const hypotheses = () => db.select().from(knowledgeHypotheses).all();
/** The patterns the journal holds. */
const patterns = () => db.select().from(knowledgePatterns).all();

/** The source revision of one source, newest first. */
const sourceOf = (kind: string, sourceId: string) =>
  sources()
    .filter((row) => row.kind === kind && row.sourceId === sourceId)
    .sort((left, right) => right.revision - left.revision);

/**
 * Seeds a knowledge record that depends on a source.
 *
 * Nothing in this phase produces findings — there is no evaluator yet — so
 * the fixture writes the rows directly. Without them the invalidation
 * assertions could pass vacuously.
 */
const seedHypothesis = (input: {
  readonly id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly version: number;
  readonly status: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly accountId: string | null;
}): void => {
  db.insert(knowledgeHypotheses)
    .values({
      id: input.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      version: input.version,
      status: input.status as "active",
      payloadSchemaVersion: 1,
      payloadJson: JSON.stringify({ schemaVersion: 1, statement: "the trader followed the plan" }),
      evidenceIdsJson: JSON.stringify(["evidence-1"]),
      evaluatorId: "fixture.evaluator",
      evaluatorVersion: "1",
      sourceKind: input.sourceKind as "note",
      sourceId: input.sourceId,
      sourceRevision: input.sourceRevision,
      accountId: input.accountId,
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
    })
    .run();
};

/** Seeds a pattern that depends on a source. */
const seedPattern = (input: {
  readonly id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly version: number;
  readonly status: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly sourceRevision: number;
  readonly accountId: string | null;
}): void => {
  db.insert(knowledgePatterns)
    .values({
      id: input.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      version: input.version,
      status: input.status as "active",
      payloadSchemaVersion: 1,
      payloadJson: JSON.stringify({ schemaVersion: 1, statement: "the trader repeats a pattern" }),
      evidenceIdsJson: JSON.stringify(["evidence-1"]),
      evaluatorId: "fixture.evaluator",
      evaluatorVersion: "1",
      evaluationState: "evaluated",
      requiredEvidence: 1,
      availableEvidence: 1,
      sourceKind: input.sourceKind as "note",
      sourceId: input.sourceId,
      sourceRevision: input.sourceRevision,
      accountId: input.accountId,
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
    })
    .run();
};

/** The hypothesis rows of one subject, newest version first. */
const knowledgeOf = (subjectId: string) =>
  hypotheses()
    .filter((row) => row.subjectId === subjectId)
    .sort((left, right) => right.version - left.version);

/** The pattern rows of one subject, newest version first. */
const patternKnowledgeOf = (subjectId: string) =>
  patterns()
    .filter((row) => row.subjectId === subjectId)
    .sort((left, right) => right.version - left.version);

const entry: ImportedExecution = {
  symbol: "TEST",
  side: "buy",
  quantity: 10,
  price: 100,
  fee: 0,
  executedAt: "2026-09-01T10:00:00Z",
};
const exit: ImportedExecution = {
  symbol: "TEST",
  side: "sell",
  quantity: 10,
  price: 102,
  fee: 0,
  executedAt: "2026-09-01T11:00:00Z",
};

/** An account with one closed trade. */
const seedAccount = (): void => {
  db.insert(accounts)
    .values({
      id: ACCOUNT,
      name: ACCOUNT,
      kind: "manual",
      broker: "",
      createdAt: "2026-09-01T00:00:00.000Z",
    })
    .run();
  recordManualTrades(ACCOUNT, [entry, exit]);
};

/** The built-in folder every note lives in. */
const seedFolders = (): void => {
  db.insert(folders)
    .values({
      id: "my-notes",
      name: "My notes",
      kind: "system",
      createdAt: "2026-09-01T00:00:00.000Z",
    })
    .onConflictDoNothing()
    .run();
};

/** A note in the built-in folder. */
const seedNote = (id: string): void => {
  seedFolders();
  db.insert(notes)
    .values({
      id,
      folderId: "my-notes",
      title: "A note",
      content: "The plan worked",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    })
    .run();
};

/** A request body for a JSON route. */
const jsonRequest = (method: string, url: string, body: unknown): Request =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  db.delete(knowledgeHypotheses).run();
  db.delete(knowledgePatterns).run();
  db.delete(knowledgeSources).run();
  db.delete(tradeRuleChecks).run();
  db.delete(notes).run();
  db.delete(journalDays).run();
  db.delete(playbooks).run();
  db.delete(folders).run();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
});

describe("Phase 14 knowledge-source revisions", () => {
  describe("migration 0006", () => {
    it("creates the four tables the phase owns", () => {
      const tables = db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];
      const names = tables.map((row) => row.name);
      expect(names).toContain("knowledge_sources");
      expect(names).toContain("knowledge_hypotheses");
      expect(names).toContain("knowledge_patterns");
      expect(names).toContain("intelligence_schedules");
    });

    it("binds the registered checksum of 0006 to the migration source and the ledger", () => {
      const source = readFileSync(
        new URL("../src/db/migrations/0006-knowledge-scheduling.ts", import.meta.url),
        "utf8",
      )
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+$/gm, "")
        .replace(/\n*$/, "\n");
      const checksum = createHash("sha256").update(source, "utf8").digest("hex");
      expect(checksumManifest.migrations["6"]?.checksum).toBe(checksum);
      const ledger = db
        .select()
        .from(journalMigrations)
        .all()
        .find((row) => row.version === 6);
      expect(ledger?.checksum).toBe(checksum);
    });

    it("upgrades a journal that is at 0005 to the same four tables", async () => {
      // A journal that predates this phase: the four tables do not exist and
      // the ledger holds nothing past 0005.
      db.$client.exec("DROP TABLE knowledge_sources");
      db.$client.exec("DROP TABLE knowledge_hypotheses");
      db.$client.exec("DROP TABLE knowledge_patterns");
      db.$client.exec("DROP TABLE intelligence_schedules");
      // The experience tables arrived with migration 0007 and the insights with
      // migration 0008, so a journal that predates this phase does not have
      // them either and the ledger holds nothing past 0005.
      db.$client.exec("DROP TABLE workflow_conversations");
      db.$client.exec("DROP TABLE intelligence_messages");
      db.$client.exec("DROP TABLE intelligence_conversations");
      db.$client.exec("DROP TABLE intelligence_opportunities");
      db.$client.exec("DROP TABLE interaction_commands");
      db.$client.exec("DROP TABLE workflow_transitions");
      db.$client.exec("DROP TABLE intelligence_workflows");
      db.$client.exec("DROP TABLE intelligence_insights");
      db.$client.exec("DELETE FROM journal_migrations WHERE version >= 6");

      const { applyMigrations } = await import("../src/db/migrations");
      applyMigrations(db.$client);

      const tables = db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[];
      const names = tables.map((row) => row.name);
      expect(names).toContain("knowledge_sources");
      expect(names).toContain("knowledge_hypotheses");
      expect(names).toContain("knowledge_patterns");
      expect(names).toContain("intelligence_schedules");
    });
  });

  describe("the source change contract", () => {
    it("accepts every kind and rejects an unknown one", () => {
      const parsed = parseSourceChange({
        kind: "annotation",
        action: "revised",
        sourceId: TRADE_KEY,
        revision: 1,
        correlationId: "corr-1",
        accountId: ACCOUNT,
      });
      expect(parsed.kind).toBe("annotation");
      expect(() =>
        parseSourceChange({
          kind: "annotation",
          action: "revised",
          sourceId: TRADE_KEY,
          revision: 1,
          correlationId: "corr-1",
          accountId: ACCOUNT,
          extra: "smuggled",
        }),
      ).toThrow();
    });

    it("refuses a shared source that claims an account", () => {
      expect(() =>
        parseSourceChange({
          kind: "note",
          action: "revised",
          sourceId: "note-1",
          revision: 1,
          correlationId: "corr-1",
          accountId: ACCOUNT,
        }),
      ).toThrow();
    });
  });

  describe("the source revision", () => {
    it("records a revision next to the write that caused it", () => {
      seedNote("note-1");
      recordSourceChanges((tx) => {
        tx.update(notes)
          .set({ content: "The plan did not work" })
          .where(eq(notes.id, "note-1"))
          .run();
        return [
          {
            kind: "note",
            action: "revised",
            sourceId: "note-1",
            accountId: null,
            correlationId: "corr-1",
          },
        ];
      });
      const recorded = sourceOf("note", "note-1");
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.revision).toBe(1);
      expect(recorded[0]?.status).toBe("active");
      expect(recorded[0]?.correlationId).toBe("corr-1");
      expect(db.select().from(notes).get()?.content).toBe("The plan did not work");
    });

    it("advances the revision of a source independently of any other source", () => {
      seedNote("note-1");
      seedNote("note-2");
      for (const id of ["note-1", "note-2", "note-1"]) {
        recordSourceChanges((tx) => {
          tx.update(notes)
            .set({ updatedAt: "2026-09-02T00:00:00.000Z" })
            .where(eq(notes.id, id))
            .run();
          return [
            {
              kind: "note",
              action: "revised",
              sourceId: id,
              accountId: null,
              correlationId: `corr-${id}-${id}`,
            },
          ];
        });
      }
      expect(sourceOf("note", "note-1").map((row) => row.revision)).toEqual([2, 1]);
      expect(sourceOf("note", "note-2").map((row) => row.revision)).toEqual([1]);
    });

    it("leaves no revision behind when the write is rolled back", () => {
      seedNote("note-1");
      seedHypothesis({
        id: "hypothesis-1",
        subjectType: "note",
        subjectId: "note-1",
        version: 1,
        status: "active",
        sourceKind: "note",
        sourceId: "note-1",
        sourceRevision: 1,
        accountId: null,
      });

      // The write and its revision are one transaction: the rolled-back write
      // leaves neither a revision nor an invalidation behind.
      expect(() =>
        recordSourceChanges((tx) => {
          tx.update(notes).set({ content: "rolled back" }).where(eq(notes.id, "note-1")).run();
          throw new Error("rolled back");
        }),
      ).toThrow();
      expect(sourceOf("note", "note-1")).toHaveLength(0);
      expect(knowledgeOf("note-1")[0]?.status).toBe("active");
      expect(db.select().from(notes).get()?.content).toBe("The plan worked");
    });

    it("undoes the source write when the event application fails", () => {
      seedAccount();

      // The source write succeeds and the event application then fails: the
      // change names an account that does not exist, and the foreign key of
      // the source register refuses it. The write and its event must roll
      // back together, so the annotation keeps its old value and no revision
      // is left behind.
      expect(() =>
        recordSourceChanges((tx) => {
          tx.update(trades).set({ notes: "my review" }).where(eq(trades.key, TRADE_KEY)).run();
          return [
            {
              kind: "annotation",
              action: "revised",
              sourceId: TRADE_KEY,
              accountId: "acct-missing",
              correlationId: "corr-1",
            },
          ];
        }),
      ).toThrow(/FOREIGN KEY/i);
      expect(db.select().from(trades).get()?.notes).toBe(null);
      expect(sourceOf("annotation", TRADE_KEY)).toHaveLength(0);
    });

    it("records no revision for a journal write that changed nothing", async () => {
      // The route is driven twice with the same text: the first write creates
      // the day and its revision, the second changes nothing and records no
      // revision — but it still writes the day, so the row's timestamp moves.
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
        const first = await putJournal(
          jsonRequest("PUT", "/api/journal/2026-09-01", { note: "The day" }),
          { params: Promise.resolve({ date: "2026-09-01" }) },
        );
        expect(first.status).toBe(200);
        vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
        const second = await putJournal(
          jsonRequest("PUT", "/api/journal/2026-09-01", { note: "The day" }),
          { params: Promise.resolve({ date: "2026-09-01" }) },
        );
        expect(second.status).toBe(200);
      } finally {
        vi.useRealTimers();
      }

      const day = db.select().from(journalDays).where(eq(journalDays.date, "2026-09-01")).get();
      expect(day?.note).toBe("The day");
      expect(day?.updatedAt).toBe("2026-09-02T00:00:00.000Z");
      expect(sourceOf("journal", "2026-09-01")).toHaveLength(1);
    });
  });

  describe("knowledge invalidation", () => {
    it("marks the dependent knowledge stale and asks for a re-evaluation", () => {
      seedNote("note-1");
      seedHypothesis({
        id: "hypothesis-1",
        subjectType: "note",
        subjectId: "note-1",
        version: 1,
        status: "active",
        sourceKind: "note",
        sourceId: "note-1",
        sourceRevision: 1,
        accountId: null,
      });

      recordSourceChanges((tx) => {
        tx.update(notes).set({ content: "corrected" }).where(eq(notes.id, "note-1")).run();
        return [
          {
            kind: "note",
            action: "revised",
            sourceId: "note-1",
            accountId: null,
            correlationId: "corr-1",
          },
        ];
      });

      const rows = knowledgeOf("note-1");
      expect(rows).toHaveLength(2);
      expect(rows[0]?.status).toBe("pending");
      expect(rows[0]?.version).toBe(2);
      expect(rows[0]?.sourceRevision).toBe(1);
      expect(rows[1]?.status).toBe("stale");
    });

    it("keeps a stale pattern in the pattern table and asks for a re-evaluation there", () => {
      seedNote("note-1");
      seedPattern({
        id: "pattern-1",
        subjectType: "note",
        subjectId: "note-1",
        version: 1,
        status: "active",
        sourceKind: "note",
        sourceId: "note-1",
        sourceRevision: 1,
        accountId: null,
      });

      recordSourceChanges((tx) => {
        tx.update(notes).set({ content: "corrected" }).where(eq(notes.id, "note-1")).run();
        return [
          {
            kind: "note",
            action: "revised",
            sourceId: "note-1",
            accountId: null,
            correlationId: "corr-1",
          },
        ];
      });

      const stale = patternKnowledgeOf("note-1");
      expect(stale).toHaveLength(2);
      expect(stale[0]?.status).toBe("pending");
      expect(stale[0]?.version).toBe(2);
      expect(stale[0]?.evaluatorId).toBe(null);
      expect(stale[1]?.status).toBe("stale");
      // The pattern never leaks into the hypothesis table.
      expect(knowledgeOf("note-1")).toHaveLength(0);
    });

    it("supersedes an unevaluated request when a second correction arrives", () => {
      seedNote("note-1");
      seedHypothesis({
        id: "hypothesis-1",
        subjectType: "note",
        subjectId: "note-1",
        version: 1,
        status: "active",
        sourceKind: "note",
        sourceId: "note-1",
        sourceRevision: 1,
        accountId: null,
      });

      for (const revision of [2, 3]) {
        recordSourceChanges((tx) => {
          tx.update(notes)
            .set({ updatedAt: `2026-09-0${revision}T00:00:00.000Z` })
            .where(eq(notes.id, "note-1"))
            .run();
          return [
            {
              kind: "note",
              action: "revised",
              sourceId: "note-1",
              accountId: null,
              correlationId: `corr-${revision}`,
            },
          ];
        });
      }

      const rows = knowledgeOf("note-1");
      const pending = rows.filter((row) => row.status === "pending");
      expect(pending).toHaveLength(1);
      expect(pending[0]?.version).toBe(3);
      expect(pending[0]?.sourceRevision).toBe(2);
      expect(rows.filter((row) => row.status === "superseded")).toHaveLength(1);
    });

    it("invalidates the dependent knowledge when the source is deleted", () => {
      seedNote("note-1");
      seedHypothesis({
        id: "hypothesis-1",
        subjectType: "note",
        subjectId: "note-1",
        version: 1,
        status: "active",
        sourceKind: "note",
        sourceId: "note-1",
        sourceRevision: 1,
        accountId: null,
      });

      recordSourceChanges((tx) => {
        tx.delete(notes).where(eq(notes.id, "note-1")).run();
        return [
          {
            kind: "note",
            action: "deleted",
            sourceId: "note-1",
            accountId: null,
            correlationId: "corr-1",
          },
        ];
      });

      const rows = knowledgeOf("note-1");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("invalidated");
      expect(sourceOf("note", "note-1")[0]?.status).toBe("invalidated");
    });

    it("leaves the knowledge of another source and another account alone", () => {
      seedAccount();
      db.insert(accounts)
        .values({
          id: "acct-other",
          name: "acct-other",
          kind: "manual",
          broker: "",
          createdAt: "2026-09-01T00:00:00.000Z",
        })
        .run();
      seedNote("note-1");
      seedHypothesis({
        id: "hypothesis-other",
        subjectType: "note",
        subjectId: "note-2",
        version: 1,
        status: "active",
        sourceKind: "note",
        sourceId: "note-2",
        sourceRevision: 1,
        accountId: null,
      });
      seedHypothesis({
        id: "hypothesis-account",
        subjectType: "trade",
        subjectId: TRADE_KEY,
        version: 1,
        status: "active",
        sourceKind: "annotation",
        sourceId: TRADE_KEY,
        sourceRevision: 1,
        accountId: ACCOUNT,
      });
      seedHypothesis({
        id: "hypothesis-elsewhere",
        subjectType: "trade",
        subjectId: "other-trade",
        version: 1,
        status: "active",
        sourceKind: "annotation",
        sourceId: "other-trade",
        sourceRevision: 1,
        accountId: "acct-other",
      });

      recordSourceChanges(() => [
        {
          kind: "annotation",
          action: "revised",
          sourceId: TRADE_KEY,
          accountId: ACCOUNT,
          correlationId: "corr-1",
        },
      ]);

      const changed = knowledgeOf(TRADE_KEY);
      expect(changed.map((row) => row.status).sort()).toEqual(["pending", "stale"]);
      expect(knowledgeOf("note-2")[0]?.status).toBe("active");
      expect(knowledgeOf("other-trade")[0]?.status).toBe("active");
    });
  });

  describe("the knowledge lifecycle", () => {
    it("advances the knowledge revision independently of the financial revision", () => {
      seedAccount();
      const before = db.select().from(trades).get();
      expect(before?.notes).toBe(null);

      recordSourceChanges((tx) => {
        tx.update(trades).set({ notes: "my review" }).where(eq(trades.key, TRADE_KEY)).run();
        return [
          {
            kind: "annotation",
            action: "revised",
            sourceId: TRADE_KEY,
            accountId: ACCOUNT,
            correlationId: "corr-1",
          },
        ];
      });

      // The rebuild recomputes the financial facts; the user's annotation
      // survives it, and the knowledge revision does not move with it.
      rebuildAccount(ACCOUNT);

      const after = db.select().from(trades).get();
      expect(after?.notes).toBe("my review");
      expect(sourceOf("annotation", TRADE_KEY).map((row) => row.revision)).toEqual([1]);
    });

    it("represents an unevaluatable pattern as insufficient evidence", () => {
      const evaluation = evaluatePattern({
        required: 3,
        evidenceIds: ["evidence-1"],
        evaluatorId: "fixture.evaluator",
        version: "1",
      });
      expect(evaluation.kind).toBe("insufficient_evidence");
      expect(patternEvaluationSchema.parse(evaluation)).toMatchObject({
        kind: "insufficient_evidence",
        required: 3,
        available: 1,
      });
    });

    it("keeps a shared source out of a narrowed account scope", () => {
      seedNote("note-1");
      seedHypothesis({
        id: "hypothesis-shared",
        subjectType: "note",
        subjectId: "note-1",
        version: 1,
        status: "active",
        sourceKind: "note",
        sourceId: "note-1",
        sourceRevision: 1,
        accountId: null,
      });
      seedAccount();
      seedHypothesis({
        id: "hypothesis-scoped",
        subjectType: "trade",
        subjectId: TRADE_KEY,
        version: 1,
        status: "active",
        sourceKind: "annotation",
        sourceId: TRADE_KEY,
        sourceRevision: 1,
        accountId: ACCOUNT,
      });

      const narrowed = withJournalTransaction((tx) =>
        listKnowledgeInScope(tx, { accountIds: [ACCOUNT] }),
      );
      expect(narrowed.map((row) => row.id)).toEqual(["hypothesis-scoped"]);

      const unscoped = withJournalTransaction((tx) =>
        listKnowledgeInScope(tx, { accountIds: null }),
      );
      expect(unscoped.map((row) => row.id).sort()).toEqual([
        "hypothesis-scoped",
        "hypothesis-shared",
      ]);
    });
  });

  describe("the write paths", () => {
    it("records a revision for a created note, a journal day note and a playbook", async () => {
      seedAccount();
      seedFolders();

      await createNote(jsonRequest("POST", "/api/notes", { title: "A note", content: "Body" }));
      await putJournal(jsonRequest("PUT", "/api/journal/2026-09-01", { note: "The day" }), {
        params: Promise.resolve({ date: "2026-09-01" }),
      });
      await createPlaybook(
        jsonRequest("POST", "/api/playbooks", { name: "The playbook", rules: ["Rule one"] }),
      );

      const kinds = sources()
        .map((row) => row.kind)
        .sort();
      expect(kinds).toEqual(["journal", "note", "playbook"]);
    });

    it("records a revision for an edited and a deleted note", async () => {
      seedNote("note-1");

      await patchNote(jsonRequest("PATCH", "/api/notes/note-1", { content: "Edited" }), {
        params: Promise.resolve({ id: "note-1" }),
      });
      await deleteNote(new Request("http://localhost/api/notes/note-1", { method: "DELETE" }), {
        params: Promise.resolve({ id: "note-1" }),
      });

      const recorded = sourceOf("note", "note-1");
      expect(recorded.map((row) => row.revision)).toEqual([2, 1]);
      expect(recorded[0]?.status).toBe("invalidated");
    });

    it("records a revision for an edited and a deleted playbook", async () => {
      await createPlaybook(
        jsonRequest("POST", "/api/playbooks", { name: "The playbook", rules: ["Rule one"] }),
      );
      const playbookId = db.select().from(playbooks).get()?.id ?? "";

      await patchPlaybook(
        jsonRequest("PATCH", `/api/playbooks/${playbookId}`, { description: "Edited" }),
        { params: Promise.resolve({ id: playbookId }) },
      );
      await deletePlaybook(
        new Request(`http://localhost/api/playbooks/${playbookId}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: playbookId }) },
      );

      // The creation, the edit and the deletion are three revisions.
      const recorded = sourceOf("playbook", playbookId);
      expect(recorded.map((row) => row.revision)).toEqual([3, 2, 1]);
      expect(recorded[0]?.status).toBe("invalidated");
      expect(recorded[1]?.status).toBe("superseded");
    });

    it("records a revision for a bulk annotation change", async () => {
      seedAccount();
      await bulkTrades(
        jsonRequest("POST", "/api/trades/bulk", { keys: [TRADE_KEY], action: "tag", tag: "setup" }),
      );
      expect(sourceOf("annotation", TRADE_KEY)).toHaveLength(1);
      expect(db.select().from(trades).get()?.tagsJson).toContain("setup");
    });

    it("records a revision for a trade annotation and for a rule check", async () => {
      seedAccount();
      db.insert(playbooks)
        .values({
          id: "playbook-1",
          name: "The playbook",
          description: "",
          rulesJson: JSON.stringify(["Rule one"]),
          createdAt: "2026-09-01T00:00:00.000Z",
        })
        .run();
      db.update(trades).set({ playbookId: "playbook-1" }).where(eq(trades.key, TRADE_KEY)).run();

      await patchTrade(jsonRequest("PATCH", `/api/trades/${TRADE_KEY}`, { notes: "my review" }), {
        params: Promise.resolve({ key: TRADE_KEY }),
      });

      await postRule(
        jsonRequest("POST", `/api/trades/${TRADE_KEY}/rules`, { rule: "Rule one", followed: true }),
        { params: Promise.resolve({ key: TRADE_KEY }) },
      );

      const annotation = sourceOf("annotation", TRADE_KEY);
      expect(annotation).toHaveLength(1);
      expect(annotation[0]?.accountId).toBe(ACCOUNT);
      const ruleCheck = sources().filter((row) => row.kind === "rule_check");
      expect(ruleCheck).toHaveLength(1);
      expect(ruleCheck[0]?.accountId).toBe(ACCOUNT);
    });

    it("records a deletion when a trade and its annotation go", async () => {
      seedAccount();
      db.update(trades).set({ notes: "my review" }).where(eq(trades.key, TRADE_KEY)).run();

      await deleteTrade(
        new Request(`http://localhost/api/trades/${TRADE_KEY}`, { method: "DELETE" }),
        { params: Promise.resolve({ key: TRADE_KEY }) },
      );

      const annotation = sourceOf("annotation", TRADE_KEY);
      expect(annotation).toHaveLength(1);
      expect(annotation[0]?.status).toBe("invalidated");
    });

    it("records a revision for every note a deleted folder moved", async () => {
      seedFolders();
      db.insert(folders)
        .values({
          id: "folder-1",
          name: "Folder",
          kind: "user",
          createdAt: "2026-09-01T00:00:00.000Z",
        })
        .run();
      for (const id of ["note-1", "note-2"]) {
        db.insert(notes)
          .values({
            id,
            folderId: "folder-1",
            title: "A note",
            content: "Body",
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z",
          })
          .run();
      }

      await deleteFolder(
        new Request("http://localhost/api/folders/folder-1", { method: "DELETE" }),
        { params: Promise.resolve({ id: "folder-1" }) },
      );

      const recorded = sources().filter((row) => row.kind === "note");
      expect(recorded.map((row) => row.sourceId).sort()).toEqual(["note-1", "note-2"]);
      expect(new Set(recorded.map((row) => row.correlationId)).size).toBe(1);
      expect(
        db
          .select()
          .from(notes)
          .where(inArray(notes.id, ["note-1", "note-2"]))
          .all()
          .every((row) => row.folderId === "my-notes"),
      ).toBe(true);
    });
  });

  describe("compatibility", () => {
    it("keeps the trade, its fills and its annotations after the source write", () => {
      seedAccount();
      recordSourceChanges((tx) => {
        tx.update(trades).set({ notes: "my review" }).where(eq(trades.key, TRADE_KEY)).run();
        return [
          {
            kind: "annotation",
            action: "revised",
            sourceId: TRADE_KEY,
            accountId: ACCOUNT,
            correlationId: "corr-1",
          },
        ];
      });
      const trade = db.select().from(trades).get();
      expect(trade?.notes).toBe("my review");
      expect(db.select().from(executions).all()).toHaveLength(2);
      expect(patterns()).toHaveLength(0);
    });

    it("leaves the financial projection untouched", () => {
      seedAccount();
      const before = db.select().from(trades).get();
      recordSourceChanges((tx) => {
        tx.update(trades).set({ notes: "my review" }).where(eq(trades.key, TRADE_KEY)).run();
        return [
          {
            kind: "annotation",
            action: "revised",
            sourceId: TRADE_KEY,
            accountId: ACCOUNT,
            correlationId: "corr-1",
          },
        ];
      });
      const after = db.select().from(trades).get();
      expect(after?.netPnl).toBe(before?.netPnl);
      expect(after?.key).toBe(before?.key);
    });
  });
});
