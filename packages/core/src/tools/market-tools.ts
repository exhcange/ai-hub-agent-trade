import type { ToolSpec } from "./tool-spec.js";
import { optionalInteger, optionalString, requiredString, strictObject } from "./validation.js";

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
    description: "Get spot symbols from the configured tenant OpenAPI.",
    cliPath: ["market", "symbols"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => strictObject(input, []),
    handler: (_input, context) => context.api.symbols()
  },
  {
    name: "market_get_ticker",
    title: "Get Spot Ticker",
    description: "Get spot ticker data. Pass symbol or symbols when filtering is needed.",
    cliPath: ["market", "ticker"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, symbols: { type: "string" }, timeZone: { type: "string" } }, additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "symbols", "timeZone"]);
      return { symbol: optionalString(value, "symbol"), symbols: optionalString(value, "symbols"), timeZone: optionalString(value, "timeZone") };
    },
    handler: (input, context) => context.api.ticker(input as { symbol?: string; symbols?: string; timeZone?: string })
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
    name: "market_get_trades",
    title: "Get Recent Spot Trades",
    description: "Get recent spot trades for one symbol.",
    cliPath: ["market", "trades"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 1000 } }, required: ["symbol"], additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "limit"]);
      return { symbol: requiredString(value, "symbol"), limit: optionalInteger(value, "limit", 100, 1, 1000) };
    },
    handler: (input, context) => {
      const value = input as { symbol: string; limit: number };
      return context.api.trades(value.symbol, value.limit);
    }
  },
  {
    name: "market_get_klines",
    title: "Get Spot Klines",
    description: "Get spot candlestick data for one symbol and interval.",
    cliPath: ["market", "klines"],
    module: "spot-common", access: "public", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, interval: { type: "string" }, startTime: { type: "integer" }, endTime: { type: "integer" }, timezone: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 1000 } }, required: ["symbol", "interval"], additionalProperties: false },
    errorCodes: readErrors,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "interval", "startTime", "endTime", "timezone", "limit"]);
      const startTime = value.startTime === undefined ? undefined : optionalInteger(value, "startTime", 0, 0, Number.MAX_SAFE_INTEGER);
      const endTime = value.endTime === undefined ? undefined : optionalInteger(value, "endTime", 0, 0, Number.MAX_SAFE_INTEGER);
      return { symbol: requiredString(value, "symbol"), interval: requiredString(value, "interval"), startTime, endTime, timezone: optionalString(value, "timezone"), limit: optionalInteger(value, "limit", 100, 1, 1000) };
    },
    handler: (input, context) => context.api.klines(input as { symbol: string; interval: string; startTime?: number; endTime?: number; timezone?: string; limit?: number })
  }
];
