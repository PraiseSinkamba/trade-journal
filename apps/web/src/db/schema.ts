import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const importSources = sqliteTable("import_sources", {
  id: text("id").primaryKey(),
  accountId: text("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});
export const importSourceAliases = sqliteTable(
  "import_source_aliases",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    aliasKey: text("alias_key").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => importSources.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("import_source_alias_unique").on(table.accountId, table.format, table.aliasKey),
  ],
);
export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    fingerprint: text("fingerprint").notNull(),
    rawHash: text("raw_hash").notNull(),
    timeZone: text("time_zone").notNull(),
    sourceIdsJson: text("source_ids_json").notNull(),
    fromTime: text("from_time").notNull(),
    toTime: text("to_time").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("import_batch_unique").on(table.accountId, table.format, table.fingerprint),
  ],
);

/** One journal account = one broker/platform's trades (TradeZella's model, kept). */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** SDK broker id for sync accounts; free text label otherwise. */
  broker: text("broker").notNull().default(""),
  kind: text("kind", { enum: ["sync", "import", "manual"] }).notNull(),
  currency: text("currency").notNull().default("USD"),
  initialBalance: real("initial_balance").notNull().default(0),
  profitCalcMethod: text("profit_calc_method", { enum: ["fifo", "lifo", "wavg"] })
    .notNull()
    .default("fifo"),
  /** AES-256-GCM envelope, present only for kind = "sync". */
  credentialsEnc: text("credentials_enc"),
  autoSync: integer("auto_sync", { mode: "boolean" }).notNull().default(false),
  lastSyncAt: text("last_sync_at"),
  /** Timezone used by corrected IBKR sync; null on legacy histories. Follows account transfers. */
  ibkrSyncTimeZone: text("ibkr_sync_time_zone"),
  /** Latest snapshot from sync, for display: { equity, positions } JSON. */
  snapshotJson: text("snapshot_json"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
});

export const executions = sqliteTable(
  "executions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    symbol: text("symbol").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    quantity: real("quantity").notNull(),
    price: real("price").notNull(),
    fee: real("fee").notNull().default(0),
    executedAt: text("executed_at").notNull(),
    assetClass: text("asset_class"),
    source: text("source", { enum: ["sync", "import", "manual"] }).notNull(),
    importMetadataJson: text("import_metadata_json"),
    /** Dedup key: identical fills are inserted once per account. */
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("executions_account_hash").on(table.accountId, table.contentHash),
    index("executions_account_symbol").on(table.accountId, table.symbol),
  ],
);

/**
 * Materialized round trips. Computed columns are overwritten on every rebuild;
 * annotation columns (notes → reviewedAt) belong to the user and survive
 * rebuilds because the row key is rebuild-stable.
 */
export const trades = sqliteTable(
  "trades",
  {
    key: text("key").primaryKey(),
    accountId: text("account_id").notNull(),
    symbol: text("symbol").notNull(),
    assetClass: text("asset_class"),
    direction: text("direction", { enum: ["long", "short"] }).notNull(),
    status: text("status", { enum: ["open", "win", "loss", "breakeven"] }).notNull(),
    openedAt: text("opened_at").notNull(),
    closedAt: text("closed_at"),
    quantity: real("quantity").notNull(),
    openQuantity: real("open_quantity").notNull(),
    avgEntry: real("avg_entry").notNull(),
    avgExit: real("avg_exit"),
    grossPnl: real("gross_pnl").notNull(),
    fees: real("fees").notNull(),
    netPnl: real("net_pnl").notNull(),
    executionCount: integer("execution_count").notNull(),
    executionIdsJson: text("execution_ids_json").notNull(),
    exitsJson: text("exits_json").notNull(),
    durationMs: integer("duration_ms"),
    // ---- annotations (user-owned, preserved across rebuilds) ----
    notes: text("notes"),
    tagsJson: text("tags_json"),
    mistakesJson: text("mistakes_json"),
    playbookId: text("playbook_id"),
    rating: integer("rating"),
    stopLoss: real("stop_loss"),
    profitTarget: real("profit_target"),
    reviewedAt: text("reviewed_at"),
  },
  (table) => [
    index("trades_account_closed").on(table.accountId, table.closedAt),
    index("trades_symbol").on(table.symbol),
    index("trades_opened").on(table.openedAt),
    index("trades_account_opened").on(table.accountId, table.openedAt),
  ],
);

