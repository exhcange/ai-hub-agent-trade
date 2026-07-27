import { randomUUID } from "node:crypto";
import { AiHubError } from "../errors.js";
import type { SpotCancelOrderParams, SpotPlaceOrderParams } from "../openapi.js";
import { requireAvailableBalance } from "./account-balance.js";
import type { ToolSpec } from "./tool-spec.js";
import { requiredEnum } from "./tool-utils.js";
import { optionalInteger, optionalString, requiredString, strictObject } from "./validation.js";
import { floorDecimal, getSymbolRule, isAtLeastDecimal, preflightSymbolOrder, subtractNonNegativeDecimal } from "./symbol-rules.js";

const signedReadErrors = ["AI_HUB_INVALID_ARGUMENT", "AI_HUB_CREDENTIAL_NOT_CONFIGURED", "AI_HUB_OPENAPI_NETWORK_ERROR", "AI_HUB_OPENAPI_HTTP_ERROR", "AI_HUB_OPENAPI_INVALID_RESPONSE", "AI_HUB_OPENAPI_BUSINESS_ERROR"] as const;
const writeErrors = [...signedReadErrors, "AI_HUB_SYMBOL_NOT_FOUND", "AI_HUB_SYMBOL_PRECISION_INVALID", "AI_HUB_SYMBOL_MINIMUM_NOT_MET", "AI_HUB_INSUFFICIENT_AVAILABLE_BALANCE", "AI_HUB_WRITE_CONFIRMATION_REQUIRED", "AI_HUB_CONFIRMATION_REQUIRED", "AI_HUB_CONFIRMATION_EXPIRED", "AI_HUB_CONFIRMATION_CONTEXT_CHANGED", "AI_HUB_CONFIRMATION_NOT_FOUND"] as const;
const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

type SpotOrderIntent = "market_buy" | "market_sell" | "limit";

interface SemanticSpotOrder extends SpotPlaceOrderParams {
  intent: SpotOrderIntent;
  quoteAmount?: string;
  baseQuantity?: string;
}

interface SellAvailableOrder extends SemanticSpotOrder {
  requestedMode: "available_balance";
  baseAsset?: string;
  availableBaseQuantity?: string;
  executableBaseQuantity?: string;
  remainderBaseQuantity?: string;
}

function positiveDecimal(value: Record<string, unknown>, name: string): string {
  const raw = requiredString(value, name);
  if (!decimal.test(raw) || !/[1-9]/.test(raw.replace(".", ""))) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} must be a positive decimal string.`);
  }
  return raw;
}

function signed(context: Parameters<ToolSpec["handler"]>[1]) {
  if (!context.credentials) throw new AiHubError("AI_HUB_CREDENTIAL_NOT_CONFIGURED", `Credentials are not configured for profile "${context.profile.name}".`);
  return context.credentials;
}

function orderSide(value: Record<string, unknown>): "BUY" | "SELL" {
  const side = requiredString(value, "side").toUpperCase();
  if (side !== "BUY" && side !== "SELL") throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "side must be BUY or SELL.");
  return side;
}

function orderType(value: Record<string, unknown>): "LIMIT" | "MARKET" {
  const type = requiredString(value, "type").toUpperCase();
  if (type !== "LIMIT" && type !== "MARKET") throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "type must be LIMIT or MARKET.");
  return type;
}

function clientOrderId(value: Record<string, unknown>): string {
  const supplied = optionalString(value, "newClientOrderId");
  if (supplied) return supplied;
  return `agent_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function optionalOrderFields(value: Record<string, unknown>): Pick<SpotPlaceOrderParams, "newClientOrderId" | "recvWindow" | "timeInForce"> {
  const timeInForce = optionalString(value, "timeInForce")?.toUpperCase();
  if (timeInForce && !["GTC", "IOC", "FOK"].includes(timeInForce)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "timeInForce must be GTC, IOC, or FOK.");
  const recvWindow = optionalString(value, "recvWindow");
  return {
    newClientOrderId: clientOrderId(value),
    ...(recvWindow ? { recvWindow } : {}),
    ...(timeInForce ? { timeInForce: timeInForce as "GTC" | "IOC" | "FOK" } : {})
  };
}

