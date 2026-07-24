import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";
import { optionalBoolean, optionalClientOrderId, optionalPositiveInteger, positiveDecimal, requiredEnum, signed, signedReadErrors, writeErrors } from "./tool-utils.js";
import { optionalString, requiredString, strictObject } from "./validation.js";
import { preflightSymbolOrder } from "./symbol-rules.js";

type MarginOrderIntent = "market_buy" | "market_sell" | "limit";

interface SemanticMarginOrder {
  symbol: string;
  volume: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  newClientOrderId: string;
  isolated?: boolean;
  price?: string;
  intent: MarginOrderIntent;
  quoteAmount?: string;
  baseQuantity?: string;
}

function validateMarginSemanticOrder(input: unknown): SemanticMarginOrder {
  const value = strictObject(input, ["symbol", "side", "type", "quoteAmount", "baseQuantity", "price", "newClientOrderId", "isolated"]);
  const symbol = requiredString(value, "symbol");
  const side = requiredEnum(value, "side", ["BUY", "SELL"] as const);
  const type = requiredEnum(value, "type", ["LIMIT", "MARKET"] as const);
  const isolated = optionalBoolean(value, "isolated");
  const common = { symbol, side, type, newClientOrderId: optionalClientOrderId(value), ...(isolated !== undefined ? { isolated } : {}) };

  if (type === "MARKET" && side === "BUY") {
    if (value.baseQuantity !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "MARKET BUY uses quoteAmount (the amount of quote asset to spend), not baseQuantity.");
    if (value.price !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is not allowed for MARKET orders.");
    const quoteAmount = positiveDecimal(value, "quoteAmount");
    return { ...common, volume: quoteAmount, intent: "market_buy", quoteAmount };
  }

  if (type === "MARKET" && side === "SELL") {
    if (value.quoteAmount !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "MARKET SELL uses baseQuantity (the amount of base asset to sell), not quoteAmount.");
    if (value.price !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is not allowed for MARKET orders.");
    const baseQuantity = positiveDecimal(value, "baseQuantity");
    return { ...common, volume: baseQuantity, intent: "market_sell", baseQuantity };
  }

  if (value.quoteAmount !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "LIMIT orders use baseQuantity (the amount of base asset), not quoteAmount.");
  const baseQuantity = positiveDecimal(value, "baseQuantity");
  const price = positiveDecimal(value, "price");
  return { ...common, volume: baseQuantity, price, intent: "limit", baseQuantity };
}

function validateMarginMarketBuy(input: unknown): SemanticMarginOrder {
  const value = strictObject(input, ["symbol", "quoteAmount", "newClientOrderId", "isolated"]);
  return validateMarginSemanticOrder({ ...value, side: "BUY", type: "MARKET" });
}

function validateMarginMarketSell(input: unknown): SemanticMarginOrder {
  const value = strictObject(input, ["symbol", "baseQuantity", "newClientOrderId", "isolated"]);
  return validateMarginSemanticOrder({ ...value, side: "SELL", type: "MARKET" });
}

function validateMarginLimitOrder(input: unknown): SemanticMarginOrder {
  const value = strictObject(input, ["symbol", "side", "baseQuantity", "price", "newClientOrderId", "isolated"]);
  return validateMarginSemanticOrder({ ...value, type: "LIMIT" });
}

function toMarginOpenApiOrder(order: SemanticMarginOrder): Record<string, unknown> {
  return {
    symbol: order.symbol,
    volume: order.volume,
    side: order.side,
    type: order.type,
    newClientOrderId: order.newClientOrderId,
    ...(order.price ? { price: order.price } : {}),
    ...(order.isolated !== undefined ? { isolated: order.isolated } : {})
  };
}

function marginOrderSummary(order: SemanticMarginOrder): Record<string, unknown> {
  return {
    action: order.intent === "market_buy" ? "margin_market_buy" : order.intent === "market_sell" ? "margin_market_sell" : "margin_limit_order",
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    ...(order.quoteAmount ? { quoteAmount: order.quoteAmount, amountMeaning: "exact quote-asset amount to spend" } : {}),
    ...(order.baseQuantity ? { baseQuantity: order.baseQuantity, amountMeaning: "exact base-asset quantity" } : {}),
    ...(order.price ? { price: order.price } : {}),
    isolated: order.isolated ?? false,
    newClientOrderId: order.newClientOrderId
  };
}

async function preflightMarginOrder(order: SemanticMarginOrder, context: Parameters<NonNullable<ToolSpec<SemanticMarginOrder>["preflight"]>>[1]): Promise<SemanticMarginOrder> {
  await preflightSymbolOrder(context, order);
  return order;
}

function validateMarginOrderLookup(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["symbol", "orderId", "newClientOrderId", "isolated"]);
  return { symbol: requiredString(value, "symbol"), orderId: requiredString(value, "orderId"), ...(optionalString(value, "newClientOrderId") ? { newClientOrderId: optionalString(value, "newClientOrderId") } : {}), ...(optionalBoolean(value, "isolated") !== undefined ? { isolated: optionalBoolean(value, "isolated") } : {}) };
}

function validateMarginOpenOrders(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["symbol", "limit", "isolated"]);
  return { ...(optionalString(value, "symbol") ? { symbol: optionalString(value, "symbol") } : {}), limit: optionalPositiveInteger(value, "limit", 100, 1000), ...(optionalBoolean(value, "isolated") !== undefined ? { isolated: optionalBoolean(value, "isolated") } : {}) };
}

