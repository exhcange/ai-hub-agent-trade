import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, AiHubSpotApi, createToolRegistry } from "../src/index.js";

test("registry is the unique source for CLI paths and read-only visibility", () => {
  const registry = createToolRegistry();
  const tools = registry.list({ readOnly: true });
  assert.ok(tools.length >= 29);
  assert.equal(registry.byCliPath(["market", "depth"]).name, "market_get_depth");
  assert.equal(registry.byName("market_get_symbols").mcpVisible, false);
  assert.equal(registry.byCliPath(["account", "get"]).name, "spot_get_account");
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
  assert.deepEqual(registry.capabilities(context).find((tool) => tool.name === "spot_get_account")?.status, "requires_auth");
});

test("transfer tools preserve the server's Spot, Margin, C2C, and Derivatives account semantics", async () => {
  const registry = createToolRegistry();
  const spotDerivativesTransfer = registry.byName("account_transfer");
  const universalTransfer = registry.byName("wallet_universal_transfer");
  const transferableAssets = registry.byName("wallet_get_transferable_assets");

  assert.deepEqual(
    spotDerivativesTransfer.validate({ coinSymbol: "USDT", amount: "1", fromAccount: "exchange", toAccount: "future" }),
    { coinSymbol: "USDT", amount: "1", fromAccount: "EXCHANGE", toAccount: "FUTURE" }
  );
  assert.throws(
    () => spotDerivativesTransfer.validate({ coinSymbol: "USDT", amount: "1", fromAccount: "1", toAccount: "2" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT" && error.message.includes("EXCHANGE")
  );
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
  await registry.execute("market_get_klines", { symbol: "ETH/USDT", interval: "1h", limit: 300 }, context);
  assert.deepEqual(received, { symbol: "ETH/USDT", interval: "60min", startTime: undefined, endTime: undefined, timezone: undefined, limit: 300 });

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
});

test("registry contains every migrated non-derivatives API capability", () => {
  const registry = createToolRegistry();
  const expected = [
    "market_ping", "spot_test_order", "spot_market_buy", "spot_market_sell", "spot_limit_order", "spot_batch_place_orders", "spot_batch_cancel_orders",
    "margin_get_order", "margin_get_open_orders", "margin_get_fills", "margin_market_buy", "margin_market_sell", "margin_limit_order", "margin_cancel_order",
    "account_transfer", "account_get_transfer_history",
    "wallet_universal_transfer", "wallet_get_universal_transfer_history", "wallet_get_deposit_history", "wallet_get_deposit_address", "wallet_get_withdraw_address", "wallet_get_transferable_assets", "wallet_get_exchange_account", "wallet_create_withdraw", "wallet_get_withdraw_history",
    "sub_account_list", "sub_account_create", "sub_account_update_trading_status", "sub_account_get_api_key_ips", "sub_account_update_api_key_ips", "sub_account_delete_api_key", "sub_account_get_assets", "sub_account_root_transfer", "sub_account_get_root_transfer_history", "sub_account_internal_transfer", "sub_account_get_internal_transfer_history", "sub_account_transfer_to_parent", "sub_account_get_parent_transfer_history"
  ];
  for (const name of expected) assert.ok(registry.byName(name));
  assert.equal(registry.byName("spot_test_order").operation, "read");
  const writes = ["spot_market_buy", "spot_market_sell", "spot_limit_order", "spot_batch_place_orders", "spot_batch_cancel_orders", "margin_market_buy", "margin_market_sell", "margin_limit_order", "margin_cancel_order", "account_transfer", "wallet_universal_transfer", "wallet_create_withdraw", "sub_account_create", "sub_account_update_trading_status", "sub_account_update_api_key_ips", "sub_account_delete_api_key", "sub_account_root_transfer", "sub_account_internal_transfer", "sub_account_transfer_to_parent"];
  for (const name of writes) {
    assert.equal(registry.byName(name).operation, "write", `${name} must require confirmation`);
  }
});
