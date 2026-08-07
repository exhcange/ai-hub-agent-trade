import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";
import { optionalInteger, optionalString, requiredString, strictObject } from "./validation.js";
import { listFullSymbols, listSymbols, searchSymbols, summarizeDepth, summarizeKlines, summarizeLastPrice, summarizeSymbolOverview, summarizeTickers, summarizeTrades } from "./market-summaries.js";
import { getCachedSymbols, getSymbolRule, resolveTenantSymbol } from "./symbol-rules.js";
import { STANDARD_LIST_LIMIT, listLimitSchema, normalizedListLimit } from "./list-limit.js";
import { getCachedTickerSummarySource } from "./ticker-summary-cache.js";

const readErrors = ["AI_HUB_INVALID_ARGUMENT", "AI_HUB_OPENAPI_NETWORK_ERROR", "AI_HUB_OPENAPI_HTTP_ERROR", "AI_HUB_OPENAPI_INVALID_RESPONSE", "AI_HUB_OPENAPI_BUSINESS_ERROR"] as const;
const symbolReadErrors = [...readErrors, "AI_HUB_SYMBOL_NOT_FOUND", "AI_HUB_SYMBOL_AMBIGUOUS"] as const;

/**
 * The exact values consumed by the OpenAPI kline Redis keys. Do not send
 * conventional chart aliases (for example `1h`) to the upstream API: it
 * treats an unknown interval as a different key and returns an empty array.
 */
export const KLINE_INTERVALS = ["1min", "5min", "15min", "30min", "60min", "1day", "1week", "1month"] as const;
type KlineInterval = (typeof KLINE_INTERVALS)[number];

const KLINE_INTERVAL_ALIASES: Readonly<Record<string, KlineInterval>> = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "60m": "60min",
  "1h": "60min",
  "1d": "1day",
  "1w": "1week",
  "1mo": "1month",
  "1M": "1month"
};

const klineIntervalDescription = "Kline interval. Supported values: 1min, 5min, 15min, 30min, 60min, 1day, 1week, 1month. Use 60min, not 1h.";
const klineTimezoneDescription = "Optional timezone such as UTC+08 or UTC-09. Defaults to UTC+08. The upstream API applies timezone-specific data only to periods above 60min.";

function normalizeKlineInterval(value: string): KlineInterval {
  const trimmed = value.trim();
  const normalized = KLINE_INTERVAL_ALIASES[trimmed] ?? trimmed.toLowerCase();
  if ((KLINE_INTERVALS as readonly string[]).includes(normalized)) return normalized as KlineInterval;
  throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `interval must be one of: ${KLINE_INTERVALS.join(", ")}. Use 60min, not 1h.`);
}

function validateKlineInput(input: unknown, options: { summary: boolean }): {
  symbol: string;
  interval: KlineInterval;
  startTime?: number;
  endTime?: number;
  timezone?: string;
  limit: number;
} {
  const value = strictObject(input, ["symbol", "interval", "startTime", "endTime", "timezone", "limit"]);
  const startTime = value.startTime === undefined ? undefined : optionalInteger(value, "startTime", 0, 0, Number.MAX_SAFE_INTEGER);
  const endTime = value.endTime === undefined ? undefined : optionalInteger(value, "endTime", 0, 0, Number.MAX_SAFE_INTEGER);
  if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "startTime must be less than or equal to endTime.");
  }
  return {
    symbol: requiredString(value, "symbol"),
    interval: value.interval === undefined && options.summary ? "60min" : normalizeKlineInterval(requiredString(value, "interval")),
    startTime,
    endTime,
    timezone: optionalString(value, "timezone"),
    limit: normalizedListLimit(value, STANDARD_LIST_LIMIT)
  };
}

