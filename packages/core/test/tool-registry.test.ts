import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, AiHubSpotApi, clearTickerSummaryCache, createToolRegistry, OPENAPI_CONTRACTS } from "../src/index.js";

test("registry is the unique source for CLI paths and read-only visibility", () => {
  const registry = createToolRegistry();
  const tools = registry.list({ readOnly: true });
  assert.ok(tools.length >= 29);
  assert.equal(registry.byCliPath(["market", "depth"]).name, "market_get_depth");
  assert.equal(registry.byCliPath(["account", "asset-balance"]).name, "account_get_asset_balance");
  assert.equal(registry.byCliPath(["spot", "order", "history"]).name, "spot_get_history_orders");
  assert.equal(registry.byCliPath(["market", "klines-1min-history"]).name, "market_get_historical_minute_klines");
  assert.equal(registry.byCliPath(["margin", "order", "get"]).name, "margin_get_order");
  assert.equal(registry.byCliPath(["wallet", "deposit-history"]).name, "wallet_get_deposit_history");
  assert.equal(registry.byCliPath(["sub-account", "list"]).name, "sub_account_list");
  assert.ok(tools.every((tool) => tool.operation === "read"));
  assert.ok(tools.every((tool) => tool.errorCodes.length > 0));
});

test("every registered Tool has one matching OpenAPI contract and routing preference", () => {
  const registry = createToolRegistry();
  const rawMarketTools = new Set(["market_get_symbols", "market_get_ticker", "market_get_depth", "market_get_trades", "market_get_klines"]);
  for (const tool of registry.list()) {
    assert.deepEqual(tool.openApiContract, OPENAPI_CONTRACTS[tool.name], `${tool.name} must use the manifest contract`);
    assert.equal(tool.openApiContract?.authentication, tool.access, `${tool.name} authentication must match Tool access`);
    assert.equal(tool.agentRouting?.preference, rawMarketTools.has(tool.name) ? "advanced" : "default");
    assert.ok(tool.agentRouting?.selectionHint.length);
  }
});

test("registry applies the same input validation for every adapter", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    api: new AiHubSpotApi("https://api.example.com")
  };
  await assert.rejects(
    registry.execute("market_get_depth", { symbol: "btcusdt", limit: 101 }, context),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
  assert.deepEqual(registry.capabilities(context).find((tool) => tool.name === "account_get_asset_balance")?.status, "requires_auth");
});

