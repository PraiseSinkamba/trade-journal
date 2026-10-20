import type { ImportedExecution } from "@luxalgo/journal-importers";
import type { CTraderMcpClient } from "./client";
import { cTraderDealsResponseSchema, type AssetClass, type CTraderDeal } from "./schemas";

export interface FetchDealsArgs {
  count?: number;
  symbolName?: string;
}

const MAX_DEALS_PER_PAGE = 200;

/**
 * Local `get_deals` paginates by `count` only (no time cursor, no offset).
 * Each call returns up to `count` deals; the desktop session never pages
 * past 200. Subsequent syncs re-pull the same window and rely on the
 * unique `executionHash` + `executions_account_hash` index for dedup.
 * See docs/superpowers/specs/2026-10-13-ctrader-mcp-sync-design.md.
 */
export const fetchAllDeals = async (
  client: CTraderMcpClient,
  args: FetchDealsArgs = {},
): Promise<CTraderDeal[]> => {
  const count = Math.min(args.count ?? MAX_DEALS_PER_PAGE, MAX_DEALS_PER_PAGE);
  const out = await client.callTool(
    "get_deals",
    {
      count,
      ...(args.symbolName ? { symbolName: args.symbolName } : {}),
    },
    cTraderDealsResponseSchema,
  );
  return out.deals;
};

/** Composite dedup key, stable across reorders and re-pulls. */
export const dealExecutionId = (deal: CTraderDeal): string =>
  `${deal.orderId ?? ""}:${deal.time}:${deal.filledVolume}:${deal.executionPrice}`;

export const mapDealToExecution = (
  deal: CTraderDeal,
  symbolName: string,
  assetClass: AssetClass,
  dealIndex: number,
): ImportedExecution => ({
  symbol: symbolName,
  side: deal.side === "Buy" ? "buy" : "sell",
  quantity: deal.filledVolume,
  price: deal.executionPrice,
  fee: Math.abs(deal.commission ?? 0) + Math.abs(deal.swap ?? 0),
  executedAt: deal.time,
  assetClass: assetClass === "stock" ? "equity" : assetClass,
  importMetadata: {
    id: dealExecutionId(deal),
    group: String(deal.positionId),
    order: dealIndex,
    preserveFee: true,
  },
});

/**
 * Build a synthetic entry + real close for a closed position whose opening
 * fill is missing from the deal stream. Local `get_deals` is capped at 200
 * with no time filter, so any position whose entry was older than the latest
 * 200 deals appears only as a closing fill.
 *
 * If `openingTime` is supplied (recovered from `get_order_history`), the
 * synthetic entry uses it as `executedAt`, giving the round-trip engine a
 * real `durationMs`. Without it, the synthetic entry uses the close time as
 * a best-effort estimate and `durationMs` is 0 — the documented fallback.
 *
 * `reportedGrossPnl` on the close carries `grossProfit` straight to the
 * round-trip engine, which uses it verbatim (see
 * `packages/core/src/round-trips.ts`).
 */
export const mapClosedPositionToExecutions = (
  deal: CTraderDeal,
  symbolName: string,
  assetClass: AssetClass,
  dealIndex: number,
  openingTime?: string,
): ImportedExecution[] => {
  const group = String(deal.positionId);
  const closeId = dealExecutionId(deal);
  const entryTime = openingTime ?? deal.time;
  const syntheticEntry: ImportedExecution = {
    symbol: symbolName,
    side: deal.side === "Buy" ? "sell" : "buy",
    quantity: deal.filledVolume,
    price: deal.entryPrice ?? deal.executionPrice,
    fee: 0,
    executedAt: entryTime,
    assetClass: assetClass === "stock" ? "equity" : assetClass,
    importMetadata: {
      id: `synthetic:open:${closeId}`,
      group,
      order: dealIndex * 2,
      preserveFee: true,
    },
  };
  const realClose: ImportedExecution = {
    symbol: symbolName,
    side: deal.side === "Buy" ? "buy" : "sell",
    quantity: deal.filledVolume,
    price: deal.executionPrice,
    fee: Math.abs(deal.commission ?? 0) + Math.abs(deal.swap ?? 0),
    executedAt: deal.time,
    assetClass: assetClass === "stock" ? "equity" : assetClass,
    importMetadata: {
      id: closeId,
      group,
      order: dealIndex * 2 + 1,
      preserveFee: true,
      reportedGrossPnl: deal.grossProfit ?? 0,
    },
  };
  return [syntheticEntry, realClose];
};
