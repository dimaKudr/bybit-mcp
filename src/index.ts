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

app.all("/mcp", async (c) => {
  const env: Env = { BYBIT_ACCOUNTS: c.env.BYBIT_ACCOUNTS };

  const server = new McpServer({
    name: "bybit-mcp",
    version: "1.0.0",
  });

  for (const tool of createToolDefinitions()) {
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
