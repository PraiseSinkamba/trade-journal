import { eq } from "drizzle-orm";
import { db, accounts } from "@/db";
import { decryptJson } from "@/server/crypto";
import { nowIso } from "@/server/ids";
import { insertExecutions, type InsertResult } from "@/server/executions";
import { CTraderMcpClient } from "./client";
import { classifyMcpError, CTraderMcpSyncError } from "./errors";
import { getAccountInfo } from "./account";
import { listCTraderAccounts } from "./accounts";
import { fetchAllDeals, mapDealToExecution } from "./deals";
import { getPendingOrders } from "./orders";
import { getOpenPositions } from "./positions";
import { buildAssetClassMap, fetchSymbols } from "./symbols";
import { type CTraderAccountInfo, type CTraderOrder, type CTraderPosition } from "./schemas";

export type CTraderMcpCredentials =
  | { mode: "remote"; endpoint: string; bearerToken: string; ctraderAccountId: number }
  | { mode: "local"; endpoint: string; authHeader?: string };

export interface SyncOutcome extends InsertResult {
  accountId: string;
  equity: number | null;
  positions: number;
  syncedAt: string;
}

const getClient = (creds: CTraderMcpCredentials): CTraderMcpClient => {
  if (
    process.env.NODE_ENV === "test" &&
    (globalThis as unknown as { __FAKE_MCP__?: CTraderMcpClient }).__FAKE_MCP__
  ) {
    return (globalThis as unknown as { __FAKE_MCP__: CTraderMcpClient }).__FAKE_MCP__;
  }
  return new CTraderMcpClient(creds);
};

export const syncCTraderMcpAccount = async (accountId: string): Promise<SyncOutcome> => {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error("Account not found");
  if (account.kind !== "sync" || !account.credentialsEnc) {
    throw new Error("Account is not broker-connected");
  }

  let positions: CTraderPosition[] = [];
  let pendingOrders: CTraderOrder[] = [];
  let accountInfo: CTraderAccountInfo | null = null;
  let client: CTraderMcpClient | undefined;

  try {
    const creds = decryptJson<CTraderMcpCredentials>(account.credentialsEnc);
    client = getClient(creds);
    await client.initialize();

    if (creds.mode === "remote") {
      const accessible = await listCTraderAccounts(client);
      if (!accessible.some((a) => a.accountId === creds.ctraderAccountId)) {
        throw new CTraderMcpSyncError(
          "account_gone",
          "cTrader account is no longer accessible from this token. Re-connect the account.",
        );
      }
    }

    const syncedAt = nowIso();

    const symbols = await fetchSymbols(client);
    const symbolMap = buildAssetClassMap(symbols);
    const symbolNameMap = new Map(symbols.map((s) => [s.symbolId, s.name] as const));

    const deals = await fetchAllDeals(client, {
      fromTime: account.lastSyncAt ?? undefined,
      toTime: syncedAt,
      ...(creds.mode === "remote" ? { ctraderAccountId: creds.ctraderAccountId } : {}),
    });

    const rows = deals.map((deal, i) =>
      mapDealToExecution(
        deal,
        symbolNameMap.get(deal.symbolId) ?? `UNKNOWN-${deal.symbolId}`,
        symbolMap.get(deal.symbolId) ?? "other",
        i,
      ),
    );

    positions = await getOpenPositions(
      client,
      creds.mode === "remote" ? creds.ctraderAccountId : undefined,
    );
    pendingOrders = await getPendingOrders(
      client,
      creds.mode === "remote" ? creds.ctraderAccountId : undefined,
    );
    accountInfo = await getAccountInfo(
      client,
      creds.mode === "remote" ? creds.ctraderAccountId : undefined,
    );

    const equity = accountInfo?.equity ?? null;

    const result = db.transaction(
      () => {
        const inserted = insertExecutions(accountId, rows, "sync");
        db.update(accounts)
          .set({
            lastSyncAt: syncedAt,
            snapshotJson: JSON.stringify({
              equity,
              positions,
              openOrders: pendingOrders,
              balance: accountInfo?.balance ?? null,
              freeMargin: accountInfo?.freeMargin ?? null,
              currency: accountInfo?.currency ?? account.currency,
              fetchedAt: syncedAt,
            }),
          })
          .where(eq(accounts.id, accountId))
          .run();
        return inserted;
      },
      { behavior: "immediate" },
    );

    return {
      accountId,
      inserted: result.inserted,
      duplicates: result.duplicates,
      skipped: result.skipped,
      skippedReasons: result.skippedReasons,
      equity,
      positions: positions.length,
      syncedAt,
    };
  } catch (err) {
    if (!(err instanceof CTraderMcpSyncError)) throw classifyMcpError(err);
    throw err;
  } finally {
    await client?.close().catch(() => undefined);
  }
};
