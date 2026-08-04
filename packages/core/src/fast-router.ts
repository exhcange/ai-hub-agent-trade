export type AiHubFastRouteKind = "balance-list" | "asset-balance" | "last-price" | "open-orders";

export interface AiHubFastRoute {
  kind: AiHubFastRouteKind;
  toolName: "account_list_balances" | "account_get_asset_balance" | "market_get_last_price" | "spot_get_open_orders";
  input: Record<string, unknown>;
}

const NON_ASSET_WORDS = new Set(["ACCOUNT", "ALL", "ASSET", "ASSETS", "AVAILABLE", "BALANCE", "BALANCES", "CHECK", "CURRENT", "FROZEN", "GET", "INCLUDE", "INCLUDING", "MARKET", "MY", "NONZERO", "OPEN", "ORDER", "ORDERS", "PRICE", "SHOW", "SPOT", "TICKER", "TOTAL", "ZERO"]);

function withoutPrefix(prompt: string): string | null {
  const match = /^\s*ai[\s_-]?hub(?:\s*[:：,，-]?\s*|$)(.*)$/is.exec(prompt);
  return match ? (match[1] ?? "").trim() : null;
}

function normalizedCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const code = value.replace(/[\s/_-]/g, "").toUpperCase();
  return code && !NON_ASSET_WORDS.has(code) ? code : undefined;
}

function assetFromBalancePrompt(prompt: string): string | undefined {
  const before = /([a-z][a-z0-9]{1,11})\s*(?:spot\s*)?(?:asset\s*)?(?:balance|balances)|([a-z][a-z0-9]{1,11})\s*(?:现货)?(?:资产)?余额/i.exec(prompt);
  const after = /(?:balance|balances)\s*(?:of\s+|for\s+)?([a-z][a-z0-9]{1,11})/i.exec(prompt);
  return normalizedCode(before?.[1] ?? before?.[2] ?? after?.[1]);
}

function symbolFromPricePrompt(prompt: string): string | undefined {
  const before = /((?:[a-z0-9]{2,10}[\/_-][a-z0-9]{2,10})|(?:[a-z0-9]{5,20}))\s*(?:当前)?(?:价格|行情|报价|price|ticker)/i.exec(prompt);
  const after = /(?:价格|行情|报价|price|ticker)\s*(?:of\s+|for\s+)?((?:[a-z0-9]{2,10}[\/_-][a-z0-9]{2,10})|(?:[a-z0-9]{5,20}))/i.exec(prompt);
  return normalizedCode(before?.[1] ?? after?.[1]);
}

/** Matches only explicit `aihub` requests that are safe to execute without an Agent. */
export function matchAiHubFastRoute(prompt: string): AiHubFastRoute | null {
  const request = withoutPrefix(prompt);
  if (request === null || !request) return null;

  if (/(?:分析|比较|建议|策略|趋势|为什么|如何|是否应该)/i.test(request) || /\b(?:analy[sz]e|compare|recommend|strategy|trend|why|how|should)\b/i.test(request)) return null;

  if (/(?:当前挂单|未成交订单|open\s+orders?)/i.test(request)) {
    const symbol = [...request.matchAll(/\b([a-z0-9]{5,20})\b/gi)]
      .map((match) => normalizedCode(match[1]))
      .find((value): value is string => Boolean(value));
    return { kind: "open-orders", toolName: "spot_get_open_orders", input: symbol ? { symbol } : {} };
  }

  // Consequential requests always go through the Agent and shared prepare/confirm flow.
  if (/(?:买入|卖出|下单|撤单|转账|划转|提现|充值|buy|sell|place\s+order|cancel|transfer|withdraw|deposit)/i.test(request)) return null;

  if (/(?:余额|balance|balances)/i.test(request)) {
    const asset = assetFromBalancePrompt(request);
    if (asset) return { kind: "asset-balance", toolName: "account_get_asset_balance", input: { asset } };
    const includeZero = /(?:包括|包含|显示).{0,4}零(?:余额|资产)?|零余额|include\s+zero|including\s+zero/i.test(request);
    return { kind: "balance-list", toolName: "account_list_balances", input: includeZero ? { nonZeroOnly: false } : {} };
  }

  if (/(?:价格|行情|报价|price|ticker)/i.test(request)) {
    const symbol = symbolFromPricePrompt(request);
    if (symbol) return { kind: "last-price", toolName: "market_get_last_price", input: { symbol } };
  }

  return null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, fallback = "0"): string {
  return value === undefined || value === null ? fallback : String(value);
}

function renderBalanceList(data: unknown): string {
  const payload = object(data);
  const balances = payload?.balances;
  if (!Array.isArray(balances)) return JSON.stringify(data);
  if (!balances.length) return "No matching spot balances were found.";
  const rows = balances.map((item) => {
    const balance = object(item) ?? {};
    const frozen = text(balance.frozen);
    return `${text(balance.asset, "UNKNOWN")}: total ${text(balance.total)}, available ${text(balance.available)}${frozen === "0" || /^0\.0*$/.test(frozen) ? "" : `, frozen ${frozen}`}`;
  });
  if (payload?.truncated === true) rows.push("Additional balances were truncated by the response limit.");
  return rows.join("\n");
}

function renderOpenOrders(data: unknown): string {
  const rows = Array.isArray(data) ? data : Array.isArray(object(data)?.items) ? object(data)?.items as unknown[] : [];
  if (!rows.length) return "No open spot orders were found.";
  return [
    `Open spot orders: ${rows.length}`,
    ...rows.map((item) => {
      const order = object(item) ?? {};
      return `${text(order.symbol, "UNKNOWN")} ${text(order.side, "")}${order.type ? ` ${text(order.type, "")}` : ""}${order.price ? ` at ${text(order.price)}` : ""}${order.orderId ? ` (#${text(order.orderId)})` : ""}`.trim();
    })
  ].join("\n");
}

/** Produces a final user-facing response without a second model pass. */
export function renderAiHubFastResult(route: AiHubFastRoute, data: unknown): string {
  const value = object(data) ?? {};
  if (route.kind === "balance-list") return renderBalanceList(data);
  if (route.kind === "asset-balance") {
    return `${text(value.asset, text(route.input.asset, "Asset"))} balance: total ${text(value.total)}, available ${text(value.available)}, frozen ${text(value.frozen)}.`;
  }
  if (route.kind === "last-price") {
    return `${text(value.symbol, text(route.input.symbol, "Symbol"))} price: ${text(value.last, "unavailable")}${value.time === null || value.time === undefined ? "." : ` (time ${text(value.time)}).`}`;
  }
  return renderOpenOrders(data);
}