/** Converts an unambiguous Agent/CLI intent to the legacy OpenAPI volume field. */
function validateSemanticOrder(input: unknown): SemanticSpotOrder {
  const value = strictObject(input, ["symbol", "side", "type", "quoteAmount", "baseQuantity", "price", "timeInForce", "newClientOrderId", "recvWindow"]);
  const side = orderSide(value);
  const type = orderType(value);
  const symbol = requiredString(value, "symbol");

  if (type === "MARKET" && side === "BUY") {
    if (value.baseQuantity !== undefined) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "MARKET BUY uses quoteAmount (the amount of quote asset to spend), not baseQuantity.");
    }
    if (value.price !== undefined || value.timeInForce !== undefined) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price and timeInForce are not allowed for MARKET orders.");
    }
    const quoteAmount = positiveDecimal(value, "quoteAmount");
    return { symbol, volume: quoteAmount, side, type, intent: "market_buy", quoteAmount, ...optionalOrderFields(value) };
  }

  if (type === "MARKET" && side === "SELL") {
    if (value.quoteAmount !== undefined) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "MARKET SELL uses baseQuantity (the amount of base asset to sell), not quoteAmount.");
    }
    if (value.price !== undefined || value.timeInForce !== undefined) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price and timeInForce are not allowed for MARKET orders.");
    }
    const baseQuantity = positiveDecimal(value, "baseQuantity");
    return { symbol, volume: baseQuantity, side, type, intent: "market_sell", baseQuantity, ...optionalOrderFields(value) };
  }

  if (value.quoteAmount !== undefined) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "LIMIT orders use baseQuantity (the amount of base asset), not quoteAmount.");
  }
  const baseQuantity = positiveDecimal(value, "baseQuantity");
  const price = positiveDecimal(value, "price");
  return { symbol, volume: baseQuantity, side, type, price, intent: "limit", baseQuantity, ...optionalOrderFields(value) };
}

function validateMarketBuy(input: unknown): SemanticSpotOrder {
  const value = strictObject(input, ["symbol", "quoteAmount", "newClientOrderId", "recvWindow"]);
  return validateSemanticOrder({ ...value, side: "BUY", type: "MARKET" });
}

function toOpenApiOrder(order: SemanticSpotOrder): SpotPlaceOrderParams {
  return {
    symbol: order.symbol,
    volume: order.volume,
    side: order.side,
    type: order.type,
    newClientOrderId: order.newClientOrderId,
    ...(order.price ? { price: order.price } : {}),
    ...(order.timeInForce ? { timeInForce: order.timeInForce } : {}),
    ...(order.recvWindow ? { recvWindow: order.recvWindow } : {})
  };
}

function validateMarketSell(input: unknown): SemanticSpotOrder {
  const value = strictObject(input, ["symbol", "baseQuantity", "newClientOrderId", "recvWindow"]);
  return validateSemanticOrder({ ...value, side: "SELL", type: "MARKET" });
}

function validateSellAvailable(input: unknown): SellAvailableOrder {
  const value = strictObject(input, ["symbol", "newClientOrderId", "recvWindow"]);
  const symbol = requiredString(value, "symbol");
  return {
    symbol,
    // Replaced by the signed balance and symbol-rule preflight before a preview is created.
    volume: "0",
    side: "SELL",
    type: "MARKET",
    intent: "market_sell",
    baseQuantity: "0",
    requestedMode: "available_balance",
    ...optionalOrderFields(value)
  };
}

function validateLimitOrder(input: unknown): SemanticSpotOrder {
  const value = strictObject(input, ["symbol", "side", "baseQuantity", "price", "timeInForce", "newClientOrderId", "recvWindow"]);
  return validateSemanticOrder({ ...value, type: "LIMIT" });
}

function validateCancelOrder(input: unknown): SpotCancelOrderParams {
  const value = strictObject(input, ["symbol", "orderId", "newClientOrderId"]);
  return { symbol: requiredString(value, "symbol"), orderId: requiredString(value, "orderId"), ...(optionalString(value, "newClientOrderId") ? { newClientOrderId: optionalString(value, "newClientOrderId") } : {}) };
}

