import { and, eq, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  accounts,
  domainOutbox,
  eventDeliveries,
  executionEvidence,
  executions,
  intelligenceConversations,
  intelligenceJobs,
  intelligenceObservations,
  intelligenceOpportunities,
  intelligenceRuns,
  intelligenceSeedCheckpoints,
  intelligenceWorkflows,
  knowledgeHypotheses,
  knowledgePatterns,
  knowledgeSources,
  trades,
} from "@/db/schema";
import { dataDir, db, openConnection } from "@/db/connection";
import { checkJournalFile, copyJournalFile, readJournalFileFacts } from "@/db/journal-file";
import {
  withConnectionTransaction,
  withJournalTransaction,
  type JournalTx,
} from "@/db/transaction";
import { newUuid } from "@/server/ids";
import { decryptJson } from "@/server/crypto";
import { deleteAccountExecutionsInTx } from "@/server/executions";
import { liveReferenceIndex } from "./experience-store";
import { createJobStore, deleteTerminalJobsForEventInTx } from "./jobs";
import { pruneKnowledgeInTx, pruneObservationsInTx } from "./knowledge-store";

/**
 * The retention, deletion and backup layer (Phase 20).
 *
 * Three jobs live here, and they answer three different questions:
 *
 * - **retention**: what may the journal forget? Only what is finished and
 *   unreferenced. A live workflow, a pending opportunity, an open conversation
 *   or an unacknowledged failure keeps the row it points at alive.
 * - **deletion**: what must go with an account? Everything the account owns,
 *   including the rows no foreign key reaches, and a ledger that survives the
 *   database so a restore cannot bring the account back.
 * - **backup**: what does the operator take away? A consistent snapshot of the
 *   journal plus the key material that can read it, taken only from a journal
 *   the operator has stopped writing to.
 *
 * The module owns no policy of its own: the windows and the terminal sets come
 * from the contract review (section 6), and every decision below is a
 * mechanical reading of the schema.
 */

/** SQLite's bind-parameter limit. Every statement below stays under it. */
const ID_CHUNK = 500;

/** Runs `fn` over `ids` in chunks that stay below SQLite's bind limit. */
const eachChunk = (ids: readonly string[], fn: (chunk: string[]) => void): void => {
  for (let i = 0; i < ids.length; i += ID_CHUNK) fn(ids.slice(i, i + ID_CHUNK));
};

/** The file the deletion ledger is written to, beside the database. */
export const PURGE_LEDGER_FILE = "purge-ledger.json";

/** The retention window of the transport and the diagnostics classes: 30 days. */
export const RETENTION_WINDOW_MS = 30 * 86_400_000;

/** The retention window of the knowledge class: 90 days. */
export const KNOWLEDGE_RETENTION_WINDOW_MS = 90 * 86_400_000;

/** The largest number of rows one retention run may remove. */
export const RETENTION_PRUNE_LIMIT = 500;

/** The name of the journal's single worker lease. */
const WORKER_LEASE_NAME = "journal-worker";

/** What kind of purge the ledger recorded for an account. */
export type PurgeKind = "deleted" | "reset";

/** One entry of the deletion ledger. */
export interface PurgeLedgerEntry {
  readonly accountId: string;
  readonly kind: PurgeKind;
}

/* ---------------------------------------------------------------------------
 * The deletion ledger.
 * ------------------------------------------------------------------------ */

/**
 * Reads one ledger entry out of an untrusted value.
 *
 * The ledger is written by this module and read back from a file, so its shape
 * is checked rather than assumed: an entry that does not name an account and a
 * kind is not an entry.
 */
const ledgerEntryOf = (value: unknown): PurgeLedgerEntry | null => {
  if (typeof value !== "object" || value === null) return null;
  if (!("accountId" in value) || !("kind" in value)) return null;
  const { accountId, kind } = value as { accountId: unknown; kind: unknown };
  if (typeof accountId !== "string" || accountId.length === 0) return null;
  if (kind !== "deleted" && kind !== "reset") return null;
  return { accountId, kind };
};

/**
 * Reads the ledger entries out of an untrusted list.
 *
 * A value that is not a list holds no entries: the ledger is a record of what
 * was purged, and an unreadable one must never block the journal.
 */
const ledgerEntriesOf = (value: unknown): PurgeLedgerEntry[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): PurgeLedgerEntry[] => {
    const parsed = ledgerEntryOf(entry);
    return parsed ? [parsed] : [];
  });
};

