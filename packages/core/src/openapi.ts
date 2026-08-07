import { createHmac } from "node:crypto";
import { AiHubError, OpenApiBusinessError } from "./errors.js";
import { diagnoseOpenApiBusinessError, isOpenApiSuccessCode } from "./openapi-error-catalog.js";
import type { ApiCredentials } from "./credential.js";
import { AI_HUB_USER_AGENT } from "./release.js";

export type QueryValue = string | number | boolean | undefined;

export interface SpotKlinesParams {
  symbol: string;
  interval: string;
  startTime?: number;
  endTime?: number;
  timezone?: string;
  limit?: number;
}

/** Supported single spot-order types exposed by the v2 OpenAPI. */
export type SpotOrderType = "LIMIT" | "MARKET" | "IOC" | "FOK" | "POST_ONLY" | "STOP" | "STOP_MARKET";

export interface SpotPlaceOrderParams {
  symbol: string;
  volume: string;
  side: "BUY" | "SELL";
  type: SpotOrderType;
  price?: string;
  /** Required for STOP and STOP_MARKET orders. */
  triggerPrice?: string;
  newClientOrderId: string;
  recvWindow?: string;
}

export interface SpotCancelOrderParams {
  symbol: string;
  orderId: string;
  newClientOrderId?: string;
}

export interface ApiClientOptions {
  timeoutMs?: number;
  userAgent?: string;
  /** Local-only observer for elapsed OpenAPI time. It receives no request or response data. */
  onRequestTiming?: (elapsedMs: number) => void;
}

function parseJsonPreservingLargeIntegers<T>(raw: string): T {
  let transformed = "";
  let inString = false;
  let escaping = false;
  let index = 0;
  while (index < raw.length) {
    const character = raw[index] ?? "";
    if (inString) {
      transformed += character;
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === "\"") inString = false;
      index += 1;
      continue;
    }
    if (character === "\"") {
      inString = true;
      transformed += character;
      index += 1;
      continue;
    }
    if (character !== "-" && (character < "0" || character > "9")) {
      transformed += character;
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < raw.length && /[0-9eE+.\-]/.test(raw[end] ?? "")) end += 1;
    const token = raw.slice(index, end);
    const absolute = token.startsWith("-") ? token.slice(1) : token;
    if (/^\d+$/.test(token) && (absolute.length > 15 || Number(absolute) > Number.MAX_SAFE_INTEGER)) {
      transformed += `"${token}"`;
    } else {
      transformed += token;
    }
    index = end;
  }
  return normalizeOpenApiMonetaryValues(JSON.parse(transformed)) as T;
}

const MONETARY_FIELD_NAMES = new Set([
  "amount", "available", "avgPrice", "balance", "baseQuantity", "borrow", "close", "dealMoney", "dealVolume",
  "executedMoney", "executedQty", "fee", "free", "freeze", "high", "interest", "last", "locked", "low",
  "makerFee", "normal", "open", "origQty", "price", "qty", "quantity", "quoteAmount", "stopPrice", "takerFee",
  "triggerPrice", "vol", "volume"
]);
const ORDER_BOOK_FIELD_NAMES = new Set(["asks", "bids"]);

/**
 * Keeps prices, quantities, balances, and fees exact at the OpenAPI boundary.
 * Identifier, count, status, and timestamp fields intentionally retain their
 * original types; only documented monetary field names and depth levels change.
 */
function normalizeOpenApiMonetaryValues(value: unknown, fieldName?: string): unknown {
  if (typeof value === "number") {
    return fieldName && MONETARY_FIELD_NAMES.has(fieldName) && Number.isFinite(value) ? String(value) : value;
  }
  if (Array.isArray(value)) {
    if (fieldName && ORDER_BOOK_FIELD_NAMES.has(fieldName)) {
      return value.map((level) => Array.isArray(level)
        ? level.map((entry, index) => index < 2 && typeof entry === "number" && Number.isFinite(entry) ? String(entry) : normalizeOpenApiMonetaryValues(entry))
        : normalizeOpenApiMonetaryValues(level));
    }
    return value.map((entry) => normalizeOpenApiMonetaryValues(entry));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalizeOpenApiMonetaryValues(entry, key)]));
}

