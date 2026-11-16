import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createCipheriv, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";

/**
 * The backup and restore suite (Phase 20).
 *
 * A backup is only worth having if it can be read again: the key material must
 * travel with it, the copy must be verified before anything migrates it, and a
 * restore must not bring a purged account back.
 *
 * Every case runs against disposable journals.
 */

const scratch = mkdtempSync(join(tmpdir(), "journal-backup-"));
process.env.JOURNAL_DATA_DIR = scratch;

// The journal module opens the database when it is first evaluated, so it can
// only be imported after JOURNAL_DATA_DIR points at the scratch directory.
const {
  db,
  accounts,
  domainOutbox,
  eventDeliveries,
  executions,
  intelligenceJobs,
  intelligenceWorkerLease,
  settings,
  trades,
  withJournalTransaction,
} = await import("../src/db");
const { openConnection } = await import("../src/db/connection");
const { backupJournal, readPurgeLedger, recordPurgeLedger, restoreJournal } =
  await import("../src/server/intelligence/infrastructure/retention");
const { setAiKeyInTx } = await import("../src/server/settings");
const { decryptJson } = await import("../src/server/crypto");

const NOW = 1_800_000_000_000;

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const operationsScript = join(appRoot, "scripts", "intelligence-operations.mjs");
const execute = promisify(execFile);

/** A directory inside the scratch space. */
const directory = (name: string): string => join(scratch, name);

/**
 * A journal the operator owns, written by the journal's own bootstrap.
 *
 * The shipped backup reads the settings, the accounts and the worker lease of
 * the source, so the source has to be a journal and not a file that looks like
 * one.
 */
const operatorJournal = (name: string): string => {
  const path = directory(name);
  const connection = openConnection(path);
  connection.$client.close();
  return path;
};

