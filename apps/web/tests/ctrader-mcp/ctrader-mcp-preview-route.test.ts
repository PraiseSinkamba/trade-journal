import { describe, expect, it, vi } from "vitest";
import { CTraderMcpClient } from "@/server/ctrader-mcp/client";
import { CTraderMcpSyncError } from "@/server/ctrader-mcp/errors";

vi.mock("@/server/ctrader-mcp/client", () => ({
  CTraderMcpClient: vi.fn(),
}));

describe("POST /api/accounts/ctrader-mcp-preview", () => {
  it("does not echo sensitive upstream error messages to the response body", async () => {
    const sensitive = "cTrader MCP server leaked credential SUPER_SECRET_TOKEN_12345 to logs";
    const syncErr = new CTraderMcpSyncError("auth", sensitive);
    const mockClient = {
      initialize: vi.fn().mockRejectedValue(syncErr),
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(CTraderMcpClient).mockImplementation(
      () => mockClient as unknown as InstanceType<typeof CTraderMcpClient>,
    );

    const { POST } = await import("@/app/api/accounts/ctrader-mcp-preview/route");
    const req = new Request("http://localhost/api/accounts/ctrader-mcp-preview", {
      method: "POST",
      body: JSON.stringify({
        endpoint: "http://127.0.0.1:9876/mcp/",
        bearerToken: "test-token",
      }),
    });

    const res = await POST(req as Request);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message?: string };
    expect(body.message ?? "").not.toContain("SUPER_SECRET");
    expect(body.message ?? "").not.toContain("leaked");
    expect(body.message ?? "").not.toContain("credential");
  });
});
