import { z } from "zod";
import { categorySchema } from "../bybit/types.js";
import { getMasterAccount, resolveAccount } from "../accounts.js";
import { fetchPaginated, isoToEpochMs } from "./common.js";
import type { Env } from "./common.js";

const OPEN_ORDERS_PATH = "/v5/order/realtime";
const ORDER_HISTORY_PATH = "/v5/order/history";

/**
 * `get_open_orders` — resting (unfilled/untriggered) orders. Complements
 * `get_open_positions` for a full picture of current exposure (§4).
 */
export const getOpenOrdersInputSchema = z.object({
  accountLabel: z.string().min(1).optional(),
  category: categorySchema,
  symbol: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
});
export type GetOpenOrdersInput = z.infer<typeof getOpenOrdersInputSchema>;

export async function getOpenOrders(env: Env, input: GetOpenOrdersInput) {
  const account = input.accountLabel
    ? await resolveAccount(env.BYBIT_ACCOUNTS, input.accountLabel)
    : await getMasterAccount(env.BYBIT_ACCOUNTS);

  const result = await fetchPaginated(
    OPEN_ORDERS_PATH,
    { category: input.category, symbol: input.symbol },
    account,
    { cursor: input.cursor },
  );

  return { accountLabel: account.label, orders: result.items, nextCursor: result.nextCursor };
}

/**
 * `get_order_history` — closed/cancelled/filled orders, for reconciling
 * against `get_trade_history`'s fill-level detail (§4).
 */
export const getOrderHistoryInputSchema = z.object({
  accountLabel: z.string().min(1).optional(),
  category: categorySchema,
  symbol: z.string().min(1).optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
});
export type GetOrderHistoryInput = z.infer<typeof getOrderHistoryInputSchema>;

export async function getOrderHistory(env: Env, input: GetOrderHistoryInput) {
  const account = input.accountLabel
    ? await resolveAccount(env.BYBIT_ACCOUNTS, input.accountLabel)
    : await getMasterAccount(env.BYBIT_ACCOUNTS);

  const result = await fetchPaginated(
    ORDER_HISTORY_PATH,
    {
      category: input.category,
      symbol: input.symbol,
      startTime: isoToEpochMs(input.startTime),
      endTime: isoToEpochMs(input.endTime),
    },
    account,
    { cursor: input.cursor },
  );

  return { accountLabel: account.label, orders: result.items, nextCursor: result.nextCursor };
}
