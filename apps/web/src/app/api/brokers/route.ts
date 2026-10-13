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
            "cTrader Live sync via cTrader's MCP servers (Local or Web Remote token). Pick the mode after selecting this broker.",
        supportsBars: false,
      },
    ],
  });
});