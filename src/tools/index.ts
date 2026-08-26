import { z } from "zod";
import type { Env } from "./common.js";
import { getAccountSummary, getAccountSummaryInputSchema } from "./accountSummary.js";
import {
  listConfiguredAccounts,
  listConfiguredAccountsInputSchema,
  listSubAccounts,
  listSubAccountsInputSchema,
  getSubAccountSummary,
  getSubAccountSummaryInputSchema,
} from "./subAccounts.js";
import {
  getAccountPnl,
  getAccountPnlInputSchema,
  getSubAccountPnl,
  getSubAccountPnlInputSchema,
} from "./pnl.js";
import { getTradeHistory, getTradeHistoryInputSchema } from "./tradeHistory.js";
import { getTransferHistory, getTransferHistoryInputSchema } from "./transferHistory.js";
import { getOpenPositions, getOpenPositionsInputSchema } from "./openPositions.js";
import {
  getOpenOrders,
  getOpenOrdersInputSchema,
  getOrderHistory,
  getOrderHistoryInputSchema,
} from "./openOrders.js";

/**
 * ============================================================================
 * READ-ONLY GUARDRAIL
 * ============================================================================
 * Every tool registered below must resolve to one or more calls through
 * `src/bybit/client.ts`'s `get()` method only, against paths present in its
 * ALLOWED_PATHS allowlist. No tool here may ever map to a POST/PUT/DELETE
 * Bybit call — there is no such capability in this codebase, and it must
 * stay that way. See plan §6.
 * ============================================================================
 */

export interface McpToolDefinition<TInput> {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (env: Env, input: TInput) => Promise<unknown>;
}

// `as const`-style array of every tool this server exposes. Each entry pairs
// a zod input schema with a handler; `src/index.ts` registers these against
// the MCP server per-request.
export function createToolDefinitions(): McpToolDefinition<unknown>[] {
  return [
    {
      name: "list_configured_accounts",
      description:
        "List every account (master + sub-accounts) currently configured in the KV roster, with label/uid/kind. Never returns secrets. Use this to check which accountLabel values are valid right now.",
      inputSchema: listConfiguredAccountsInputSchema,
      handler: listConfiguredAccounts,
    },
    {
      name: "get_account_summary",
      description: "Get the master account's UNIFIED wallet balance and account info.",
      inputSchema: getAccountSummaryInputSchema,
      handler: getAccountSummary,
    },
    {
      name: "list_sub_accounts",
      description: "List Bybit's own view of sub-account members (UIDs) under the master account.",
      inputSchema: listSubAccountsInputSchema,
      handler: listSubAccounts,
    },
    {
      name: "get_sub_account_summary",
      description:
        "Get a sub-account's UNIFIED wallet balance. Pass accountLabel for one sub-account, or omit to fan out across every configured sub-account.",
      inputSchema: getSubAccountSummaryInputSchema,
      handler: getSubAccountSummary,
    },
    {
      name: "get_account_pnl",
      description: "Get the master account's closed PnL history for a category (and optional symbol/time range).",
      inputSchema: getAccountPnlInputSchema,
      handler: getAccountPnl,
    },
    {
      name: "get_sub_account_pnl",
      description:
        "Get closed PnL history for a sub-account. Pass accountLabel for one sub-account, or omit to fan out across every configured sub-account.",
      inputSchema: getSubAccountPnlInputSchema,
      handler: getSubAccountPnl,
    },
    {
      name: "get_trade_history",
      description:
        "Get fill-level execution (trade) history for the master account or a specific accountLabel (default: master).",
      inputSchema: getTradeHistoryInputSchema,
      handler: getTradeHistory,
    },
    {
      name: "get_transfer_history",
      description:
        "Get transfer history (internal transfers, deposits, withdrawals, or all) for the master account or a specific accountLabel.",
      inputSchema: getTransferHistoryInputSchema,
      handler: getTransferHistory,
    },
    {
      name: "get_open_positions",
      description:
        "Get current open positions for one account (default: master), or every configured account when accountLabel is \"all\".",
      inputSchema: getOpenPositionsInputSchema,
      handler: getOpenPositions,
    },
    {
      name: "get_open_orders",
      description:
        "Get resting (unfilled/untriggered) orders for the master account or a specific accountLabel (default: master).",
      inputSchema: getOpenOrdersInputSchema,
      handler: getOpenOrders,
    },
    {
      name: "get_order_history",
      description:
        "Get closed/cancelled/filled order history for the master account or a specific accountLabel (default: master).",
      inputSchema: getOrderHistoryInputSchema,
      handler: getOrderHistory,
    },
  ] as McpToolDefinition<unknown>[];
}