function validateHistoricalMinuteKlines(input: unknown): {
  symbol: string;
  startTime?: number;
  endTime?: number;
  limit: number;
} {
  const value = strictObject(input, ["symbol", "startTime", "endTime", "limit"]);
  const startTime = value.startTime === undefined ? undefined : optionalInteger(value, "startTime", 0, 0, Number.MAX_SAFE_INTEGER);
  const endTime = value.endTime === undefined ? undefined : optionalInteger(value, "endTime", 0, 0, Number.MAX_SAFE_INTEGER);
  if (startTime !== undefined && endTime !== undefined && startTime > endTime) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "startTime cannot be after endTime.");
  }
  return { symbol: requiredString(value, "symbol"), startTime, endTime, limit: normalizedListLimit(value, STANDARD_LIST_LIMIT) };
}

function boundHistoricalMinuteKlines(response: unknown, limit: number): Record<string, unknown> {
  if (!Array.isArray(response)) throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Historical minute Klines response must be an array.");
  const items = response.slice(0, limit);
  return {
    totalCandles: response.length,
    returnedCount: items.length,
    truncated: response.length > items.length,
    continuation: response.length > items.length
      ? { available: false, reason: "The upstream historical-minute endpoint does not expose a page cursor." }
      : null,
    items
  };
}

