import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema";
import { BOOTSTRAP_SQL } from "./bootstrap";

export const dataDir = (): string => process.env.JOURNAL_DATA_DIR ?? join(process.cwd(), "data");

/** Track the directory used to open the current connection so we can detect a changed test environment. */
let currentDataDir: string | undefined;

/**
 * Track the first directory this module opened a connection to.
 * Used by tests to ensure the initial fork-level DB is closed before
 * removing the temp directory, even after JOURNAL_DATA_DIR changes.
 */
let __initialDataDir: string | undefined;

const globalForDb = globalThis as unknown as { __journalDb?: ReturnType<typeof createDb> };

/** Remove any WAL and shared-memory files left by a previous connection. */
const cleanWalFiles = (dbPath: string) => {
  for (const ext of ["-wal", "-shm"]) {
    const f = dbPath + ext;
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      // ignore
    }
  }
};

/**
 * Checkpoint, close, and reset the DB singleton.
 *
 * When called from vitest-setup.ts afterAll this ensures the fork-level
 * connection (opened against the initial JOURNAL_DATA_DIR) is closed before
 * rmSync removes the temp directory — preventing EPERM on Windows.
 *
 * Idempotent: closing an already-closed connection is a no-op.
 */
export const close = () => {
  if (globalForDb.__journalDb) {
    const sqlite = globalForDb.__journalDb.$client;
    try {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // ignore
    }
    sqlite.close();
    if (currentDataDir) cleanWalFiles(join(currentDataDir, "journal.db"));
    globalForDb.__journalDb = undefined;
  }
  // Reset both so the next db() call re-detects on its own.
  currentDataDir = undefined;
  __initialDataDir = undefined;
};

const createDb = () => {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "journal.db");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(BOOTSTRAP_SQL);
  const folderColumns = sqlite.pragma("table_info(folders)") as { name: string }[];
  if (!folderColumns.some((column) => column.name === "deleted_at")) {
    sqlite.exec("ALTER TABLE folders ADD COLUMN deleted_at TEXT");
  }
  sqlite
    .transaction(() => {
      const columns = sqlite.pragma("table_info(accounts)") as { name: string }[];
      if (!columns.some((column) => column.name === "ibkr_sync_time_zone")) {
        sqlite.exec("ALTER TABLE accounts ADD COLUMN ibkr_sync_time_zone TEXT");
      }
    })
    .immediate();
  // Additive upgrade: existing executions retain their fields and dedup hashes.
  const executionColumns = sqlite.pragma("table_info(executions)") as { name: string }[];
  if (!executionColumns.some((column) => column.name === "import_metadata_json")) {
    sqlite.exec("ALTER TABLE executions ADD COLUMN import_metadata_json TEXT");
  }
  // Materialize CSV bounds once so connection and range lookups never scan candle JSON.
  const csvColumns = sqlite.pragma("table_info(market_csv_datasets)") as { name: string }[];
  sqlite.transaction(() => {
    for (const name of ["bar_count", "first_time", "last_time"]) {
      if (!csvColumns.some((column) => column.name === name))
        sqlite.exec(
          `ALTER TABLE market_csv_datasets ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`,
        );
    }
    sqlite.exec(`UPDATE market_csv_datasets SET
      bar_count = json_array_length(bars_json),
      first_time = json_extract(bars_json, '$[0].time'),
      last_time = json_extract(bars_json, '$[#-1].time') WHERE bar_count = 0`);
  })();
  return drizzle(sqlite, { schema });
};

/**
 * Singleton across Next.js dev hot reloads.
 *
 * When `JOURNAL_DATA_DIR` changes (e.g. between Vitest forks that set it before
 * importing this module) the old connection is closed and a fresh one is opened
 * against the new directory so each test fork gets isolated storage.
 */
export const db = (() => {
  const dir = dataDir();
  if (globalForDb.__journalDb && currentDataDir !== dir) {
    const sqlite = globalForDb.__journalDb.$client;
    try {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // ignore
    }
    sqlite.close();
    cleanWalFiles(join(currentDataDir!, "journal.db"));
    globalForDb.__journalDb = undefined;
  }
  currentDataDir = dir;
  if (__initialDataDir === undefined) __initialDataDir = dir;
  return (globalForDb.__journalDb ??= createDb());
})();

export * from "./schema";
