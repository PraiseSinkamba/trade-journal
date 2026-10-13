import { describe, expect, it } from "vitest";
import { CTraderMcpSyncError } from "@/server/ctrader-mcp/errors";

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