export const journalDays = sqliteTable("journal_days", {
  /** "YYYY-MM-DD" in the journal's display timezone. */
  date: text("date").primaryKey(),
  note: text("note").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["system", "user"] })
    .notNull()
    .default("user"),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    folderId: text("folder_id").notNull(),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    tagsJson: text("tags_json"),
    /** Optional anchors back into the journal. */
    tradeKey: text("trade_key"),
    dayDate: text("day_date"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("notes_folder").on(table.folderId)],
);

export const playbooks = sqliteTable("playbooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** JSON array of rule strings — the checklist. */
  rulesJson: text("rules_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type").notNull(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
  createdAt: text("created_at").notNull(),
});
export const noteTemplates = sqliteTable("note_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  content: text("content").notNull(),
});
export const tradeRuleChecks = sqliteTable("trade_rule_checks", {
  id: text("id").primaryKey(),
  tradeKey: text("trade_key").notNull(),
  playbookId: text("playbook_id").notNull(),
  rule: text("rule").notNull(),
  followed: integer("followed", { mode: "boolean" }).notNull(),
});
export const progressRules = sqliteTable("progress_rules", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  stage: text("stage").notNull(),
  weekdaysJson: text("weekdays_json").notNull(),
  createdAt: text("created_at").notNull(),
  archivedAt: text("archived_at"),
});
export const progressChecks = sqliteTable("progress_checks", {
  id: text("id").primaryKey(),
  ruleId: text("rule_id").notNull(),
  date: text("date").notNull(),
  done: integer("done", { mode: "boolean" }).notNull(),
});
export const missedTrades = sqliteTable("missed_trades", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  observedAt: text("observed_at").notNull(),
  playbookId: text("playbook_id"),
  entry: real("entry"),
  stop: real("stop"),
  target: real("target"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  archivedAt: text("archived_at"),
});

/** Derived market-data estimates; journal fills remain authoritative. */
export const tradeExcursions = sqliteTable("trade_excursions", {
  tradeKey: text("trade_key")
    .primaryKey()
    .references(() => trades.key, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  provider: text("provider").notNull(),
  symbol: text("symbol").notNull(),
  resolution: text("resolution").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  estimateJson: text("estimate_json").notNull(),
});

/** User-supplied market candles, separate from execution imports and journal exports. */
export const marketCsvDatasets = sqliteTable("market_csv_datasets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  resolution: text("resolution").notNull(),
  currency: text("currency").notNull(),
  priceBasis: text("price_basis").notNull(),
  barsJson: text("bars_json").notNull(),
  barCount: integer("bar_count").notNull(),
  firstTime: integer("first_time").notNull(),
  lastTime: integer("last_time").notNull(),
  importedAt: text("imported_at").notNull(),
});

/** User-maintained prop account attempts and actual cash flows, never journal P&L. */
export const propAccounts = sqliteTable("prop_accounts", {
  id: text("id").primaryKey(),
  firm: text("firm").notNull(),
  name: text("name").notNull(),
  program: text("program").notNull(),
  status: text("status").notNull(),
  currency: text("currency").notNull(),
  sizeMinor: integer("size_minor"),
  parentId: text("parent_id").references((): AnySQLiteColumn => propAccounts.id),
  journalAccountId: text("journal_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  openedOn: text("opened_on").notNull(),
  closedOn: text("closed_on"),
  renewalOn: text("renewal_on"),
  renewalMinor: integer("renewal_minor"),
  notes: text("notes").notNull().default(""),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const propEntries = sqliteTable(
  "prop_entries",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => propAccounts.id),
    firm: text("firm").notNull(),
    kind: text("kind").notNull(),
    category: text("category").notNull(),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    splitBps: integer("split_bps").notNull(),
    feeMinor: integer("fee_minor").notNull(),
    occurredOn: text("occurred_on").notNull(),
    dueOn: text("due_on"),
    status: text("status").notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => propEntries.id),
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    voided: integer("voided", { mode: "boolean" }).notNull().default(false),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("prop_entries_account_date").on(table.accountId, table.occurredOn),
    index("prop_entries_date").on(table.occurredOn),
  ],
);
export const propReceipts = sqliteTable(
  "prop_receipts",
  {
    id: text("id").primaryKey(),
    payoutId: text("payout_id")
      .notNull()
      .references(() => propEntries.id),
    kind: text("kind").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    occurredOn: text("occurred_on").notNull(),
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    voided: integer("voided", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("prop_receipts_payout").on(table.payoutId)],
);
export const propAudit = sqliteTable(
  "prop_audit",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("prop_audit_entity").on(table.entityType, table.entityId)],
);