/**
 * Reads the deletion ledger of a journal directory.
 *
 * A missing or unreadable file is an empty ledger: the ledger is a record of
 * what was purged, and an unreadable one must never block the journal.
 */
export const readPurgeLedger = (directory: string): PurgeLedgerEntry[] => {
  const path = join(directory, PURGE_LEDGER_FILE);
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("entries" in parsed)) return [];
    return ledgerEntriesOf((parsed as { entries: unknown }).entries);
  } catch {
    return [];
  }
};

/**
 * Writes the deletion ledger of a journal directory.
 *
 * The ledger lives beside the database rather than inside it, because the
 * database is what a restore replaces: a ledger inside the database would be
 * rolled back with it, and a purged account would come back.
 */
const writePurgeLedger = (directory: string, entries: readonly PurgeLedgerEntry[]): void => {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, PURGE_LEDGER_FILE),
    `${JSON.stringify({ version: 1, entries }, null, 2)}\n`,
    "utf8",
  );
};

/**
 * Records one purge in the ledger of a journal directory.
 *
 * The entry is written **before** the purge runs, so a journal that was
 * purged is never restored without the ledger that says so. A purge that then
 * fails takes its entry back.
 */
export const recordPurgeLedger = (directory: string, accountId: string, kind: PurgeKind): void => {
  const entries = readPurgeLedger(directory).filter((entry) => entry.accountId !== accountId);
  entries.push({ accountId, kind });
  writePurgeLedger(directory, entries);
};

/**
 * Drops one purge of one account from the ledger of a journal directory.
 *
 * A rebuild undoes a **reset**, so the ledger forgets that: the account's
 * intelligence is meant to come back. A deletion is never undone by a rebuild,
 * so its entry stays and an older backup still cannot bring the account back.
 */
export const forgetPurgeLedger = (
  directory: string,
  accountId: string,
  kind: PurgeKind = "reset",
): void => {
  writePurgeLedger(
    directory,
    readPurgeLedger(directory).filter(
      (entry) => !(entry.accountId === accountId && entry.kind === kind),
    ),
  );
};

/* ---------------------------------------------------------------------------
 * The purge.
 * ------------------------------------------------------------------------ */

/**
 * Purges everything one account owns in the intelligence runtime.
 *
 * The outbox rows of the account are its committed change events; their
 * deliveries cascade with them. The jobs those deliveries produced are
 * cancelled first and deleted after: a worker that still holds one is fenced,
 * because its completion finds no job row. The evidence sidecar of the
 * account's fills has no foreign key, so it would otherwise survive them. The
 * observations of the account's trades go with it.
 *
 * The rows no foreign key reaches go too: a workflow, an opportunity or a
 * conversation about one of the account's observations belongs to the account
 * even when it is not account bound.
 *
 * The seed checkpoint is left alone: an account deletion takes it with the
 * account row, and a reset needs it to say `suppressed`.
 */
