import { connect, listBrokers, type BrokerId } from "@luxalgo/broker-sdk";
import { syncCTraderMcpAccount } from "./ctrader-mcp/sync";
import { eq } from "drizzle-orm";
import { accounts, db } from "@/db";
import { withJournalTransaction } from "@/db/transaction";
import { decryptJson, encryptJson } from "./crypto";
import { nowIso } from "./ids";
import { brokerTradesToExecutions, untimedFillsReason } from "./broker-trades";
import { insertExecutionsInTx, type InsertResult } from "./executions";
import { changeContext } from "./trading/reconcile";
import { getImportTimeZone } from "./settings";
import { requireValue } from "./request-error";
import {
  assertIbkrSyncTimeZone,
  canonicalImportTimeZone,
  isIbkrSyncAccount,
} from "./ibkr-sync-timezone";

/** All broker connectivity goes through @luxalgo/broker-sdk, never direct API code. */
export { listBrokers };

export interface SyncOutcome extends InsertResult {
  accountId: string;
  equity: number | null;
  positions: number;
  syncedAt: string;
}

export const syncAccount = async (accountId: string): Promise<SyncOutcome> => {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error("Account not found");
  if (account.kind !== "sync" || !account.credentialsEnc) {
    throw new Error("Account is not broker-connected");
  }

  const statementTimeZone = isIbkrSyncAccount(account)
    ? canonicalImportTimeZone(getImportTimeZone())
    : undefined;
  if (statementTimeZone !== undefined) assertIbkrSyncTimeZone(account, statementTimeZone);

  const credentials = decryptJson<Record<string, string>>(account.credentialsEnc);

  if (account.broker === "ctrader-mcp") {
    return syncCTraderMcpAccount(accountId);
  }

  const connection = connect({
    broker: account.broker as BrokerId,
    credentials,
    ...(statementTimeZone !== undefined ? { statementTimeZone } : {}),
    // Some brokers rotate tokens on every fetch (Questrade): persist or die.
    onCredentialsRotated: (next: Record<string, string>) => {
      db.update(accounts)
        .set({ credentialsEnc: encryptJson(next) })
        .where(eq(accounts.id, accountId))
        .run();
    },
  } as Parameters<typeof connect>[0]);

  const snapshot = await connection.fetchSnapshot();
  const syncedAt = nowIso();

  const { timed, untimed } = brokerTradesToExecutions(
    snapshot.accounts.flatMap((brokerAccount) => brokerAccount.trades),
  );

  const equity = snapshot.accounts.reduce((total, a) => total + a.equity, 0);
  const positions = snapshot.accounts.flatMap((a) => a.positions);
  // The fills, the rebuilt projections, the projection revisions, the domain
  // events and the broker snapshot commit together or not at all.
  const result = withJournalTransaction((tx) => {
    if (statementTimeZone !== undefined) {
      const current = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
      requireValue(
        current && isIbkrSyncAccount(current) && current.credentialsEnc === account.credentialsEnc,
        "The IBKR connection changed during sync. Try again.",
      );
      assertIbkrSyncTimeZone(current, statementTimeZone);
    }
    // The broker bookkeeping is written first: a failure in the fill write
    // below must roll the snapshot back with it.
    tx.update(accounts)
      .set({
        lastSyncAt: syncedAt,
        snapshotJson: JSON.stringify({ equity, positions, fetchedAt: snapshot.fetchedAt }),
      })
      .where(eq(accounts.id, accountId))
      .run();
    // Validation, history provenance, deduplication and sync status commit together.
    const inserted = insertExecutionsInTx(
      tx,
      accountId,
      timed,
      "sync",
      changeContext("broker_sync", "live"),
    );
    if (statementTimeZone !== undefined && inserted.inserted > 0) {
      tx.update(accounts)
        .set({ ibkrSyncTimeZone: statementTimeZone })
        .where(eq(accounts.id, accountId))
        .run();
    }
    return inserted;
  });
  if (untimed > 0) {
    result.skipped += untimed;
    if (result.skippedReasons.length < 5)
      result.skippedReasons.push(untimedFillsReason(untimed, statementTimeZone !== undefined));
  }

  return { accountId, ...result, equity, positions: positions.length, syncedAt };
};
