import { z } from "zod";

/**
 * zod schemas describing the shapes this server cares about: the account
 * roster stored in KV (§7), and the generic list/cursor shape shared by most
 * Bybit V5 GET endpoints. Bybit's per-field response shapes are intentionally
 * treated loosely (passthrough records) — tools normalize/select fields
 * rather than re-validating Bybit's entire schema, per the plan's "normalized,
 * minimal JSON" output convention (§5).
 */

export const ACCOUNT_KINDS = ["master", "sub"] as const;
export const accountKindSchema = z.enum(ACCOUNT_KINDS);
export type AccountKind = z.infer<typeof accountKindSchema>;

/** One `account:<label>` KV entry. */
export const accountRecordSchema = z.object({
  uid: z.string().min(1),
  kind: accountKindSchema,
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});
export type AccountRecord = z.infer<typeof accountRecordSchema>;

/** The `account-index` KV entry: an array of every configured account label. */
export const accountIndexSchema = z.array(z.string().min(1));
export type AccountIndex = z.infer<typeof accountIndexSchema>;

/** A fully-resolved account: its label plus its roster record. */
export interface ConfiguredAccount extends AccountRecord {
  label: string;
}

/** Bybit V5 `category` param, shared across position/order/execution/PnL endpoints. */
export const categorySchema = z.enum(["spot", "linear", "inverse", "option"]);
export type Category = z.infer<typeof categorySchema>;

/** Generic shape of a Bybit V5 "list" result: `{ list: [...], nextPageCursor }`. */
export const listResultSchema = z.object({
  list: z.array(z.record(z.string(), z.unknown())).optional(),
  nextPageCursor: z.string().optional(),
});
export type ListResult = z.infer<typeof listResultSchema>;
