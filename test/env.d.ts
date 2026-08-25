declare module "cloudflare:test" {
  interface ProvidedEnv {
    MCP_BEARER_TOKEN: string;
    BYBIT_ACCOUNTS: KVNamespace;
  }
}