/**
 * Applied migration ledger. The runner in `./migrations.ts` owns this table;
 * the mirror exists for typed access. The `CHECK (version > 0)` constraint lives
 * in the runner's DDL, not here.
 */
export const journalMigrations = sqliteTable("journal_migrations", {
  version: integer("version").primaryKey(),
  name: text("name").notNull(),
  checksum: text("checksum").notNull(),
  appliedAt: integer("applied_at").notNull(),
});

/**
 * Immutable trade identities (Phase 03).
 *
 * A trade keeps its derived key, but its identity is separate: the key may
 * change, the identity may be transferred, and a removed key that reappears
 * gets a new identity so old conclusions never revive silently. `currentKey`
 * is released on retirement, which is what makes the unique index below an
 * index over *active* mappings.
 */
export const tradeIdentities = sqliteTable(
  "trade_identities",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    currentKey: text("current_key"),
    revision: integer("revision").notNull().default(0),
    state: text("state", { enum: ["active", "tombstoned"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("trade_identities_current_key_unique")
      .on(table.currentKey)
      .where(sql`current_key IS NOT NULL`),
    index("trade_identities_account_idx").on(table.accountId),
  ],
);

/**
 * Append-only projection revisions (Phase 03).
 *
 * One row per recorded revision of a trade: the fingerprint of the computed
 * projection, the bounded factual snapshot it was computed from, and the
 * identity resolution that produced it. Rows are never updated.
 */
export const tradeProjectionRevisions = sqliteTable(
  "trade_projection_revisions",
  {
    id: text("id").primaryKey(),
    tradeId: text("trade_id")
      .notNull()
      .references(() => tradeIdentities.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    tradeKey: text("trade_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    resolution: text("resolution", {
      enum: ["exact_key", "explicit_transfer", "new", "ambiguous"],
    }).notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    recordedAt: integer("recorded_at").notNull(),
  },
  (table) => [
    uniqueIndex("trade_projection_revisions_trade_revision_unique").on(
      table.tradeId,
      table.revision,
    ),
    index("trade_projection_revisions_account_idx").on(table.accountId),
  ],
);

/**
 * The execution membership of a revision (Phase 03).
 *
 * Normalized rows rather than a JSON array, and deliberately without a foreign
 * key to `executions`: membership evidence must survive the deletion of the
 * source fills until an explicit purge.
 */
export const tradeRevisionExecutions = sqliteTable(
  "trade_revision_executions",
  {
    revisionId: text("revision_id")
      .notNull()
      .references(() => tradeProjectionRevisions.id, { onDelete: "cascade" }),
    executionId: text("execution_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.executionId] }),
    index("trade_revision_executions_execution_idx").on(table.executionId),
  ],
);

/**
 * Provenance between identities (Phase 03): an explicit transfer, or the
 * supersession of a retired identity by a new one.
 */
export const tradeIdentityLinks = sqliteTable(
  "trade_identity_links",
  {
    oldId: text("old_id")
      .notNull()
      .references(() => tradeIdentities.id, { onDelete: "cascade" }),
    newId: text("new_id")
      .notNull()
      .references(() => tradeIdentities.id, { onDelete: "cascade" }),
    operationId: text("operation_id").notNull(),
    reason: text("reason", { enum: ["superseded", "ambiguous"] }).notNull(),
    recordedAt: integer("recorded_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.oldId, table.newId, table.operationId] }),
    index("trade_identity_links_new_idx").on(table.newId),
  ],
);

/**
 * Source quality of a single execution (Phase 03).
 *
 * Kept apart from the execution itself: it records what the source could
 * prove about a fill without changing its hash or its import metadata.
 */
export const executionEvidence = sqliteTable("execution_evidence", {
  executionId: text("execution_id").primaryKey(),
  timingQuality: text("timing_quality", {
    enum: ["source_reported", "reconstructed", "unknown"],
  }).notNull(),
  sourceKind: text("source_kind").notNull(),
  evidenceVersion: integer("evidence_version").notNull().default(1),
  recordedAt: integer("recorded_at").notNull(),
});

/**
 * The transactional outbox (Phase 04).
 *
 * A committed domain event, written in the same transaction as the change that
 * caused it. The unique key over the aggregate revision and the event type is
 * what makes the append idempotent: one aggregate revision never produces two
 * events.
 */
export const domainOutbox = sqliteTable(
  "domain_outbox",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    aggregateRevision: integer("aggregate_revision").notNull(),
    correlationId: text("correlation_id").notNull(),
    causationId: text("causation_id"),
    origin: text("origin", {
      enum: ["user", "broker_sync", "import", "system", "workflow"],
    }).notNull(),
    accountId: text("account_id"),
    payloadJson: text("payload_json").notNull(),
    recordedAt: integer("recorded_at").notNull(),
    occurredAt: integer("occurred_at"),
    dispatchedAt: integer("dispatched_at"),
  },
  (table) => [
    uniqueIndex("domain_outbox_aggregate_unique").on(
      table.aggregateType,
      table.aggregateId,
      table.aggregateRevision,
      table.type,
    ),
    index("domain_outbox_dispatch_idx").on(table.dispatchedAt, table.recordedAt, table.id),
    index("domain_outbox_account_idx").on(table.accountId),
  ],
);

/**
 * Durable jobs (Phase 04).
 *
 * A job carries the ownership of a claim: the owner, the fence (the claim
 * generation) and the lease expiry. The unique idempotency key is what makes a
 * repeated fanout safe.
 */
export const intelligenceJobs = sqliteTable(
  "intelligence_jobs",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status", {
      enum: ["pending", "running", "completed", "retry_wait", "failed", "cancelled"],
    }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: integer("available_at").notNull(),
    owner: text("owner"),
    fence: integer("fence").notNull().default(0),
    leaseUntil: integer("lease_until"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("intelligence_jobs_idempotency_unique").on(table.idempotencyKey),
    index("intelligence_jobs_status_available_idx").on(table.status, table.availableAt, table.id),
    index("intelligence_jobs_status_lease_idx").on(table.status, table.leaseUntil),
  ],
);

/**
 * Per-handler deliveries (Phase 04).
 *
 * One row per (event, handler, handler version): the delivery key. It carries
 * the job the delivery produced, so a terminal failure stays inspectable even
 * after the job is pruned.
 */
export const eventDeliveries = sqliteTable(
  "event_deliveries",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => domainOutbox.id, { onDelete: "cascade" }),
    handlerId: text("handler_id").notNull(),
    handlerVersion: text("handler_version").notNull(),
    state: text("state", {
      enum: ["pending", "delivered", "failed", "cancelled"],
    }).notNull(),
    jobId: text("job_id").references(() => intelligenceJobs.id, { onDelete: "set null" }),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.handlerId, table.handlerVersion] }),
    index("event_deliveries_job_idx").on(table.jobId),
  ],
);

