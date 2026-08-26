# Bybit geo-block investigation

## The problem

After deploying the Worker and successfully authenticating the connector
(`CONNECTOR_AUTH_TOKEN` correctly wired up), every tool call that hits Bybit
fails. The error surfaced by `src/bybit/client.ts`'s HTTP-error path
(`Bybit HTTP error: 403 ... — body: ...`) turned out to contain:

> "The Amazon CloudFront distribution is configured to block access from
> your country"

This is a **CloudFront-level geo-block on Bybit's side**, not a Bybit
application error. It happens before Bybit's API even parses the request —
confirmed because the failure is a raw HTTP 403 with no JSON `retCode`/
`retMsg` envelope, unlike every other error path this server already
handles (invalid key, wrong permissions, etc., which Bybit returns as
HTTP 200 + a non-zero `retCode`).

**Root cause:** a Cloudflare Worker does not run from a fixed, predictable
location. It executes at whichever Cloudflare data center is closest to the
*incoming* request's origin — in this deployment, that's wherever Claude's
(Anthropic's) infrastructure sends the MCP call from, not wherever the
account owner is physically located. Bybit blocks that jurisdiction at the
CDN layer, independent of the API key, its permissions, or the bearer-token
auth layer this server adds. The API key permissions were double-checked
(Unified Trading Positions/Orders read, Account/Subaccount Transfer) and are
correct — this is purely a network-origin problem.

## Options considered

### 1. Durable Object with a `locationHint` — rejected

Cloudflare Durable Objects can be pinned to a region hint (`weur`, `enam`,
`apac`, etc.) at creation time, and a DO's `fetch()` calls would then
originate from wherever the DO landed. Investigated as a way to force Bybit
calls out of a non-blocked region while staying entirely on Cloudflare.

**Verified against current Cloudflare docs
(`developers.cloudflare.com/durable-objects/reference/data-location/`) and
rejected:**

> "Hints are a best effort and not a guarantee. Durable Objects will not
> necessarily be instantiated in the hinted location, but instead
> instantiated in a data center selected to minimize latency from the
> hinted location."

- The hint is advisory only — Cloudflare may still place the object
  somewhere else.
- It only applies on the *first* `get()` call for a given object ID; after
  that the DO is permanently pinned wherever it happened to land, with no
  retry-your-way-into-a-better-region option.
- No guarantee at all about which region outbound `fetch()` calls actually
  egress from.
- Would also require upgrading to the Workers **Paid** plan (Durable
  Objects aren't on the free tier) — a real cost for a mechanism that isn't
  actually reliable.

Conclusion: this is a structural limitation of Cloudflare's compute
platform, not a DO-specific gap. Workers and Durable Objects are both
architected around dynamic edge placement optimized for latency, not fixed
geographic guarantees. No Cloudflare-hosted option can give a hard "this
always egresses from region X" guarantee.

### 2. Small external proxy in front of Bybit only

Keep the Worker, the KV account roster, `wrangler secret`-managed auth
token, and the whole README setup runbook exactly as they are. Add one
small forwarding service, hosted somewhere with a genuine fixed region/IP
(a VPS, or a Fly.io app — see below), that does nothing but relay the
already-signed Bybit request/response. Only `src/bybit/client.ts`'s fetch
target would change (from `api.bybit.com` directly to the proxy's URL).

- **Pros:** minimal blast radius — everything else in this repo is
  untouched. Works on any Cloudflare plan.
- **Cons:** a second component to deploy, secure (needs its own auth so
  arbitrary callers can't relay requests through it), and keep available.

### 3. Full rehost off Cloudflare

Move the entire MCP server (auth, account-roster storage, all tools) to a
platform with real, fixed regions, so the whole thing — not just a bolted-on
proxy — runs from a known, non-blocked location.

- **Pros:** one component instead of two; a genuine regional guarantee
  instead of a workaround; also removes the Workers-specific complexity of
  rebuilding `McpServer` per request (a long-lived process doesn't have
  that constraint).
- **Cons:** a real rewrite — KV roster access, secrets management, and the
  whole deploy workflow/README all need re-doing for the new platform.
  Only worth it if there's appetite to be off Cloudflare hosting long-term,
  not just to dodge this one geo-block.

## Fly.io analysis (the candidate for option 3)

Investigated whether Fly.io gives a genuine fixed-region/fixed-IP guarantee
(unlike Cloudflare's edge model), verified against Fly's own docs and a web
search of their current egress-IP documentation.

**Region placement:** Fly Machines are real VMs pinned to a chosen
datacenter — a deployment, not a latency-based hint. This is fundamentally
different from Cloudflare's DO location hint.

**Static egress IPs — the key finding:**
Fly.io has a purpose-built feature for exactly this problem:

- `fly ips allocate-egress --app <app-name> -r <region>` allocates a
  dedicated IPv4 (+ free IPv6) pair, scoped to the app and tied to one Fly
  region.
- **Cost:** $3.60/month per region, billed hourly.
- **Persistence:** app-scoped static egress IPs survive machine restarts
  and redeploys — they are not re-issued each time, unlike Fly's default
  NAT'd outbound IP (which the docs confirm *can* change across machine
  lifecycle events / infra changes).
- This is a documented, paid, real feature — not a best-effort placement
  hint.

**Open item to verify once actually deployed** (not a blocker, just not
fully confirmed from docs alone): Fly's docs don't explicitly guarantee the
static egress IP is the *only* source IP for all outbound traffic from the
app — there's a separate note that Fly apps prefer IPv6 when available.
Need to smoke-test after deployment that Bybit calls are actually going out
over the allocated static IPv4/IPv6 pair and not silently taking a
different path.

**What a Fly.io migration would actually touch in this repo:**

- The Hono app + MCP handler + tools can run largely as-is inside a normal
  Node process/container. Running as a long-lived Machine (vs. Workers'
  per-request isolate model) also removes the current
  rebuild-`McpServer`-per-request workaround needed for Workers' stateless
  Streamable HTTP transport.
- **Account roster:** two options —
  (a) keep Cloudflare KV as the data store and call its REST API from Fly
      (keeps existing data and the `wrangler kv key put`/`delete` runbook
      meaningful; adds one HTTP hop and a new Cloudflare API token secret), or
  (b) drop Cloudflare KV entirely for a Fly Volume + SQLite or similar.
  (a) is less rework.
- **Secrets:** `fly secrets set CONNECTOR_AUTH_TOKEN=...` etc., replacing
  `wrangler secret put`.
- **Deploy workflow / README:** rewritten for `fly launch` / `fly deploy` /
  `fly ips allocate-egress`, replacing the wrangler-based runbook.

## Status

No implementation decision has been made yet. Next step is deciding between
option 2 (small proxy, minimal change) and option 3 (full Fly.io rehost,
bigger rewrite but cleaner end state), or trying Fly.io directly since it
appears to satisfy the actual requirement (a genuine fixed egress
region/IP).