test("list tools share a default of 20 and reject values above 50", () => {
  const registry = createToolRegistry();
  assert.deepEqual(registry.byName("market_list_symbols").validate({}), { quoteAsset: undefined, offset: 0, limit: 20 });
  assert.deepEqual(registry.byName("market_get_symbol_overview").validate({}), { limit: 20 });
  assert.deepEqual(registry.byName("market_search_symbols").validate({ query: "BTC" }), { query: "BTC", quoteAsset: undefined, limit: 20 });
  assert.deepEqual(registry.byName("market_get_depth").validate({ symbol: "BTCUSDT" }), { symbol: "BTCUSDT", limit: 20 });
  assert.deepEqual(registry.byName("spot_get_open_orders").validate({}), { symbol: undefined, limit: 20 });
  assert.deepEqual(registry.byName("margin_get_fills").validate({ symbol: "BTCUSDT" }), { symbol: "BTCUSDT", limit: 20 });
  assert.deepEqual(registry.byName("spot_get_history_orders").validate({ symbol: "BTCUSDT" }), { symbol: "BTCUSDT", page: 1, limit: 20, startTime: undefined, endTime: undefined });
  assert.deepEqual(registry.byName("wallet_get_deposit_history").validate({}), { page: 1, pageSize: 20 });
  assert.deepEqual(registry.byName("sub_account_get_root_transfer_history").validate({ subUid: "1", coinSymbol: "USDT" }), { subUid: "1", coinSymbol: "USDT", page: 1, pageSize: 20 });
  for (const [name, input] of [
    ["market_get_depth", { symbol: "BTCUSDT", limit: 51 }],
    ["spot_get_open_orders", { limit: 51 }],
    ["margin_get_fills", { symbol: "BTCUSDT", limit: 51 }],
    ["spot_get_history_orders", { limit: 51 }],
    ["wallet_get_deposit_history", { pageSize: 51 }],
    ["sub_account_get_root_transfer_history", { subUid: "1", coinSymbol: "USDT", pageSize: 51 }]
  ] as const) {
    assert.throws(() => registry.byName(name).validate(input), (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT");
  }
  assert.throws(
    () => registry.byName("spot_get_history_orders").validate({}),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
});

test("spot and margin orders use the service's direct advanced type and conditional-order fields", () => {
  const registry = createToolRegistry();

  const postOnly = registry.byName("spot_limit_order").validate({ symbol: "BTCUSDT", side: "BUY", type: "POST_ONLY", baseQuantity: "0.001", price: "60000" }) as Record<string, unknown>;
  assert.equal(postOnly.type, "POST_ONLY");
  assert.equal(postOnly.price, "60000");

  const stopLimit = registry.byName("spot_stop_limit_order").validate({ symbol: "BTCUSDT", side: "SELL", baseQuantity: "0.001", price: "59000", triggerPrice: "59500" }) as Record<string, unknown>;
  assert.deepEqual({ type: stopLimit.type, volume: stopLimit.volume, price: stopLimit.price, triggerPrice: stopLimit.triggerPrice }, { type: "STOP", volume: "0.001", price: "59000", triggerPrice: "59500" });

  const stopMarketBuy = registry.byName("spot_stop_market_buy").validate({ symbol: "ETHUSDT", quoteAmount: "100", triggerPrice: "2000" }) as Record<string, unknown>;
  assert.deepEqual({ type: stopMarketBuy.type, volume: stopMarketBuy.volume, triggerPrice: stopMarketBuy.triggerPrice }, { type: "STOP_MARKET", volume: "100", triggerPrice: "2000" });

  const marginFok = registry.byName("margin_limit_order").validate({ symbol: "BTCUSDT", side: "BUY", type: "FOK", baseQuantity: "0.001", price: "60000" }) as Record<string, unknown>;
  assert.equal(marginFok.type, "FOK");

  assert.throws(
    () => registry.byName("spot_limit_order").validate({ symbol: "BTCUSDT", side: "BUY", type: "STOP", baseQuantity: "0.001", price: "60000" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
  assert.throws(
    () => registry.byName("spot_stop_market_buy").validate({ symbol: "ETHUSDT", quoteAmount: "100", triggerPrice: "2000", price: "2001" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
  assert.throws(
    () => registry.byName("spot_batch_place_orders").validate({ symbol: "BTCUSDT", orders: [{ side: "SELL", type: "STOP", baseQuantity: "0.001", price: "59000", triggerPrice: "59500" }] }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
});

test("batch-order Schema declares object items and internal-transfer history rejects Spot as the selected account", () => {
  const registry = createToolRegistry();
  const orders = registry.byName("spot_batch_place_orders").inputSchema.properties?.orders as Record<string, unknown>;
  assert.equal(orders.type, "array");
  assert.equal((orders.items as Record<string, unknown>).type, "object");
  assert.deepEqual((orders.items as Record<string, unknown>).required, ["side", "type"]);
  assert.deepEqual(
    registry.byName("sub_account_get_internal_transfer_history").validate({ subUid: "1", type: "1", accountType: "2", coinSymbol: "USDT" }),
    { subUid: "1", type: "1", accountType: "2", coinSymbol: "USDT", page: 1, pageSize: 20 }
  );
  assert.throws(
    () => registry.byName("sub_account_get_internal_transfer_history").validate({ subUid: "1", type: "1", accountType: "1", coinSymbol: "USDT" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT" && error.message.includes("implicit")
  );
});

test("spot order reads and previews use the physical tenant symbol", async () => {
  const registry = createToolRegistry();
  const requested: Array<{ kind: string; symbol?: string }> = [];
  const context = {
    profile: { name: "hybrid-order-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "test-version" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "BTC1701USDT1701", SymbolName: "BTC/USDT", quantityPrecision: 5, pricePrecision: 2, limitVolumeMin: "0.00001", limitAmountMin: "0", limitPriceMin: "0.01" }] }),
      getOrder: async (input: { symbol: string }) => { requested.push({ kind: "get", symbol: input.symbol }); return { orderId: "1" }; },
      placeOrder: async (input: { symbol: string }) => { requested.push({ kind: "place", symbol: input.symbol }); return { orderId: "2" }; }
    }
  } as never;
  await registry.execute("spot_get_order", { symbol: "BTCUSDT", orderId: "1" }, context);
  let preparedPayload: Record<string, unknown> | undefined;
  const prepared = await registry.prepareWrite("spot_limit_order", { symbol: "BTCUSDT", side: "BUY", baseQuantity: "0.001", price: "50000" }, context, {
    prepare: (input) => { preparedPayload = input.payload; return { confirmationId: "test", expiresAt: "2026-01-01T00:00:00.000Z", requestHash: "hash", action: input.action, summary: input.summary, requiresNewUserConfirmation: true, nextStep: "wait" }; }
  });
  assert.deepEqual(requested, [{ kind: "get", symbol: "BTC1701USDT1701" }]);
  assert.equal(preparedPayload?.symbol, "BTC1701USDT1701");
  assert.equal(prepared.summary.symbol, "BTC/USDT");
  assert.equal(prepared.summary.apiSymbol, "BTC1701USDT1701");
  assert.deepEqual(prepared.summary.estimatedNotional, { amount: "50", asset: null, apiAsset: null, status: "DETERMINISTIC", basis: "BASE_QUANTITY_X_LIMIT_PRICE" });
});

test("spot order test reuses symbol precision and minimum validation before OpenAPI", async () => {
  const registry = createToolRegistry();
  let submitted = 0;
  let submittedBody: Record<string, unknown> | undefined;
  const context = {
    profile: { name: "test-order-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "test-version" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "BTC1701USDT1701", SymbolName: "BTC/USDT", quantityPrecision: 5, pricePrecision: 2, limitVolumeMin: "0.0001", limitAmountMin: "10", limitPriceMin: "0.01" }] }),
      signedPost: async (_path: string, body: Record<string, unknown>) => { submitted += 1; submittedBody = body; return { code: "0" }; }
    }
  } as never;

  await assert.rejects(
    registry.execute("spot_test_order", { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", baseQuantity: "0.00001", price: "60000" }, context),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET"
  );
  await assert.rejects(
    registry.execute("spot_test_order", { symbol: "BTCUSDT", side: "SELL", type: "LIMIT", baseQuantity: "0.0001", price: "60000.001" }, context),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_PRECISION_INVALID"
  );
  assert.equal(submitted, 0);
  await registry.execute("spot_test_order", { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", baseQuantity: "0.001", price: "60000", newClientOrderId: "test-1" }, context);
  assert.equal(submitted, 1);
  assert.deepEqual(submittedBody, {
    symbol: "BTC1701USDT1701",
    volume: "0.001",
    side: "BUY",
    type: "LIMIT",
    newClientOrderId: "test-1",
    price: "60000"
  });
});

test("symbol info exposes market minimums and shared preflight applies them to spot batch and margin orders", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "market-minimum-tool-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "test-version" },
    api: {
      symbols: async () => ({ symbols: [{
        symbol: "ETHUSDT",
        SymbolName: "ETH/USDT",
        baseAsset: "ETH",
        quoteAsset: "USDT",
        quantityPrecision: 4,
        pricePrecision: 2,
        marketBuyMin: "10",
        marketSellMin: "0.001"
      }] })
    }
  } as never;

  const info = await registry.execute("market_get_symbol_info", { symbol: "ETHUSDT" }, context) as Record<string, unknown>;
  assert.equal(info.marketBuyMin, "10");
  assert.equal(info.marketSellMin, "0.001");

  await assert.rejects(
    registry.prepareWrite("spot_batch_place_orders", {
      symbol: "ETHUSDT",
      orders: [{ side: "BUY", type: "MARKET", quoteAmount: "9.99" }]
    }, context, { prepare: (input) => input as never }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET"
  );
  await assert.rejects(
    registry.prepareWrite("spot_batch_place_orders", {
      symbol: "ETHUSDT",
      orders: [{ side: "SELL", type: "MARKET", baseQuantity: "0.0009" }]
    }, context, { prepare: (input) => input as never }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET"
  );
  await assert.rejects(
    registry.prepareWrite("margin_market_buy", { symbol: "ETHUSDT", quoteAmount: "9.99" }, context, { prepare: (input) => input as never }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET"
  );
  await assert.rejects(
    registry.prepareWrite("margin_market_sell", { symbol: "ETHUSDT", baseQuantity: "0.0009" }, context, { prepare: (input) => input as never }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET"
  );
});

test("cancel previews show the display symbol and submit only the physical symbol", async () => {
  const registry = createToolRegistry();
  const submitted: Array<{ path: string; body: Record<string, unknown> }> = [];
  const context = {
    profile: { name: "cancel-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "test-version" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "BTC1701USDT1701", SymbolName: "BTC/USDT", baseAsset: "BTC1701", quoteAsset: "USDT1701", baseAssetName: "BTC", quoteAssetName: "USDT" }] }),
      cancelOrder: async (body: Record<string, unknown>) => { submitted.push({ path: "/sapi/v2/cancel", body }); return { code: "0" }; },
      signedPost: async (path: string, body: Record<string, unknown>) => { submitted.push({ path, body }); return { code: "0" }; }
    }
  } as never;
  const confirmations = {
    prepare: (input: { action: string; payload: Record<string, unknown>; summary: Record<string, unknown> }) => ({ confirmationId: input.action, expiresAt: "2026-01-01T00:00:00.000Z", requestHash: "hash", action: input.action, summary: input.summary, requiresNewUserConfirmation: true, nextStep: "wait" })
  };

  const single = await registry.prepareWrite("spot_cancel_order", { symbol: "BTCUSDT", orderId: "1" }, context, confirmations);
  const batch = await registry.prepareWrite("spot_batch_cancel_orders", { symbol: "BTCUSDT", orderIds: ["1", "2"] }, context, confirmations);
  const margin = await registry.prepareWrite("margin_cancel_order", { symbol: "BTCUSDT", orderId: "3", isolated: true }, context, confirmations);
  assert.equal(single.summary.symbol, "BTC/USDT");
  assert.equal(single.summary.apiSymbol, "BTC1701USDT1701");
  assert.equal(batch.summary.symbol, "BTC/USDT");
  assert.equal(batch.summary.apiSymbol, "BTC1701USDT1701");
  assert.equal(margin.summary.symbol, "BTC/USDT");
  assert.equal(margin.summary.apiSymbol, "BTC1701USDT1701");

  const singleResult = await registry.executeConfirmed("spot_cancel_order", { symbol: "BTC1701USDT1701", requestedSymbol: "BTCUSDT", displaySymbol: "BTC/USDT", orderId: "1" }, context);
  const batchResult = await registry.executeConfirmed("spot_batch_cancel_orders", { symbol: "BTC1701USDT1701", requestedSymbol: "BTCUSDT", displaySymbol: "BTC/USDT", orderIds: ["1", "2"] }, context);
  await registry.executeConfirmed("margin_cancel_order", { symbol: "BTC1701USDT1701", requestedSymbol: "BTCUSDT", displaySymbol: "BTC/USDT", orderId: "3", isolated: true }, context);
  assert.deepEqual(singleResult, {
    code: "0",
    accepted: true,
    acceptedOrderIds: ["1"],
    failedOrderIds: [],
    resultMeaning: "CANCEL_REQUEST_ACCEPTED",
    finalStatusConfirmed: false,
    message: "Cancellation request accepted. Query the order to confirm its final status."
  });
  assert.deepEqual(batchResult, {
    code: "0",
    accepted: false,
    acceptedOrderIds: [],
    failedOrderIds: [],
    resultMeaning: "CANCEL_REQUEST_NOT_ACCEPTED",
    finalStatusConfirmed: false,
    message: "No cancellation request was accepted. Review failedOrderIds before taking another action."
  });
  assert.deepEqual(submitted, [
    { path: "/sapi/v2/cancel", body: { symbol: "BTC1701USDT1701", orderId: "1" } },
    { path: "/sapi/v2/batchCancel", body: { symbol: "BTC1701USDT1701", orderIds: ["1", "2"] } },
    { path: "/sapi/v2/margin/cancel", body: { symbol: "BTC1701USDT1701", orderId: "3", isolated: true } }
  ]);
});

test("batch cancellation keeps legacy fields but describes accepted requests instead of final cancellation", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "cancel-result", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "test-version" },
    api: {
      signedPost: async () => ({
        success: [3392648508930605422n, "3392648508930605423"],
        failed: ["3392648508930605424"]
      })
    }
  } as never;

  const result = await registry.executeConfirmed("spot_batch_cancel_orders", {
    symbol: "BTC1701USDT1701",
    orderIds: ["3392648508930605422", "3392648508930605423", "3392648508930605424"]
  }, context) as Record<string, unknown>;

  assert.deepEqual(result.success, [3392648508930605422n, "3392648508930605423"]);
  assert.deepEqual(result.failed, ["3392648508930605424"]);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.acceptedOrderIds, ["3392648508930605422", "3392648508930605423"]);
  assert.deepEqual(result.failedOrderIds, ["3392648508930605424"]);
  assert.equal(result.resultMeaning, "CANCEL_REQUEST_ACCEPTED");
  assert.equal(result.finalStatusConfirmed, false);
  assert.match(String(result.message), /accepted/i);
  assert.doesNotMatch(String(result.message), /successfully cancelled/i);
});

test("batch spot orders compile semantic quantities to the service BatchParam body", async () => {
  const registry = createToolRegistry();
  let preparedPayload: Record<string, unknown> | undefined;
  let submittedBody: Record<string, unknown> | undefined;
  const context = {
    profile: { name: "hybrid-batch-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "test-version" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "BTC1701USDT1701", SymbolName: "BTC/USDT", baseAsset: "BTC1701", quoteAsset: "USDT1701", baseAssetName: "BTC", quoteAssetName: "USDT", quantityPrecision: 5, pricePrecision: 2, limitVolumeMin: "0.00001", limitAmountMin: "0", limitPriceMin: "0.01" }] }),
      ticker: async () => ({ last: "50000", time: "1" }),
      signedPost: async (_path: string, body: Record<string, unknown>) => { submittedBody = body; return { code: "0" }; }
    }
  } as never;
  const prepared = await registry.prepareWrite("spot_batch_place_orders", {
    symbol: "BTC/USDT",
    orders: [
      { side: "BUY", type: "MARKET", quoteAmount: "10", newClientOrderId: "buy-1" },
      { side: "SELL", type: "MARKET", baseQuantity: "0.001", newClientOrderId: "sell-1" },
      { side: "BUY", type: "LIMIT", baseQuantity: "0.002", price: "50000", newClientOrderId: "limit-1" }
    ]
  }, context, {
    prepare: (input) => {
      preparedPayload = input.payload;
      return { confirmationId: "batch", expiresAt: "2026-01-01T00:00:00.000Z", requestHash: "hash", action: input.action, summary: input.summary, requiresNewUserConfirmation: true, nextStep: "wait" };
    }
  });
  assert.equal(prepared.summary.symbol, "BTC/USDT");
  assert.equal(prepared.summary.apiSymbol, "BTC1701USDT1701");
  assert.deepEqual((prepared.summary.orders as Array<Record<string, unknown>>)[0]?.quantityOrAmount, { value: "10", asset: "USDT", apiAsset: "USDT1701", meaning: "exact quote-asset amount to spend" });
  assert.equal((prepared.summary.orders as Array<Record<string, unknown>>)[2]?.client_order_id, "limit-1");
  assert.deepEqual(prepared.summary.notionalTotals, {
    deterministicTotalNotional: { amount: "110", asset: "USDT", apiAsset: "USDT1701", status: "DETERMINISTIC" },
    indicativeTotalNotional: { amount: "50", asset: "USDT", apiAsset: "USDT1701", status: "INDICATIVE" },
    unavailableCount: 0
  });
  await registry.executeConfirmed("spot_batch_place_orders", preparedPayload!, context);
  assert.deepEqual(submittedBody, {
    symbol: "BTC1701USDT1701",
    orders: [
      { side: "BUY", batchType: "MARKET", volume: "10", client_order_id: "buy-1" },
      { side: "SELL", batchType: "MARKET", volume: "0.001", client_order_id: "sell-1" },
      { side: "BUY", batchType: "LIMIT", volume: "0.002", price: "50000", client_order_id: "limit-1" }
    ]
  });
});

test("wallet identifiers distinguish isolated-margin pairs from withdrawal assets", async () => {
  const registry = createToolRegistry();
  const submitted: Array<{ path: string; body: Record<string, unknown> }> = [];
  const context = {
    profile: { name: "hybrid-wallet-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "test-version" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "BTC1701USDT1701", SymbolName: "BTC/USDT", baseAsset: "BTC1701", quoteAsset: "USDT1701", baseAssetName: "BTC", quoteAssetName: "USDT" }] }),
      signedPost: async (path: string, body: Record<string, unknown>) => { submitted.push({ path, body }); return { code: "0" }; }
    }
  } as never;
  let transferPayload: Record<string, unknown> | undefined;
  const transferPreview = await registry.prepareWrite("wallet_universal_transfer", { fromAccountType: "1", toAccountType: "2", symbol: "BTC/USDT", coinSymbol: "BTC", amount: "0.01" }, context, {
    prepare: (input) => { transferPayload = input.payload; return { confirmationId: "transfer", expiresAt: "2026-01-01T00:00:00.000Z", requestHash: "hash", action: input.action, summary: input.summary, requiresNewUserConfirmation: true, nextStep: "wait" }; }
  });
  assert.deepEqual(transferPreview.summary.quantityOrAmount, { value: "0.01", asset: "BTC", apiAsset: "BTC1701", meaning: "exact asset amount to transfer" });
  await registry.executeConfirmed("wallet_universal_transfer", transferPayload!, context);
  let withdrawPayload: Record<string, unknown> | undefined;
  await registry.prepareWrite("wallet_create_withdraw", { withdrawOrderId: "withdraw-1", symbol: "BTC", amount: "0.01", address: "test-address" }, context, {
    prepare: (input) => { withdrawPayload = input.payload; return { confirmationId: "withdraw", expiresAt: "2026-01-01T00:00:00.000Z", requestHash: "hash", action: input.action, summary: input.summary, requiresNewUserConfirmation: true, nextStep: "wait" }; }
  });
  await registry.executeConfirmed("wallet_create_withdraw", withdrawPayload!, context);
  assert.deepEqual(submitted, [
    { path: "/sapi/v1/asset/universal_transfer", body: { fromAccountType: "1", toAccountType: "2", symbol: "BTC1701USDT1701", coinSymbol: "BTC1701", amount: "0.01" } },
    { path: "/sapi/v1/withdraw/apply", body: { withdrawOrderId: "withdraw-1", symbol: "BTC1701", amount: "0.01", address: "test-address" } }
  ]);
});

test("ticker summary uses one total response budget and a short shared source cache", async () => {
  clearTickerSummaryCache();
  const registry = createToolRegistry();
  let tickerCalls = 0;
  const tickers = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ADA", "LINK"].map((asset, index) => ({
    symbol: `${asset}/USDT`, last: String(index + 1), rose: String(index / 100), amount: String(index + 10), vol: "1", high: "1", low: "1", time: 1
  }));
  const context = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    api: { ticker: async () => { tickerCalls += 1; return tickers; } }
  } as never;
  const first = await registry.execute("market_get_ticker_summary", {}, context) as Record<string, unknown>;
  const second = await registry.execute("market_get_ticker_summary", {}, context) as Record<string, unknown>;
  assert.equal(tickerCalls, 1);
  assert.equal(first.returnedSymbols, 20);
  assert.equal(
    (first.watchlist as unknown[]).length + (first.topGainers as unknown[]).length + (first.topLosers as unknown[]).length + (first.topByQuoteVolume as unknown[]).length,
    first.returnedSymbols
  );
  assert.deepEqual(second, first);
  const bounded = await registry.execute("market_get_ticker_summary", { limit: 50 }, context) as Record<string, unknown>;
  assert.ok(Number(bounded.returnedSymbols) <= 50);
  clearTickerSummaryCache();
});

test("Core caps unpaged upstream lists and describes continuation availability", async () => {
  const registry = createToolRegistry();
  for (const [name, path] of [
    ["wallet_get_deposit_address", ["data", "depositAddrList"]],
    ["wallet_get_withdraw_address", ["data", "addressList"]],
    ["wallet_get_transferable_assets", ["data", "accountList"]],
    ["sub_account_get_api_key_ips", ["data", "apiList"]],
    ["sub_account_get_assets", ["data", "accountList"]]
  ] as const) assert.deepEqual(registry.byName(name).unpagedListLimit?.path, path);
  const items = Array.from({ length: 55 }, (_, id) => ({ id }));
  const context = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "test-version" },
    api: { signedPost: async (path: string) => path.includes("withdraw/query") ? { code: "0", data: { withdrawList: items, count: items.length } } : { code: "0", data: { subUserList: items } } }
  } as never;
  const withdrawals = await registry.execute("wallet_get_withdraw_history", { page: 2 }, context) as { data: Record<string, unknown> };
  assert.equal((withdrawals.data.withdrawList as unknown[]).length, 50);
  assert.deepEqual(withdrawals.data.continuation, { available: true, page: 3 });
  assert.equal(withdrawals.data.truncated, true);
  const subAccounts = await registry.execute("sub_account_list", {}, context) as { data: Record<string, unknown> };
  assert.equal((subAccounts.data.subUserList as unknown[]).length, 50);
  assert.deepEqual(subAccounts.data.continuation, { available: false, reason: "The upstream endpoint does not expose a continuation parameter." });
});

test("wallet tools preserve the server's Spot, Margin, C2C, and Derivatives account semantics", async () => {
  const registry = createToolRegistry();
  const universalTransfer = registry.byName("wallet_universal_transfer");
  const transferableAssets = registry.byName("wallet_get_transferable_assets");

  assert.deepEqual(
    universalTransfer.validate({ coinSymbol: "USDT", amount: "1", fromAccountType: "1", toAccountType: "5" }),
    { coinSymbol: "USDT", amount: "1", fromAccountType: "1", toAccountType: "5" }
  );
  assert.throws(
    () => universalTransfer.validate({ coinSymbol: "USDT", amount: "1", fromAccountType: "1", toAccountType: "2" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_ISOLATED_MARGIN_SYMBOL_REQUIRED"
  );
  assert.deepEqual(
    universalTransfer.writeSummary?.({ coinSymbol: "USDT", amount: "1", fromAccountType: "1", toAccountType: "5" }),
    {
      action: "universal_transfer",
      fromAccountType: "1",
      fromAccountTypeName: "Spot",
      toAccountType: "5",
      toAccountTypeName: "Derivatives",
      coinSymbol: "USDT",
      apiCoinSymbol: "USDT",
      amount: "1",
      symbol: null,
      apiSymbol: null,
      quantityOrAmount: { value: "1", asset: "USDT", apiAsset: "USDT", meaning: "exact asset amount to transfer" },
      estimatedNotional: { amount: null, status: "not_applicable", explanation: "A transfer changes account location, not its asset value." }
    }
  );

  const context = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "test-version" },
    api: { signedPost: async () => ({ code: "0", msg: "Success", data: { accountList: [] } }) }
  } as never;
  assert.deepEqual(
    await transferableAssets.handler({ accountType: "5" }, context),
    { code: "0", msg: "Success", data: { accountList: [] }, accountType: "5", accountTypeName: "Derivatives" }
  );
});

test("kline tools expose OpenAPI intervals and normalize safe chart aliases", async () => {
  const registry = createToolRegistry();
  const raw = registry.byName("market_get_klines");
  const summary = registry.byName("market_get_klines_summary");
  const rawInterval = raw.inputSchema.properties?.interval as { enum?: readonly string[] };
  assert.deepEqual(rawInterval.enum, ["1min", "5min", "15min", "30min", "60min", "1day", "1week", "1month"]);
  assert.deepEqual(summary.inputSchema.required, ["symbol"]);

  let received: unknown;
  const context = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    api: { symbols: async () => ({ symbols: [{ symbol: "ETHUSDT", SymbolName: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT" }] }), klines: async (input: unknown) => { received = input; return []; } }
  } as never;
  await registry.execute("market_get_klines", { symbol: "ETH/USDT", interval: "1h", limit: 50 }, context);
  assert.deepEqual(received, { symbol: "ETHUSDT", interval: "60min", startTime: undefined, endTime: undefined, timezone: undefined, limit: 50 });

  await registry.execute("market_get_klines_summary", { symbol: "ETHUSDT" }, context);
  assert.deepEqual(received, { symbol: "ETHUSDT", interval: "60min", startTime: undefined, endTime: undefined, timezone: undefined, limit: 20 });
  await assert.rejects(
    registry.execute("market_get_klines", { symbol: "ETHUSDT", interval: "4h" }, context),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT" && error.message.includes("60min")
  );
  await assert.rejects(
    registry.execute("market_get_klines", { symbol: "ETHUSDT", interval: "60min", startTime: 2, endTime: 1 }, context),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT" && error.message.includes("startTime")
  );
  await assert.rejects(
    registry.execute("market_get_klines", { symbol: "ETHUSDT", interval: "60min", limit: 51 }, context),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT" && error.message.includes("50")
  );

  let historicalReceived: unknown;
  const historicalContext = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    api: { symbols: async () => ({ symbols: [{ symbol: "ETHUSDT", SymbolName: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT" }] }), historicalMinuteKlines: async (input: unknown) => { historicalReceived = input; return Array.from({ length: 25 }, (_item, index) => ({ idx: index })); } }
  } as never;
  const historical = await registry.execute("market_get_historical_minute_klines", { symbol: "ETHUSDT" }, historicalContext) as Record<string, unknown>;
  assert.deepEqual(historicalReceived, { symbol: "ETHUSDT", startTime: undefined, endTime: undefined });
  assert.equal(historical.returnedCount, 20);
  assert.equal(historical.totalCandles, 25);
  assert.equal(historical.truncated, true);
});

test("registry contains every migrated non-derivatives API capability", () => {
  const registry = createToolRegistry();
  const expected = [
    "market_ping", "market_get_historical_minute_klines", "account_get_asset_balance", "spot_test_order", "spot_get_history_orders", "spot_market_buy", "spot_market_sell", "spot_limit_order", "spot_stop_limit_order", "spot_stop_market_buy", "spot_stop_market_sell", "spot_batch_place_orders", "spot_batch_cancel_orders",
    "margin_get_order", "margin_get_open_orders", "margin_get_fills", "margin_market_buy", "margin_market_sell", "margin_limit_order", "margin_stop_limit_order", "margin_stop_market_buy", "margin_stop_market_sell", "margin_cancel_order",
    "wallet_universal_transfer", "wallet_get_universal_transfer_history", "wallet_get_deposit_history", "wallet_get_deposit_address", "wallet_get_withdraw_address", "wallet_get_transferable_assets", "wallet_create_withdraw", "wallet_get_withdraw_history",
    "sub_account_list", "sub_account_create", "sub_account_update_trading_status", "sub_account_get_api_key_ips", "sub_account_update_api_key_ips", "sub_account_delete_api_key", "sub_account_get_assets", "sub_account_root_transfer", "sub_account_get_root_transfer_history", "sub_account_internal_transfer", "sub_account_get_internal_transfer_history"
  ];
  for (const name of expected) assert.ok(registry.byName(name));
  assert.equal(registry.byName("spot_test_order").operation, "read");
  for (const name of ["spot_get_account", "account_transfer", "account_get_transfer_history", "wallet_get_exchange_account", "sub_account_transfer_to_parent", "sub_account_get_parent_transfer_history"]) {
    assert.throws(() => registry.byName(name), (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_TOOL_NOT_AVAILABLE");
  }
  const writes = ["spot_market_buy", "spot_market_sell", "spot_limit_order", "spot_stop_limit_order", "spot_stop_market_buy", "spot_stop_market_sell", "spot_batch_place_orders", "spot_batch_cancel_orders", "margin_market_buy", "margin_market_sell", "margin_limit_order", "margin_stop_limit_order", "margin_stop_market_buy", "margin_stop_market_sell", "margin_cancel_order", "wallet_universal_transfer", "wallet_create_withdraw", "sub_account_create", "sub_account_update_trading_status", "sub_account_update_api_key_ips", "sub_account_delete_api_key", "sub_account_root_transfer", "sub_account_internal_transfer"];
  for (const name of writes) {
    assert.equal(registry.byName(name).operation, "write", `${name} must require confirmation`);
  }
});
