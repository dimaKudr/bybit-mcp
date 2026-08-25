import { z } from "zod";
import { get } from "../bybit/client.js";
import { getMasterAccount } from "../accounts.js";
import { buildCacheKey, withCache } from "../cache.js";
import type { Env } from "./common.js";

export const getAccountSummaryInputSchema = z.object({});
export type GetAccountSummaryInput = z.infer<typeof getAccountSummaryInputSchema>;

interface WalletBalanceResult {
  list?: Array<Record<string, unknown>>;
}

interface AccountInfoResult {
  [key: string]: unknown;
}

/**
 * `get_account_summary` — master account's UNIFIED wallet balance + account
 * info, normalized (Bybit's retCode/retMsg wrapper dropped).
 */
export async function getAccountSummary(env: Env, _input: GetAccountSummaryInput) {
  const master = await getMasterAccount(env.BYBIT_ACCOUNTS);

  return withCache(buildCacheKey("get_account_summary", { label: master.label }), async () => {
    const [walletBalance, accountInfo] = await Promise.all([
      get<WalletBalanceResult>(
        "/v5/account/wallet-balance",
        { accountType: "UNIFIED" },
        master,
      ),
      get<AccountInfoResult>("/v5/account/info", {}, master),
    ]);

    return {
      accountLabel: master.label,
      uid: master.uid,
      wallet: walletBalance.list?.[0] ?? null,
      accountInfo,
    };
  });
}
