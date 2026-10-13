import { z } from "zod";

export type AssetClass = "forex" | "cfd" | "crypto" | "stock" | "other";

export const cTraderSymbolSchema = z.object({
  symbolId: z.number().int().positive(),
  name: z.string().min(1),
  digits: z.number().int().min(0).max(10),
  assetClass: z.enum(["forex", "cfd", "crypto", "stock", "other"]),
});
export type CTraderSymbol = z.infer<typeof cTraderSymbolSchema>;

export const cTraderDealSchema = z.object({
  dealId: z.string().min(1),
  positionId: z.string().min(1),
  symbolId: z.number().int().positive(),
  side: z.enum(["BUY", "SELL"]),
  filledVolume: z.number().positive(),
  executionPrice: z.number().positive(),
  executionTime: z.string().min(1),
  commission: z.number().default(0),
  swap: z.number().default(0),
});
export type CTraderDeal = z.infer<typeof cTraderDealSchema>;

export const cTraderPositionSchema = z.object({
  positionId: z.string().min(1),
  symbolId: z.number().int().positive(),
  side: z.enum(["BUY", "SELL"]),
  volume: z.number(),
  entryPrice: z.number().positive(),
  netProfit: z.number(),
  swap: z.number().default(0),
  commission: z.number().default(0),
});
export type CTraderPosition = z.infer<typeof cTraderPositionSchema>;

export const cTraderOrderSchema = z.object({
  orderId: z.string().min(1),
  symbolId: z.number().int().positive(),
  side: z.enum(["BUY", "SELL"]),
  type: z.string(),
  volume: z.number(),
  limitPrice: z.number().nullable().optional(),
  stopPrice: z.number().nullable().optional(),
});
export type CTraderOrder = z.infer<typeof cTraderOrderSchema>;

export const cTraderAccountInfoSchema = z.object({
  accountId: z.number().int().positive(),
  balance: z.number(),
  equity: z.number(),
  freeMargin: z.number(),
  currency: z.string().min(3),
});
export type CTraderAccountInfo = z.infer<typeof cTraderAccountInfoSchema>;

export const cTraderAccountSchema = z.object({
  accountId: z.number().int().positive(),
  brokerName: z.string(),
  currency: z.string().min(3),
});
export type CTraderAccount = z.infer<typeof cTraderAccountSchema>;

export const cTraderSymbolsResponseSchema = z.object({ symbols: z.array(cTraderSymbolSchema) });
export const cTraderDealsResponseSchema = z.object({
  deals: z.array(cTraderDealSchema),
  nextCursor: z.string().nullable().optional(),
});
export const cTraderPositionsResponseSchema = z.object({ positions: z.array(cTraderPositionSchema) });
export const cTraderOrdersResponseSchema = z.object({ orders: z.array(cTraderOrderSchema) });
export const cTraderAccountsResponseSchema = z.object({ accounts: z.array(cTraderAccountSchema) });
