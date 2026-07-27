import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AiHubError } from "../errors.js";
import type { ToolExecutionContext } from "./tool-spec.js";

const CACHE_TTL_MS = 60 * 60 * 1000;

export interface SymbolRule {
  symbol: string;
  baseAsset?: string;
  quoteAsset?: string;
  quantityPrecision?: number;
  pricePrecision?: number;
  limitVolumeMin?: string;
  limitAmountMin?: string;
  limitPriceMin?: string;
}

interface SymbolRuleCacheEntry {
  expiresAt: number;
  response: unknown;
  rules: Map<string, SymbolRule>;
}

const cache = new Map<string, SymbolRuleCacheEntry>();
const pendingLoads = new Map<string, Promise<SymbolRuleCacheEntry>>();

function cacheKey(context: ToolExecutionContext): string {
  return `${context.profile.name}\u0000${context.profile.configVersion}\u0000${context.profile.openApiBaseUrl}`;
}

function persistentCacheEnabled(): boolean {
  return process.env.AI_HUB_DISABLE_PERSISTENT_CACHE !== "1";
}

function persistentCacheDirectory(): string {
  return process.env.AI_HUB_CACHE_DIR ?? join(homedir(), ".ai-hub", "cache");
}

function persistentCachePath(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  return join(persistentCacheDirectory(), `symbols-${hash}.json`);
}

interface PersistedSymbolSnapshot {
  expiresAt: number;
  response: unknown;
}

async function loadPersistentSnapshot(key: string): Promise<SymbolRuleCacheEntry | undefined> {
  if (!persistentCacheEnabled()) return undefined;
  try {
    const parsed = JSON.parse(await readFile(persistentCachePath(key), "utf8")) as Partial<PersistedSymbolSnapshot>;
    if (typeof parsed.expiresAt !== "number" || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now() || !("response" in parsed)) return undefined;
    return { expiresAt: parsed.expiresAt, response: parsed.response, rules: parseRules(parsed.response) };
  } catch {
    return undefined;
  }
}

