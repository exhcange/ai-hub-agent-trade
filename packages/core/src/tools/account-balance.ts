import { AiHubError } from "../errors.js";

type JsonRecord = Record<string, unknown>;

export interface AssetBalance {
  asset: string;
  available: string;
  frozen: string;
  total: string;
  found: boolean;
}

export interface AssetBalanceList {
  totalBalances: number;
  nonZeroBalances: number;
  offset: number;
  returnedCount: number;
  nextOffset: number | null;
  items: AssetBalance[];
}

/** Minimal, non-sensitive balance list used by the generic account view. */
export interface CompactBalanceList {
  balances: Array<Pick<AssetBalance, "asset" | "available" | "frozen" | "total">>;
  count: number;
  truncated: boolean;
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function decimal(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) return value.trim();
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return String(value);
  return undefined;
}

function addDecimal(left: string, right: string): string {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`);
  const rightValue = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}`);
  const digits = (leftValue + rightValue).toString().padStart(scale + 1, "0");
  if (!scale) return digits;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -scale)}.${fraction}` : digits.slice(0, -scale);
}

function isZeroDecimal(value: string): boolean {
  return /^0(?:\.0+)?$/.test(value);
}

function balanceRows(payload: unknown): JsonRecord[] {
  const root = record(payload);
  const data = record(root?.data);
  const candidates = [root?.balances, data?.balances, root?.data, data?.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is JsonRecord => Boolean(record(item)));
  }
  return [];
}

/** Extracts one asset from the signed account response without exposing the full account payload. */
export function findAssetBalance(payload: unknown, requestedAsset: string): AssetBalance {
  const asset = requestedAsset.trim().toUpperCase();
  const row = balanceRows(payload).find((item) => {
    const candidate = item.asset ?? item.coinSymbol ?? item.currency ?? item.coin;
    return typeof candidate === "string" && candidate.trim().toUpperCase() === asset;
  });
  if (!row) return { asset, available: "0", frozen: "0", total: "0", found: false };

  const available = decimal(row.available ?? row.free ?? row.availableBalance ?? row.balance ?? row.total) ?? "0";
  const frozen = decimal(row.frozen ?? row.locked ?? row.freeze ?? row.hold ?? row.lockedBalance) ?? "0";
  const total = decimal(row.total ?? row.balance) ?? addDecimal(available, frozen);
  return { asset, available, frozen, total, found: true };
}

/**
 * Converts the v1 account response into a bounded overview. Assets with both
 * free and locked balances equal to zero are intentionally excluded.
 */
export function listNonZeroAssetBalances(payload: unknown, offset: number, limit: number): AssetBalanceList {
  const rows = balanceRows(payload);
  const balances = rows.flatMap((row) => {
    const asset = row.asset ?? row.coinSymbol ?? row.currency ?? row.coin;
    if (typeof asset !== "string" || !asset.trim()) return [];
    const available = decimal(row.available ?? row.free ?? row.availableBalance ?? row.balance ?? row.total) ?? "0";
    const frozen = decimal(row.frozen ?? row.locked ?? row.freeze ?? row.hold ?? row.lockedBalance) ?? "0";
    if (isZeroDecimal(available) && isZeroDecimal(frozen)) return [];
    const total = decimal(row.total ?? row.balance) ?? addDecimal(available, frozen);
    return [{ asset: asset.trim().toUpperCase(), available, frozen, total, found: true }];
  });
  const items = balances.slice(offset, offset + limit);
  const nextOffset = offset + items.length < balances.length ? offset + items.length : null;
  return { totalBalances: rows.length, nonZeroBalances: balances.length, offset, returnedCount: items.length, nextOffset, items };
}

/**
 * Extracts only the fields needed for an account-balance answer. This is kept
 * separate from the legacy paged overview so MCP and CLI can expose one clear
 * generic balance command without returning the raw v1 account payload.
 */
export function listAssetBalances(
  payload: unknown,
  options: { assets?: readonly string[]; nonZeroOnly: boolean; limit: number }
): CompactBalanceList {
  const wanted = options.assets?.length ? new Set(options.assets.map((asset) => asset.trim().toUpperCase())) : undefined;
  const balances = balanceRows(payload).flatMap((row) => {
    const assetValue = row.asset ?? row.coinSymbol ?? row.currency ?? row.coin;
    if (typeof assetValue !== "string" || !assetValue.trim()) return [];
    const asset = assetValue.trim().toUpperCase();
    if (wanted && !wanted.has(asset)) return [];
    const available = decimal(row.available ?? row.free ?? row.availableBalance ?? row.balance ?? row.total) ?? "0";
    const frozen = decimal(row.frozen ?? row.locked ?? row.freeze ?? row.hold ?? row.lockedBalance) ?? "0";
    if (options.nonZeroOnly && isZeroDecimal(available) && isZeroDecimal(frozen)) return [];
    const total = decimal(row.total ?? row.balance) ?? addDecimal(available, frozen);
    return [{ asset, available, frozen, total }];
  });
  return {
    balances: balances.slice(0, options.limit),
    count: Math.min(balances.length, options.limit),
    truncated: balances.length > options.limit
  };
}

export function requireAvailableBalance(payload: unknown, asset: string): AssetBalance {
  const balance = findAssetBalance(payload, asset);
  if (!balance.found || balance.available === "0") {
    throw new AiHubError("AI_HUB_INSUFFICIENT_AVAILABLE_BALANCE", `No available ${balance.asset} balance was found for this request.`);
  }
  return balance;
}
