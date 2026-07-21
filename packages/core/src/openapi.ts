import { createHmac } from "node:crypto";
import { AiHubError } from "./errors.js";
import type { ApiCredentials } from "./credential.js";

export type QueryValue = string | number | boolean | undefined;

export interface SpotKlinesParams {
  symbol: string;
  interval: string;
  startTime?: number;
  endTime?: number;
  timezone?: string;
  limit?: number;
}

export interface ApiClientOptions {
  timeoutMs?: number;
  userAgent?: string;
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
  return JSON.parse(transformed) as T;
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

  public constructor(private readonly baseUrl: string, options: ApiClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? "ai-hub-agent-trade/0.1.0";
  }

  public time(): Promise<unknown> {
    return this.request("GET", "/sapi/v2/time");
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

  private async request(
    method: "GET" | "POST",
    path: string,
    query: Record<string, QueryValue> = {},
    body?: Record<string, unknown>,
    credentials?: ApiCredentials
  ): Promise<unknown> {
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
      return parseJsonPreservingLargeIntegers<unknown>(raw);
    } catch {
      throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "OpenAPI returned a non-JSON response.");
    }
  }
}
