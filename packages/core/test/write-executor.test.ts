import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, AiHubSpotApi, createToolRegistry, ToolRegistry, ToolWriteExecutor, type ToolExecutionContext, type ToolSpec } from "../src/index.js";

const context: ToolExecutionContext = {
  profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
  credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
  api: new AiHubSpotApi("https://api.example.com")
};

const contextWithSymbolRules: ToolExecutionContext = {
  ...context,
  api: {
    symbols: async () => ({ symbols: [{ symbol: "btcusdt", quantityPrecision: 5, pricePrecision: 2, limitVolumeMin: "0.00001", limitAmountMin: "0", limitPriceMin: "0.01" }] }),
    ticker: async () => ({ last: "50000", time: "1" })
  } as unknown as AiHubSpotApi
};

const testWriteMetadata = {
  openApiContract: { method: "POST" as const, path: "/sapi/v2/order/test", authentication: "signed" as const },
  agentRouting: { preference: "default" as const, selectionHint: "Test-only write Tool." }
};

test("write Tool cannot execute before a confirmation is consumed", async () => {
  let calls = 0;
  const writeTool: ToolSpec<any> = {
    name: "spot_test_write", title: "Test Write", description: "test", cliPath: ["test", "write"], module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false }, errorCodes: ["AI_HUB_CONFIRMATION_REQUIRED"],
    validate: (input) => input as Record<string, unknown>,
    handler: async () => { calls += 1; return { written: true }; },
    writeSummary: (input) => ({ value: input.value }),
    ...testWriteMetadata
  };
  const registry = new ToolRegistry([writeTool]);
  const executor = new ToolWriteExecutor(registry);
  await assert.rejects(registry.execute("spot_test_write", { value: "a" }, context), { code: "AI_HUB_WRITE_CONFIRMATION_REQUIRED" });
  const prepared = await executor.prepare("spot_test_write", { value: "a" }, context);
  assert.equal(calls, 0);
  assert.equal(prepared.requiresNewUserConfirmation, true);
  assert.match(prepared.nextStep, /wait for a new explicit user confirmation/i);
  await assert.rejects(executor.confirm(prepared.confirmationId, "", context), { code: "AI_HUB_CONFIRMATION_REQUIRED" });
  assert.equal(calls, 0);
  assert.deepEqual(await executor.confirm(prepared.confirmationId, "yes", context), { written: true });
  assert.equal(calls, 1);
  await assert.rejects(executor.confirm(prepared.confirmationId, "yes", context), { code: "AI_HUB_CONFIRMATION_NOT_FOUND" });
  assert.equal(calls, 1);
});

test("context changes permanently invalidate a prepared write", async () => {
  const registry = new ToolRegistry([{
    name: "spot_test_write", title: "Test Write", description: "test", cliPath: ["test", "write"], module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", additionalProperties: false }, errorCodes: [], validate: () => ({}), handler: async () => ({ written: true }), writeSummary: () => ({}), ...testWriteMetadata
  }]);
  const executor = new ToolWriteExecutor(registry);
  const prepared = await executor.prepare("spot_test_write", {}, context);
  await assert.rejects(executor.confirm(prepared.confirmationId, "yes", { ...context, credentials: { ...context.credentials!, credentialVersion: "credential-v2" } }), { code: "AI_HUB_CONFIRMATION_CONTEXT_CHANGED" });
  await assert.rejects(executor.confirm(prepared.confirmationId, "yes", context), { code: "AI_HUB_CONFIRMATION_NOT_FOUND" });
});

