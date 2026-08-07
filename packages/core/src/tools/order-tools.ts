import { randomUUID } from "node:crypto";
import { AiHubError } from "../errors.js";
import type { SpotCancelOrderParams, SpotOrderType, SpotPlaceOrderParams } from "../openapi.js";
import { requireAvailableBalance } from "./account-balance.js";
import type { ToolSpec } from "./tool-spec.js";
import { requiredEnum } from "./tool-utils.js";
import { optionalInteger, optionalString, requiredString, strictObject } from "./validation.js";
import { STANDARD_LIST_LIMIT, listLimitSchema, normalizedListLimit } from "./list-limit.js";
import { summarizeLastPrice } from "./market-summaries.js";
import { addNonNegativeDecimal, exceedsUnfavourableDeviationBps, floorDecimal, getSymbolRule, isAtLeastDecimal, multiplyDecimal, preflightSymbolOrder, subtractNonNegativeDecimal } from "./symbol-rules.js";

const signedReadErrors = ["AI_HUB_INVALID_ARGUMENT", "AI_HUB_CREDENTIAL_NOT_CONFIGURED", "AI_HUB_OPENAPI_NETWORK_ERROR", "AI_HUB_OPENAPI_HTTP_ERROR", "AI_HUB_OPENAPI_INVALID_RESPONSE", "AI_HUB_OPENAPI_BUSINESS_ERROR"] as const;
const orderValidationErrors = [...signedReadErrors, "AI_HUB_SYMBOL_NOT_FOUND", "AI_HUB_SYMBOL_AMBIGUOUS", "AI_HUB_SYMBOL_PRECISION_INVALID", "AI_HUB_SYMBOL_MINIMUM_NOT_MET"] as const;
const writeErrors = [...signedReadErrors, "AI_HUB_SYMBOL_NOT_FOUND", "AI_HUB_SYMBOL_AMBIGUOUS", "AI_HUB_SYMBOL_PRECISION_INVALID", "AI_HUB_SYMBOL_MINIMUM_NOT_MET", "AI_HUB_INSUFFICIENT_AVAILABLE_BALANCE", "AI_HUB_MARKET_PRICE_CHECK_UNAVAILABLE", "AI_HUB_MARKET_PRICE_MOVED", "AI_HUB_WRITE_CONFIRMATION_REQUIRED", "AI_HUB_CONFIRMATION_REQUIRED", "AI_HUB_CONFIRMATION_EXPIRED", "AI_HUB_CONFIRMATION_CONTEXT_CHANGED", "AI_HUB_CONFIRMATION_NOT_FOUND"] as const;
const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MARKET_PRICE_DEVIATION_BPS = 500;

const ORDER_TYPES = ["LIMIT", "MARKET", "IOC", "FOK", "POST_ONLY", "STOP", "STOP_MARKET"] as const satisfies readonly SpotOrderType[];
const LIMIT_ORDER_TYPES = ["LIMIT", "IOC", "FOK", "POST_ONLY"] as const;
const STOP_ORDER_TYPES = ["STOP", "STOP_MARKET"] as const;

type SpotOrderIntent = "market_buy" | "market_sell" | "limit" | "stop_limit" | "stop_market_buy" | "stop_market_sell";

interface MarketPriceReference {
  price: string;
  source: "LIVE_TICKER";
  quotedAt: string;
  tickerTimestamp?: string;
}

interface SemanticSpotOrder extends SpotPlaceOrderParams {
  intent: SpotOrderIntent;
  /** The symbol the user supplied before tenant-specific canonicalization. */
  requestedSymbol?: string;
  /** User-facing canonical names derived from the tenant symbol snapshot. */
  displaySymbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  displayBaseAsset?: string;
  displayQuoteAsset?: string;
  quoteAmount?: string;
  baseQuantity?: string;
  marketPriceReference?: MarketPriceReference;
}

interface BatchSpotOrder {
  volume: string;
  side: "BUY" | "SELL";
  batchType: Exclude<SpotOrderType, "STOP" | "STOP_MARKET">;
  price?: string;
  /** Exact OpenAPI field name required by BatchParam.OrderParam. */
  client_order_id: string;
  quoteAmount?: string;
  baseQuantity?: string;
  marketPriceReference?: MarketPriceReference;
}

interface SpotBatchInput {
  symbol: string;
  requestedSymbol?: string;
  displaySymbol?: string;
  baseAsset?: string;
  quoteAsset?: string;
  displayBaseAsset?: string;
  displayQuoteAsset?: string;
  orders: BatchSpotOrder[];
}

interface PreparedSpotCancel extends SpotCancelOrderParams {
  requestedSymbol?: string;
  displaySymbol?: string;
}

interface PreparedSpotBatchCancel {
  symbol: string;
  requestedSymbol?: string;
  displaySymbol?: string;
  orderIds: string[];
}

interface SellAvailableOrder extends SemanticSpotOrder {
  requestedMode: "available_balance";
  baseAsset?: string;
  availableBaseQuantity?: string;
  executableBaseQuantity?: string;
  remainderBaseQuantity?: string;
}

const CANCEL_REQUEST_ACCEPTED = "CANCEL_REQUEST_ACCEPTED" as const;
const CANCEL_ACCEPTED_MESSAGE = "Cancellation request accepted. Query the order to confirm its final status.";
const BATCH_CANCEL_ACCEPTED_MESSAGE = "Cancellation requests accepted. Query the orders to confirm their final status.";

function responseRecord(result: unknown): Record<string, unknown> {
  return result !== null && typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown>
    : { upstreamResult: result };
}

function orderIdStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "bigint") return [String(entry)];
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const id = record.orderId ?? record.id;
      if (typeof id === "string" || typeof id === "number" || typeof id === "bigint") return [String(id)];
    }
    return [];
  });
}

