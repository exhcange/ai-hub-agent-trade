import { FuturesSnapshots } from "./snapshots.js";
import { randomUUID } from "node:crypto";
import { AiHubError } from "../errors.js";
import type { ToolExecutionContext, ToolSpec, JsonSchema } from "../tools/tool-spec.js";
import { futuresContract, FUTURES_ENDPOINTS, type FuturesEndpoint } from "./api.js";
import { contractQuantityView, ordinaryOrderView, allowFields, array, object, boundedList, accountView } from "./normalize.js";
import { decimal, identifier, text, limit, page, timestamp, oneOf, schema, validateSchema, validateHalfYear, positive, invalid } from "./validation.js";
import { FuturesWriteState } from "./write-state.js";

const contract = { contractName: text };
const history = { ...contract, limit, fromId: identifier };
const range = { startTime: timestamp, endTime: timestamp };
const placement = { ...contract, intent: oneOf("open-long", "open-short", "close-long", "close-short"), type: oneOf("LIMIT", "MARKET"), quantity: decimal, unit: oneOf("coin", "contracts", "value"), marginMode: oneOf("cross", "isolated"), price: decimal };
const placementRequired = ["contractName", "intent", "type", "quantity", "unit", "marginMode"];
function api(context: ToolExecutionContext) {
  if (context.profile.product !== "futures" || !context.futuresApi) throw new AiHubError("AI_HUB_PRODUCT_MISMATCH", "A Futures profile is required.");
  return context.futuresApi;
}
function binding(context: ToolExecutionContext): string { return `${context.profile.name}|${context.profile.openApiBaseUrl}|futures`; }
function validatePlacement(input: Record<string, unknown>): void {
  positive(input.quantity, "quantity");
  if (input.unit === "contracts" && !/^[1-9]\d*$/.test(String(input.quantity))) invalid("Contract quantity must be a positive integer.");
  if (input.type === "LIMIT") positive(input.price, "price");
  else if (input.price !== undefined || input.timeInForce !== undefined) invalid("Market orders cannot specify price or timeInForce.");
}
function wirePlacement(input: Record<string, unknown>): Record<string, unknown> {
  const intent = String(input.intent);
  return { contractName: input.contractName, side: ["open-long", "close-short"].includes(intent) ? "BUY" : "SELL", open: intent.startsWith("open-") ? "OPEN" : "CLOSE", type: input.type,
    volume: input.quantity, orderUnit: input.unit === "coin" ? 1 : input.unit === "contracts" ? 2 : 3, positionType: input.marginMode === "cross" ? 1 : 2,
    ...(input.price !== undefined ? { price: input.price } : {}), ...(input.timeInForce ? { timeInForce: input.timeInForce } : {}), ...(input.clientOrderId ? { clientOrderId: input.clientOrderId } : {}),
    ...(input.triggerPrice ? { triggerPrice: input.triggerPrice, triggerType: input.triggerType === "3UP" ? 3 : 4 } : {}) };
}
async function contractRule(input: Record<string, unknown>, context: ToolExecutionContext): Promise<Record<string, unknown>> {
  const rows = array(await api(context).request("contracts"));
  const matches = rows.map(object).filter((row) => row.symbol === input.contractName);
  if (matches.length !== 1) invalid("Use one exact contract name from the contract list.");
  return matches[0]!;
}
function compare(a: string, b: string): number {
  if (!/^\d+(?:\.\d+)?$/.test(a) || !/^\d+(?:\.\d+)?$/.test(b)) throw new AiHubError("AI_HUB_FUTURES_RULES_UNAVAILABLE", "A required contract bound is unavailable.");
  const scale = Math.max(a.split(".")[1]?.length ?? 0, b.split(".")[1]?.length ?? 0);
  const integer = (v: string) => { const [whole, fraction = ""] = v.split("."); return BigInt(`${whole}${fraction.padEnd(scale, "0")}`); };
  return integer(a) < integer(b) ? -1 : integer(a) > integer(b) ? 1 : 0;
}
async function preflight(endpoint: FuturesEndpoint, input: Record<string, unknown>, context: ToolExecutionContext): Promise<Record<string, unknown>> {
  await (context.futuresWrites ?? new FuturesWriteState()).assertClear(binding(context), endpoint === "edit_user_position_model" ? "futures_set_position_mode" : endpoint === "cancel_all" ? "futures_cancel_all_orders" : endpoint, input);
  if (input.contractName) {
    const rule = await contractRule(input, context);
    if (["order", "conditionOrder", "profitLossOrder"].includes(endpoint) && String(rule.status) !== "1") invalid("The contract is not currently tradable.");
    const orderPrices = [input.price, input.triggerPrice, ...((input.orderList ?? []) as Record<string, unknown>[]).flatMap((row) => [row.price, row.triggerPrice])].filter((price) => price !== undefined);
    for (const price of orderPrices) {
      const precision = Number(rule.pricePrecision);
      if (!Number.isSafeInteger(precision) || precision < 0 || (String(price).split(".")[1]?.length ?? 0) > precision) invalid("Price exceeds verified contract precision.");
    }
    for (const item of (input.orderList ?? []) as Record<string, unknown>[]) {
      if (compare(String(item.volume), String(rule.minOrderVolume)) < 0 || compare(String(item.volume), String(item.type === 2 ? rule.maxMarketVolume : rule.maxLimitVolume)) > 0) invalid("TP/SL quantity is outside contract limits.");
    }
    if (input.quantity && input.unit === "contracts") {
      const maximum = input.type === "MARKET" ? rule.maxMarketVolume : rule.maxLimitVolume;
      if (compare(String(input.quantity), String(rule.minOrderVolume)) < 0 || compare(String(input.quantity), String(maximum)) > 0) invalid("Quantity is outside contract limits.");
    }
    if (input.quantity) input = { ...input, _quantityAsset: input.unit === "coin" ? rule.multiplierCoin ?? "not_verified" : input.unit === "value" ? rule.marginCoin ?? "not_verified" : "contracts", _conversion: input.unit === "value" ? "Exchange converts value to integer contracts by rounding down using its execution/reference price; final contract quantity is not guaranteed." : "Exact contract quantity; no client rounding." };
    if (input.quantity && input.unit === "value") {
      const maximum = input.type === "MARKET" ? rule.maxMarketMoney : rule.maxLimitMoney;
      if (compare(String(input.quantity), String(rule.minOrderMoney)) < 0 || compare(String(input.quantity), String(maximum)) > 0) invalid("Order value is outside contract limits.");
    }
    if (input.quantity && input.unit === "coin") {
      const rational = (v: unknown) => {
        if (!/^\d+(?:\.\d+)?$/.test(String(v))) throw new AiHubError("AI_HUB_FUTURES_RULES_UNAVAILABLE", "Contract multiplier is unavailable.");
        const [whole, fraction = ""] = String(v).split("."); return { n: BigInt(`${whole}${fraction}`), d: 10n ** BigInt(fraction.length) };
      };
      const q = rational(input.quantity), m = rational(rule.multiplier);
      const numerator = q.n * m.d, denominator = q.d * m.n;
      if (denominator === 0n || numerator % denominator !== 0n) invalid("Coin quantity must map to an exact integer number of contracts; no rounding is performed.");
      const lots = String(numerator / denominator);
      if (compare(lots, String(rule.minOrderVolume)) < 0 || compare(lots, String(input.type === "MARKET" ? rule.maxMarketVolume : rule.maxLimitVolume)) > 0) invalid("Coin quantity is outside contract bounds.");
    }
    if (endpoint === "edit_lever" && (compare(String(input.nowLevel), String(rule.minLever)) < 0 || compare(String(input.nowLevel), String(rule.maxLever)) > 0)) invalid("Leverage is outside contract limits.");
  }
  if (["edit_user_position_model", "edit_user_margin_model", "edit_position_margin", "profitLossOrder"].includes(endpoint)) {
    const account = object(await api(context).request("account", {}, context.credentials));
    const positions = array(account.account).flatMap((entry) => array(object(entry).positionVos).flatMap((group) => {
      const row = object(group);
      return array(row.positions).map((p) => ({ ...object(p), contractName: row.contractName } as Record<string, unknown>));
    })).filter((p) => (() => { if (!["0", "1"].includes(String(p.status))) throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Unknown position state."); return String(p.status) === "1" && compare(String(p.volume), "0") > 0; })());
    if (endpoint === "edit_user_position_model" || endpoint === "edit_user_margin_model") {
      const relevant = positions.filter((p) => endpoint === "edit_user_position_model" || p.contractName === input.contractName);
      if (relevant.length) invalid("Existing positions prevent this mode change.");
      const orders = await api(context).request("openOrders", endpoint === "edit_user_position_model" ? {} : { contractName: input.contractName }, context.credentials);
      // The published Futures endpoint returns {code: 0, data: null} when no
      // ordinary orders exist. Treat that successful empty response as an
      // empty order set; a non-empty non-array object remains unverifiable.
      if (Array.isArray(orders) && orders.length) invalid("Existing ordinary orders prevent this mode change.");
      if (orders !== null && !Array.isArray(orders) && Object.keys(object(orders)).length) throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Cannot establish current order state.");
    }
    if (endpoint === "edit_position_margin") {
      const found = positions.filter((p) => String(p.id) === input.positionId);
      if (found.length !== 1 || String(found[0]!.positionType) !== "2" || !["0", "false"].includes(String(found[0]!.freezeLock))) invalid("Margin adjustment requires one owned, unfrozen isolated position.");
    }
    if (endpoint === "profitLossOrder") {
      const side = input.side === "BUY" ? "SELL" : "BUY";
      const found = positions.filter((p) => p.contractName === input.contractName && p.side === side);
      if (found.length !== 1) invalid("TP/SL requires one unambiguous matching position.");
      if (input._positionId !== undefined && input._positionId !== String(found[0]!.id)) invalid("Target position changed after preview; prepare again.");
      input = { ...input, _positionId: String(found[0]!.id) };
      for (const item of input.orderList as Record<string, unknown>[]) if (compare(String(item.volume), String(found[0]!.volume)) > 0) invalid("TP/SL quantity exceeds the current position.");
    }
  }
  if (endpoint === "cancel_all") {
    const response = await api(context).request("openOrders", {}, context.credentials);
    const orders = response === null ? [] : Array.isArray(response) ? response : Object.keys(object(response)).length === 0 ? [] : undefined;
    if (!orders) throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Cannot preview the ordinary-order response.");
    input = { ...input, _previewOrderCount: orders.length };
  }
  if (endpoint === "cancel") {
    const order = object(await api(context).request("orderDetail", { contractName: input.contractName, orderId: input.orderId }, context.credentials));
    if (["FILLED", "CANCELED", "CANCELLED", "EXPIRED", "REJECTED", "2", "4", "6", "7", "PART_FILLED_CANCELED"].includes(String(order.status))) invalid("The order is already terminal; no cancellation will be submitted.");
  }
  return input;
}
interface Definition {
  name: string; path: string; endpoint: FuturesEndpoint; module?: ToolSpec["module"]; input: JsonSchema;
  check?: (input: Record<string, unknown>) => void;
  wire?: (input: Record<string, unknown>) => Record<string, unknown>;
  output?: (value: unknown, input: Record<string, unknown>) => unknown;
}
function tool(def: Definition): ToolSpec {
  const write = FUTURES_ENDPOINTS[def.endpoint][2] === "write";
  return {
    name: `futures_${def.name}`, product: "futures", title: `Futures ${def.name.replaceAll("_", " ")}`, description: `Futures ${def.name.replaceAll("_", " ")}${write ? "; prepare and confirm required" : ""}.`,
    cliPath: ["futures", ...def.path.split(" ")], module: def.module ?? (write ? "futures-trade" : "futures-common"), access: futuresContract(def.endpoint).authentication,
    operation: write ? "write" : "read", riskLevel: write ? "high" : "low", openApiContract: futuresContract(def.endpoint), inputSchema: def.input, errorCodes: ["AI_HUB_INVALID_ARGUMENT", "AI_HUB_PRODUCT_MISMATCH", "AI_HUB_WRITE_RESULT_UNKNOWN"],
    validate(raw) {
      const input = validateSchema(raw, def.input) as Record<string, unknown>;
      def.check?.(input);
      return input;
    },
    ...(write ? {
      preflight: (input: Record<string, unknown>, context: ToolExecutionContext) => preflight(def.endpoint, input, context),
      confirmPreflight: async (input: Record<string, unknown>, context: ToolExecutionContext) => { await preflight(def.endpoint, input, context); },
      writeSummary: (input: Record<string, unknown>) => ({ product: "futures", ...input, scope: def.endpoint === "cancel_all" ? "All ordinary orders in this account at execution time; excludes triggers and positions" : def.endpoint === "edit_user_position_model" ? "Account-wide position mode" : input.positionId ? "Selected isolated position" : "Selected contract", symbol: input.contractName ?? null, side: input.intent ? wirePlacement(input).side : input.side ?? null,
        quantityOrAmount: input.quantity ? { value: input.quantity, unit: input.unit, asset: input._quantityAsset, conversion: input._conversion } : input.amount ? { value: input.amount, meaning: "signed margin delta" } : null,
        priceOrMarket: input.type === "MARKET" ? { mode: "MARKET" } : input.price ? { mode: "LIMIT", price: input.price } : { mode: "NOT_APPLICABLE" },
        ...(input._previewOrderCount !== undefined ? { previewOrderCount: input._previewOrderCount, previewCoverage: "upstream_completeness_not_established" } : {}), currentValue: { status: "not_verified" }, exchangeManagedTrigger: ["conditionOrder", "profitLossOrder"].includes(def.endpoint) })
    } : {}),
    async handler(input, context) {
      const snapshotEnabled = ["contracts", "openOrders"].includes(def.endpoint);
      const snapshotBinding = { profile: context.profile.name, version: context.profile.configVersion, operation: def.name, input: Object.fromEntries(Object.entries(input).filter(([key]) => !["cursor", "limit"].includes(key)).sort(([a], [b]) => a.localeCompare(b))) };
      if (!write && input.cursor && snapshotEnabled) return new FuturesSnapshots().next(String(input.cursor), Number(input.limit), snapshotBinding);
      const send = async () => {
        let value: unknown;
        try { value = await api(context).request(def.endpoint, Object.fromEntries(Object.entries(def.wire ? def.wire(input) : input).filter(([key]) => !key.startsWith("_") && key !== "cursor")), context.credentials, context.writeDeadlineMs); }
        catch (error) {
          if (def.endpoint === "order" && error instanceof AiHubError && error.code === "AI_HUB_WRITE_RESULT_UNKNOWN") {
            try {
              const found = object(await api(context).request("orderDetail", { contractName: input.contractName, clientOrderId: input.clientOrderId }, context.credentials));
              if (String(found.clientOrderId ?? found.clientId) === input.clientOrderId && found.orderId && found.status !== undefined) return { reconciled: true, accepted: true, executionVerified: false, data: allowFields(found) };
            } catch { /* No matching evidence: retain the original unknown outcome. */ }
          }
          throw error;
        }
        if (write) {
          if (["order", "conditionOrder", "profitLossOrder"].includes(def.endpoint)) {
            const result = object(value);
            const ids = result.orderId ? [result.orderId] : def.endpoint === "order" ? result.ids : result.triggerIds;
            const expected = def.endpoint === "profitLossOrder" ? (input.orderList as unknown[]).length : 1;
            if (!Array.isArray(ids) || ids.length !== expected || ids.some((id) => !/^[1-9]\d*$/.test(String(id)))) throw new AiHubError("AI_HUB_WRITE_RESULT_UNKNOWN", "Submission response does not establish every requested order identity.", { writeOutcomeUnknown: true });
          }
          return { accepted: true, executionVerified: false, data: allowFields(value) };
        }
        if (["orderDetail", "openOrders", "orderHistorical", "myTrades"].includes(def.endpoint)) value = def.endpoint === "openOrders" && value === null ? [] : ordinaryOrderView(value);
        if (["profitHistorical", "trigger_order_list"].includes(def.endpoint)) value = contractQuantityView(value);
        if (snapshotEnabled) {
          const rows = def.endpoint === "openOrders" && (value === null || (!Array.isArray(value) && Object.keys(object(value)).length === 0)) ? [] : array(value);
          const filtered = def.endpoint === "contracts" && input.contractName ? rows.filter((r) => object(r).symbol === input.contractName) : rows;
          return new FuturesSnapshots().first(filtered, Number(input.limit), snapshotBinding);
        }
        return def.output ? def.output(value, input) : allowFields(value);
      };
      return write ? (context.futuresWrites ?? new FuturesWriteState()).execute(binding(context), `futures_${def.name}`, send, Object.fromEntries(["contractName", "clientOrderId", "orderId", "positionId"].filter((key) => input[key] !== undefined).map((key) => [key, input[key]]))) : send();
    }
  };
}
const listOutput = (value: unknown, input: Record<string, unknown>) => boundedList(value, Number(input.limit ?? 20));
const defs: Definition[] = [
  { name: "ping", path: "ping", endpoint: "ping", input: schema({}), output: (v) => { object(v); return {}; } },
  { name: "time", path: "time", endpoint: "time", input: schema({}) },
  { name: "contracts", path: "contracts", endpoint: "contracts", input: schema({ ...contract, limit, cursor: text }), wire: () => ({}), output: (v, i) => boundedList(array(v).filter((r) => !i.contractName || object(r).symbol === i.contractName), Number(i.limit)) },
  { name: "depth", path: "market depth", endpoint: "depth", input: schema({ ...contract, limit }, ["contractName"]), output: (v, i) => { const r = object(v); return { bids: array(r.bids).slice(0, Number(i.limit)), asks: array(r.asks).slice(0, Number(i.limit)), time: r.time ?? null }; } },
  { name: "ticker", path: "market ticker", endpoint: "ticker", input: schema(contract, ["contractName"]) },
  { name: "index", path: "market index", endpoint: "index", input: schema(contract, ["contractName"]) },
  { name: "klines", path: "market klines", endpoint: "klines", input: schema({ ...contract, interval: oneOf("1min", "5min", "15min", "30min", "1h", "1day", "1week", "1month"), limit }, ["contractName", "interval"]), output: (v, i) => {
    for (const row of array(v)) {
      const idx = String(object(row).idx);
      if (!/^\d+$/.test(idx) || BigInt(idx) < 100000000000n || BigInt(idx) > BigInt(Number.MAX_SAFE_INTEGER)) throw new AiHubError("AI_HUB_OPENAPI_INVALID_RESPONSE", "Candle timestamp does not match the millisecond contract.");
    }
    return listOutput(v, i);
  } },
  { name: "assets", path: "account assets", endpoint: "account", module: "futures-account", input: schema({ asset: text }), wire: () => ({}), output: (v, i) => accountView(v, i, false) },
  { name: "positions", path: "account positions", endpoint: "account", module: "futures-account", input: schema({ ...contract, asset: text, limit }), wire: () => ({}), output: (v, i) => accountView(v, i, true) },
  { name: "order_detail", path: "order detail", endpoint: "orderDetail", module: "futures-order", input: schema({ ...contract, orderId: identifier, clientOrderId: { ...text, maxLength: 31 } }, ["contractName"]), check: (i) => { if (Number(i.orderId !== undefined) + Number(i.clientOrderId !== undefined) !== 1) invalid("Provide exactly one orderId or clientOrderId."); } },
  { name: "open_orders", path: "order open", endpoint: "openOrders", module: "futures-order", input: schema({ ...contract, limit, cursor: text }), wire: ({ limit: _l, ...i }) => i, output: (v, i) => listOutput(v === null || (!Array.isArray(v) && Object.keys(object(v)).length === 0) ? [] : v, i) },
  { name: "order_history", path: "order history", endpoint: "orderHistorical", module: "futures-order", input: schema(history, ["contractName"]), output: listOutput },
  { name: "profit_history", path: "account profit-history", endpoint: "profitHistorical", module: "futures-account", input: schema({ ...history, ...range }), check: (i) => validateHalfYear(i), output: (v, i) => { const rows = array(v); const maxId = rows.reduce<bigint>((max, row) => { const id = BigInt(String(object(row).id)); return id > max ? id : max; }, 0n); return boundedList(rows, Number(i.limit), rows.length === i.limit && maxId > 0n && maxId < 9223372036854775807n ? { fromId: (maxId + 1n).toString() } : null); } },
  { name: "my_trades", path: "order trades", endpoint: "myTrades", module: "futures-order", input: schema(history, ["contractName"]), output: listOutput },
  { name: "transactions", path: "account transactions", endpoint: "get_user_transaction", module: "futures-account", input: schema({ symbol: text, beginTime: timestamp, endTime: timestamp, page, limit, type: oneOf(...Array.from({ length: 13 }, (_, i) => i + 1), 28) }, ["symbol", "beginTime", "endTime"]), check: (i) => validateHalfYear(i, "beginTime"), wire: (i) => ({ ...i, assetType: 0 }), output: (v, i) => {
    const result = object(v), rows = array(result.transList);
    const selected = rows.filter((r) => { const scene = Number(object(r).scene); return (scene >= 1 && scene <= 13) || scene === 28; });
    const count = Number(result.count);
    return { items: allowFields(selected.slice(0, Number(i.limit))), returnedCount: Math.min(selected.length, Number(i.limit)), continuation: Number.isSafeInteger(count) && Number(i.page) * Number(i.limit) < count ? { page: Number(i.page) + 1, limit: i.limit } : null };
  } },
  { name: "trigger_orders", path: "order triggers", endpoint: "trigger_order_list", module: "futures-order", input: schema({ ...contract, page, limit }, ["contractName"]), output: (v, i) => {
    const result = object(v); const rows = array(result.trigOrderList ?? (String(result.count) === "0" ? [] : undefined));
    return boundedList(rows, Number(i.limit), Number(i.page) * Number(i.limit) < Number(result.count) ? { page: Number(i.page) + 1, limit: i.limit } : null);
  } },
  { name: "place_order", path: "trade place", endpoint: "order", input: schema({ ...placement, clientOrderId: { ...text, maxLength: 31 }, timeInForce: oneOf("IOC", "FOK", "POST_ONLY") }, placementRequired), check: (i) => { validatePlacement(i); i.clientOrderId ??= randomUUID().replaceAll("-", "").slice(0, 31); }, wire: wirePlacement },
  { name: "place_condition_order", path: "trade condition", endpoint: "conditionOrder", input: schema({ ...placement, triggerPrice: decimal, triggerType: oneOf("3UP", "4DOWN") }, [...placementRequired, "triggerPrice", "triggerType"]), check: (i) => { validatePlacement(i); positive(i.triggerPrice, "triggerPrice"); }, wire: wirePlacement },
  { name: "place_profit_loss_order", path: "trade profit-loss", endpoint: "profitLossOrder", input: schema({ ...contract, side: oneOf("BUY", "SELL"), orderList: { type: "array", minItems: 1, maxItems: 5, items: schema({ triggerType: oneOf(1, 2), type: oneOf(1, 2), price: decimal, volume: identifier, triggerPrice: decimal }, ["triggerType", "type", "volume", "triggerPrice"]) } }, ["contractName", "side", "orderList"]), check: (i) => { for (const r of i.orderList as Record<string, unknown>[]) { positive(r.triggerPrice, "triggerPrice"); if (r.type === 1) positive(r.price, "price"); else if (r.price !== undefined) invalid("Market TP/SL items must omit price."); } }, wire: (i) => ({ ...i, orderUnit: 2 }) },
  { name: "cancel_order", path: "order cancel", endpoint: "cancel", module: "futures-order", input: schema({ ...contract, orderId: identifier }, ["contractName", "orderId"]) },
  { name: "cancel_all_orders", path: "order cancel-all", endpoint: "cancel_all", module: "futures-order", input: schema({ scope: { type: "string", const: "all-ordinary-orders" } }, ["scope"]), wire: () => ({}) },
  { name: "cancel_trigger_order", path: "order cancel-trigger", endpoint: "cancel_trigger_order", module: "futures-order", input: schema({ ...contract, orderId: identifier, orderIds: { type: "array", minItems: 1, maxItems: 50, items: identifier }, clientId: text }, ["contractName"]), check: (i) => { if ([i.orderId, i.orderIds, i.clientId].filter((v) => v !== undefined).length !== 1) invalid("Provide exactly one trigger cancellation selector."); if (Array.isArray(i.orderIds) && new Set(i.orderIds).size !== i.orderIds.length) invalid("Trigger cancellation IDs must be unique."); } },
  { name: "set_position_mode", path: "trade position-mode", endpoint: "edit_user_position_model", input: schema({ ...contract, positionModel: oneOf(1, 2) }, ["contractName", "positionModel"]) },
  { name: "set_margin_mode", path: "trade margin-mode", endpoint: "edit_user_margin_model", input: schema({ ...contract, marginModel: oneOf(1, 2) }, ["contractName", "marginModel"]) },
  { name: "adjust_position_margin", path: "trade position-margin", endpoint: "edit_position_margin", input: schema({ positionId: identifier, amount: { ...decimal, pattern: "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,10})?$" } }, ["positionId", "amount"]), check: (i) => { if (!/[1-9]/.test(String(i.amount))) invalid("Margin delta cannot be zero."); } },
  { name: "set_leverage", path: "trade leverage", endpoint: "edit_lever", input: schema({ ...contract, nowLevel: { type: "integer", minimum: 1 } }, ["contractName", "nowLevel"]) }
];
export const futuresTools: ToolSpec[] = defs.map(tool);
