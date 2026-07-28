import { AiHubError } from "../errors.js";

type JsonRecord = Record<string, unknown>;

export interface MarketSummaryOptions {
  limit: number;
  quoteAsset?: string;
  query?: string;
}

function record(value: unknown, message: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", message);
  }
  return value as JsonRecord;
}

function records(value: unknown, message: string): JsonRecord[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", message);
  }
  return value as JsonRecord[];
}

function text(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface ParsedDecimal {
  sign: bigint;
  whole: string;
  fraction: string;
}

function parseDecimal(value: string): ParsedDecimal | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  return match ? { sign: match[1] === "-" ? -1n : 1n, whole: match[2] ?? "0", fraction: match[3] ?? "" } : null;
}

function formatScaledDecimal(value: bigint, scale: number): string {
  const sign = value < 0n ? "-" : "";
  const absolute = (value < 0n ? -value : value).toString().padStart(scale + 1, "0");
  if (!scale) return `${sign}${absolute}`;
  const whole = absolute.slice(0, -scale);
  const fraction = absolute.slice(-scale).replace(/0+$/, "");
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

function sumDecimalStrings(values: readonly string[]): string {
  const parsed = values.map(parseDecimal).filter((value): value is ParsedDecimal => value !== null);
  if (!parsed.length) return "0";
  const scale = Math.max(...parsed.map((value) => value.fraction.length));
  const sum = parsed.reduce((total, value) => total + value.sign * BigInt(`${value.whole}${value.fraction.padEnd(scale, "0")}`), 0n);
  return formatScaledDecimal(sum, scale);
}

function subtractDecimalStrings(left: string, right: string): string | null {
  const leftValue = parseDecimal(left);
  const rightValue = parseDecimal(right);
  if (!leftValue || !rightValue) return null;
  const scale = Math.max(leftValue.fraction.length, rightValue.fraction.length);
  const toScaled = (value: ParsedDecimal): bigint => value.sign * BigInt(`${value.whole}${value.fraction.padEnd(scale, "0")}`);
  return formatScaledDecimal(toScaled(leftValue) - toScaled(rightValue), scale);
}

function numericMaximum(values: readonly JsonRecord[], field: string): string | null {
  const numbers = values.map((item) => finiteNumber(item[field])).filter((item): item is number => item !== null);
  return numbers.length ? String(Math.max(...numbers)) : null;
}

function numericMinimum(values: readonly JsonRecord[], field: string): string | null {
  const numbers = values.map((item) => finiteNumber(item[field])).filter((item): item is number => item !== null);
  return numbers.length ? String(Math.min(...numbers)) : null;
}

function compareByNumericField(field: string, direction: "asc" | "desc"): (left: JsonRecord, right: JsonRecord) => number {
  return (left, right) => {
    const leftValue = finiteNumber(left[field]);
    const rightValue = finiteNumber(right[field]);
    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
  };
}

function tickerItem(value: JsonRecord): JsonRecord {
  return {
    symbol: text(value.symbol),
    last: text(value.last),
    rose: text(value.rose),
    amount: text(value.amount),
    vol: text(value.vol),
    high: text(value.high),
    low: text(value.low),
    time: text(value.time)
  };
}

function tickerRows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return records(value, "Ticker response must be an array.");
  const payload = record(value, "Ticker response must be an array.");
  if (Array.isArray(payload.items)) return records(payload.items, "Ticker response items must be an array.");
  throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Ticker response must be an array.");
}

function quoteFromSymbol(symbol: string | null): string | null {
  if (!symbol) return null;
  const parts = symbol.split("/");
  return parts.length === 2 ? parts[1]?.toUpperCase() ?? null : null;
}

