import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema";
import { openJournalDatabase } from "./bootstrap";

/** Directory that holds the journal database file. */
export const dataDir = (): string => process.env.JOURNAL_DATA_DIR ?? "/data/trade-journal";

export type JournalDb = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

/**
 * Opens an independent connection to the journal inside `directory`.
 *
 * The directory is created when missing and the shared bootstrap performs the
 * idempotent schema setup, so WAL mode and `foreign_keys = ON` are unchanged.
 * WAL sidecars are never removed: they belong to every open connection
 * (ADR 0007).
 */
export const openConnection = (directory: string): JournalDb => {
  mkdirSync(directory, { recursive: true });
  const sqlite = openJournalDatabase(join(directory, "journal.db"));
  sqlite.pragma("busy_timeout = 5000");
  const journal = drizzle(sqlite, { schema }) as JournalDb;
  journal.$client = sqlite;
  return journal;
};

const globalForDb = globalThis as unknown as {
  __journalDb?: JournalDb;
  /** Directory the cached handle belongs to, tracked globally so a module re-evaluation knows it. */
  __journalDbDir?: string;
};

/**
 * App singleton, shared across Next.js dev hot reloads.
 *
 * When `JOURNAL_DATA_DIR` changes the stale handle is closed and a fresh one
 * is opened against the new directory. The WAL sidecars of the old directory
 * are left alone: deleting them would corrupt other live connections.
 */
export const db: JournalDb = (() => {
  const dir = dataDir();
  const cached = globalForDb.__journalDb;
  if (cached) {
    if (globalForDb.__journalDbDir === dir) return cached;
    try {
      cached.$client.close();
    } catch {
      // ignore
    }
    globalForDb.__journalDb = undefined;
    globalForDb.__journalDbDir = undefined;
  }
  const journal = openConnection(dir);
  globalForDb.__journalDb = journal;
  globalForDb.__journalDbDir = dir;
  return journal;
})();
