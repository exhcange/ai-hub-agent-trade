import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, AiHubSpotApi, createToolRegistry } from "../src/index.js";

test("registry is the unique source for CLI paths and read-only visibility", () => {
  const registry = createToolRegistry();
  const tools = registry.list({ readOnly: true });
  assert.ok(tools.length >= 29);
  assert.equal(registry.byCliPath(["market", "depth"]).name, "market_get_depth");
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

test("registry contains every migrated non-derivatives API capability", () => {
  const registry = createToolRegistry();
  const expected = [
    "market_ping", "spot_test_order", "spot_batch_place_orders", "spot_batch_cancel_orders",
    "margin_get_order", "margin_get_open_orders", "margin_get_fills", "margin_place_order", "margin_cancel_order",
    "account_transfer", "account_get_transfer_history",
    "wallet_universal_transfer", "wallet_get_universal_transfer_history", "wallet_get_deposit_history", "wallet_get_deposit_address", "wallet_get_withdraw_address", "wallet_get_transferable_assets", "wallet_get_exchange_account", "wallet_create_withdraw", "wallet_get_withdraw_history",
    "sub_account_list", "sub_account_create", "sub_account_update_trading_status", "sub_account_get_api_key_ips", "sub_account_update_api_key_ips", "sub_account_delete_api_key", "sub_account_get_assets", "sub_account_root_transfer", "sub_account_get_root_transfer_history", "sub_account_internal_transfer", "sub_account_get_internal_transfer_history", "sub_account_transfer_to_parent", "sub_account_get_parent_transfer_history"
  ];
  for (const name of expected) assert.ok(registry.byName(name));
  assert.equal(registry.byName("spot_test_order").operation, "read");
  const writes = ["spot_batch_place_orders", "spot_batch_cancel_orders", "margin_place_order", "margin_cancel_order", "account_transfer", "wallet_universal_transfer", "wallet_create_withdraw", "sub_account_create", "sub_account_update_trading_status", "sub_account_update_api_key_ips", "sub_account_delete_api_key", "sub_account_root_transfer", "sub_account_internal_transfer", "sub_account_transfer_to_parent"];
  for (const name of writes) {
    assert.equal(registry.byName(name).operation, "write", `${name} must require confirmation`);
  }
});
