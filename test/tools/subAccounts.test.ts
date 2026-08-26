import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnknownAccountError } from "../../src/accounts.js";
import { BybitApiError } from "../../src/bybit/client.js";
import {
  listConfiguredAccounts,
  listSubAccounts,
  getSubAccountSummary,
} from "../../src/tools/subAccounts.js";
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

describe("list_configured_accounts", () => {
  it("lists every account from the KV roster without secrets, no Bybit call", async () => {
    const fetchMock = mockFetch(() => bybitEnvelopeResponse({}));

    const result = (await listConfiguredAccounts(env, {})) as unknown as {
      accounts: Array<{ accountLabel: string; uid: string; kind: string }>;
    };

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.accounts).toHaveLength(3);
    expect(result.accounts).toEqual(
      expect.arrayContaining([
        { accountLabel: "master", uid: "1000", kind: "master" },
        { accountLabel: "sub-trading1", uid: "2000", kind: "sub" },
        { accountLabel: "sub-trading2", uid: "3000", kind: "sub" },
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("list_sub_accounts", () => {
  it("returns Bybit's sub-member list via the master key", async () => {
    mockFetch((url, init) => {
      expect(url.pathname).toBe("/v5/user/query-sub-members");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-BAPI-API-KEY"]).toBe("master-key");
      return bybitEnvelopeResponse({ subMembers: [{ uid: "2000", username: "sub-trading1" }] });
    });

    const result = (await listSubAccounts(env, {})) as unknown as { subMembers: unknown[] };
    expect(result.subMembers).toHaveLength(1);
  });

  it("throws on a non-zero retCode", async () => {
    mockFetch(() => bybitEnvelopeResponse(null, 10001, "Params error"));
    await expect(listSubAccounts(env, {})).rejects.toBeInstanceOf(BybitApiError);
  });
});

describe("get_sub_account_summary", () => {
  it("returns a single sub-account's wallet balance when accountLabel is given", async () => {
    mockFetch((url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-BAPI-API-KEY"]).toBe("sub1-key");
      return bybitEnvelopeResponse({ list: [{ totalEquity: "500.00" }] });
    });

    const result = (await getSubAccountSummary(env, { accountLabel: "sub-trading1" })) as unknown as {
      accountLabel: string;
      wallet: { totalEquity: string };
    };
    expect(result.accountLabel).toBe("sub-trading1");
    expect(result.wallet.totalEquity).toBe("500.00");
  });

  it("fans out across every configured sub-account when accountLabel is omitted", async () => {
    mockFetch((_url, init) => {
      const headers = init?.headers as Record<string, string>;
      const equity = headers["X-BAPI-API-KEY"] === "sub1-key" ? "111" : "222";
      return bybitEnvelopeResponse({ list: [{ totalEquity: equity }] });
    });

    const result = (await getSubAccountSummary(env, {})) as unknown as {
      accounts: Array<{ accountLabel: string; wallet: { totalEquity: string } }>;
    };
    expect(result.accounts).toHaveLength(2);
    const byLabel = Object.fromEntries(result.accounts.map((a) => [a.accountLabel, a.wallet.totalEquity]));
    expect(byLabel["sub-trading1"]).toBe("111");
    expect(byLabel["sub-trading2"]).toBe("222");
  });

  it("throws UnknownAccountError for an accountLabel not in the roster", async () => {
    mockFetch(() => bybitEnvelopeResponse({}));
    await expect(getSubAccountSummary(env, { accountLabel: "sub-removed" })).rejects.toBeInstanceOf(
      UnknownAccountError,
    );
  });

  it("rejects targeting the master account label via this sub-account-only tool", async () => {
    mockFetch(() => bybitEnvelopeResponse({}));
    await expect(getSubAccountSummary(env, { accountLabel: "master" })).rejects.toThrow(
      /not a sub-account/,
    );
  });
});
