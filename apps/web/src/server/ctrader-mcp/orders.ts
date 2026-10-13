import type { CTraderMcpClient } from "./client";
import { cTraderOrdersResponseSchema, type CTraderOrder } from "./schemas";

export const getPendingOrders = async (
  client: CTraderMcpClient,
  ctraderAccountId?: number,
): Promise<CTraderOrder[]> => {
  const out = await client.callTool(
    "get_pending_orders",
    ctraderAccountId ? { accountId: ctraderAccountId } : {},
    cTraderOrdersResponseSchema,
  );
  return out.orders;
};
