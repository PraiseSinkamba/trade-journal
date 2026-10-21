import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema";
import { openJournalDatabase } from "./bootstrap";

export const dataDir = (): string => process.env.JOURNAL_DATA_DIR ?? "/data/trade-journal";

export type JournalDb = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

const globalForDb = globalThis as unknown as { __journalDb?: JournalDb };

/** Track the directory used to open the current connection so we can detect a changed test environment. */
let currentDataDir: string | undefined;

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
 * Opens the journal through the shared bootstrap so schema setup happens in a
 * single immediate transaction; safe to call from several build workers at once.
 */
const createDb = (): JournalDb => {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const sqlite = openJournalDatabase(join(dir, "journal.db"));
  sqlite.pragma("busy_timeout = 5000");
  const journal = drizzle(sqlite, { schema }) as JournalDb;
  journal.$client = sqlite;
  return journal;
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
  const existing = globalForDb.__journalDb;
  if (existing) return existing;
  const journal = createDb();
  globalForDb.__journalDb = journal;
  return journal;
})();

export * from "./schema";
