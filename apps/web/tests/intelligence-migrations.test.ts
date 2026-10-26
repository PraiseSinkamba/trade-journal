import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { BOOTSTRAP_SQL } from "../src/db/bootstrap";
import {
  applyMigrations,
  inspectMigrations,
  validateMigrationHistory,
  LEDGER_TABLE_SQL,
  MigrationError,
  type AppliedMigrationRow,
  type JournalMigration,
} from "../src/db/migrations";
import checksumManifest from "../src/db/migration-checksums.json" with { type: "json" };
import { canonical } from "../scripts/build-migration-manifest.mjs";

/**
 * Runner invariants for the versioned migration system (Phase 02).
 *
 * Every case runs against a disposable scratch database. Nothing here touches a
 * live journal directory.
 */

const run = promisify(execFile);
const bootstrapUrl = pathToFileURL(
  fileURLToPath(new URL("../src/db/bootstrap.ts", import.meta.url)),
).href;

/** Each child loads the real bootstrap module and opens the journal at a shared start time. */
const child = `
const [file, start, url] = process.argv.slice(1);
// The module URL is chosen at runtime, so a static import cannot work here.
const { openJournalDatabase } = await import(url);
while (Date.now() < Number(start));
openJournalDatabase(file).close();
`;

const MANIFEST = checksumManifest as {
  formatVersion: number;
  migrations: Record<string, { file: string; name: string; checksum: string }>;
};
const BASELINE_CHECKSUM = MANIFEST.migrations["1"]?.checksum ?? "";

/** Every registered migration, in order: the registry the runner must apply. */
const REGISTERED = Object.entries(MANIFEST.migrations)
  .map(([version, entry]) => ({
    version: Number(version),
    name: entry.name,
    file: entry.file,
    checksum: entry.checksum,
  }))
  .sort((left, right) => left.version - right.version);
/** The same registry without the source file name: the shape the ledger holds. */
const REGISTERED_LEDGER = REGISTERED.map(({ version, name, checksum }) => ({
  version,
  name,
  checksum,
}));
const REGISTERED_VERSIONS = REGISTERED.map((entry) => entry.version);
const LATEST_VERSION = REGISTERED_VERSIONS[REGISTERED_VERSIONS.length - 1] ?? 0;

