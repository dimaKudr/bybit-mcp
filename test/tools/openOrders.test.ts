import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BybitApiError } from "../../src/bybit/client.js";
import { getOpenOrders, getOrderHistory } from "../../src/tools/openOrders.js";
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

describe("get_open_orders", () => {
  it("returns resting orders for the master account by default", async () => {
    mockFetch((url) => {
      expect(url.pathname).toBe("/v5/order/realtime");
      return bybitEnvelopeResponse({ list: [{ orderId: "1", orderStatus: "New" }] });
    });

    const result = (await getOpenOrders(env, { category: "linear" })) as unknown as {
      accountLabel: string;
      orders: Array<{ orderStatus: string }>;
    };
    expect(result.accountLabel).toBe("master");
    expect(result.orders[0].orderStatus).toBe("New");
  });

  it("throws on a non-zero retCode", async () => {
    mockFetch(() => bybitEnvelopeResponse(null, 10001, "Params error"));
    await expect(getOpenOrders(env, { category: "linear" })).rejects.toBeInstanceOf(BybitApiError);
  });
});

describe("get_order_history", () => {
  it("returns closed/cancelled/filled orders for a targeted sub-account", async () => {
    mockFetch((url, init) => {
      expect(url.pathname).toBe("/v5/order/history");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-BAPI-API-KEY"]).toBe("sub1-key");
      return bybitEnvelopeResponse({ list: [{ orderId: "2", orderStatus: "Filled" }] });
    });

    const result = (await getOrderHistory(env, {
      category: "linear",
      accountLabel: "sub-trading1",
    })) as unknown as { accountLabel: string; orders: Array<{ orderStatus: string }> };
    expect(result.accountLabel).toBe("sub-trading1");
    expect(result.orders[0].orderStatus).toBe("Filled");
  });

  it("throws on a non-zero retCode", async () => {
    mockFetch(() => bybitEnvelopeResponse(null, 10001, "Params error"));
    await expect(getOrderHistory(env, { category: "linear" })).rejects.toBeInstanceOf(BybitApiError);
  });
});
