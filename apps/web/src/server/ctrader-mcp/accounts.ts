import type { CTraderMcpClient } from "./client";
import { cTraderAccountsResponseSchema } from "./schemas";

export const listCTraderAccounts = async (client: CTraderMcpClient) => {
  const out = await client.callTool(
    "get_account_list_by_access_token",
    {},
    cTraderAccountsResponseSchema,
  );
  return out.accounts;
};
