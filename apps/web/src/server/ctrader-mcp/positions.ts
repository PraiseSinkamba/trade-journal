import type { CTraderMcpClient } from "./client";
import {
  cTraderPositionsResponseSchema,
  type CTraderPosition,
} from "./schemas";

export const getOpenPositions = (
  client: CTraderMcpClient,
): Promise<CTraderPosition[]> =>
  client.callTool("get_positions", {}, cTraderPositionsResponseSchema).then((r) => r.positions);