/**
 * The journal's worker lease (Phase 04).
 *
 * Exactly one row, named by the check constraint: one worker per journal, even
 * after an accidental double launch. The fence increments on every takeover, so
 * a worker that lost the lease cannot renew it.
 */
export const intelligenceWorkerLease = sqliteTable("intelligence_worker_lease", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  fence: integer("fence").notNull().default(0),
  leaseUntil: integer("lease_until").notNull(),
  heartbeatAt: integer("heartbeat_at").notNull(),
});

/**
 * Factual observations (Phase 08).
 *
 * One derived statement about a trade. The unique key over the subject, the
 * source revision, the evaluator and the type is what makes a repeated
 * delivery idempotent: the same delivery writes the same observation, never a
 * second one. The subject carries no foreign key on purpose — an observation
 * outlives the identity it observed, the way the execution membership does.
 */
export const intelligenceObservations = sqliteTable(
  "intelligence_observations",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id").notNull(),
    sourceRevision: text("source_revision").notNull(),
    evaluatorId: text("evaluator_id").notNull(),
    evaluatorVersion: text("evaluator_version").notNull(),
    type: text("type").notNull(),
    status: text("status", { enum: ["active", "superseded", "invalidated"] }).notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    netPnl: real("net_pnl").notNull(),
    fees: real("fees").notNull(),
    tradeStatus: text("trade_status", {
      enum: ["open", "win", "loss", "breakeven"],
    }).notNull(),
    timingQuality: text("timing_quality", {
      enum: ["source_reported", "reconstructed", "unknown"],
    }).notNull(),
    durationMs: integer("duration_ms"),
    /** The direct fact: the projection revision's snapshot, verbatim. */
    directFactsJson: text("direct_facts_json").notNull(),
    /** The derived observation: what the evaluator concluded. */
    observationJson: text("observation_json").notNull(),
    recordedAt: integer("recorded_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("intelligence_observations_subject_unique").on(
      table.subjectId,
      table.sourceRevision,
      table.evaluatorId,
      table.evaluatorVersion,
      table.type,
    ),
    index("intelligence_observations_subject_status_idx").on(table.subjectId, table.status),
  ],
);

