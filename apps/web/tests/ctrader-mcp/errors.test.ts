import { describe, expect, it } from "vitest";
import { CTraderMcpSyncError, classifyMcpError } from "@/server/ctrader-mcp/errors";

describe("CTraderMcpSyncError", () => {
  it("preserves kind on instanceof check", () => {
    const e = new CTraderMcpSyncError("auth", "rejected");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(CTraderMcpSyncError);
    expect(e.kind).toBe("auth");
    expect(e.message).toBe("rejected");
  });

  it("is catchable as Error", () => {
    try {
      throw new CTraderMcpSyncError("unreachable", "down");
    } catch (err) {
      expect((err as Error).message).toBe("down");
    }
  });
});

describe("classifyMcpError", () => {
  it("never echoes raw error message to output", () => {
    const input = new Error("server leaked credential XYZ and secret token ABC");
    const result = classifyMcpError(input);
    expect(result.message).not.toContain("leaked");
    expect(result.message).not.toContain("credential");
    expect(result.message).not.toContain("XYZ");
    expect(result.message).not.toContain("ABC");
  });

  it("preserves original error as cause", () => {
    const input = new Error("ECONNREFUSED 127.0.0.1:9876");
    const result = classifyMcpError(input);
    expect(result.cause).toBe(input);
  });

  it("classifies unreachable by pattern", () => {
    for (const msg of ["ECONNREFUSED", "ENOTFOUND", "fetch failed", "Network request failed"]) {
      const result = classifyMcpError(new Error(msg));
      expect(result.kind).toBe("unreachable");
      expect(result.message).toMatch(/Can't reach cTrader MCP/);
      expect(result.cause).toBeInstanceOf(Error);
    }
  });

  it("unreachable message includes endpoint when provided", () => {
    const result = classifyMcpError(new Error("ECONNREFUSED"), {
      endpoint: "http://127.0.0.1:9876/mcp/",
    });
    expect(result.message).toContain("http://127.0.0.1:9876/mcp/");
  });

  it("classifies auth by pattern", () => {
    for (const msg of ["401 Unauthorized", "403 Forbidden", "Unauthorized"]) {
      const result = classifyMcpError(new Error(msg));
      expect(result.kind).toBe("auth");
      expect(result.message).toMatch(/^cTrader MCP authentication failed/);
      expect(result.cause).toBeInstanceOf(Error);
    }
  });

  it("classifies rate_limited by pattern", () => {
    for (const msg of ["429 Too Many Requests", "rate limit exceeded"]) {
      const result = classifyMcpError(new Error(msg));
      expect(result.kind).toBe("rate_limited");
      expect(result.message).toBe("cTrader MCP rate-limited. Retry in a minute.");
      expect(result.cause).toBeInstanceOf(Error);
    }
  });

  it("classifies unknown by default", () => {
    const result = classifyMcpError(new Error("something went wrong"));
    expect(result.kind).toBe("unknown");
    expect(result.message).toBe("cTrader MCP sync failed. Check server logs.");
    expect(result.cause).toBeInstanceOf(Error);
  });

  it("returns CTraderMcpSyncError unchanged", () => {
    const original = new CTraderMcpSyncError("auth", "already sanitized");
    const result = classifyMcpError(original);
    expect(result).toBe(original);
  });
});
