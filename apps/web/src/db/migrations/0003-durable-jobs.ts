import type Database from "better-sqlite3";
import type { JournalMigrationSource } from "../migrations.ts";

/**
 * The Phase 04 schema: transactional outbox, per-handler deliveries, durable
 * jobs and the single worker lease.
 *
 * The same DDL is reused by the final-schema snapshot in `../bootstrap.ts`, so
 * a migrated journal and the declared schema cannot drift.
 *
 * Notes on the constraints:
 * - `domain_outbox` is the committed event log. Its unique key is the
 *   aggregate revision plus the event type, so one aggregate revision can
 *   never produce two events.
 * - `event_deliveries` is the per-handler record. Its primary key is the
 *   delivery key, so a repeated fanout updates one row instead of adding
 *   another.
 * - `intelligence_jobs` carries the claim ownership (owner, fence, lease) and
 *   the retry state. The unique idempotency key is what makes a repeated
 *   fanout safe.
 * - `intelligence_worker_lease` holds exactly one row: the journal's worker
 *   lease, so a second worker launch cannot steal the journal.
 */
export const DURABLE_JOBS_SQL = `
CREATE TABLE IF NOT EXISTS domain_outbox (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision >= 0),
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('user', 'broker_sync', 'import', 'system', 'workflow')),
  account_id TEXT,
  payload_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  occurred_at INTEGER,
  dispatched_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS domain_outbox_aggregate_unique
  ON domain_outbox (aggregate_type, aggregate_id, aggregate_revision, type);
CREATE INDEX IF NOT EXISTS domain_outbox_dispatch_idx
  ON domain_outbox (dispatched_at, recorded_at, id);
CREATE INDEX IF NOT EXISTS domain_outbox_account_idx
  ON domain_outbox (account_id);

CREATE TABLE IF NOT EXISTS intelligence_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'retry_wait', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at INTEGER NOT NULL,
  owner TEXT,
  fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
  lease_until INTEGER,
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_jobs_idempotency_unique
  ON intelligence_jobs (idempotency_key);
CREATE INDEX IF NOT EXISTS intelligence_jobs_status_available_idx
  ON intelligence_jobs (status, available_at, id);
CREATE INDEX IF NOT EXISTS intelligence_jobs_status_lease_idx
  ON intelligence_jobs (status, lease_until);

CREATE TABLE IF NOT EXISTS event_deliveries (
  event_id TEXT NOT NULL REFERENCES domain_outbox(id) ON DELETE CASCADE,
  handler_id TEXT NOT NULL,
  handler_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'failed', 'cancelled')),
  job_id TEXT REFERENCES intelligence_jobs(id) ON DELETE SET NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, handler_id, handler_version)
);
CREATE INDEX IF NOT EXISTS event_deliveries_job_idx ON event_deliveries (job_id);

CREATE TABLE IF NOT EXISTS intelligence_worker_lease (
  name TEXT PRIMARY KEY CHECK (name = 'journal-worker'),
  owner TEXT NOT NULL,
  fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
  lease_until INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL
);
`;

/**
 * Migration 0003 — the durable outbox, jobs and worker lease.
 *
 * Forward-only and additive: it creates new tables and never rewrites an
 * existing one, so a legacy journal and a fresh journal converge on the same
 * schema.
 */
export const durableJobs: JournalMigrationSource = {
  version: 3,
  name: "durable-jobs",
  up(sqlite: Database.Database) {
    sqlite.exec(DURABLE_JOBS_SQL);
  },
};