/** Runs the operator command and answers with its outcome. */
const runOperatorCommand = async (args: string[], journalDir: string) => {
  try {
    const { stdout, stderr } = await execute(process.execPath, [operationsScript, ...args], {
      env: { ...process.env, JOURNAL_DATA_DIR: journalDir },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
};

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
  insertAccount("acct-1");
});

afterAll(() => {
  db.$client.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("the explicit inputs", () => {
  it("refuses a backup without a source", () => {
    expect(() =>
      backupJournal({ source: "", destination: directory("out-1"), quiesced: true }),
    ).toThrow(/explicit source and destination/);
  });

  it("refuses a backup without a destination", () => {
    expect(() => backupJournal({ source: scratch, destination: "", quiesced: true })).toThrow(
      /explicit source and destination/,
    );
  });

  it("refuses a relative path", () => {
    expect(() =>
      backupJournal({ source: "journal", destination: directory("out-2"), quiesced: true }),
    ).toThrow(/absolute source and destination/);
  });

  it("refuses a source and a destination that are the same", () => {
    expect(() => backupJournal({ source: scratch, destination: scratch, quiesced: true })).toThrow(
      /that differ/,
    );
  });

  it("refuses a backup without the quiescence acknowledgement", () => {
    expect(() =>
      backupJournal({ source: scratch, destination: directory("out-3"), quiesced: false }),
    ).toThrow(/quiescent/);
  });

  it("refuses a source that does not hold a journal", () => {
    expect(() =>
      backupJournal({
        source: directory("empty"),
        destination: directory("out-4"),
        quiesced: true,
      }),
    ).toThrow(/does not hold a journal/);
  });
});

describe("the quiescence check", () => {
  it("refuses a journal that still holds a worker lease", () => {
    // A live lease means a worker is writing: the copy would not be a point in
    // time.
    db.insert(intelligenceWorkerLease)
      .values({
        name: "journal-worker",
        owner: "worker-1",
        fence: 1,
        leaseUntil: NOW + 60_000,
        heartbeatAt: NOW,
      })
      .run();

    expect(() =>
      backupJournal({ source: scratch, destination: directory("out-live"), quiesced: true }),
    ).toThrow(/worker lease/);

    db.delete(intelligenceWorkerLease).run();
  });
});

describe("the key material", () => {
  it("refuses a source that does not hold the journal's own key", () => {
    // A copy of the data directory whose key file is not the journal's own
    // would seal the probe under the wrong key, and the restored journal could
    // not read its own encrypted settings.
    const foreign = directory("foreign");
    mkdirSync(foreign, { recursive: true });
    copyFileSync(join(scratch, "journal.db"), join(foreign, "journal.db"));
    writeFileSync(join(foreign, ".secret"), `${"ab".repeat(32)}\n`, "utf8");

    expect(() =>
      backupJournal({ source: foreign, destination: directory("out-foreign"), quiesced: true }),
    ).toThrow(/own key material/);
  });

  it("carries the key beside the snapshot", () => {
    // The synthetic credential is written under the journal's own key, so the
    // backup proves the key travels without ever touching a real key.
    withJournalTransaction((tx) => setAiKeyInTx(tx, "openai", "sk-synthetic-backup-key"));

    const result = backupJournal({
      source: scratch,
      destination: directory("out-key"),
      quiesced: true,
    });

    expect(result.keyFile).not.toBeNull();
    expect(result.database.endsWith("journal.db")).toBe(true);
  });

  it("restores a journal that decrypts its synthetic credential", () => {
    withJournalTransaction((tx) => setAiKeyInTx(tx, "openai", "sk-synthetic-restore-key"));

    backupJournal({ source: scratch, destination: directory("out-restore"), quiesced: true });

    const destination = directory("restored");
    const result = restoreJournal({ source: directory("out-restore"), destination });

    expect(result.keyVerified).toBe(true);

    // The restored journal holds the encrypted credential, and the restored key
    // material opens it. The credential is synthetic: no real key is touched.
    const restored = openConnection(destination);
    let envelope: string | null = null;
    try {
      envelope =
        restored
          .select({ value: settings.value })
          .from(settings)
          .all()
          .find((row) => row.value.includes("."))?.value ?? null;
      expect(restored.select().from(accounts).all()).toHaveLength(1);
    } finally {
      restored.$client.close();
    }

    const previous = process.env.JOURNAL_DATA_DIR;
    process.env.JOURNAL_DATA_DIR = destination;
    try {
      expect(decryptJson<string>(envelope!)).toBe("sk-synthetic-restore-key");
    } finally {
      process.env.JOURNAL_DATA_DIR = previous;
    }
  });
});

describe("the restore", () => {
  it("verifies the restored journal", () => {
    backupJournal({ source: scratch, destination: directory("out-verify"), quiesced: true });

    const result = restoreJournal({
      source: directory("out-verify"),
      destination: directory("restored-verify"),
    });

    expect(result.database.endsWith("journal.db")).toBe(true);
  });

  it("refuses a destination that already holds a journal", () => {
    backupJournal({ source: scratch, destination: directory("out-dest"), quiesced: true });

    // The scratch directory holds the live journal, so restoring into it would
    // overwrite a journal that is in use.
    expect(() => restoreJournal({ source: directory("out-dest"), destination: scratch })).toThrow(
      /already holds a journal/,
    );
  });

  it("refuses a source that does not hold a backup manifest", () => {
    expect(() =>
      restoreJournal({ source: directory("nothing"), destination: directory("restored-none") }),
    ).toThrow(/does not hold a backup manifest/);
  });
});

describe("the no resurrection guarantee", () => {
  it("keeps a purged account out of the restored journal", () => {
    // The account is in the backup: it exists when the snapshot is taken.
    expect(db.select().from(accounts).all()).toHaveLength(1);

    // The purge is recorded in the ledger, and the ledger file beside the
    // database is what survives the database being replaced.
    recordPurgeLedger(scratch, "acct-1", "deleted");

    backupJournal({ source: scratch, destination: directory("out-purged"), quiesced: true });

    const result = restoreJournal({
      source: directory("out-purged"),
      destination: directory("restored-purged"),
    });

    expect(result.purgedAccounts).toContain("acct-1");

    // The restored journal holds the account of the snapshot, and the ledger
    // takes it out again: a restore does not resurrect a purged account.
    const restored = openConnection(directory("restored-purged"));
    try {
      expect(restored.select().from(accounts).all()).toHaveLength(0);
    } finally {
      restored.$client.close();
    }
  });

  it("takes the whole intelligence of a deleted account out of the restored journal", () => {
    // The account's events, their deliveries and jobs, and the rows that are
    // not account bound but name its observations are part of what a delete
    // removes: a restore that left them behind would partially resurrect what
    // the purge deleted.
    insertAccount("acct-2");
    insertFinishedEvent("evt-2", "acct-2", NOW);
    recordPurgeLedger(scratch, "acct-2", "deleted");

    backupJournal({ source: scratch, destination: directory("out-purge-full"), quiesced: true });

    // The snapshot holds the account and its event: the purge is only
    // recorded in the ledger, so the backup was taken before the account was
    // deleted.
    const snapshot = openConnection(directory("out-purge-full"));
    try {
      expect(
        snapshot
          .select()
          .from(accounts)
          .all()
          .map((row) => row.id),
      ).toContain("acct-2");
      expect(
        snapshot
          .select()
          .from(domainOutbox)
          .all()
          .map((row) => row.id),
      ).toContain("evt-2");
    } finally {
      snapshot.$client.close();
    }

    // The restore takes the account out again, with everything it owned: its
    // events, their deliveries and jobs, and its unbound rows.
    restoreJournal({
      source: directory("out-purge-full"),
      destination: directory("restored-purge-full"),
    });
    const restored = openConnection(directory("restored-purge-full"));
    try {
      expect(
        restored
          .select()
          .from(accounts)
          .all()
          .map((row) => row.id),
      ).not.toContain("acct-2");
      expect(
        restored
          .select()
          .from(domainOutbox)
          .all()
          .map((row) => row.id),
      ).not.toContain("evt-2");
      expect(restored.select().from(eventDeliveries).all()).toHaveLength(0);
      expect(restored.select().from(intelligenceJobs).all()).toHaveLength(0);
    } finally {
      restored.$client.close();
    }
  });

  it("refuses a source whose encrypted settings have no key to read them with", () => {
    // The journal holds an encrypted credential but no key file: a backup of
    // it could never be read back.
    // A journal whose credential was sealed under another key: the live key
    // cannot open it, so a backup of it could never be read back.
    const sealed = directory("sealed");
    backupJournal({ source: scratch, destination: sealed, quiesced: true });
    const sealedJournal = openConnection(sealed);
    try {
      const other = randomBytes(32);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", other, iv);
      const encrypted = Buffer.concat([
        cipher.update(Buffer.from("sealed", "utf8")),
        cipher.final(),
      ]);
      const envelope = [
        iv.toString("base64"),
        encrypted.toString("base64"),
        cipher.getAuthTag().toString("base64"),
      ].join(".");
      sealedJournal
        .insert(settings)
        .values({ key: "openaiKeyEnc", value: envelope })
        .onConflictDoUpdate({ target: settings.key, set: { value: envelope } })
        .run();
    } finally {
      sealedJournal.$client.close();
    }

    expect(() =>
      backupJournal({ source: sealed, destination: directory("out-sealed"), quiesced: true }),
    ).toThrow(/could not be read back/);
  });

  it("reports a key as verified only when it verified one", () => {
    // A backup of a journal without a key file carries no probe, so the
    // restore verified nothing and must not claim it did.
    const plain = directory("plain");
    backupJournal({ source: scratch, destination: plain, quiesced: true });
    // A backup whose manifest carries no probe: the restore verified no key,
    // so it must not claim it did.
    const manifestPath = join(plain, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, keyProbe: null, keyFile: null }, null, 2),
      "utf8",
    );

    const restored = restoreJournal({
      source: plain,
      destination: directory("restored-plain"),
    });
    expect(restored.keyVerified).toBe(false);
  });

  it("copies the key material so only its owner can read it", () => {
    withJournalTransaction((tx) => setAiKeyInTx(tx, "openai", "sk-synthetic-mode-key"));

    const result = backupJournal({
      source: scratch,
      destination: directory("out-mode"),
      quiesced: true,
    });

    expect(result.keyFile).not.toBeNull();
    const copied = result.keyFile!;
    // The copy is the key material of the journal: nobody else may read it.
    if (process.platform !== "win32") {
      expect(statSync(copied).mode & 0o777).toBe(0o600);
    } else {
      expect(readFileSync(copied, "utf8").trim()).toBe(
        readFileSync(join(scratch, ".secret"), "utf8").trim(),
      );
    }
  });

  it("refuses a backup when the key comes from the environment", () => {
    // The key lives in the environment, so it cannot travel with the backup.
    const previous = process.env.JOURNAL_SECRET;
    process.env.JOURNAL_SECRET = "synthetic-environment-secret";
    try {
      expect(() =>
        backupJournal({ source: scratch, destination: directory("out-env"), quiesced: true }),
      ).toThrow(/JOURNAL_SECRET/);
    } finally {
      if (previous === undefined) delete process.env.JOURNAL_SECRET;
      else process.env.JOURNAL_SECRET = previous;
    }
  });

  it("refuses a backup of encrypted material no key can travel with", () => {
    // A journal whose credentials are sealed under an environment secret has
    // no key file, so a backup taken without that variable in the
    // environment carries no key: the restored journal could never read its
    // settings.
    const sealed = directory("sealed-live");
    const sealedJournal = openConnection(sealed);
    try {
      const other = randomBytes(32);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", other, iv);
      const encrypted = Buffer.concat([
        cipher.update(Buffer.from("sealed", "utf8")),
        cipher.final(),
      ]);
      sealedJournal
        .insert(settings)
        .values({
          key: "openaiKeyEnc",
          value: [
            iv.toString("base64"),
            encrypted.toString("base64"),
            cipher.getAuthTag().toString("base64"),
          ].join("."),
        })
        .run();
    } finally {
      sealedJournal.$client.close();
    }
    // The live directory that would hold the key has none.
    const previousDir = process.env.JOURNAL_DATA_DIR;
    const previousSecret = process.env.JOURNAL_SECRET;
    delete process.env.JOURNAL_SECRET;
    process.env.JOURNAL_DATA_DIR = directory("no-key-home");
    try {
      expect(() =>
        backupJournal({
          source: sealed,
          destination: directory("out-sealed-live"),
          quiesced: true,
        }),
      ).toThrow(/no key material is available/);
    } finally {
      process.env.JOURNAL_DATA_DIR = previousDir;
      if (previousSecret !== undefined) process.env.JOURNAL_SECRET = previousSecret;
    }
  });

  it("reports a key as unverified when the backup carries none", () => {
    // A journal with nothing encrypted needs no key, so the backup carries
    // none and the restore verified nothing.
    const plain = directory("plain-live");
    const plainJournal = openConnection(plain);
    plainJournal.$client.close();
    const previousDir = process.env.JOURNAL_DATA_DIR;
    const previousSecret = process.env.JOURNAL_SECRET;
    delete process.env.JOURNAL_SECRET;
    process.env.JOURNAL_DATA_DIR = directory("no-key-home-plain");
    try {
      backupJournal({ source: plain, destination: directory("out-plain-live"), quiesced: true });

      const restored = restoreJournal({
        source: directory("out-plain-live"),
        destination: directory("restored-plain-live"),
      });

      expect(restored.keyVerified).toBe(false);
    } finally {
      process.env.JOURNAL_DATA_DIR = previousDir;
      if (previousSecret !== undefined) process.env.JOURNAL_SECRET = previousSecret;
    }
  });

  it("takes the fills and the trades of a deleted account out of the restored journal", () => {
    insertAccount("acct-3");
    // The account owns a fill and a trade: neither table has a foreign key
    // to the account, so nothing else takes them.
    db.insert(executions)
      .values({
        id: "exec-3",
        accountId: "acct-3",
        symbol: "EURUSD",
        side: "buy",
        quantity: 1,
        price: 1.1,
        fee: 0,
        executedAt: new Date(NOW).toISOString(),
        assetClass: null,
        source: "manual",
        importMetadataJson: null,
        contentHash: "hash-3",
        createdAt: new Date(NOW).toISOString(),
      })
      .run();
    db.insert(trades)
      .values({
        key: "trade-3",
        accountId: "acct-3",
        symbol: "EURUSD",
        assetClass: null,
        direction: "long",
        status: "open",
        openedAt: new Date(NOW).toISOString(),
        closedAt: null,
        quantity: 1,
        openQuantity: 1,
        avgEntry: 1.1,
        avgExit: null,
        grossPnl: 0,
        fees: 0,
        netPnl: 0,
        executionCount: 1,
        executionIdsJson: JSON.stringify(["exec-3"]),
        exitsJson: "[]",
        durationMs: null,
        notes: null,
        tagsJson: null,
        mistakesJson: null,
        playbookId: null,
        rating: null,
        stopLoss: null,
        profitTarget: null,
        reviewedAt: null,
      })
      .run();
    recordPurgeLedger(scratch, "acct-3", "deleted");

    backupJournal({ source: scratch, destination: directory("out-purge-fills"), quiesced: true });

    restoreJournal({
      source: directory("out-purge-fills"),
      destination: directory("restored-purge-fills"),
    });

    const restored = openConnection(directory("restored-purge-fills"));
    try {
      // Neither table has a foreign key to the account, so nothing else
      // would take them.
      expect(restored.select().from(executions).all()).toHaveLength(0);
      expect(restored.select().from(trades).all()).toHaveLength(0);
      expect(
        restored
          .select()
          .from(accounts)
          .all()
          .map((row) => row.id),
      ).not.toContain("acct-3");
    } finally {
      restored.$client.close();
    }
  });

  it("records the purge in the ledger of the journal", () => {
    recordPurgeLedger(scratch, "acct-2", "deleted");

    const ledger = readPurgeLedger(scratch);
    expect(ledger).toContainEqual({ accountId: "acct-2", kind: "deleted" });
  });
});

describe("the operator command", () => {
  it("is a command an operator can run", () => {
    expect(existsSync(operationsScript)).toBe(true);
    const manifest = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["intelligence:operations"]).toBe(
      "node scripts/intelligence-operations.mjs",
    );
  });

  it("takes a backup of the journal the operator names", async () => {
    const source = operatorJournal("operator-backup-source");
    const destination = directory("operator-backup-out");

    const result = await runOperatorCommand(
      ["backup", "--source", source, "--destination", destination, "--acknowledge-quiescence"],
      source,
    );

    expect(result.code).toBe(0);
    // The shipped backup wrote the snapshot and its manifest.
    expect(existsSync(join(destination, "journal.db"))).toBe(true);
    expect(existsSync(join(destination, "manifest.json"))).toBe(true);
  });

  it("refuses a relative path", async () => {
    const source = operatorJournal("operator-relative-source");
    const destination = directory("operator-relative-out");

    const result = await runOperatorCommand(
      ["backup", "--source", "journal", "--destination", destination, "--acknowledge-quiescence"],
      source,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/absolute source and destination/);
    // Nothing was written where the operator did not name a directory.
    expect(existsSync(join(destination, "journal.db"))).toBe(false);
  });

  it("refuses a backup without the quiescence acknowledgement", async () => {
    const source = operatorJournal("operator-unacknowledged-source");
    const destination = directory("operator-unacknowledged-out");

    const result = await runOperatorCommand(
      ["backup", "--source", source, "--destination", destination],
      source,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/quiescent/);
    expect(existsSync(join(destination, "journal.db"))).toBe(false);
  });

  it("refuses to write over a journal that is already there", async () => {
    const source = operatorJournal("operator-occupied-source");
    const destination = operatorJournal("operator-occupied-destination");
    const before = statSync(join(destination, "journal.db")).mtimeMs;

    const result = await runOperatorCommand(
      ["backup", "--source", source, "--destination", destination, "--acknowledge-quiescence"],
      source,
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/already holds a journal/);
    // The journal that was already there is untouched.
    expect(statSync(join(destination, "journal.db")).mtimeMs).toBe(before);
  });

  it("carries the key material beside the snapshot and nowhere else", async () => {
    const source = operatorJournal("operator-key-source");
    // The key material lives beside the journal it belongs to.
    const key = `${"ab".repeat(32)}\n`;
    writeFileSync(join(source, ".secret"), key, "utf8");
    const destination = directory("operator-key-out");

    const result = await runOperatorCommand(
      ["backup", "--source", source, "--destination", destination, "--acknowledge-quiescence"],
      source,
    );

    expect(result.code).toBe(0);
    // The key travels beside the snapshot, and the journal keeps its own copy.
    expect(existsSync(join(destination, ".secret"))).toBe(true);
    expect(existsSync(join(source, ".secret"))).toBe(true);
    // The backup holds the snapshot, the key and the manifest, and nothing else.
    expect(readdirSync(destination).sort()).toEqual([".secret", "journal.db", "manifest.json"]);
    // The manifest carries a sealed probe, never the key itself.
    const manifest = readFileSync(join(destination, "manifest.json"), "utf8");
    expect(manifest).not.toContain("ab".repeat(32));
    expect(manifest).toContain("keyProbe");
  });

  it("leaves the journal it copies untouched", async () => {
    const source = operatorJournal("operator-untouched-source");
    const before = statSync(join(source, "journal.db"));
    const destination = directory("operator-untouched-out");

    const result = await runOperatorCommand(
      ["backup", "--source", source, "--destination", destination, "--acknowledge-quiescence"],
      source,
    );

    expect(result.code).toBe(0);
    // The source journal is unchanged, and nothing was written beside it.
    const after = statSync(join(source, "journal.db"));
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(readdirSync(source)).toEqual(["journal.db"]);
  });

  it("restores a backup into scratch storage", async () => {
    const source = operatorJournal("operator-restore-source");
    const backup = directory("operator-restore-backup");
    await runOperatorCommand(
      ["backup", "--source", source, "--destination", backup, "--acknowledge-quiescence"],
      source,
    );

    const restored = directory("operator-restore-out");
    const result = await runOperatorCommand(
      ["restore", "--source", backup, "--destination", restored],
      source,
    );

    expect(result.code).toBe(0);
    expect(existsSync(join(restored, "journal.db"))).toBe(true);
  });
});
