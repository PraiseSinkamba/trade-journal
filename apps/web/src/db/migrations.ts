import type Database from "better-sqlite3";
import { legacyBaseline } from "./migrations/0001-legacy-baseline.ts";
import { tradeProjections } from "./migrations/0002-trade-projections.ts";
import { durableJobs } from "./migrations/0003-durable-jobs.ts";
import { observations } from "./migrations/0004-observations.ts";
import checksumManifest from "./migration-checksums.json" with { type: "json" };

/**
 * Ordered, checksummed schema migrations for the journal.
 *
 * The runner owns a `journal_migrations` ledger: every applied migration is
 * recorded with the SHA-256 of its immutable source, so a journal whose history
 * cannot be validated is refused **before** any schema write instead of being
 * silently upgraded (ADR 0007).
 *
 * The checksum comes from `migration-checksums.json`, a build artifact generated
 * from the migration sources by `scripts/build-migration-manifest.mjs`. It is
 * never derived from `Function.prototype.toString()`, because bundling and
 * transpilation change that text.
 */

/** One migration: an ordered, immutable, synchronously applied schema change. */
export interface JournalMigration {
  version: number; // positive, unique, monotonically ordered
  name: string;
  checksum: string; // deterministic SHA-256 of immutable migration content
  up(sqlite: Database.Database): void;
}

/** A migration before its immutable source checksum is bound from the manifest. */
export type JournalMigrationSource = Omit<JournalMigration, "checksum">;

/** What the ledger says about the journal, without touching it. */
export type MigrationStatus = Readonly<{
  currentVersion: number;
  pendingVersions: readonly number[];
}>;

/** One applied migration row as stored in the ledger. */
export type AppliedMigrationRow = Readonly<{
  version: number;
  name: string;
  checksum: string;
  applied_at: number;
}>;

/** Why the runner refused a journal. */
export type MigrationFailure =
  | "future-version"
  | "noncontiguous-history"
  | "checksum-mismatch"
  | "name-mismatch"
  | "registry-invalid"
  | "missing-manifest";

/** A journal the runner refuses to migrate. The reason is machine-readable. */
export class MigrationError extends Error {
  readonly reason: MigrationFailure;

  constructor(reason: MigrationFailure, message: string) {
    super(message);
    this.reason = reason;
    this.name = "MigrationError";
  }
}

/** The ledger DDL, verbatim from the phase guide. The runner owns this table. */
export const LEDGER_TABLE_SQL = `CREATE TABLE journal_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);`;

/**
 * The same table, re-runnable. The final-schema snapshot in `bootstrap.ts` may
 * be executed on a journal that already has the ledger, so its copy of the DDL
 * carries the `IF NOT EXISTS` guard the runner's copy does not need.
 */
export const LEDGER_TABLE_SQL_SNAPSHOT = `CREATE TABLE IF NOT EXISTS journal_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);`;

type ManifestEntry = { file: string; name: string; checksum: string };
type Manifest = { formatVersion: number; migrations: Record<string, ManifestEntry> };

const MANIFEST = checksumManifest as Manifest;
const MANIFEST_FORMAT_VERSION = 1;

/** Every migration, in order. Immutable once applied — never renumber or edit. */
const SOURCES: readonly JournalMigrationSource[] = [
  legacyBaseline,
  tradeProjections,
  durableJobs,
  observations,
];

let cachedRegistry: readonly JournalMigration[] | undefined;

/**
 * Binds the registered migrations to their immutable source checksums.
 *
 * The registry is built on first use, so a stale or missing manifest entry
 * surfaces as an actionable `MigrationError` instead of a module-load crash.
 */
const buildRegistry = (): readonly JournalMigration[] => {
  if (MANIFEST.formatVersion !== MANIFEST_FORMAT_VERSION) {
    throw new MigrationError(
      "registry-invalid",
      `migration-checksums.json has an unsupported format version ${MANIFEST.formatVersion}; this build reads version ${MANIFEST_FORMAT_VERSION}.`,
    );
  }
  const entries = new Map<number, ManifestEntry>();
  for (const [version, entry] of Object.entries(MANIFEST.migrations)) {
    const parsed = Number(version);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new MigrationError(
        "registry-invalid",
        `migration-checksums.json declares an invalid migration version "${version}".`,
      );
    }
    entries.set(parsed, entry);
  }
  const registry = SOURCES.map((source) => {
    const entry = entries.get(source.version);
    if (!entry) {
      throw new MigrationError(
        "missing-manifest",
        `Migration ${source.version} (${source.name}) has no checksum in migration-checksums.json. Run \`pnpm --filter web migrations:build\`.`,
      );
    }
    if (entry.name !== source.name) {
      throw new MigrationError(
        "registry-invalid",
        `Migration ${source.version} is registered as "${source.name}" but migration-checksums.json names it "${entry.name}". Rename the file to match the migration name and regenerate the artifact.`,
      );
    }
    return { ...source, checksum: entry.checksum };
  });
  for (const version of entries.keys()) {
    if (!registry.some((migration) => migration.version === version)) {
      throw new MigrationError(
        "registry-invalid",
        `migration-checksums.json lists migration ${version}, which this build does not register.`,
      );
    }
  }
  return registry;
};

