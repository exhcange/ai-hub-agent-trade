import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, createToolRegistry, parseMcpToolset, selectMcpToolset } from "../src/index.js";

test("default MCP Toolset is the approved 24-tool business whitelist", () => {
  const selected = selectMcpToolset(createToolRegistry().list(), "default");
  assert.equal(selected.length, 24);
  for (const name of ["market_get_ticker_summary", "spot_market_buy", "wallet_universal_transfer", "wallet_get_transferable_assets"]) {
    assert.ok(selected.some((tool) => tool.name === name));
  }
  for (const name of ["market_get_symbols", "spot_test_order", "spot_sell_available", "account_get_asset_balance", "margin_get_order", "wallet_create_withdraw", "sub_account_list"]) {
    assert.equal(selected.some((tool) => tool.name === name), false);
  }
});

test("full MCP Toolset includes every remaining Core tool and accepts only supported names", () => {
  const all = createToolRegistry().list();
  assert.equal(all.length, 53);
  assert.equal(selectMcpToolset(all, "full").length, 53);
  assert.equal(parseMcpToolset(undefined), "default");
  assert.equal(parseMcpToolset("full"), "full");
  assert.throws(() => parseMcpToolset("trader"), (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT");
});