export const purgeAccountIntelligence = (tx: JournalTx, accountId: string): void => {
  const eventIds = tx
    .select({ id: domainOutbox.id })
    .from(domainOutbox)
    .where(eq(domainOutbox.accountId, accountId))
    .all()
    .map((row) => row.id);

  // The jobs are read before the events go: the deliveries that name them
  // cascade with the events.
  const jobIds = eventIds.length
    ? tx
        .selectDistinct({ jobId: eventDeliveries.jobId })
        .from(eventDeliveries)
        .where(inArray(eventDeliveries.eventId, eventIds))
        .all()
        .map((row) => row.jobId)
        .filter((jobId): jobId is string => jobId !== null)
    : [];

  const now = Date.now();
  if (jobIds.length) {
    eachChunk(jobIds, (chunk) => {
      // Cancel first: a worker that still holds the job loses its claim
      // before the row disappears under it.
      tx.update(intelligenceJobs)
        .set({
          cancelRequested: true,
          status: "cancelled",
          owner: null,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(inArray(intelligenceJobs.id, chunk))
        .run();
      tx.delete(intelligenceJobs).where(inArray(intelligenceJobs.id, chunk)).run();
    });
  }

  eachChunk(eventIds, (chunk) => {
    tx.delete(domainOutbox).where(inArray(domainOutbox.id, chunk)).run();
  });

  const executionIds = tx
    .select({ id: executions.id })
    .from(executions)
    .where(eq(executions.accountId, accountId))
    .all()
    .map((row) => row.id);
  eachChunk(executionIds, (chunk) => {
    tx.delete(executionEvidence).where(inArray(executionEvidence.executionId, chunk)).run();
  });

  // The observations of the account's trades are the account's intelligence:
  // their evidence links cascade with them.
  const observationIds = tx
    .select({ id: intelligenceObservations.id })
    .from(intelligenceObservations)
    .where(eq(intelligenceObservations.accountId, accountId))
    .all()
    .map((row) => row.id);
  eachChunk(observationIds, (chunk) => {
    tx.delete(intelligenceObservations).where(inArray(intelligenceObservations.id, chunk)).run();
  });

  // The knowledge of the account: its records and the sources they derive
  // from. A shared source belongs to the journal, not to the account, so only
  // the account's own sources go.
  tx.delete(knowledgeHypotheses).where(eq(knowledgeHypotheses.accountId, accountId)).run();
  tx.delete(knowledgePatterns).where(eq(knowledgePatterns.accountId, accountId)).run();
  tx.delete(knowledgeSources).where(eq(knowledgeSources.accountId, accountId)).run();

  // The experience of the account: its workflows (their transitions, their
  // commands and their conversation links cascade with them), its opportunities
  // and its conversations with their messages.
  tx.delete(intelligenceWorkflows).where(eq(intelligenceWorkflows.accountId, accountId)).run();
  tx.delete(intelligenceOpportunities)
    .where(eq(intelligenceOpportunities.accountId, accountId))
    .run();
  tx.delete(intelligenceConversations)
    .where(eq(intelligenceConversations.accountId, accountId))
    .run();

  // The rows that are not account bound but talk about the account's
  // observations: a workflow, an opportunity or a conversation about one of
  // them carries the account's data, so it goes with the observation.
  eachChunk(observationIds, (chunk) => {
    tx.delete(intelligenceWorkflows).where(inArray(intelligenceWorkflows.subjectId, chunk)).run();
    tx.delete(intelligenceOpportunities)
      .where(inArray(intelligenceOpportunities.subjectId, chunk))
      .run();
    tx.delete(intelligenceConversations)
      .where(inArray(intelligenceConversations.subjectId, chunk))
      .run();
  });

  // The background runs of the account: the account id leaves the scope, and a
  // run with no account left to read is deleted with its reservations.
  for (const run of tx.select().from(intelligenceRuns).all()) {
    const scope = scopeOf(run.scopeJson);
    if (!scope || !scope.accountIds.includes(accountId)) continue;
    const remaining = scope.accountIds.filter((id) => id !== accountId);
    if (remaining.length === 0) {
      tx.delete(intelligenceRuns).where(eq(intelligenceRuns.id, run.id)).run();
    } else {
      tx.update(intelligenceRuns)
        .set({ scopeJson: JSON.stringify({ ...scope, accountIds: remaining }) })
        .where(eq(intelligenceRuns.id, run.id))
        .run();
    }
  }
};

/** The scope of a background run, as an object, or null when it cannot be read. */
interface RunScope {
  readonly accountIds: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * Reads the scope of a background run.
 *
 * A scope that cannot be read is null: the run is then not about any account,
 * so a purge leaves it alone.
 */
const scopeOf = (raw: string): RunScope | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("accountIds" in parsed)) return null;
    const accountIds = (parsed as { accountIds: unknown }).accountIds;
    if (!Array.isArray(accountIds)) return null;
    return {
      ...(parsed as Record<string, unknown>),
      accountIds: accountIds.filter((id): id is string => typeof id === "string"),
    };
  } catch {
    return null;
  }
};

/**
 * Purges one account's intelligence and suppresses its reseed.
 *
 * The account survives; what the journal knew about it does not. The seed
 * checkpoint becomes `suppressed`, so the historical seed does not re-derive
 * what was deleted, and the replay seam refuses the account for the same
 * reason.
 */
export const resetAccountIntelligenceInTx = (
  tx: JournalTx,
  accountId: string,
  now: number,
): void => {
  purgeAccountIntelligence(tx, accountId);
  const checkpoint = tx
    .select({ baselineOperationId: intelligenceSeedCheckpoints.baselineOperationId })
    .from(intelligenceSeedCheckpoints)
    .where(eq(intelligenceSeedCheckpoints.accountId, accountId))
    .get();
  tx.insert(intelligenceSeedCheckpoints)
    .values({
      accountId,
      status: "suppressed",
      lastTradeKey: null,
      baselineOperationId: checkpoint?.baselineOperationId ?? newUuid(),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: intelligenceSeedCheckpoints.accountId,
      set: { status: "suppressed", lastTradeKey: null, updatedAt: now },
    })
    .run();
};

