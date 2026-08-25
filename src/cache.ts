/**
 * Short-TTL cache wrapper around the Workers Cache API, used for the
 * higher-traffic idempotent GETs (balances, positions) so a single Claude
 * conversation calling several tools back-to-back doesn't hammer Bybit's
 * rate limits. Per the plan (§2 point 7), this is deliberately short
 * (10-15s) — it is not a historical data store.
 */

const DEFAULT_TTL_SECONDS = 15;

/** Build a stable, collision-safe cache key from a tool name + its resolved params. */
export function buildCacheKey(toolName: string, params: Record<string, unknown>): string {
  const sortedEntries = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams();
  for (const [key, value] of sortedEntries) {
    query.set(key, JSON.stringify(value));
  }
  return `https://bybit-mcp-cache.internal/${toolName}?${query.toString()}`;
}

/**
 * Return a cached JSON value for `cacheKeyUrl` if present, otherwise compute
 * it via `compute`, cache it for `ttlSeconds`, and return it.
 */
export async function withCache<T>(
  cacheKeyUrl: string,
  compute: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<T> {
  const cache = caches.default;
  const cacheKey = new Request(cacheKeyUrl);

  const cached = await cache.match(cacheKey);
  if (cached) {
    return (await cached.json()) as T;
  }

  const result = await compute();

  const response = new Response(JSON.stringify(result), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `max-age=${ttlSeconds}`,
    },
  });
  await cache.put(cacheKey, response);

  return result;
}
