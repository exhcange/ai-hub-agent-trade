import assert from "node:assert/strict";
import test from "node:test";
import { matchAiHubFastRoute, renderAiHubFastResult } from "../src/index.js";

test("fast router recognizes bounded AIHub balance and current-price reads", () => {
  assert.deepEqual(matchAiHubFastRoute("aihub 看现货资产余额"), {
    kind: "balance-list", toolName: "account_list_balances", input: {}
  });
  assert.deepEqual(matchAiHubFastRoute("AIHub 查询 USDT 现货余额"), {
    kind: "asset-balance", toolName: "account_get_asset_balance", input: { asset: "USDT" }
  });
  assert.deepEqual(matchAiHubFastRoute("aihub show spot balances including zero"), {
    kind: "balance-list", toolName: "account_list_balances", input: { nonZeroOnly: false }
  });
  assert.deepEqual(matchAiHubFastRoute("aihub show my spot balances"), {
    kind: "balance-list", toolName: "account_list_balances", input: {}
  });
  assert.deepEqual(matchAiHubFastRoute("aihub 查 BTC/USDT 当前价格"), {
    kind: "last-price", toolName: "market_get_last_price", input: { symbol: "BTCUSDT" }
  });
  assert.deepEqual(matchAiHubFastRoute("aihub show open orders BTCUSDT"), {
    kind: "open-orders", toolName: "spot_get_open_orders", input: { symbol: "BTCUSDT" }
  });
});

test("fast router declines ambiguous or unprefixed requests", () => {
  assert.equal(matchAiHubFastRoute("看资产余额"), null);
  assert.equal(matchAiHubFastRoute("aihub 帮我分析一下 BTC 是否适合买入"), null);
  assert.equal(matchAiHubFastRoute("aihub 分析 BTCUSDT 价格趋势"), null);
  assert.equal(matchAiHubFastRoute("aihub 用 USDT 余额买入 ETH"), null);
  assert.equal(matchAiHubFastRoute("aihub show market price"), null);
  assert.equal(matchAiHubFastRoute("aihub BTC 价格"), null, "a base asset without an exact market must fall back to the Agent");
});

test("fast result renderer returns final compact text", () => {
  const route = matchAiHubFastRoute("aihub 看现货资产余额");
  assert.ok(route);
  assert.equal(renderAiHubFastResult(route, { balances: [
    { asset: "USDT", total: "10", available: "9", frozen: "1" },
    { asset: "BTC", total: "0.1", available: "0.1", frozen: "0" }
  ] }), "USDT: total 10, available 9, frozen 1\nBTC: total 0.1, available 0.1");
});

 test("unspecified balances use dual accounts and explicit Futures never route to spot", () => {
  assert.equal(matchAiHubFastRoute("aihub 查询余额")?.kind, "dual-balances");
  assert.equal(matchAiHubFastRoute("aihub 查询合约余额")?.toolName, "futures_assets");
  assert.equal(matchAiHubFastRoute("aihub 合约当前挂单"), null);
});
