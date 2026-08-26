declare module "cloudflare:test" {
  interface ProvidedEnv {
    CONNECTOR_AUTH_TOKEN: string;
    BYBIT_ACCOUNTS: KVNamespace;
  }
}
