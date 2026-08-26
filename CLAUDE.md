# bybit-mcp

Read-only remote MCP server exposing Bybit UTA (Unified Trading Account) data — master
account and a small, fixed set of sub-accounts — as tools for Claude, hosted as a
Cloudflare Worker. See `README.md` for setup/runbook instructions.

## Hard rule: this server must never become able to mutate Bybit state

This is the entire point of the project — treat any change that weakens it as a
regression, not a stylistic nit:

- `src/bybit/client.ts` must expose only a `get()` method. Never add `post`/`put`/`delete`.
- Every Bybit call must go through `client.ts`'s `ALLOWED_PATHS` allowlist — never let a
  tool construct its own `fetch` to Bybit.
- No tool in `src/tools/index.ts` may ever wrap a mutating (non-GET) Bybit endpoint.
- Never let an API key, API secret, HMAC signature, or the `CONNECTOR_AUTH_TOKEN` appear in a
  thrown error, a log line, or a tool response — check this especially on error paths
  (non-2xx HTTP, non-zero `retCode`), not just the happy path.
- `src/auth.ts`'s bearer check must stay constant-time (compare fixed-length digests, not
  raw strings) — a naive `===`/byte-loop reintroduces a timing side-channel.

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # vitest run (mocked fetch/KV, runs in the actual Workers runtime
                     # via @cloudflare/vitest-pool-workers — no live Bybit/Cloudflare needed)
npm run dev          # wrangler dev (local, uses .dev.vars — see README)
npm run deploy       # wrangler deploy — do not run against the user's real account
                      # without being asked; this is their call, not something to do
                      # proactively
```

## Structure

```
src/
  index.ts            # Hono app, bearer auth, MCP mount (McpServer built once at module
                       # scope; the transport instance is created per request because the
                       # SDK's stateless Streamable HTTP transport requires that)
  auth.ts              # timing-safe bearer token check
  accounts.ts           # KV account roster (account-index + account:<label>), short
                         # in-memory cache, loud error on index/entry drift
  cache.ts               # short-TTL cache wrapper for high-traffic idempotent GETs
  bybit/
    client.ts             # get()-only client + ALLOWED_PATHS allowlist
    sign.ts                 # HMAC-SHA256 request signing via Web Crypto
    types.ts                 # zod schemas for Bybit request/response shapes
  tools/
    index.ts                  # tool registry — guardrail comment lives above it
    common.ts                  # shared helpers (bounded auto-pagination, cache wiring)
    accountSummary.ts, subAccounts.ts, pnl.ts, tradeHistory.ts,
    transferHistory.ts, openPositions.ts, openOrders.ts
test/                            # mirrors src/, one file per module/tool, mocks fetch + KV
```

## Conventions to keep consistent when adding tools

- Naming: `snake_case`, verb-first (`get_...`, `list_...`).
- `accountLabel` param: omitted = master account, except `get_sub_account_summary` and
  `get_sub_account_pnl` which default to *all* configured sub-accounts when omitted. An
  unknown label must throw a clear "no such account" error, never return silently empty.
- Numeric fields from Bybit (balances, PnL, prices) stay as **strings** — never
  `Number()`/`parseFloat()` them; that's a float-precision regression.
- Pagination: accept an optional `cursor`, return `nextCursor`, and auto-follow up to 3
  pages internally for the common case.
- Time ranges: pass `startTime`/`endTime` straight through to Bybit as epoch ms if given;
  never invent a default lookback window in our code.
- On success, strip Bybit's `retCode`/`retMsg`/`retExtInfo` wrapper. On failure (non-zero
  `retCode`), throw an MCP tool error including `retCode`/`retMsg` — never the request
  credentials.
- `get_transfer_history` with `transferType: "all"` fans out to three independent Bybit
  endpoints (internal/deposit/withdrawal) with independent cursor spaces — a `cursor` is
  only valid combined with a specific `transferType`, not `"all"`.

## Notes on pinned dependencies

`vitest@^3.2.7` and `@cloudflare/vitest-pool-workers@^0.12.0` are pinned below their
latest majors (vitest 4 / pool-workers 0.22) because that newer pairing had dropped the
documented `defineWorkersConfig` config API in favor of an unverified/undocumented
replacement at the time this was built. Re-check upstream docs before upgrading either.

## Deliberately out of scope for v1 (don't add without being asked)

- `get_fee_rate`, `get_wallet_type`, `get_collateral_info`, `get_market_ticker` — optional
  fast-follow tools from the original design, not required.
- GitHub Actions CI/deploy workflow.
- Any testnet toggle, OAuth flow, or multi-user auth model — single static bearer token
  for a single user is the intended v1 design, not a shortcut to fix later.
