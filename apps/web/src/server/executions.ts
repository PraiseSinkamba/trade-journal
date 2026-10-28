import { and, eq, inArray } from "drizzle-orm";
import { positionFillProblem, type ImportedExecution } from "@luxalgo/journal-importers";
import { db, executions, accounts, trades } from "@/db";
import { withJournalTransaction, type JournalTx } from "@/db/transaction";
import { executionHash, newId, nowIso } from "./ids";
import { getJournalDefaultsInTx } from "./settings";
import { defaultFee } from "@/lib/journal-defaults";
import { requireValue } from "./request-error";
import { positionImportErrors } from "./position-import";
import { changeContext, reconcileAccountInTx, type ChangeContext } from "./trading/reconcile";

export interface InsertResult {
  inserted: number;
  duplicates: number;
  /** Rows dropped because a broker or file record was unusable (sync/import only). */
  skipped: number;
  /** A few plain-language reasons for skipped rows, capped so payloads stay small. */
  skippedReasons: string[];
}

export type ExecutionSource = "sync" | "import" | "manual";

const MAX_SKIP_REASONS = 5;

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Plain-language reason a row can't be journaled, or null when the row is valid. */
export const executionProblem = (row: unknown, source: ExecutionSource): string | null => {
  if (!row || typeof row !== "object") return "Execution is missing.";
  const r = row as Partial<ImportedExecution>;
  const label = typeof r.symbol === "string" && r.symbol.trim() ? r.symbol.trim() : "execution";
  if (typeof r.symbol !== "string" || !r.symbol.trim()) return "An execution has no symbol.";
  if (!["buy", "sell"].includes(r.side as string)) return `${label}: side must be buy or sell.`;
  if (!isFiniteNumber(r.quantity) || r.quantity <= 0)
    return `${label}: quantity must be a finite positive number.`;
  if (!isFiniteNumber(r.price)) return `${label}: price must be a finite number.`;
  if (!isFiniteNumber(r.fee ?? 0)) return `${label}: fee must be a finite number.`;
  if (typeof r.executedAt !== "string" || !Number.isFinite(Date.parse(r.executedAt)))
    return `${label}: timestamp is missing or invalid.`;
  const meta = r.importMetadata;
  const metaOk =
    !meta ||
    (typeof meta.id === "string" &&
      meta.id.length > 0 &&
      meta.id.length <= 2000 &&
      (meta.group === undefined ||
        (typeof meta.group === "string" && meta.group.length > 0 && meta.group.length <= 2000)) &&
      Number.isSafeInteger(meta.order) &&
      meta.order >= 0 &&
      (meta.reportedGrossPnl === undefined || Number.isFinite(meta.reportedGrossPnl)) &&
      (meta.preserveFee === undefined || typeof meta.preserveFee === "boolean"));
  if (!metaOk) return `${label}: invalid imported execution metadata.`;
  const positionProblem = positionFillProblem(r as ImportedExecution);
  if (positionProblem) return positionProblem;
  return null;
};

/**
 * Split a batch into usable rows and skip reasons. Manual entry is strict: the
 * whole batch is rejected on the first bad row. Broker syncs and file imports
 * are lenient: one odd record must not fail the entire batch, so bad rows are
 * dropped and counted for the caller to report. Position-labelled histories are
 * atomic: dropping a bad fill could change which position the remaining fills close.
 */
export const partitionExecutions = (
  rows: ImportedExecution[],
  source: ExecutionSource,
): { usable: ImportedExecution[]; skipped: number; skippedReasons: string[] } => {
  const usable: ImportedExecution[] = [];
  const skippedReasons: string[] = [];
  let skipped = 0;
  for (const row of rows) {
    const problem = executionProblem(row, source);
    if (
      problem &&
      (row?.importMetadata?.position ||
        (typeof row?.importMetadata?.group === "string" &&
          row.importMetadata.group.startsWith("csv-position:")))
    )
      requireValue(false, problem);
    if (problem === null) {
      usable.push(row);
      continue;
    }
    if (source === "manual") {
      requireValue(
        false,
        "Every execution needs a symbol, buy/sell side, finite positive quantity, price, fee and valid timestamp.",
      );
    }
    skipped++;
    if (skippedReasons.length < MAX_SKIP_REASONS) skippedReasons.push(problem);
  }
  return { usable, skipped, skippedReasons };
};

