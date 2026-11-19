import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { MAX_INSIGHT_QUESTION_LENGTH } from "../src/server/intelligence/contracts/insights";

/**
 * The insight store suite (Phase 22).
 *
 * A generated review question is bound to the projection revision it was made
 * from: a correction hides the older question without deleting it, a repeated
 * write is one row, and the deletion guarantees take the questions with the
 * account they belong to.
 *
 * Every case runs against a disposable journal.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-insights-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const {
  db,
  withJournalTransaction,
  accounts,
  intelligenceInsights,
  intelligenceObservations,
  intelligenceWorkflows,
  tradeIdentities,
  tradeProjectionRevisions,
} = await import("../src/db");
const { persistInsightInTx, readCurrentInsightInTx } =
  await import("../src/server/intelligence/infrastructure/insight-store");
const { pruneSupersededKnowledgeInTx, purgeAccountIntelligence, resetAccountIntelligenceInTx } =
  await import("../src/server/intelligence/infrastructure/retention");

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
/** The instant of a row that is older than the knowledge window. */
const OLD = NOW - 200 * DAY;

/** An account row, with the fields the intelligence tables point at. */
const insertAccount = (id: string): void => {
  db.insert(accounts)
    .values({
      id,
      name: id,
      broker: "test",
      kind: "manual",
      currency: "USD",
      initialBalance: 0,
      profitCalcMethod: "fifo",
      credentialsEnc: null,
      autoSync: false,
      lastSyncAt: null,
      ibkrSyncTimeZone: null,
      snapshotJson: null,
      archivedAt: null,
      createdAt: new Date(NOW).toISOString(),
    })
    .run();
};

/** A projection revision of a trade. */
const insertRevision = (options: {
  readonly accountId: string;
  readonly tradeId: string;
  readonly revision: number;
  readonly revisionId: string;
}): void => {
  db.insert(tradeProjectionRevisions)
    .values({
      id: options.revisionId,
      tradeId: options.tradeId,
      accountId: options.accountId,
      revision: options.revision,
      tradeKey: `key-${options.tradeId}`,
      fingerprint: `fingerprint-${options.revisionId}`,
      resolution: "exact_key",
      snapshotJson: "{}",
      recordedAt: NOW,
    })
    .run();
};

/**
 * A trade identity with its current projection revision.
 *
 * The identity names the ordinal of its current revision, so a correction is
 * a new revision row plus a bumped ordinal.
 */
