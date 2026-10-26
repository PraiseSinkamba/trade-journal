import type Database from "better-sqlite3";
import type { JournalMigrationSource } from "../migrations.ts";

/**
 * The Phase 03 schema: projection identity, immutable revisions, normalized
 * revision membership, identity provenance and per-execution source evidence.
 *
 * The same DDL is reused by the final-schema snapshot in `../bootstrap.ts`, so
 * a migrated journal and the declared schema cannot drift apart.
 *
 * Notes on the constraints:
 * - `trade_identities.current_key` is released when an identity is retired, so
 *   the partial unique index covers exactly the *active* key mappings.
 * - `trade_projection_revisions` rows are append-only; the unique
 *   `(trade_id, revision)` pair is what makes a revision immutable.
 * - `trade_revision_executions` deliberately has no foreign key to
 *   `executions`: membership evidence must survive the deletion of the source
 *   fills until an explicit purge.
 */
export const TRADE_PROJECTION_SQL = `
CREATE TABLE IF NOT EXISTS trade_identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  current_key TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'tombstoned')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS trade_identities_current_key_unique ON trade_identities (current_key) WHERE current_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS trade_identities_account_idx ON trade_identities (account_id);

CREATE TABLE IF NOT EXISTS trade_projection_revisions (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL REFERENCES trade_identities(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  trade_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('exact_key', 'explicit_transfer', 'new', 'ambiguous')),
  snapshot_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS trade_projection_revisions_trade_revision_unique ON trade_projection_revisions (trade_id, revision);
CREATE INDEX IF NOT EXISTS trade_projection_revisions_account_idx ON trade_projection_revisions (account_id);

CREATE TABLE IF NOT EXISTS trade_revision_executions (
  revision_id TEXT NOT NULL REFERENCES trade_projection_revisions(id) ON DELETE CASCADE,
  execution_id TEXT NOT NULL,
  PRIMARY KEY (revision_id, execution_id)
);
CREATE INDEX IF NOT EXISTS trade_revision_executions_execution_idx ON trade_revision_executions (execution_id);

CREATE TABLE IF NOT EXISTS trade_identity_links (
  old_id TEXT NOT NULL REFERENCES trade_identities(id) ON DELETE CASCADE,
  new_id TEXT NOT NULL REFERENCES trade_identities(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('superseded', 'ambiguous')),
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (old_id, new_id, operation_id)
);
CREATE INDEX IF NOT EXISTS trade_identity_links_new_idx ON trade_identity_links (new_id);

CREATE TABLE IF NOT EXISTS execution_evidence (
  execution_id TEXT PRIMARY KEY,
  timing_quality TEXT NOT NULL CHECK (timing_quality IN ('source_reported', 'reconstructed', 'unknown')),
  source_kind TEXT NOT NULL,
  evidence_version INTEGER NOT NULL DEFAULT 1,
  recorded_at INTEGER NOT NULL
);
`;

/**
 * Migration 0002 — projection identity and immutable revisions.
 *
 * Forward-only and additive: it creates new tables and never rewrites an
 * existing one, so a legacy journal and a fresh journal converge on the same
 * schema.
 */
export const tradeProjections: JournalMigrationSource = {
  version: 2,
  name: "trade-projections",
  up(sqlite: Database.Database) {
    sqlite.exec(TRADE_PROJECTION_SQL);
  },
};