function normalizeSingleCancelResult(result: unknown, input: PreparedSpotCancel): Record<string, unknown> {
  return {
    ...responseRecord(result),
    accepted: true,
    acceptedOrderIds: [input.orderId],
    failedOrderIds: [],
    resultMeaning: CANCEL_REQUEST_ACCEPTED,
    finalStatusConfirmed: false,
    message: CANCEL_ACCEPTED_MESSAGE
  };
}

function normalizeBatchCancelResult(result: unknown): Record<string, unknown> {
  const response = responseRecord(result);
  const acceptedOrderIds = orderIdStrings(response.successString ?? response.success);
  const failedOrderIds = orderIdStrings(response.failedString ?? response.failed);
  const accepted = acceptedOrderIds.length > 0;
  return {
    ...response,
    accepted,
    acceptedOrderIds,
    failedOrderIds,
    resultMeaning: accepted ? CANCEL_REQUEST_ACCEPTED : "CANCEL_REQUEST_NOT_ACCEPTED",
    finalStatusConfirmed: false,
    message: accepted
      ? BATCH_CANCEL_ACCEPTED_MESSAGE
      : "No cancellation request was accepted. Review failedOrderIds before taking another action."
  };
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

function orderType(value: Record<string, unknown>): SpotOrderType {
  const type = requiredString(value, "type").toUpperCase();
  if (!(ORDER_TYPES as readonly string[]).includes(type)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `type must be one of: ${ORDER_TYPES.join(", ")}.`);
  return type as SpotOrderType;
}

function clientOrderId(value: Record<string, unknown>): string {
  const supplied = optionalString(value, "newClientOrderId");
  if (supplied) return supplied;
  return `agent_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function optionalOrderFields(value: Record<string, unknown>): Pick<SpotPlaceOrderParams, "newClientOrderId" | "recvWindow"> {
  const recvWindow = optionalString(value, "recvWindow");
  return {
    newClientOrderId: clientOrderId(value),
    ...(recvWindow ? { recvWindow } : {})
  };
}

/** Converts an unambiguous Agent/CLI intent to the legacy OpenAPI volume field. */
function validateSemanticOrder(input: unknown): SemanticSpotOrder {
  const value = strictObject(input, ["symbol", "side", "type", "quoteAmount", "baseQuantity", "price", "triggerPrice", "newClientOrderId", "recvWindow"]);
  const side = orderSide(value);
  const type = orderType(value);
  const symbol = requiredString(value, "symbol");

  if (type === "MARKET" && side === "BUY") {
    if (value.baseQuantity !== undefined) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "MARKET BUY uses quoteAmount (the amount of quote asset to spend), not baseQuantity.");
    }
    if (value.price !== undefined || value.triggerPrice !== undefined) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price and triggerPrice are not allowed for MARKET orders.");
    }
    const quoteAmount = positiveDecimal(value, "quoteAmount");
    return { symbol, volume: quoteAmount, side, type, intent: "market_buy", quoteAmount, ...optionalOrderFields(value) };
  }

  if (type === "MARKET" && side === "SELL") {
    if (value.quoteAmount !== undefined) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "MARKET SELL uses baseQuantity (the amount of base asset to sell), not quoteAmount.");
    }
    if (value.price !== undefined || value.triggerPrice !== undefined) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price and triggerPrice are not allowed for MARKET orders.");
    }
    const baseQuantity = positiveDecimal(value, "baseQuantity");
    return { symbol, volume: baseQuantity, side, type, intent: "market_sell", baseQuantity, ...optionalOrderFields(value) };
  }

  if ((LIMIT_ORDER_TYPES as readonly string[]).includes(type)) {
    if (value.quoteAmount !== undefined || value.triggerPrice !== undefined) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${type} orders use baseQuantity and price; quoteAmount and triggerPrice are not allowed.`);
    }
    const baseQuantity = positiveDecimal(value, "baseQuantity");
    const price = positiveDecimal(value, "price");
    return { symbol, volume: baseQuantity, side, type, price, intent: "limit", baseQuantity, ...optionalOrderFields(value) };
  }

  const triggerPrice = positiveDecimal(value, "triggerPrice");
  if (type === "STOP") {
    if (value.quoteAmount !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "STOP orders use baseQuantity (the amount of base asset), not quoteAmount.");
    const baseQuantity = positiveDecimal(value, "baseQuantity");
    const price = positiveDecimal(value, "price");
    return { symbol, volume: baseQuantity, side, type, price, triggerPrice, intent: "stop_limit", baseQuantity, ...optionalOrderFields(value) };
  }

  if (type === "STOP_MARKET" && side === "BUY") {
    if (value.baseQuantity !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "STOP_MARKET BUY uses quoteAmount (the amount of quote asset to spend), not baseQuantity.");
    if (value.price !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is not allowed for STOP_MARKET orders.");
    const quoteAmount = positiveDecimal(value, "quoteAmount");
    return { symbol, volume: quoteAmount, side, type, triggerPrice, intent: "stop_market_buy", quoteAmount, ...optionalOrderFields(value) };
  }

  if (value.quoteAmount !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "STOP_MARKET SELL uses baseQuantity (the amount of base asset), not quoteAmount.");
  if (value.price !== undefined) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "price is not allowed for STOP_MARKET orders.");
  const baseQuantity = positiveDecimal(value, "baseQuantity");
  return { symbol, volume: baseQuantity, side, type, triggerPrice, intent: "stop_market_sell", baseQuantity, ...optionalOrderFields(value) };
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
    ...(order.triggerPrice ? { triggerPrice: order.triggerPrice } : {}),
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
  const value = strictObject(input, ["symbol", "side", "type", "baseQuantity", "price", "newClientOrderId", "recvWindow"]);
  const type = value.type === undefined ? "LIMIT" : orderType(value);
  if (!(LIMIT_ORDER_TYPES as readonly string[]).includes(type)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "limit supports type LIMIT, IOC, FOK, or POST_ONLY.");
  return validateSemanticOrder({ ...value, type });
}