/** The change context a source implies: where it came from, and whether it is live. */
const contextForSource = (source: ExecutionSource): ChangeContext =>
  source === "manual"
    ? changeContext("user", "live")
    : source === "sync"
      ? changeContext("broker_sync", "live")
      : changeContext("import", "historical");

/**
 * Insert fills, rebuild the trades, and attach optional manual notes — all in
 * one transaction the caller owns.
 *
 * The fills, the projection rows, the projection revisions, the domain events
 * and the notes commit together or not at all.
 */
export const insertExecutionsInTx = (
  tx: JournalTx,
  accountId: string,
  rows: ImportedExecution[],
  source: ExecutionSource,
  context: ChangeContext,
  manualNotes?: string,
  options: { preserveFees?: boolean } = {},
): InsertResult => {
  requireValue(
    manualNotes === undefined ||
      (source === "manual" && typeof manualNotes === "string" && manualNotes.length <= 100000),
    "Manual trade notes must be at most 100,000 characters.",
  );
  requireValue(
    tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get(),
    "Account not found.",
  );
  const { usable, skipped, skippedReasons } = partitionExecutions(rows, source);
  requireValue(
    !usable.some((row) => row.ninjaTrader || row.importMetadata?.group?.startsWith("ninjatrader")),
    "NinjaTrader fills require the reviewed import endpoint.",
  );
  let inserted = 0;
  let duplicates = 0;
  const createdAt = nowIso();
  const defaults = getJournalDefaultsInTx(tx);
  const note = manualNotes?.trim() ? manualNotes : undefined;

  const positionErrors = positionImportErrors(tx, accountId, usable);
  requireValue(positionErrors.length === 0, positionErrors.join(" "));
  if (source === "import") {
    const existingHashes = new Set(
      tx
        .select({ hash: executions.contentHash })
        .from(executions)
        .where(and(eq(executions.accountId, accountId), eq(executions.source, "import")))
        .all()
        .map((row) => row.hash),
    );
    for (const row of usable) {
      if (existingHashes.has(executionHash(row))) continue;
      const candidates = [row.legacyExecutedAt, row.executedAt.replace(/\.\d{3}Z$/, ".000Z")];
      requireValue(
        !candidates.some(
          (executedAt) =>
            executedAt &&
            executedAt !== row.executedAt &&
            existingHashes.has(executionHash({ ...row, executedAt })),
        ),
        "Matching imported fills have timestamps from an older parser or indistinguishable whole-second executions. Import the complete corrected history into a new journal account and compare it before retiring the old account; nothing was saved.",
      );
    }
  }
  const noteExecutionIds = new Set<string>();
  for (const row of usable) {
    const id = newId();
    const contentHash = executionHash(row);
    const result = tx
      .insert(executions)
      .values({
        id,
        accountId,
        symbol: row.symbol,
        side: row.side,
        quantity: row.quantity,
        price: row.price,
        fee:
          row.importMetadata?.preserveFee || options.preserveFees
            ? row.fee
            : defaultFee(row.fee, row.quantity, accountId, row.symbol, defaults),
        executedAt: row.executedAt,
        assetClass: row.assetClass ?? null,
        source,
        importMetadataJson: row.importMetadata ? JSON.stringify(row.importMetadata) : null,
        contentHash,
        createdAt,
      })
      .onConflictDoNothing()
      .run();
    if (result.changes > 0) {
      inserted++;
      if (note) noteExecutionIds.add(id);
    } else {
      duplicates++;
      if (note) {
        const existing = tx
          .select({ id: executions.id })
          .from(executions)
          .where(and(eq(executions.accountId, accountId), eq(executions.contentHash, contentHash)))
          .get();
        if (existing) noteExecutionIds.add(existing.id);
      }
    }
  }
  // The projections, the revisions and the events are written by the one
  // reconciliation boundary, in this transaction. Nothing changed when no fill
  // was inserted, so there is nothing to reconcile.
  if (inserted > 0) reconcileAccountInTx(tx, accountId, context);
  if (note) {
    const affected = tx
      .select({
        key: trades.key,
        notes: trades.notes,
        executionIdsJson: trades.executionIdsJson,
      })
      .from(trades)
      .where(eq(trades.accountId, accountId))
      .all();
    for (const trade of affected) {
      const ids = JSON.parse(trade.executionIdsJson) as string[];
      if (!ids.some((id) => noteExecutionIds.has(id))) continue;
      // Keep prior annotations when these fills extend or close an existing position.
      // Retrying the same submission must not append the note a second time.
      if (trade.notes === note || trade.notes?.endsWith(`\n\n${note}`)) continue;
      const notes = trade.notes?.trim() ? `${trade.notes}\n\n${note}` : note;
      requireValue(
        notes.length <= 100000,
        "Combined trade notes must be at most 100,000 characters.",
      );
      tx.update(trades).set({ notes }).where(eq(trades.key, trade.key)).run();
    }
  }

  return { inserted, duplicates, skipped, skippedReasons };
};

