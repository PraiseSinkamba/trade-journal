import type Database from "better-sqlite3";
import type { JournalMigrationSource } from "../migrations.ts";

/**
 * The Phase 22 schema: the revision-bound AI insight.
 *
 * The same DDL is reused by the final-schema snapshot in `../bootstrap.ts`, so
 * a migrated journal and the declared schema cannot drift.
 *
 * Notes on the constraints:
 * - `intelligence_insights` holds one row per generated review question: the
 *   question text, the scope it is about, the capability version that produced
 *   it and the run that produced it. No prompt, no provider response and no
 *   credential is stored.
 * - `business_key` is unique and is the deduplication identity of the
 *   capability version and the source revision within the account, so a
 *   repeated write is one row.
 * - `account_id` cascades from `accounts`, so deleting an account removes its
 *   questions.
 * - `observation_id` cascades from `intelligence_observations`, so a question
 *   never outlives the observation it was generated from.
 * - `run_id` is `SET NULL`, never `CASCADE`: the run is operational metadata
 *   that the retention prune empties and the account purge deletes, and the
 *   question must survive the loss of its producer.
 * - `subject_id` carries no foreign key: the question is bound to the
 *   revision, not to the identity's row, so a re-keyed identity cannot make it
 *   disappear.
 */
export const INSIGHTS_SQL = `
CREATE TABLE IF NOT EXISTS intelligence_insights (
  id TEXT PRIMARY KEY,
  business_key TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  observation_id TEXT NOT NULL REFERENCES intelligence_observations(id) ON DELETE CASCADE,
  source_revision TEXT NOT NULL,
  capability_version TEXT NOT NULL,
  question TEXT NOT NULL,
  run_id TEXT REFERENCES intelligence_runs(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_insights_business_key_unique
  ON intelligence_insights (business_key);
CREATE INDEX IF NOT EXISTS intelligence_insights_account_idx ON intelligence_insights (account_id);
CREATE INDEX IF NOT EXISTS intelligence_insights_subject_idx ON intelligence_insights (subject_id);
CREATE INDEX IF NOT EXISTS intelligence_insights_source_revision_idx
  ON intelligence_insights (source_revision);
CREATE INDEX IF NOT EXISTS intelligence_insights_created_at_idx ON intelligence_insights (created_at);
`;

/**
 * Migration 0008 — the revision-bound AI insight.
 *
 * Forward-only and additive: it creates new tables and never rewrites an
 * existing one, so a legacy journal and a fresh journal converge on the same
 * schema.
 */
export const aiInsights: JournalMigrationSource = {
  version: 8,
  name: "ai-insights",
  up(sqlite: Database.Database) {
    sqlite.exec(INSIGHTS_SQL);
  },
};
