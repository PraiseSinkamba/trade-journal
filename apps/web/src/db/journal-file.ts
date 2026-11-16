import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The journal file, read as it is.
 *
 * The backup and the restore judge a journal as it stands: the copy must be
 * of the file the operator backed up, and the verification must judge that
 * file rather than a migrated version of it. Opening a journal through the
 * journal would migrate it, so these primitives open the file directly.
 *
 * The module holds no policy: it reports what a file holds, what a copy
 * found and what a verification found. What may travel with a backup is the
 * retention layer's decision.
 */

/** What a journal file holds that a backup has to judge. */
export interface JournalFileFacts {
  /** Whether the directory holds a journal file at all. */
  readonly present: boolean;
  /** Every value of the settings table, or null when the table cannot be read. */
  readonly settingValues: readonly string[] | null;
  /** How many accounts carry sealed credentials, or null when they cannot be counted. */
  readonly credentialAccounts: number | null;
}

/**
 * The result of copying a journal file.
 */
export interface JournalCopyResult {
  /** The expiry of the worker lease that was still live, or null when the copy was taken. */
  readonly liveLeaseUntil: number | null;
}

/**
 * The verdict of checking a journal file.
 */
export interface JournalFileVerdict {
  /** The integrity check of the file: "ok" when the file is sound. */
  readonly integrity: string;
  /** How many foreign-key violations the file holds. */
  readonly foreignKeyViolations: number;
}

/**
 * Reads the facts of a journal file.
 *
 * The file is opened directly and is never migrated. A journal that cannot
 * be read yields nulls rather than an exception, so the caller decides what
 * an unreadable journal means.
 */
export const readJournalFileFacts = (directory: string): JournalFileFacts => {
  const file = join(directory, "journal.db");
  if (!existsSync(file)) return { present: false, settingValues: null, credentialAccounts: null };
  const journal = new Database(file, { fileMustExist: true });
  try {
    return {
      present: true,
      settingValues: readSettingValues(journal),
      credentialAccounts: countCredentialAccounts(journal),
    };
  } finally {
    journal.close();
  }
};

/**
 * Copies a journal file with SQLite's `VACUUM INTO`.
 *
 * The copy is a consistent snapshot of the whole file rather than a copy of
 * a live WAL file. A worker lease that is still live means a worker is
 * writing: the copy would not be a point in time, so no copy is taken and
 * the expiry of the lease is reported.
 */
export const copyJournalFile = (
  source: string,
  destination: string,
  leaseName: string,
): JournalCopyResult => {
  const journal = new Database(join(source, "journal.db"), { fileMustExist: true });
  try {
    const lease = journal
      .prepare("SELECT lease_until FROM intelligence_worker_lease WHERE name = ?")
      .get(leaseName) as { lease_until?: number } | undefined;
    if (lease && typeof lease.lease_until === "number" && lease.lease_until > Date.now()) {
      return { liveLeaseUntil: lease.lease_until };
    }
    journal.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
    return { liveLeaseUntil: null };
  } finally {
    journal.close();
  }
};

/**
 * Checks a journal file.
 *
 * The file is opened read-only and is never migrated, so the checks judge
 * the file as it was copied. The foreign-key check runs only when the
 * integrity check passed: a corrupt file fails the integrity check, and the
 * foreign-key pragma cannot read a corrupt file at all.
 */
export const checkJournalFile = (database: string): JournalFileVerdict => {
  const sqlite = new Database(database, { fileMustExist: true, readonly: true });
  try {
    const integrity: unknown = sqlite.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      return { integrity: String(integrity), foreignKeyViolations: 0 };
    }
    const violations = sqlite.pragma("foreign_key_check") as unknown[];
    return { integrity: "ok", foreignKeyViolations: violations.length };
  } finally {
    sqlite.close();
  }
};

/** The values of the settings table, or null when the table cannot be read. */
const readSettingValues = (journal: Database.Database): readonly string[] | null => {
  try {
    const rows = journal.prepare("SELECT value FROM settings").all() as { value?: string }[];
    return rows.map((row) => row.value ?? "");
  } catch {
    return null;
  }
};

/** The number of accounts that carry sealed credentials, or null when they cannot be counted. */
const countCredentialAccounts = (journal: Database.Database): number | null => {
  try {
    const accounts = journal
      .prepare("SELECT COUNT(*) AS count FROM accounts WHERE credentials_enc IS NOT NULL")
      .get() as { count?: number } | undefined;
    return accounts?.count ?? 0;
  } catch {
    return null;
  }
};
