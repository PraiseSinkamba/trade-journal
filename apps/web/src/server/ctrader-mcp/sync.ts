import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { db, accounts } from "@/db";
import { decryptJson } from "@/server/crypto";
import { nowIso } from "@/server/ids";
import { insertExecutions, type InsertResult } from "@/server/executions";
import { CTraderMcpClient } from "./client";
import { classifyMcpError, CTraderMcpSyncError } from "./errors";
import { getAccountBalance } from "./account";
import { fetchAllDeals, mapClosedPositionToExecutions, mapDealToExecution } from "./deals";
import { getPendingOrders } from "./orders";
import { getOpenPositions } from "./positions";
import { fetchSymbols, findAssetClass } from "./symbols";
import {
  fetchOrderHistory,
  openingTimeByPosition,
} from "./order-history";
import {
  type AssetClass,
  type CTraderBalance,
  type CTraderDeal,
  type CTraderOrder,
  type CTraderPosition,
} from "./schemas";

/** 5-year lookback for the order-history window. The earliest deal may be years old. */
const ORDER_HISTORY_LOOKBACK_MS = 5 * 365 * 24 * 60 * 60 * 1000;

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

    // Open positions are fetched before deals so a closed position whose
    // entry fell off the 200-deal window still pairs with a synthetic open.
    positions = await getOpenPositions(client);
    const openPositionIds = new Set(positions.map((p) => String(p.positionId)));

    const deals = await fetchAllDeals(client);

    // Recover the opening time of closed positions from the order history
    // stream. This is non-fatal: if `get_order_history` fails the sync still
    // completes with `durationMs: 0` for closed positions (existing behavior).
    // The history fetch sits OUTSIDE the transaction so a transport hiccup
    // never rolls back a successful deal write.
    const closedDealByPosition = new Map<string, CTraderDeal>();
    for (const deal of deals) {
      if (openPositionIds.has(String(deal.positionId))) continue;
      // Latest close per position is enough — the heuristic only needs side.
      const prior = closedDealByPosition.get(String(deal.positionId));
      if (!prior || deal.time > prior.time) closedDealByPosition.set(String(deal.positionId), deal);
    }
    const historyFrom = deals.length > 0
      ? deals.reduce((min, d) => (d.time < min ? d.time : min), deals[0]!.time)
      : new Date(Date.now() - ORDER_HISTORY_LOOKBACK_MS).toISOString();
    let openingTimes = new Map<string, string>();
    try {
      const orders = await fetchOrderHistory(client, { fromTime: historyFrom, toTime: syncedAt });
      openingTimes = openingTimeByPosition(orders, new Map(
        [...closedDealByPosition.entries()].map(([id, d]) => [id, { side: d.side }]),
      ));
    } catch (historyErr) {
      // Non-fatal: fall through with empty openingTimes → existing durationMs: 0 behavior.
      console.warn("[ctrader-mcp] get_order_history failed; closed trades will have durationMs=0", historyErr);
    }

    // Group deals by positionId. A group with ≥ 2 deals means both sides of
    // the cycle are in the deal stream and the engine can pair them as-is.
    // A single-deal group means the entry fell off the window — emit a
    // synthetic opening fill alongside the real close.
    const groups = new Map<string, { deals: typeof deals; assetClass: AssetClass }>();
    let dealIndex = 0;
    for (const deal of deals) {
      const key = String(deal.positionId);
      let group = groups.get(key);
      if (!group) {
        group = { deals: [], assetClass: findAssetClass(symbols, deal.symbolName) };
        groups.set(key, group);
      }
      group.deals.push(deal);
    }

    const rows: ImportedExecution[] = [];
    for (const [positionId, group] of groups) {
      const isOpen = openPositionIds.has(positionId);
      if (isOpen) {
        for (const deal of group.deals) {
          rows.push(mapDealToExecution(deal, deal.symbolName, group.assetClass, dealIndex++));
        }
        continue;
      }
      if (group.deals.length >= 2) {
        const sorted = [...group.deals].sort((a, b) => a.time.localeCompare(b.time));
        sorted.forEach((deal, idx) => {
          const isClose = idx === sorted.length - 1;
          const base = mapDealToExecution(deal, deal.symbolName, group.assetClass, dealIndex++);
          if (isClose && deal.grossProfit !== undefined) {
            base.importMetadata = {
              ...base.importMetadata!,
              reportedGrossPnl: deal.grossProfit,
            };
          }
          rows.push(base);
        });
        continue;
      }
      const onlyDeal = group.deals[0]!;
      rows.push(
        ...mapClosedPositionToExecutions(
          onlyDeal,
          onlyDeal.symbolName,
          group.assetClass,
          dealIndex++,
          openingTimes.get(positionId),
        ),
      );
    }
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
