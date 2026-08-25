import { env } from "cloudflare:test";
import type { Env } from "../../src/tools/common.js";

export const MASTER: Record<string, unknown> = {
  uid: "1000",
  kind: "master",
  apiKey: "master-key",
  apiSecret: "master-secret",
};

export const SUB1: Record<string, unknown> = {
  uid: "2000",
  kind: "sub",
  apiKey: "sub1-key",
  apiSecret: "sub1-secret",
};

export const SUB2: Record<string, unknown> = {
  uid: "3000",
  kind: "sub",
  apiKey: "sub2-key",
  apiSecret: "sub2-secret",
};

/** Reset KV and seed a standard master + two sub-account roster for a test. */
export async function seedStandardRoster(): Promise<Env> {
  const keys = await env.BYBIT_ACCOUNTS.list();
  for (const key of keys.keys) {
    await env.BYBIT_ACCOUNTS.delete(key.name);
  }
  await env.BYBIT_ACCOUNTS.put("account-index", JSON.stringify(["master", "sub-trading1", "sub-trading2"]));
  await env.BYBIT_ACCOUNTS.put("account:master", JSON.stringify(MASTER));
  await env.BYBIT_ACCOUNTS.put("account:sub-trading1", JSON.stringify(SUB1));
  await env.BYBIT_ACCOUNTS.put("account:sub-trading2", JSON.stringify(SUB2));
  return { BYBIT_ACCOUNTS: env.BYBIT_ACCOUNTS };
}
