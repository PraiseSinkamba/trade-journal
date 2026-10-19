import { z } from "zod";

export type AssetClass = "forex" | "cfd" | "crypto" | "stock" | "other";

/** Local cTrader Desktop account, returned by `get_accounts_list`. */
export const cTraderAccountSchema = z.object({
  id: z.number().int().positive(),
  login: z.union([z.number(), z.string()]).optional(),
  accountName: z.string(),
  brokerTitle: z.string(),
  isLive: z.boolean(),
  balance: z.number(),
  currency: z.string().min(3),
  accountType: z.string(),
  isOnline: z.boolean(),
});
export type CTraderAccount = z.infer<typeof cTraderAccountSchema>;

export const cTraderAccountsResponseSchema = z.object({
  accounts: z.array(cTraderAccountSchema),
  count: z.number().optional(),
});

/** Account financials from `get_balance`. Money is already in real currency. */
export const cTraderBalanceSchema = z.object({
  balance: z.number(),
  equity: z.number(),
  margin: z.number(),
  freeMargin: z.number(),
  marginLevel: z.number().nullable().optional(),
  netProfit: z.number().optional().default(0),
  grossProfit: z.number().optional().default(0),
  leverage: z.number().optional().default(0),
  depositAsset: z.string(),
  accountName: z.string().optional(),
  accountType: z.string().optional(),
  traderId: z.union([z.string(), z.number()]).optional(),
  brokerName: z.string(),
  connectionState: z.string().optional(),
  isSwapFree: z.boolean().optional().default(false),
});
export type CTraderBalance = z.infer<typeof cTraderBalanceSchema>;

/** Symbol metadata from `get_symbols`. `name` is the join key (deals use `symbolName`). */
export const cTraderSymbolSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional().default(""),
    category: z.string().optional().default(""),
    assetClass: z.string().optional().default(""),
  })
  .passthrough();
export type CTraderSymbol = z.infer<typeof cTraderSymbolSchema>;

export const cTraderSymbolsResponseSchema = z.object({
  symbols: z.array(cTraderSymbolSchema),
});

/**
 * Deal (fill) from `get_deals`. Local has no `dealId` — dedup rides on a
 * composite of `orderId + time + filledVolume + executionPrice` (see
 * `dealExecutionId`). `orderId` / `positionId` may be numeric or string
 * depending on the desktop build.
 */
export const cTraderDealSchema = z.object({
  orderId: z.union([z.number(), z.string()]).optional(),
  positionId: z.union([z.number(), z.string()]),
  symbolName: z.string().min(1),
  dealType: z.string().optional().default(""),
  side: z.enum(["Buy", "Sell"]),
  filledVolume: z.number(),
  executionPrice: z.number(),
  entryPrice: z.number().optional(),
  pips: z.number().optional(),
  grossProfit: z.number().optional().default(0),
  commission: z.number().optional().default(0),
  swap: z.number().optional().default(0),
  netProfit: z.number().optional().default(0),
  label: z.string().optional().default(""),
  comment: z.string().optional().default(""),
  time: z.string().min(1),
});
export type CTraderDeal = z.infer<typeof cTraderDealSchema>;

export const cTraderDealsResponseSchema = z.object({
  deals: z.array(cTraderDealSchema),
  count: z.number().optional(),
});

/** Open position from `get_positions`. Schema is loose — fields are vendor-specific. */
export const cTraderPositionSchema = z
  .object({
    positionId: z.union([z.number(), z.string()]),
    symbolName: z.string().optional(),
  })
  .passthrough();
export type CTraderPosition = z.infer<typeof cTraderPositionSchema>;

export const cTraderPositionsResponseSchema = z.object({
  positions: z.array(cTraderPositionSchema),
});

/** Pending order from `get_pending_orders`. */
export const cTraderOrderSchema = z
  .object({
    orderId: z.union([z.number(), z.string()]),
    symbolName: z.string().optional(),
    side: z.enum(["Buy", "Sell"]).optional(),
    type: z.string().optional(),
    volume: z.number().optional(),
    limitPrice: z.number().nullable().optional(),
    stopPrice: z.number().nullable().optional(),
  })
  .passthrough();
export type CTraderOrder = z.infer<typeof cTraderOrderSchema>;

export const cTraderOrdersResponseSchema = z.object({
  orders: z.array(cTraderOrderSchema),
});

/**
 * Historical order from `get_order_history`. Used to recover the opening
 * time of closed positions whose entry fill is no longer in the deal
 * stream. `positionId` is required for our opener-detection heuristic;
 * `time` and `side` are required for the same. Other vendor fields ride
 * through via `.passthrough()`.
 */
export const cTraderHistoricalOrderSchema = z
  .object({
    orderId: z.union([z.number(), z.string()]).optional(),
    positionId: z.union([z.number(), z.string()]).optional(),
    symbolName: z.string().optional(),
    side: z.enum(["Buy", "Sell"]).optional(),
    /** cTrader order type string, e.g. "MARKET", "LIMIT", "STOP", "STOP_LOSS", "TAKE_PROFIT". */
    orderType: z.string().optional(),
    /** ISO-8601 timestamp the order was placed/executed. */
    time: z.string().optional(),
  })
  .passthrough();
export type CTraderHistoricalOrder = z.infer<typeof cTraderHistoricalOrderSchema>;

export const cTraderOrderHistoryResponseSchema = z.object({
  orders: z.array(cTraderHistoricalOrderSchema),
  count: z.number().optional(),
});
