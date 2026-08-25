/**
 * Bybit V5 request signing (HMAC-SHA256 over Web Crypto).
 *
 * Per https://bybit-exchange.github.io/docs/v5/guide#authentication-for-http-requests
 * the signature payload for a GET request is:
 *
 *   timestamp + apiKey + recvWindow + queryString
 *
 * HMAC-SHA256'd with the account's API secret, hex-encoded.
 */

const textEncoder = new TextEncoder();

/** Hex-encode a byte buffer, lowercase (as Bybit expects for X-BAPI-SIGN). */
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute the HMAC-SHA256 signature for a Bybit V5 GET request.
 *
 * @param apiSecret - the account's read-only API secret. Never logged.
 * @param timestamp - epoch ms, as a string, matching the `X-BAPI-TIMESTAMP` header.
 * @param apiKey - the account's API key, matching the `X-BAPI-API-KEY` header.
 * @param recvWindow - epoch ms window, as a string, matching `X-BAPI-RECV-WINDOW`.
 * @param queryString - the URL query string (no leading `?`), sorted as built by
 *   the caller. Empty string if there are no params.
 */
export async function signRequest(
  apiSecret: string,
  timestamp: string,
  apiKey: string,
  recvWindow: string,
  queryString: string,
): Promise<string> {
  const payload = `${timestamp}${apiKey}${recvWindow}${queryString}`;
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return toHex(signature);
}
