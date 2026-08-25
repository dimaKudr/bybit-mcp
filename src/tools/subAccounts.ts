import { z } from "zod";
import { get } from "../bybit/client.js";
import { getMasterAccount, getSubAccounts, loadAccountRoster, resolveAccount } from "../accounts.js";
import { buildCacheKey, withCache } from "../cache.js";
import type { Env } from "./common.js";

/** `list_configured_accounts` — reads the KV roster only, never calls Bybit, never returns secrets. */
export const listConfiguredAccountsInputSchema = z.object({});
export type ListConfiguredAccountsInput = z.infer<typeof listConfiguredAccountsInputSchema>;

export async function listConfiguredAccounts(env: Env, _input: ListConfiguredAccountsInput) {
  const roster = await loadAccountRoster(env.BYBIT_ACCOUNTS);
  return {
    accounts: roster.map((account) => ({
      accountLabel: account.label,
      uid: account.uid,
      kind: account.kind,
    })),
  };
}

/** `list_sub_accounts` — Bybit's own view of sub-account UIDs, queried via the master key. */
export const listSubAccountsInputSchema = z.object({});
export type ListSubAccountsInput = z.infer<typeof listSubAccountsInputSchema>;

interface SubMembersResult {
  subMembers?: Array<Record<string, unknown>>;
}

export async function listSubAccounts(env: Env, _input: ListSubAccountsInput) {
  const master = await getMasterAccount(env.BYBIT_ACCOUNTS);
  const result = await get<SubMembersResult>("/v5/user/query-sub-members", {}, master);
  return { subMembers: result.subMembers ?? [] };
}

/** `get_sub_account_summary` — one sub's wallet balance, or all configured subs when omitted. */
export const getSubAccountSummaryInputSchema = z.object({
  accountLabel: z.string().min(1).optional(),
});
export type GetSubAccountSummaryInput = z.infer<typeof getSubAccountSummaryInputSchema>;

interface WalletBalanceResult {
  list?: Array<Record<string, unknown>>;
}

async function fetchSubSummary(account: { label: string; uid: string; apiKey: string; apiSecret: string }) {
  return withCache(buildCacheKey("get_sub_account_summary", { label: account.label }), async () => {
    const walletBalance = await get<WalletBalanceResult>(
      "/v5/account/wallet-balance",
      { accountType: "UNIFIED" },
      account,
    );
    return {
      accountLabel: account.label,
      uid: account.uid,
      wallet: walletBalance.list?.[0] ?? null,
    };
  });
}

export async function getSubAccountSummary(env: Env, input: GetSubAccountSummaryInput) {
  if (input.accountLabel) {
    const account = await resolveAccount(env.BYBIT_ACCOUNTS, input.accountLabel);
    if (account.kind !== "sub") {
      throw new Error(
        `Account "${input.accountLabel}" is the master account, not a sub-account. Use get_account_summary for the master account.`,
      );
    }
    return fetchSubSummary(account);
  }

  const subAccounts = await getSubAccounts(env.BYBIT_ACCOUNTS);
  const summaries = await Promise.all(subAccounts.map((account) => fetchSubSummary(account)));
  return { accounts: summaries };
}
