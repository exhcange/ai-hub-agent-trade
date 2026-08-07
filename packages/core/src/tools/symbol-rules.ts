import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AiHubError } from "../errors.js";
import type { SpotOrderType } from "../openapi.js";
import type { ToolExecutionContext } from "./tool-spec.js";

const CACHE_TTL_MS = 60 * 60 * 1000;
const SYMBOL_CACHE_SCHEMA_VERSION = 2;

export interface SymbolRule {
  /** Tenant-specific symbol accepted by the OpenAPI, never a display alias. */
  symbol: string;
  /** Optional user-facing symbol advertised by the tenant, for example BTC/USDT. */
  displaySymbol?: string;
  /** Tenant-specific assets accepted by the OpenAPI. */
  baseAsset?: string;
  quoteAsset?: string;
  /** User-facing asset aliases advertised by the tenant. */
  displayBaseAsset?: string;
  displayQuoteAsset?: string;
  quantityPrecision?: number;
  pricePrecision?: number;
  limitVolumeMin?: string;
  limitAmountMin?: string;
  limitPriceMin?: string;
  marketBuyMin?: string;
  marketSellMin?: string;
}

interface SymbolRuleCacheEntry {
  expiresAt: number;
  response: unknown;
  rules: Map<string, SymbolRule>;
  /** Both physical and display asset codes resolve to the physical API code. */
  assets: Map<string, string>;
  /** A physical API asset code resolves to the display asset code. */
  displayAssets: Map<string, string>;
  /** Display assets occurring for multiple physical assets must never be guessed. */
  ambiguousAssets: Set<string>;
  /** Display symbols occurring for multiple equally preferred physical symbols must never be guessed. */
  ambiguousRules: Set<string>;
}

interface PreferredValue {
  value: string;
  /** A higher value represents the tenant-specific representation of a display alias. */
  priority: number;
}

const cache = new Map<string, SymbolRuleCacheEntry>();
const pendingLoads = new Map<string, Promise<SymbolRuleCacheEntry>>();
/** A missing identifier may force one refresh per cached snapshot, never one refresh per request. */
const missingIdentifierRefreshes = new Map<string, number>();

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
  schemaVersion: number;
  expiresAt: number;
  response: unknown;
}

