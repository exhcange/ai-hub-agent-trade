import { AiHubError } from "../errors.js";

const FIELDS = new Set(`quantityUnit quantityFields statusName lastFundingRate transList afterBalance ctimeMillis contractOtherName ids triggerIds symbol contractName contractId contractSymbol marginCoin multiplier multiplierCoin pricePrecision side status type maxMarketVolume minOrderVolume maxMarketMoney maxLimitVolume maxLimitMoney minOrderMoney maxValidOrder minLever maxLever openTakerFee openMakerFee closeTakerFee closeMakerFee serverTime time timestamp idx open high low close vol volume amount price qty quantity last lastPrice highPrice lowPrice openPrice avgPrice markPrice indexPrice fundingRate capitalRate rose change percent changePercent baseVolume quoteVolume bids asks account accountNormal accountLock partPositionNormal totalPositionNormal totalEquity partEquity achievedAmount unrealizedAmount positionVos positions id positionId positionType closeVolume pendingCloseVolume holdAmount leverageLevel freezeLock orderId clientOrderId clientId tradeId origQty executedQty dealVolume dealMoney openOrClose action transactTime ctime ctimeMs mtime realizedAmount historyRealizedAmount closeProfit settleProfit shareAmount tradeFee capitalFee openEndPrice fee isBuyer isMaker triggerOrderId triggerType triggerPrice orderType orderUnit orderIds trigOrderList count page limit transactionList transactions list records scene typeName coin coinSymbol balance total feeRate openTakerFeeRate openMakerFeeRate closeTakerFeeRate closeMakerFeeRate`.split(/\s+/));
export function allowFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(allowFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => FIELDS.has(key)).map(([key, item]) => [key, allowFields(item)]));
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Expected an OpenAPI object.");
  return value as Record<string, unknown>;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Expected an OpenAPI list.");
  return value;
}
export function boundedList(value: unknown, size: number, continuation: unknown = null): unknown {
  const rows = array(value);
  return { items: allowFields(rows.slice(0, size)), returnedCount: Math.min(rows.length, size), truncated: rows.length > size, continuation: rows.length > size ? null : continuation };
}
const CONTRACT_QUANTITIES = ["volume", "dealVolume", "origQty", "executedQty", "qty", "quantity", "closeVolume", "pendingCloseVolume"];

/** Annotate order/position quantities only; keep exact upstream values unchanged. */
export function contractQuantityView(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contractQuantityView);
  if (!value || typeof value !== "object") return value;
  const row = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, contractQuantityView(item)]));
  const fields = CONTRACT_QUANTITIES.filter((key) => row[key] !== undefined && row[key] !== null);
  return fields.length ? { ...row, quantityUnit: "contracts", quantityFields: fields } : row;
}

const ASSET_AMOUNTS = new Set([
  "accountNormal", "accountLock", "partPositionNormal", "totalPositionNormal",
  "totalEquity", "partEquity", "achievedAmount", "unrealizedAmount"
]);

/** Display only: exact decimal half-up rounding, including negative PnL. */
function assetAmount(value: unknown): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
  const exponent = Number(match?.[4] ?? 0);
  if (!match || !Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000 || String(value).length > 4096) {
    throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Invalid Futures asset amount.");
  }
  const fraction = match[3] ?? "";
  const digits = BigInt(match[2]! + fraction);
  const scale = exponent - fraction.length + 2;
  const divisor = scale < 0 ? 10n ** BigInt(-scale) : 1n;
  const cents = scale >= 0 ? digits * 10n ** BigInt(scale) : digits / divisor + (digits % divisor * 2n >= divisor ? 1n : 0n);
  return `${match[1] && cents !== 0n ? "-" : ""}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function accountView(value: unknown, input: Record<string, unknown>, positions: boolean): unknown {
  const accounts = array(object(value).account);
  const selected = accounts.map(object).filter((row) => !input.asset || row.marginCoin === input.asset);
  if (!positions) return { items: selected.map(({ positionVos: _p, positions: _q, ...row }) => Object.fromEntries(Object.entries(allowFields(row) as Record<string, unknown>).map(([key, value]) => [key, ASSET_AMOUNTS.has(key) && value !== null ? assetAmount(value) : value]))), fetchedAt: new Date().toISOString() };
  const result: unknown[] = [];
  for (const account of selected) {
    for (const group of array(account.positionVos ?? [])) {
      const contract = object(group);
      if (input.contractName && contract.contractName !== input.contractName) continue;
      for (const entry of array(contract.positions)) {
        const position = object(entry);
        if (!/^\d+(?:\.\d+)?$/.test(String(position.volume)) || !["0", "1"].includes(String(position.status))) throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Position state or volume is missing or invalid.");
        if (String(position.status) === "1" && /[1-9]/.test(String(position.volume))) result.push({ ...position, contractName: contract.contractName, marginCoin: account.marginCoin });
      }
    }
  }
  return boundedList(contractQuantityView(result), Number(input.limit ?? 20));
}

const ORDER_STATES: Record<string, string> = { "0": "INIT", "1": "NEW", "2": "FILLED", "3": "PART_FILLED", "4": "CANCELED", "5": "PENDING_CANCEL", "6": "EXPIRED", "7": "PART_FILLED_CANCELED" };
export function ordinaryOrderView(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordinaryOrderView);
  const row = object(value);
  const normalized = allowFields(row) as Record<string, unknown>;
  if (row.status !== undefined) normalized.statusName = ORDER_STATES[String(row.status)] ?? (Object.values(ORDER_STATES).includes(String(row.status)) ? row.status : "UNKNOWN");
  if (typeof row.isBuyer === "boolean" && (row.isBuyer ? row.bidId : row.askId) !== undefined) normalized.orderId = row.isBuyer ? row.bidId : row.askId;
  return contractQuantityView(normalized);
}