/**
 * Asks for the intelligence of one account to be rebuilt.
 *
 * The checkpoint moves back to `pending` and its cursor is cleared, so the
 * seed starts the account again from the beginning. The rebuild **enqueues the
 * seed job**: without it the account would sit at a pending checkpoint with no
 * observations, which is the opposite of what a rebuild asks for. The job key
 * is the one the historical seed uses for its own continuation, so a rebuild
 * asked for twice is one job.
 *
 * The ledger forgets the reset: the reset has been undone.
 */
export const requestAccountIntelligenceRebuildInTx = (
  tx: JournalTx,
  accountId: string,
  now: number,
): void => {
  const checkpoint = tx
    .select({ baselineOperationId: intelligenceSeedCheckpoints.baselineOperationId })
    .from(intelligenceSeedCheckpoints)
    .where(eq(intelligenceSeedCheckpoints.accountId, accountId))
    .get();
  const baselineOperationId = checkpoint?.baselineOperationId ?? newUuid();
  tx.insert(intelligenceSeedCheckpoints)
    .values({
      accountId,
      status: "pending",
      lastTradeKey: null,
      baselineOperationId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: intelligenceSeedCheckpoints.accountId,
      set: { status: "pending", lastTradeKey: null, updatedAt: now },
    })
    .run();

  // The seed job's key is the one the historical seed uses for its own
  // continuation, so a rebuild after a completed one must **re-arm** the
  // existing job rather than collide with it: an enqueue that finds a
  // finished job would leave the account with a pending checkpoint and no
  // runnable work.
  const seedKey = JSON.stringify(["seed_account", accountId, baselineOperationId, null]);
  createJobStore(db).enqueue(tx, seedKey, { type: "seed_account", accountId }, now);
  const existing = tx
    .select({ id: intelligenceJobs.id, status: intelligenceJobs.status })
    .from(intelligenceJobs)
    .where(eq(intelligenceJobs.idempotencyKey, seedKey))
    .get();
  // A job that is still queued or running is one job: a rebuild asked for
  // twice while the seed is still queued must not restart it.
  if (!existing || ["pending", "running", "retry_wait"].includes(existing.status)) return;
  tx.update(intelligenceJobs)
    .set({
      status: "pending",
      attempts: 0,
      availableAt: now,
      owner: null,
      fence: sql`${intelligenceJobs.fence} + 1`,
      leaseUntil: null,
      cancelRequested: false,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(intelligenceJobs.id, existing.id))
    .run();
};

/* ---------------------------------------------------------------------------
 * The prune.
 * ------------------------------------------------------------------------ */

/**
 * Prunes the finished transport rows and the finished diagnostics.
 *
 * `before` is the cutoff instant: nothing newer than it is ever touched. The
 * knowledge class has its own window and its own entry point
 * (`pruneSupersededKnowledge`).
 *
 * A row is only removed when nothing live points at it and it carries no
 * dedup key that is still needed: a failed delivery and a failed job are
 * unacknowledged failures and are kept, together with the event they name.
 */
export const pruneIntelligence = (before: number, limit: number): { removed: number } =>
  withJournalTransaction((tx) => pruneIntelligenceInTx(tx, before, limit));

/** The transport and diagnostics prune, on the caller's transaction. */
export const pruneIntelligenceInTx = (
  tx: JournalTx,
  before: number,
  limit: number,
): { removed: number } => {
  const now = Date.now();
  let removed = 0;

  // The transport class: an event whose whole subtree is finished. An event
  // that was **never dispatched** is the backlog: the worker was disabled or
  // behind, and deleting it would destroy work the journal still owes.
  const candidates = tx
    .select({ id: domainOutbox.id })
    .from(domainOutbox)
    .where(and(lt(domainOutbox.recordedAt, before), isNotNull(domainOutbox.dispatchedAt)))
    .limit(Math.max(0, limit))
    .all();
  for (const candidate of candidates) {
    if (removed >= limit) break;
    const deliveries = tx
      .select({ state: eventDeliveries.state, jobId: eventDeliveries.jobId })
      .from(eventDeliveries)
      .where(eq(eventDeliveries.eventId, candidate.id))
      .all();
    // An event with no delivery yet was never handed to a handler: it is
    // unfinished work, not a finished subtree.
    if (deliveries.length === 0) continue;
    // A pending or failed delivery is live or an unacknowledged failure: the
    // event stays, and with it the failure's diagnostic.
    if (
      deliveries.some(
        (delivery) => delivery.state !== "delivered" && delivery.state !== "cancelled",
      )
    ) {
      continue;
    }
    // The jobs of the event must be finished too: a running job still has work
    // to do for it.
    const jobIds = deliveries
      .map((delivery) => delivery.jobId)
      .filter((jobId): jobId is string => jobId !== null);
    const unfinished = jobIds.length
      ? tx
          .select({ id: intelligenceJobs.id })
          .from(intelligenceJobs)
          .where(
            and(
              inArray(intelligenceJobs.id, jobIds),
              notInArray(intelligenceJobs.status, ["completed", "cancelled"]),
            ),
          )
          .all()
      : [];
    if (unfinished.length > 0) continue;

    // The subtree is one unit: the jobs go first, then the event, whose
    // deliveries cascade with it. The bound is strict, so a subtree that does
    // not fit in the remaining budget is left whole — and the prune carries
    // on with a cheaper one instead of ending the call.
    const cost = finishedJobCount(tx, jobIds, before) + 1;
    if (removed + cost > limit) continue;

    // The jobs go first, then the event: the event's deliveries cascade with
    // it, and a job whose delivery is gone has no dedup key left to keep.
    removed += deleteTerminalJobsForEventInTx(tx, candidate.id, before);
    tx.delete(domainOutbox).where(eq(domainOutbox.id, candidate.id)).run();
    removed += 1;
  }

  // The finished retention jobs of this phase: they are the prune's own
  // leftovers, and nothing waits for them.
  if (removed < limit) {
    const own = tx
      .select({ id: intelligenceJobs.id })
      .from(intelligenceJobs)
      .where(
        and(
          eq(intelligenceJobs.type, "retention"),
          inArray(intelligenceJobs.status, ["completed", "cancelled"]),
          lt(intelligenceJobs.updatedAt, before),
        ),
      )
      .limit(Math.max(0, limit - removed))
      .all();
    for (const job of own) {
      if (removed >= limit) break;
      tx.delete(intelligenceJobs).where(eq(intelligenceJobs.id, job.id)).run();
      removed += 1;
    }
  }

  // The diagnostics class: the diagnostic payload of a finished run is
  // emptied, and the run row stays — it carries the effect dedup key and its
  // budget reservations. A failed run is an unacknowledged failure and keeps
  // its diagnostics.
  if (removed < limit) {
    const runs = tx
      .select({ id: intelligenceRuns.id, metaJson: intelligenceRuns.metaJson })
      .from(intelligenceRuns)
      .where(
        and(
          inArray(intelligenceRuns.status, ["completed", "cancelled", "unavailable"]),
          lt(intelligenceRuns.updatedAt, before),
        ),
      )
      .limit(Math.max(0, limit - removed))
      .all();
    for (const run of runs) {
      if (removed >= limit) break;
      // A run whose diagnostics are already empty is not work: counting it
      // would overstate what the prune did.
      if (run.metaJson === "{}") continue;
      tx.update(intelligenceRuns)
        .set({ metaJson: "{}", updatedAt: now })
        .where(eq(intelligenceRuns.id, run.id))
        .run();
      removed += 1;
    }
  }

  return { removed };
};

/**
 * Prunes the superseded and invalidated knowledge nothing refers to.
 *
 * A knowledge record is prunable when it is not the newest version of its
 * subject — a newer version says what the subject is now — and when no live
 * record names it. An observation is prunable when it is superseded or
 * invalidated and nothing live names it.
 */
export const pruneSupersededKnowledge = (before: number, limit: number): { removed: number } =>
  withJournalTransaction((tx) => pruneSupersededKnowledgeInTx(tx, before, limit));

/** The knowledge prune, on the caller's transaction. */
export const pruneSupersededKnowledgeInTx = (
  tx: JournalTx,
  before: number,
  limit: number,
): { removed: number } => {
  const live = liveReferenceIndex(tx);
  let removed = 0;
  removed += pruneKnowledgeInTx(tx, before, limit - removed, live);
  if (removed < limit) {
    removed += pruneObservationsInTx(tx, before, limit - removed, live);
  }
  return { removed };
};

/* ---------------------------------------------------------------------------
 * The backup and the restore.
 * ------------------------------------------------------------------------ */

/** The label the key probe is encrypted over. */
const KEY_PROBE_LABEL = "journal-backup-key-probe-v1";

/** The manifest of a backup. */
interface BackupManifest {
  readonly version: 1;
  readonly createdAt: number;
  readonly source: string;
  readonly database: string;
  readonly keyFile: string | null;
  readonly keyProbe: string | null;
  readonly purgedAccounts: readonly PurgeLedgerEntry[];
}

/**
 * The key material of a journal data directory.
 *
 * The journal encrypts its credentials with the key in `.secret`; the
 * environment variable `JOURNAL_SECRET` would take its place, and then the key
 * cannot travel with a backup at all.
 */
const readKeyFile = (directory: string): Buffer | null => {
  const path = join(directory, ".secret");
  if (!existsSync(path)) return null;
  try {
    return Buffer.from(readFileSync(path, "utf8").trim(), "hex");
  } catch {
    return null;
  }
};

/**
 * Whether a settings value is an encrypted envelope.
 *
 * The envelope is three dot-separated base64 parts, each long enough to be
 * key material, so a plain setting (a time zone, a version) never looks like
 * one.
 */
const isEncryptedEnvelope = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return (
    parts.length === 3 &&
    parts.every((part) => part.length >= 8 && /^[A-Za-z0-9+/]+={0,2}$/.test(part))
  );
};