test("spot order preparation uses explicit quote/base units and generates an idempotency key", async () => {
  const executor = new ToolWriteExecutor(createToolRegistry());
  const prepared = await executor.prepare("spot_market_buy", { symbol: "btcusdt", quoteAmount: "10" }, contextWithSymbolRules);
  assert.deepEqual(prepared.summary.quantityOrAmount, { value: "10", asset: null, apiAsset: null, meaning: "exact quote-asset amount to spend" });
  assert.match(String(prepared.summary.newClientOrderId), /^agent_/);
  await assert.rejects(
    executor.prepare("spot_market_buy", { symbol: "btcusdt", quoteAmount: "10", baseQuantity: "1" }, contextWithSymbolRules),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
  const sell = await executor.prepare("spot_market_sell", { symbol: "btcusdt", baseQuantity: "0.01" }, contextWithSymbolRules);
  assert.equal((sell.summary.quantityOrAmount as Record<string, unknown>).value, "0.01");
  assert.deepEqual(sell.summary.estimatedNotional, { amount: "500", asset: null, apiAsset: null, status: "INDICATIVE", basis: "LIVE_TICKER", tickerPrice: "50000", quotedAt: (sell.summary.priceOrMarket as Record<string, unknown>).quotedAt });
});

test("market confirmation is rejected when a live price moves unfavourably by more than five percent", async () => {
  let price = "50000";
  let orderCalls = 0;
  const contextWithChangingTicker: ToolExecutionContext = {
    ...context,
    api: {
      symbols: async () => ({ symbols: [{ symbol: "btcusdt", quantityPrecision: 5, pricePrecision: 2, limitVolumeMin: "0.00001", limitAmountMin: "0", limitPriceMin: "0.01" }] }),
      ticker: async () => ({ last: price, time: "1" }),
      placeOrder: async () => { orderCalls += 1; return { orderId: "1" }; }
    } as unknown as AiHubSpotApi
  };
  const executor = new ToolWriteExecutor(createToolRegistry());
  const prepared = await executor.prepare("spot_market_sell", { symbol: "btcusdt", baseQuantity: "0.01" }, contextWithChangingTicker);
  price = "47000";
  await assert.rejects(
    executor.confirm(prepared.confirmationId, "yes", contextWithChangingTicker),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_MARKET_PRICE_MOVED"
  );
  assert.equal(orderCalls, 0);
});

test("market BUY confirmation is rejected only when the live price rises by more than five percent", async () => {
  let price = "50000";
  let orderCalls = 0;
  const contextWithChangingTicker: ToolExecutionContext = {
    ...context,
    api: {
      symbols: async () => ({ symbols: [{ symbol: "btcusdt", quantityPrecision: 5, pricePrecision: 2, limitVolumeMin: "0.00001", limitAmountMin: "0", limitPriceMin: "0.01" }] }),
      ticker: async () => ({ last: price, time: "1" }),
      placeOrder: async () => { orderCalls += 1; return { orderId: "1" }; }
    } as unknown as AiHubSpotApi
  };
  const executor = new ToolWriteExecutor(createToolRegistry());
  const prepared = await executor.prepare("spot_market_buy", { symbol: "btcusdt", quoteAmount: "10" }, contextWithChangingTicker);
  price = "52500";
  await executor.confirm(prepared.confirmationId, "yes", contextWithChangingTicker);
  assert.equal(orderCalls, 1);

  const rejected = await executor.prepare("spot_market_buy", { symbol: "btcusdt", quoteAmount: "10" }, contextWithChangingTicker);
  price = "55126";
  await assert.rejects(
    executor.confirm(rejected.confirmationId, "yes", contextWithChangingTicker),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_MARKET_PRICE_MOVED"
  );
  assert.equal(orderCalls, 1);
});

test("margin order preparation uses the same explicit quote/base unit rules", async () => {
  const executor = new ToolWriteExecutor(createToolRegistry());
  const buy = await executor.prepare("margin_market_buy", { symbol: "btcusdt", quoteAmount: "10", isolated: true }, contextWithSymbolRules);
  assert.equal((buy.summary.quantityOrAmount as Record<string, unknown>).value, "10");
  assert.equal(buy.summary.isolated, true);
  const sell = await executor.prepare("margin_market_sell", { symbol: "btcusdt", baseQuantity: "0.01" }, contextWithSymbolRules);
  assert.equal((sell.summary.quantityOrAmount as Record<string, unknown>).value, "0.01");
  await assert.rejects(
    executor.prepare("margin_market_sell", { symbol: "btcusdt", quoteAmount: "10" }, contextWithSymbolRules),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
});

test("network interruption consumes the confirmation and reports an unknown write result", async () => {
  const registry = new ToolRegistry([{
    name: "spot_test_write", title: "Test Write", description: "test", cliPath: ["test", "write"], module: "spot-order", access: "signed", operation: "write", riskLevel: "high",
    inputSchema: { type: "object", additionalProperties: false }, errorCodes: [], validate: () => ({}),
    handler: async () => { throw new AiHubError("AI_HUB_OPENAPI_NETWORK_ERROR", "socket closed"); }, writeSummary: () => ({}), ...testWriteMetadata
  }]);
  const executor = new ToolWriteExecutor(registry);
  const prepared = await executor.prepare("spot_test_write", {}, context);
  await assert.rejects(executor.confirm(prepared.confirmationId, "yes", context), { code: "AI_HUB_WRITE_RESULT_UNKNOWN" });
  await assert.rejects(executor.confirm(prepared.confirmationId, "yes", context), { code: "AI_HUB_CONFIRMATION_NOT_FOUND" });
});
