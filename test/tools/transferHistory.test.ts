import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BybitApiError } from "../../src/bybit/client.js";
import { getTransferHistory } from "../../src/tools/transferHistory.js";
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

describe("get_transfer_history", () => {
  it("bundles internal transfers, deposits, and withdrawals when transferType is 'all' (default)", async () => {
    const seenPaths: string[] = [];
    mockFetch((url) => {
      seenPaths.push(url.pathname);
      if (url.pathname === "/v5/asset/transfer/query-inter-transfer-list") {
        return bybitEnvelopeResponse({ list: [{ transferId: "t1" }] });
      }
      if (url.pathname === "/v5/asset/deposit/query-record") {
        return bybitEnvelopeResponse({ list: [{ txID: "d1" }] });
      }
      if (url.pathname === "/v5/asset/withdraw/query-record") {
        return bybitEnvelopeResponse({ list: [{ txID: "w1" }] });
      }
      throw new Error(`Unexpected path ${url.pathname}`);
    });

    const result = (await getTransferHistory(env, { transferType: "all" })) as unknown as {
      internalTransfers?: unknown[];
      deposits?: unknown[];
      withdrawals?: unknown[];
    };

    expect(seenPaths).toContain("/v5/asset/transfer/query-inter-transfer-list");
    expect(seenPaths).toContain("/v5/asset/deposit/query-record");
    expect(seenPaths).toContain("/v5/asset/withdraw/query-record");
    expect(result.internalTransfers).toHaveLength(1);
    expect(result.deposits).toHaveLength(1);
    expect(result.withdrawals).toHaveLength(1);
  });

  it("only calls the deposit endpoint when transferType is 'deposit'", async () => {
    const fetchMock = mockFetch((url) => {
      expect(url.pathname).toBe("/v5/asset/deposit/query-record");
      return bybitEnvelopeResponse({ list: [{ txID: "d1" }] });
    });

    const result = (await getTransferHistory(env, { transferType: "deposit" })) as unknown as {
      deposits?: unknown[];
      internalTransfers?: unknown[];
      withdrawals?: unknown[];
    };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.deposits).toHaveLength(1);
    expect(result.internalTransfers).toBeUndefined();
    expect(result.withdrawals).toBeUndefined();
  });

  it("throws on a non-zero retCode from any of the underlying endpoints", async () => {
    mockFetch(() => bybitEnvelopeResponse(null, 10001, "Params error"));
    await expect(getTransferHistory(env, { transferType: "withdrawal" })).rejects.toBeInstanceOf(
      BybitApiError,
    );
  });
});
