import type { ToolExecutionContext } from "./tool-spec.js";

const TICKER_SUMMARY_CACHE_TTL_MS = 3_000;

interface TickerSnapshot {
  expiresAt: number;
  response: unknown;
}

const cache = new Map<string, TickerSnapshot>();
const pendingLoads = new Map<string, Promise<TickerSnapshot>>();

function cacheKey(context: ToolExecutionContext): string {
  return `${context.profile.name}\u0000${context.profile.configVersion}\u0000${context.profile.openApiBaseUrl}`;
}

/**
 * Shares the all-market ticker payload between repeated summary requests in a
 * short freshness window. Exact ticker tools remain uncached and always query
 * the requested symbols directly.
 */
export async function getCachedTickerSummarySource(context: ToolExecutionContext): Promise<unknown> {
  const key = cacheKey(context);
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.response;
  const pending = pendingLoads.get(key);
  if (pending) return (await pending).response;

  const load = (async (): Promise<TickerSnapshot> => {
    const entry = { response: await context.api.ticker(), expiresAt: Date.now() + TICKER_SUMMARY_CACHE_TTL_MS };
    cache.set(key, entry);
    return entry;
  })().finally(() => pendingLoads.delete(key));
  pendingLoads.set(key, load);
  return (await load).response;
}

export function clearTickerSummaryCache(): void {
  cache.clear();
  pendingLoads.clear();
}
