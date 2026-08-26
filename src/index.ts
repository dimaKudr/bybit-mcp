import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { bearerAuth, type AuthEnv } from "./auth.js";
import { createToolDefinitions } from "./tools/index.js";
import type { Env } from "./tools/common.js";

/**
 * Worker entrypoint. Mounts a stateless MCP Streamable HTTP endpoint behind
 * a static bearer-token auth middleware — see README.md for why the
 * WebStandardStreamableHTTPServerTransport (over Cloudflare's `agents`
 * McpAgent/Durable Objects) was chosen.
 */

const app = new Hono<AuthEnv>();

app.get("/health", (c) => c.json({ status: "ok" }));

app.use("/mcp", bearerAuth);

// Tool definitions (name/description/schema/handler) don't depend on the
// request, so this part is safe and cheap to build once at module scope and
// reuse across requests/isolates.
const toolDefinitions = createToolDefinitions();

app.all("/mcp", async (c) => {
  const env: Env = { BYBIT_ACCOUNTS: c.env.BYBIT_ACCOUNTS };

  // The McpServer instance itself, however, is intentionally constructed
  // fresh per request rather than hoisted alongside `toolDefinitions` above.
  // `WebStandardStreamableHTTPServerTransport` is stateless
  // (`sessionIdGenerator` unset) and its `handleRequest()` explicitly refuses
  // to be reused across requests ("Stateless transport cannot be reused
  // across requests. Create a new transport per request."), and the
  // underlying `Protocol.connect()` throws if called twice on the same
  // server without an intervening `close()`. Closing the server as soon as
  // `handleRequest()` resolves isn't safe either, since the SSE response
  // stream it just handed back is still being consumed by the client at that
  // point and closing would tear it down mid-flight. A fresh, cheap
  // `McpServer` + transport pairing per request avoids all of that
  // lifecycle/session-leakage risk; only the tool *definitions* (schemas,
  // descriptions, handlers) are reused.
  const server = new McpServer({
    name: "bybit-mcp",
    version: "1.0.0",
  });

  for (const tool of toolDefinitions) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
      },
      async (args: unknown) => {
        const result = await tool.handler(env, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

export default app;
