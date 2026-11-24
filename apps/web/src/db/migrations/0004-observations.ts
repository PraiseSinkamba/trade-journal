import type Database from "better-sqlite3";
import type { JournalMigrationSource } from "../migrations.ts";

/**
 * The Phase 08 schema: factual observations, their evidence links and the seed checkpoint.
 *
 * The same DDL is reused by the final-schema snapshot in `../bootstrap.ts`, so
 * a migrated journal and the declared schema cannot drift.
 *
 * Notes on the constraints:
 * - `intelligence_observations` holds one derived statement about a trade. Its
 *   unique key over the subject, the source revision, the evaluator and the
 *   type is what makes a repeated delivery idempotent: the same delivery
 *   writes the same observation, never a second one.
 * - The subject carries no foreign key. An observation outlives the identity
 *   it observed, exactly like the execution membership does, so the journal
 *   can keep the evidence of a trade it no longer holds.
 * - The account reference cascades: deleting an account removes its
 *   observations with it.
 * - `direct_facts_json` holds the direct fact (the projection revision's
 *   snapshot) and `observation_json` the derived observation. They are kept
 *   apart, so a reader never has to guess which one is the source of truth.
 * - `intelligence_seed_checkpoints` is created here, per the phase guide's
 *   allocation, and consumed by the historical seed phase. This migration
 *   writes no checkpoint.
 */
export const OBSERVATIONS_SQL = `
CREATE TABLE IF NOT EXISTS intelligence_observations (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  evaluator_id TEXT NOT NULL,
  evaluator_version TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'invalidated')),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  net_pnl REAL NOT NULL,
  fees REAL NOT NULL,
  trade_status TEXT NOT NULL CHECK (trade_status IN ('open', 'win', 'loss', 'breakeven')),
  timing_quality TEXT NOT NULL CHECK (timing_quality IN ('source_reported', 'reconstructed', 'unknown')),
  duration_ms INTEGER,
  direct_facts_json TEXT NOT NULL,
  observation_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_observations_subject_unique
  ON intelligence_observations (subject_id, source_revision, evaluator_id, evaluator_version, type);
CREATE INDEX IF NOT EXISTS intelligence_observations_subject_status_idx
  ON intelligence_observations (subject_id, status);

CREATE TABLE IF NOT EXISTS observation_evidence (
  observation_id TEXT NOT NULL REFERENCES intelligence_observations(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  PRIMARY KEY (observation_id, revision_id)
);
CREATE INDEX IF NOT EXISTS observation_evidence_revision_idx ON observation_evidence (revision_id);

CREATE TABLE IF NOT EXISTS intelligence_seed_checkpoints (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'suppressed')),
  last_trade_key TEXT,
  baseline_operation_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/**
 * Migration 0004 — the observation storage and the seed checkpoint.
 *
 * Forward-only and additive: it creates new tables and never rewrites an
 * existing one, so a legacy journal and a fresh journal converge on the same
 * schema.
 */
export const observations: JournalMigrationSource = {
  version: 4,
  name: "observations",
  up(sqlite: Database.Database) {
    sqlite.exec(OBSERVATIONS_SQL);
  },
};
