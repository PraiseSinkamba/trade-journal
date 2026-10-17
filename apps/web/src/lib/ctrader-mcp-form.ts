import { z } from "zod";

/**
 * Local-only cTrader MCP credentials. The journal connects to cTrader Desktop's
 * embedded MCP server; no bearer token, no per-account auth token, no remote
 * mode. `ctraderAccountId` is selected after a `get_accounts_list` preview.
 */
export const cTraderMcpFormSchema = z.object({
  endpoint: z.string().url(),
  authHeader: z.string().optional(),
  ctraderAccountId: z.number().int().positive(),
});

export type CTraderMcpFormValues = z.infer<typeof cTraderMcpFormSchema>;

/** Shape returned by the cTrader Desktop `get_accounts_list` tool. */
export interface CTraderAccount {
  id: number;
  login: number;
  accountName: string;
  brokerTitle: string;
  isLive: boolean;
  balance: number;
  currency: string;
  accountType: string;
  isOnline: boolean;
}

/** Default Local MCP endpoint exposed by cTrader Desktop. */
export const defaultEndpoint = "http://127.0.0.1:9876/mcp/";

export const cTraderMcpBrokerId = "ctrader-mcp";
