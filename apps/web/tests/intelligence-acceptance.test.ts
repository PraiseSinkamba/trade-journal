import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

/**
 * The operator routes of Phase 20.
 *
 * The routes are the only way an operator can see what was purged and ask
 * for a prune, a reset or a rebuild. Every one of them is a mutating act on
 * the journal's own intelligence, so every one of them refuses an
 * unauthenticated caller, a foreign origin and a body it cannot read — and
 * refuses them without touching the journal.
 */

const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (session.token ? { value: session.token } : undefined) }),
}));

/**
 * The phase gate of Phase 20 (retention, backup/restore, deletion).
 *
 * The gate is one journal that goes through the whole cycle: a prune that
 * keeps what is referenced, a backup that can be read again, a restore that
 * verifies the copy and does not bring a purged account back.
 *
 * The migration cases live here too: a failed migration must leave the
 * journal recoverable, and an unvouchable history must be refused.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-acceptance-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const {
  db,
  accounts,
  domainOutbox,
  eventDeliveries,
  intelligenceJobs,
  intelligenceSeedCheckpoints,
  knowledgeHypotheses,
  settings,
  withJournalTransaction,
} = await import("../src/db");
const { openConnection } = await import("../src/db/connection");
const {
  backupJournal,
  pruneIntelligence,
  purgeAccountIntelligence,
  readPurgeLedger,
  recordPurgeLedger,
  restoreJournal,
} = await import("../src/server/intelligence/infrastructure/retention");
const { sessionToken } = await import("../src/server/auth");
const { setAiKeyInTx } = await import("../src/server/settings");
const { decryptJson } = await import("../src/server/crypto");
const { applyMigrations, LEDGER_TABLE_SQL, MigrationError } = await import("../src/db/migrations");
const { GET: getRetention, POST: postRetention } =
  await import("../src/app/api/intelligence/retention/route");
const { POST: postRetentionReset } =
  await import("../src/app/api/intelligence/retention/reset/route");
const { POST: postRetentionRebuild } =
  await import("../src/app/api/intelligence/retention/rebuild/route");

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

/** A directory inside the scratch space. */
const directory = (name: string): string => join(scratch, name);

/** An account row, with the fields the journal points at. */
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

/** An outbox event with one delivery and one finished job. */
const insertFinishedEvent = (eventId: string, accountId: string, recordedAt: number): void => {
  db.insert(domainOutbox)
    .values({
      id: eventId,
      type: "trade.projection_changed",
      schemaVersion: 1,
      aggregateType: "trade",
      aggregateId: `trade-${eventId}`,
      aggregateRevision: 1,
      correlationId: `corr-${eventId}`,
      origin: "import",
      accountId,
      payloadJson: "{}",
      recordedAt,
      occurredAt: null,
      dispatchedAt: recordedAt,
    })
    .run();
  db.insert(intelligenceJobs)
    .values({
      id: `job-${eventId}`,
      idempotencyKey: `${eventId}:trade-observation:1`,
      type: "evaluate_trade",
      payloadJson: JSON.stringify({
        type: "evaluate_trade",
        eventId,
        handlerId: "trade-observation",
        handlerVersion: "1",
      }),
      status: "completed",
      attempts: 1,
      availableAt: recordedAt,
      owner: null,
      fence: 1,
      leaseUntil: null,
      cancelRequested: false,
      lastError: null,
      createdAt: recordedAt,
      updatedAt: recordedAt,
    })
    .run();
  db.insert(eventDeliveries)
    .values({
      eventId,
      handlerId: "trade-observation",
      handlerVersion: "1",
      state: "delivered",
      jobId: `job-${eventId}`,
      lastError: null,
      createdAt: recordedAt,
      updatedAt: recordedAt,
    })
    .run();
};

/** The account row of the operator routes, with a seed checkpoint. */
const insertAccountWithCheckpoint = (
  id: string,
  status: "pending" | "running" | "completed" | "suppressed",
): void => {
  insertAccount(id);
  db.insert(intelligenceSeedCheckpoints)
    .values({
      accountId: id,
      status,
      lastTradeKey: null,
      baselineOperationId: `baseline-${id}`,
      updatedAt: NOW,
    })
    .run();
};

