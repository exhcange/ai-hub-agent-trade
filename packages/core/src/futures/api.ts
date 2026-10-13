import type { ApiCredentials } from "../credential.js";
import { AiHubError } from "../errors.js";
import { signRequest, type ApiClientOptions } from "../openapi.js";
import { AI_HUB_USER_AGENT } from "../release.js";
import { fileRequestScheduler, parseLosslessJson, type RequestScheduler } from "./transport.js";
import { futuresBusinessError } from "./error-catalog.js";

export const FUTURES_ENDPOINTS = {
  ping: ["GET", "public", "read"], time: ["GET", "public", "read"], contracts: ["GET", "public", "read"],
  depth: ["GET", "public", "read"], ticker: ["GET", "public", "read"], index: ["GET", "public", "read"], klines: ["GET", "public", "read"],
  account: ["GET", "signed", "read"], orderDetail: ["GET", "signed", "read", "order"], openOrders: ["GET", "signed", "read"],
  orderHistorical: ["POST", "signed", "read"], profitHistorical: ["POST", "signed", "read"], myTrades: ["GET", "signed", "read"],
  get_user_transaction: ["POST", "signed", "read"], trigger_order_list: ["POST", "signed", "read"],
  order: ["POST", "signed", "write"], conditionOrder: ["POST", "signed", "write"], profitLossOrder: ["POST", "signed", "write"],
  cancel: ["POST", "signed", "write"], cancel_all: ["POST", "signed", "write"], cancel_trigger_order: ["POST", "signed", "write"],
  edit_user_position_model: ["POST", "signed", "write"], edit_user_margin_model: ["POST", "signed", "write"],
  edit_position_margin: ["POST", "signed", "write"], edit_lever: ["POST", "signed", "write"]
} as const;
export type FuturesEndpoint = keyof typeof FUTURES_ENDPOINTS;
const VERSIONED = new Set<FuturesEndpoint>(["order", "conditionOrder", "profitLossOrder", "cancel_trigger_order", "trigger_order_list"]);
export function futuresContract(endpoint: FuturesEndpoint) {
  const spec = FUTURES_ENDPOINTS[endpoint];
  return { method: spec[0], path: `/fapi/v1/${endpoint === "orderDetail" ? "order" : endpoint}`, authentication: spec[1] };
}
export interface FuturesApiOptions extends ApiClientOptions {
  fetch?: typeof fetch;
  scheduler?: RequestScheduler;
}
export class AiHubFuturesApi {
  private readonly schedule: RequestScheduler;
  private readonly fetcher: typeof fetch;
  public constructor(private readonly baseUrl: string, private readonly options: FuturesApiOptions = {}) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new AiHubError("AI_HUB_INVALID_OPENAPI_URL", "A validated HTTPS profile endpoint is required.");
    this.schedule = options.scheduler ?? fileRequestScheduler();
    this.fetcher = options.fetch ?? fetch;
  }
  public async request(endpoint: FuturesEndpoint, input: Record<string, unknown> = {}, credentials?: ApiCredentials, confirmationDeadline?: number): Promise<unknown> {
    const contract = futuresContract(endpoint), write = FUTURES_ENDPOINTS[endpoint][2] === "write";
    if (contract.authentication === "signed" && !credentials) throw new AiHubError("AI_HUB_CREDENTIAL_NOT_CONFIGURED", "This operation requires profile credentials.");
    const query = contract.method === "GET" ? new URLSearchParams(Object.entries(input).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : "";
    const body = contract.method === "POST" ? JSON.stringify(input) : undefined;
    const deadline = Math.min(Date.now() + 30_000, write ? confirmationDeadline ?? Infinity : Infinity);
    const started = performance.now();
    try {
      for (let attempt = 0; ; attempt++) {
        let dispatched = false;
        try {
          const response = await this.schedule(`${this.baseUrl}|${contract.method}|${contract.path}`, deadline, async () => {
            if (write && Date.now() >= deadline) throw new AiHubError("AI_HUB_CONFIRMATION_EXPIRED", "Confirmation expired before dispatch.");
            const headers: Record<string, string> = { accept: "application/json", "admin-language": "en_US", "user-agent": this.options.userAgent ?? AI_HUB_USER_AGENT };
            if (body !== undefined) headers["content-type"] = "application/json";
            if (VERSIONED.has(endpoint)) headers["futures-version"] = "101";
            if (contract.authentication === "signed" && credentials) {
              const timestamp = String(Date.now());
              headers["X-CH-APIKEY"] = credentials.apiKey;
              headers["X-CH-TS"] = timestamp;
              headers["X-CH-SIGN"] = signRequest(timestamp, contract.method, contract.path, credentials.secretKey, query || undefined, body);
            }
            dispatched = true;
            const response = await this.fetcher(`${this.baseUrl.replace(/\/+$/, "")}${contract.path}${query ? `?${query}` : ""}`, {
              method: contract.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(Math.max(1, Math.min(this.options.timeoutMs ?? 10_000, deadline - Date.now())))
            });
            // Read the body inside the timeout-protected dispatch and coordination scope.
            return { status: response.status, ok: response.ok, retryAfter: response.headers.get("retry-after"), raw: await response.text() };
          });
          if (!response.ok) {
            if (!write && attempt === 0 && [429, 502, 503, 504].includes(response.status)) {
              const delay = response.retryAfter ? (/^\d+$/.test(response.retryAfter) ? Number(response.retryAfter) * 1000 : Date.parse(response.retryAfter) - Date.now()) : 1000;
              if (Number.isFinite(delay) && Date.now() + Math.max(1000, delay) < deadline) {
                await new Promise((resolve) => setTimeout(resolve, Math.max(1000, delay))); continue;
              }
            }
            throw new AiHubError(write ? "AI_HUB_WRITE_RESULT_UNKNOWN" : "AI_HUB_OPENAPI_HTTP_ERROR", `OpenAPI returned HTTP ${response.status}.`, { writeOutcomeUnknown: write });
          }
          let parsed: unknown;
          try { parsed = parseLosslessJson(response.raw); }
          catch { throw new AiHubError(write ? "AI_HUB_WRITE_RESULT_UNKNOWN" : "AI_HUB_OPENAPI_INVALID_RESPONSE", "OpenAPI returned invalid JSON.", { writeOutcomeUnknown: write }); }
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.hasOwn(parsed, "code")) {
            const wrapped = parsed as Record<string, unknown>;
            if (wrapped.code !== "0") {
              throw futuresBusinessError(endpoint, wrapped.code, wrapped.msg, write);
            }
            return Object.hasOwn(wrapped, "data") ? wrapped.data : {};
          }
          if (parsed === null || typeof parsed !== "object") throw new AiHubError(write ? "AI_HUB_WRITE_RESULT_UNKNOWN" : "AI_HUB_OPENAPI_INVALID_RESPONSE", "Unexpected OpenAPI response shape.", { writeOutcomeUnknown: write });
          return parsed;
        } catch (error) {
          if (error instanceof AiHubError) throw error;
          if (!dispatched) throw new AiHubError("AI_HUB_LOCAL_STATE_ERROR", "Unable to coordinate the request. Nothing was dispatched.");
          if (!write && attempt === 0 && Date.now() + 1000 < deadline) continue;
          throw new AiHubError(write ? "AI_HUB_WRITE_RESULT_UNKNOWN" : "AI_HUB_OPENAPI_NETWORK_ERROR", "OpenAPI transport failed.", { writeOutcomeUnknown: write });
        }
      }
    } finally { this.options.onRequestTiming?.(performance.now() - started); }
  }
}
