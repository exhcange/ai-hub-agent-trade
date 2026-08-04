import assert from "node:assert/strict";
import test from "node:test";
import { createToolRegistry } from "../src/index.js";

test("common Agent intents resolve to one focused Core Tool", () => {
  const registry = createToolRegistry();
  const expected = [
    ["generic balance", "account_list_balances", "read"],
    ["one-asset balance", "account_get_asset_balance", "read"],
    ["ticker", "market_get_ticker", "read"],
    ["open orders", "spot_get_open_orders", "read"],
    ["market buy", "spot_market_buy", "write"],
    ["limit order", "spot_limit_order", "write"],
    ["cancel order", "spot_cancel_order", "write"],
    ["wallet history", "wallet_get_universal_transfer_history", "read"],
    ["sub-account assets", "sub_account_get_assets", "read"]
  ] as const;
  for (const [_intent, name, operation] of expected) {
    assert.equal(registry.byName(name).operation, operation, `${name} must retain its focused operation type`);
  }
});