/** The seed checkpoint of an account, or null when it has none. */
const checkpointOf = (accountId: string) =>
  db
    .select({ status: intelligenceSeedCheckpoints.status })
    .from(intelligenceSeedCheckpoints)
    .where(eq(intelligenceSeedCheckpoints.accountId, accountId))
    .get()?.status ?? null;

beforeEach(() => {
  db.delete(eventDeliveries).run();
  db.delete(domainOutbox).run();
  db.delete(intelligenceJobs).run();
  db.delete(intelligenceSeedCheckpoints).run();
  db.delete(accounts).run();
  // The deletion ledger is a file beside the database, so it survives the
  // cleanup of the rows above unless it is taken out too.
  rmSync(join(scratch, "purge-ledger.json"), { force: true });
  session.token = undefined;
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("the phase gate", () => {
  it("prunes, backs up and restores without resurrecting a purged account", () => {
    insertAccount("acct-keep");
    insertAccount("acct-purge");

    // One finished event of the account that survives, and one of the account
    // that is purged.
    insertFinishedEvent("evt-keep", "acct-keep", NOW - 41 * DAY);
    insertFinishedEvent("evt-purge", "acct-purge", NOW - 41 * DAY);

    // The account is purged: its intelligence goes and the purge is recorded.
    // The account row stays until the deletion itself, so the snapshot below
    // still holds it — the ledger is what takes it out of the restored copy.
    recordPurgeLedger(scratch, "acct-purge", "deleted");
    withJournalTransaction((tx) => purgeAccountIntelligence(tx, "acct-purge"));

    // The prune takes the finished event of the account that survives.
    const pruned = pruneIntelligence(NOW - 40 * DAY, 100);
    expect(pruned.removed).toBeGreaterThan(0);
    expect(db.select().from(domainOutbox).all()).toHaveLength(0);

    // The backup travels with the key material.
    withJournalTransaction((tx) => setAiKeyInTx(tx, "openai", "sk-synthetic-gate-key"));
    const backup = backupJournal({
      source: scratch,
      destination: directory("gate-backup"),
      quiesced: true,
    });
    expect(backup.keyFile).not.toBeNull();

    // The restore verifies the copy and keeps the purged account out.
    const restored = restoreJournal({
      source: directory("gate-backup"),
      destination: directory("gate-restored"),
    });
    expect(restored.keyVerified).toBe(true);
    expect(restored.purgedAccounts).toContain("acct-purge");

    const restoredJournal = openConnection(directory("gate-restored"));
    let envelope: string | null = null;
    try {
      const names = restoredJournal
        .select()
        .from(accounts)
        .all()
        .map((row) => row.id);
      // The purged account is not in the restored journal, and the account that
      // was never purged is.
      expect(names).not.toContain("acct-purge");
      expect(names).toContain("acct-keep");

      // The restored journal holds the encrypted credential...
      envelope =
        restoredJournal
          .select()
          .from(settings)
          .all()
          .map((row) => row.value)
          .find((value) => value.includes(".")) ?? null;
      expect(envelope).not.toBeNull();
    } finally {
      restoredJournal.$client.close();
    }

    // ...and the restored key material opens it. The credential is synthetic:
    // no real key is touched.
    const previous = process.env.JOURNAL_DATA_DIR;
    process.env.JOURNAL_DATA_DIR = directory("gate-restored");
    try {
      expect(decryptJson<string>(envelope!)).toBe("sk-synthetic-gate-key");
    } finally {
      process.env.JOURNAL_DATA_DIR = previous;
    }
  });
});

describe("the operator routes", () => {
  const ACCOUNT = "acct-operator";
  const UNKNOWN = "acct-unknown";

  /** The requests the operator routes answer. */
  const retentionGet = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/intelligence/retention", { headers });

  const retentionPost = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/intelligence/retention", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  /** A body that is not JSON at all. */
  const rawPost = (path: string, raw: string, headers: Record<string, string> = {}) =>
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: raw,
    });

  const resetPost = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/intelligence/retention/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const rebuildPost = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/intelligence/retention/rebuild", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  /** The state a refusal must leave untouched. */
  const persistedState = () => ({
    ledger: readPurgeLedger(scratch),
    checkpoint: checkpointOf(ACCOUNT),
    events: db.select().from(domainOutbox).all().length,
  });

  beforeEach(() => {
    vi.stubEnv("JOURNAL_PASSWORD", "test-password");
    session.token = sessionToken();
    insertAccountWithCheckpoint(ACCOUNT, "completed");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses every route without a session and changes nothing", async () => {
    session.token = undefined;
    const before = persistedState();

    const responses = [
      await getRetention(retentionGet()),
      await postRetention(retentionPost({ before: NOW - 40 * DAY })),
      await postRetentionReset(resetPost({ accountId: ACCOUNT })),
      await postRetentionRebuild(rebuildPost({ accountId: ACCOUNT })),
    ];

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    }
    expect(persistedState()).toEqual(before);
  });

  it("refuses a foreign origin on every route and changes nothing", async () => {
    const foreign = { Origin: "https://evil.example" };
    const before = persistedState();

    const responses = [
      await getRetention(retentionGet(foreign)),
      await postRetention(retentionPost({ before: NOW - 40 * DAY }, foreign)),
      await postRetentionReset(resetPost({ accountId: ACCOUNT }, foreign)),
      await postRetentionRebuild(rebuildPost({ accountId: ACCOUNT }, foreign)),
    ];

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "origin_denied" });
    }
    expect(persistedState()).toEqual(before);
  });

  it("refuses a body it cannot read and changes nothing", async () => {
    const before = persistedState();

    const responses = [
      await postRetention(rawPost("/api/intelligence/retention", "not json")),
      await postRetention(retentionPost({ before: NOW - 40 * DAY, unknown: 1 })),
      await postRetention(retentionPost({ before: -1 })),
      await postRetention(retentionPost({ limit: 0 })),
      await postRetentionReset(rawPost("/api/intelligence/retention/reset", "not json")),
      await postRetentionReset(resetPost({ unknown: 1 })),
      await postRetentionReset(resetPost({})),
      await postRetentionRebuild(rawPost("/api/intelligence/retention/rebuild", "not json")),
      await postRetentionRebuild(rebuildPost({ unknown: 1 })),
      await postRetentionRebuild(rebuildPost({})),
    ];

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(persistedState()).toEqual(before);
  });

  it("refuses an account the journal does not know", async () => {
    const before = persistedState();

    const reset = await postRetentionReset(resetPost({ accountId: UNKNOWN }));
    expect(reset.status).toBe(403);
    expect(await reset.json()).toEqual({ error: "scope_denied" });

    const rebuild = await postRetentionRebuild(rebuildPost({ accountId: UNKNOWN }));
    expect(rebuild.status).toBe(403);
    expect(await rebuild.json()).toEqual({ error: "scope_denied" });

    expect(persistedState()).toEqual(before);
  });

  it("prunes on request and keeps what is newer or still live", async () => {
    // One finished event of the account that nothing holds, one that is
    // newer than the cutoff, and one whose delivery is still pending.
    insertFinishedEvent("evt-gone", ACCOUNT, NOW - 41 * DAY);
    insertFinishedEvent("evt-new", ACCOUNT, NOW - 1 * DAY);
    insertFinishedEvent("evt-live", ACCOUNT, NOW - 41 * DAY);
    db.update(eventDeliveries)
      .set({ state: "pending" })
      .where(eq(eventDeliveries.eventId, "evt-live"))
      .run();

    // A superseded hypothesis that nothing live names: it goes with the
    // knowledge prune. The knowledge window is measured against the wall
    // clock, so the record is older than the real now as well.
    const longAgo = Date.now() - 200 * DAY;
    for (const version of [1, 2]) {
      db.insert(knowledgeHypotheses)
        .values({
          id: `kn-${version}`,
          subjectType: "observation",
          subjectId: "obs-old",
          version,
          status: version === 1 ? "superseded" : "active",
          payloadJson: "{}",
          evidenceIdsJson: "[]",
          sourceKind: "note",
          sourceId: "src-old",
          sourceRevision: 1,
          accountId: ACCOUNT,
          createdAt: longAgo,
          updatedAt: longAgo,
        })
        .run();
    }

    const response = await postRetention(retentionPost({ before: NOW - 40 * DAY }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      removed: number;
      knowledgeRemoved: number;
      before: number;
    };
    expect(body.before).toBe(NOW - 40 * DAY);
    expect(body.removed).toBeGreaterThan(0);
    expect(body.knowledgeRemoved).toBeGreaterThan(0);

    const remaining = db
      .select()
      .from(domainOutbox)
      .all()
      .map((row) => row.id);
    expect(remaining).not.toContain("evt-gone");
    expect(remaining).toContain("evt-new");
    expect(remaining).toContain("evt-live");
    expect(
      db.select().from(knowledgeHypotheses).where(eq(knowledgeHypotheses.id, "kn-1")).all(),
    ).toHaveLength(0);
  });

  it("resets an account and forgets it on a rebuild", async () => {
    insertFinishedEvent("evt-reset", ACCOUNT, NOW - 41 * DAY);

    const reset = await postRetentionReset(resetPost({ accountId: ACCOUNT }));
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ accountId: ACCOUNT, checkpoint: "suppressed" });
    expect(checkpointOf(ACCOUNT)).toBe("suppressed");
    expect(db.select().from(domainOutbox).all()).toHaveLength(0);
    expect(readPurgeLedger(scratch)).toEqual([{ accountId: ACCOUNT, kind: "reset" }]);

    const rebuild = await postRetentionRebuild(rebuildPost({ accountId: ACCOUNT }));
    expect(rebuild.status).toBe(200);
    expect(await rebuild.json()).toEqual({ accountId: ACCOUNT, checkpoint: "pending" });
    expect(checkpointOf(ACCOUNT)).toBe("pending");
    expect(readPurgeLedger(scratch)).toEqual([]);
  });

  it("answers the retention state", async () => {
    recordPurgeLedger(scratch, ACCOUNT, "deleted");

    const response = await getRetention(retentionGet());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      retention: {
        windows: { transportDays: 30, knowledgeDays: 90 },
        limit: 500,
        purgedAccounts: [{ accountId: ACCOUNT, kind: "deleted" }],
        accounts: [{ id: ACCOUNT, checkpoint: "completed" }],
      },
    });
  });
});