const scratch = mkdtempSync(join(tmpdir(), "journal-migrations-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const scratchFile = (name: string) => join(scratch, name);

type LedgerRow = { version: number; name: string; checksum: string; applied_at: number };

const ledgerRows = (sqlite: Database.Database): LedgerRow[] =>
  sqlite
    .prepare("SELECT version, name, checksum, applied_at FROM journal_migrations ORDER BY version")
    .all() as LedgerRow[];

/** Runs a query and returns its rows as plain records. */
const queryRows = (sqlite: Database.Database, sql: string): Record<string, unknown>[] =>
  sqlite.prepare(sql).all() as Record<string, unknown>[];

/**
 * Builds a journal from the final-schema snapshot and then shapes it like an
 * older journal: the columns that arrived after the first release are dropped
 * and the migration ledger is removed, so the runner has to converge it.
 *
 * Only nullable columns are dropped here. SQLite can only add a `NOT NULL`
 * column to a table that holds rows when the column carries a default, so
 * dropping `market_csv_datasets.first_time` would make the upgraded journal
 * differ from a fresh one in that column's default. The CSV-bounds repair is
 * covered by its own case below.
 */
const createLegacyJournal = (name: string): Database.Database => {
  const sqlite = new Database(scratchFile(name));
  sqlite.exec(BOOTSTRAP_SQL);
  sqlite.exec("ALTER TABLE folders DROP COLUMN deleted_at");
  sqlite.exec("ALTER TABLE accounts DROP COLUMN ibkr_sync_time_zone");
  sqlite.exec("ALTER TABLE executions DROP COLUMN import_metadata_json");
  sqlite.exec("DROP TABLE IF EXISTS journal_migrations");
  return sqlite;
};

/** A journal that predates the CSV-bounds columns as well. */
const createOldJournal = (name: string): Database.Database => {
  const sqlite = new Database(scratchFile(name));
  sqlite.exec(BOOTSTRAP_SQL);
  sqlite.exec("ALTER TABLE market_csv_datasets DROP COLUMN bar_count");
  sqlite.exec("ALTER TABLE market_csv_datasets DROP COLUMN first_time");
  sqlite.exec("ALTER TABLE market_csv_datasets DROP COLUMN last_time");
  sqlite.exec("DROP TABLE IF EXISTS journal_migrations");
  return sqlite;
};

/**
 * A journal from the phase that came before this one: the ledger holds the
 * baseline and the projection tables do not exist yet.
 *
 * This is the upgrade path that matters for a forward migration — the runner
 * has to create the new tables on a journal that was already in use, not only
 * on a fresh one.
 */
const createPhaseTwoJournal = (name: string): Database.Database => {
  const sqlite = new Database(scratchFile(name));
  sqlite.exec(BOOTSTRAP_SQL);
  // Drop the tables this phase adds, so the journal looks like the previous
  // phase's schema.
  sqlite.exec(`
    DROP TABLE IF EXISTS trade_revision_executions;
    DROP TABLE IF EXISTS trade_identity_links;
    DROP TABLE IF EXISTS trade_projection_revisions;
    DROP TABLE IF EXISTS trade_identities;
    DROP TABLE IF EXISTS execution_evidence;
  `);
  // The ledger holds the baseline only.
  sqlite.exec("DROP TABLE IF EXISTS journal_migrations");
  sqlite.exec(LEDGER_TABLE_SQL);
  sqlite
    .prepare(
      "INSERT INTO journal_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
    )
    .run(1, "legacy-baseline", BASELINE_CHECKSUM, 1);
  return sqlite;
};

/**
 * Structural schema fingerprint: tables, their columns, their foreign keys and
 * their indexes. Column order is excluded on purpose — SQLite appends a column
 * added with `ALTER TABLE`, so an upgraded journal orders the repaired columns
 * last while a fresh one keeps the declared order.
 *
 * Column defaults are included only when asked for: SQLite can only add a
 * `NOT NULL` column to a table that holds rows when the column carries a
 * default, so an upgraded journal may carry `DEFAULT 0` where a fresh one
 * carries none.
 */
const schemaFingerprint = (sqlite: Database.Database, includeDefaults = true) =>
  (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map(({ name }) => ({
    name,
    columns: (
      sqlite.pragma(`table_info(${name})`) as {
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[]
    )
      .map((column) => ({
        name: column.name,
        type: column.type,
        notnull: column.notnull,
        ...(includeDefaults ? { dflt_value: column.dflt_value } : {}),
        pk: column.pk,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    foreignKeys: (
      sqlite.pragma(`foreign_key_list(${name})`) as {
        table: string;
        from: string;
        to: string | null;
        on_update: string;
        on_delete: string;
      }[]
    ).map((key) => ({
      table: key.table,
      from: key.from,
      to: key.to,
      on_update: key.on_update,
      on_delete: key.on_delete,
    })),
    indexes: (sqlite.pragma(`index_list(${name})`) as { name: string; unique: number }[])
      .map((index) => ({
        name: index.name,
        unique: index.unique,
        columns: (sqlite.pragma(`index_info(${index.name})`) as { name: string | null }[]).map(
          (column) => column.name,
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));

/** Asserts that the runner refused the journal for the given reason. */
const expectMigrationFailure = (action: () => void, reason: string) => {
  try {
    action();
  } catch (error) {
    if (error instanceof MigrationError) {
      expect(error.reason).toBe(reason);
      return;
    }
    throw new Error(`Expected a MigrationError with reason "${reason}", but got ${String(error)}.`);
  }
  throw new Error(`Expected the migration to fail with "${reason}".`);
};

/** Compares rows that existed before an upgrade with the same rows afterwards. */
const expectUnchangedRows = (
  before: Record<string, unknown>[],
  after: Record<string, unknown>[],
) => {
  expect(after).toHaveLength(before.length);
  before.forEach((original, index) => {
    const upgraded = after[index] ?? {};
    const columns = Object.keys(original);
    expect(Object.fromEntries(columns.map((column) => [column, upgraded[column]]))).toEqual(
      original,
    );
  });
};

describe("migration runner", () => {
  it("applies the baseline to an empty journal and records it in the ledger", () => {
    const sqlite = new Database(scratchFile("empty.db"));
    try {
      expect(inspectMigrations(sqlite)).toEqual({
        currentVersion: 0,
        pendingVersions: REGISTERED_VERSIONS,
      });
      applyMigrations(sqlite);
      expect(inspectMigrations(sqlite)).toEqual({
        currentVersion: LATEST_VERSION,
        pendingVersions: [],
      });
      expect(ledgerRows(sqlite)).toEqual(
        REGISTERED_LEDGER.map((entry) => ({ ...entry, applied_at: expect.any(Number) })),
      );
      // The tables the journal needs really exist.
      const tables = (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all() as { name: string }[]
      ).map((table) => table.name);
      expect(tables).toContain("accounts");
      expect(tables).toContain("executions");
      expect(tables).toContain("trades");
      expect(tables).toContain("journal_migrations");
    } finally {
      sqlite.close();
    }
  });

  it("converges a pre-ledger journal onto the baseline and records version 1", () => {
    const legacy = createLegacyJournal("pre-ledger.db");
    legacy.exec(
      "INSERT INTO accounts (id, name, kind, created_at) VALUES ('old', 'Existing', 'manual', '2026-01-01')",
    );
    legacy.close();

    const sqlite = new Database(scratchFile("pre-ledger.db"));
    try {
      applyMigrations(sqlite);
      expect(inspectMigrations(sqlite)).toEqual({
        currentVersion: LATEST_VERSION,
        pendingVersions: [],
      });
      expect(ledgerRows(sqlite)).toHaveLength(REGISTERED.length);
      // The repaired columns came back.
      const columns = (table: string) =>
        (sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
      expect(columns("folders")).toContain("deleted_at");
      expect(columns("accounts")).toContain("ibkr_sync_time_zone");
      expect(columns("executions")).toContain("import_metadata_json");
      // The existing row survived untouched.
      expect(sqlite.prepare("SELECT id, name FROM accounts").get()).toEqual({
        id: "old",
        name: "Existing",
      });
    } finally {
      sqlite.close();
    }
  });

  it("upgrades a journal from the previous phase onto the projection schema", () => {
    const previous = createPhaseTwoJournal("previous-phase.db");
    previous.exec(
      "INSERT INTO accounts (id, name, kind, created_at) VALUES ('old', 'Existing', 'manual', '2026-01-01')",
    );
    previous.close();

    const sqlite = new Database(scratchFile("previous-phase.db"));
    try {
      // Before the upgrade the projection tables do not exist and only the
      // baseline is on the ledger.
      const before = (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all() as { name: string }[]
      ).map((row) => row.name);
      expect(before).not.toContain("trade_identities");
      expect(inspectMigrations(sqlite)).toEqual({
        currentVersion: 1,
        pendingVersions: REGISTERED_VERSIONS.filter((version) => version > 1),
      });

      applyMigrations(sqlite);

      // The upgrade creates the projection tables and advances the ledger.
      expect(inspectMigrations(sqlite)).toEqual({
        currentVersion: LATEST_VERSION,
        pendingVersions: [],
      });
      const after = (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all() as { name: string }[]
      ).map((row) => row.name);
      expect(after).toEqual(
        expect.arrayContaining([
          "trade_identities",
          "trade_projection_revisions",
          "trade_revision_executions",
          "trade_identity_links",
          "execution_evidence",
        ]),
      );
      expect(ledgerRows(sqlite)).toHaveLength(REGISTERED.length);
      // The existing row survived the upgrade untouched.
      expect(sqlite.prepare("SELECT id, name FROM accounts").get()).toEqual({
        id: "old",
        name: "Existing",
      });
    } finally {
      sqlite.close();
    }
  });

  it("restores the CSV-bounds columns of an older journal and materializes them", () => {
    const legacy = createOldJournal("old-journal.db");
    legacy.exec(
      `INSERT INTO market_csv_datasets (id, name, symbol, resolution, currency, price_basis, bars_json, imported_at)
       VALUES ('ds', 'Set', 'EURUSD', '1', 'USD', 'close', '[{"time":100,"open":1,"high":2,"low":0.5,"close":1.5}]', '2026-01-01')`,
    );
    legacy.close();

    const sqlite = new Database(scratchFile("old-journal.db"));
    try {
      applyMigrations(sqlite);
      const columns = (sqlite.pragma("table_info(market_csv_datasets)") as { name: string }[]).map(
        (column) => column.name,
      );
      expect(columns).toContain("bar_count");
      expect(columns).toContain("first_time");
      expect(columns).toContain("last_time");
      expect(
        sqlite.prepare("SELECT bar_count, first_time, last_time FROM market_csv_datasets").get(),
      ).toEqual({ bar_count: 1, first_time: 100, last_time: 100 });
    } finally {
      sqlite.close();
    }
  });

  it("is a no-op when the same journal is opened again", () => {
    const sqlite = new Database(scratchFile("twice.db"));
    try {
      applyMigrations(sqlite);
      sqlite.exec("CREATE TABLE marker (id TEXT PRIMARY KEY)");
      const appliedAt = ledgerRows(sqlite)[0]?.applied_at;
      applyMigrations(sqlite);
      expect(ledgerRows(sqlite)).toHaveLength(REGISTERED.length);
      expect(ledgerRows(sqlite)[0]?.applied_at).toBe(appliedAt);
      // The second run did not touch the journal.
      expect(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'marker'")
          .get(),
      ).toEqual({ name: "marker" });
    } finally {
      sqlite.close();
    }
  });

  it("rolls back every change when a migration fails and never advances the ledger", () => {
    const file = scratchFile("failure.db");
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
      // The ledger row was rolled back...
      expect(ledgerRows(sqlite)).toEqual([]);
      // ...and so was every schema change the baseline made.
      const tables = (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
          .all() as { name: string }[]
      ).map((table) => table.name);
      expect(tables).not.toContain("accounts");
      expect(tables).not.toContain("executions");
      expect(tables).not.toContain("trades");
    } finally {
      sqlite.close();
    }
  });

  it("refuses a journal whose applied migration checksum was tampered with", () => {
    const sqlite = new Database(scratchFile("tampered-checksum.db"));
    try {
      applyMigrations(sqlite);
      sqlite
        .prepare("UPDATE journal_migrations SET checksum = ? WHERE version = 1")
        .run("0".repeat(64));
      expectMigrationFailure(() => applyMigrations(sqlite), "checksum-mismatch");
      expectMigrationFailure(() => inspectMigrations(sqlite), "checksum-mismatch");
    } finally {
      sqlite.close();
    }
  });

  it("refuses a journal whose applied migration name was tampered with", () => {
    const sqlite = new Database(scratchFile("tampered-name.db"));
    try {
      applyMigrations(sqlite);
      sqlite
        .prepare("UPDATE journal_migrations SET name = ? WHERE version = 1")
        .run("something-else");
      expectMigrationFailure(() => applyMigrations(sqlite), "name-mismatch");
    } finally {
      sqlite.close();
    }
  });

  it("refuses a journal migrated by a newer application without touching it", () => {
    const sqlite = new Database(scratchFile("future.db"));
    try {
      applyMigrations(sqlite);
      sqlite
        .prepare(
          "INSERT INTO journal_migrations (version, name, checksum, applied_at) VALUES (99, 'from-the-future', 'x', 1)",
        )
        .run();
      const before = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all();
      expectMigrationFailure(() => applyMigrations(sqlite), "future-version");
      expect(
        sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
      ).toEqual(before);
    } finally {
      sqlite.close();
    }
  });

  it("rejects an applied history with a missing version", () => {
    const registry: JournalMigration[] = [1, 2, 3].map((version) => ({
      version,
      name: `synthetic-${version}`,
      checksum: `checksum-${version}`,
      up: () => {},
    }));
    const history: AppliedMigrationRow[] = [
      { version: 1, name: "synthetic-1", checksum: "checksum-1", applied_at: 1 },
      { version: 3, name: "synthetic-3", checksum: "checksum-3", applied_at: 3 },
    ];
    expectMigrationFailure(
      () => validateMigrationHistory(history, registry),
      "noncontiguous-history",
    );
  });

  it("rejects a registry whose versions are not contiguous from 1", () => {
    const registry: JournalMigration[] = [1, 3].map((version) => ({
      version,
      name: `synthetic-${version}`,
      checksum: `checksum-${version}`,
      up: () => {},
    }));
    expectMigrationFailure(() => validateMigrationHistory([], registry), "registry-invalid");
  });

  it("converges a fresh and an upgraded journal on the same schema", () => {
    createLegacyJournal("parity-legacy.db").close();
    createOldJournal("parity-old.db").close();

    const fresh = new Database(scratchFile("parity-fresh.db"));
    const upgraded = new Database(scratchFile("parity-legacy.db"));
    const old = new Database(scratchFile("parity-old.db"));
    const declared = new Database(scratchFile("parity-declared.db"));
    try {
      applyMigrations(fresh);
      applyMigrations(upgraded);
      applyMigrations(old);
      declared.exec(BOOTSTRAP_SQL);

      // The declared final schema and the migrated schema agree exactly.
      expect(schemaFingerprint(fresh)).toEqual(schemaFingerprint(declared));
      // An upgraded journal has the same tables, columns, foreign keys and indexes.
      expect(schemaFingerprint(upgraded)).toEqual(schemaFingerprint(fresh));
      expect(schemaFingerprint(old, false)).toEqual(schemaFingerprint(fresh, false));
      // The only tolerated difference is the default of a NOT NULL column that
      // SQLite could only add with one.
      const defaults = (sqlite: Database.Database) =>
        (
          sqlite.pragma("table_info(market_csv_datasets)") as {
            name: string;
            dflt_value: string | null;
          }[]
        ).map((column) => `${column.name}=${column.dflt_value}`);
      expect(defaults(old)).not.toEqual(defaults(fresh));
      expect(defaults(old)).toContain("first_time=0");
      expect(defaults(fresh)).toContain("first_time=null");
    } finally {
      fresh.close();
      upgraded.close();
      old.close();
      declared.close();
    }
  });

  it("keeps credentials, hashes and annotations byte-for-byte unchanged", () => {
    const legacy = createLegacyJournal("bytes.db");
    legacy.exec(
      "INSERT INTO accounts (id, name, kind, credentials_enc, created_at) VALUES ('a', 'A', 'manual', 'enc:v1:blob', '2026-01-01')",
    );
    legacy.exec(
      "INSERT INTO executions (id, account_id, symbol, side, quantity, price, fee, executed_at, source, content_hash, created_at) VALUES ('e1', 'a', 'EURUSD', 'buy', 1, 1.1, 0.01, '2026-01-02T00:00:00Z', 'import', 'hash-1', '2026-01-02')",
    );
    legacy.exec(
      "INSERT INTO trades (key, account_id, symbol, direction, status, opened_at, closed_at, quantity, open_quantity, avg_entry, avg_exit, gross_pnl, fees, net_pnl, execution_count, execution_ids_json, exits_json, notes, tags_json, rating, playbook_id) VALUES ('k1', 'a', 'EURUSD', 'long', 'closed', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', 1, 0, 1.1, 1.2, 0.1, 0.01, 0.09, 2, '[\"e1\"]', '[]', 'my note', '[\"tag\"]', 4, 'pb1')",
    );
    legacy.exec(
      "INSERT INTO notes (id, folder_id, title, content, tags_json, trade_key, day_date, created_at, updated_at) VALUES ('n1', 'my-notes', 'T', 'C', '[\"x\"]', 'k1', '2026-01-02', '2026-01-02', '2026-01-02')",
    );
    const before = {
      accounts: queryRows(legacy, "SELECT * FROM accounts"),
      executions: queryRows(legacy, "SELECT * FROM executions"),
      trades: queryRows(legacy, "SELECT * FROM trades"),
      notes: queryRows(legacy, "SELECT * FROM notes"),
    };
    legacy.close();

    const upgraded = new Database(scratchFile("bytes.db"));
    try {
      applyMigrations(upgraded);
      expectUnchangedRows(before.accounts, queryRows(upgraded, "SELECT * FROM accounts"));
      expectUnchangedRows(before.executions, queryRows(upgraded, "SELECT * FROM executions"));
      expectUnchangedRows(before.trades, queryRows(upgraded, "SELECT * FROM trades"));
      expectUnchangedRows(before.notes, queryRows(upgraded, "SELECT * FROM notes"));
      expect(upgraded.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(upgraded.pragma("foreign_key_check")).toEqual([]);
    } finally {
      upgraded.close();
    }
  });

  it("binds every registry checksum to the canonical migration source", () => {
    // Each manifest entry is bound to the file it names, so a migration whose
    // source changed cannot keep its old checksum.
    expect(REGISTERED.length).toBeGreaterThan(0);
    for (const entry of REGISTERED) {
      const source = readFileSync(
        new URL(`../src/db/migrations/${entry.file}`, import.meta.url),
        "utf8",
      );
      expect(createHash("sha256").update(canonical(source), "utf8").digest("hex")).toBe(
        entry.checksum,
      );
    }
  });

  it("converges concurrent starts on one fresh journal", async () => {
    const file = scratchFile("concurrent.db");
    const start = Date.now() + 1500;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        run(
          process.execPath,
          [
            "--experimental-strip-types",
            "--no-warnings",
            "--input-type=module",
            "-e",
            child,
            file,
            String(start),
            bootstrapUrl,
          ],
          { timeout: 30_000 },
        ),
      ),
    );
    const failures = results.flatMap((result) => {
      if (result.status === "fulfilled") return [];
      const reason: unknown = result.reason;
      const stderr =
        typeof reason === "object" && reason !== null && "stderr" in reason
          ? reason.stderr
          : reason;
      return [String(stderr)];
    });
    expect(failures).toEqual([]);
    const sqlite = new Database(file, { readonly: true });
    try {
      expect(ledgerRows(sqlite)).toEqual(
        REGISTERED_LEDGER.map((entry) => ({ ...entry, applied_at: expect.any(Number) })),
      );
      expect(sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      sqlite.close();
    }
  }, 60_000);
});
