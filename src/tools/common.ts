import { get, type BybitCredentials } from "../bybit/client.js";
import type { ListResult } from "../bybit/types.js";

/** Env bindings available to every tool handler. */
export interface Env {
  BYBIT_ACCOUNTS: KVNamespace;
}

/** Bounded auto-follow: fetch up to `maxPages` pages of a Bybit list endpoint. */
const DEFAULT_MAX_PAGES = 3;

export interface PaginatedFetchResult<T> {
  items: T[];
  nextCursor?: string;
}

/**
 * Fetch a Bybit V5 "list" endpoint, auto-following `nextPageCursor` up to
 * `maxPages` times so common "just give me the recent history" calls don't
 * require Claude to make several round-trips, while still surfacing a
 * `nextCursor` for explicit further pagination (per plan §5).
 */
export async function fetchPaginated<T = Record<string, unknown>>(
  path: string,
  baseParams: Record<string, string | number | boolean | undefined>,
  credentials: BybitCredentials,
  options: { cursor?: string; maxPages?: number } = {},
): Promise<PaginatedFetchResult<T>> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  let cursor = options.cursor;
  const items: T[] = [];
  let nextCursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await get<ListResult>(
      path,
      { ...baseParams, cursor, limit: baseParams.limit ?? 50 },
      credentials,
    );
    const pageItems = (result.list ?? []) as T[];
    items.push(...pageItems);
    nextCursor = result.nextPageCursor && result.nextPageCursor.length > 0 ? result.nextPageCursor : undefined;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return { items, nextCursor };
}

/**
 * Convert an optional ISO 8601 string param to the ms-epoch string Bybit
 * expects. Passed through as-is when omitted — no invented default window
 * (per plan §5), Bybit applies its own default lookback in that case.
 */
export function isoToEpochMs(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO 8601 date/time: "${iso}"`);
  }
  return parsed.getTime().toString();
}

/** A user-facing MCP tool error. Never include API keys/secrets/signatures here. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