export const marketTools: ToolSpec[] = [
  {
    name: "market_ping", title: "Test OpenAPI Connection", description: "Test the configured tenant OpenAPI connection.", cliPath: ["market", "ping"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", additionalProperties: false }, errorCodes: ["AI_HUB_OPENAPI_NETWORK_ERROR", "AI_HUB_OPENAPI_HTTP_ERROR", "AI_HUB_OPENAPI_INVALID_RESPONSE", "AI_HUB_OPENAPI_BUSINESS_ERROR"],
    validate: (input) => { strictObject(input, []); return {}; },
    handler: (_input, context) => context.api.ping()
  },
  {
    name: "market_get_server_time",
    title: "Get Server Time",
    description: "Get server time from the configured tenant OpenAPI.",
    cliPath: ["market", "time"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => strictObject(input, []),
    handler: (_input, context) => context.api.time()
  },
  {
    name: "market_get_symbols",
    title: "Get Spot Symbols",
    description: "Get one bounded page of complete spot symbol metadata from the configured tenant OpenAPI.",
    cliPath: ["market", "symbols"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { offset: { type: "integer", minimum: 0, description: "Zero-based page offset. Defaults to 0." }, limit: listLimitSchema(STANDARD_LIST_LIMIT) }, additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => { const value = strictObject(input, ["offset", "limit"]); return { offset: optionalInteger(value, "offset", 0, 0, Number.MAX_SAFE_INTEGER), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT) }; },
    handler: async (input, context) => listFullSymbols(await getCachedSymbols(context), input as { offset: number; limit: number })
  },
  {
    name: "market_get_symbol_overview",
    title: "Get Spot Symbol Overview",
    description: "Get a small overview of all configured spot symbols: total count, quote-asset counts, and a bounded sample of display symbols. Use this for generic requests such as listing available trading pairs.",
    cliPath: ["market", "symbols-overview"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { limit: listLimitSchema(STANDARD_LIST_LIMIT, "Number of sample display symbols. Defaults to 20; maximum 50.") }, additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      const value = strictObject(input, ["limit"]);
      return { limit: normalizedListLimit(value, STANDARD_LIST_LIMIT) };
    },
    handler: async (input, context) => summarizeSymbolOverview(await getCachedSymbols(context), input as { limit: number })
  },
  {
    name: "market_list_symbols",
    title: "List Spot Symbols",
    description: "List one bounded page of configured spot symbols, optionally restricted to a quote asset. This response excludes precision and trading-rule metadata. Use market_get_symbol_info for one exact symbol's rules.",
    cliPath: ["market", "symbols-list"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { quoteAsset: { type: "string" }, offset: { type: "integer", minimum: 0, description: "Zero-based page offset. Defaults to 0." }, limit: listLimitSchema(STANDARD_LIST_LIMIT) }, additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      const value = strictObject(input, ["quoteAsset", "offset", "limit"]);
      return {
        quoteAsset: optionalString(value, "quoteAsset"),
        offset: optionalInteger(value, "offset", 0, 0, Number.MAX_SAFE_INTEGER),
        limit: normalizedListLimit(value, STANDARD_LIST_LIMIT)
      };
    },
    handler: async (input, context) => listSymbols(await getCachedSymbols(context), input as { quoteAsset?: string; offset: number; limit: number })
  },
  {
    name: "market_search_symbols",
    title: "Search Spot Symbols",
    description: "Search configured spot symbols by a required keyword and return a small matching set without trading-rule metadata. Use market_list_symbols for browsing, or market_get_symbol_info for exact precision and minimum rules.",
    cliPath: ["market", "symbols-search"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, description: "Required asset or symbol keyword, for example BTC." }, quoteAsset: { type: "string" }, limit: listLimitSchema(STANDARD_LIST_LIMIT) }, required: ["query"], additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      const value = strictObject(input, ["query", "quoteAsset", "limit"]);
      return { query: requiredString(value, "query"), quoteAsset: optionalString(value, "quoteAsset"), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT) };
    },
    handler: async (input, context) => {
      const value = input as { query: string; quoteAsset?: string; limit: number };
      return searchSymbols(await getCachedSymbols(context), value);
    }
  },
  {
    name: "market_get_symbol_info",
    title: "Get Spot Symbol Information",
    description: "Get the exact configured spot symbol's trading-rule metadata, including price and quantity precision plus minimum order constraints. Requires an exact symbol such as BTCUSDT or BTC/USDT.",
    cliPath: ["market", "symbol-info"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string", minLength: 1 } }, required: ["symbol"], additionalProperties: false },
    errorCodes: symbolReadErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol"]);
      return { symbol: requiredString(value, "symbol") };
    },
    handler: async (input, context) => {
      const rule = await getSymbolRule(context, (input as { symbol: string }).symbol);
      return {
        symbol: rule.displaySymbol ?? rule.symbol,
        apiSymbol: rule.symbol,
        baseAsset: rule.displayBaseAsset ?? rule.baseAsset ?? null,
        quoteAsset: rule.displayQuoteAsset ?? rule.quoteAsset ?? null,
        pricePrecision: rule.pricePrecision ?? null,
        quantityPrecision: rule.quantityPrecision ?? null,
        limitVolumeMin: rule.limitVolumeMin ?? null,
        limitPriceMin: rule.limitPriceMin ?? null,
        limitAmountMin: rule.limitAmountMin ?? null,
        marketBuyMin: rule.marketBuyMin ?? null,
        marketSellMin: rule.marketSellMin ?? null
      };
    }
  },
  {
    name: "market_get_last_price",
    title: "Get Spot Last Price",
    description: "Get only symbol, last price, and timestamp for one exact spot symbol. Use this by default for current-price requests.",
    cliPath: ["market", "price"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string", minLength: 1 } }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol"]);
      return { symbol: requiredString(value, "symbol") };
    },
    handler: async (input, context) => {
      const requestedSymbol = (input as { symbol: string }).symbol;
      const apiSymbol = await resolveTenantSymbol(context, requestedSymbol);
      return { ...(await summarizeLastPrice(await context.api.ticker({ symbol: apiSymbol }), requestedSymbol)), apiSymbol };
    }
  },
  {
    name: "market_get_ticker",
    title: "Get Spot Ticker",
    description: "Get full raw ticker fields for one symbol or an explicit symbol list. For current price use market_get_last_price; for all markets use market_get_ticker_summary.",
    cliPath: ["market", "ticker"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string", minLength: 1, description: "One exact symbol, for example ETHUSDT." }, symbols: { type: "string", minLength: 1, description: "An explicitly requested comma-separated upstream symbol list of at most 50 symbols." }, timeZone: { type: "string" } },
      oneOf: [{ required: ["symbol"] }, { required: ["symbols"] }],
      additionalProperties: false
    },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "symbols", "timeZone"]);
      const symbol = optionalString(value, "symbol");
      const symbols = optionalString(value, "symbols");
      if (!symbol && !symbols) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "market_get_ticker requires symbol or symbols. Use market_get_ticker_summary for all-market data.");
      if (symbol && symbols) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "market_get_ticker accepts either symbol or symbols, not both.");
      if (symbols && symbols.split(",").map((item) => item.trim()).filter(Boolean).length > STANDARD_LIST_LIMIT.maximum) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `symbols supports at most ${STANDARD_LIST_LIMIT.maximum} explicit symbols.`);
      return { symbol, symbols, timeZone: optionalString(value, "timeZone") };
    },
    handler: async (input, context) => {
      const value = input as { symbol?: string; symbols?: string; timeZone?: string };
      const symbols = value.symbols
        ? (await Promise.all(value.symbols.split(",").map((symbol) => resolveTenantSymbol(context, symbol.trim())))).join(",")
        : undefined;
      return context.api.ticker({ ...value, ...(value.symbol ? { symbol: await resolveTenantSymbol(context, value.symbol) } : {}), symbols });
    }
  },
  {
    name: "market_get_ticker_summary",
    title: "Get Spot Market Summary",
    description: "Return a bounded all-market overview: a core-asset watchlist plus gainers, losers, and quote-volume leaders. Use this for requests such as market ticker, market overview, movers, or most-active symbols.",
    cliPath: ["market", "ticker-summary"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { quoteAsset: { type: "string" }, limit: listLimitSchema(STANDARD_LIST_LIMIT) }, additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      const value = strictObject(input, ["quoteAsset", "limit"]);
      return { quoteAsset: optionalString(value, "quoteAsset") ?? "USDT", limit: normalizedListLimit(value, STANDARD_LIST_LIMIT) };
    },
    handler: async (input, context) => {
      const value = input as { quoteAsset: string; limit: number };
      return summarizeTickers(await getCachedTickerSummarySource(context), value);
    }
  },
  {
    name: "market_get_depth",
    title: "Get Spot Depth",
    description: "Get the spot order book for one symbol.",
    cliPath: ["market", "depth"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: listLimitSchema(STANDARD_LIST_LIMIT) }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "limit"]);
      return { symbol: requiredString(value, "symbol"), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT) };
    },
    handler: async (input, context) => {
      const value = input as { symbol: string; limit: number };
      return context.api.depth(await resolveTenantSymbol(context, value.symbol), value.limit);
    }
  },
  {
    name: "market_get_depth_summary",
    title: "Get Spot Order Book Summary",
    description: "Get a bounded order-book view with best bid, best ask, spread, and requested levels. Prefer this to market_get_depth for Agent analysis.",
    cliPath: ["market", "depth-summary"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: listLimitSchema(STANDARD_LIST_LIMIT) }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "limit"]);
      return { symbol: requiredString(value, "symbol"), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT) };
    },
    handler: async (input, context) => {
      const value = input as { symbol: string; limit: number };
      const apiSymbol = await resolveTenantSymbol(context, value.symbol);
      return { ...(await summarizeDepth(await context.api.depth(apiSymbol, value.limit), value.symbol)), apiSymbol };
    }
  },
  {
    name: "market_get_trades",
    title: "Get Recent Spot Trades",
    description: "Get recent spot trades for one symbol.",
    cliPath: ["market", "trades"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: listLimitSchema(STANDARD_LIST_LIMIT) }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "limit"]);
      return { symbol: requiredString(value, "symbol"), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT) };
    },
    handler: async (input, context) => {
      const value = input as { symbol: string; limit: number };
      return context.api.trades(await resolveTenantSymbol(context, value.symbol), value.limit);
    }
  },
  {
    name: "market_get_trades_summary",
    title: "Get Recent Spot Trades Summary",
    description: "Get a bounded recent-trades view with price range, buy/sell counts and quantities, plus the requested recent sample. Prefer this to market_get_trades for Agent analysis.",
    cliPath: ["market", "trades-summary"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: listLimitSchema(STANDARD_LIST_LIMIT) }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "limit"]);
      return { symbol: requiredString(value, "symbol"), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT) };
    },
    handler: async (input, context) => {
      const value = input as { symbol: string; limit: number };
      const apiSymbol = await resolveTenantSymbol(context, value.symbol);
      return { ...(await summarizeTrades(await context.api.trades(apiSymbol, value.limit), value.symbol)), apiSymbol };
    }
  },
  {
    name: "market_get_klines",
    title: "Get Spot Klines",
    description: "Get raw spot candlestick data for one symbol and a supported interval. Use market_get_klines_summary for Agent analysis.",
    cliPath: ["market", "klines"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Spot symbol, for example ETHUSDT or ETH/USDT." }, interval: { type: "string", enum: KLINE_INTERVALS, description: klineIntervalDescription }, startTime: { type: "integer", description: "Optional inclusive Unix timestamp in milliseconds." }, endTime: { type: "integer", description: "Optional inclusive Unix timestamp in milliseconds." }, timezone: { type: "string", description: klineTimezoneDescription }, limit: listLimitSchema(STANDARD_LIST_LIMIT, "Number of newest-first candles. Defaults to 20; maximum 50.") }, required: ["symbol", "interval"], additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      return validateKlineInput(input, { summary: false });
    },
    handler: async (input, context) => {
      const value = input as { symbol: string; interval: string; startTime?: number; endTime?: number; timezone?: string; limit?: number };
      return context.api.klines({ ...value, symbol: await resolveTenantSymbol(context, value.symbol) });
    }
  },
  {
    name: "market_get_klines_summary",
    title: "Get Spot Klines Summary",
    description: "Get a bounded candle analysis with period change, high/low, latest candle, and a caller-limited candle sample. Defaults to 60min. Prefer this to market_get_klines for Agent analysis.",
    cliPath: ["market", "klines-summary"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Spot symbol, for example ETHUSDT or ETH/USDT." }, interval: { type: "string", enum: KLINE_INTERVALS, description: `${klineIntervalDescription} Defaults to 60min when omitted.` }, startTime: { type: "integer", description: "Optional inclusive Unix timestamp in milliseconds." }, endTime: { type: "integer", description: "Optional inclusive Unix timestamp in milliseconds." }, timezone: { type: "string", description: klineTimezoneDescription }, limit: listLimitSchema(STANDARD_LIST_LIMIT, "Number of candles included in the bounded analysis. Defaults to 20; maximum 50.") }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      return validateKlineInput(input, { summary: true });
    },
    handler: async (input, context) => {
      const value = input as { symbol: string; interval: string; startTime?: number; endTime?: number; timezone?: string; limit: number };
      const apiSymbol = await resolveTenantSymbol(context, value.symbol);
      return { ...(await summarizeKlines(await context.api.klines({ ...value, symbol: apiSymbol }), value.symbol, value.interval)), apiSymbol };
    }
  },
  {
    name: "market_get_historical_minute_klines",
    title: "Get Historical Minute Klines",
    description: "Get bounded historical one-minute candles from the dedicated v2 historical-minute endpoint. Use this when a requested 1-minute time range needs historical storage rather than the standard Kline cache.",
    cliPath: ["market", "klines-1min-history"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string", minLength: 1 }, startTime: { type: "integer", minimum: 0, description: "Optional inclusive Unix timestamp in milliseconds." }, endTime: { type: "integer", minimum: 0, description: "Optional inclusive Unix timestamp in milliseconds." }, limit: listLimitSchema(STANDARD_LIST_LIMIT) }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: validateHistoricalMinuteKlines,
    handler: async (input, context) => {
      const value = input as { symbol: string; startTime?: number; endTime?: number; limit: number };
      const { symbol, startTime, endTime, limit } = value;
      return boundHistoricalMinuteKlines(await context.api.historicalMinuteKlines({ symbol: await resolveTenantSymbol(context, symbol), startTime, endTime }), limit);
    }
  }
];