/**
 * Whether a journal holds encrypted material.
 *
 * An encrypted setting or an account with sealed credentials is material the
 * journal needs its key to read.
 */
const holdsEncryptedMaterial = (directory: string): boolean => {
  const facts = readJournalFileFacts(directory);
  if (!facts.present) return false;
  // A journal that cannot be read may hold anything, so the backup refuses
  // rather than promises a snapshot that cannot be read back.
  if (facts.settingValues === null || facts.credentialAccounts === null) return true;
  if (facts.settingValues.some((value) => isEncryptedEnvelope(value))) return true;
  return facts.credentialAccounts > 0;
};

/**
 * Whether the key opens every encrypted setting of a journal.
 *
 * A settings row that carries an encrypted envelope is a credential the
 * journal needs its key to read. A journal with no encrypted setting has
 * nothing to open.
 */
const opensEncryptedSettings = (directory: string, key: Buffer): boolean => {
  const facts = readJournalFileFacts(directory);
  // A journal whose settings table cannot be read holds no credential that
  // the key must open.
  if (facts.settingValues === null) return true;
  return !facts.settingValues.some(
    (value) => isEncryptedEnvelope(value) && openProbe(key, value) === null,
  );
};

/** Encrypts the key probe under the journal's key, in the journal's envelope. */
const sealProbe = (key: Buffer, label: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(label, "utf8")), cipher.final()]);
  return [
    iv.toString("base64"),
    encrypted.toString("base64"),
    cipher.getAuthTag().toString("base64"),
  ].join(".");
};

