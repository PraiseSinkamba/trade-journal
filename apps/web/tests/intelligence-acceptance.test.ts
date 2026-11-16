import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

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
  settings,
  withJournalTransaction,
} = await import("../src/db");
const { openConnection } = await import("../src/db/connection");
const {
  backupJournal,
  pruneIntelligence,
  purgeAccountIntelligence,
  recordPurgeLedger,
  restoreJournal,
} = await import("../src/server/intelligence/infrastructure/retention");
const { setAiKeyInTx } = await import("../src/server/settings");
const { decryptJson } = await import("../src/server/crypto");
const { applyMigrations, LEDGER_TABLE_SQL, MigrationError } = await import("../src/db/migrations");

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

beforeEach(() => {
  db.delete(eventDeliveries).run();
  db.delete(domainOutbox).run();
  db.delete(intelligenceJobs).run();
  db.delete(accounts).run();
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
