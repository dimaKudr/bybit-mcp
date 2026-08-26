import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BybitApiError } from "../../src/bybit/client.js";
import { getOpenPositions } from "../../src/tools/openPositions.js";
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

describe("get_open_positions", () => {
  it("defaults to the master account", async () => {
    mockFetch((url, init) => {
      expect(url.pathname).toBe("/v5/position/list");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-BAPI-API-KEY"]).toBe("master-key");
      return bybitEnvelopeResponse({ list: [{ symbol: "BTCUSDT", size: "0.5" }] });
    });

    const result = (await getOpenPositions(env, { category: "linear" })) as unknown as {
      accountLabel: string;
      positions: Array<{ size: string }>;
    };
    expect(result.accountLabel).toBe("master");
    expect(result.positions[0].size).toBe("0.5");
  });

  it('fans out across master + every sub-account when accountLabel is "all"', async () => {
    mockFetch(() => bybitEnvelopeResponse({ list: [] }));
    const result = (await getOpenPositions(env, { category: "linear", accountLabel: "all" })) as unknown as {
      accounts: Array<{ accountLabel: string }>;
    };
    expect(result.accounts.map((a) => a.accountLabel).sort()).toEqual([
      "master",
      "sub-trading1",
      "sub-trading2",
    ]);
  });

  it("throws on a non-zero retCode", async () => {
    mockFetch(() => bybitEnvelopeResponse(null, 10001, "Params error"));
    await expect(getOpenPositions(env, { category: "linear" })).rejects.toBeInstanceOf(BybitApiError);
  });
});