/**
 * The evidence links of an observation (Phase 08).
 *
 * One row per projection revision an observation was derived from. The primary
 * key makes the link idempotent, so a repeated delivery writes one link.
 */
export const observationEvidence = sqliteTable(
  "observation_evidence",
  {
    observationId: text("observation_id")
      .notNull()
      .references(() => intelligenceObservations.id, { onDelete: "cascade" }),
    revisionId: text("revision_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.observationId, table.revisionId] }),
    index("observation_evidence_revision_idx").on(table.revisionId),
  ],
);

/**
 * The historical seed checkpoint of an account (Phase 08).
 *
 * Created with the phase allocation; the historical seed phase writes it. The
 * account cascades, so deleting an account removes its checkpoint with it.
 */
export const intelligenceSeedCheckpoints = sqliteTable("intelligence_seed_checkpoints", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["pending", "running", "completed", "suppressed"],
  }).notNull(),
  lastTradeKey: text("last_trade_key"),
  baselineOperationId: text("baseline_operation_id").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * The background run ledger (Phase 13).
 *
 * One row per queued background run. The unique effect key makes the enqueue
 * idempotent, and the pinned provider, model and endpoint fingerprint record
 * what the run was approved against: a later configuration change cannot
 * silently reroute it.
 */
export const intelligenceRuns = sqliteTable(
  "intelligence_runs",
  {
    id: text("id").primaryKey(),
    /** The idempotency key of the run: the same effect is queued once. */
    effectKey: text("effect_key").notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "cancelled", "unavailable"],
    }).notNull(),
    /** The provider the run was approved against. */
    provider: text("provider").notNull(),
    /** The model the run was approved against. */
    model: text("model").notNull(),
    /** The fingerprint of the approved provider, model and endpoint. */
    endpointFingerprint: text("endpoint_fingerprint").notNull(),
    /** The policy revision the run was approved under. */
    policyRevision: integer("policy_revision").notNull(),
    /** The authorised scope: concrete account ids, filters, timezone, sources. */
    scopeJson: text("scope_json").notNull(),
    /** Sanitized diagnostics. Never a prompt, a response or a credential. */
    metaJson: text("meta_json").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("intelligence_runs_effect_key_unique").on(table.effectKey),
    index("intelligence_runs_status_idx").on(table.status, table.createdAt),
  ],
);

/**
 * The revisioned background policy (Phase 13).
 *
 * One immutable row per revision of a policy. A run pins the revision it was
 * approved under, so a later policy change never applies retroactively.
 */
export const intelligencePolicy = sqliteTable(
  "intelligence_policy",
  {
    /** The policy key; the background policy uses the constant key. */
    id: text("id").notNull(),
    /** The revision of the policy. */
    revision: integer("revision").notNull(),
    /** The policy document, verbatim. */
    settingsJson: text("settings_json").notNull(),
    recordedAt: integer("recorded_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.id, table.revision] })],
);

/**
 * The daily background attempt reservations (Phase 13).
 *
 * One row per reserved attempt. The primary key over (run, attempt) makes a
 * reservation idempotent, and the day index makes the daily allowance a cheap
 * lookup. A reservation is never deleted: a crashed attempt keeps it.
 */
export const intelligenceBudgetReservations = sqliteTable(
  "intelligence_budget_reservations",
  {
    runId: text("run_id")
      .notNull()
      .references(() => intelligenceRuns.id, { onDelete: "cascade" }),
    /** The attempt number of the run. */
    attempt: integer("attempt").notNull(),
    /** The UTC day the attempt was reserved for. */
    day: integer("day").notNull(),
    reservedAt: integer("reserved_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.attempt] }),
    index("intelligence_budget_reservations_day_idx").on(table.day),
  ],
);

/**
 * The versioned source register (Phase 14).
 *
 * One row per revision of a user-authored source: an annotation, a rule
 * check, a playbook, a journal day note or a note. The row records that the
 * user wrote the source at that revision — never the words themselves, which
 * stay in the journal's own tables.
 *
 * The unique key over (kind, source id, revision) makes a repeated change a
 * no-op, and the account cascades: deleting an account removes the sources
 * that belong to it and keeps the shared ones.
 */
export const knowledgeSources = sqliteTable(
  "knowledge_sources",
  {
    id: text("id").primaryKey(),
    /** The kind of the source. */
    kind: text("kind", {
      enum: ["annotation", "rule_check", "playbook", "journal", "note"],
    }).notNull(),
    /** The identity of the source inside its kind. */
    sourceId: text("source_id").notNull(),
    /** The knowledge revision of that source. */
    revision: integer("revision").notNull(),
    /** The account the source belongs to; null for the shared sources. */
    accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "superseded", "invalidated"] }).notNull(),
    /** The request that produced the change. */
    correlationId: text("correlation_id").notNull(),
    recordedAt: integer("recorded_at").notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_sources_kind_revision_unique").on(
      table.kind,
      table.sourceId,
      table.revision,
    ),
    index("knowledge_sources_kind_source_status_idx").on(table.kind, table.sourceId, table.status),
    index("knowledge_sources_account_idx").on(table.accountId),
  ],
);

