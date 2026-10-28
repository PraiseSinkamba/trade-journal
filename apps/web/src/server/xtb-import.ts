import { and, eq } from "drizzle-orm";
import { xtbWorkbookToStatement, type ImportedExecution } from "@luxalgo/journal-importers";
import { db, executions } from "@/db";
import { withJournalTransaction, type JournalTx } from "@/db/transaction";
import { requireValue } from "./request-error";
import { XLSX_MAX_BYTES } from "@/lib/xlsx-import";
import { executionHash } from "./ids";
import { insertExecutionsInTx, type InsertResult } from "./executions";
import { changeContext } from "./trading/reconcile";

/** Decode an uploaded base64 .xlsx on the server; the browser never parses the workbook. */
export const xlsxStatement = async (base64: string): Promise<string> => {
  const tooLarge = "Excel uploads must be a .xlsx file of 5 MB or less.";
  requireValue(base64.length <= Math.ceil(XLSX_MAX_BYTES / 3) * 4, tooLarge);
  requireValue(/^[A-Za-z0-9+/]+={0,2}$/.test(base64), "This file is not an .xlsx workbook.");
  const bytes = Buffer.from(base64, "base64");
  requireValue(bytes.length <= XLSX_MAX_BYTES, tooLarge);
  try {
    return await xtbWorkbookToStatement(bytes);
  } catch (error) {
    // Reader and XTB layout errors describe the file, so they are the user's answer.
    if (error instanceof Error) requireValue(false, error.message);
    throw error;
  }
};

const isXtbEntry = (fill: ImportedExecution): boolean =>
  fill.importMetadata?.id === "entry" && Boolean(fill.importMetadata.group?.startsWith("xtb:"));

/** The same lot read from Open Positions and later from Closed Positions. */
const sameLot = (stored: ImportedExecution, incoming: ImportedExecution): boolean =>
  stored.symbol === incoming.symbol &&
  stored.side === incoming.side &&
  stored.quantity.toPrecision(12) === incoming.quantity.toPrecision(12) &&
  Math.abs(Date.parse(stored.executedAt) - Date.parse(incoming.executedAt)) < 1000 &&
  Math.abs(stored.price - incoming.price) <=
    1e-3 * Math.max(Math.abs(stored.price), Math.abs(incoming.price));

const describe = (fill: ImportedExecution) =>
  `${fill.side} ${fill.quantity} ${fill.symbol} at ${fill.price} on ${fill.executedAt}`;

/** A holding the journal already stored, keyed by its XTB position group. */
type StoredEntry = { fill: ImportedExecution; hash: string };

/** The stored holdings of one account, read from the executions table. */
const storedEntries = (rows: (typeof executions.$inferSelect)[]): Map<string, StoredEntry> => {
  const stored = new Map<string, StoredEntry>();
  for (const row of rows) {
    const importMetadata = row.importMetadataJson ? JSON.parse(row.importMetadataJson) : undefined;
    const fill: ImportedExecution = {
      symbol: row.symbol,
      side: row.side as "buy" | "sell",
      quantity: row.quantity,
      price: row.price,
      fee: row.fee,
      executedAt: row.executedAt,
      importMetadata,
    };
    if (isXtbEntry(fill)) stored.set(importMetadata.group, { fill, hash: row.contentHash });
  }
  return stored;
};

/**
 * An XTB holding is stored as an entry fill keyed by its position id. When a
 * later workbook closes that position, its entry must be the stored one, or the
 * journal would keep a second, phantom open lot. A lot whose time or price
 * differ only by rounding is the same fill and is not inserted again; a lot
 * whose size or side changed (for example a partial close) is refused, because
 * which part was closed cannot be known. Nothing is saved in that case.
 */
const compareEntries = (
  stored: Map<string, StoredEntry>,
  incoming: ImportedExecution[],
): { executions: ImportedExecution[]; matched: number; problem: string | null } => {
  const entries = incoming.filter(isXtbEntry);
  if (!entries.length) return { executions: incoming, matched: 0, problem: null };

  const dropped = new Set<ImportedExecution>();
  for (const entry of entries) {
    const previous = stored.get(entry.importMetadata!.group!);
    if (!previous || previous.hash === executionHash(entry)) continue;
    if (!sameLot(previous.fill, entry)) {
      const position = entry.importMetadata!.group!.split(":").at(-1);
      return {
        executions: incoming,
        matched: 0,
        problem: `XTB position ${position} was imported earlier as ${describe(previous.fill)}, but this file reports ${describe(entry)}. The position changed, for example by a partial close, so the journal cannot tell which part this file closes. Nothing was saved. Export one workbook whose date range covers both the opening and the close of this position, and import it into a new journal account.`,
      };
    }
    dropped.add(entry);
  }
  return {
    executions: incoming.filter((fill) => !dropped.has(fill)),
    matched: dropped.size,
    problem: null,
  };
};

/**
 * The same reconciliation, read inside the caller's transaction.
 *
 * The commit path uses this form, so the holding that is matched or refused is
 * the one the write transaction sees — the decision and the write are taken
 * under one lock.
 */
export const reconcileXtbHoldingsInTx = (
  tx: JournalTx,
  accountId: string,
  incoming: ImportedExecution[],
): { executions: ImportedExecution[]; matched: number; problem: string | null } =>
  compareEntries(
    storedEntries(
      tx
        .select()
        .from(executions)
        .where(and(eq(executions.accountId, accountId), eq(executions.source, "import")))
        .all(),
    ),
    incoming,
  );

/** The read-only reconciliation the preview uses. */
export const reconcileXtbHoldings = (
  accountId: string,
  incoming: ImportedExecution[],
): { executions: ImportedExecution[]; matched: number; problem: string | null } =>
  db.transaction((tx) => reconcileXtbHoldingsInTx(tx, accountId, incoming));

/**
 * Commits an XTB workbook.
 *
 * The matched holding is revalidated inside the transaction that writes the
 * fills, so a position that changed is refused before anything is saved, and
 * the fills, the rebuilt projections, the projection revisions and the domain
 * events commit together with it.
 */
export const commitXtbImport = (
  accountId: string,
  incoming: ImportedExecution[],
  options: { preserveFees?: boolean } = {},
): InsertResult & { matched: number } =>
  withJournalTransaction((tx) => {
    const reconciled = reconcileXtbHoldingsInTx(tx, accountId, incoming);
    requireValue(!reconciled.problem, reconciled.problem ?? "");
    const result = insertExecutionsInTx(
      tx,
      accountId,
      reconciled.executions,
      "import",
      changeContext("import", "historical"),
      undefined,
      options,
    );
    return { ...result, matched: reconciled.matched };
  });
