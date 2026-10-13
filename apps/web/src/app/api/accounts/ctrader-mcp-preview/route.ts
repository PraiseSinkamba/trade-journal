import { bad, handler, ok } from "@/server/api";
import { listCTraderAccounts } from "@/server/ctrader-mcp/accounts";
import { CTraderMcpClient } from "@/server/ctrader-mcp/client";
import { CTraderMcpSyncError } from "@/server/ctrader-mcp/errors";

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
    if (err instanceof CTraderMcpSyncError) return bad(err.message, 502);
    throw err;
  } finally {
    await client.close().catch(() => undefined);
  }
});