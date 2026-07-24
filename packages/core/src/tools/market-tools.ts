import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";
import { optionalInteger, optionalString, requiredString, strictObject } from "./validation.js";
import { summarizeDepth, summarizeKlines, summarizeSymbols, summarizeTickers, summarizeTrades } from "./market-summaries.js";

const readErrors = ["AI_HUB_INVALID_ARGUMENT", "AI_HUB_OPENAPI_NETWORK_ERROR", "AI_HUB_OPENAPI_HTTP_ERROR", "AI_HUB_OPENAPI_INVALID_RESPONSE", "AI_HUB_OPENAPI_BUSINESS_ERROR"] as const;

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
    description: "Get complete spot symbol metadata from the configured tenant OpenAPI. Use market_search_symbols for browsing or filtering, because this response may be large.",
    cliPath: ["market", "symbols"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => strictObject(input, []),
    handler: (_input, context) => context.api.symbols()
  },
  {
    name: "market_search_symbols",
    title: "Search Spot Symbols",
    description: "Search the configured tenant's spot symbols and return a bounded metadata result. Use this instead of market_get_symbols unless complete raw metadata is explicitly required.",
    cliPath: ["market", "symbols-search"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { query: { type: "string" }, quoteAsset: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["query", "quoteAsset", "limit"]);
      return { query: optionalString(value, "query"), quoteAsset: optionalString(value, "quoteAsset"), limit: optionalInteger(value, "limit", 20, 1, 50) };
    },
    handler: async (input, context) => {
      const value = input as { query?: string; quoteAsset?: string; limit: number };
      return summarizeSymbols(await context.api.symbols(), value);
    }
  },
  {
    name: "market_get_ticker",
    title: "Get Spot Ticker",
    description: "Get exact raw spot ticker data for one symbol or an explicitly requested symbol list. For an all-market overview, use market_get_ticker_summary instead.",
    cliPath: ["market", "ticker"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, symbols: { type: "string" }, timeZone: { type: "string" } }, additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "symbols", "timeZone"]);
      const symbol = optionalString(value, "symbol");
      const symbols = optionalString(value, "symbols");
      if (!symbol && !symbols) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "market_get_ticker requires symbol or symbols. Use market_get_ticker_summary for all-market data.");
      return { symbol, symbols, timeZone: optionalString(value, "timeZone") };
    },
    handler: (input, context) => context.api.ticker(input as { symbol?: string; symbols?: string; timeZone?: string })
  },
  {
    name: "market_get_ticker_summary",
    title: "Get Spot Market Summary",
    description: "Return a bounded all-market overview: a core-asset watchlist plus gainers, losers, and quote-volume leaders. Use this for requests such as market ticker, market overview, movers, or most-active symbols.",
    cliPath: ["market", "ticker-summary"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { quoteAsset: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["quoteAsset", "limit"]);
      return { quoteAsset: optionalString(value, "quoteAsset") ?? "USDT", limit: optionalInteger(value, "limit", 5, 1, 20) };
    },
    handler: async (input, context) => {
      const value = input as { quoteAsset: string; limit: number };
      return summarizeTickers(await context.api.ticker(), value);
    }
  },
  {
    name: "market_get_depth",
    title: "Get Spot Depth",
    description: "Get the spot order book for one symbol.",
    cliPath: ["market", "depth"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "limit"]);
      return { symbol: requiredString(value, "symbol"), limit: optionalInteger(value, "limit", 20, 1, 100) };
    },
    handler: (input, context) => {
      const value = input as { symbol: string; limit: number };
      return context.api.depth(value.symbol, value.limit);
    }
  },
  {
    name: "market_get_depth_summary",
    title: "Get Spot Order Book Summary",
    description: "Get a bounded order-book view with best bid, best ask, spread, and requested levels. Prefer this to market_get_depth for Agent analysis.",
    cliPath: ["market", "depth-summary"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "limit"]);
      return { symbol: requiredString(value, "symbol"), limit: optionalInteger(value, "limit", 10, 1, 20) };
    },
    handler: async (input, context) => {
      const value = input as { symbol: string; limit: number };
      return summarizeDepth(await context.api.depth(value.symbol, value.limit), value.symbol);
    }
  },
  {
    name: "market_get_trades",
    title: "Get Recent Spot Trades",
    description: "Get recent spot trades for one symbol.",
    cliPath: ["market", "trades"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "limit"]);
      return { symbol: requiredString(value, "symbol"), limit: optionalInteger(value, "limit", 20, 1, 100) };
    },
    handler: (input, context) => {
      const value = input as { symbol: string; limit: number };
      return context.api.trades(value.symbol, value.limit);
    }
  },
  {
    name: "market_get_trades_summary",
    title: "Get Recent Spot Trades Summary",
    description: "Get a bounded recent-trades view with price range, buy/sell counts and quantities, plus the requested recent sample. Prefer this to market_get_trades for Agent analysis.",
    cliPath: ["market", "trades-summary"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "limit"]);
      return { symbol: requiredString(value, "symbol"), limit: optionalInteger(value, "limit", 20, 1, 50) };
    },
    handler: async (input, context) => {
      const value = input as { symbol: string; limit: number };
      return summarizeTrades(await context.api.trades(value.symbol, value.limit), value.symbol);
    }
  },
  {
    name: "market_get_klines",
    title: "Get Spot Klines",
    description: "Get spot candlestick data for one symbol and interval.",
    cliPath: ["market", "klines"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, interval: { type: "string" }, startTime: { type: "integer" }, endTime: { type: "integer" }, timezone: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["symbol", "interval"], additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "interval", "startTime", "endTime", "timezone", "limit"]);
      const startTime = value.startTime === undefined ? undefined : optionalInteger(value, "startTime", 0, 0, Number.MAX_SAFE_INTEGER);
      const endTime = value.endTime === undefined ? undefined : optionalInteger(value, "endTime", 0, 0, Number.MAX_SAFE_INTEGER);
      return { symbol: requiredString(value, "symbol"), interval: requiredString(value, "interval"), startTime, endTime, timezone: optionalString(value, "timezone"), limit: optionalInteger(value, "limit", 50, 1, 100) };
    },
    handler: (input, context) => context.api.klines(input as { symbol: string; interval: string; startTime?: number; endTime?: number; timezone?: string; limit?: number })
  },
  {
    name: "market_get_klines_summary",
    title: "Get Spot Klines Summary",
    description: "Get a bounded candle analysis with period change, high/low, latest candle, and a caller-limited candle sample. Prefer this to market_get_klines for Agent analysis.",
    cliPath: ["market", "klines-summary"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, interval: { type: "string" }, startTime: { type: "integer" }, endTime: { type: "integer" }, timezone: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["symbol", "interval"], additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "interval", "startTime", "endTime", "timezone", "limit"]);
      const startTime = value.startTime === undefined ? undefined : optionalInteger(value, "startTime", 0, 0, Number.MAX_SAFE_INTEGER);
      const endTime = value.endTime === undefined ? undefined : optionalInteger(value, "endTime", 0, 0, Number.MAX_SAFE_INTEGER);
      return { symbol: requiredString(value, "symbol"), interval: requiredString(value, "interval"), startTime, endTime, timezone: optionalString(value, "timezone"), limit: optionalInteger(value, "limit", 20, 1, 100) };
    },
    handler: async (input, context) => {
      const value = input as { symbol: string; interval: string; startTime?: number; endTime?: number; timezone?: string; limit: number };
      return summarizeKlines(await context.api.klines(value), value.symbol, value.interval);
    }
  }
];
