import { vi } from "vitest";

/**
 * Stub `globalThis.fetch` for a test with a routing handler. Returns the
 * vi.fn() mock so call assertions can be made against it. Callers are
 * responsible for calling `vi.unstubAllGlobals()` (or restoring manually) in
 * an `afterEach`.
 */
export function mockFetch(
  handler: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(new URL(rawUrl), init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Build a Bybit V5 success/error envelope Response, as `fetch` would return it. */
export function bybitEnvelopeResponse(result: unknown, retCode = 0, retMsg = "OK"): Response {
  return new Response(
    JSON.stringify({ retCode, retMsg, result, retExtInfo: {}, time: Date.now() }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
