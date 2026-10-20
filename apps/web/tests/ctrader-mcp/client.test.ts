import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { CTraderMcpClient, z } from "@/server/ctrader-mcp/client";
import { CTraderMcpSyncError } from "@/server/ctrader-mcp/errors";

const serverCalls: Array<{ method: string; body: unknown }> = [];
let server: http.Server | null = null;

const defaultCapabilities = { tools: {} };

const discoverResponse = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    supportedVersions: ["2026-07-28", "2025-11-25"],
    capabilities: defaultCapabilities,
  },
};

const initResponse = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: "2026-07-28",
    capabilities: defaultCapabilities,
    serverInfo: { name: "test", version: "1.0.0" },
  },
};

const defaultToolResponse = {
  jsonrpc: "2.0",
  id: 1,
  result: { content: [{ type: "text" as const, text: '{"value":42}' }] },
};

const startServer = async (): Promise<number> => {
  const { promise: portPromise, resolve: resolvePort } = Promise.withResolvers<number>();
  let toolResponse = defaultToolResponse;

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    let body: Record<string, unknown> = {};
    try {
      const raw = Buffer.concat(chunks);
      if (raw.length > 0) body = JSON.parse(raw.toString("utf8"));
    } catch {
      // ignore parse errors
    }
    serverCalls.push({ method: url.pathname, body });

    if (url.pathname.endsWith("/mcp")) {
      const reqId = (body as { id?: unknown }).id ?? 1;
      const method = (body as { method?: string }).method ?? "";
      let response: unknown;
      if (method === "server/discover") {
        response = { ...discoverResponse, id: reqId };
      } else if (method === "initialize") {
        response = { ...initResponse, id: reqId };
      } else if (method === "tools/call") {
        response = { ...toolResponse, id: reqId };
      } else {
        response = { jsonrpc: "2.0", id: reqId, result: null };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  server.listen(0, () => {
    const addr = server!.address();
    resolvePort(addr && typeof addr === "object" ? addr.port : 0);
  });

  // Expose toolResponse setter via closure
  (server as http.Server & { setToolResponse?: (r: unknown) => void }).setToolResponse = (r) => {
    toolResponse = r as typeof toolResponse;
  };

  return portPromise;
};

const stopServer = async (): Promise<void> => {
  if (!server) return;
  const { promise, resolve } = Promise.withResolvers<void>();
  server.close(() => resolve());
  await promise;
};

afterEach(async () => {
  await stopServer();
  server = null;
  serverCalls.length = 0;
});

describe("CTraderMcpClient", () => {
  it("sends JSON-RPC initialize on initialize()", async () => {
    const port = await startServer();
    const client = new CTraderMcpClient({
      mode: "local",
      endpoint: `http://127.0.0.1:${port}/mcp`,
    });
    await client.initialize();
    expect(serverCalls.length).toBeGreaterThan(0);
    const init = serverCalls.find((c) => (c.body as { method?: string }).method === "initialize");
    expect(init).toBeDefined();
  });

  it("sends Authorization: Bearer for remote mode", async () => {
    let lastAuthHeader: string | null = null;
    await stopServer();
    server = http.createServer(async (req, res) => {
      lastAuthHeader = req.headers.authorization ?? null;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      let body: Record<string, unknown> = {};
      try {
        const raw = Buffer.concat(chunks);
        if (raw.length > 0) body = JSON.parse(raw.toString("utf8"));
      } catch {
        /* ignore */
      }
      const method = (body as { method?: string }).method ?? "";
      const reqId = (body as { id?: unknown }).id ?? 1;
      let response: unknown;
      if (method === "server/discover") {
        response = { ...discoverResponse, id: reqId };
      } else if (method === "initialize") {
        response = { ...initResponse, id: reqId };
      } else {
        response = { jsonrpc: "2.0", id: reqId, result: null };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
    const { promise: portPromise, resolve: resolvePort } = Promise.withResolvers<number>();
    server.listen(0, () => {
      const addr = server!.address();
      resolvePort(addr && typeof addr === "object" ? addr.port : 0);
    });
    const port = await portPromise;

    // First call: server/discover → need discover response
    // The MCP client will call server/discover first
    await new CTraderMcpClient({
      mode: "remote",
      endpoint: `http://127.0.0.1:${port}/mcp`,
      bearerToken: "tok-abc",
    }).initialize();

    expect(lastAuthHeader).toBe("Bearer tok-abc");
  });

  it("validates callTool responses with the supplied Zod schema", async () => {
    const port = await startServer();
    const client = new CTraderMcpClient({
      mode: "local",
      endpoint: `http://127.0.0.1:${port}/mcp`,
    });
    await client.initialize();

    const out = await client.callTool("ping", {}, z.object({ value: z.number() }));
    expect(out.value).toBe(42);
  });

  it("raises CTraderMcpSyncError with kind=parse when response fails Zod", async () => {
    const port = await startServer();
    // Override tool response to return invalid data
    (server as http.Server & { setToolResponse?: (r: unknown) => void }).setToolResponse?.({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text" as const, text: '{"value":"not-a-number"}' }] },
    });
    const client = new CTraderMcpClient({
      mode: "local",
      endpoint: `http://127.0.0.1:${port}/mcp`,
    });
    await client.initialize();
    const schema = z.object({ value: z.number() });
    await expect(client.callTool("ping", {}, schema)).rejects.toMatchObject({ kind: "parse" });
  });

  it("classifies ECONNREFUSED as unreachable", async () => {
    const client = new CTraderMcpClient({
      mode: "local",
      endpoint: "http://127.0.0.1:1/mcp",
    });
    await expect(client.initialize()).rejects.toMatchObject({ kind: "unreachable" });
  });
});
