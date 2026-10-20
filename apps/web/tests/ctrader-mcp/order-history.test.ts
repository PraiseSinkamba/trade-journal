import { describe, expect, it, vi } from "vitest";
import { fetchOrderHistory, openingTimeByPosition } from "@/server/ctrader-mcp/order-history";
import type { CTraderHistoricalOrder } from "@/server/ctrader-mcp/schemas";

const baseOrder = (overrides: Partial<CTraderHistoricalOrder> = {}): CTraderHistoricalOrder => ({
  positionId: 100,
  symbolName: "NAS100",
  side: "Buy",
  openTime: "2026-10-15T13:55:00.000Z",
  closeTime: "2026-10-15T14:01:25.056Z",
  ...overrides,
});

describe("openingTimeByPosition", () => {
  it("returns openTime for each closed position keyed by positionId", () => {
    const orders: CTraderHistoricalOrder[] = [
      baseOrder({ positionId: 100, openTime: "2026-10-15T13:55:00.000Z" }),
      baseOrder({ positionId: 200, openTime: "2026-10-15T14:30:00.000Z", side: "Sell" }),
    ];
    const closes = new Map<string, { side: "Buy" | "Sell" }>([
      ["100", { side: "Sell" }],
      ["200", { side: "Buy" }],
    ]);
    const out = openingTimeByPosition(orders, closes);
    expect(out.get("100")).toBe("2026-10-15T13:55:00.000Z");
    expect(out.get("200")).toBe("2026-10-15T14:30:00.000Z");
  });

  it("skips orders without a matching closedDealByPosition entry", () => {
    const orders: CTraderHistoricalOrder[] = [
      baseOrder({ positionId: 999, openTime: "2026-10-15T13:55:00.000Z" }),
    ];
    const closes = new Map<string, { side: "Buy" | "Sell" }>([["100", { side: "Sell" }]]);
    const out = openingTimeByPosition(orders, closes);
    expect(out.has("999")).toBe(false);
  });

  it("skips orders without positionId or openTime", () => {
    const orders: CTraderHistoricalOrder[] = [
      baseOrder({ openTime: undefined, positionId: 100 }),
      baseOrder({ positionId: undefined, openTime: "2026-10-15T13:55:00.000Z" }),
    ];
    const closes = new Map<string, { side: "Buy" | "Sell" }>([["100", { side: "Sell" }]]);
    const out = openingTimeByPosition(orders, closes);
    expect(out.size).toBe(0);
  });

  it("returns an empty map for an empty input", () => {
    const out = openingTimeByPosition([], new Map());
    expect(out.size).toBe(0);
  });

  it("does not require a side on the historical record (flat-to-flat from the Local MCP)", () => {
    const orders: CTraderHistoricalOrder[] = [
      baseOrder({ positionId: 100, side: undefined, openTime: "2026-10-15T13:55:00.000Z" }),
    ];
    const closes = new Map<string, { side: "Buy" | "Sell" }>([["100", { side: "Sell" }]]);
    const out = openingTimeByPosition(orders, closes);
    expect(out.get("100")).toBe("2026-10-15T13:55:00.000Z");
  });
});

describe("fetchOrderHistory (Local)", () => {
  it("returns an empty array for an invalid range", async () => {
    const fake = {
      callTool: vi.fn(),
      initialize: async () => undefined,
      close: async () => undefined,
    };
    const out = await fetchOrderHistory(
      fake as unknown as Parameters<typeof fetchOrderHistory>[0],
      { fromTime: "not-a-date", toTime: "2026-10-15T00:00:00Z" },
    );
    expect(out).toEqual([]);
    expect(fake.callTool).not.toHaveBeenCalled();
  });

  it("returns an empty array when fromTime >= toTime", async () => {
    const fake = {
      callTool: vi.fn(),
      initialize: async () => undefined,
      close: async () => undefined,
    };
    const out = await fetchOrderHistory(
      fake as unknown as Parameters<typeof fetchOrderHistory>[0],
      { fromTime: "2026-10-15T00:00:00Z", toTime: "2026-10-15T00:00:00Z" },
    );
    expect(out).toEqual([]);
    expect(fake.callTool).not.toHaveBeenCalled();
  });

  it("issues a single call when the range is within 30 days and reads `trades`", async () => {
    const callTool = vi.fn().mockResolvedValue({ trades: [baseOrder()] });
    const fake = { callTool, initialize: async () => undefined, close: async () => undefined };
    const out = await fetchOrderHistory(
      fake as unknown as Parameters<typeof fetchOrderHistory>[0],
      { fromTime: "2026-10-01T00:00:00.000Z", toTime: "2026-10-15T00:00:00.000Z" },
    );
    expect(out).toHaveLength(1);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(
      "get_order_history",
      expect.objectContaining({
        fromTimestamp: "2026-10-01T00:00:00.000Z",
        toTimestamp: "2026-10-15T00:00:00.000Z",
      }),
      expect.anything(),
    );
  });

  it("splits ranges longer than 30 days into multiple 30-day windows", async () => {
    const callTool = vi
      .fn()
      .mockImplementation((_name: string, args: { fromTimestamp: string }) => {
        const start = new Date(args.fromTimestamp).getTime();
        return Promise.resolve({
          trades: [baseOrder({ positionId: start, openTime: new Date(start).toISOString() })],
        });
      });
    const fake = { callTool, initialize: async () => undefined, close: async () => undefined };
    const out = await fetchOrderHistory(
      fake as unknown as Parameters<typeof fetchOrderHistory>[0],
      { fromTime: "2026-01-01T00:00:00.000Z", toTime: "2026-05-01T00:00:00.000Z" }, // 120 days
    );
    // 120 / 30 = 4 windows
    expect(callTool).toHaveBeenCalledTimes(4);
    expect(out).toHaveLength(4);
    // Each call's toTimestamp advances by exactly 30 days.
    const calls = callTool.mock.calls;
    for (let i = 1; i < calls.length; i++) {
      const prev = new Date(calls[i - 1]![1]!.toTimestamp as string).getTime();
      const curr = new Date(calls[i]![1]!.toTimestamp as string).getTime();
      expect(curr - prev).toBe(30 * 24 * 60 * 60 * 1000);
    }
  });

  it("passes symbolName through to the tool when provided", async () => {
    const callTool = vi.fn().mockResolvedValue({ trades: [] });
    const fake = { callTool, initialize: async () => undefined, close: async () => undefined };
    await fetchOrderHistory(fake as unknown as Parameters<typeof fetchOrderHistory>[0], {
      fromTime: "2026-10-01T00:00:00.000Z",
      toTime: "2026-10-15T00:00:00.000Z",
      symbolName: "NAS100",
    });
    expect(callTool).toHaveBeenCalledWith(
      "get_order_history",
      expect.objectContaining({ symbolName: "NAS100" }),
      expect.anything(),
    );
  });
});
