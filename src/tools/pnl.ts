import { z } from "zod";
import { categorySchema } from "../bybit/types.js";
import { getMasterAccount, getSubAccounts, resolveAccount } from "../accounts.js";
import type { ConfiguredAccount } from "../bybit/types.js";
import { fetchPaginated, isoToEpochMs } from "./common.js";
import type { Env } from "./common.js";

const PNL_PATH = "/v5/position/closed-pnl";

const basePnlInputSchema = z.object({
  category: categorySchema,
  symbol: z.string().min(1).optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
});

async function fetchClosedPnl(account: ConfiguredAccount, input: z.infer<typeof basePnlInputSchema>) {
  const result = await fetchPaginated(
    PNL_PATH,
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
    closedPnl: result.items,
    nextCursor: result.nextCursor,
  };
}

/** `get_account_pnl` — master account's closed PnL. */
export const getAccountPnlInputSchema = basePnlInputSchema;
export type GetAccountPnlInput = z.infer<typeof getAccountPnlInputSchema>;

export async function getAccountPnl(env: Env, input: GetAccountPnlInput) {
  const master = await getMasterAccount(env.BYBIT_ACCOUNTS);
  return fetchClosedPnl(master, input);
}

/** `get_sub_account_pnl` — one sub's closed PnL, or all configured subs when accountLabel omitted. */
export const getSubAccountPnlInputSchema = basePnlInputSchema.extend({
  accountLabel: z.string().min(1).optional(),
});
export type GetSubAccountPnlInput = z.infer<typeof getSubAccountPnlInputSchema>;

export async function getSubAccountPnl(env: Env, input: GetSubAccountPnlInput) {
  if (input.accountLabel) {
    const account = await resolveAccount(env.BYBIT_ACCOUNTS, input.accountLabel);
    if (account.kind !== "sub") {
      throw new Error(
        `Account "${input.accountLabel}" is the master account, not a sub-account. Use get_account_pnl for the master account.`,
      );
    }
    return fetchClosedPnl(account, input);
  }

  const subAccounts = await getSubAccounts(env.BYBIT_ACCOUNTS);
  const results = await Promise.all(subAccounts.map((account) => fetchClosedPnl(account, input)));
  return { accounts: results };
}
