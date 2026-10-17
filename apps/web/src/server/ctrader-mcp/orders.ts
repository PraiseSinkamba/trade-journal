import type { CTraderMcpClient } from "./client";
import {
  cTraderOrdersResponseSchema,
  type CTraderOrder,
} from "./schemas";

export const getPendingOrders = (
  client: CTraderMcpClient,
): Promise<CTraderOrder[]> =>
  client.callTool("get_pending_orders", {}, cTraderOrdersResponseSchema).then((r) => r.orders);
