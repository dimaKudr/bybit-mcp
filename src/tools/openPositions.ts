import { z } from "zod";
import { categorySchema } from "../bybit/types.js";
import { getMasterAccount, getSubAccounts, resolveAccount } from "../accounts.js";
import type { ConfiguredAccount } from "../bybit/types.js";
import { buildCacheKey, withCache } from "../cache.js";
import { fetchPaginated } from "./common.js";
import type { Env } from "./common.js";

const POSITION_LIST_PATH = "/v5/position/list";

/**
 * `get_open_positions` — current open positions for one account (default:
 * master), or every configured account when `accountLabel` is `"all"`.
 */
export const getOpenPositionsInputSchema = z.object({
  accountLabel: z.string().min(1).optional(),
  category: categorySchema,
  symbol: z.string().min(1).optional(),
});
export type GetOpenPositionsInput = z.infer<typeof getOpenPositionsInputSchema>;

async function fetchPositions(account: ConfiguredAccount, input: GetOpenPositionsInput) {
  return withCache(
    buildCacheKey("get_open_positions", {
      label: account.label,
      category: input.category,
      symbol: input.symbol,
    }),
    async () => {
      const result = await fetchPaginated(
        POSITION_LIST_PATH,
        { category: input.category, symbol: input.symbol },
        account,
      );
      return { accountLabel: account.label, positions: result.items, nextCursor: result.nextCursor };
    },
  );
}

export async function getOpenPositions(env: Env, input: GetOpenPositionsInput) {
  if (input.accountLabel === "all") {
    const master = await getMasterAccount(env.BYBIT_ACCOUNTS);
    const subAccounts = await getSubAccounts(env.BYBIT_ACCOUNTS);
    const results = await Promise.all(
      [master, ...subAccounts].map((account) => fetchPositions(account, input)),
    );
    return { accounts: results };
  }

  const account = input.accountLabel
    ? await resolveAccount(env.BYBIT_ACCOUNTS, input.accountLabel)
    : await getMasterAccount(env.BYBIT_ACCOUNTS);

  return fetchPositions(account, input);
}