async function persistSnapshot(key: string, entry: SymbolRuleCacheEntry): Promise<void> {
  if (!persistentCacheEnabled()) return;
  const directory = persistentCacheDirectory();
  const filePath = persistentCachePath(key);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(temporaryPath, JSON.stringify({ expiresAt: entry.expiresAt, response: entry.response }), { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function normalizedSymbol(symbol: string): string {
  return symbol.replaceAll("/", "").trim().toUpperCase();
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(result) && result >= 0 ? result : undefined;
}

function rows(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) return response.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (!response || typeof response !== "object" || Array.isArray(response)) return [];
  const root = response as Record<string, unknown>;
  const candidates = [root.symbols, root.data, (root.data as Record<string, unknown> | undefined)?.symbols];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  return [];
}

function parseRules(response: unknown): Map<string, SymbolRule> {
  const result = new Map<string, SymbolRule>();
  for (const row of rows(response)) {
    const symbol = stringValue(row.symbol);
    if (!symbol) continue;
    result.set(normalizedSymbol(symbol), {
      symbol,
      baseAsset: stringValue(row.baseAssetName) ?? stringValue(row.baseAsset),
      quoteAsset: stringValue(row.quoteAssetName) ?? stringValue(row.quoteAsset),
      quantityPrecision: nonNegativeInteger(row.quantityPrecision),
      pricePrecision: nonNegativeInteger(row.pricePrecision),
      limitVolumeMin: stringValue(row.limitVolumeMin),
      limitAmountMin: stringValue(row.limitAmountMin),
      limitPriceMin: stringValue(row.limitPriceMin)
    });
  }
  return result;
}

async function loadSnapshot(context: ToolExecutionContext): Promise<SymbolRuleCacheEntry> {
  const key = cacheKey(context);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current;
  const pending = pendingLoads.get(key);
  if (pending) return pending;

  const load = (async (): Promise<SymbolRuleCacheEntry> => {
    const persisted = await loadPersistentSnapshot(key);
    if (persisted) {
      cache.set(key, persisted);
      return persisted;
    }
    const response = await context.api.symbols();
    const entry = { response, rules: parseRules(response), expiresAt: Date.now() + CACHE_TTL_MS };
    cache.set(key, entry);
    await persistSnapshot(key, entry);
    return entry;
  })().finally(() => pendingLoads.delete(key));
  pendingLoads.set(key, load);
  return load;
}

/**
 * Lazily fetches and shares one tenant's complete symbol snapshot for one
 * hour. The symbols endpoint has no upstream filter or pagination, so this
 * prevents repeated full payload downloads by symbol search and order checks.
 */
export async function getCachedSymbols(context: ToolExecutionContext): Promise<unknown> {
  return (await loadSnapshot(context)).response;
}

/** Lazily fetches and caches one tenant profile's symbol-rule snapshot for one hour. */
export async function getSymbolRule(context: ToolExecutionContext, symbol: string): Promise<SymbolRule> {
  const entry = await loadSnapshot(context);
  const rule = entry.rules.get(normalizedSymbol(symbol));
  if (!rule) throw new AiHubError("AI_HUB_SYMBOL_NOT_FOUND", `Symbol "${symbol}" was not returned by the configured tenant OpenAPI symbols endpoint.`);
  return rule;
}

function decimalScale(value: string): number {
  return value.split(".")[1]?.length ?? 0;
}

function decimalParts(value: string): { digits: bigint; scale: number } {
  const [whole = "0", fraction = ""] = value.split(".");
  return { digits: BigInt(`${whole}${fraction}`.replace(/^0+(?=\d)/, "") || "0"), scale: fraction.length };
}

function compareDecimal(left: string, right: string): number {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const leftValue = a.digits * 10n ** BigInt(scale - a.scale);
  const rightValue = b.digits * 10n ** BigInt(scale - b.scale);
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

/** Floors a non-negative decimal string without using floating point arithmetic. */
export function floorDecimal(value: string, precision: number): string {
  if (!/^\d+(?:\.\d+)?$/.test(value) || precision < 0 || !Number.isInteger(precision)) {
    throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "A balance or symbol precision value could not be parsed.");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const kept = fraction.slice(0, precision);
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = kept.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

export function subtractNonNegativeDecimal(left: string, right: string): string {
  const comparison = compareDecimal(left, right);
  if (comparison < 0) throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Balance arithmetic produced a negative result.");
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const digits = a.digits * 10n ** BigInt(scale - a.scale) - b.digits * 10n ** BigInt(scale - b.scale);
  const raw = digits.toString().padStart(scale + 1, "0");
  if (!scale) return raw;
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return fraction ? `${raw.slice(0, -scale)}.${fraction}` : raw.slice(0, -scale);
}

export function isAtLeastDecimal(value: string, minimum: string): boolean {
  return compareDecimal(value, minimum) >= 0;
}

function multipliedDecimal(left: string, right: string): string {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = a.scale + b.scale;
  const digits = (a.digits * b.digits).toString();
  if (scale === 0) return digits;
  const padded = digits.padStart(scale + 1, "0");
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function assertPrecision(name: string, value: string, precision: number | undefined, symbol: string): void {
  if (precision !== undefined && decimalScale(value) > precision) {
    throw new AiHubError("AI_HUB_SYMBOL_PRECISION_INVALID", `${name} for ${symbol} allows at most ${precision} decimal places; received ${value}.`);
  }
}

function assertAtLeast(name: string, value: string, minimum: string | undefined, symbol: string): void {
  if (minimum && compareDecimal(value, minimum) < 0) {
    throw new AiHubError("AI_HUB_SYMBOL_MINIMUM_NOT_MET", `${name} for ${symbol} must be at least ${minimum}; received ${value}.`);
  }
}

export interface SymbolOrderCheck {
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  quoteAmount?: string;
  baseQuantity?: string;
  price?: string;
}

/** Applies only documented symbol constraints before an order is displayed for confirmation. */
export async function preflightSymbolOrder(context: ToolExecutionContext, order: SymbolOrderCheck): Promise<SymbolRule> {
  const rule = await getSymbolRule(context, order.symbol);
  if (order.type === "MARKET" && order.side === "BUY" && order.quoteAmount) {
    // The symbols response has no quote-amount precision field; price precision is the available quote-asset precision.
    assertPrecision("quoteAmount", order.quoteAmount, rule.pricePrecision, rule.symbol);
  }
  if (order.baseQuantity) assertPrecision("baseQuantity", order.baseQuantity, rule.quantityPrecision, rule.symbol);
  if (order.price) assertPrecision("price", order.price, rule.pricePrecision, rule.symbol);
  if (order.type === "LIMIT" && order.baseQuantity && order.price) {
    assertAtLeast("baseQuantity", order.baseQuantity, rule.limitVolumeMin, rule.symbol);
    assertAtLeast("price", order.price, rule.limitPriceMin, rule.symbol);
    if (rule.limitAmountMin && compareDecimal(rule.limitAmountMin, "0") > 0) {
      assertAtLeast("limit order amount", multipliedDecimal(order.baseQuantity, order.price), rule.limitAmountMin, rule.symbol);
    }
  }
  return rule;
}

export function clearSymbolRuleCache(): void {
  cache.clear();
  pendingLoads.clear();
}