function validateStopLimitOrder(input: unknown): SemanticSpotOrder {
  const value = strictObject(input, ["symbol", "side", "baseQuantity", "price", "triggerPrice", "newClientOrderId", "recvWindow"]);
  return validateSemanticOrder({ ...value, type: "STOP" });
}

function validateStopMarketBuy(input: unknown): SemanticSpotOrder {
  const value = strictObject(input, ["symbol", "quoteAmount", "triggerPrice", "newClientOrderId", "recvWindow"]);
  return validateSemanticOrder({ ...value, side: "BUY", type: "STOP_MARKET" });
}

function validateStopMarketSell(input: unknown): SemanticSpotOrder {
  const value = strictObject(input, ["symbol", "baseQuantity", "triggerPrice", "newClientOrderId", "recvWindow"]);
  return validateSemanticOrder({ ...value, side: "SELL", type: "STOP_MARKET" });
}

function validateCancelOrder(input: unknown): SpotCancelOrderParams {
  const value = strictObject(input, ["symbol", "orderId", "newClientOrderId"]);
  return { symbol: requiredString(value, "symbol"), orderId: requiredString(value, "orderId"), ...(optionalString(value, "newClientOrderId") ? { newClientOrderId: optionalString(value, "newClientOrderId") } : {}) };
}

function validateTestOrder(input: unknown): SemanticSpotOrder {
  return validateSemanticOrder(input);
}

function validateBatchOrders(input: unknown): SpotBatchInput {
  const value = strictObject(input, ["symbol", "orders"]);
  const symbol = requiredString(value, "symbol");
  const orders = value.orders;
  if (!Array.isArray(orders) || orders.length < 1 || orders.length > 10) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "orders must contain between 1 and 10 orders.");
  return { symbol, orders: orders.map((order, index) => {
    if (!order || typeof order !== "object" || Array.isArray(order)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `orders[${index}] must be an object.`);
    const semantic = validateSemanticOrder({ ...(order as Record<string, unknown>), symbol });
    if ((STOP_ORDER_TYPES as readonly string[]).includes(semantic.type)) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "batch-place does not support STOP or STOP_MARKET orders. Submit each conditional order separately.");
    }
    return {
      volume: semantic.volume,
      side: semantic.side,
      batchType: semantic.type as Exclude<SpotOrderType, "STOP" | "STOP_MARKET">,
      ...(semantic.price ? { price: semantic.price } : {}),
      client_order_id: semantic.newClientOrderId,
      ...(semantic.quoteAmount ? { quoteAmount: semantic.quoteAmount } : {}),
      ...(semantic.baseQuantity ? { baseQuantity: semantic.baseQuantity } : {})
    };
  }) };
}

function validateBatchCancel(input: unknown): Record<string, unknown> {
  const value = strictObject(input, ["symbol", "orderIds"]);
  if (!Array.isArray(value.orderIds) || value.orderIds.length < 1 || value.orderIds.length > 10 || value.orderIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "orderIds must contain between 1 and 10 non-empty order ID strings.");
  }
  return { symbol: requiredString(value, "symbol"), orderIds: value.orderIds.map((id) => (id as string).trim()) };
}

function isRecoverableTickerFailure(error: unknown): boolean {
  return error instanceof AiHubError && [
    "AI_HUB_OPENAPI_NETWORK_ERROR",
    "AI_HUB_OPENAPI_HTTP_ERROR",
    "AI_HUB_OPENAPI_INVALID_RESPONSE",
    "AI_HUB_OPENAPI_BUSINESS_ERROR"
  ].includes(error.code);
}

/** Reads one exact, uncached ticker for an immediate market-order preview. */
async function getLiveMarketPrice(context: Parameters<ToolSpec["handler"]>[1], apiSymbol: string): Promise<MarketPriceReference> {
  const ticker = summarizeLastPrice(await context.api.ticker({ symbol: apiSymbol }), apiSymbol);
  const price = String(ticker.last ?? "");
  if (!decimal.test(price) || !/[1-9]/.test(price.replace(".", ""))) {
    throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", `Ticker for ${apiSymbol} did not return a positive last price.`);
  }
  return {
    price,
    source: "LIVE_TICKER",
    quotedAt: new Date().toISOString(),
    ...(ticker.time ? { tickerTimestamp: String(ticker.time) } : {})
  };
}

async function tryGetLiveMarketPrice(context: Parameters<ToolSpec["handler"]>[1], apiSymbol: string): Promise<MarketPriceReference | undefined> {
  try {
    return await getLiveMarketPrice(context, apiSymbol);
  } catch (error) {
    // A ticker outage must not prevent a user from reviewing the rest of a
    // market-order request. Confirmation is still blocked if the price guard
    // cannot be evaluated immediately before submission.
    if (isRecoverableTickerFailure(error)) return undefined;
    throw error;
  }
}

function marketPriceFields(reference: MarketPriceReference | undefined): Record<string, unknown> {
  return reference
    ? { referencePrice: reference.price, priceSource: reference.source, quotedAt: reference.quotedAt, ...(reference.tickerTimestamp ? { tickerTimestamp: reference.tickerTimestamp } : {}) }
    : {};
}

function quoteAssetFields(order: Pick<SemanticSpotOrder, "quoteAsset" | "displayQuoteAsset"> | SpotBatchInput): Record<string, unknown> {
  return {
    asset: order.displayQuoteAsset ?? order.quoteAsset ?? null,
    apiAsset: order.quoteAsset ?? null
  };
}