function validateTestOrder(input: unknown): Record<string, unknown> {
  return toOpenApiOrder(validateSemanticOrder(input)) as unknown as Record<string, unknown>;
}

function validateBatchOrders(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["symbol", "orders"]);
  const symbol = requiredString(value, "symbol");
  const orders = value.orders;
  if (!Array.isArray(orders) || orders.length < 1 || orders.length > 10) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "orders must contain between 1 and 10 orders.");
  return { symbol, orders: orders.map((order, index) => {
    if (!order || typeof order !== "object" || Array.isArray(order)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `orders[${index}] must be an object.`);
    const semantic = validateSemanticOrder({ ...(order as Record<string, unknown>), symbol });
    return { volume: semantic.volume, side: semantic.side, batchType: semantic.type, ...(semantic.price ? { price: semantic.price } : {}) };
  }) };
}

function validateBatchCancel(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["symbol", "orderIds"]);
  if (!Array.isArray(value.orderIds) || value.orderIds.length < 1 || value.orderIds.length > 10 || value.orderIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "orderIds must contain between 1 and 10 non-empty order ID strings.");
  }
  return { symbol: requiredString(value, "symbol"), orderIds: value.orderIds.map((id) => (id as string).trim()) };
}

function semanticOrderSummary(order: SemanticSpotOrder): Record<string, unknown> {
  return {
    action: order.intent === "market_buy" ? "market_buy" : order.intent === "market_sell" ? "market_sell" : "limit_order",
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    ...(order.quoteAmount ? { quoteAmount: order.quoteAmount, amountMeaning: "exact quote-asset amount to spend" } : {}),
    ...(order.baseQuantity ? { baseQuantity: order.baseQuantity, amountMeaning: "exact base-asset quantity" } : {}),
    ...(order.price ? { price: order.price } : {}),
    ...(order.timeInForce ? { timeInForce: order.timeInForce } : {}),
    newClientOrderId: order.newClientOrderId
  };
}

function sellAvailableSummary(order: SellAvailableOrder): Record<string, unknown> {
  return {
    ...semanticOrderSummary(order),
    requestedMode: order.requestedMode,
    baseAsset: order.baseAsset,
    availableBaseQuantity: order.availableBaseQuantity,
    executableBaseQuantity: order.executableBaseQuantity,
    remainderBaseQuantity: order.remainderBaseQuantity,
    rounding: "floored to the configured base-quantity precision"
  };
}

async function preflightSpotOrder(order: SemanticSpotOrder, context: Parameters<NonNullable<ToolSpec<SemanticSpotOrder>["preflight"]>>[1]): Promise<SemanticSpotOrder> {
  await preflightSymbolOrder(context, order);
  return order;
}

async function preflightSellAvailable(order: SellAvailableOrder, context: Parameters<NonNullable<ToolSpec<SellAvailableOrder>["preflight"]>>[1]): Promise<SellAvailableOrder> {
  const rule = await getSymbolRule(context, order.symbol);
  if (!rule.baseAsset) {
    throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", `Symbol "${rule.symbol}" did not include a base asset.`);
  }
  const balance = requireAvailableBalance(await context.api.account(signed(context)), rule.baseAsset);
  const executableBaseQuantity = floorDecimal(balance.available, rule.quantityPrecision ?? 0);
  if (executableBaseQuantity === "0") {
    throw new AiHubError("AI_HUB_INSUFFICIENT_AVAILABLE_BALANCE", `Available ${balance.asset} balance is below the executable quantity precision for ${rule.symbol}.`);
  }
  if (rule.limitVolumeMin && !isAtLeastDecimal(executableBaseQuantity, rule.limitVolumeMin)) {
    throw new AiHubError("AI_HUB_SYMBOL_MINIMUM_NOT_MET", `Available ${balance.asset} balance for ${rule.symbol} is below the minimum executable quantity of ${rule.limitVolumeMin}.`);
  }
  const prepared: SellAvailableOrder = {
    ...order,
    symbol: rule.symbol,
    volume: executableBaseQuantity,
    baseQuantity: executableBaseQuantity,
    baseAsset: balance.asset,
    availableBaseQuantity: balance.available,
    executableBaseQuantity,
    remainderBaseQuantity: subtractNonNegativeDecimal(balance.available, executableBaseQuantity)
  };
  await preflightSymbolOrder(context, prepared);
  return prepared;
}

