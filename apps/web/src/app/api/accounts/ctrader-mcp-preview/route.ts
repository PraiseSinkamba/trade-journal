import { bad, handler, ok } from "@/server/api";
import { listCTraderAccounts } from "@/server/ctrader-mcp/accounts";
import { CTraderMcpClient } from "@/server/ctrader-mcp/client";
import {
  CTraderMcpSyncError,
  type CTraderMcpSyncErrorKind,
} from "@/server/ctrader-mcp/errors";

interface PreviewBody {
  endpoint?: string;
  authHeader?: string;
}

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as PreviewBody;
  if (!body.endpoint) {
    return bad("endpoint required");
  }
  const client = new CTraderMcpClient({
    mode: "local",
    endpoint: body.endpoint,
    ...(body.authHeader ? { authHeader: body.authHeader } : {}),
  });
  try {
    await client.initialize();
    const accounts = await listCTraderAccounts(client);
    return ok({ accounts });
  } catch (err) {
    if (err instanceof CTraderMcpSyncError) {
      const SAFE: Record<CTraderMcpSyncErrorKind, string> = {
        unreachable:
          "Can't reach cTrader MCP. Check the URL and that cTrader Desktop is running.",
        auth: "cTrader MCP authentication failed. Check the Authorization header and that the desktop is running.",
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
