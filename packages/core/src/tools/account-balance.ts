import { AiHubError } from "../errors.js";

type JsonRecord = Record<string, unknown>;

export interface AssetBalance {
  asset: string;
  available: string;
  frozen: string;
  total: string;
  found: boolean;
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

export function requireAvailableBalance(payload: unknown, asset: string): AssetBalance {
  const balance = findAssetBalance(payload, asset);
  if (!balance.found || balance.available === "0") {
    throw new AiHubError("AI_HUB_INSUFFICIENT_AVAILABLE_BALANCE", `No available ${balance.asset} balance was found for this request.`);
  }
  return balance;
}
