import type Database from "better-sqlite3";
import type { JournalMigrationSource } from "../migrations.ts";

/**
 * The Phase 16 schema: the persistent workflow command/transition engine and
 * the intelligence-experience storage it drives.
 *
 * The same DDL is reused by the final-schema snapshot in `../bootstrap.ts`, so
 * a migrated journal and the declared schema cannot drift.
 *
 * Notes on the constraints:
 * - `intelligence_workflows` holds one row per running workflow: what the
 *   workflow is (definition key and version), which subject it acts on, where
 *   it is (status) and how far it has come (revision). `revision` and
 *   `definition_version` are positive because both are counters, never
 *   flags. `status` is a closed set so a workflow cannot end up in a state
 *   the engine does not know how to resume. `account_id` is null for the
 *   workflows that are not account-bound; it cascades from `accounts`, so
 *   deleting an account removes its workflows.
 * - `workflow_transitions` is the append-only audit of the workflow: every
 *   transition writes a row, `from_status` is null only for the first
 *   transition of a workflow, and the unique key over (workflow id, revision)
 *   makes a repeated transition a no-op. `action` is the closed set of
 *   commands the engine accepts.
 * - `interaction_commands` makes a command idempotent: the unique key over
 *   `command_id` means a retried command is answered from the stored result
 *   instead of being applied twice.
 * - `intelligence_opportunities` holds the things worth telling the user
 *   about. The unique key over `dedup_key` stops the same opportunity from
 *   being offered twice, and the status is a closed set so an offer cannot be
 *   silently forgotten.
 * - `intelligence_conversations` and `intelligence_messages` hold the
 *   dialogue that belongs to a subject. A message belongs to exactly one
 *   conversation and cascades with it.
 * - `workflow_conversations` links a workflow to a conversation; the pair is
 *   unique, so a workflow can never be attached to the same conversation
 *   twice.
 */
export const EXPERIENCE_SQL = `
CREATE TABLE IF NOT EXISTS intelligence_workflows (
  id TEXT PRIMARY KEY,
  definition_key TEXT NOT NULL,
  definition_version INTEGER NOT NULL CHECK (definition_version > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL CHECK (status IN ('running', 'waiting_for_user', 'scheduled', 'completed', 'cancelled', 'failed')),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  self_report_json TEXT,
  defer_until INTEGER,
  effect_revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_workflows_status_idx ON intelligence_workflows (status, updated_at);
CREATE INDEX IF NOT EXISTS intelligence_workflows_subject_idx ON intelligence_workflows (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS intelligence_workflows_account_idx ON intelligence_workflows (account_id);

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES intelligence_workflows(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('running', 'waiting_for_user', 'scheduled', 'completed', 'cancelled', 'failed')),
  to_status TEXT NOT NULL CHECK (to_status IN ('running', 'waiting_for_user', 'scheduled', 'completed', 'cancelled', 'failed')),
  action TEXT NOT NULL CHECK (action IN ('start', 'acknowledge', 'correct', 'defer', 'cancel', 'present')),
  command_id TEXT,
  payload_digest TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_transitions_workflow_revision_unique ON workflow_transitions (workflow_id, revision);
CREATE INDEX IF NOT EXISTS workflow_transitions_command_idx ON workflow_transitions (command_id);

CREATE TABLE IF NOT EXISTS interaction_commands (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES intelligence_workflows(id) ON DELETE CASCADE,
  payload_digest TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS interaction_commands_command_unique ON interaction_commands (command_id);

CREATE TABLE IF NOT EXISTS intelligence_opportunities (
  id TEXT PRIMARY KEY,
  dedup_key TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'eligible', 'delivered', 'dismissed', 'expired', 'suppressed')),
  eligible_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_opportunities_dedup_unique ON intelligence_opportunities (dedup_key);
CREATE INDEX IF NOT EXISTS intelligence_opportunities_eligibility_idx ON intelligence_opportunities (status, eligible_at);
CREATE INDEX IF NOT EXISTS intelligence_opportunities_expiry_idx ON intelligence_opportunities (expires_at);
CREATE INDEX IF NOT EXISTS intelligence_opportunities_account_idx ON intelligence_opportunities (account_id);

CREATE TABLE IF NOT EXISTS intelligence_conversations (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_conversations_account_idx ON intelligence_conversations (account_id);

CREATE TABLE IF NOT EXISTS intelligence_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES intelligence_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_messages_conversation_order_idx ON intelligence_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS workflow_conversations (
  workflow_id TEXT NOT NULL REFERENCES intelligence_workflows(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES intelligence_conversations(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_conversations_pair_unique ON workflow_conversations (workflow_id, conversation_id);
`;

/**
 * Migration 0007 — the intelligence-experience storage.
 *
 * Forward-only and additive: it creates new tables and never rewrites an
 * existing one, so a legacy journal and a fresh journal converge on the same
 * schema.
 */
export const intelligenceExperience: JournalMigrationSource = {
  version: 7,
  name: "intelligence-experience",
  up(sqlite: Database.Database) {
    sqlite.exec(EXPERIENCE_SQL);
  },
};
