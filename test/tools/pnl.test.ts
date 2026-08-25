import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BybitApiError } from "../../src/bybit/client.js";
import { getAccountPnl, getSubAccountPnl } from "../../src/tools/pnl.js";
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

describe("get_account_pnl", () => {
  it("fetches master closed PnL, converting ISO times to epoch ms", async () => {
    mockFetch((url) => {
      expect(url.pathname).toBe("/v5/position/closed-pnl");
      expect(url.searchParams.get("category")).toBe("linear");
      expect(url.searchParams.get("startTime")).toBe(new Date("2024-01-01T00:00:00Z").getTime().toString());
      return bybitEnvelopeResponse({ list: [{ symbol: "BTCUSDT", closedPnl: "10.5" }] });
    });

    const result = (await getAccountPnl(env, {
      category: "linear",
      startTime: "2024-01-01T00:00:00Z",
    })) as unknown as { accountLabel: string; closedPnl: Array<{ closedPnl: string }> };

    expect(result.accountLabel).toBe("master");
    expect(result.closedPnl[0].closedPnl).toBe("10.5");
  });

  it("auto-follows pagination up to 3 pages and returns nextCursor", async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      if (calls < 3) {
        return bybitEnvelopeResponse({ list: [{ id: calls }], nextPageCursor: `cursor-${calls}` });
      }
      return bybitEnvelopeResponse({ list: [{ id: calls }], nextPageCursor: "cursor-3" });
    });

    const result = (await getAccountPnl(env, { category: "linear" })) as unknown as {
      closedPnl: unknown[];
      nextCursor?: string;
    };

    expect(calls).toBe(3);
    expect(result.closedPnl).toHaveLength(3);
    expect(result.nextCursor).toBe("cursor-3");
  });

  it("throws on a non-zero retCode", async () => {
    mockFetch(() => bybitEnvelopeResponse(null, 10001, "Params error"));
    await expect(getAccountPnl(env, { category: "linear" })).rejects.toBeInstanceOf(BybitApiError);
  });
});

describe("get_sub_account_pnl", () => {
  it("fetches a single sub-account's closed PnL when accountLabel is given", async () => {
    mockFetch((_url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-BAPI-API-KEY"]).toBe("sub1-key");
      return bybitEnvelopeResponse({ list: [] });
    });

    const result = (await getSubAccountPnl(env, {
      category: "linear",
      accountLabel: "sub-trading1",
    })) as unknown as { accountLabel: string };
    expect(result.accountLabel).toBe("sub-trading1");
  });

  it("fans out across all configured sub-accounts when accountLabel is omitted", async () => {
    mockFetch(() => bybitEnvelopeResponse({ list: [] }));
    const result = (await getSubAccountPnl(env, { category: "linear" })) as unknown as {
      accounts: Array<{ accountLabel: string }>;
    };
    expect(result.accounts.map((a) => a.accountLabel).sort()).toEqual(["sub-trading1", "sub-trading2"]);
  });
});