function semanticEstimatedNotional(order: SemanticSpotOrder): Record<string, unknown> {
  const quoteAsset = quoteAssetFields(order);
  if (order.price && order.baseQuantity) {
    return { amount: multiplyDecimal(order.baseQuantity, order.price), ...quoteAsset, status: "DETERMINISTIC", basis: "BASE_QUANTITY_X_LIMIT_PRICE" };
  }
  if (order.quoteAmount) {
    return { amount: order.quoteAmount, ...quoteAsset, status: "DETERMINISTIC", basis: "EXACT_QUOTE_AMOUNT" };
  }
  if (order.intent === "market_sell" && order.marketPriceReference) {
    return { amount: multiplyDecimal(order.baseQuantity ?? order.volume, order.marketPriceReference.price), ...quoteAsset, status: "INDICATIVE", basis: "LIVE_TICKER", tickerPrice: order.marketPriceReference.price, quotedAt: order.marketPriceReference.quotedAt };
  }
  return { amount: null, ...quoteAsset, status: "UNAVAILABLE", basis: "MARKET_PRICE_UNAVAILABLE" };
}

function batchEstimatedNotional(order: BatchSpotOrder, batch: SpotBatchInput): Record<string, unknown> {
  const quoteAsset = quoteAssetFields(batch);
  if (order.price && order.baseQuantity) {
    return { amount: multiplyDecimal(order.baseQuantity, order.price), ...quoteAsset, status: "DETERMINISTIC", basis: "BASE_QUANTITY_X_LIMIT_PRICE" };
  }
  if (order.quoteAmount) {
    return { amount: order.quoteAmount, ...quoteAsset, status: "DETERMINISTIC", basis: "EXACT_QUOTE_AMOUNT" };
  }
  if (order.batchType === "MARKET" && order.side === "SELL" && order.marketPriceReference) {
    return { amount: multiplyDecimal(order.baseQuantity ?? order.volume, order.marketPriceReference.price), ...quoteAsset, status: "INDICATIVE", basis: "LIVE_TICKER", tickerPrice: order.marketPriceReference.price, quotedAt: order.marketPriceReference.quotedAt };
  }
  return { amount: null, ...quoteAsset, status: "UNAVAILABLE", basis: "MARKET_PRICE_UNAVAILABLE" };
}

function semanticOrderSummary(order: SemanticSpotOrder): Record<string, unknown> {
  const action = {
    market_buy: "market_buy",
    market_sell: "market_sell",
    limit: "limit_order",
    stop_limit: "stop_limit_order",
    stop_market_buy: "stop_market_buy",
    stop_market_sell: "stop_market_sell"
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
      : { mode: "MARKET", ...marketPriceFields(order.marketPriceReference), ...(order.triggerPrice ? { triggerPrice: order.triggerPrice } : {}) },
    estimatedNotional: semanticEstimatedNotional(order),
    newClientOrderId: order.newClientOrderId
  };
}

function batchOrderSummary(order: BatchSpotOrder, batch: SpotBatchInput): Record<string, unknown> {
  const quantityOrAmount = order.quoteAmount
    ? { value: order.quoteAmount, asset: batch.displayQuoteAsset ?? batch.quoteAsset ?? null, apiAsset: batch.quoteAsset ?? null, meaning: "exact quote-asset amount to spend" }
    : { value: order.baseQuantity ?? order.volume, asset: batch.displayBaseAsset ?? batch.baseAsset ?? null, apiAsset: batch.baseAsset ?? null, meaning: "exact base-asset quantity" };
  return {
    side: order.side,
    type: order.batchType,
    quantityOrAmount,
    priceOrMarket: order.price ? { mode: "LIMIT", price: order.price } : { mode: "MARKET", ...marketPriceFields(order.marketPriceReference) },
    estimatedNotional: batchEstimatedNotional(order, batch),
    client_order_id: order.client_order_id
  };
}

