import type { ImportedExecution } from "@luxalgo/journal-importers";
import type { CTraderMcpClient } from "./client";
import {
  cTraderDealsResponseSchema,
  type AssetClass,
  type CTraderDeal,
} from "./schemas";

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
