import {
  accountIndexSchema,
  accountRecordSchema,
  type ConfiguredAccount,
} from "./bybit/types.js";

/**
 * Loads the account roster (master + sub-accounts) from KV, per §7.2 of the
 * plan: `account-index` holds the list of labels, `account:<label>` holds
 * each account's credentials. A short in-memory cache avoids re-reading KV on
 * every tool call within a burst of activity in one conversation.
 */

const ROSTER_CACHE_TTL_MS = 45_000;

interface RosterCacheEntry {
  roster: ConfiguredAccount[];
  expiresAt: number;
}

// Keyed by KV namespace identity so multiple bindings (e.g. in tests) don't
// collide; in production there is exactly one BYBIT_ACCOUNTS binding.
const rosterCache = new WeakMap<KVNamespace, RosterCacheEntry>();

export class AccountRosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountRosterError";
  }
}

export class UnknownAccountError extends Error {
  constructor(label: string) {
    super(`No such account "${label}" is currently configured.`);
    this.name = "UnknownAccountError";
  }
}

/**
 * Read and validate the full account roster from KV, applying the short
 * in-memory cache. Throws AccountRosterError loudly if `account-index`
 * references a label with no matching `account:<label>` entry — this is
 * exactly the kind of drift a hand-run `wrangler kv` workflow can produce,
 * and must never be silently skipped.
 */
export async function loadAccountRoster(
  kv: KVNamespace,
  options: { skipCache?: boolean } = {},
): Promise<ConfiguredAccount[]> {
  const cached = rosterCache.get(kv);
  const now = Date.now();
  if (!options.skipCache && cached && cached.expiresAt > now) {
    return cached.roster;
  }

  const rawIndex = await kv.get("account-index", "json");
  if (rawIndex === null) {
    throw new AccountRosterError(
      'No "account-index" entry found in KV. Add accounts per the README runbook before using any account-scoped tool.',
    );
  }

  const indexParse = accountIndexSchema.safeParse(rawIndex);
  if (!indexParse.success) {
    throw new AccountRosterError(
      `"account-index" in KV is malformed: ${indexParse.error.message}`,
    );
  }
  const labels = indexParse.data;

  const roster: ConfiguredAccount[] = [];
  const missingLabels: string[] = [];

  for (const label of labels) {
    const rawRecord = await kv.get(`account:${label}`, "json");
    if (rawRecord === null) {
      missingLabels.push(label);
      continue;
    }
    const recordParse = accountRecordSchema.safeParse(rawRecord);
    if (!recordParse.success) {
      throw new AccountRosterError(
        `KV entry "account:${label}" is malformed: ${recordParse.error.message}`,
      );
    }
    roster.push({ label, ...recordParse.data });
  }

  if (missingLabels.length > 0) {
    throw new AccountRosterError(
      `"account-index" references label(s) with no matching "account:<label>" entry: ${missingLabels.join(", ")}. ` +
        "The KV index is out of sync with the account records — fix it via the wrangler kv runbook in the README.",
    );
  }

  const masterCount = roster.filter((account) => account.kind === "master").length;
  if (masterCount !== 1) {
    throw new AccountRosterError(
      `Expected exactly one account with kind "master" in the roster, found ${masterCount}.`,
    );
  }

  rosterCache.set(kv, { roster, expiresAt: now + ROSTER_CACHE_TTL_MS });
  return roster;
}

export async function getMasterAccount(
  kv: KVNamespace,
  options: { skipCache?: boolean } = {},
): Promise<ConfiguredAccount> {
  const roster = await loadAccountRoster(kv, options);
  const master = roster.find((account) => account.kind === "master");
  if (!master) {
    throw new AccountRosterError('No account with kind "master" is configured.');
  }
  return master;
}

export async function getSubAccounts(
  kv: KVNamespace,
  options: { skipCache?: boolean } = {},
): Promise<ConfiguredAccount[]> {
  const roster = await loadAccountRoster(kv, options);
  return roster.filter((account) => account.kind === "sub");
}

/** Resolve a single accountLabel against the roster, throwing UnknownAccountError if absent. */
export async function resolveAccount(
  kv: KVNamespace,
  label: string,
  options: { skipCache?: boolean } = {},
): Promise<ConfiguredAccount> {
  const roster = await loadAccountRoster(kv, options);
  const account = roster.find((entry) => entry.label === label);
  if (!account) {
    throw new UnknownAccountError(label);
  }
  return account;
}
