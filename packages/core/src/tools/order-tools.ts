import { randomUUID } from "node:crypto";
import { AiHubError } from "../errors.js";
import type { SpotCancelOrderParams, SpotPlaceOrderParams } from "../openapi.js";
import type { ToolSpec } from "./tool-spec.js";
import { requiredEnum } from "./tool-utils.js";
import { optionalInteger, optionalString, requiredString, strictObject } from "./validation.js";

const signedReadErrors = ["AI_HUB_INVALID_ARGUMENT", "AI_HUB_CREDENTIAL_NOT_CONFIGURED", "AI_HUB_OPENAPI_NETWORK_ERROR", "AI_HUB_OPENAPI_HTTP_ERROR", "AI_HUB_OPENAPI_INVALID_RESPONSE", "AI_HUB_OPENAPI_BUSINESS_ERROR"] as const;
const writeErrors = [...signedReadErrors, "AI_HUB_WRITE_CONFIRMATION_REQUIRED", "AI_HUB_CONFIRMATION_REQUIRED", "AI_HUB_CONFIRMATION_EXPIRED", "AI_HUB_CONFIRMATION_CONTEXT_CHANGED", "AI_HUB_CONFIRMATION_NOT_FOUND"] as const;
const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

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

function validatePlaceOrder(input: unknown): SpotPlaceOrderParams {
  const value = strictObject(input, ["symbol", "volume", "side", "type", "price", "timeInForce", "newClientOrderId", "recvWindow"]);
  const type = orderType(value);
  const price = optionalString(value, "price");
  if (type === "LIMIT" && !price) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is required for LIMIT orders.");
  if (type === "MARKET" && price) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is not allowed for MARKET orders.");
  const timeInForce = optionalString(value, "timeInForce")?.toUpperCase();
  if (timeInForce && !["GTC", "IOC", "FOK"].includes(timeInForce)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "timeInForce must be GTC, IOC, or FOK.");
  return {
    symbol: requiredString(value, "symbol"),
    volume: positiveDecimal(value, "volume"),
    side: orderSide(value),
    type,
    ...(price ? { price } : {}),
    ...(timeInForce ? { timeInForce: timeInForce as "GTC" | "IOC" | "FOK" } : {}),
    newClientOrderId: clientOrderId(value),
    ...(optionalString(value, "recvWindow") ? { recvWindow: optionalString(value, "recvWindow") } : {})
  };
}

function validateCancelOrder(input: unknown): SpotCancelOrderParams {
  const value = strictObject(input, ["symbol", "orderId", "newClientOrderId"]);
  return { symbol: requiredString(value, "symbol"), orderId: requiredString(value, "orderId"), ...(optionalString(value, "newClientOrderId") ? { newClientOrderId: optionalString(value, "newClientOrderId") } : {}) };
}

function validateTestOrder(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["symbol", "volume", "side", "type", "price", "newClientOrderId", "recvWindow"]);
  const type = orderType(value);
  const price = optionalString(value, "price");
  if (type === "LIMIT" && !price) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is required for LIMIT orders.");
  if (type === "MARKET" && price) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is not allowed for MARKET orders.");
  return { symbol: requiredString(value, "symbol"), volume: positiveDecimal(value, "volume"), side: orderSide(value), type, ...(price ? { price } : {}), ...(optionalString(value, "newClientOrderId") ? { newClientOrderId: optionalString(value, "newClientOrderId") } : {}), ...(optionalString(value, "recvWindow") ? { recvWindow: optionalString(value, "recvWindow") } : {}) };
}

function validateBatchOrders(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["symbol", "orders"]);
  const orders = value.orders;
  if (!Array.isArray(orders) || orders.length < 1 || orders.length > 10) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "orders must contain between 1 and 10 orders.");
  const normalized = orders.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `orders[${index}] must be an object.`);
    const order = item as Record<string, unknown>;
    const price = optionalString(order, "price");
    const volume = positiveDecimal(order, "volume");
    const side = orderSide(order);
    const batchType = requiredEnum(order, "batchType", ["LIMIT", "MARKET"] as const);
    if (batchType === "LIMIT" && !price) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `orders[${index}].price is required for LIMIT.`);
    if (batchType === "MARKET" && price) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `orders[${index}].price is not allowed for MARKET.`);
    return { volume, side, batchType, ...(price ? { price } : {}) };
  });
  return { symbol: requiredString(value, "symbol"), orders: normalized };
}

function validateBatchCancel(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["symbol", "orderIds"]);
  if (!Array.isArray(value.orderIds) || value.orderIds.length < 1 || value.orderIds.length > 10 || value.orderIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "orderIds must contain between 1 and 10 non-empty order ID strings.");
  }
  return { symbol: requiredString(value, "symbol"), orderIds: value.orderIds.map((id) => (id as string).trim()) };
}

export const orderTools: ToolSpec<any>[] = [
  {
    name: "spot_test_order", title: "Test Spot Order", description: "Validate one LIMIT or MARKET spot order without sending it to the matching engine.", cliPath: ["spot", "order", "test"],
    module: "spot-order", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, volume: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, type: { type: "string", enum: ["LIMIT", "MARKET"] }, price: { type: "string" }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "volume", "side", "type"], additionalProperties: false }, errorCodes: signedReadErrors,
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
    name: "spot_batch_place_orders", title: "Batch Place Spot Orders", description: "Create up to 10 spot orders after confirmation.", cliPath: ["spot", "order", "batch-place"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orders: { type: "array" } }, required: ["symbol", "orders"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateBatchOrders,
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
    name: "spot_get_open_orders", title: "Get Open Spot Orders", description: "Get current signed spot orders.", cliPath: ["spot", "order", "open"],
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
    name: "spot_place_order", title: "Place Spot Order", description: "Create one LIMIT or MARKET spot order after confirmation.", cliPath: ["spot", "order", "place"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, volume: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, type: { type: "string", enum: ["LIMIT", "MARKET"] }, price: { type: "string" }, timeInForce: { type: "string", enum: ["GTC", "IOC", "FOK"] }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "volume", "side", "type"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validatePlaceOrder,
    handler: (input, context) => context.api.placeOrder(input as SpotPlaceOrderParams, signed(context)),
    writeSummary: (input) => { const value = input as SpotPlaceOrderParams; return { action: "place_order", symbol: value.symbol, side: value.side, type: value.type, volume: value.volume, price: value.price ?? null, timeInForce: value.timeInForce ?? null, newClientOrderId: value.newClientOrderId }; }
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
