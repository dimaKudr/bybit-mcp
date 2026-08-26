import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BybitApiError } from "../../src/bybit/client.js";
import { getAccountSummary } from "../../src/tools/accountSummary.js";
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

describe("get_account_summary", () => {
  it("returns normalized wallet balance + account info for the master account", async () => {
    mockFetch((url) => {
      if (url.pathname === "/v5/account/wallet-balance") {
        return bybitEnvelopeResponse({ list: [{ totalEquity: "12345.67", coin: [] }] });
      }
      if (url.pathname === "/v5/account/info") {
        return bybitEnvelopeResponse({ unifiedMarginStatus: 4 });
      }
      throw new Error(`Unexpected path ${url.pathname}`);
    });

    const result = (await getAccountSummary(env, {})) as unknown as {
      accountLabel: string;
      uid: string;
      wallet: { totalEquity: string };
      accountInfo: { unifiedMarginStatus: number };
    };

    expect(result.accountLabel).toBe("master");
    expect(result.uid).toBe("1000");
    // Numeric strings from Bybit stay as strings (no float precision loss).
    expect(result.wallet.totalEquity).toBe("12345.67");
    expect(typeof result.wallet.totalEquity).toBe("string");
    expect(result.accountInfo.unifiedMarginStatus).toBe(4);
  });

  it("propagates a BybitApiError (non-zero retCode) as a thrown error", async () => {
    mockFetch((url) => {
      if (url.pathname === "/v5/account/wallet-balance") {
        return bybitEnvelopeResponse(null, 10003, "Invalid API key");
      }
      return bybitEnvelopeResponse({});
    });

    await expect(getAccountSummary(env, {})).rejects.toBeInstanceOf(BybitApiError);
  });
});
