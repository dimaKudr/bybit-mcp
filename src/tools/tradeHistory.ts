import { z } from "zod";
import { categorySchema } from "../bybit/types.js";
import { getMasterAccount, resolveAccount } from "../accounts.js";
import { fetchPaginated, isoToEpochMs } from "./common.js";
import type { Env } from "./common.js";

const EXECUTION_LIST_PATH = "/v5/execution/list";

/**
 * `get_trade_history` — fill-level execution history for the master account
 * or a specific sub-account (default: master).
 */
export const getTradeHistoryInputSchema = z.object({
  accountLabel: z.string().min(1).optional(),
  category: categorySchema,
  symbol: z.string().min(1).optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
});
export type GetTradeHistoryInput = z.infer<typeof getTradeHistoryInputSchema>;

export async function getTradeHistory(env: Env, input: GetTradeHistoryInput) {
  const account = input.accountLabel
    ? await resolveAccount(env.BYBIT_ACCOUNTS, input.accountLabel)
    : await getMasterAccount(env.BYBIT_ACCOUNTS);

  const result = await fetchPaginated(
    EXECUTION_LIST_PATH,
    {
      category: input.category,
      symbol: input.symbol,
      startTime: isoToEpochMs(input.startTime),
      endTime: isoToEpochMs(input.endTime),
    },
    account,
    { cursor: input.cursor },
  );

  return {
    accountLabel: account.label,
    executions: result.items,
    nextCursor: result.nextCursor,
  };
}