async function preflightSpotBatch(input: { symbol: string; orders: Array<{ volume: string; side: "BUY" | "SELL"; batchType: "LIMIT" | "MARKET"; price?: string }> }, context: Parameters<NonNullable<ToolSpec["preflight"]>>[1]): Promise<typeof input> {
  await Promise.all(input.orders.map((order) => preflightSymbolOrder(context, {
    symbol: input.symbol,
    side: order.side,
    type: order.batchType,
    ...(order.batchType === "MARKET" && order.side === "BUY" ? { quoteAmount: order.volume } : { baseQuantity: order.volume }),
    ...(order.price ? { price: order.price } : {})
  })));
  return input;
}

export const orderTools: ToolSpec<any>[] = [
  {
    name: "spot_test_order", title: "Test Spot Order", description: "Validate an order without sending it to the matching engine. MARKET BUY requires quoteAmount (quote asset to spend); MARKET SELL and LIMIT require baseQuantity. LIMIT also requires price.", cliPath: ["spot", "order", "test"],
    module: "spot-order", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, type: { type: "string", enum: ["LIMIT", "MARKET"] }, quoteAmount: { type: "string", description: "Required only for MARKET BUY: exact quote-asset amount to spend." }, baseQuantity: { type: "string", description: "Required for MARKET SELL and LIMIT: exact base-asset quantity." }, price: { type: "string", description: "Required only for LIMIT." }, timeInForce: { type: "string", enum: ["GTC", "IOC", "FOK"] }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "side", "type"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: validateTestOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/order/test", input as Record<string, unknown>, signed(context))
  },
  {
    name: "spot_get_order", title: "Get Spot Order", description: "Get one signed spot order by symbol and order ID.", cliPath: ["spot", "order", "get"],
    module: "spot-order", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orderId: { type: "string" }, newClientOrderId: { type: "string" } }, required: ["symbol", "orderId"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["symbol", "orderId", "newClientOrderId"]); return { symbol: requiredString(value, "symbol"), orderId: requiredString(value, "orderId"), newClientOrderId: optionalString(value, "newClientOrderId") }; },
    handler: (input, context) => context.api.getOrder(input as { symbol: string; orderId: string; newClientOrderId?: string }, signed(context))
  },
  {
    name: "spot_batch_place_orders", title: "Batch Place Spot Orders", description: "Create up to 10 spot orders after confirmation. Each MARKET BUY item requires quoteAmount; MARKET SELL and LIMIT items require baseQuantity; LIMIT items also require price.", cliPath: ["spot", "order", "batch-place"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orders: { type: "array", description: "Items use side/type plus quoteAmount for MARKET BUY, baseQuantity for MARKET SELL/LIMIT, and price for LIMIT." } }, required: ["symbol", "orders"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateBatchOrders,
    preflight: preflightSpotBatch,
    handler: (input, context) => context.api.signedPost("/sapi/v2/batchOrders", input as Record<string, unknown>, signed(context)),
    writeSummary: (input) => { const value = input as { symbol: string; orders: unknown[] }; return { action: "batch_place_orders", symbol: value.symbol, orderCount: value.orders.length, orders: value.orders }; }
  },
  {
    name: "spot_batch_cancel_orders", title: "Batch Cancel Spot Orders", description: "Cancel up to 10 spot orders after confirmation.", cliPath: ["spot", "order", "batch-cancel"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orderIds: { type: "array" } }, required: ["symbol", "orderIds"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateBatchCancel,
    handler: (input, context) => context.api.signedPost("/sapi/v2/batchCancel", input as Record<string, unknown>, signed(context)),
    writeSummary: (input) => { const value = input as { symbol: string; orderIds: string[] }; return { action: "batch_cancel_orders", symbol: value.symbol, orderIds: value.orderIds }; }
  },
  {
    name: "spot_get_open_orders", title: "Get Spot Open Orders", description: "Get current signed spot orders.", cliPath: ["spot", "order", "open"],
    module: "spot-order", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 1000 } }, additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["symbol", "limit"]); return { symbol: optionalString(value, "symbol"), limit: optionalInteger(value, "limit", 100, 1, 1000) }; },
    handler: (input, context) => context.api.getOpenOrders(input as { symbol?: string; limit?: number }, signed(context))
  },
  {
    name: "spot_get_fills", title: "Get Spot Fills", description: "Get signed spot fills for one symbol.", cliPath: ["spot", "order", "fills"],
    module: "spot-order", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 1000 }, fromId: { type: "string" } }, required: ["symbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["symbol", "limit", "fromId"]); return { symbol: requiredString(value, "symbol"), limit: optionalInteger(value, "limit", 100, 1, 1000), fromId: optionalString(value, "fromId") }; },
    handler: (input, context) => context.api.getMyTrades(input as { symbol: string; limit?: number; fromId?: string }, signed(context))
  },
  {
    name: "spot_market_buy", title: "Market Buy by Quote Amount", description: "Spend an exact quote-asset amount to buy at market. For ETHUSDT, quoteAmount is USDT. Do not use this tool to request a base-asset quantity such as 1 ETH; market execution cannot guarantee an exact base quantity.", cliPath: ["spot", "order", "market-buy"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, quoteAmount: { type: "string", description: "Required exact quote-asset amount to spend, e.g. 100 means spend 100 USDT for ETHUSDT." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "quoteAmount"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateMarketBuy,
    preflight: preflightSpotOrder,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SemanticSpotOrder), signed(context)),
    writeSummary: (input) => semanticOrderSummary(input as SemanticSpotOrder)
  },
  {
    name: "spot_market_sell", title: "Market Sell by Base Quantity", description: "Sell an exact base-asset quantity at market. For ETHUSDT, baseQuantity is ETH.", cliPath: ["spot", "order", "market-sell"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, baseQuantity: { type: "string", description: "Required exact base-asset quantity to sell, e.g. 0.5 means sell 0.5 ETH for ETHUSDT." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "baseQuantity"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateMarketSell,
    preflight: preflightSpotOrder,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SemanticSpotOrder), signed(context)),
    writeSummary: (input) => semanticOrderSummary(input as SemanticSpotOrder)
  },
  {
    name: "spot_sell_available", title: "Prepare Market Sell of Available Balance", description: "Prepare a market SELL of the maximum available base-asset balance for one symbol. It reads the signed balance, floors only to the configured quantity precision, shows the executable amount and remainder, and still requires separate confirmation.", cliPath: ["spot", "order", "sell-available"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Spot symbol, for example ETHUSDT." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateSellAvailable,
    preflight: preflightSellAvailable,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SellAvailableOrder), signed(context)),
    writeSummary: (input) => sellAvailableSummary(input as SellAvailableOrder)
  },
  {
    name: "spot_limit_order", title: "Place Limit Spot Order", description: "Place a LIMIT BUY or SELL using an exact base-asset quantity and a limit price.", cliPath: ["spot", "order", "limit"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, baseQuantity: { type: "string", description: "Required exact base-asset quantity." }, price: { type: "string", description: "Required limit price in the quote asset." }, timeInForce: { type: "string", enum: ["GTC", "IOC", "FOK"] }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "side", "baseQuantity", "price"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateLimitOrder,
    preflight: preflightSpotOrder,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SemanticSpotOrder), signed(context)),
    writeSummary: (input) => semanticOrderSummary(input as SemanticSpotOrder)
  },
  {
    name: "spot_cancel_order", title: "Cancel Spot Order", description: "Cancel one spot order after confirmation.", cliPath: ["spot", "order", "cancel"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orderId: { type: "string" }, newClientOrderId: { type: "string" } }, required: ["symbol", "orderId"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateCancelOrder,
    handler: (input, context) => context.api.cancelOrder(input as SpotCancelOrderParams, signed(context)),
    writeSummary: (input) => { const value = input as SpotCancelOrderParams; return { action: "cancel_order", symbol: value.symbol, orderId: value.orderId, newClientOrderId: value.newClientOrderId ?? null }; }
  }
];
