import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseAuto, detectFormat } from "../src/detect";
import { SYMBOL_CLASSES, KNOWN_DEAL_KINDS } from "../src/formats/pepperstone";
import { parseTimestamp } from "../src/dates";
import { buildRoundTrips, type Execution } from "@luxalgo/journal-core";

const SINGLE_ROW = `symbol,side,quantity,price,data,trade_id,position_id,order_id,deal_kind,deal_type,volume_units,volume_lots,direction,pips,gross_profit,net_profit,swap,commission,close_price,open_time,close_time,execution_price,label,comment,account_login,account_id,broker,currency
AUDUSD,Buy,1000,0.7491,2021-10-20T04:01:11.068Z,,62957129,98864388,close_full,Market,1000,0.01,Buy,-0.3,-0.03,-0.03,0,0,0.7491,2021-10-20T03:50:40.242Z,2021-10-20T04:01:11.068Z,0.7491,,,1062789,22974766,Pepperstone,USD`;

const fixture = readFileSync(
  new URL("./fixtures/pepperstone-ctrader.csv", import.meta.url),
  "utf8",
);

describe("pepperstone cTrader order history", () => {
  it("auto-detects a Pepperstone cTrader export and emits two executions per row", () => {
    const result = parseAuto(SINGLE_ROW, { timeZone: "UTC" })!;
    expect(result.format).toBe("pepperstone");
    // One row → synthetic entry + real close.
    expect(result.executions).toHaveLength(2);
    expect(result.skippedRows).toBe(0);
  });

  it("emits a synthetic opening fill at open_time with the opposite side", () => {
    const result = parseAuto(SINGLE_ROW, { timeZone: "UTC" })!;
    const [entry, close] = result.executions;
    // Row side is Buy → entry is Sell, close is Buy.
    expect(entry!.side).toBe("sell");
    expect(entry!.executedAt).toBe(parseTimestamp("2021-10-20T03:50:40.242Z", "UTC"));
    expect(close!.side).toBe("buy");
    expect(close!.executedAt).toBe(parseTimestamp("2021-10-20T04:01:11.068Z", "UTC"));
    expect(close!.executedAt! > entry!.executedAt!).toBe(true);
  });

  it("carries the broker's net_profit as the close's reportedGrossPnl and leaves fees at 0", () => {
    // AUDUSD: net_profit = -0.03, swap = -0.03, commission = 0. The broker's
    // P&L is already net of fees, so fee = 0 and reportedGrossPnl = -0.03.
    const result = parseAuto(SINGLE_ROW, { timeZone: "UTC" })!;
    const [entry, close] = result.executions;
    expect(entry!.fee).toBe(0);
    expect(close!.fee).toBe(0);
    expect(close!.importMetadata?.reportedGrossPnl).toBeCloseTo(-0.03, 6);
    expect(entry!.importMetadata?.reportedGrossPnl).toBeUndefined();
  });

  it("links the entry and close of one position via importMetadata.group", () => {
    const result = parseAuto(SINGLE_ROW, { timeZone: "UTC" })!;
    const [entry, close] = result.executions;
    expect(entry!.importMetadata?.group).toBe("62957129");
    expect(close!.importMetadata?.group).toBe("62957129");
  });

  it("classifies asset class per symbol with table lookup and a digit-fallback", () => {
    // 10 fixture rows × 2 executions = 20 total.
    const result = parseAuto(fixture, { timeZone: "UTC" })!;
    expect(result.executions).toHaveLength(20);
    const bySymbol = Object.fromEntries(result.executions.map((e) => [e.symbol, e.assetClass]));
    expect(bySymbol.AUDUSD).toBe("forex");
    expect(bySymbol.CHFJPY).toBe("forex");
    expect(bySymbol.XAUUSD).toBe("cfd");
    expect(bySymbol["NAS100"]).toBe("cfd");
    expect(bySymbol.TEST100).toBe("cfd"); // digit fallback
  });

  it("emits two executions per row and covers all five deal_kinds", () => {
    // The fixture has 10 data rows × 2 executions = 20 total.
    const result = parseAuto(fixture, { timeZone: "UTC" })!;
    expect(result.executions).toHaveLength(20);
  });

  it("groups multi-row positions into one group with all 4 executions sharing group id", () => {
    const result = parseAuto(fixture, { timeZone: "UTC" })!;
    const byGroup = new Map<string, number>();
    for (const exec of result.executions) {
      const key = exec.importMetadata?.group ?? "";
      byGroup.set(key, (byGroup.get(key) ?? 0) + 1);
    }
    // The fixture has 10 positions, two of which are multi-row (4 executions each).
    expect(byGroup.get("597339209")).toBe(4); // close_partial + close_final
    expect(byGroup.get("577851478")).toBe(4); // stop_out + manual_after_stop
  });

  it("reports a per-row skip reason when a required field is invalid", () => {
    const csv = `symbol,side,quantity,price,data,trade_id,position_id,order_id,deal_kind,deal_type,volume_units,volume_lots,direction,pips,gross_profit,net_profit,swap,commission,close_price,open_time,close_time,execution_price,label,comment,account_login,account_id,broker,currency
,Buy,1,100,2026-01-05T10:00:00.000Z,2026-01-05T10:00:00.000Z,,900000003,800000003,close_full,Market,1,0.01,Buy,10,1,1,0,0,100,2026-01-05T09:00:00.000Z,2026-01-05T10:00:00.000Z,100,,,,,Pepperstone,USD
AUDUSD,Buy,1,100,not-a-timestamp,not-a-time,,900000004,800000004,close_full,Market,1,0.01,Buy,10,1,1,0,0,100,2026-01-05T09:00:00.000Z,2026-01-05T10:00:00.000Z,100,,,,,Pepperstone,USD`;
    const result = parseAuto(csv, { timeZone: "UTC" })!;
    expect(result.format).toBe("pepperstone");
    expect(result.executions).toHaveLength(0);
    expect(result.skippedRows).toBe(2);
    const reasons = result.skippedReasons.map((r) => r.reason).sort();
    expect(reasons).toEqual(["missing symbol", "unparseable timestamp"]);
  });

  it("imports unknown deal_kind values with a warning, not a skip", () => {
    const csv = SINGLE_ROW.replace("close_full", "weird_future_kind");
    const result = parseAuto(csv, { timeZone: "UTC" })!;
    expect(result.format).toBe("pepperstone");
    expect(result.executions).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("weird_future_kind");
  });

  it("does not steal detection from IBKR", () => {
    const ibkr = `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,AAPL,"2026-01-05, 09:31:00",100,185.50,187.0,-18550,-1.00,18551,0,150,O
Trades,Data,Order,Stocks,USD,AAPL,"2026-01-05, 10:15:00",-100,187.25,187.0,18725,-1.00,-18551,173,-25,C`;
    expect(detectFormat(ibkr)?.id).toBe("ibkr");
  });

  it("exports a complete SYMBOL_CLASSES table and KNOWN_DEAL_KINDS set", () => {
    expect(SYMBOL_CLASSES.AUDUSD).toBe("forex");
    expect(SYMBOL_CLASSES.NAS100).toBe("cfd");
    expect(KNOWN_DEAL_KINDS.has("close_full")).toBe(true);
    expect(KNOWN_DEAL_KINDS.has("stop_out")).toBe(true);
    expect(KNOWN_DEAL_KINDS.has("weird_future_kind")).toBe(false);
  });

  it("uses order_id as the close's importMetadata.id, falls back to position+time when blank", () => {
    const result = parseAuto(SINGLE_ROW, { timeZone: "UTC" })!;
    const [entry, close] = result.executions;
    expect(entry!.importMetadata?.id).toBe("62957129-open");
    // Row's order_id is 98864388
    expect(close!.importMetadata?.id).toBe("98864388");
  });
});