/** Builds a bounded overview of the all-symbol ticker response for Agent use. */
export function summarizeTickers(value: unknown, options: Required<Pick<MarketSummaryOptions, "limit" | "quoteAsset">>): JsonRecord {
  const quoteAsset = options.quoteAsset.toUpperCase();
  const rows = tickerRows(value).filter((item) => quoteFromSymbol(text(item.symbol)) === quoteAsset);
  const bySymbol = new Map(rows.map((item) => [text(item.symbol)?.toUpperCase(), item]));
  const watchlistSymbols = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ADA"];
  const watchlist = watchlistSymbols
    .map((asset) => bySymbol.get(`${asset}/${quoteAsset}`))
    .filter((item): item is JsonRecord => Boolean(item))
    .map(tickerItem);
  // `limit` is a total Agent response budget, not a per-leaderboard limit.
  // Keeping the whole response bounded prevents a broad ticker request from
  // consuming the context that the summary tools are meant to protect.
  const watchlistItems = watchlist.slice(0, options.limit);
  const leaderboardBudget = Math.max(0, options.limit - watchlistItems.length);
  const leaderboards = [
    [...rows].sort(compareByNumericField("rose", "desc")),
    [...rows].sort(compareByNumericField("rose", "asc")),
    [...rows].sort(compareByNumericField("amount", "desc"))
  ];
  const leaderboardLimits = leaderboards.map((_items, index) => Math.floor((leaderboardBudget + 2 - index) / 3));
  const topGainers = leaderboards[0]?.slice(0, leaderboardLimits[0]).map(tickerItem) ?? [];
  const topLosers = leaderboards[1]?.slice(0, leaderboardLimits[1]).map(tickerItem) ?? [];
  const topByQuoteVolume = leaderboards[2]?.slice(0, leaderboardLimits[2]).map(tickerItem) ?? [];

  return {
    quoteAsset,
    totalSymbols: rows.length,
    returnedSymbols: watchlistItems.length + topGainers.length + topLosers.length + topByQuoteVolume.length,
    watchlist: watchlistItems,
    topGainers,
    topLosers,
    topByQuoteVolume
  };
}

interface ParsedSymbol {
  symbol: string;
  apiSymbol: string | null;
  baseAsset: string | null;
  quoteAsset: string | null;
  pricePrecision: unknown;
  quantityPrecision: unknown;
  limitVolumeMin: string | null;
  limitPriceMin: string | null;
  limitAmountMin: string | null;
}

function normalizedSymbol(value: string): string {
  return value.replaceAll("/", "").trim().toUpperCase();
}

function parsedSymbolRows(value: unknown): ParsedSymbol[] {
  const payload = record(value, "Symbols response must be an object.");
  const rows = records(payload.symbols, "Symbols response must contain a symbols array.");
  return rows.map((item) => {
    const apiSymbol = text(item.symbol);
    const symbol = text(item.SymbolName) ?? apiSymbol ?? "";
    return {
      symbol,
      apiSymbol,
      baseAsset: text(item.baseAssetName) ?? text(item.baseAsset),
      quoteAsset: text(item.quoteAssetName) ?? text(item.quoteAsset),
      pricePrecision: item.pricePrecision ?? null,
      quantityPrecision: item.quantityPrecision ?? null,
      limitVolumeMin: text(item.limitVolumeMin),
      limitPriceMin: text(item.limitPriceMin),
      limitAmountMin: text(item.limitAmountMin)
    };
  }).filter((item) => Boolean(item.symbol));
}