function validateMarginTrades(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["symbol", "limit", "fromId"]);
  return { symbol: requiredString(value, "symbol"), limit: optionalPositiveInteger(value, "limit", 100, 1000), ...(optionalString(value, "fromId") ? { fromId: optionalString(value, "fromId") } : {}) };
}

export const marginTools: ToolSpec<any>[] = [
  {
    name: "margin_get_order", title: "Get Margin Order", description: "Get one signed margin order from the v2 margin API.", cliPath: ["margin", "order", "get"],
    module: "spot-margin", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orderId: { type: "string" }, newClientOrderId: { type: "string" }, isolated: { type: "boolean" } }, required: ["symbol", "orderId"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: validateMarginOrderLookup,
    handler: (input, context) => context.api.signedGet("/sapi/v2/margin/order", input as Record<string, string | boolean | undefined>, signed(context))
  },
  {
    name: "margin_get_open_orders", title: "Get Open Margin Orders", description: "Get signed open margin orders from the v2 margin API.", cliPath: ["margin", "order", "open"],
    module: "spot-margin", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 1000 }, isolated: { type: "boolean" } }, additionalProperties: false }, errorCodes: signedReadErrors,
    validate: validateMarginOpenOrders,
    handler: (input, context) => context.api.signedGet("/sapi/v2/margin/openOrders", input as Record<string, string | number | boolean | undefined>, signed(context))
  },
  {
    name: "margin_get_fills", title: "Get Margin Fills", description: "Get signed margin trade history from the v2 margin API.", cliPath: ["margin", "order", "fills"],
    module: "spot-margin", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 1000 }, fromId: { type: "string" } }, required: ["symbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: validateMarginTrades,
    handler: (input, context) => context.api.signedGet("/sapi/v2/margin/myTrades", input as Record<string, string | number | undefined>, signed(context))
  },
  {
    name: "margin_market_buy", title: "Margin Market Buy by Quote Amount", description: "Spend an exact quote-asset amount for an isolated or cross-margin market buy. For ETHUSDT, quoteAmount is USDT. A market buy cannot guarantee an exact base-asset quantity.", cliPath: ["margin", "order", "market-buy"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, quoteAmount: { type: "string", description: "Required exact quote-asset amount to spend." }, newClientOrderId: { type: "string" }, isolated: { type: "boolean" } }, required: ["symbol", "quoteAmount"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateMarginMarketBuy,
    preflight: preflightMarginOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/order", toMarginOpenApiOrder(input as SemanticMarginOrder), signed(context)),
    writeSummary: (input) => marginOrderSummary(input as SemanticMarginOrder)
  },
  {
    name: "margin_market_sell", title: "Margin Market Sell by Base Quantity", description: "Sell an exact base-asset quantity at market for an isolated or cross-margin account. For ETHUSDT, baseQuantity is ETH.", cliPath: ["margin", "order", "market-sell"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, baseQuantity: { type: "string", description: "Required exact base-asset quantity to sell." }, newClientOrderId: { type: "string" }, isolated: { type: "boolean" } }, required: ["symbol", "baseQuantity"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateMarginMarketSell,
    preflight: preflightMarginOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/order", toMarginOpenApiOrder(input as SemanticMarginOrder), signed(context)),
    writeSummary: (input) => marginOrderSummary(input as SemanticMarginOrder)
  },
  {
    name: "margin_limit_order", title: "Place Margin Limit Order", description: "Place an isolated or cross-margin LIMIT BUY or SELL using an exact base-asset quantity and a limit price.", cliPath: ["margin", "order", "limit"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, baseQuantity: { type: "string", description: "Required exact base-asset quantity." }, price: { type: "string", description: "Required limit price in the quote asset." }, newClientOrderId: { type: "string" }, isolated: { type: "boolean" } }, required: ["symbol", "side", "baseQuantity", "price"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateMarginLimitOrder,
    preflight: preflightMarginOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/order", toMarginOpenApiOrder(input as SemanticMarginOrder), signed(context)),
    writeSummary: (input) => marginOrderSummary(input as SemanticMarginOrder)
  },
  {
    name: "margin_cancel_order", title: "Cancel Margin Order", description: "Cancel one v2 margin order after confirmation.", cliPath: ["margin", "order", "cancel"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orderId: { type: "string" }, newClientOrderId: { type: "string" }, isolated: { type: "boolean" } }, required: ["symbol", "orderId"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateMarginOrderLookup,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/cancel", input as Record<string, unknown>, signed(context)),
    writeSummary: (input) => { const value = input as Record<string, unknown>; return { action: "margin_cancel_order", symbol: value.symbol, orderId: value.orderId, isolated: value.isolated ?? false, newClientOrderId: value.newClientOrderId ?? null }; }
  }
];