async function loadPersistentSnapshot(key: string): Promise<SymbolRuleCacheEntry | undefined> {
  if (!persistentCacheEnabled()) return undefined;
  try {
    const parsed = JSON.parse(await readFile(persistentCachePath(key), "utf8")) as Partial<PersistedSymbolSnapshot>;
    if (parsed.schemaVersion !== SYMBOL_CACHE_SCHEMA_VERSION || typeof parsed.expiresAt !== "number" || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now() || !("response" in parsed)) return undefined;
    const parsedRules = parseRules(parsed.response);
    return { expiresAt: parsed.expiresAt, response: parsed.response, ...parsedRules };
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
    await writeFile(temporaryPath, JSON.stringify({ schemaVersion: SYMBOL_CACHE_SCHEMA_VERSION, expiresAt: entry.expiresAt, response: entry.response }), { mode: 0o600 });
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

function normalizedAsset(asset: string): string {
  return asset.trim().toUpperCase();
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

interface DisplayPair {
  baseAsset: string;
  quoteAsset: string;
}

function displayPair(row: Record<string, unknown>, rule: SymbolRule): DisplayPair | undefined {
  const namedBaseAsset = stringValue(row.baseAssetName);
  const namedQuoteAsset = stringValue(row.quoteAssetName);
  if (namedBaseAsset && namedQuoteAsset) return { baseAsset: namedBaseAsset, quoteAsset: namedQuoteAsset };

  const displaySymbol = rule.displaySymbol;
  if (displaySymbol?.includes("/")) {
    const [baseAsset, quoteAsset, extra] = displaySymbol.split("/").map((value) => value.trim());
    if (baseAsset && quoteAsset && !extra) return { baseAsset, quoteAsset };
  }

  // Ordinary SaaS rows commonly expose only physical fields. They are a valid
  // display mapping only when the physical symbol exactly represents those fields.
  if (rule.baseAsset && rule.quoteAsset && normalizedSymbol(rule.symbol) === normalizedSymbol(`${rule.baseAsset}/${rule.quoteAsset}`)) {
    return { baseAsset: rule.baseAsset, quoteAsset: rule.quoteAsset };
  }
  return undefined;
}

/** True only for an OpenAPI-advertised mixed-cloud pair such as BTC1701USDT1701. */
function isFourDigitTenantPair(rule: SymbolRule, display: DisplayPair): boolean {
  const base = escapeRegularExpression(display.baseAsset.trim());
  const quote = escapeRegularExpression(display.quoteAsset.trim());
  const match = new RegExp(`^${base}(\\d{4})${quote}\\1$`, "i").exec(rule.symbol.trim());
  if (!match) return false;
  const expectedBase = `${display.baseAsset.trim().toUpperCase()}${match[1]}`;
  const expectedQuote = `${display.quoteAsset.trim().toUpperCase()}${match[1]}`;
  // SymbolName is a valid display-pair source. When component fields are also
  // present, they must agree; missing component fields never cause inference.
  return (!rule.baseAsset || rule.baseAsset.trim().toUpperCase() === expectedBase)
    && (!rule.quoteAsset || rule.quoteAsset.trim().toUpperCase() === expectedQuote);
}

/** True only for an OpenAPI-advertised tenant asset such as BTC1701. */
function isFourDigitTenantAsset(physical: string, display: string): boolean {
  return new RegExp(`^${escapeRegularExpression(display.trim())}\\d{4}$`, "i").test(physical.trim());
}

function samePhysicalSymbol(left: SymbolRule | undefined, right: SymbolRule): boolean {
  return left?.symbol.trim().toUpperCase() === right.symbol.trim().toUpperCase();
}

function parseRules(response: unknown): Pick<SymbolRuleCacheEntry, "rules" | "assets" | "displayAssets" | "ambiguousAssets" | "ambiguousRules"> {
  const result = new Map<string, SymbolRule>();
  const rulePriorities = new Map<string, number>();
  const ambiguousRules = new Set<string>();
  const ambiguousRulePriorities = new Map<string, number>();
  const assets = new Map<string, string>();
  const assetPriorities = new Map<string, PreferredValue>();
  const displayAssets = new Map<string, string>();
  const ambiguousAssets = new Set<string>();
  const ambiguousAssetPriorities = new Map<string, number>();
  const setRule = (key: string, rule: SymbolRule, priority: number): void => {
    const ambiguousPriority = ambiguousRulePriorities.get(key);
    if (ambiguousPriority !== undefined) {
      if (priority <= ambiguousPriority) return;
      ambiguousRules.delete(key);
      ambiguousRulePriorities.delete(key);
    }
    const existingPriority = rulePriorities.get(key);
    if (existingPriority === undefined || priority > existingPriority) {
      result.set(key, rule);
      rulePriorities.set(key, priority);
      ambiguousRules.delete(key);
      return;
    }
    if (priority === existingPriority && !samePhysicalSymbol(result.get(key), rule)) {
      result.delete(key);
      rulePriorities.delete(key);
      ambiguousRules.add(key);
      ambiguousRulePriorities.set(key, priority);
    }
  };
  const setAsset = (key: string, physical: string, priority: number): void => {
    const ambiguousPriority = ambiguousAssetPriorities.get(key);
    if (ambiguousPriority !== undefined) {
      if (priority <= ambiguousPriority) return;
      ambiguousAssets.delete(key);
      ambiguousAssetPriorities.delete(key);
    }
    const existing = assetPriorities.get(key);
    if (!existing || priority > existing.priority) {
      assetPriorities.set(key, { value: physical, priority });
      assets.set(key, physical);
      return;
    }
    if (priority === existing.priority && existing.value.toUpperCase() !== physical.toUpperCase()) {
      assetPriorities.delete(key);
      assets.delete(key);
      ambiguousAssets.add(key);
      ambiguousAssetPriorities.set(key, priority);
    }
  };
  const addAsset = (physical: string | undefined, display: string | undefined): void => {
    if (!physical) return;
    const physicalKey = normalizedAsset(physical);
    setAsset(physicalKey, physical, 1);
    displayAssets.set(physicalKey, display || physical);
    if (!display) return;
    const displayKey = normalizedAsset(display);
    // This is candidate selection only. It never derives a physical asset from
    // a suffix: both values must have been returned by the OpenAPI row.
    if (isFourDigitTenantAsset(physical, display)) setAsset(displayKey, physical, 2);
    else if (physicalKey === displayKey) setAsset(displayKey, physical, 1);
  };
  for (const row of rows(response)) {
    const symbol = stringValue(row.symbol);
    if (!symbol) continue;
    const displaySymbol = stringValue(row.SymbolName) ?? stringValue(row.symbolName) ?? stringValue(row.showName);
    const rule: SymbolRule = {
      symbol,
      ...(displaySymbol ? { displaySymbol } : {}),
      baseAsset: stringValue(row.baseAsset),
      quoteAsset: stringValue(row.quoteAsset),
      displayBaseAsset: stringValue(row.baseAssetName) ?? stringValue(row.baseAsset),
      displayQuoteAsset: stringValue(row.quoteAssetName) ?? stringValue(row.quoteAsset),
      quantityPrecision: nonNegativeInteger(row.quantityPrecision),
      pricePrecision: nonNegativeInteger(row.pricePrecision),
      limitVolumeMin: stringValue(row.limitVolumeMin),
      limitAmountMin: stringValue(row.limitAmountMin),
      limitPriceMin: stringValue(row.limitPriceMin),
      marketBuyMin: stringValue(row.marketBuyMin),
      marketSellMin: stringValue(row.marketSellMin)
    };
    // A physical OpenAPI symbol is always accepted exactly as supplied. For a
    // display alias, a verified four-digit tenant pair wins over an ordinary
    // pair; every other shape is deliberately not guessed.
    setRule(normalizedSymbol(symbol), rule, 1);
    const display = displayPair(row, rule);
    if (display) {
      const displayKey = normalizedSymbol(`${display.baseAsset}/${display.quoteAsset}`);
      if (isFourDigitTenantPair(rule, display)) setRule(displayKey, rule, 2);
      else if (normalizedSymbol(rule.symbol) === displayKey) setRule(displayKey, rule, 1);
    }
    // SymbolName (for example BTC/USDT) is an equivalent explicit display
    // source when separate baseAssetName/quoteAssetName fields are omitted.
    addAsset(rule.baseAsset, display?.baseAsset ?? rule.displayBaseAsset);
    addAsset(rule.quoteAsset, display?.quoteAsset ?? rule.displayQuoteAsset);
  }
  return { rules: result, assets, displayAssets, ambiguousAssets, ambiguousRules };
}

async function loadSnapshot(context: ToolExecutionContext, forceRefresh = false): Promise<SymbolRuleCacheEntry> {
  const key = cacheKey(context);
  const current = cache.get(key);
  if (!forceRefresh && current && current.expiresAt > Date.now()) return current;
  const pending = pendingLoads.get(key);
  if (pending) return pending;

  const load = (async (): Promise<SymbolRuleCacheEntry> => {
    if (!forceRefresh) {
      const persisted = await loadPersistentSnapshot(key);
      if (persisted) {
        cache.set(key, persisted);
        return persisted;
      }
    }
    const response = await context.api.symbols();
    const entry = { response, ...parseRules(response), expiresAt: Date.now() + CACHE_TTL_MS };
    cache.set(key, entry);
    await persistSnapshot(key, entry);
    return entry;
  })().finally(() => pendingLoads.delete(key));
  pendingLoads.set(key, load);
  return load;
}

async function refreshForMissingIdentifier(context: ToolExecutionContext, entry: SymbolRuleCacheEntry): Promise<SymbolRuleCacheEntry> {
  const key = cacheKey(context);
  if (missingIdentifierRefreshes.get(key) === entry.expiresAt) return entry;
  const refreshed = await loadSnapshot(context, true);
  missingIdentifierRefreshes.set(key, refreshed.expiresAt);
  return refreshed;
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
  const key = normalizedSymbol(symbol);
  let entry = await loadSnapshot(context);
  if (!entry.rules.has(key) || entry.ambiguousRules.has(key)) entry = await refreshForMissingIdentifier(context, entry);
  if (entry.ambiguousRules.has(key)) {
    throw new AiHubError("AI_HUB_SYMBOL_AMBIGUOUS", `Symbol "${symbol}" matches multiple equally preferred OpenAPI symbols. Use an exact physical symbol.`);
  }
  const rule = entry.rules.get(key);
  if (!rule) throw new AiHubError("AI_HUB_SYMBOL_NOT_FOUND", `Symbol "${symbol}" was not returned by the configured tenant OpenAPI symbols endpoint.`);
  return rule;
}

export type TenantAssetResolutionMode = "read" | "write";

/**
 * Resolves an OpenAPI-advertised display or physical asset to its physical API
 * value. Unknown assets are preserved for reads, but writes are blocked rather
 * than sending a guessed identifier to OpenAPI.
 */
export async function resolveTenantAsset(context: ToolExecutionContext, asset: string, mode: TenantAssetResolutionMode = "read"): Promise<string> {
  const normalized = normalizedAsset(asset);
  if (!normalized) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "asset must not be empty.");
  let entry = await loadSnapshot(context);
  if (!entry.assets.has(normalized) || entry.ambiguousAssets.has(normalized)) entry = await refreshForMissingIdentifier(context, entry);
  if (entry.ambiguousAssets.has(normalized)) {
    throw new AiHubError("AI_HUB_ASSET_AMBIGUOUS", `Asset "${asset}" matches multiple equally preferred OpenAPI assets. Use an exact physical asset.`);
  }
  const resolved = entry.assets.get(normalized);
  if (resolved) return resolved;
  if (mode === "write") {
    throw new AiHubError("AI_HUB_ASSET_NOT_MAPPED", `Asset "${asset}" is not advertised by the configured tenant symbols endpoint, so it cannot be used for a write operation.`);
  }
  return normalized;
}

/** Returns the user-facing asset name for a physical tenant API asset. */
export async function presentTenantAsset(context: ToolExecutionContext, asset: string): Promise<string> {
  const normalized = asset.trim().toUpperCase();
  if (!normalized) return asset;
  const entry = await loadSnapshot(context);
  return entry.displayAssets.get(normalized) ?? normalized;
}

/** Resolves a display symbol or a physical symbol to the physical API symbol. */
export async function resolveTenantSymbol(context: ToolExecutionContext, symbol: string): Promise<string> {
  return (await getSymbolRule(context, symbol)).symbol;
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

/** Adds two non-negative decimal strings without using floating point arithmetic. */
export function addNonNegativeDecimal(left: string, right: string): string {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const digits = a.digits * 10n ** BigInt(scale - a.scale) + b.digits * 10n ** BigInt(scale - b.scale);
  const raw = digits.toString().padStart(scale + 1, "0");
  if (!scale) return raw;
  const fraction = raw.slice(-scale).replace(/0+$/, "");
  return fraction ? `${raw.slice(0, -scale)}.${fraction}` : raw.slice(0, -scale);
}

/** True when current is unfavourably more than bps away from reference. */
export function exceedsUnfavourableDeviationBps(reference: string, current: string, side: "BUY" | "SELL", bps: number): boolean {
  if (!Number.isInteger(bps) || bps < 0) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "Price-deviation basis points must be a non-negative integer.");
  const referenceValue = decimalParts(reference);
  const currentValue = decimalParts(current);
  const scale = Math.max(referenceValue.scale, currentValue.scale);
  const normalizedReference = referenceValue.digits * 10n ** BigInt(scale - referenceValue.scale);
  const normalizedCurrent = currentValue.digits * 10n ** BigInt(scale - currentValue.scale);
  if (normalizedReference <= 0n) throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Ticker price must be greater than zero.");
  const unfavourable = side === "BUY"
    ? normalizedCurrent > normalizedReference ? normalizedCurrent - normalizedReference : 0n
    : normalizedCurrent < normalizedReference ? normalizedReference - normalizedCurrent : 0n;
  return unfavourable * 10_000n > normalizedReference * BigInt(bps);
}

export function isAtLeastDecimal(value: string, minimum: string): boolean {
  return compareDecimal(value, minimum) >= 0;
}

/** Multiplies non-negative decimal strings without floating-point rounding. */
export function multiplyDecimal(left: string, right: string): string {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = a.scale + b.scale;
  const digits = (a.digits * b.digits).toString();
  if (scale === 0) return digits;
  const padded = digits.padStart(scale + 1, "0");
  const fraction = padded.slice(-scale).replace(/0+$/, "");
  return fraction ? `${padded.slice(0, -scale)}.${fraction}` : padded.slice(0, -scale);
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
  type: SpotOrderType;
  quoteAmount?: string;
  baseQuantity?: string;
  price?: string;
  triggerPrice?: string;
}

/** Applies only documented symbol constraints before an order is displayed for confirmation. */
export async function preflightSymbolOrder(context: ToolExecutionContext, order: SymbolOrderCheck): Promise<SymbolRule> {
  const rule = await getSymbolRule(context, order.symbol);
  if ((order.type === "MARKET" || order.type === "STOP_MARKET") && order.side === "BUY" && order.quoteAmount) {
    // The symbols response has no quote-amount precision field; price precision is the available quote-asset precision.
    assertPrecision("quoteAmount", order.quoteAmount, rule.pricePrecision, rule.symbol);
    if (rule.marketBuyMin && compareDecimal(rule.marketBuyMin, "0") > 0) {
      assertAtLeast("quoteAmount", order.quoteAmount, rule.marketBuyMin, rule.symbol);
    }
  }
  if ((order.type === "MARKET" || order.type === "STOP_MARKET") && order.side === "SELL" && order.baseQuantity) {
    if (rule.marketSellMin && compareDecimal(rule.marketSellMin, "0") > 0) {
      assertAtLeast("baseQuantity", order.baseQuantity, rule.marketSellMin, rule.symbol);
    }
  }
  if (order.baseQuantity) assertPrecision("baseQuantity", order.baseQuantity, rule.quantityPrecision, rule.symbol);
  if (order.price) assertPrecision("price", order.price, rule.pricePrecision, rule.symbol);
  if (order.triggerPrice) assertPrecision("triggerPrice", order.triggerPrice, rule.pricePrecision, rule.symbol);
  if (["LIMIT", "IOC", "FOK", "POST_ONLY", "STOP"].includes(order.type) && order.baseQuantity && order.price) {
    assertAtLeast("baseQuantity", order.baseQuantity, rule.limitVolumeMin, rule.symbol);
    assertAtLeast("price", order.price, rule.limitPriceMin, rule.symbol);
    if (rule.limitAmountMin && compareDecimal(rule.limitAmountMin, "0") > 0) {
      assertAtLeast("limit order amount", multiplyDecimal(order.baseQuantity, order.price), rule.limitAmountMin, rule.symbol);
    }
  }
  return rule;
}

export function clearSymbolRuleCache(): void {
  cache.clear();
  pendingLoads.clear();
  missingIdentifierRefreshes.clear();
}