function batchNotionalTotals(orders: readonly BatchSpotOrder[], batch: SpotBatchInput): Record<string, unknown> {
  const sums: Record<"DETERMINISTIC" | "INDICATIVE", string | null> = { DETERMINISTIC: null, INDICATIVE: null };
  let unavailableCount = 0;
  for (const order of orders) {
    const notional = batchEstimatedNotional(order, batch);
    const status = notional.status as "DETERMINISTIC" | "INDICATIVE" | "UNAVAILABLE";
    const amount = notional.amount;
    if (status === "UNAVAILABLE" || typeof amount !== "string") {
      unavailableCount += 1;
      continue;
    }
    sums[status] = sums[status] === null ? amount : addNonNegativeDecimal(sums[status]!, amount);
  }
  const quoteAsset = quoteAssetFields(batch);
  return {
    deterministicTotalNotional: { amount: sums.DETERMINISTIC, ...quoteAsset, status: "DETERMINISTIC" },
    indicativeTotalNotional: { amount: sums.INDICATIVE, ...quoteAsset, status: "INDICATIVE" },
    unavailableCount
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
  const rule = await preflightSymbolOrder(context, order);
  const prepared: SemanticSpotOrder = {
    ...order,
    symbol: rule.symbol,
    requestedSymbol: order.symbol,
    displaySymbol: rule.displaySymbol ?? order.symbol,
    baseAsset: rule.baseAsset,
    quoteAsset: rule.quoteAsset,
    displayBaseAsset: rule.displayBaseAsset,
    displayQuoteAsset: rule.displayQuoteAsset
  };
  if (prepared.type === "MARKET") {
    const marketPriceReference = await tryGetLiveMarketPrice(context, prepared.symbol);
    return { ...prepared, ...(marketPriceReference ? { marketPriceReference } : {}) };
  }
  return prepared;
}

async function preflightSellAvailable(order: SellAvailableOrder, context: Parameters<NonNullable<ToolSpec<SellAvailableOrder>["preflight"]>>[1]): Promise<SellAvailableOrder> {
  const rule = await getSymbolRule(context, order.symbol);
  if (!rule.baseAsset) {
    throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", `Symbol "${rule.symbol}" did not include a base asset.`);
  }
  // The v1 overview retains a mixed-cloud tenant's physical asset code
  // (BTC1701 rather than a duplicated display BTC row), so sell-all checks
  // use the same authoritative balance source as account_list_balances.
  const balance = requireAvailableBalance(await context.api.accountOverview(signed(context)), rule.baseAsset);
  const executableBaseQuantity = floorDecimal(balance.available, rule.quantityPrecision ?? 0);
  if (executableBaseQuantity === "0") {
    throw new AiHubError("AI_HUB_INSUFFICIENT_AVAILABLE_BALANCE", `Available ${balance.asset} balance is below the executable quantity precision for ${rule.symbol}.`);
  }
  if (rule.marketSellMin && !isAtLeastDecimal(executableBaseQuantity, rule.marketSellMin)) {
    throw new AiHubError("AI_HUB_SYMBOL_MINIMUM_NOT_MET", `Available ${balance.asset} balance for ${rule.symbol} is below the minimum executable market-sell quantity of ${rule.marketSellMin}.`);
  }
  const prepared: SellAvailableOrder = {
    ...order,
    symbol: rule.symbol,
    requestedSymbol: order.symbol,
    displaySymbol: rule.displaySymbol ?? order.symbol,
    baseAsset: rule.baseAsset,
    quoteAsset: rule.quoteAsset,
    displayBaseAsset: rule.displayBaseAsset,
    displayQuoteAsset: rule.displayQuoteAsset,
    volume: executableBaseQuantity,
    baseQuantity: executableBaseQuantity,
    availableBaseQuantity: balance.available,
    executableBaseQuantity,
    remainderBaseQuantity: subtractNonNegativeDecimal(balance.available, executableBaseQuantity)
  };
  await preflightSymbolOrder(context, prepared);
  const marketPriceReference = await tryGetLiveMarketPrice(context, prepared.symbol);
  return { ...prepared, ...(marketPriceReference ? { marketPriceReference } : {}) };
}

async function preflightSpotBatch(input: SpotBatchInput, context: Parameters<NonNullable<ToolSpec["preflight"]>>[1]): Promise<SpotBatchInput> {
  const rule = await getSymbolRule(context, input.symbol);
  await Promise.all(input.orders.map((order) => preflightSymbolOrder(context, {
    symbol: rule.symbol,
    side: order.side,
    type: order.batchType,
    ...(order.batchType === "MARKET" && order.side === "BUY" ? { quoteAmount: order.volume } : { baseQuantity: order.volume }),
    ...(order.price ? { price: order.price } : {})
  })));
  const marketPriceReference = input.orders.some((order) => order.batchType === "MARKET")
    ? await tryGetLiveMarketPrice(context, rule.symbol)
    : undefined;
  return {
    ...input,
    symbol: rule.symbol,
    requestedSymbol: input.symbol,
    displaySymbol: rule.displaySymbol ?? input.symbol,
    baseAsset: rule.baseAsset,
    quoteAsset: rule.quoteAsset,
    displayBaseAsset: rule.displayBaseAsset,
    displayQuoteAsset: rule.displayQuoteAsset,
    orders: input.orders.map((order) => order.batchType === "MARKET" && marketPriceReference
      ? { ...order, marketPriceReference }
      : order)
  };
}

function toOpenApiBatch(input: SpotBatchInput): Record<string, unknown> {
  return {
    symbol: input.symbol,
    orders: input.orders.map(({ volume, side, batchType, price, client_order_id }) => ({
      volume,
      side,
      batchType,
      ...(price ? { price } : {}),
      client_order_id
    }))
  };
}

async function resolveSpotSymbol(context: Parameters<ToolSpec["handler"]>[1], symbol: string): Promise<string> {
  return (await getSymbolRule(context, symbol)).symbol;
}

async function preflightSpotCancel(order: SpotCancelOrderParams, context: Parameters<NonNullable<ToolSpec<SpotCancelOrderParams>["preflight"]>>[1]): Promise<PreparedSpotCancel> {
  const rule = await getSymbolRule(context, order.symbol);
  return {
    ...order,
    symbol: rule.symbol,
    requestedSymbol: order.symbol,
    displaySymbol: rule.displaySymbol ?? order.symbol
  };
}

async function preflightSpotBatchCancel(input: { symbol: string; orderIds: string[] }, context: Parameters<NonNullable<ToolSpec["preflight"]>>[1]): Promise<PreparedSpotBatchCancel> {
  const rule = await getSymbolRule(context, input.symbol);
  return {
    ...input,
    symbol: rule.symbol,
    requestedSymbol: input.symbol,
    displaySymbol: rule.displaySymbol ?? input.symbol
  };
}

function toOpenApiBatchCancel(input: PreparedSpotBatchCancel): Record<string, unknown> {
  return { symbol: input.symbol, orderIds: input.orderIds };
}

function toOpenApiSpotCancel(input: PreparedSpotCancel): SpotCancelOrderParams {
  return {
    symbol: input.symbol,
    orderId: input.orderId,
    ...(input.newClientOrderId ? { newClientOrderId: input.newClientOrderId } : {})
  };
}

async function assertMarketPriceProtection(order: Pick<SemanticSpotOrder, "symbol" | "side" | "type" | "marketPriceReference">, context: Parameters<ToolSpec["handler"]>[1]): Promise<void> {
  if (order.type !== "MARKET") return;
  if (!order.marketPriceReference) {
    throw new AiHubError("AI_HUB_MARKET_PRICE_CHECK_UNAVAILABLE", "A live ticker was unavailable during preview. Prepare the market order again after ticker data is available.");
  }
  let current: MarketPriceReference;
  try {
    current = await getLiveMarketPrice(context, order.symbol);
  } catch (error) {
    if (isRecoverableTickerFailure(error)) {
      throw new AiHubError("AI_HUB_MARKET_PRICE_CHECK_UNAVAILABLE", "Unable to refresh the live ticker before confirmation. The market order was not submitted; prepare it again.");
    }
    throw error;
  }
  if (exceedsUnfavourableDeviationBps(order.marketPriceReference.price, current.price, order.side, MARKET_PRICE_DEVIATION_BPS)) {
    const direction = order.side === "BUY" ? "increased" : "decreased";
    throw new AiHubError(
      "AI_HUB_MARKET_PRICE_MOVED",
      `Live price ${direction} from ${order.marketPriceReference.price} to ${current.price} by more than ${MARKET_PRICE_DEVIATION_BPS / 100}%. The market order was not submitted; prepare it again.`
    );
  }
}

async function confirmSpotMarketOrder(order: SemanticSpotOrder, context: Parameters<ToolSpec["handler"]>[1]): Promise<void> {
  await assertMarketPriceProtection(order, context);
}

async function confirmSpotBatch(input: SpotBatchInput, context: Parameters<ToolSpec["handler"]>[1]): Promise<void> {
  const immediateMarketOrders = input.orders.filter((order) => order.batchType === "MARKET");
  if (!immediateMarketOrders.length) return;
  if (immediateMarketOrders.some((order) => !order.marketPriceReference)) {
    throw new AiHubError("AI_HUB_MARKET_PRICE_CHECK_UNAVAILABLE", "A live ticker was unavailable during preview. Prepare the market-order batch again after ticker data is available.");
  }
  let current: MarketPriceReference;
  try {
    current = await getLiveMarketPrice(context, input.symbol);
  } catch (error) {
    if (isRecoverableTickerFailure(error)) {
      throw new AiHubError("AI_HUB_MARKET_PRICE_CHECK_UNAVAILABLE", "Unable to refresh the live ticker before confirmation. The market-order batch was not submitted; prepare it again.");
    }
    throw error;
  }
  for (const order of immediateMarketOrders) {
    const reference = order.marketPriceReference!;
    if (exceedsUnfavourableDeviationBps(reference.price, current.price, order.side, MARKET_PRICE_DEVIATION_BPS)) {
      const direction = order.side === "BUY" ? "increased" : "decreased";
      throw new AiHubError(
        "AI_HUB_MARKET_PRICE_MOVED",
        `Live price ${direction} from ${reference.price} to ${current.price} by more than ${MARKET_PRICE_DEVIATION_BPS / 100}%. The market-order batch was not submitted; prepare it again.`
      );
    }
  }
}

export const orderTools: ToolSpec<any>[] = [
  {
    name: "spot_test_order", title: "Test Spot Order", description: "Validate one spot order without sending it to the matching engine. LIMIT, IOC, FOK, and POST_ONLY use baseQuantity plus price. STOP additionally requires triggerPrice. STOP_MARKET additionally requires triggerPrice and uses quoteAmount for BUY or baseQuantity for SELL.", cliPath: ["spot", "order", "test"],
    module: "spot-order", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, type: { type: "string", enum: ORDER_TYPES }, quoteAmount: { type: "string", description: "Required for MARKET BUY and STOP_MARKET BUY: exact quote-asset amount to spend." }, baseQuantity: { type: "string", description: "Required for MARKET SELL, LIMIT, IOC, FOK, POST_ONLY, STOP, and STOP_MARKET SELL: exact base-asset quantity." }, price: { type: "string", description: "Required for LIMIT, IOC, FOK, POST_ONLY, and STOP. Not allowed for MARKET or STOP_MARKET." }, triggerPrice: { type: "string", description: "Required trigger price for STOP and STOP_MARKET." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "side", "type"], additionalProperties: false }, errorCodes: orderValidationErrors,
    validate: validateTestOrder,
    handler: async (input, context) => {
      const order = input as SemanticSpotOrder;
      const rule = await preflightSymbolOrder(context, order);
      return context.api.signedPost("/sapi/v2/order/test", { ...toOpenApiOrder({ ...order, symbol: rule.symbol }) }, signed(context));
    }
  },
  {
    name: "spot_get_order", title: "Get Spot Order", description: "Get one signed spot order by symbol and order ID.", cliPath: ["spot", "order", "get"],
    module: "spot-order", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orderId: { type: "string" }, newClientOrderId: { type: "string" } }, required: ["symbol", "orderId"], additionalProperties: false }, errorCodes: signedReadErrors,
    validate: (input) => { const value = strictObject(input, ["symbol", "orderId", "newClientOrderId"]); return { symbol: requiredString(value, "symbol"), orderId: requiredString(value, "orderId"), newClientOrderId: optionalString(value, "newClientOrderId") }; },
    handler: async (input, context) => {
      const order = input as { symbol: string; orderId: string; newClientOrderId?: string };
      return context.api.getOrder({ ...order, symbol: await resolveSpotSymbol(context, order.symbol) }, signed(context));
    }
  },
  {
    name: "spot_batch_place_orders", title: "Batch Place Spot Orders", description: "Create up to 10 spot orders after confirmation. Each MARKET BUY item requires quoteAmount; MARKET SELL, LIMIT, IOC, FOK, and POST_ONLY items require baseQuantity; non-market items also require price. STOP and STOP_MARKET are not supported in batch placement.", cliPath: ["spot", "order", "batch-place"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orders: { type: "array", minItems: 1, maxItems: 10, description: "Each item is an order object. MARKET BUY uses quoteAmount; MARKET SELL/LIMIT/IOC/FOK/POST_ONLY use baseQuantity; non-market types also require price. STOP and STOP_MARKET are rejected.", items: { type: "object", properties: { side: { type: "string", enum: ["BUY", "SELL"] }, type: { type: "string", enum: ["MARKET", "LIMIT", "IOC", "FOK", "POST_ONLY"] }, quoteAmount: { type: "string" }, baseQuantity: { type: "string" }, price: { type: "string" }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["side", "type"], additionalProperties: false } } }, required: ["symbol", "orders"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateBatchOrders,
    preflight: preflightSpotBatch,
    confirmPreflight: confirmSpotBatch,
    handler: (input, context) => context.api.signedPost("/sapi/v2/batchOrders", toOpenApiBatch(input as SpotBatchInput), signed(context)),
    writeSummary: (input) => {
      const value = input as SpotBatchInput;
      return {
        action: "batch_place_orders",
        symbol: value.displaySymbol ?? value.requestedSymbol ?? value.symbol,
        apiSymbol: value.symbol,
        side: null,
        type: "BATCH",
        quantityOrAmount: null,
        priceOrMarket: { mode: "MULTIPLE" },
        estimatedNotional: { amount: null, status: "UNAVAILABLE", basis: "MULTIPLE_ORDERS" },
        orderCount: value.orders.length,
        orders: value.orders.map((order) => batchOrderSummary(order, value)),
        notionalTotals: batchNotionalTotals(value.orders, value)
      };
    }
  },
  {
    name: "spot_batch_cancel_orders", title: "Batch Cancel Spot Orders", description: "Submit cancellation requests for up to 10 spot orders after confirmation. A successful response means the requests were accepted, not that final cancellation is complete.", cliPath: ["spot", "order", "batch-cancel"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orderIds: { type: "array" } }, required: ["symbol", "orderIds"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateBatchCancel,
    preflight: preflightSpotBatchCancel,
    handler: (input, context) => context.api.signedPost("/sapi/v2/batchCancel", toOpenApiBatchCancel(input as PreparedSpotBatchCancel), signed(context)),
    normalizeResult: (result) => normalizeBatchCancelResult(result),
    writeSummary: (input) => {
      const value = input as PreparedSpotBatchCancel;
      return { action: "batch_cancel_orders", symbol: value.displaySymbol ?? value.requestedSymbol ?? value.symbol, apiSymbol: value.symbol, orderIds: value.orderIds };
    }
  },
  {
    name: "spot_get_open_orders", title: "Get Spot Open Orders", description: "Get current signed spot orders.", cliPath: ["spot", "order", "open"],
    module: "spot-order", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: listLimitSchema(STANDARD_LIST_LIMIT) }, additionalProperties: false }, errorCodes: signedReadErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => { const value = strictObject(input, ["symbol", "limit"]); return { symbol: optionalString(value, "symbol"), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT) }; },
    handler: async (input, context) => {
      const query = input as { symbol?: string; limit?: number };
      return context.api.getOpenOrders({ ...query, ...(query.symbol ? { symbol: await resolveSpotSymbol(context, query.symbol) } : {}) }, signed(context));
    }
  },
  {
    name: "spot_get_history_orders", title: "Get Spot Order History", description: "Get bounded signed spot order history, including completed and cancelled orders.", cliPath: ["spot", "order", "history"],
    module: "spot-order", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string", minLength: 1 }, page: { type: "integer", minimum: 1 }, limit: listLimitSchema(STANDARD_LIST_LIMIT), startTime: { type: "integer", minimum: 0 }, endTime: { type: "integer", minimum: 0 } }, required: ["symbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => {
      const value = strictObject(input, ["symbol", "page", "limit", "startTime", "endTime"]);
      const startTime = value.startTime === undefined ? undefined : optionalInteger(value, "startTime", 0, 0, Number.MAX_SAFE_INTEGER);
      const endTime = value.endTime === undefined ? undefined : optionalInteger(value, "endTime", 0, 0, Number.MAX_SAFE_INTEGER);
      if (startTime !== undefined && endTime !== undefined && startTime > endTime) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "startTime cannot be after endTime.");
      return { symbol: requiredString(value, "symbol"), page: optionalInteger(value, "page", 1, 1, Number.MAX_SAFE_INTEGER), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT), startTime, endTime };
    },
    handler: async (input, context) => {
      const query = input as { symbol: string; page?: number; limit?: number; startTime?: number; endTime?: number };
      return context.api.getHistoryOrders({ ...query, symbol: await resolveSpotSymbol(context, query.symbol) }, signed(context));
    }
  },
  {
    name: "spot_get_fills", title: "Get Spot Fills", description: "Get signed spot fills for one symbol.", cliPath: ["spot", "order", "fills"],
    module: "spot-order", access: "signed", operation: "read", riskLevel: "low",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: listLimitSchema(STANDARD_LIST_LIMIT), fromId: { type: "string" } }, required: ["symbol"], additionalProperties: false }, errorCodes: signedReadErrors,
    listLimit: STANDARD_LIST_LIMIT,
    validate: (input) => { const value = strictObject(input, ["symbol", "limit", "fromId"]); return { symbol: requiredString(value, "symbol"), limit: normalizedListLimit(value, STANDARD_LIST_LIMIT), fromId: optionalString(value, "fromId") }; },
    handler: async (input, context) => {
      const query = input as { symbol: string; limit?: number; fromId?: string };
      return context.api.getMyTrades({ ...query, symbol: await resolveSpotSymbol(context, query.symbol) }, signed(context));
    }
  },
  {
    name: "spot_market_buy", title: "Market Buy by Quote Amount", description: "Spend an exact quote-asset amount to buy at market. For ETHUSDT, quoteAmount is USDT. Do not use this tool to request a base-asset quantity such as 1 ETH; market execution cannot guarantee an exact base quantity.", cliPath: ["spot", "order", "market-buy"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, quoteAmount: { type: "string", description: "Required exact quote-asset amount to spend, e.g. 100 means spend 100 USDT for ETHUSDT." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "quoteAmount"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateMarketBuy,
    preflight: preflightSpotOrder,
    confirmPreflight: confirmSpotMarketOrder,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SemanticSpotOrder), signed(context)),
    writeSummary: (input) => semanticOrderSummary(input as SemanticSpotOrder)
  },
  {
    name: "spot_market_sell", title: "Market Sell by Base Quantity", description: "Sell an exact base-asset quantity at market. For ETHUSDT, baseQuantity is ETH.", cliPath: ["spot", "order", "market-sell"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, baseQuantity: { type: "string", description: "Required exact base-asset quantity to sell, e.g. 0.5 means sell 0.5 ETH for ETHUSDT." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "baseQuantity"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateMarketSell,
    preflight: preflightSpotOrder,
    confirmPreflight: confirmSpotMarketOrder,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SemanticSpotOrder), signed(context)),
    writeSummary: (input) => semanticOrderSummary(input as SemanticSpotOrder)
  },
  {
    name: "spot_sell_available", title: "Prepare Market Sell of Available Balance", description: "Prepare a market SELL of the maximum available base-asset balance for one symbol. It reads the signed balance, floors only to the configured quantity precision, shows the executable amount and remainder, and still requires separate confirmation.", cliPath: ["spot", "order", "sell-available"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string", description: "Spot symbol, for example ETHUSDT." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateSellAvailable,
    preflight: preflightSellAvailable,
    confirmPreflight: confirmSpotMarketOrder,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SellAvailableOrder), signed(context)),
    writeSummary: (input) => sellAvailableSummary(input as SellAvailableOrder)
  },
  {
    name: "spot_limit_order", title: "Place Limit-Style Spot Order", description: "Place a LIMIT, IOC, FOK, or POST_ONLY BUY or SELL using an exact base-asset quantity and a limit price. type defaults to LIMIT.", cliPath: ["spot", "order", "limit"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, type: { type: "string", enum: LIMIT_ORDER_TYPES, description: "OpenAPI order type. Defaults to LIMIT; use IOC, FOK, or POST_ONLY directly instead of timeInForce." }, baseQuantity: { type: "string", description: "Required exact base-asset quantity." }, price: { type: "string", description: "Required limit price in the quote asset." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "side", "baseQuantity", "price"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateLimitOrder,
    preflight: preflightSpotOrder,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SemanticSpotOrder), signed(context)),
    writeSummary: (input) => semanticOrderSummary(input as SemanticSpotOrder)
  },
  {
    name: "spot_stop_limit_order", title: "Place Stop-Limit Spot Order", description: "Place a STOP BUY or SELL using an exact base-asset quantity, a limit price, and a trigger price.", cliPath: ["spot", "order", "stop-limit"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, side: { type: "string", enum: ["BUY", "SELL"] }, baseQuantity: { type: "string", description: "Required exact base-asset quantity." }, price: { type: "string", description: "Required execution limit price in the quote asset." }, triggerPrice: { type: "string", description: "Required stop trigger price in the quote asset." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "side", "baseQuantity", "price", "triggerPrice"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateStopLimitOrder,
    preflight: preflightSpotOrder,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SemanticSpotOrder), signed(context)),
    writeSummary: (input) => semanticOrderSummary(input as SemanticSpotOrder)
  },
  {
    name: "spot_stop_market_buy", title: "Place Stop-Market Buy", description: "Place a STOP_MARKET BUY that spends an exact quote-asset amount after the trigger price is reached.", cliPath: ["spot", "order", "stop-market-buy"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, quoteAmount: { type: "string", description: "Required exact quote-asset amount to spend after triggering." }, triggerPrice: { type: "string", description: "Required stop trigger price in the quote asset." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "quoteAmount", "triggerPrice"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateStopMarketBuy,
    preflight: preflightSpotOrder,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SemanticSpotOrder), signed(context)),
    writeSummary: (input) => semanticOrderSummary(input as SemanticSpotOrder)
  },
  {
    name: "spot_stop_market_sell", title: "Place Stop-Market Sell", description: "Place a STOP_MARKET SELL for an exact base-asset quantity after the trigger price is reached.", cliPath: ["spot", "order", "stop-market-sell"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, baseQuantity: { type: "string", description: "Required exact base-asset quantity to sell after triggering." }, triggerPrice: { type: "string", description: "Required stop trigger price in the quote asset." }, newClientOrderId: { type: "string" }, recvWindow: { type: "string" } }, required: ["symbol", "baseQuantity", "triggerPrice"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateStopMarketSell,
    preflight: preflightSpotOrder,
    handler: (input, context) => context.api.placeOrder(toOpenApiOrder(input as SemanticSpotOrder), signed(context)),
    writeSummary: (input) => semanticOrderSummary(input as SemanticSpotOrder)
  },
  {
    name: "spot_cancel_order", title: "Cancel Spot Order", description: "Submit one spot-order cancellation request after confirmation. A successful response means the request was accepted, not that final cancellation is complete.", cliPath: ["spot", "order", "cancel"],
    module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, orderId: { type: "string" }, newClientOrderId: { type: "string" } }, required: ["symbol", "orderId"], additionalProperties: false }, errorCodes: writeErrors,
    validate: validateCancelOrder,
    preflight: preflightSpotCancel,
    handler: (input, context) => context.api.cancelOrder(toOpenApiSpotCancel(input as PreparedSpotCancel), signed(context)),
    normalizeResult: (result, input) => normalizeSingleCancelResult(result, input as PreparedSpotCancel),
    writeSummary: (input) => {
      const value = input as PreparedSpotCancel;
      return { action: "cancel_order", symbol: value.displaySymbol ?? value.requestedSymbol ?? value.symbol, apiSymbol: value.symbol, orderId: value.orderId, newClientOrderId: value.newClientOrderId ?? null };
    }
  }
];
