import { z } from "zod";

export const remoteFormSchema = z.object({
  mode: z.literal("remote"),
  endpoint: z.string().url(),
  bearerToken: z.string().min(1),
  ctraderAccountId: z.number().int().positive(),
});

export const localFormSchema = z.object({
  mode: z.literal("local"),
  endpoint: z.string().url(),
  authHeader: z.string().optional(),
});

export const cTraderMcpFormSchema = z.discriminatedUnion("mode", [
  remoteFormSchema,
  localFormSchema,
]);

export type CTraderMcpFormValues = z.infer<typeof cTraderMcpFormSchema>;

/** Shape returned by the cTrader MCP `get_account_list_by_access_token` tool. */
export interface CTraderAccount {
  accountId: number;
  brokerName: string;
  currency: string;
}

export const defaultRemoteEndpoint = "https://mcp.ctrader.com/";
export const defaultLocalEndpoint = "http://127.0.0.1:9876/mcp/";

export const cTraderMcpBrokerId = "ctrader-mcp";