import type Database from "better-sqlite3";
import type { JournalMigrationSource } from "../migrations.ts";

/**
 * The Phase 14 schema: the versioned source register, the derived findings
 * that depend on it, and the schedule table Phase 15 will drive.
 *
 * The same DDL is reused by the final-schema snapshot in `../bootstrap.ts`, so
 * a migrated journal and the declared schema cannot drift.
 *
 * Notes on the constraints:
 * - `knowledge_sources` records that the user wrote, changed or removed a
 *   source at a revision. It never stores the user's words: those stay in the
 *   journal's own tables. The unique key over (kind, source id, revision)
 *   makes a repeated change a no-op.
 * - `knowledge_hypotheses` and `knowledge_patterns` hold the derived
 *   findings. Each row names the source revision it was derived from, so an
 *   invalidation can find it, and each row is versioned per subject.
 * - A pattern that has not been evaluated yet carries no evaluator: a pending
 *   re-evaluation request is a question, not a conclusion.
 * - `account_id` is null for the shared sources (journal day notes, notes and
 *   playbooks). It cascades from `accounts`, so deleting an account removes
 *   the knowledge that belongs to it and keeps the shared knowledge.
 * - `intelligence_schedules` is created here and written by nobody yet: the
 *   scheduler behaviour belongs to Phase 15.
 */
export const KNOWLEDGE_SCHEDULING_SQL = `
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('annotation', 'rule_check', 'playbook', 'journal', 'note')),
  source_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'invalidated')),
  correlation_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_kind_revision_unique
  ON knowledge_sources (kind, source_id, revision);
CREATE INDEX IF NOT EXISTS knowledge_sources_kind_source_status_idx
  ON knowledge_sources (kind, source_id, status);
CREATE INDEX IF NOT EXISTS knowledge_sources_account_idx
  ON knowledge_sources (account_id);

CREATE TABLE IF NOT EXISTS knowledge_hypotheses (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'pending', 'superseded', 'invalidated')),
  payload_schema_version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  evaluator_id TEXT,
  evaluator_version TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('annotation', 'rule_check', 'playbook', 'journal', 'note')),
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_hypotheses_subject_version_unique
  ON knowledge_hypotheses (subject_type, subject_id, version);
CREATE INDEX IF NOT EXISTS knowledge_hypotheses_source_status_idx
  ON knowledge_hypotheses (source_kind, source_id, account_id, status);
CREATE INDEX IF NOT EXISTS knowledge_hypotheses_account_status_idx
  ON knowledge_hypotheses (account_id, status);

CREATE TABLE IF NOT EXISTS knowledge_patterns (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'pending', 'superseded', 'invalidated')),
  payload_schema_version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  evaluator_id TEXT,
  evaluator_version TEXT,
  evaluation_state TEXT CHECK (evaluation_state IS NULL OR evaluation_state IN ('evaluated', 'insufficient_evidence')),
  required_evidence INTEGER CHECK (required_evidence IS NULL OR required_evidence >= 0),
  available_evidence INTEGER CHECK (available_evidence IS NULL OR available_evidence >= 0),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('annotation', 'rule_check', 'playbook', 'journal', 'note')),
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_patterns_subject_version_unique
  ON knowledge_patterns (subject_type, subject_id, version);
CREATE INDEX IF NOT EXISTS knowledge_patterns_source_status_idx
  ON knowledge_patterns (source_kind, source_id, account_id, status);
CREATE INDEX IF NOT EXISTS knowledge_patterns_account_status_idx
  ON knowledge_patterns (account_id, status);

CREATE TABLE IF NOT EXISTS intelligence_schedules (
  id TEXT PRIMARY KEY,
  definition_version INTEGER NOT NULL CHECK (definition_version > 0),
  next_due_at INTEGER NOT NULL,
  checkpoint_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_schedules_next_due_idx
  ON intelligence_schedules (next_due_at);
`;

/**
 * Migration 0006 — the knowledge and scheduling storage.
 *
 * Forward-only and additive: it creates new tables and never rewrites an
 * existing one, so a legacy journal and a fresh journal converge on the same
 * schema.
 */
export const knowledgeScheduling: JournalMigrationSource = {
  version: 6,
  name: "knowledge-scheduling",
  up(sqlite: Database.Database) {
    sqlite.exec(KNOWLEDGE_SCHEDULING_SQL);
  },
};