/**
 * The derived hypotheses (Phase 14).
 *
 * A hypothesis is a tentative interpretation. Each row names the source
 * revision it was derived from, so a source correction can find it, and the
 * unique key over the subject and the version keeps the versions apart.
 */
export const knowledgeHypotheses = sqliteTable(
  "knowledge_hypotheses",
  {
    id: text("id").primaryKey(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    /** The version of this finding for its subject. */
    version: integer("version").notNull(),
    status: text("status", {
      enum: ["active", "stale", "pending", "superseded", "invalidated"],
    }).notNull(),
    /** The schema version of the stored payload. */
    payloadSchemaVersion: integer("payload_schema_version").notNull().default(1),
    /** What was concluded, verbatim. */
    payloadJson: text("payload_json").notNull(),
    /** The evidence the conclusion rests on. */
    evidenceIdsJson: text("evidence_ids_json").notNull(),
    /** The evaluator that produced it; null for a self-reported hypothesis. */
    evaluatorId: text("evaluator_id"),
    evaluatorVersion: text("evaluator_version"),
    sourceKind: text("source_kind", {
      enum: ["annotation", "rule_check", "playbook", "journal", "note"],
    }).notNull(),
    sourceId: text("source_id").notNull(),
    /** The source revision this finding was derived from. */
    sourceRevision: integer("source_revision").notNull(),
    accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_hypotheses_subject_version_unique").on(
      table.subjectType,
      table.subjectId,
      table.version,
    ),
    index("knowledge_hypotheses_source_status_idx").on(
      table.sourceKind,
      table.sourceId,
      table.accountId,
      table.status,
    ),
    index("knowledge_hypotheses_account_status_idx").on(table.accountId, table.status),
  ],
);

/**
 * The derived patterns (Phase 14).
 *
 * A pattern is the result of a pattern evaluation, so it always names its
 * evaluator and records whether the evidence was sufficient: an
 * insufficient-evidence pattern is written down, never guessed into a
 * finding.
 */
export const knowledgePatterns = sqliteTable(
  "knowledge_patterns",
  {
    id: text("id").primaryKey(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    /** The version of this pattern for its subject. */
    version: integer("version").notNull(),
    status: text("status", {
      enum: ["active", "stale", "pending", "superseded", "invalidated"],
    }).notNull(),
    /** The schema version of the stored payload. */
    payloadSchemaVersion: integer("payload_schema_version").notNull().default(1),
    /** What was concluded, verbatim. */
    payloadJson: text("payload_json").notNull(),
    /** The evidence the conclusion rests on. */
    evidenceIdsJson: text("evidence_ids_json").notNull(),
    /** The evaluator that produced the pattern; null while it is pending. */
    evaluatorId: text("evaluator_id"),
    evaluatorVersion: text("evaluator_version"),
    /** Whether the evaluation had enough evidence; null while it is pending. */
    evaluationState: text("evaluation_state", {
      enum: ["evaluated", "insufficient_evidence"],
    }),
    requiredEvidence: integer("required_evidence"),
    availableEvidence: integer("available_evidence"),
    sourceKind: text("source_kind", {
      enum: ["annotation", "rule_check", "playbook", "journal", "note"],
    }).notNull(),
    sourceId: text("source_id").notNull(),
    /** The source revision this pattern was derived from. */
    sourceRevision: integer("source_revision").notNull(),
    accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_patterns_subject_version_unique").on(
      table.subjectType,
      table.subjectId,
      table.version,
    ),
    index("knowledge_patterns_source_status_idx").on(
      table.sourceKind,
      table.sourceId,
      table.accountId,
      table.status,
    ),
    index("knowledge_patterns_account_status_idx").on(table.accountId, table.status),
  ],
);