/** Insert fills, rebuild trades, and attach optional manual notes in one transaction. */
export const insertExecutions = (
  accountId: string,
  rows: ImportedExecution[],
  source: ExecutionSource,
  manualNotes?: string,
  options: { preserveFees?: boolean } = {},
): InsertResult => {
  const context = contextForSource(source);
  return withJournalTransaction((tx) =>
    insertExecutionsInTx(tx, accountId, rows, source, context, manualNotes, options),
  );
};

/**
 * SQLite's bind-parameter limit. Every statement that names a list of ids
 * stays below it, even for a long history.
 */
const ID_CHUNK = 500;

/**
 * Deletes the given fills of one account inside the caller's transaction.
 *
 * The fills are deleted in chunks, so a trade with a long history never
 * exceeds SQLite's bind-parameter limit.
 */
export const deleteExecutionsForTradesInTx = (
  tx: JournalTx,
  accountId: string,
  executionIds: readonly string[],
): void => {
  if (executionIds.length === 0) return;
  for (let i = 0; i < executionIds.length; i += ID_CHUNK) {
    tx.delete(executions)
      .where(
        and(
          eq(executions.accountId, accountId),
          inArray(executions.id, executionIds.slice(i, i + ID_CHUNK)),
        ),
      )
      .run();
  }
};

/**
 * Deletes every fill of one account inside the caller's transaction.
 *
 * One statement: the account is named, not a list of fills, so there is no
 * bind-parameter limit to stay below.
 */
export const deleteAccountExecutionsInTx = (tx: JournalTx, accountId: string): void => {
  tx.delete(executions).where(eq(executions.accountId, accountId)).run();
};

export const deleteExecutionsForTrades = (accountId: string, executionIds: string[]): void => {
  if (executionIds.length === 0) return;
  const context = changeContext("user", "live");
  withJournalTransaction((tx) => {
    deleteExecutionsForTradesInTx(tx, accountId, executionIds);
    reconcileAccountInTx(tx, accountId, context);
  });
};

export const listExecutions = (accountId: string, ids?: string[]) => {
  if (ids && ids.length > 0) {
    return db
      .select()
      .from(executions)
      .where(and(eq(executions.accountId, accountId), inArray(executions.id, ids)))
      .all();
  }
  return db.select().from(executions).where(eq(executions.accountId, accountId)).all();
};
