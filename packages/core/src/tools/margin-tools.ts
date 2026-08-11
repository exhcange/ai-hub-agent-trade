import { AiHubError } from "../errors.js";
import type { SpotOrderType } from "../openapi.js";
import type { ToolSpec } from "./tool-spec.js";
import { optionalBoolean, optionalClientOrderId, optionalPositiveInteger, positiveDecimal, requiredEnum, signed, signedReadErrors, writeErrors } from "./tool-utils.js";
import { STANDARD_LIST_LIMIT, listLimitSchema, normalizedListLimit } from "./list-limit.js";
import { optionalString, requiredString, strictObject } from "./validation.js";
import { getSymbolRule, multiplyDecimal, preflightSymbolOrder, resolveTenantSymbol } from "./symbol-rules.js";

const MARGIN_ORDER_TYPES = ["LIMIT", "MARKET", "IOC", "FOK", "POST_ONLY", "STOP", "STOP_MARKET"] as const satisfies readonly SpotOrderType[];
const MARGIN_LIMIT_ORDER_TYPES = ["LIMIT", "IOC", "FOK", "POST_ONLY"] as const;

type MarginOrderIntent = "market_buy" | "market_sell" | "limit" | "stop_limit" | "stop_market_buy" | "stop_market_sell";

interface SemanticMarginOrder {
  symbol: string;
  volume: string;
  side: "BUY" | "SELL";
  type: SpotOrderType;
  newClientOrderId: string;
  isolated: boolean;
  price?: string;
  triggerPrice?: string;
  intent: MarginOrderIntent;
  quoteAmount?: string;
  baseQuantity?: string;
  requestedSymbol?: string;
  displaySymbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  displayBaseAsset?: string;
  displayQuoteAsset?: string;
}

interface PreparedMarginCancel extends Record<string, unknown> {
  symbol: string;
  requestedSymbol?: string;
  displaySymbol?: string;
  orderId: string;
  newClientOrderId?: string;
  isolated: boolean;
}

const marginWriteErrors = [
  ...writeErrors,
  "AI_HUB_MARGIN_MODE_REQUIRED",
  "AI_HUB_MARGIN_LEVERAGE_MULTIPLIER_NOT_SUPPORTED"
] as const;

const MARGIN_MODE_SCHEMA = {
  type: "boolean"
} as const;

function strictMarginObject(input: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const value = input as Record<string, unknown>;
    for (const name of ["leverage", "leverageMultiple", "leverageMultiplier", "multiplier"]) {
      if (Object.hasOwn(value, name)) {
        throw new AiHubError(
          "AI_HUB_MARGIN_LEVERAGE_MULTIPLIER_NOT_SUPPORTED",
          "AI Hub supports isolated and cross spot margin, but the OpenAPI order endpoint does not accept an explicit leverage multiplier such as 10x. Do not map this request to derivatives or a perpetual contract."
        );
      }
    }
  }
  return strictObject(input, allowedKeys);
}

function requiredMarginMode(input: Record<string, unknown>): boolean {
  const isolated = optionalBoolean(input, "isolated");
  if (isolated === undefined) {
    throw new AiHubError(
      "AI_HUB_MARGIN_MODE_REQUIRED",
      "isolated is required for every spot-margin write: true selects isolated margin and false selects cross margin. Do not infer the mode."
    );
  }
  return isolated;
}

