import type { ImportedExecution } from "@luxalgo/journal-importers";
import type { CTraderMcpClient } from "./client";
import { cTraderDealsResponseSchema, type AssetClass, type CTraderDeal } from "./schemas";

export interface FetchDealsArgs {
  fromTime?: string;
  toTime?: string;
  ctraderAccountId?: number;
}

export const fetchAllDeals = async (
  client: CTraderMcpClient,
  args: FetchDealsArgs,
): Promise<CTraderDeal[]> => {
  const out: CTraderDeal[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page = await client.callTool(
      "get_deals",
      {
        ...(args.fromTime ? { fromTime: args.fromTime } : {}),
        ...(args.toTime ? { toTime: args.toTime } : {}),
        ...(args.ctraderAccountId ? { accountId: args.ctraderAccountId } : {}),
        ...(cursor ? { cursor } : {}),
      },
      cTraderDealsResponseSchema,
    );
    out.push(...page.deals);
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return out;
};

export const mapDealToExecution = (
  deal: CTraderDeal,
  symbolName: string,
  assetClass: AssetClass,
  dealIndex: number,
): ImportedExecution => ({
  symbol: symbolName,
  side: deal.side === "BUY" ? "buy" : "sell",
  quantity: deal.filledVolume,
  price: deal.executionPrice,
  fee: (deal.commission ?? 0) + (deal.swap ?? 0),
  executedAt: deal.executionTime,
  assetClass,
  importMetadata: {
    id: deal.dealId,
    group: deal.positionId,
    order: dealIndex,
    preserveFee: true,
  },
});