function queryString(values: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) params.append(name, String(value));
  }
  return params.toString();
}

function joinUrl(baseUrl: string, path: string, query?: string): string {
  if (!path.startsWith("/")) throw new AiHubError("AI_HUB_INVALID_PATH", "OpenAPI paths must start with '/'.");
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  return query ? `${url}?${query}` : url;
}

export function signRequest(timestamp: string, method: string, path: string, secretKey: string, query?: string, body?: string): string {
  const payload = `${timestamp}${method.toUpperCase()}${path}${query ? `?${query}` : ""}${body ?? ""}`;
  return createHmac("sha256", secretKey).update(payload).digest("hex");
}

/** Local REST adapter for the tenant's spot OpenAPI. */
export class AiHubSpotApi {
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly onRequestTiming: ((elapsedMs: number) => void) | undefined;

  public constructor(private readonly baseUrl: string, options: ApiClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? AI_HUB_USER_AGENT;
    this.onRequestTiming = options.onRequestTiming;
  }

  public time(): Promise<unknown> {
    return this.request("GET", "/sapi/v2/time");
  }

  public ping(): Promise<unknown> {
    return this.request("GET", "/sapi/v2/ping");
  }

  public symbols(): Promise<unknown> {
    return this.request("GET", "/sapi/v2/symbols");
  }

  public ticker(params: { symbol?: string; symbols?: string; timeZone?: string } = {}): Promise<unknown> {
    return this.request("GET", "/sapi/v2/ticker", { timeZone: params.timeZone ?? "UTC+08", symbol: params.symbol, symbols: params.symbols });
  }

  public depth(symbol: string, limit = 20): Promise<unknown> {
    return this.request("GET", "/sapi/v2/depth", { symbol, limit });
  }

  public trades(symbol: string, limit = 100): Promise<unknown> {
    return this.request("GET", "/sapi/v2/trades", { symbol, limit });
  }

  public klines(params: SpotKlinesParams): Promise<unknown> {
    return this.request("GET", "/sapi/v2/klines", {
      symbol: params.symbol,
      interval: params.interval,
      startTime: params.startTime,
      endTime: params.endTime,
      timezone: params.timezone ?? "UTC+08",
      limit: params.limit ?? 100
    });
  }

  public account(credentials: ApiCredentials): Promise<unknown> {
    return this.request("GET", "/sapi/v2/account", {}, undefined, credentials);
  }

  /** Legacy v1 account payload is used for a full balance overview. */
  public accountOverview(credentials: ApiCredentials): Promise<unknown> {
    return this.request("GET", "/sapi/v1/account", {}, undefined, credentials);
  }

  public getOrder(params: { symbol: string; orderId: string; newClientOrderId?: string }, credentials: ApiCredentials): Promise<unknown> {
    return this.request("GET", "/sapi/v2/order", params, undefined, credentials);
  }

  public getOpenOrders(params: { symbol?: string; limit?: number }, credentials: ApiCredentials): Promise<unknown> {
    return this.request("GET", "/sapi/v2/openOrders", params, undefined, credentials);
  }

  public getHistoryOrders(
    params: { symbol: string; page?: number; limit?: number; startTime?: number; endTime?: number },
    credentials: ApiCredentials
  ): Promise<unknown> {
    return this.request("GET", "/sapi/v2/historyOrders", params, undefined, credentials);
  }

  /** Historical one-minute candles are served by a separate v2 endpoint. */
  public historicalMinuteKlines(params: { symbol: string; startTime?: number; endTime?: number }): Promise<unknown> {
    return this.request("GET", "/sapi/v2/klines_1min", params);
  }

  public getMyTrades(params: { symbol: string; limit?: number; fromId?: string }, credentials: ApiCredentials): Promise<unknown> {
    return this.request("GET", "/sapi/v2/myTrades", params, undefined, credentials);
  }

