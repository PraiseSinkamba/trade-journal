import type { CTraderMcpClient } from "./client";
import {
  cTraderOrderHistoryResponseSchema,
  type CTraderHistoricalOrder,
} from "./schemas";

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
    out.push(...page.orders);
  }
  return out;
};

/** cTrader order types that represent protective orders attached after entry, not the opener. */
const PROTECTIVE_ORDER_TYPES: Record<string, true> = {
  "Stop Loss": true,
  "Take Profit": true,
  Stop: true,
  "Trailing Stop": true,
  STOP_LOSS: true,
  TAKE_PROFIT: true,
  TRAILING_STOP: true,
};

const isProtectiveOrderType = (orderType: string | undefined): boolean =>
  orderType !== undefined && PROTECTIVE_ORDER_TYPES[orderType] === true;

/**
 * Reduce a list of historical orders to: positionId → earliest opening
 * time. Heuristic: the opener is the EARLIEST order that
 *   (a) shares `positionId` with a known close,
 *   (b) is on the OPPOSITE side of the close, and
 *   (c) is not a protective order (Stop Loss / Take Profit / Stop / Trailing Stop).
 * Returns an empty map for any position the heuristic cannot resolve; the
 * caller's fallback is to reuse the close time (existing behavior).
 */
export const openingTimeByPosition = (
  orders: CTraderHistoricalOrder[],
  closedDealByPosition: Map<string, { side: "Buy" | "Sell" }>,
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const order of orders) {
    if (!order.positionId || !order.time || !order.side) continue;
    if (isProtectiveOrderType(order.orderType)) continue;
    const close = closedDealByPosition.get(String(order.positionId));
    if (!close) continue; // not a position we have a close for
    if (order.side === close.side) continue; // this is the close order, not the opener
    const existing = map.get(String(order.positionId));
    if (!existing || order.time < existing) {
      map.set(String(order.positionId), order.time);
    }
  }
  return map;
};
