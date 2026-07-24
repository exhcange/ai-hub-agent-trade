import { AiHubError } from "../errors.js";
import type { ToolExecutionContext } from "./tool-spec.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface SymbolRule {
  symbol: string;
  quantityPrecision?: number;
  pricePrecision?: number;
  limitVolumeMin?: string;
  limitAmountMin?: string;
  limitPriceMin?: string;
}

interface SymbolRuleCacheEntry {
  expiresAt: number;
  rules: Map<string, SymbolRule>;
}

const cache = new Map<string, SymbolRuleCacheEntry>();
const pendingLoads = new Map<string, Promise<SymbolRuleCacheEntry>>();

function cacheKey(context: ToolExecutionContext): string {
  return `${context.profile.name}\u0000${context.profile.configVersion}\u0000${context.profile.openApiBaseUrl}`;
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
      quantityPrecision: nonNegativeInteger(row.quantityPrecision),
      pricePrecision: nonNegativeInteger(row.pricePrecision),
      limitVolumeMin: stringValue(row.limitVolumeMin),
      limitAmountMin: stringValue(row.limitAmountMin),
      limitPriceMin: stringValue(row.limitPriceMin)
    });
  }
  return result;
}

async function loadRules(context: ToolExecutionContext): Promise<SymbolRuleCacheEntry> {
  const key = cacheKey(context);
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) return current;
  const pending = pendingLoads.get(key);
  if (pending) return pending;

  const load = context.api.symbols().then((response) => {
    const entry = { rules: parseRules(response), expiresAt: Date.now() + CACHE_TTL_MS };
    cache.set(key, entry);
    return entry;
  }).finally(() => pendingLoads.delete(key));
  pendingLoads.set(key, load);
  return load;
}

/** Lazily fetches and caches one tenant profile's symbol-rule snapshot for five minutes. */
export async function getSymbolRule(context: ToolExecutionContext, symbol: string): Promise<SymbolRule> {
  const entry = await loadRules(context);
  const rule = entry.rules.get(normalizedSymbol(symbol));
  if (!rule) throw new AiHubError("AI_HUB_SYMBOL_NOT_FOUND", `Symbol "${symbol}" was not returned by the configured tenant OpenAPI symbols endpoint.`);
  return rule;
}

function decimalScale(value: string): number {
  return value.split(".")[1]?.length ?? 0;
}

function decimalParts(value: string): { digits: bigint; scale: number } {
  const [whole, fraction = ""] = value.split(".");
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
