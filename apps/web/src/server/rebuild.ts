import { withJournalTransaction } from "@/db/transaction";
import { changeContext, reconcileAccountInTx } from "./trading/reconcile";

/**
 * Rebuild the materialized round trips for an account from its executions.
 *
 * Computed columns are overwritten; annotation columns are untouched because
 * rows are upserted by their rebuild-stable key. Trades whose key no longer
 * exists (their executions were deleted) are removed.
 *
 * The rebuild is the reconciliation boundary: the account, its executions and
 * the journal's multipliers are read inside one transaction, and the projection
 * rows, the projection revisions and the domain events are written in it.
 */
export const rebuildAccount = (accountId: string): void => {
  withJournalTransaction((tx) =>
    reconcileAccountInTx(tx, accountId, changeContext("system", "maintenance")),
  );
};
