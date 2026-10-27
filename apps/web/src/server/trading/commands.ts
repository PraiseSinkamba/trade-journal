import type { ImportedExecution } from "@luxalgo/journal-importers";
import { withJournalTransaction } from "@/db/transaction";
import { insertExecutionsInTx, type InsertResult } from "../executions";
import { changeContext } from "./reconcile";

/**
 * The trading command layer (Phase 05).
 *
 * A command owns one transaction and one change context. The API routes call
 * these; the routes never open a transaction themselves.
 */

export type { ChangeContext } from "../domain-events";

/**
 * Records manual fills the user entered.
 *
 * A manual trade is a live statement by the user: a position the journal has
 * not seen before is `opened`, not `discovered`.
 */
export const recordManualTrades = (
  accountId: string,
  rows: ImportedExecution[],
  manualNotes?: string,
): InsertResult =>
  withJournalTransaction((tx) =>
    insertExecutionsInTx(tx, accountId, rows, "manual", changeContext("user", "live"), manualNotes),
  );

/**
 * Records fills imported from a statement.
 *
 * An import is a reconstruction of what already happened, so a trade the journal
 * has not seen before is `discovered`, never a live closure.
 */
export const importGenericExecutions = (
  accountId: string,
  rows: ImportedExecution[],
  options?: { preserveFees?: boolean },
): InsertResult =>
  withJournalTransaction((tx) =>
    insertExecutionsInTx(
      tx,
      accountId,
      rows,
      "import",
      changeContext("import", "historical"),
      undefined,
      options,
    ),
  );
