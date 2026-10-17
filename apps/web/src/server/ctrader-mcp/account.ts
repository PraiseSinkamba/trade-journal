import type { CTraderMcpClient } from "./client";
import { cTraderBalanceSchema, type CTraderBalance } from "./schemas";

export const getAccountBalance = (client: CTraderMcpClient): Promise<CTraderBalance> =>
  client.callTool("get_balance", {}, cTraderBalanceSchema);
