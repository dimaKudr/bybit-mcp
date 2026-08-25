# bybit-mcp

A read-only remote MCP server exposing Bybit UTA (Unified Trading Account) data
— master account and a small, fixed set of sub-accounts — to Claude as a
custom connector. Runs as a Cloudflare Worker. See
[`bybit-mcp-plan.md`](./bybit-mcp-plan.md) for the full design doc; this
README is the practical setup/runbook.

**This server is strictly read-only by design.** It cannot place orders,
cancel orders, or move funds — see [Read-only by design](#read-only-by-design)
below for how that's enforced.

## Contents

- [Architecture & transport choice](#architecture--transport-choice)
- [Tools exposed](#tools-exposed)
- [Setup](#setup)
  1. [Create read-only Bybit API keys](#1-create-read-only-bybit-api-keys)
  2. [Create the KV namespace](#2-create-the-kv-namespace)
  3. [Populate the account roster](#3-populate-the-account-roster)
  4. [Set the bearer token secret](#4-set-the-bearer-token-secret)
  5. [Deploy](#5-deploy)
  6. [Add the connector in Claude](#6-add-the-connector-in-claude)
- [Day-to-day: adding/removing accounts](#day-to-day-addingremoving-accounts)
- [Local development](#local-development)
- [Read-only by design](#read-only-by-design)

## Architecture & transport choice

- **Runtime:** Cloudflare Workers.
- **HTTP framework:** [Hono](https://hono.dev/).
- **MCP transport:** `@modelcontextprotocol/sdk`'s
  `WebStandardStreamableHTTPServerTransport`, mounted directly in the Worker's
  `fetch` handler, **stateless** (a fresh `McpServer` + transport is created
  per request). The SDK enforces this itself: a stateless transport
  (`sessionIdGenerator` unset) throws if reused across requests, and its
  underlying `Protocol.connect()` throws if called twice on one server
  without an intervening `close()` — and closing right after
  `handleRequest()` resolves would tear down the in-flight SSE response
  stream before the client finishes reading it. Only the **tool
  definitions** (names/descriptions/zod schemas/handlers), which don't
  depend on the request, are hoisted to module scope and reused; the
  `McpServer` instance itself is deliberately rebuilt per request (see the
  comment at its construction site in `src/index.ts`).

  The alternative considered was Cloudflare's `agents` package
  (`McpAgent`), which is built on Durable Objects. That's the right choice
  when you need session/connection state (e.g. long-lived WebSocket-style
  agent sessions), but this server doesn't need any server-side state between
  tool calls — every tool call is a self-contained, idempotent read against
  Bybit (or KV), and the MCP SDK's own examples ship a
  `WebStandardStreamableHTTPServerTransport` + Hono example specifically
  aimed at "any runtime: Node.js, Cloudflare Workers, Deno, Bun" in stateless
  mode. Using it avoids provisioning a Durable Object namespace/binding purely
  to satisfy the transport, keeps the Worker a plain stateless `fetch`
  handler, and is the pattern the SDK itself documents for this exact
  scenario. If a future version needs session resumability or server-pushed
  notifications between calls, that's a reasonable time to revisit `McpAgent`.

- **Signing:** Web Crypto (`crypto.subtle`) HMAC-SHA256 — no Node-only crypto
  dependency, portable across Workers.
- **Validation:** `zod` for both tool input schemas and the KV account-roster
  shape.
- **Testing:** `vitest` + `@cloudflare/vitest-pool-workers`, running tests
  inside the actual Workers runtime (Miniflare) with isolated per-test KV/Cache
  storage. `fetch` is mocked per test (`vi.stubGlobal`); nothing in the test
  suite makes real network calls or requires real Bybit credentials.

## Tools exposed

| Tool | Bybit endpoint(s) |
|---|---|
| `list_configured_accounts` | *(KV only, no Bybit call)* |
| `get_account_summary` | `GET /v5/account/wallet-balance`, `GET /v5/account/info` |
| `list_sub_accounts` | `GET /v5/user/query-sub-members` |
| `get_sub_account_summary` | `GET /v5/account/wallet-balance` (per sub key) |
| `get_account_pnl` | `GET /v5/position/closed-pnl` |
| `get_sub_account_pnl` | `GET /v5/position/closed-pnl` (per sub key) |
| `get_trade_history` | `GET /v5/execution/list` |
| `get_transfer_history` | `GET /v5/asset/transfer/query-inter-transfer-list`, `GET /v5/asset/deposit/query-record`, `GET /v5/asset/withdraw/query-record` |
| `get_open_positions` | `GET /v5/position/list` |
| `get_open_orders` | `GET /v5/order/realtime` |
| `get_order_history` | `GET /v5/order/history` |

All calls are `GET`, gated by the `ALLOWED_PATHS` allowlist in
`src/bybit/client.ts`. Bybit's field names/params are re-verified against the
[live V5 docs](https://bybit-exchange.github.io/docs/v5/guide) as of this
writing, but Bybit does evolve these — if a tool starts erroring with an
unexpected `retMsg` about an unknown/renamed param, check the docs for that
endpoint first.

## Setup

None of the following commands are run for you — the assistant that built
this does not have access to your real Cloudflare account or Bybit API keys.
Run all of these yourself, from the repo root.

### 1. Create read-only Bybit API keys

For **every** account in scope (the master account, and each sub-account you
want visibility into):

1. Log into that account on Bybit (sub-accounts have their own login, or you
   can switch into them from the master account's account-switcher).
2. Go to **API Management** → **Create New Key**.
3. Choose **System-generated API Keys**, and under permissions select
   **Read-Only**. Do not grant any Trade/Transfer/Withdraw permission — this
   is belt-and-suspenders alongside the code-level `ALLOWED_PATHS` allowlist,
   not a substitute for it.
4. Optionally restrict by IP if you have a stable egress IP; Cloudflare
   Workers egress IPs are not stable/pinned by default, so in practice you'll
   likely leave this unrestricted and rely on the key being read-only + the
   bearer token gating access to the Worker itself.
5. Note the API Key + Secret — the secret is only shown once.

### 2. Create the KV namespace

```bash
wrangler kv namespace create BYBIT_ACCOUNTS
```

This prints an `id`. Put it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "BYBIT_ACCOUNTS"
id = "<the id printed above>"
```

(You can also create a `--preview` namespace and set `preview_id` for local
`wrangler dev` testing — see [Local development](#local-development).)

### 3. Populate the account roster

The account roster (master + sub-accounts, with their read-only API
keys/secrets) lives entirely in this KV namespace — **not** in
`wrangler.toml` or Worker secrets — so that adding/removing an account month
to month is a pure data change with no redeploy.

One `account:<label>` entry per account:

```bash
wrangler kv key put --binding=BYBIT_ACCOUNTS "account:master" \
  '{"uid":"111111111","kind":"master","apiKey":"...","apiSecret":"..."}'

wrangler kv key put --binding=BYBIT_ACCOUNTS "account:sub-trading1" \
  '{"uid":"222222222","kind":"sub","apiKey":"...","apiSecret":"..."}'
```

`kind` must be `"master"` for exactly one account, `"sub"` for the rest.

Then a single `account-index` entry listing every configured label:

```bash
wrangler kv key put --binding=BYBIT_ACCOUNTS "account-index" \
  '["master","sub-trading1"]'
```

Pick labels that read naturally in conversation (`eth-risky`, `btc-scalp`)
since Claude resolves your phrasing to a label by calling
`list_configured_accounts` and matching against the label text — there's no
separate display-name/fuzzy-matching layer in v1.

Verify with:

```bash
wrangler kv key get --binding=BYBIT_ACCOUNTS "account-index"
wrangler kv key get --binding=BYBIT_ACCOUNTS "account:master"
```

### 4. Set the bearer token secret

Generate a strong random token (e.g. `openssl rand -hex 32`) and store it as
a Worker secret — never in `wrangler.toml`, never committed:

```bash
wrangler secret put MCP_BEARER_TOKEN
```

You'll paste the token when prompted. Save it somewhere safe (e.g. a password
manager) — you'll need it again in step 6.

### 5. Deploy

```bash
npm install
npm run typecheck
npm run lint
npm test
wrangler deploy
```

Note the deployed Worker URL (e.g. `https://bybit-mcp.<your-subdomain>.workers.dev`).

### 6. Add the connector in Claude

In Claude, go to **Settings → Connectors → Add custom connector** and add:

- **URL:** `https://<your-worker-url>/mcp`
- **Authentication:** Bearer token — paste the `MCP_BEARER_TOKEN` value from
  step 4.

Once connected, sanity-check with `list_configured_accounts` — it should
return exactly the accounts you put in KV in step 3, with no secrets in the
response.

## Day-to-day: adding/removing accounts

This is the entire monthly "add a couple new subs, remove some old ones"
workflow — two `wrangler kv` calls per account, no redeploy, no restart, live
on the next tool call (subject to the ~45s in-memory roster cache described
in `src/accounts.ts`):

```bash
# Add a new sub-account
wrangler kv key put --binding=BYBIT_ACCOUNTS "account:sub-trading11" \
  '{"uid":"987654321","kind":"sub","apiKey":"...","apiSecret":"..."}'

# Update account-index to include it
wrangler kv key put --binding=BYBIT_ACCOUNTS "account-index" \
  '["master","sub-trading1","sub-trading2","sub-trading11"]'

# Remove a sub-account you closed
wrangler kv key delete --binding=BYBIT_ACCOUNTS "account:sub-trading4"

# ...and update account-index to drop "sub-trading4" the same way as above
```

If `account-index` ever references a label with no matching
`account:<label>` entry (e.g. you forgot the second command above), every
account-scoped tool call will fail loudly with a clear error naming the
missing label(s), rather than silently omitting that account — this is
intentional (see `src/accounts.ts`).

## Local development

```bash
cp .dev.vars.example .dev.vars   # then edit in a real local bearer token
wrangler kv namespace create BYBIT_ACCOUNTS --preview
# paste the printed preview id into wrangler.toml's `preview_id`
wrangler dev
```

Seed a dummy account into the local preview KV the same way as step 3 above
(pointed at fake/dummy credentials — nothing in local dev needs to hit real
Bybit). `npm test` does not need any of this — the test suite mocks both KV
(via the Workers test pool's isolated storage) and `fetch` (Bybit's API),
and never touches real Cloudflare or Bybit infrastructure.

## Read-only by design

This is a hard requirement, enforced structurally rather than just "we chose
not to call those endpoints":

1. `src/bybit/client.ts` exposes exactly one HTTP method, `get()`. There is no
   `post`/`put`/`delete`/`patch` anywhere in the codebase.
2. Every call is checked against an explicit `ALLOWED_PATHS` allowlist before
   it's sent; an unlisted path throws instead of calling Bybit.
3. The tool registry (`src/tools/index.ts`) carries an explicit guardrail
   comment: no tool may ever be wired to a mutating Bybit call.
4. Bybit API keys should also be created as **read-only** on Bybit's side
   (step 1 above) — this is belt-and-suspenders alongside the code-level
   allowlist, not a replacement for it.
5. The Worker's own bearer-token auth (`src/auth.ts`) is a timing-safe
   comparison, and the token — like all API keys/secrets/signatures — is
   never logged or echoed in any error text or response body.
