import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";
import { optionalBoolean, optionalClientOrderId, optionalPositiveInteger, positiveDecimal, requiredEnum, signed, signedReadErrors, writeErrors } from "./tool-utils.js";
import { optionalString, requiredString, strictObject } from "./validation.js";

function validateMarginOrder(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["symbol", "volume", "side", "type", "price", "newClientOrderId", "isolated"]);
  const type = requiredEnum(value, "type", ["LIMIT", "MARKET"] as const);
  const price = optionalString(value, "price");
  if (type === "LIMIT" && !price) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is required for LIMIT orders.");
  if (type === "MARKET" && price) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is not allowed for MARKET orders.");
  return { symbol: requiredString(value, "symbol"), volume: positiveDecimal(value, "volume"), side: requiredEnum(value, "side", ["BUY", "SELL"] as const), type, ...(price ? { price } : {}), newClientOrderId: optionalClientOrderId(value), ...(optionalBoolean(value, "isolated") !== undefined ? { isolated: optionalBoolean(value, "isolated") } : {}) };
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
    name: "margin_place_order", title: "Place Margin Order", description: "Create one v2 margin order after confirmation.", cliPath: ["margin", "order", "place"],
    module: "spot-margin", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, volume: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, type: { type: "string", enum: ["LIMIT", "MARKET"] }, price: { type: "string" }, newClientOrderId: { type: "string" }, isolated: { type: "boolean" } }, required: ["symbol", "volume", "side", "type"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateMarginOrder,
    handler: (input, context) => context.api.signedPost("/sapi/v2/margin/order", input as Record<string, unknown>, signed(context)),
    writeSummary: (input) => { const value = input as Record<string, unknown>; return { action: "margin_place_order", symbol: value.symbol, side: value.side, type: value.type, volume: value.volume, price: value.price ?? null, isolated: value.isolated ?? false, newClientOrderId: value.newClientOrderId }; }
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
