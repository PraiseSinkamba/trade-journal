import { listBrokers } from "@/server/sync";
import { handler, ok } from "@/server/api";

/** Broker roster straight from @luxalgo/broker-sdk, plus the ADR-0002 cTrader MCP broker. */
export const GET = handler(() => {
  const brokers = listBrokers();
  return ok({
    brokers: [
      ...brokers,
      {
        id: "ctrader-mcp",
        displayName: "cTrader (MCP)",
        credentials: [],
        readOnlySetup:
            "Enable the MCP server in cTrader Desktop → Settings → MCP Server. The journal connects to http://127.0.0.1:9876/mcp/.",
        supportsBars: false,
      },
    ],
  });
});