import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, AiHubSpotApi, clearTickerSummaryCache, createToolRegistry } from "../src/index.js";

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
    { action: "universal_transfer", fromAccountType: "1", fromAccountTypeName: "Spot", toAccountType: "5", toAccountTypeName: "Derivatives", coinSymbol: "USDT", amount: "1", symbol: null }
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
    api: { klines: async (input: unknown) => { received = input; return []; } }
  } as never;
  await registry.execute("market_get_klines", { symbol: "ETH/USDT", interval: "1h", limit: 50 }, context);
  assert.deepEqual(received, { symbol: "ETH/USDT", interval: "60min", startTime: undefined, endTime: undefined, timezone: undefined, limit: 50 });

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
    api: { historicalMinuteKlines: async (input: unknown) => { historicalReceived = input; return Array.from({ length: 25 }, (_item, index) => ({ idx: index })); } }
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