const registry = (): readonly JournalMigration[] => (cachedRegistry ??= buildRegistry());

/** The applied history. A journal without the ledger has nothing applied yet. */
const readLedger = (
  sqlite: Database.Database,
): { exists: boolean; rows: AppliedMigrationRow[] } => {
  const exists =
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'journal_migrations'")
      .get() !== undefined;
  if (!exists) return { exists: false, rows: [] };
  return {
    exists: true,
    rows: sqlite
      .prepare(
        "SELECT version, name, checksum, applied_at FROM journal_migrations ORDER BY version",
      )
      .all() as AppliedMigrationRow[],
  };
};

/**
 * Rejects a history this build cannot vouch for.
 *
 * The registry must be unique and contiguous from version 1, and the applied
 * history must be a contiguous prefix of it. Every applied row must still carry
 * the name and checksum of the registered migration, so an edited or swapped
 * migration is caught instead of silently skipped.
 */
export function validateMigrationHistory(
  applied: readonly AppliedMigrationRow[],
  migrations: readonly JournalMigration[],
): void {
  if (migrations.length === 0) {
    throw new MigrationError("registry-invalid", "The migration registry is empty.");
  }
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(
        "registry-invalid",
        `Migration versions must be unique and contiguous from 1; found ${migration.version} at position ${index + 1}.`,
      );
    }
    if (!migration.checksum) {
      throw new MigrationError(
        "registry-invalid",
        `Migration ${migration.version} (${migration.name}) has no checksum.`,
      );
    }
  });
  const latest = migrations[migrations.length - 1]!.version;
  const versions = applied.map((row) => row.version).sort((a, b) => a - b);
  versions.forEach((version, index) => {
    if (version > latest) {
      throw new MigrationError(
        "future-version",
        `This journal was migrated by a newer application (migration ${version}); this build supports up to ${latest}.`,
      );
    }
    if (version !== index + 1) {
      throw new MigrationError(
        "noncontiguous-history",
        `Migration history is not contiguous: version ${version} is applied but version ${index + 1} is missing.`,
      );
    }
  });
  for (const row of applied) {
    // The version is within the registry by the checks above.
    const migration = migrations.find((candidate) => candidate.version === row.version)!;
    if (row.name !== migration.name) {
      throw new MigrationError(
        "name-mismatch",
        `Migration ${row.version} was applied as "${row.name}" but is registered as "${migration.name}".`,
      );
    }
    if (row.checksum !== migration.checksum) {
      throw new MigrationError(
        "checksum-mismatch",
        `Migration ${row.version} (${row.name}) was applied from a different source; its checksum no longer matches.`,
      );
    }
  }
}

/**
 * Reports what the journal has applied and what is still pending.
 *
 * Read-only: it never creates the ledger and never writes. An unsupported
 * history throws, because a status that silently ignored a newer journal would
 * invite a downgrade.
 */
export function inspectMigrations(sqlite: Database.Database): MigrationStatus {
  const migrations = registry();
  const { rows: applied } = readLedger(sqlite);
  validateMigrationHistory(applied, migrations);
  const appliedVersions = new Set(applied.map((row) => row.version));
  return {
    currentVersion: applied.length === 0 ? 0 : Math.max(...applied.map((row) => row.version)),
    pendingVersions: migrations
      .filter((migration) => !appliedVersions.has(migration.version))
      .map((migration) => migration.version),
  };
}

/**
 * Brings the journal up to the registered schema.
 *
 * An unsupported history is rejected before anything is written. The pending
 * migrations then run inside one immediate transaction, each with its ledger
 * row, so a failure rolls back the schema changes with the ledger and never
 * advances the version.
 */
export function applyMigrations(sqlite: Database.Database): void {
  const migrations = registry();
  // Read-only pre-flight: refuse an unsupported history before any write.
  validateMigrationHistory(readLedger(sqlite).rows, migrations);
  sqlite
    .transaction(() => {
      // Re-read inside the write lock: a concurrent process may have applied
      // migrations while this one waited for the lock.
      const ledger = readLedger(sqlite);
      validateMigrationHistory(ledger.rows, migrations);
      const appliedVersions = new Set(ledger.rows.map((row) => row.version));
      if (!ledger.exists) sqlite.exec(LEDGER_TABLE_SQL);
      for (const migration of migrations) {
        if (appliedVersions.has(migration.version)) continue;
        migration.up(sqlite);
        sqlite
          .prepare(
            "INSERT INTO journal_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
          )
          .run(migration.version, migration.name, migration.checksum, Date.now());
      }
    })
    .immediate();
}
