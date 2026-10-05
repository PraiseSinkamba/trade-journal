import { describe, expect, it } from "vitest";
import { parseAuto } from "../src/detect";

const PEPPERSTONE_CSV = `symbol,side,quantity,price,data,trade_id,position_id,order_id,deal_kind,deal_type,volume_units,volume_lots,direction,pips,gross_profit,net_profit,swap,commission,close_price,open_time,close_time,execution_price,label,comment,account_login,account_id,broker,currency
AUDUSD,Buy,1000,0.7491,2021-10-20T04:01:11.068Z,,62957129,98864388,close_full,Market,1000,0.01,Buy,-0.3,-0.03,-0.03,0,0,0.7491,2021-10-20T03:50:40.242Z,2021-10-20T04:01:11.068Z,0.7491,,,1062789,22974766,Pepperstone,USD`;

describe("pepperstone cTrader order history", () => {
  it("auto-detects a Pepperstone cTrader export and parses one execution per row", () => {
    const result = parseAuto(PEPPERSTONE_CSV, { timeZone: "UTC" })!;
    expect(result.format).toBe("pepperstone");
    expect(result.executions).toHaveLength(1);
    expect(result.skippedRows).toBe(0);
  });
});



