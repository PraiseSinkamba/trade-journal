import type { CTraderMcpClient } from "./client";
import { cTraderOrderHistoryResponseSchema, type CTraderHistoricalOrder } from "./schemas";

export interface FetchOrderHistoryArgs {
  /** ISO-8601 lower bound (inclusive). */
  fromTime: string;
  /** ISO-8601 upper bound (exclusive). */
  toTime: string;
  symbolName?: string;
}

const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Local `get_order_history` is range-capped. Walk the requested window in
 * 30-day slices, concatenating results. Each call is independent — the
 * same date range can be re-queried on subsequent syncs; the unique
 * `(deal, dealId)` index handles dedup downstream.
 */
export const fetchOrderHistory = async (
  client: CTraderMcpClient,
  args: FetchOrderHistoryArgs,
): Promise<CTraderHistoricalOrder[]> => {
  const out: CTraderHistoricalOrder[] = [];
  const fromMs = Date.parse(args.fromTime);
  const toMs = Date.parse(args.toTime);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) return out;
  for (let start = fromMs; start < toMs; start += MAX_WINDOW_MS) {
    const end = Math.min(start + MAX_WINDOW_MS, toMs);
    const page = await client.callTool(
      "get_order_history",
      {
        fromTimestamp: new Date(start).toISOString(),
        toTimestamp: new Date(end).toISOString(),
        ...(args.symbolName ? { symbolName: args.symbolName } : {}),
      },
      cTraderOrderHistoryResponseSchema,
    );
    out.push(...page.trades);
  }
  return out;
};

/**
 * Reduce a list of historical trade records to: positionId → opening time.
 * The Local MCP returns flat-to-flat trade records (one per position), so
 * the heuristic is a direct lookup: any record whose `positionId` matches
 * a known close yields its `openTime` as the opening timestamp. Records
 * without `positionId` or `openTime` are skipped.
 */
export const openingTimeByPosition = (
  orders: CTraderHistoricalOrder[],
  closedDealByPosition: Map<string, { side: "Buy" | "Sell" }>,
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const order of orders) {
    if (!order.positionId || !order.openTime) continue;
    if (!closedDealByPosition.has(String(order.positionId))) continue; // not a position we have a close for
    map.set(String(order.positionId), order.openTime);
  }
  return map;
};
