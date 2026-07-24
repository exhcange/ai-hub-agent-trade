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
  const limit = options.limit;

  return {
    quoteAsset,
    totalSymbols: rows.length,
    watchlist,
    topGainers: [...rows].sort(compareByNumericField("rose", "desc")).slice(0, limit).map(tickerItem),
    topLosers: [...rows].sort(compareByNumericField("rose", "asc")).slice(0, limit).map(tickerItem),
    topByQuoteVolume: [...rows].sort(compareByNumericField("amount", "desc")).slice(0, limit).map(tickerItem)
  };
}

/** Searches the full symbol metadata response and returns only a bounded matching subset. */
export function summarizeSymbols(value: unknown, options: Required<Pick<MarketSummaryOptions, "limit">> & Pick<MarketSummaryOptions, "query" | "quoteAsset">): JsonRecord {
  const payload = record(value, "Symbols response must be an object.");
  const rows = records(payload.symbols, "Symbols response must contain a symbols array.");
  const query = options.query?.trim().toUpperCase();
  const quoteAsset = options.quoteAsset?.trim().toUpperCase();
  const matches = rows.filter((item) => {
    const symbol = text(item.SymbolName) ?? text(item.symbol) ?? "";
    const quote = text(item.quoteAsset)?.toUpperCase();
    return (!query || symbol.toUpperCase().includes(query)) && (!quoteAsset || quote === quoteAsset);
  });
  const sortedMatches = [...matches].sort((left, right) => {
    if (!query) return 0;
    const rank = (item: JsonRecord): number => {
      const symbol = (text(item.SymbolName) ?? text(item.symbol) ?? "").toUpperCase();
      return symbol.startsWith(`${query}/`) ? 0 : symbol.startsWith(query) ? 1 : 2;
    };
    return rank(left) - rank(right);
  });
  const quoteAssetCounts = new Map<string, number>();
  for (const item of rows) {
    const quote = text(item.quoteAsset)?.toUpperCase();
    if (quote) quoteAssetCounts.set(quote, (quoteAssetCounts.get(quote) ?? 0) + 1);
  }
  const items = sortedMatches.slice(0, options.limit).map((item) => ({
    symbol: text(item.SymbolName) ?? text(item.symbol),
    apiSymbol: text(item.symbol),
    baseAsset: text(item.baseAssetName) ?? text(item.baseAsset),
    quoteAsset: text(item.quoteAssetName) ?? text(item.quoteAsset),
    pricePrecision: item.pricePrecision ?? null,
    quantityPrecision: item.quantityPrecision ?? null,
    limitVolumeMin: text(item.limitVolumeMin),
    limitPriceMin: text(item.limitPriceMin),
    limitAmountMin: text(item.limitAmountMin)
  }));
  return {
    totalSymbols: rows.length,
    matchedSymbols: matches.length,
    quoteAssetCounts: [...quoteAssetCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([asset, count]) => ({ asset, count })),
    items
  };
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
