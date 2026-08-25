import { signRequest } from "./sign.js";

/**
 * ============================================================================
 * READ-ONLY GUARDRAIL
 * ============================================================================
 * This client exposes exactly one HTTP method: `get()`. There is no post/put/
 * delete/patch anywhere in this module, and every call is checked against the
 * ALLOWED_PATHS allowlist below before a request is ever sent. Do not add a
 * mutating method here, and do not add a path to ALLOWED_PATHS unless it is a
 * documented Bybit V5 GET endpoint. This is the structural enforcement of
 * "strictly read-only" described in the project plan (§6) — it must never be
 * weakened to make a tool "just work".
 * ============================================================================
 */

export const BYBIT_API_BASE = "https://api.bybit.com";

/** The exact set of Bybit V5 GET endpoints this server is permitted to call. */
export const ALLOWED_PATHS = new Set<string>([
  "/v5/account/wallet-balance",
  "/v5/account/info",
  "/v5/user/query-sub-members",
  "/v5/position/closed-pnl",
  "/v5/execution/list",
  "/v5/asset/transfer/query-inter-transfer-list",
  "/v5/asset/deposit/query-record",
  "/v5/asset/withdraw/query-record",
  "/v5/position/list",
  "/v5/order/realtime",
  "/v5/order/history",
]);

export interface BybitCredentials {
  apiKey: string;
  apiSecret: string;
}

/** Raw envelope every Bybit V5 response is wrapped in. */
export interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
  retExtInfo?: unknown;
  time?: number;
}

export class BybitApiError extends Error {
  readonly retCode: number;
  readonly retMsg: string;

  constructor(retCode: number, retMsg: string) {
    // Never include credentials/signature in this message.
    super(`Bybit API error (retCode ${retCode}): ${retMsg}`);
    this.name = "BybitApiError";
    this.retCode = retCode;
    this.retMsg = retMsg;
  }
}

const RECV_WINDOW_MS = "5000";

/** Build a Bybit-compatible query string: keys sorted, empty/undefined values dropped. */
function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined) continue;
    searchParams.set(key, String(value));
  }
  return searchParams.toString();
}

/**
 * Perform a signed GET request against a Bybit V5 endpoint.
 *
 * @param path - must be present in ALLOWED_PATHS, e.g. "/v5/account/wallet-balance".
 * @param params - query params; undefined values are omitted.
 * @param credentials - the calling account's read-only API key/secret.
 */
export async function get<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  credentials: BybitCredentials,
): Promise<T> {
  if (!ALLOWED_PATHS.has(path)) {
    throw new Error(`Refusing to call non-allowlisted Bybit path: ${path}`);
  }

  const queryString = buildQueryString(params);
  const timestamp = Date.now().toString();
  const signature = await signRequest(
    credentials.apiSecret,
    timestamp,
    credentials.apiKey,
    RECV_WINDOW_MS,
    queryString,
  );

  const url = `${BYBIT_API_BASE}${path}${queryString ? `?${queryString}` : ""}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-BAPI-API-KEY": credentials.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": RECV_WINDOW_MS,
    },
  });

  if (!response.ok) {
    // Never echo request headers (they contain the API key/signature) in the error.
    throw new Error(`Bybit HTTP error: ${response.status} ${response.statusText} on ${path}`);
  }

  const body = (await response.json()) as BybitEnvelope<T>;

  if (body.retCode !== 0) {
    throw new BybitApiError(body.retCode, body.retMsg);
  }

  return body.result;
}
