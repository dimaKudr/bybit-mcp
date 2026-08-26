import { z } from "zod";
import { getMasterAccount, resolveAccount } from "../accounts.js";
import { fetchPaginated, isoToEpochMs, ToolError, type PaginatedFetchResult } from "./common.js";
import type { Env } from "./common.js";

const INTERNAL_TRANSFER_PATH = "/v5/asset/transfer/query-inter-transfer-list";
const DEPOSIT_PATH = "/v5/asset/deposit/query-record";
const WITHDRAW_PATH = "/v5/asset/withdraw/query-record";

const transferTypeSchema = z.enum(["internal", "deposit", "withdrawal", "all"]);

/**
 * `get_transfer_history` — bundles internal transfers, deposits, and
 * withdrawals under one tool with a `transferType` filter, since "transfers
 * history" naturally spans all three from a user's point of view (§4).
 */
export const getTransferHistoryInputSchema = z.object({
  accountLabel: z.string().min(1).optional(),
  transferType: transferTypeSchema.default("all"),
  coin: z.string().min(1).optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
});
export type GetTransferHistoryInput = z.infer<typeof getTransferHistoryInputSchema>;

export async function getTransferHistory(env: Env, input: GetTransferHistoryInput) {
  const account = input.accountLabel
    ? await resolveAccount(env.BYBIT_ACCOUNTS, input.accountLabel)
    : await getMasterAccount(env.BYBIT_ACCOUNTS);

  const startTime = isoToEpochMs(input.startTime);
  const endTime = isoToEpochMs(input.endTime);

  // Applied explicitly (not just relied on via the zod schema default) so
  // this handler behaves correctly even when called directly, not only
  // through the MCP server's input-validation path.
  const transferType = input.transferType ?? "all";

  // `internal`/`deposit`/`withdrawal` are three independent Bybit endpoints
  // with independent cursor spaces — a cursor returned from one is not valid
  // for the others. Reject the ambiguous combination instead of silently
  // (and incorrectly) applying the same cursor to all three fan-out calls.
  if (input.cursor && transferType === "all") {
    throw new ToolError(
      'A "cursor" cannot be used with transferType "all" because internal transfers, deposits, ' +
        'and withdrawals each have their own independent pagination cursor. Narrow "transferType" ' +
        'to "internal", "deposit", or "withdrawal" and retry with that endpoint\'s own cursor.',
    );
  }

  const sections: { internalTransfers?: PaginatedFetchResult<Record<string, unknown>>["items"]; deposits?: PaginatedFetchResult<Record<string, unknown>>["items"]; withdrawals?: PaginatedFetchResult<Record<string, unknown>>["items"] } = {};
  const cursors: Record<string, string | undefined> = {};

  const wantInternal = transferType === "internal" || transferType === "all";
  const wantDeposit = transferType === "deposit" || transferType === "all";
  const wantWithdrawal = transferType === "withdrawal" || transferType === "all";

  if (wantInternal) {
    const result = await fetchPaginated(
      INTERNAL_TRANSFER_PATH,
      { coin: input.coin, startTime, endTime },
      account,
      { cursor: input.cursor },
    );
    sections.internalTransfers = result.items;
    cursors.internalTransfers = result.nextCursor;
  }

  if (wantDeposit) {
    const result = await fetchPaginated(
      DEPOSIT_PATH,
      { coin: input.coin, startTime, endTime },
      account,
      { cursor: input.cursor },
    );
    sections.deposits = result.items;
    cursors.deposits = result.nextCursor;
  }

  if (wantWithdrawal) {
    const result = await fetchPaginated(
      WITHDRAW_PATH,
      { coin: input.coin, startTime, endTime },
      account,
      { cursor: input.cursor },
    );
    sections.withdrawals = result.items;
    cursors.withdrawals = result.nextCursor;
  }

  return {
    accountLabel: account.label,
    ...sections,
    nextCursors: cursors,
  };
}
