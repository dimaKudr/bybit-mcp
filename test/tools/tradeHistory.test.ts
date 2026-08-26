import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnknownAccountError } from "../../src/accounts.js";
import { BybitApiError } from "../../src/bybit/client.js";
import { getTradeHistory } from "../../src/tools/tradeHistory.js";
import type { Env } from "../../src/tools/common.js";
import { seedStandardRoster } from "./testAccounts.js";
import { mockFetch, bybitEnvelopeResponse } from "../testUtils.js";

let env: Env;

beforeEach(async () => {
  env = await seedStandardRoster();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("get_trade_history", () => {
  it("defaults to the master account when accountLabel is omitted", async () => {
    mockFetch((url, init) => {
      expect(url.pathname).toBe("/v5/execution/list");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-BAPI-API-KEY"]).toBe("master-key");
      return bybitEnvelopeResponse({ list: [{ execId: "1", execPrice: "50000.5" }] });
    });

    const result = (await getTradeHistory(env, { category: "linear" })) as unknown as {
      accountLabel: string;
      executions: Array<{ execPrice: string }>;
    };
    expect(result.accountLabel).toBe("master");
    expect(result.executions[0].execPrice).toBe("50000.5");
  });

  it("targets a specific sub-account when accountLabel is given", async () => {
    mockFetch((_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-BAPI-API-KEY"]).toBe("sub2-key");
      return bybitEnvelopeResponse({ list: [] });
    });

    const result = (await getTradeHistory(env, {
      category: "linear",
      accountLabel: "sub-trading2",
    })) as unknown as { accountLabel: string };
    expect(result.accountLabel).toBe("sub-trading2");
  });

  it("throws UnknownAccountError for an unrecognized accountLabel", async () => {
    mockFetch(() => bybitEnvelopeResponse({ list: [] }));
    await expect(
      getTradeHistory(env, { category: "linear", accountLabel: "sub-gone" }),
    ).rejects.toBeInstanceOf(UnknownAccountError);
  });

  it("throws on a non-zero retCode", async () => {
    mockFetch(() => bybitEnvelopeResponse(null, 10001, "Params error"));
    await expect(getTradeHistory(env, { category: "linear" })).rejects.toBeInstanceOf(BybitApiError);
  });

  it("rejects an invalid startTime that isn't valid ISO 8601", async () => {
    mockFetch(() => bybitEnvelopeResponse({ list: [] }));
    await expect(
      getTradeHistory(env, { category: "linear", startTime: "not-a-date" }),
    ).rejects.toThrow(/Invalid ISO 8601/);
  });
});