  public placeOrder(params: SpotPlaceOrderParams, credentials: ApiCredentials): Promise<unknown> {
    const body: Record<string, unknown> = {
      symbol: params.symbol,
      volume: params.volume,
      side: params.side,
      type: params.type,
      newClientOrderId: params.newClientOrderId
    };
    if (params.price) body.price = params.price;
    if (params.triggerPrice) body.triggerPrice = params.triggerPrice;
    if (params.recvWindow) body.recvWindow = params.recvWindow;
    return this.request("POST", "/sapi/v2/order", {}, body, credentials);
  }

  public cancelOrder(params: SpotCancelOrderParams, credentials: ApiCredentials): Promise<unknown> {
    const body: Record<string, unknown> = { symbol: params.symbol, orderId: params.orderId };
    if (params.newClientOrderId) body.newClientOrderId = params.newClientOrderId;
    return this.request("POST", "/sapi/v2/cancel", {}, body, credentials);
  }

  /**
   * Signed endpoint adapter for Tool Registry entries whose OpenAPI payload is
   * defined by the API document. Keep endpoint selection in the individual Tool
   * definition; never expose this method directly through CLI or MCP.
   */
  public signedGet(path: string, query: Record<string, QueryValue>, credentials: ApiCredentials): Promise<unknown> {
    return this.request("GET", path, query, undefined, credentials);
  }

  public signedPost(path: string, body: Record<string, unknown>, credentials: ApiCredentials): Promise<unknown> {
    return this.request("POST", path, {}, body, credentials);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    query: Record<string, QueryValue> = {},
    body?: Record<string, unknown>,
    credentials?: ApiCredentials
  ): Promise<unknown> {
    const startedAt = performance.now();
    try {
      const encodedQuery = queryString(query);
      const bodyString = body ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = {
        accept: "application/json",
        "admin-language": "en_US",
        "user-agent": this.userAgent
      };
      if (bodyString) headers["content-type"] = "application/json";
      if (credentials) {
        const timestamp = Date.now().toString();
        headers["X-CH-APIKEY"] = credentials.apiKey;
        headers["X-CH-TS"] = timestamp;
        headers["X-CH-SIGN"] = signRequest(timestamp, method, path, credentials.secretKey, encodedQuery || undefined, bodyString);
      }

      let response: Response;
      try {
        response = await fetch(joinUrl(this.baseUrl, path, encodedQuery), {
          method,
          headers,
          body: bodyString,
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch (error) {
        throw new AiHubError("AI_HUB_OPENAPI_NETWORK_ERROR", error instanceof Error ? error.message : "OpenAPI request failed.");
      }
      const raw = await response.text();
      if (response.status >= 300 && response.status < 400) {
        throw new AiHubError("AI_HUB_OPENAPI_REDIRECT_REJECTED", "OpenAPI returned a redirect, which is rejected for profile safety.");
      }
      if (!response.ok) {
        throw new AiHubError("AI_HUB_OPENAPI_HTTP_ERROR", `OpenAPI returned HTTP ${response.status}.`);
      }
      try {
        const parsed = parseJsonPreservingLargeIntegers<unknown>(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const payload = parsed as Record<string, unknown>;
          if (Object.hasOwn(payload, "code") && !isOpenApiSuccessCode(payload.code)) {
            const upstreamCode = typeof payload.code === "string" || typeof payload.code === "number" ? payload.code : String(payload.code);
            const upstreamMessage = typeof payload.msg === "string" ? payload.msg : "OpenAPI returned a business failure without a message.";
            throw new OpenApiBusinessError(diagnoseOpenApiBusinessError(path, upstreamCode, upstreamMessage));
          }
        }
        return parsed;
      } catch (error) {
        if (error instanceof OpenApiBusinessError) throw error;
        throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "OpenAPI returned a non-JSON response.");
      }
    } finally {
      this.onRequestTiming?.(performance.now() - startedAt);
    }
  }
}
