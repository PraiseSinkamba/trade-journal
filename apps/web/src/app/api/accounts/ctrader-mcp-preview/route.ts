import { bad, handler, ok } from "@/server/api";
import { listCTraderAccounts } from "@/server/ctrader-mcp/accounts";
import { CTraderMcpClient } from "@/server/ctrader-mcp/client";
import {
  CTraderMcpSyncError,
  type CTraderMcpSyncErrorKind,
} from "@/server/ctrader-mcp/errors";

interface PreviewBody {
  endpoint?: string;
  bearerToken?: string;
}

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as PreviewBody;
  if (!body.endpoint || !body.bearerToken) {
    return bad("endpoint and bearerToken required");
  }
  const client = new CTraderMcpClient({
    mode: "remote",
    endpoint: body.endpoint,
    bearerToken: body.bearerToken,
  });
  try {
    await client.initialize();
    const accounts = await listCTraderAccounts(client);
    return ok({ accounts });
  } catch (err) {
    if (err instanceof CTraderMcpSyncError) {
      const SAFE: Record<CTraderMcpSyncErrorKind, string> = {
        unreachable: "Can't reach cTrader MCP. Check the URL and that the desktop is running.",
        auth: "cTrader MCP authentication failed. For remote: refresh the token in cTrader Web → Settings → Remote MCP.",
        account_gone: "cTrader account is no longer accessible from this token. Re-connect the account.",
        rate_limited: "cTrader MCP rate-limited. Retry in a minute.",
        parse: "cTrader MCP returned unexpected data.",
        unknown: "cTrader MCP sync failed. Check server logs.",
      };
      return bad(SAFE[err.kind], 502);
    }
    throw err;
  } finally {
    await client.close().catch(() => undefined);
  }
});