function quoteAssetCounts(rows: readonly ParsedSymbol[]): JsonRecord[] {
  const counts = new Map<string, number>();
  for (const item of rows) {
    const quote = item.quoteAsset?.toUpperCase();
    if (quote) counts.set(quote, (counts.get(quote) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([asset, count]) => ({ asset, count }));
}

function basicSymbolItem(item: ParsedSymbol): JsonRecord {
  return {
    symbol: item.symbol,
    apiSymbol: item.apiSymbol,
    baseAsset: item.baseAsset,
    quoteAsset: item.quoteAsset
  };
}

function fullSymbolItem(item: ParsedSymbol): JsonRecord {
  return {
    ...basicSymbolItem(item),
    pricePrecision: item.pricePrecision,
    quantityPrecision: item.quantityPrecision,
    limitVolumeMin: item.limitVolumeMin,
    limitPriceMin: item.limitPriceMin,
    limitAmountMin: item.limitAmountMin
  };
}

function sortSymbolMatches(rows: readonly ParsedSymbol[], query?: string): ParsedSymbol[] {
  const normalizedQuery = query?.trim().toUpperCase();
  return [...rows].sort((left, right) => {
    if (!normalizedQuery) return left.symbol.localeCompare(right.symbol);
    const rank = (item: ParsedSymbol): number => {
      const symbol = item.symbol.toUpperCase();
      return symbol.startsWith(`${normalizedQuery}/`) ? 0 : symbol.startsWith(normalizedQuery) ? 1 : 2;
    };
    return rank(left) - rank(right) || left.symbol.localeCompare(right.symbol);
  });
}

/** Returns the small default response for a generic request to browse symbols. */
export function summarizeSymbolOverview(value: unknown, options: Required<Pick<MarketSummaryOptions, "limit">>): JsonRecord {
  const rows = parsedSymbolRows(value);
  return {
    totalSymbols: rows.length,
    quoteAssetCounts: quoteAssetCounts(rows),
    sampleSymbols: sortSymbolMatches(rows).slice(0, options.limit).map((item) => item.symbol)
  };
}

/** Lists a bounded page of symbols without order-rule metadata. */
export function listSymbols(value: unknown, options: Required<Pick<MarketSummaryOptions, "limit">> & { offset: number; quoteAsset?: string }): JsonRecord {
  const allRows = parsedSymbolRows(value);
  const quoteAsset = options.quoteAsset?.trim().toUpperCase();
  const matches = sortSymbolMatches(allRows.filter((item) => !quoteAsset || item.quoteAsset?.toUpperCase() === quoteAsset));
  const items = matches.slice(options.offset, options.offset + options.limit).map(basicSymbolItem);
  const nextOffset = options.offset + items.length;
  return {
    totalSymbols: allRows.length,
    matchedSymbols: matches.length,
    quoteAsset: quoteAsset ?? null,
    offset: options.offset,
    limit: options.limit,
    nextOffset: nextOffset < matches.length ? nextOffset : null,
    items
  };
}

/** Lists a bounded page of complete symbol metadata for explicit full-toolset use. */
export function listFullSymbols(value: unknown, options: Required<Pick<MarketSummaryOptions, "limit">> & { offset: number }): JsonRecord {
  const rows = sortSymbolMatches(parsedSymbolRows(value));
  const items = rows.slice(options.offset, options.offset + options.limit).map(fullSymbolItem);
  const nextOffset = options.offset + items.length;
  return {
    totalSymbols: rows.length,
    offset: options.offset,
    limit: options.limit,
    nextOffset: nextOffset < rows.length ? nextOffset : null,
    items
  };
}

/** Searches symbols by a required keyword without exposing their order-rule metadata. */
export function searchSymbols(value: unknown, options: Required<Pick<MarketSummaryOptions, "limit" | "query">> & Pick<MarketSummaryOptions, "quoteAsset">): JsonRecord {
  const allRows = parsedSymbolRows(value);
  const query = options.query.trim().toUpperCase();
  const quoteAsset = options.quoteAsset?.trim().toUpperCase();
  const matches = allRows.filter((item) => {
    const symbol = item.symbol.toUpperCase();
    const apiSymbol = item.apiSymbol?.toUpperCase() ?? "";
    return (symbol.includes(query) || apiSymbol.includes(query)) && (!quoteAsset || item.quoteAsset?.toUpperCase() === quoteAsset);
  });
  const sortedMatches = sortSymbolMatches(matches, query);
  return {
    matchedSymbols: matches.length,
    query,
    quoteAsset: quoteAsset ?? null,
    items: sortedMatches.slice(0, options.limit).map(basicSymbolItem)
  };
}

/** Returns all known order-rule metadata for one exact spot symbol. */
export function getSymbolInfo(value: unknown, symbol: string): JsonRecord {
  const target = normalizedSymbol(symbol);
  const item = parsedSymbolRows(value).find((row) => normalizedSymbol(row.symbol) === target || (row.apiSymbol !== null && normalizedSymbol(row.apiSymbol) === target));
  if (!item) throw new AiHubError("AI_HUB_SYMBOL_NOT_FOUND", `Symbol "${symbol}" was not returned by the configured tenant OpenAPI symbols endpoint.`);
  return fullSymbolItem(item);
}

/** @deprecated Use searchSymbols, listSymbols, summarizeSymbolOverview, or getSymbolInfo. */
export function summarizeSymbols(value: unknown, options: Required<Pick<MarketSummaryOptions, "limit">> & Pick<MarketSummaryOptions, "query" | "quoteAsset">): JsonRecord {
  const query = options.query?.trim();
  if (!query) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "query is required.");
  return searchSymbols(value, { ...options, query });
}

function level(value: unknown): JsonRecord {
  if (!Array.isArray(value)) return { price: null, quantity: null };
  return { price: text(value[0]), quantity: text(value[1]) };
}

/** Reduces a depth response to best prices, spread, and bounded levels. */
export function summarizeDepth(value: unknown, symbol: string): JsonRecord {
  const payload = record(value, "Depth response must be an object.");
  const bids = Array.isArray(payload.bids) ? payload.bids : [];
  const asks = Array.isArray(payload.asks) ? payload.asks : [];
  const bestBid = level(bids[0]);
  const bestAsk = level(asks[0]);
  const bidPrice = finiteNumber(bestBid.price);
  const askPrice = finiteNumber(bestAsk.price);
  const spread = typeof bestBid.price !== "string" || typeof bestAsk.price !== "string" ? null : subtractDecimalStrings(bestAsk.price, bestBid.price);
  const midPrice = bidPrice === null || askPrice === null ? null : (askPrice + bidPrice) / 2;
  return {
    symbol,
    time: text(payload.time),
    bestBid,
    bestAsk,
    spread,
    spreadRatio: spread === null || !midPrice ? null : String(Number(spread) / midPrice),
    bids: bids.map(level),
    asks: asks.map(level)
  };
}

/** Summarizes recent executions while retaining a caller-bounded recent sample. */
export function summarizeTrades(value: unknown, symbol: string): JsonRecord {
  const payload = record(value, "Trades response must be an object.");
  const rows = records(payload.list, "Trades response must contain a list array.");
  let buyCount = 0;
  let sellCount = 0;
  const buyQuantities: string[] = [];
  const sellQuantities: string[] = [];
  for (const item of rows) {
    const quantity = text(item.qty);
    if (text(item.side)?.toUpperCase() === "BUY") {
      buyCount += 1;
      if (quantity) buyQuantities.push(quantity);
    } else if (text(item.side)?.toUpperCase() === "SELL") {
      sellCount += 1;
      if (quantity) sellQuantities.push(quantity);
    }
  }
  return {
    symbol,
    count: rows.length,
    lastPrice: text(rows[0]?.price),
    highPrice: numericMaximum(rows, "price"),
    lowPrice: numericMinimum(rows, "price"),
    buyCount,
    sellCount,
    buyQuantity: sumDecimalStrings(buyQuantities),
    sellQuantity: sumDecimalStrings(sellQuantities),
    recentTrades: rows.map((item) => ({
      id: text(item.id),
      side: text(item.side),
      price: text(item.price),
      quantity: text(item.qty),
      time: text(item.time)
    }))
  };
}

/** Summarizes the newest-first kline response and retains a caller-bounded candle sample. */
export function summarizeKlines(value: unknown, symbol: string, interval: string): JsonRecord {
  const rows = records(value, "Klines response must be an array.");
  const newest = rows[0];
  const oldest = rows[rows.length - 1];
  const oldestOpen = finiteNumber(oldest?.open);
  const newestClose = finiteNumber(newest?.close);
  return {
    symbol,
    interval,
    count: rows.length,
    periodOpen: text(oldest?.open),
    latestClose: text(newest?.close),
    changeRatio: oldestOpen === null || !oldestOpen || newestClose === null ? null : String((newestClose - oldestOpen) / oldestOpen),
    high: numericMaximum(rows, "high"),
    low: numericMinimum(rows, "low"),
    latestCandle: newest ? {
      time: text(newest.idx), open: text(newest.open), close: text(newest.close), high: text(newest.high), low: text(newest.low), volume: text(newest.vol)
    } : null,
    candles: rows.map((item) => ({
      time: text(item.idx), open: text(item.open), close: text(item.close), high: text(item.high), low: text(item.low), volume: text(item.vol)
    }))
  };
}