function validateMarginSemanticOrder(input: unknown): SemanticMarginOrder {
  const value = strictMarginObject(input, ["symbol", "side", "type", "quoteAmount", "baseQuantity", "price", "triggerPrice", "newClientOrderId", "isolated"]);
  const symbol = requiredString(value, "symbol");
  const side = requiredEnum(value, "side", ["BUY", "SELL"] as const);
  const type = requiredEnum(value, "type", MARGIN_ORDER_TYPES);
  const isolated = requiredMarginMode(value);
  const common = { symbol, side, type, newClientOrderId: optionalClientOrderId(value), isolated };

  if (type === "MARKET" && side === "BUY") {
    if (value.baseQuantity !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "MARKET BUY uses quoteAmount (the amount of quote asset to spend), not baseQuantity.");
    if (value.price !== undefined || value.triggerPrice !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price and triggerPrice are not allowed for MARKET orders.");
    const quoteAmount = positiveDecimal(value, "quoteAmount");
    return { ...common, volume: quoteAmount, intent: "market_buy", quoteAmount };
  }

  if (type === "MARKET" && side === "SELL") {
    if (value.quoteAmount !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "MARKET SELL uses baseQuantity (the amount of base asset to sell), not quoteAmount.");
    if (value.price !== undefined || value.triggerPrice !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price and triggerPrice are not allowed for MARKET orders.");
    const baseQuantity = positiveDecimal(value, "baseQuantity");
    return { ...common, volume: baseQuantity, intent: "market_sell", baseQuantity };
  }

  if ((MARGIN_LIMIT_ORDER_TYPES as readonly string[]).includes(type)) {
    if (value.quoteAmount !== undefined || value.triggerPrice !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${type} orders use baseQuantity and price; quoteAmount and triggerPrice are not allowed.`);
    const baseQuantity = positiveDecimal(value, "baseQuantity");
    const price = positiveDecimal(value, "price");
    return { ...common, volume: baseQuantity, price, intent: "limit", baseQuantity };
  }

  const triggerPrice = positiveDecimal(value, "triggerPrice");
  if (type === "STOP") {
    if (value.quoteAmount !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "STOP orders use baseQuantity (the amount of base asset), not quoteAmount.");
    const baseQuantity = positiveDecimal(value, "baseQuantity");
    const price = positiveDecimal(value, "price");
    return { ...common, volume: baseQuantity, price, triggerPrice, intent: "stop_limit", baseQuantity };
  }
  if (side === "BUY") {
    if (value.baseQuantity !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "STOP_MARKET BUY uses quoteAmount (the amount of quote asset to spend), not baseQuantity.");
    if (value.price !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is not allowed for STOP_MARKET orders.");
    const quoteAmount = positiveDecimal(value, "quoteAmount");
    return { ...common, volume: quoteAmount, triggerPrice, intent: "stop_market_buy", quoteAmount };
  }
  if (value.quoteAmount !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "STOP_MARKET SELL uses baseQuantity (the amount of base asset), not quoteAmount.");
  if (value.price !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is not allowed for STOP_MARKET orders.");
  const baseQuantity = positiveDecimal(value, "baseQuantity");
  return { ...common, volume: baseQuantity, triggerPrice, intent: "stop_market_sell", baseQuantity };
}

function validateMarginMarketBuy(input: unknown): SemanticMarginOrder {
  const value = strictMarginObject(input, ["symbol", "quoteAmount", "newClientOrderId", "isolated"]);
  return validateMarginSemanticOrder({ ...value, side: "BUY", type: "MARKET" });
}

function validateMarginMarketSell(input: unknown): SemanticMarginOrder {
  const value = strictMarginObject(input, ["symbol", "baseQuantity", "newClientOrderId", "isolated"]);
  return validateMarginSemanticOrder({ ...value, side: "SELL", type: "MARKET" });
}

function validateMarginLimitOrder(input: unknown): SemanticMarginOrder {
  const value = strictMarginObject(input, ["symbol", "side", "type", "baseQuantity", "price", "newClientOrderId", "isolated"]);
  const type = value.type === undefined ? "LIMIT" : requiredEnum(value, "type", MARGIN_LIMIT_ORDER_TYPES);
  return validateMarginSemanticOrder({ ...value, type });
}

function validateMarginStopLimitOrder(input: unknown): SemanticMarginOrder {
  const value = strictMarginObject(input, ["symbol", "side", "baseQuantity", "price", "triggerPrice", "newClientOrderId", "isolated"]);
  return validateMarginSemanticOrder({ ...value, type: "STOP" });
}

function validateMarginStopMarketBuy(input: unknown): SemanticMarginOrder {
  const value = strictMarginObject(input, ["symbol", "quoteAmount", "triggerPrice", "newClientOrderId", "isolated"]);
  return validateMarginSemanticOrder({ ...value, side: "BUY", type: "STOP_MARKET" });
}

function validateMarginStopMarketSell(input: unknown): SemanticMarginOrder {
  const value = strictMarginObject(input, ["symbol", "baseQuantity", "triggerPrice", "newClientOrderId", "isolated"]);
  return validateMarginSemanticOrder({ ...value, side: "SELL", type: "STOP_MARKET" });
}

function toMarginOpenApiOrder(order: SemanticMarginOrder): Record<string, unknown> {
  return {
    symbol: order.symbol,
    volume: order.volume,
    side: order.side,
    type: order.type,
    newClientOrderId: order.newClientOrderId,
    ...(order.price ? { price: order.price } : {}),
    ...(order.triggerPrice ? { triggerPrice: order.triggerPrice } : {}),
    isolated: order.isolated
  };
}

function marginOrderSummary(order: SemanticMarginOrder): Record<string, unknown> {
  const action = {
    market_buy: "margin_market_buy",
    market_sell: "margin_market_sell",
    limit: "margin_limit_order",
    stop_limit: "margin_stop_limit_order",
    stop_market_buy: "margin_stop_market_buy",
    stop_market_sell: "margin_stop_market_sell"
  }[order.intent];
  return {
    action,
    symbol: order.displaySymbol ?? order.requestedSymbol ?? order.symbol,
    apiSymbol: order.symbol,
    side: order.side,
    type: order.type,
    quantityOrAmount: order.quoteAmount
      ? { value: order.quoteAmount, asset: order.displayQuoteAsset ?? order.quoteAsset ?? null, apiAsset: order.quoteAsset ?? null, meaning: "exact quote-asset amount to spend" }
      : { value: order.baseQuantity ?? order.volume, asset: order.displayBaseAsset ?? order.baseAsset ?? null, apiAsset: order.baseAsset ?? null, meaning: "exact base-asset quantity" },
    priceOrMarket: order.price
      ? { mode: "LIMIT", price: order.price, ...(order.triggerPrice ? { triggerPrice: order.triggerPrice } : {}) }
      : { mode: "MARKET", ...(order.triggerPrice ? { triggerPrice: order.triggerPrice } : {}) },
    estimatedNotional: order.price && order.baseQuantity
      ? { amount: multiplyDecimal(order.baseQuantity, order.price), asset: order.displayQuoteAsset ?? order.quoteAsset ?? null, apiAsset: order.quoteAsset ?? null, status: "estimated" }
      : order.quoteAmount
        ? { amount: order.quoteAmount, asset: order.displayQuoteAsset ?? order.quoteAsset ?? null, apiAsset: order.quoteAsset ?? null, status: "estimated" }
        : { amount: null, asset: order.displayQuoteAsset ?? order.quoteAsset ?? null, apiAsset: order.quoteAsset ?? null, status: "market_price_unknown" },
    isolated: order.isolated,
    marginMode: order.isolated ? "ISOLATED" : "CROSS",
    newClientOrderId: order.newClientOrderId
  };
}

async function preflightMarginOrder(order: SemanticMarginOrder, context: Parameters<NonNullable<ToolSpec<SemanticMarginOrder>["preflight"]>>[1]): Promise<SemanticMarginOrder> {
  const rule = await preflightSymbolOrder(context, order);
  return {
    ...order,
    symbol: rule.symbol,
    requestedSymbol: order.symbol,
    displaySymbol: rule.displaySymbol ?? order.symbol,
    baseAsset: rule.baseAsset,
    quoteAsset: rule.quoteAsset,
    displayBaseAsset: rule.displayBaseAsset,
    displayQuoteAsset: rule.displayQuoteAsset
  };
}

async function resolveMarginSymbol(context: Parameters<ToolSpec["handler"]>[1], symbol: string): Promise<string> {
  return resolveTenantSymbol(context, symbol);
}

async function preflightMarginCancel(input: Record<string, unknown>, context: Parameters<NonNullable<ToolSpec["preflight"]>>[1]): Promise<PreparedMarginCancel> {
  const requestedSymbol = String(input.symbol);
  const rule = await getSymbolRule(context, requestedSymbol);
  return {
    ...input,
    symbol: rule.symbol,
    requestedSymbol,
    displaySymbol: rule.displaySymbol ?? requestedSymbol,
    orderId: String(input.orderId),
    isolated: input.isolated as boolean
  };
}

function toMarginCancelOpenApi(input: PreparedMarginCancel): Record<string, unknown> {
  return {
    symbol: input.symbol,
    orderId: input.orderId,
    ...(input.newClientOrderId ? { newClientOrderId: input.newClientOrderId } : {}),
    isolated: input.isolated
  };
}

function validateMarginOrderLookup(input: unknown): Record<string, unknown> {
  const value = strictMarginObject(input, ["symbol", "orderId", "newClientOrderId", "isolated"]);
  return { symbol: requiredString(value, "symbol"), orderId: requiredString(value, "orderId"), ...(optionalString(value, "newClientOrderId") ? { newClientOrderId: optionalString(value, "newClientOrderId") } : {}), ...(optionalBoolean(value, "isolated") !== undefined ? { isolated: optionalBoolean(value, "isolated") } : {}) };
}

function validateMarginCancel(input: unknown): PreparedMarginCancel {
  const value = strictMarginObject(input, ["symbol", "orderId", "newClientOrderId", "isolated"]);
  return {
    symbol: requiredString(value, "symbol"),
    orderId: requiredString(value, "orderId"),
    isolated: requiredMarginMode(value),
    ...(optionalString(value, "newClientOrderId") ? { newClientOrderId: optionalString(value, "newClientOrderId") } : {})
  };
}

function validateMarginOpenOrders(input: unknown): Record<string, unknown> {
  const value = strictMarginObject(input, ["symbol", "limit", "isolated"]);
  return { ...(optionalString(value, "symbol") ? { symbol: optionalString(value, "symbol") } : {}), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT), ...(optionalBoolean(value, "isolated") !== undefined ? { isolated: optionalBoolean(value, "isolated") } : {}) };
}

function validateMarginTrades(input: unknown): Record<string, unknown> {
  const value = strictMarginObject(input, ["symbol", "limit", "fromId"]);
  return { symbol: requiredString(value, "symbol"), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT), ...(optionalString(value, "fromId") ? { fromId: optionalString(value, "fromId") } : {}) };
}

export const marginTools: ToolSpec<any>[] = [
  {
    name: "margin_get_order", title: "Get Spot Margin Order", description: "Get one isolated or cross spot-margin order. This capability is not for derivatives or perpetual contracts.", cliPath: ["margin", "order", "get"],
    module: "spot-margin", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orderId: { type: "string" }, newClientOrderId: { type: "string" }, isolated: { type: "boolean" } }, required: ["symbol", "orderId"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: validateMarginOrderLookup,
    handler: async (input, context) => {
      const value = input as Record<string, string | boolean | undefined>;
      return context.api.signedGet("/sapi/v2/margin/order", { ...value, symbol: await resolveMarginSymbol(context, String(value.symbol)) }, signed(context));
    }
  },
  {
    name: "margin_get_open_orders", title: "Get Open Spot Margin Orders", description: "Get open isolated or cross spot-margin orders. This capability is not for derivatives or perpetual contracts.", cliPath: ["margin", "order", "open"],
    module: "spot-margin", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: listLimitSchema(STANDARD_LIST_LIMIT), isolated: { type: "boolean" } }, additionalProperties: false }, errorCodes: signedReadErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: validateMarginOpenOrders,
    handler: async (input, context) => {
      const value = input as Record<string, string | number | boolean | undefined>;
      return context.api.signedGet("/sapi/v2/margin/openOrders", { ...value, ...(value.symbol ? { symbol: await resolveMarginSymbol(context, String(value.symbol)) } : {}) }, signed(context));
    }
  },
  {
    name: "margin_get_fills", title: "Get Spot Margin Fills", description: "Get spot-margin trade history from the v2 margin API. This capability is not for derivatives or perpetual contracts.", cliPath: ["margin", "order", "fills"],
    module: "spot-margin", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: listLimitSchema(STANDARD_LIST_LIMIT), fromId: { type: "string" } }, required: ["symbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: validateMarginTrades,
    handler: async (input, context) => {
      const value = input as Record<string, string | number | undefined>;
      return context.api.signedGet("/sapi/v2/margin/myTrades", { ...value, symbol: await resolveMarginSymbol(context, String(value.symbol)) }, signed(context));
    }
  },
  {
    name: "margin_market_buy", title: "Spot Margin Market Buy by Quote Amount", description: "Place an isolated or cross spot-margin market buy. Explicit leverage multipliers and derivatives are not supported.", cliPath: ["margin", "order", "market-buy"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, quoteAmount: { type: "string", description: "Required exact quote-asset amount to spend." }, newClientOrderId: { type: "string" }, isolated: MARGIN_MODE_SCHEMA }, required: ["symbol", "quoteAmount", "isolated"], additionalProperties: false }, errorCodes: marginWriteErrors,
    validate: validateMarginMarketBuy,
    preflight: preflightMarginOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/order", toMarginOpenApiOrder(input as SemanticMarginOrder), signed(context)),
    writeSummary: (input) => marginOrderSummary(input as SemanticMarginOrder)
  },
  {
    name: "margin_market_sell", title: "Spot Margin Market Sell by Base Quantity", description: "Place an isolated or cross spot-margin market sell. Explicit leverage multipliers and derivatives are not supported.", cliPath: ["margin", "order", "market-sell"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, baseQuantity: { type: "string", description: "Required exact base-asset quantity to sell." }, newClientOrderId: { type: "string" }, isolated: MARGIN_MODE_SCHEMA }, required: ["symbol", "baseQuantity", "isolated"], additionalProperties: false }, errorCodes: marginWriteErrors,
    validate: validateMarginMarketSell,
    preflight: preflightMarginOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/order", toMarginOpenApiOrder(input as SemanticMarginOrder), signed(context)),
    writeSummary: (input) => marginOrderSummary(input as SemanticMarginOrder)
  },
  {
    name: "margin_limit_order", title: "Place Spot Margin Limit-Style Order", description: "Place an isolated or cross spot-margin limit-style order. Explicit leverage multipliers and derivatives are not supported.", cliPath: ["margin", "order", "limit"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, type: { type: "string", enum: MARGIN_LIMIT_ORDER_TYPES, description: "OpenAPI order type. Defaults to LIMIT; use IOC, FOK, or POST_ONLY directly." }, baseQuantity: { type: "string", description: "Required exact base-asset quantity." }, price: { type: "string", description: "Required limit price in the quote asset." }, newClientOrderId: { type: "string" }, isolated: MARGIN_MODE_SCHEMA }, required: ["symbol", "side", "baseQuantity", "price", "isolated"], additionalProperties: false }, errorCodes: marginWriteErrors,
    validate: validateMarginLimitOrder,
    preflight: preflightMarginOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/order", toMarginOpenApiOrder(input as SemanticMarginOrder), signed(context)),
    writeSummary: (input) => marginOrderSummary(input as SemanticMarginOrder)
  },
  {
    name: "margin_stop_limit_order", title: "Place Spot Margin Stop-Limit Order", description: "Place an isolated or cross spot-margin STOP order. Explicit leverage multipliers and derivatives are not supported.", cliPath: ["margin", "order", "stop-limit"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, baseQuantity: { type: "string" }, price: { type: "string" }, triggerPrice: { type: "string" }, newClientOrderId: { type: "string" }, isolated: MARGIN_MODE_SCHEMA }, required: ["symbol", "side", "baseQuantity", "price", "triggerPrice", "isolated"], additionalProperties: false }, errorCodes: marginWriteErrors,
    validate: validateMarginStopLimitOrder,
    preflight: preflightMarginOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/order", toMarginOpenApiOrder(input as SemanticMarginOrder), signed(context)),
    writeSummary: (input) => marginOrderSummary(input as SemanticMarginOrder)
  },
  {
    name: "margin_stop_market_buy", title: "Place Spot Margin Stop-Market Buy", description: "Place an isolated or cross spot-margin STOP_MARKET BUY. Explicit leverage multipliers and derivatives are not supported.", cliPath: ["margin", "order", "stop-market-buy"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, quoteAmount: { type: "string" }, triggerPrice: { type: "string" }, newClientOrderId: { type: "string" }, isolated: MARGIN_MODE_SCHEMA }, required: ["symbol", "quoteAmount", "triggerPrice", "isolated"], additionalProperties: false }, errorCodes: marginWriteErrors,
    validate: validateMarginStopMarketBuy,
    preflight: preflightMarginOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/order", toMarginOpenApiOrder(input as SemanticMarginOrder), signed(context)),
    writeSummary: (input) => marginOrderSummary(input as SemanticMarginOrder)
  },
  {
    name: "margin_stop_market_sell", title: "Place Spot Margin Stop-Market Sell", description: "Place an isolated or cross spot-margin STOP_MARKET SELL. Explicit leverage multipliers and derivatives are not supported.", cliPath: ["margin", "order", "stop-market-sell"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, baseQuantity: { type: "string" }, triggerPrice: { type: "string" }, newClientOrderId: { type: "string" }, isolated: MARGIN_MODE_SCHEMA }, required: ["symbol", "baseQuantity", "triggerPrice", "isolated"], additionalProperties: false }, errorCodes: marginWriteErrors,
    validate: validateMarginStopMarketSell,
    preflight: preflightMarginOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/order", toMarginOpenApiOrder(input as SemanticMarginOrder), signed(context)),
    writeSummary: (input) => marginOrderSummary(input as SemanticMarginOrder)
  },
  {
    name: "margin_cancel_order", title: "Cancel Spot Margin Order", description: "Cancel one isolated or cross spot-margin order after confirmation. This is not a derivatives order.", cliPath: ["margin", "order", "cancel"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orderId: { type: "string" }, newClientOrderId: { type: "string" }, isolated: MARGIN_MODE_SCHEMA }, required: ["symbol", "orderId", "isolated"], additionalProperties: false }, errorCodes: marginWriteErrors,
    validate: validateMarginCancel,
    preflight: preflightMarginCancel,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/cancel", toMarginCancelOpenApi(input as PreparedMarginCancel), signed(context)),
    writeSummary: (input) => {
      const value = input as PreparedMarginCancel;
      return { action: "margin_cancel_order", symbol: value.displaySymbol ?? value.requestedSymbol ?? value.symbol, apiSymbol: value.symbol, orderId: value.orderId, isolated: value.isolated, marginMode: value.isolated ? "ISOLATED" : "CROSS", newClientOrderId: value.newClientOrderId ?? null };
    }
  }
];
