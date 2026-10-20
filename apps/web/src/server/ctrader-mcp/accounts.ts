import type { CTraderMcpClient } from "./client";
import { cTraderAccountsResponseSchema, type CTraderAccount } from "./schemas";

export const listCTraderAccounts = async (client: CTraderMcpClient): Promise<CTraderAccount[]> => {
  const out = await client.callTool("get_accounts_list", {}, cTraderAccountsResponseSchema);
  return out.accounts;
};
