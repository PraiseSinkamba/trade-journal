import type { CTraderMcpClient } from "./client";
import { cTraderAccountInfoSchema } from "./schemas";

export const getAccountInfo = async (
  client: CTraderMcpClient,
  ctraderAccountId?: number,
) => {
  return client.callTool(
    "get_account_info",
    ctraderAccountId ? { accountId: ctraderAccountId } : {},
    cTraderAccountInfoSchema,
  );
};