const insertTrade = (options: {
  readonly accountId: string;
  readonly tradeId: string;
  readonly revision: number;
  readonly revisionId: string;
}): void => {
  db.insert(tradeIdentities)
    .values({
      id: options.tradeId,
      accountId: options.accountId,
      currentKey: `key-${options.tradeId}`,
      revision: options.revision,
      state: "active",
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
  insertRevision(options);
};

/** An observation of a trade, bound to the revision it was derived from. */
const insertObservation = (options: {
  readonly id: string;
  readonly accountId: string;
  readonly subjectId: string;
  readonly sourceRevision: string;
  readonly status?: "active" | "superseded" | "invalidated";
}): void => {
  db.insert(intelligenceObservations)
    .values({
      id: options.id,
      subjectId: options.subjectId,
      sourceRevision: options.sourceRevision,
      evaluatorId: "trade-evaluator",
      evaluatorVersion: "1",
      type: "trade_outcome",
      status: options.status ?? "active",
      accountId: options.accountId,
      currency: "USD",
      netPnl: 100,
      fees: 0,
      tradeStatus: "win",
      timingQuality: "source_reported",
      durationMs: null,
      directFactsJson: "{}",
      observationJson: "{}",
      recordedAt: NOW,
      updatedAt: NOW,
    })
    .run();
};

/** A live workflow about an observation. */
const insertLiveWorkflow = (options: {
  readonly id: string;
  readonly accountId: string;
  readonly observationId: string;
  /**
   * The subject the workflow is about. It defaults to the observation, but a
   * workflow may rest on a revision without being about the observation, and
   * the live index names the two id spaces separately.
   */
  readonly subjectId?: string;
  /** The revision ids the workflow rests on; they are what the live index names. */
  readonly revisionIds?: readonly string[];
}): void => {
  db.insert(intelligenceWorkflows)
    .values({
      id: options.id,
      definitionKey: "review_observation",
      definitionVersion: 1,
      revision: 1,
      status: "running",
      subjectType: "observation",
      subjectId: options.subjectId ?? options.observationId,
      accountId: options.accountId,
      evidenceIdsJson: JSON.stringify(options.revisionIds ?? []),
      selfReportJson: null,
      deferUntil: null,
      effectRevision: 0,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
};

/** Stores one question about a trade. */
const persist = (options: {
  readonly accountId: string;
  readonly subjectId: string;
  readonly observationId: string;
  readonly sourceRevision: string;
  readonly question: string;
  readonly createdAt?: number;
}): string | null =>
  withJournalTransaction((tx) =>
    persistInsightInTx(tx, {
      accountId: options.accountId,
      subjectId: options.subjectId,
      observationId: options.observationId,
      sourceRevision: options.sourceRevision,
      question: options.question,
      createdAt: options.createdAt,
    }),
  );

beforeEach(() => {
  db.delete(intelligenceInsights).run();
  db.delete(intelligenceWorkflows).run();
  db.delete(intelligenceObservations).run();
  db.delete(tradeProjectionRevisions).run();
  db.delete(tradeIdentities).run();
  db.delete(accounts).run();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("the insight store", () => {
  it("stores a repeated write once and answers with the same id", () => {
    insertAccount("acct-1");
    insertTrade({ accountId: "acct-1", tradeId: "trade-1", revision: 1, revisionId: "rev-1" });
    insertObservation({
      id: "obs-1",
      accountId: "acct-1",
      subjectId: "trade-1",
      sourceRevision: "rev-1",
    });

    const first = persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "Why did the stop widen?",
    });
    const second = persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "Why did the stop widen?",
    });

    expect(first).not.toBeNull();
    // The second write found the row the first one left and named it.
    expect(second).toBe(first);
    expect(db.select().from(intelligenceInsights).all()).toHaveLength(1);
  });

  it("reads the question of the current revision", () => {
    insertAccount("acct-1");
    insertTrade({ accountId: "acct-1", tradeId: "trade-1", revision: 1, revisionId: "rev-1" });
    insertObservation({
      id: "obs-1",
      accountId: "acct-1",
      subjectId: "trade-1",
      sourceRevision: "rev-1",
    });
    persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "Why did the stop widen?",
    });

    const row = withJournalTransaction((tx) =>
      readCurrentInsightInTx(tx, { subjectId: "trade-1" }),
    );

    expect(row?.question).toBe("Why did the stop widen?");
    expect(row?.sourceRevision).toBe("rev-1");
    expect(row?.observationId).toBe("obs-1");
  });

  it("hides the question of a corrected revision without deleting it", () => {
    insertAccount("acct-1");
    insertTrade({ accountId: "acct-1", tradeId: "trade-1", revision: 1, revisionId: "rev-1" });
    insertObservation({
      id: "obs-1",
      accountId: "acct-1",
      subjectId: "trade-1",
      sourceRevision: "rev-1",
    });
    persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "Why did the stop widen?",
    });

    // The correction: a new projection revision, and the identity points at it.
    insertRevision({ accountId: "acct-1", tradeId: "trade-1", revision: 2, revisionId: "rev-2" });
    db.update(tradeIdentities)
      .set({ revision: 2, updatedAt: NOW })
      .where(eq(tradeIdentities.id, "trade-1"))
      .run();

    const row = withJournalTransaction((tx) =>
      readCurrentInsightInTx(tx, { subjectId: "trade-1" }),
    );

    expect(row).toBeNull();
    // Nothing was deleted: the question is still stored, it is just not the
    // answer of the current revision any more.
    expect(db.select().from(intelligenceInsights).all()).toHaveLength(1);
  });

  it("takes the questions of a purged account and leaves the other account's alone", () => {
    insertAccount("acct-1");
    insertAccount("acct-2");
    insertTrade({ accountId: "acct-1", tradeId: "trade-1", revision: 1, revisionId: "rev-1" });
    insertTrade({ accountId: "acct-2", tradeId: "trade-2", revision: 1, revisionId: "rev-2" });
    insertObservation({
      id: "obs-1",
      accountId: "acct-1",
      subjectId: "trade-1",
      sourceRevision: "rev-1",
    });
    insertObservation({
      id: "obs-2",
      accountId: "acct-2",
      subjectId: "trade-2",
      sourceRevision: "rev-2",
    });
    persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "Why did the stop widen?",
    });
    persist({
      accountId: "acct-2",
      subjectId: "trade-2",
      observationId: "obs-2",
      sourceRevision: "rev-2",
      question: "Why was the entry late?",
    });

    withJournalTransaction((tx) => purgeAccountIntelligence(tx, "acct-1"));

    const remaining = db.select().from(intelligenceInsights).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.accountId).toBe("acct-2");
  });

  it("takes the questions of a reset account", () => {
    insertAccount("acct-1");
    insertTrade({ accountId: "acct-1", tradeId: "trade-1", revision: 1, revisionId: "rev-1" });
    insertObservation({
      id: "obs-1",
      accountId: "acct-1",
      subjectId: "trade-1",
      sourceRevision: "rev-1",
    });
    persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "Why did the stop widen?",
    });

    withJournalTransaction((tx) => resetAccountIntelligenceInTx(tx, "acct-1", NOW));

    expect(db.select().from(intelligenceInsights).all()).toHaveLength(0);
    // The reset keeps the account: only what the journal knew about it goes.
    expect(db.select().from(accounts).all()).toHaveLength(1);
  });

  it("takes the questions with the account row", () => {
    insertAccount("acct-1");
    insertTrade({ accountId: "acct-1", tradeId: "trade-1", revision: 1, revisionId: "rev-1" });
    insertObservation({
      id: "obs-1",
      accountId: "acct-1",
      subjectId: "trade-1",
      sourceRevision: "rev-1",
    });
    persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "Why did the stop widen?",
    });

    db.delete(accounts).where(eq(accounts.id, "acct-1")).run();

    expect(db.select().from(intelligenceInsights).all()).toHaveLength(0);
  });

  it("keeps the question a live workflow names and takes the stale one", () => {
    insertAccount("acct-1");
    // The first trade: its question is old and its observation is superseded,
    // so the rule alone would take it.
    insertTrade({ accountId: "acct-1", tradeId: "trade-1", revision: 1, revisionId: "rev-1" });
    insertObservation({
      id: "obs-1",
      accountId: "acct-1",
      subjectId: "trade-1",
      sourceRevision: "rev-1",
      status: "superseded",
    });
    // The second trade: a correction moved it on, so the question of the old
    // revision is stale.
    insertTrade({ accountId: "acct-1", tradeId: "trade-2", revision: 1, revisionId: "rev-2" });
    insertRevision({ accountId: "acct-1", tradeId: "trade-2", revision: 2, revisionId: "rev-3" });
    db.update(tradeIdentities)
      .set({ revision: 2, updatedAt: NOW })
      .where(eq(tradeIdentities.id, "trade-2"))
      .run();
    insertObservation({
      id: "obs-2",
      accountId: "acct-1",
      subjectId: "trade-2",
      sourceRevision: "rev-2",
    });
    // A live workflow names the first observation.
    insertLiveWorkflow({ id: "wf-1", accountId: "acct-1", observationId: "obs-1" });

    const kept = persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "Why did the stop widen?",
      createdAt: OLD,
    });
    const stale = persist({
      accountId: "acct-1",
      subjectId: "trade-2",
      observationId: "obs-2",
      sourceRevision: "rev-2",
      question: "Why was the entry late?",
      createdAt: OLD,
    });
    expect(kept).not.toBeNull();
    expect(stale).not.toBeNull();

    const result = withJournalTransaction((tx) => pruneSupersededKnowledgeInTx(tx, NOW, 500));

    expect(result.removed).toBeGreaterThanOrEqual(1);
    const remaining = db.select().from(intelligenceInsights).all();
    // The live workflow keeps its question; the stale one is gone.
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(kept);
  });

  it("keeps the question a live workflow rests on a revision of", () => {
    insertAccount("acct-1");
    // The trade was corrected, so the question of the old revision is stale
    // and the rule alone would take it.
    insertTrade({ accountId: "acct-1", tradeId: "trade-1", revision: 1, revisionId: "rev-1" });
    insertRevision({ accountId: "acct-1", tradeId: "trade-1", revision: 2, revisionId: "rev-2" });
    db.update(tradeIdentities)
      .set({ revision: 2, updatedAt: NOW })
      .where(eq(tradeIdentities.id, "trade-1"))
      .run();
    insertObservation({
      id: "obs-1",
      accountId: "acct-1",
      subjectId: "trade-1",
      sourceRevision: "rev-1",
    });
    // The live workflow rests on the revision the question was made from, but
    // it is about another subject: the live index carries the two id spaces
    // separately, and only the revision names this question.
    insertLiveWorkflow({
      id: "wf-1",
      accountId: "acct-1",
      observationId: "obs-other",
      subjectId: "trade-other",
      revisionIds: ["rev-1"],
    });

    const kept = persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "Why did the stop widen?",
      createdAt: OLD,
    });
    expect(kept).not.toBeNull();

    const result = withJournalTransaction((tx) => pruneSupersededKnowledgeInTx(tx, NOW, 500));

    expect(result.removed).toBe(0);
    const remaining = db.select().from(intelligenceInsights).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(kept);
  });

  it("reads the question of the current capability version", () => {
    insertAccount("acct-1");
    insertTrade({ accountId: "acct-1", tradeId: "trade-1", revision: 1, revisionId: "rev-1" });
    insertObservation({
      id: "obs-1",
      accountId: "acct-1",
      subjectId: "trade-1",
      sourceRevision: "rev-1",
    });

    // The older capability version asked something else about the same
    // revision: both rows are legitimate, and the read names one of them.
    const older = withJournalTransaction((tx) =>
      persistInsightInTx(tx, {
        accountId: "acct-1",
        subjectId: "trade-1",
        observationId: "obs-1",
        sourceRevision: "rev-1",
        question: "Why did the stop widen?",
        capabilityVersion: "0",
      }),
    );
    const current = persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "What did the market give you?",
    });
    expect(older).not.toBeNull();
    expect(current).not.toBeNull();
    expect(db.select().from(intelligenceInsights).all()).toHaveLength(2);

    const row = withJournalTransaction((tx) =>
      readCurrentInsightInTx(tx, { subjectId: "trade-1" }),
    );
    expect(row?.id).toBe(current);
    expect(row?.question).toBe("What did the market give you?");

    // The older version is still readable when it is asked for by name.
    const olderRow = withJournalTransaction((tx) =>
      readCurrentInsightInTx(tx, { subjectId: "trade-1", capabilityVersion: "0" }),
    );
    expect(olderRow?.id).toBe(older);
  });

  it("stores nothing when the question is invalid", () => {
    insertAccount("acct-1");
    insertTrade({ accountId: "acct-1", tradeId: "trade-1", revision: 1, revisionId: "rev-1" });
    insertObservation({
      id: "obs-1",
      accountId: "acct-1",
      subjectId: "trade-1",
      sourceRevision: "rev-1",
    });

    const empty = persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "   ",
    });
    const tooLong = persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "q".repeat(MAX_INSIGHT_QUESTION_LENGTH + 1),
    });

    expect(empty).toBeNull();
    expect(tooLong).toBeNull();
    expect(db.select().from(intelligenceInsights).all()).toHaveLength(0);

    // The boundary: a question of exactly the longest allowed length is stored.
    const atLimit = persist({
      accountId: "acct-1",
      subjectId: "trade-1",
      observationId: "obs-1",
      sourceRevision: "rev-1",
      question: "q".repeat(MAX_INSIGHT_QUESTION_LENGTH),
    });
    expect(atLimit).not.toBeNull();
    expect(db.select().from(intelligenceInsights).all()).toHaveLength(1);
  });
});