/** Opens the key probe; null when the key does not open it. */
const openProbe = (key: Buffer, envelope: string): string | null => {
  const [iv, encrypted, tag] = envelope.split(".");
  if (!iv || !encrypted || !tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
};

/** What a backup asks for. */
export interface BackupRequest {
  /** Absolute path of the journal data directory to copy. */
  readonly source: string;
  /** Absolute path of the backup directory to write. */
  readonly destination: string;
  /** The operator's acknowledgement that the journal is quiescent. */
  readonly quiesced: boolean;
}

/** What a backup produced. */
export interface BackupResult {
  readonly database: string;
  readonly keyFile: string | null;
  readonly purgedAccounts: readonly string[];
}

/**
 * Takes a backup of a quiescent journal.
 *
 * The snapshot is written with SQLite's `VACUUM INTO`, so it is a consistent
 * copy of the whole journal rather than a copy of a live WAL file, and the key
 * material travels beside it — a backup that cannot be decrypted is not a
 * backup.
 *
 * The command refuses anything it cannot vouch for: a missing or relative
 * path, a source and a destination that are the same, a destination that
 * already holds a journal, a journal that is still being written to, and a
 * journal whose key cannot travel.
 */
export const backupJournal = (request: BackupRequest): BackupResult => {
  if (!request.source || !request.destination) {
    throw new Error("A backup needs an explicit source and destination.");
  }
  if (!isAbsolute(request.source) || !isAbsolute(request.destination)) {
    throw new Error("A backup needs absolute source and destination paths.");
  }
  if (request.source === request.destination) {
    throw new Error("A backup needs a source and a destination that differ.");
  }
  if (!request.quiesced) {
    throw new Error("A backup needs the operator's acknowledgement that the journal is quiescent.");
  }
  if (!existsSync(join(request.source, "journal.db"))) {
    throw new Error("The backup source does not hold a journal.");
  }
  if (existsSync(join(request.destination, "journal.db"))) {
    throw new Error("The backup destination already holds a journal.");
  }
  if (process.env.JOURNAL_SECRET && process.env.JOURNAL_SECRET.length > 0) {
    throw new Error("The journal's key comes from JOURNAL_SECRET and cannot travel with a backup.");
  }

  // The key material is the journal's **live** key, not a key found in the
  // source directory: the journal's encrypted settings were sealed under the
  // live key, so a probe sealed under anything else would verify against the
  // wrong key and the restored journal could not read them. The check runs
  // before the snapshot, so a foreign source is refused before anything is
  // written.
  const liveKey = readKeyFile(dataDir());
  const sourceKey = readKeyFile(request.source);
  if (sourceKey && (!liveKey || !liveKey.equals(sourceKey))) {
    throw new Error(
      "The backup source does not hold the journal's own key material; back up the journal's own data directory.",
    );
  }
  if (liveKey && !opensEncryptedSettings(request.source, liveKey)) {
    // The journal holds encrypted settings the live key cannot open: a
    // backup of it could never be read back.
    throw new Error(
      "The journal holds encrypted settings its key cannot open; the backup could not be read back.",
    );
  }
  if (!liveKey && holdsEncryptedMaterial(request.source)) {
    // The source holds encrypted material and no key travels with the
    // backup: the restored journal could never read its own settings.
    throw new Error(
      "The journal holds encrypted material and no key material is available to travel with the backup; the backup could not be read back.",
    );
  }
  const key = liveKey;

  mkdirSync(request.destination, { recursive: true });
  const database = join(request.destination, "journal.db");
  // A live worker lease means a worker is writing: the copy would not be a
  // point in time.
  const copy = copyJournalFile(request.source, database, WORKER_LEASE_NAME);
  if (copy.liveLeaseUntil !== null) {
    throw new Error("The journal still holds a worker lease; stop the worker before the backup.");
  }

  let keyFile: string | null = null;
  let keyProbe: string | null = null;
  if (key) {
    keyFile = ".secret";
    writeFileSync(join(request.destination, ".secret"), `${key.toString("hex")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    keyProbe = sealProbe(key, KEY_PROBE_LABEL);
  }

  const ledger = readLedgerOf(request.source);
  const manifest: BackupManifest = {
    version: 1,
    createdAt: Date.now(),
    source: request.source,
    database: "journal.db",
    keyFile,
    keyProbe,
    purgedAccounts: ledger,
  };
  writeFileSync(
    join(request.destination, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return {
    database,
    keyFile: key ? join(request.destination, ".secret") : null,
    purgedAccounts: ledger.map((entry) => entry.accountId),
  };
};

/** What a restore asks for. */
export interface RestoreRequest {
  /** Absolute path of the backup directory. */
  readonly source: string;
  /** Absolute path of the scratch directory to restore into. */
  readonly destination: string;
}

/** What a restore produced. */
export interface RestoreResult {
  readonly database: string;
  readonly keyVerified: boolean;
  readonly purgedAccounts: readonly string[];
}

/**
 * Restores a backup into scratch storage and verifies it.
 *
 * The copy is verified before anything migrates it, so the verification judges
 * the backup and not a migrated version of it. The deletion ledger is applied
 * again in the restored journal, so a restore cannot bring a purged account
 * back.
 */
export const restoreJournal = (request: RestoreRequest): RestoreResult => {
  if (!request.source || !request.destination) {
    throw new Error("A restore needs an explicit source and destination.");
  }
  if (!isAbsolute(request.source) || !isAbsolute(request.destination)) {
    throw new Error("A restore needs absolute source and destination paths.");
  }
  if (request.source === request.destination) {
    throw new Error("A restore needs a source and a destination that differ.");
  }
  const manifestPath = join(request.source, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("The restore source does not hold a backup manifest.");
  }
  if (existsSync(join(request.destination, "journal.db"))) {
    throw new Error("The restore destination already holds a journal.");
  }

  mkdirSync(request.destination, { recursive: true });
  const database = join(request.destination, "journal.db");
  copyFileSync(join(request.source, "journal.db"), database);

  const manifest = readManifest(manifestPath);

  // The key travels beside the database, and the probe proves it is the key the
  // journal wrote with.
  // The key is verified only when a probe opened under it. A restore that
  // checked nothing must not claim it did.
  let keyVerified = false;
  if (manifest.keyFile) {
    copyFileSync(
      join(request.source, manifest.keyFile),
      join(request.destination, manifest.keyFile),
    );
  }
  if (manifest.keyProbe) {
    const key = readKeyFile(request.destination);
    keyVerified = key !== null && openProbe(key, manifest.keyProbe) === KEY_PROBE_LABEL;
    if (!keyVerified) {
      throw new Error("The restored key material does not open the backup's key probe.");
    }
  }

  // The copy is verified before it is opened: the checks judge the backup.
  verifyRestoredJournal(database);

  // The ledger is applied again in the restored journal: an account the
  // operator purged stays purged.
  const ledger = new Map<string, PurgeKind>();
  for (const entry of [...manifest.purgedAccounts, ...readPurgeLedger(request.destination)]) {
    ledger.set(entry.accountId, entry.kind);
  }

  const restored = openConnection(request.destination);
  try {
    withConnectionTransaction(restored, (tx) => {
      for (const [accountId, kind] of ledger) {
        if (kind === "deleted") {
          // The same purge the delete path runs: the account's events, their
          // deliveries and jobs, its observations, its knowledge and the rows
          // that are not account bound but name its observations all go. The
          // account row goes last, and its cascade takes the seed checkpoint
          // with it, so the seed finds no account to seed.
          purgeAccountIntelligence(tx, accountId);
          // The trades and the fills of a deleted account go with it, exactly
          // as the live delete path removes them: neither table has a
          // foreign key to the account, so nothing else would take them.
          tx.delete(trades).where(eq(trades.accountId, accountId)).run();
          deleteAccountExecutionsInTx(tx, accountId);
          tx.delete(accounts).where(eq(accounts.id, accountId)).run();
        } else {
          resetAccountIntelligenceInTx(tx, accountId, Date.now());
        }
      }
    });
    // The restored journal is verified once more, now that the ledger has been
    // applied: the copy that is handed over must be the copy that was checked.
    verifyRestoredJournal(database);
    return {
      database,
      keyVerified,
      purgedAccounts: [...ledger.keys()],
    };
  } finally {
    restored.$client.close();
  }
};

/**
 * Reads a backup manifest.
 *
 * The manifest is a file an operator's disk holds, so its shape is checked
 * rather than assumed: a manifest that names no version, or whose ledger is
 * not a list, is refused with a clear reason instead of a crash later.
 */
const readManifest = (path: string): BackupManifest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("The backup manifest cannot be read.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("The backup manifest is not a manifest.");
  }
  const candidate = parsed as Partial<BackupManifest>;
  if (candidate.version !== 1) {
    throw new Error("The backup manifest has a version this build does not know.");
  }
  if (typeof candidate.database !== "string" || candidate.database.length === 0) {
    throw new Error("The backup manifest names no database.");
  }
  return {
    version: 1,
    createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
    source: typeof candidate.source === "string" ? candidate.source : "",
    database: candidate.database,
    keyFile: typeof candidate.keyFile === "string" ? candidate.keyFile : null,
    keyProbe: typeof candidate.keyProbe === "string" ? candidate.keyProbe : null,
    purgedAccounts: ledgerEntriesOf(candidate.purgedAccounts),
  };
};

/**
 * Runs the integrity and foreign-key checks on a restored journal file.
 *
 * The file is opened directly: opening it through the journal would migrate
 * it, and the verification must judge the backup.
 */
const verifyRestoredJournal = (database: string): void => {
  const verdict = checkJournalFile(database);
  if (verdict.integrity !== "ok") {
    throw new Error(`The restored journal fails its integrity check: ${verdict.integrity}.`);
  }
  if (verdict.foreignKeyViolations > 0) {
    throw new Error("The restored journal fails its foreign-key check.");
  }
};

/**
 * The finished jobs of a subtree.
 *
 * The count is what the subtree costs the prune: the jobs it removes and the
 * event itself.
 */
const finishedJobCount = (tx: JournalTx, jobIds: readonly string[], before: number): number => {
  if (jobIds.length === 0) return 0;
  return tx
    .select({ id: intelligenceJobs.id })
    .from(intelligenceJobs)
    .where(
      and(
        inArray(intelligenceJobs.id, jobIds),
        inArray(intelligenceJobs.status, ["completed", "cancelled"]),
        lt(intelligenceJobs.updatedAt, before),
      ),
    )
    .all().length;
};

/**
 * Reads the deletion ledger of a journal directory.
 *
 * The ledger is file-only: the file beside the database is the one that
 * survives the database being replaced, so a purge that happened after the
 * last snapshot is still known.
 */
const readLedgerOf = (directory: string): PurgeLedgerEntry[] => {
  const ledger = new Map<string, PurgeKind>();
  for (const entry of readPurgeLedger(directory)) ledger.set(entry.accountId, entry.kind);
  return [...ledger].map(([accountId, kind]) => ({ accountId, kind }));
};
