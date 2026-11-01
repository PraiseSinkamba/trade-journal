import type Database from "better-sqlite3";
import type { JournalMigrationSource } from "../migrations.ts";

/**
 * The Phase 13 schema: the background run ledger, the revisioned background
 * policy and the daily attempt reservations.
 *
 * The same DDL is reused by the final-schema snapshot in `../bootstrap.ts`, so
 * a migrated journal and the declared schema cannot drift.
 *
 * Notes on the constraints:
 * - `intelligence_runs` holds one queued background run. Its unique effect key
 *   makes the enqueue idempotent: the same effect is queued once.
 * - The run pins the provider, the model and the fingerprint of the endpoint
 *   it was approved against. A configuration change therefore cannot silently
 *   reroute a queued run to another endpoint.
 * - `intelligence_policy` keeps one immutable row per revision. A run pins the
 *   revision it was approved under, so a later policy change does not apply
 *   retroactively.
 * - `intelligence_budget_reservations` holds one row per reserved attempt. The
 *   primary key over (run, attempt) makes a reservation idempotent, and the
 *   day index makes the daily allowance a cheap lookup. Reservations are never
 *   deleted: a crashed attempt keeps its reservation.
 */
export const INTELLIGENCE_RUNTIME_SQL = `
CREATE TABLE IF NOT EXISTS intelligence_runs (
  id TEXT PRIMARY KEY,
  effect_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'unavailable')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint_fingerprint TEXT NOT NULL,
  policy_revision INTEGER NOT NULL,
  scope_json TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_runs_effect_key_unique
  ON intelligence_runs (effect_key);
CREATE INDEX IF NOT EXISTS intelligence_runs_status_idx
  ON intelligence_runs (status, created_at);

CREATE TABLE IF NOT EXISTS intelligence_policy (
  id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  settings_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (id, revision)
);

CREATE TABLE IF NOT EXISTS intelligence_budget_reservations (
  run_id TEXT NOT NULL REFERENCES intelligence_runs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  day INTEGER NOT NULL,
  reserved_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, attempt)
);
CREATE INDEX IF NOT EXISTS intelligence_budget_reservations_day_idx
  ON intelligence_budget_reservations (day);
`;

/**
 * Migration 0005 — the background runtime storage.
 *
 * Forward-only and additive: it creates new tables and never rewrites an
 * existing one, so a legacy journal and a fresh journal converge on the same
 * schema.
 */
export const intelligenceRuntime: JournalMigrationSource = {
  version: 5,
  name: "intelligence-runtime",
  up(sqlite: Database.Database) {
    sqlite.exec(INTELLIGENCE_RUNTIME_SQL);
  },
};