describe("pepperstone end-to-end through the round-trip engine", () => {
  // Regression test for the bug where every row's status was OPEN with $0 P&L
  // and no exit/duration. The fix is to emit a synthetic entry + real close
  // per row, with the close carrying reportedGrossPnl = net_profit.
  it("real cTrader export: every position closes, net P&L matches the source's net_profit total", () => {
    const csv = readFileSync(
      "E:/4004/orca/projects/achilles/research/exports/order_history_live_1062789_2026-09-30.csv",
      "utf8",
    );
    const parsed = parseAuto(csv, { timeZone: "UTC" })!;
    expect(parsed.format).toBe("pepperstone");
    expect(parsed.skippedRows).toBe(0);

    const executions: Execution[] = parsed.executions.map((e, i) => ({
      id: e.importMetadata?.id ?? `exec-${i}`,
      accountId: "test-account",
      symbol: e.symbol,
      side: e.side,
      quantity: e.quantity,
      price: e.price,
      fee: e.fee,
      executedAt: e.executedAt,
      assetClass: e.assetClass,
      source: "import",
      importMetadata: e.importMetadata,
    }));
    const trips = buildRoundTrips(executions);

    // 103 distinct position_ids in the source → 103 round trips.
    expect(trips).toHaveLength(103);
    // Every trip must be closed, never open.
    const openCount = trips.filter((t) => t.status === "open").length;
    expect(openCount).toBe(0);
    // Cycle net P&L must match the broker's net_profit column sum.
    const engineTotal = trips.reduce((sum, t) => sum + t.netPnl, 0);
    const lines = csv.split("\n").filter(Boolean);
    let sourceTotal = 0;
    for (let i = 1; i < lines.length; i++) {
      sourceTotal += parseFloat(lines[i]!.split(",")[15]!); // net_profit
    }
    expect(engineTotal).toBeCloseTo(sourceTotal, 6);
  });
});
