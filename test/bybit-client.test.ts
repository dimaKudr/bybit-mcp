import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { ALLOWED_PATHS, BybitApiError, get } from "../src/bybit/client.js";
import { signRequest } from "../src/bybit/sign.js";
import { mockFetch, bybitEnvelopeResponse } from "./testUtils.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signRequest", () => {
  it("matches an independent HMAC-SHA256 implementation (Node crypto) for a known payload", async () => {
    // Cross-check against Node's `crypto` module (not Web Crypto) as an
    // independent oracle for the same algorithm Bybit documents:
    // sign_str = timestamp + apiKey + recvWindow + queryString, HMAC-SHA256,
    // hex-encoded. This confirms our Web Crypto implementation is correct
    // without requiring network access to Bybit's live docs.
    const apiKey = "test-api-key-123";
    const apiSecret = "test-api-secret-456";
    const timestamp = "1700000000000";
    const recvWindow = "5000";
    const queryString = "accountType=UNIFIED&coin=USDT";

    const expected = createHmac("sha256", apiSecret)
      .update(`${timestamp}${apiKey}${recvWindow}${queryString}`)
      .digest("hex");

    const actual = await signRequest(apiSecret, timestamp, apiKey, recvWindow, queryString);

    expect(actual).toBe(expected);
  });

  it("produces a different signature when the secret changes", async () => {
    const a = await signRequest("secret-a", "1700000000000", "key", "5000", "foo=bar");
    const b = await signRequest("secret-b", "1700000000000", "key", "5000", "foo=bar");
    expect(a).not.toBe(b);
  });

  it("produces a different signature when the query string changes", async () => {
    const a = await signRequest("secret", "1700000000000", "key", "5000", "foo=bar");
    const b = await signRequest("secret", "1700000000000", "key", "5000", "foo=baz");
    expect(a).not.toBe(b);
  });
});

describe("ALLOWED_PATHS enforcement", () => {
  const credentials = { apiKey: "k", apiSecret: "s" };

  it("allows a listed path through to fetch", async () => {
    const fetchMock = mockFetch(() => bybitEnvelopeResponse({ list: [] }));
    await get("/v5/account/wallet-balance", { accountType: "UNIFIED" }, credentials);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws and never calls fetch for a non-allowlisted path", async () => {
    const fetchMock = mockFetch(() => bybitEnvelopeResponse({}));
    await expect(get("/v5/order/create", {}, credentials)).rejects.toThrow(
      /non-allowlisted/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws for any mutating-looking path even if superficially similar to an allowed one", async () => {
    mockFetch(() => bybitEnvelopeResponse({}));
    await expect(get("/v5/position/list/cancel", {}, credentials)).rejects.toThrow(
      /non-allowlisted/i,
    );
  });

  it("every entry in ALLOWED_PATHS is a v5 GET-style path (sanity check on the allowlist itself)", () => {
    for (const path of ALLOWED_PATHS) {
      expect(path.startsWith("/v5/")).toBe(true);
    }
  });
});

describe("get() request construction", () => {
  const credentials = { apiKey: "the-api-key", apiSecret: "the-secret" };

  it("sends the expected auth headers and sorted query string", async () => {
    const fetchMock = mockFetch((url, init) => {
      expect(url.pathname).toBe("/v5/account/wallet-balance");
      expect(url.searchParams.get("accountType")).toBe("UNIFIED");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-BAPI-API-KEY"]).toBe("the-api-key");
      expect(headers["X-BAPI-SIGN"]).toBeTruthy();
      expect(headers["X-BAPI-SIGN-TYPE"]).toBe("2");
      expect(headers["X-BAPI-TIMESTAMP"]).toBeTruthy();
      expect(headers["X-BAPI-RECV-WINDOW"]).toBe("5000");
      return bybitEnvelopeResponse({ list: [{ coin: "USDT" }] });
    });

    const result = await get<{ list: Array<{ coin: string }> }>(
      "/v5/account/wallet-balance",
      { accountType: "UNIFIED" },
      credentials,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.list[0].coin).toBe("USDT");
  });

  it("never includes the api secret anywhere in the request URL or headers", async () => {
    const fetchMock = mockFetch((url, init) => {
      const headers = JSON.stringify(init?.headers ?? {});
      expect(url.toString()).not.toContain(credentials.apiSecret);
      expect(headers).not.toContain(credentials.apiSecret);
      return bybitEnvelopeResponse({});
    });
    await get("/v5/account/info", {}, credentials);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("omits undefined params from the query string", async () => {
    mockFetch((url) => {
      expect(url.search).toBe("?category=linear");
      return bybitEnvelopeResponse({});
    });
    await get("/v5/position/list", { category: "linear", symbol: undefined }, credentials);
  });

  it("throws BybitApiError with retCode/retMsg on a non-zero retCode, without leaking credentials", async () => {
    mockFetch(() => bybitEnvelopeResponse(null, 10003, "Invalid API key"));
    await expect(get("/v5/account/info", {}, credentials)).rejects.toMatchObject({
      retCode: 10003,
      retMsg: "Invalid API key",
    });
    try {
      await get("/v5/account/info", {}, credentials);
    } catch (error) {
      expect(error).toBeInstanceOf(BybitApiError);
      expect((error as Error).message).not.toContain(credentials.apiSecret);
      expect((error as Error).message).not.toContain(credentials.apiKey);
    }
  });

  it("throws a plain error (not silently swallowed) on a non-2xx HTTP response", async () => {
    mockFetch(() => new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }));
    await expect(get("/v5/account/info", {}, credentials)).rejects.toThrow(/500/);
  });

  it("includes the response body in the error on a non-2xx HTTP response (e.g. a WAF/CDN block page)", async () => {
    mockFetch(() => new Response("Forbidden: request blocked", { status: 403, statusText: "Forbidden" }));
    await expect(get("/v5/account/info", {}, credentials)).rejects.toThrow(/Forbidden: request blocked/);
  });
});