/**
 * The durable schedules (Phase 14, schema only).
 *
 * The table is created here; the scheduler that drives it belongs to
 * Phase 15. `definition_version` is the version its jobs are keyed by, and
 * `checkpoint_json` is the durable cursor a condition schedule consumes.
 */
export const intelligenceSchedules = sqliteTable(
  "intelligence_schedules",
  {
    id: text("id").primaryKey(),
    /** The version of the schedule definition. */
    definitionVersion: integer("definition_version").notNull(),
    /** The next instant the schedule is due, in epoch milliseconds. */
    nextDueAt: integer("next_due_at").notNull(),
    /** The durable checkpoint of a condition schedule. */
    checkpointJson: text("checkpoint_json"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("intelligence_schedules_next_due_idx").on(table.nextDueAt)],
);

/**
 * The workflows (Phase 16).
 *
 * One row per workflow the engine drives: what the workflow is (definition
 * key and version), which subject it acts on, where it is (status) and how
 * far it has come (revision). `revision` and `definition_version` are
 * positive counters. `account_id` is null for the workflows that are not
 * account-bound; it cascades from `accounts`.
 */
export const intelligenceWorkflows = sqliteTable(
  "intelligence_workflows",
  {
    id: text("id").primaryKey(),
    /** The key of the workflow definition. */
    definitionKey: text("definition_key").notNull(),
    /** The version of the workflow definition. */
    definitionVersion: integer("definition_version").notNull(),
    /** The revision of the workflow state. */
    revision: integer("revision").notNull(),
    status: text("status", {
      enum: ["running", "waiting_for_user", "scheduled", "completed", "cancelled", "failed"],
    }).notNull(),
    /** The kind of the subject the workflow acts on. */
    subjectType: text("subject_type").notNull(),
    /** The identity of the subject the workflow acts on. */
    subjectId: text("subject_id").notNull(),
    /** The account the workflow belongs to; null when it is not account-bound. */
    accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    /** The evidence the workflow rests on. */
    evidenceIdsJson: text("evidence_ids_json").notNull().default("[]"),
    /** What the workflow reported about itself, verbatim. */
    selfReportJson: text("self_report_json"),
    /** The instant the workflow is deferred until, in epoch milliseconds. */
    deferUntil: integer("defer_until"),
    /** The revision of the effect the workflow produced. */
    effectRevision: integer("effect_revision").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("intelligence_workflows_status_idx").on(table.status, table.updatedAt),
    index("intelligence_workflows_subject_idx").on(table.subjectType, table.subjectId),
    index("intelligence_workflows_account_idx").on(table.accountId),
  ],
);

/**
 * The workflow transitions (Phase 16).
 *
 * The append-only audit of a workflow: every transition writes a row.
 * `from_status` is null only for the first transition of a workflow, and the
 * unique key over (workflow id, revision) makes a repeated transition a
 * no-op. `action` is the closed set of commands the engine accepts.
 */
export const workflowTransitions = sqliteTable(
  "workflow_transitions",
  {
    id: text("id").primaryKey(),
    /** The workflow the transition belongs to. */
    workflowId: text("workflow_id")
      .notNull()
      .references(() => intelligenceWorkflows.id, { onDelete: "cascade" }),
    /** The revision the workflow reached with this transition. */
    revision: integer("revision").notNull(),
    /** The status the workflow left; null for the first transition. */
    fromStatus: text("from_status", {
      enum: ["running", "waiting_for_user", "scheduled", "completed", "cancelled", "failed"],
    }),
    /** The status the workflow reached. */
    toStatus: text("to_status", {
      enum: ["running", "waiting_for_user", "scheduled", "completed", "cancelled", "failed"],
    }).notNull(),
    /** The command that caused the transition. */
    action: text("action", {
      enum: ["start", "acknowledge", "correct", "defer", "cancel", "present"],
    }).notNull(),
    /** The command that caused the transition, when it was one. */
    commandId: text("command_id"),
    /** The digest of the command payload. */
    payloadDigest: text("payload_digest"),
    /** The command payload, verbatim. */
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workflow_transitions_workflow_revision_unique").on(
      table.workflowId,
      table.revision,
    ),
    index("workflow_transitions_command_idx").on(table.commandId),
  ],
);

