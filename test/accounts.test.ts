import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  AccountRosterError,
  UnknownAccountError,
  getMasterAccount,
  getSubAccounts,
  loadAccountRoster,
  resolveAccount,
} from "../src/accounts.js";

async function seedRoster(entries: Record<string, unknown>, index: string[]) {
  await env.BYBIT_ACCOUNTS.put("account-index", JSON.stringify(index));
  for (const [label, value] of Object.entries(entries)) {
    await env.BYBIT_ACCOUNTS.put(`account:${label}`, JSON.stringify(value));
  }
}

const masterRecord = { uid: "1", kind: "master", apiKey: "mk", apiSecret: "ms" };
const subRecord = { uid: "2", kind: "sub", apiKey: "sk", apiSecret: "ss" };

beforeEach(async () => {
  const keys = await env.BYBIT_ACCOUNTS.list();
  for (const key of keys.keys) {
    await env.BYBIT_ACCOUNTS.delete(key.name);
  }
});

describe("loadAccountRoster", () => {
  it("loads and validates a well-formed roster", async () => {
    await seedRoster({ master: masterRecord, "sub-trading1": subRecord }, ["master", "sub-trading1"]);

    const roster = await loadAccountRoster(env.BYBIT_ACCOUNTS, { skipCache: true });

    expect(roster).toHaveLength(2);
    expect(roster.find((a) => a.label === "master")?.kind).toBe("master");
    expect(roster.find((a) => a.label === "sub-trading1")?.kind).toBe("sub");
  });

  it("throws AccountRosterError when account-index is missing", async () => {
    await expect(loadAccountRoster(env.BYBIT_ACCOUNTS, { skipCache: true })).rejects.toThrow(
      AccountRosterError,
    );
  });

  it("throws loudly (drift detection) when account-index references a label with no matching account:<label> entry", async () => {
    await seedRoster({ master: masterRecord }, ["master", "sub-ghost"]);

    await expect(loadAccountRoster(env.BYBIT_ACCOUNTS, { skipCache: true })).rejects.toThrow(
      /sub-ghost/,
    );
  });

  it("throws AccountRosterError when a record is malformed", async () => {
    await env.BYBIT_ACCOUNTS.put("account-index", JSON.stringify(["master"]));
    await env.BYBIT_ACCOUNTS.put("account:master", JSON.stringify({ uid: "1", kind: "master" }));

    await expect(loadAccountRoster(env.BYBIT_ACCOUNTS, { skipCache: true })).rejects.toThrow(
      AccountRosterError,
    );
  });

  it("throws AccountRosterError when there isn't exactly one master account", async () => {
    await seedRoster({ "sub-a": subRecord, "sub-b": subRecord }, ["sub-a", "sub-b"]);

    await expect(loadAccountRoster(env.BYBIT_ACCOUNTS, { skipCache: true })).rejects.toThrow(
      /exactly one account with kind "master"/,
    );
  });

  it("caches the roster across calls within the TTL, until skipCache bypasses it", async () => {
    await seedRoster({ master: masterRecord }, ["master"]);
    const first = await loadAccountRoster(env.BYBIT_ACCOUNTS);

    // Mutate KV directly (index now references a label with no record yet) —
    // the cached read should still return the old roster...
    await env.BYBIT_ACCOUNTS.put("account-index", JSON.stringify(["master", "sub-new"]));
    const second = await loadAccountRoster(env.BYBIT_ACCOUNTS);
    expect(second).toEqual(first);

    // ...but skipCache should see the drift immediately.
    await expect(loadAccountRoster(env.BYBIT_ACCOUNTS, { skipCache: true })).rejects.toThrow(
      /sub-new/,
    );
  });
});

describe("getMasterAccount / getSubAccounts / resolveAccount", () => {
  beforeEach(async () => {
    await seedRoster({ master: masterRecord, "sub-trading1": subRecord }, ["master", "sub-trading1"]);
  });

  it("getMasterAccount returns the master account", async () => {
    const master = await getMasterAccount(env.BYBIT_ACCOUNTS, { skipCache: true });
    expect(master.label).toBe("master");
    expect(master.kind).toBe("master");
  });

  it("getSubAccounts returns only sub accounts", async () => {
    const subs = await getSubAccounts(env.BYBIT_ACCOUNTS, { skipCache: true });
    expect(subs).toHaveLength(1);
    expect(subs[0].label).toBe("sub-trading1");
  });

  it("resolveAccount returns the matching account for a known label", async () => {
    const account = await resolveAccount(env.BYBIT_ACCOUNTS, "sub-trading1", { skipCache: true });
    expect(account.uid).toBe("2");
  });

  it("resolveAccount throws UnknownAccountError for an unknown label", async () => {
    await expect(
      resolveAccount(env.BYBIT_ACCOUNTS, "sub-removed-last-month", { skipCache: true }),
    ).rejects.toBeInstanceOf(UnknownAccountError);
  });
});
