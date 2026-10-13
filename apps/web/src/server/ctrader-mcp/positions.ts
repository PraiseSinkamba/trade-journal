import type { CTraderMcpClient } from "./client";
import { cTraderPositionsResponseSchema, type CTraderPosition } from "./schemas";

export const getOpenPositions = async (
  client: CTraderMcpClient,
  ctraderAccountId?: number,
): Promise<CTraderPosition[]> => {
  const out = await client.callTool(
    "get_positions",
    ctraderAccountId ? { accountId: ctraderAccountId } : {},
    cTraderPositionsResponseSchema,
  );
  return out.positions;
};
