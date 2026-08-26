import type { MiddlewareHandler } from "hono";

/**
 * Constant-time string comparison. Rather than comparing raw bytes directly
 * (which can leak length via early-exit branch timing when strings differ in
 * size), both inputs are first hashed to a fixed-length digest, then compared
 * with a branchless XOR accumulator so comparison time doesn't depend on
 * where (or whether) the strings differ.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);

  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  // Also fold in whether the *original* strings had equal length, computed
  // without branching on the comparison result itself.
  diff |= a.length === b.length ? 0 : 1;
  return diff === 0;
}

export interface AuthEnv {
  Bindings: {
    CONNECTOR_AUTH_TOKEN: string;
    BYBIT_ACCOUNTS: KVNamespace;
  };
}

const BEARER_PREFIX = "Bearer ";

/**
 * Hono middleware enforcing a static bearer token on every request, compared
 * timing-safely. The token itself is never logged or echoed back in any
 * response or error text.
 */
export const bearerAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const expectedToken = c.env.CONNECTOR_AUTH_TOKEN;
  if (!expectedToken) {
    // Misconfiguration, not a client error — don't leak details either way.
    return c.text("Server misconfigured", 500);
  }

  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith(BEARER_PREFIX)) {
    return c.text("Unauthorized", 401);
  }

  const presentedToken = header.slice(BEARER_PREFIX.length);
  const isValid = await timingSafeEqual(presentedToken, expectedToken);
  if (!isValid) {
    return c.text("Unauthorized", 401);
  }

  await next();
};