/**
 * The interaction commands (Phase 16).
 *
 * The idempotency ledger: the unique key over `command_id` means a retried
 * command is answered from the stored result instead of being applied twice.
 */
export const interactionCommands = sqliteTable(
  "interaction_commands",
  {
    id: text("id").primaryKey(),
    /** The identifier of the command; unique across the journal. */
    commandId: text("command_id").notNull(),
    /** The workflow the command was applied to. */
    workflowId: text("workflow_id")
      .notNull()
      .references(() => intelligenceWorkflows.id, { onDelete: "cascade" }),
    /** The digest of the command payload. */
    payloadDigest: text("payload_digest").notNull(),
    /** The result of the command, verbatim. */
    resultJson: text("result_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("interaction_commands_command_unique").on(table.commandId)],
);

/**
 * The opportunities (Phase 16).
 *
 * The things worth telling the user about. The unique key over `dedup_key`
 * stops the same opportunity from being offered twice, and the status is a
 * closed set so an offer cannot be silently forgotten.
 */
export const intelligenceOpportunities = sqliteTable(
  "intelligence_opportunities",
  {
    id: text("id").primaryKey(),
    /** The deduplication key of the opportunity. */
    dedupKey: text("dedup_key").notNull(),
    /** The kind of the subject the opportunity is about. */
    subjectType: text("subject_type").notNull(),
    /** The identity of the subject the opportunity is about. */
    subjectId: text("subject_id").notNull(),
    /** The account the opportunity belongs to; null when it is not account-bound. */
    accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "eligible", "delivered", "dismissed", "expired", "suppressed"],
    }).notNull(),
    /** The instant the opportunity becomes eligible, in epoch milliseconds. */
    eligibleAt: integer("eligible_at").notNull(),
    /** The instant the opportunity expires, in epoch milliseconds. */
    expiresAt: integer("expires_at").notNull(),
    /** The evidence the opportunity rests on. */
    evidenceIdsJson: text("evidence_ids_json").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("intelligence_opportunities_dedup_unique").on(table.dedupKey),
    index("intelligence_opportunities_eligibility_idx").on(table.status, table.eligibleAt),
    index("intelligence_opportunities_expiry_idx").on(table.expiresAt),
    index("intelligence_opportunities_account_idx").on(table.accountId),
  ],
);

/**
 * The conversations (Phase 16).
 *
 * The dialogue that belongs to a subject. `status` is a closed set so an
 * open conversation cannot be mistaken for a closed one.
 */
export const intelligenceConversations = sqliteTable(
  "intelligence_conversations",
  {
    id: text("id").primaryKey(),
    /** The kind of the subject the conversation is about. */
    subjectType: text("subject_type").notNull(),
    /** The identity of the subject the conversation is about. */
    subjectId: text("subject_id").notNull(),
    /** The account the conversation belongs to; null when it is not account-bound. */
    accountId: text("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["open", "closed"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("intelligence_conversations_account_idx").on(table.accountId)],
);

/**
 * The messages (Phase 16).
 *
 * A message belongs to exactly one conversation and cascades with it.
 */
export const intelligenceMessages = sqliteTable(
  "intelligence_messages",
  {
    id: text("id").primaryKey(),
    /** The conversation the message belongs to. */
    conversationId: text("conversation_id")
      .notNull()
      .references(() => intelligenceConversations.id, { onDelete: "cascade" }),
    /** Who wrote the message. */
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    /** The message, verbatim. */
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("intelligence_messages_conversation_order_idx").on(table.conversationId, table.createdAt),
  ],
);

/**
 * The workflow-to-conversation links (Phase 16).
 *
 * A workflow is attached to a conversation at most once: the named unique
 * index over the pair states that rule.
 */
export const workflowConversations = sqliteTable(
  "workflow_conversations",
  {
    /** The workflow the link belongs to. */
    workflowId: text("workflow_id")
      .notNull()
      .references(() => intelligenceWorkflows.id, { onDelete: "cascade" }),
    /** The conversation the link belongs to. */
    conversationId: text("conversation_id")
      .notNull()
      .references(() => intelligenceConversations.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workflow_conversations_pair_unique").on(table.workflowId, table.conversationId),
  ],
);
