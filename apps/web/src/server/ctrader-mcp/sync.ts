import { eq } from "drizzle-orm";
import { db, accounts } from "@/db";
import { decryptJson } from "@/server/crypto";
import { nowIso } from "@/server/ids";
import { insertExecutions, type InsertResult } from "@/server/executions";
import { CTraderMcpClient } from "./client";
import { classifyMcpError, CTraderMcpSyncError } from "./errors";
import { getAccountBalance } from "./account";
import { fetchAllDeals, mapDealToExecution } from "./deals";
import { getPendingOrders } from "./orders";
import { getOpenPositions } from "./positions";
import { fetchSymbols, findAssetClass } from "./symbols";
import {
  type CTraderBalance,
  type CTraderOrder,
  type CTraderPosition,
} from "./schemas";

export type CTraderMcpCredentials = {
  endpoint: string;
  authHeader?: string;
  ctraderAccountId: number;
};

export interface SyncOutcome extends InsertResult {
  accountId: string;
  equity: number | null;
  positions: number;
  syncedAt: string;
}

// Test seam: tests install a fake MCP via globalThis.__FAKE_MCP__. The cast is
// hoisted to a named const so call sites don't re-cast inline.
const testSlot = globalThis as unknown as { __FAKE_MCP__?: CTraderMcpClient };

const getClient = (creds: CTraderMcpCredentials): CTraderMcpClient => {
  if (process.env.NODE_ENV === "test" && testSlot.__FAKE_MCP__) {
    return testSlot.__FAKE_MCP__;
  }
  return new CTraderMcpClient({
    mode: "local",
    endpoint: creds.endpoint,
    authHeader: creds.authHeader,
  });
};

export const syncCTraderMcpAccount = async (accountId: string): Promise<SyncOutcome> => {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error("Account not found");
  if (account.kind !== "sync" || !account.credentialsEnc) {
    throw new Error("Account is not broker-connected");
  }

  let positions: CTraderPosition[] = [];
  let pendingOrders: CTraderOrder[] = [];
  let balance: CTraderBalance | null = null;
  let client: CTraderMcpClient | undefined;

  try {
    const creds = decryptJson<CTraderMcpCredentials>(account.credentialsEnc);
    client = getClient(creds);
    await client.initialize();

    const syncedAt = nowIso();

    const symbols = await fetchSymbols(client);

    const deals = await fetchAllDeals(client);
    const rows = deals.map((deal, i) =>
      mapDealToExecution(deal, deal.symbolName, findAssetClass(symbols, deal.symbolName), i),
    );

    positions = await getOpenPositions(client);
    pendingOrders = await getPendingOrders(client);
    balance = await getAccountBalance(client);

    const equity = balance?.equity ?? null;

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
              balance: balance?.balance ?? null,
              freeMargin: balance?.freeMargin ?? null,
              depositAsset: balance?.depositAsset ?? null,
              brokerName: balance?.brokerName ?? null,
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