describe("the migration failure path", () => {
  it("rolls a failed migration back and leaves the journal recoverable", () => {
    const file = join(scratch, "migration-failure.db");
    const seeded = new Database(file);
    // The runner creates the ledger itself; pre-create it with a trigger that
    // aborts the baseline's ledger row.
    seeded.exec(LEDGER_TABLE_SQL);
    seeded.exec(
      "CREATE TRIGGER fail_baseline BEFORE INSERT ON journal_migrations WHEN NEW.version = 1 BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    );
    seeded.close();

    const sqlite = new Database(file);
    try {
      expect(() => applyMigrations(sqlite)).toThrow(/injected failure/);
      // The ledger row rolled back with the schema changes...
      const ledger = sqlite
        .prepare("SELECT version FROM journal_migrations ORDER BY version")
        .all() as { version: number }[];
      expect(ledger).toEqual([]);
      // ...so the journal never advanced a version it did not fully apply.
      const tables = (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all() as { name: string }[]
      ).map((table) => table.name);
      expect(tables).not.toContain("accounts");

      // The journal is recoverable: with the obstruction gone, it migrates.
      sqlite.exec("DROP TRIGGER fail_baseline");
      applyMigrations(sqlite);
      const applied = sqlite
        .prepare("SELECT version FROM journal_migrations ORDER BY version")
        .all() as { version: number }[];
      expect(applied.length).toBeGreaterThan(0);
      expect(applied[0]!.version).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it("refuses a journal whose applied migration checksum was tampered with", () => {
    const file = join(scratch, "migration-tampered.db");
    const sqlite = new Database(file);
    try {
      applyMigrations(sqlite);
      sqlite
        .prepare("UPDATE journal_migrations SET checksum = ? WHERE version = 1")
        .run("0".repeat(64));
      let failure: unknown = null;
      try {
        applyMigrations(sqlite);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(MigrationError);
      expect((failure as InstanceType<typeof MigrationError>).reason).toBe("checksum-mismatch");
    } finally {
      sqlite.close();
    }
  });
});
