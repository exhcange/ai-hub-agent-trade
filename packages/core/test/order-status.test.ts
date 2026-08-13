import assert from "node:assert/strict";
import test from "node:test";
import { createToolRegistry } from "../src/index.js";
import { normalizeOrderWorkingStatus } from "../src/tools/order-status.js";

const expectedByStatus = new Map<unknown, boolean>([
  ["NEW", true],
  ["FILLED", false],
  ["PART_FILLED", true],
  ["CANCELED", false],
  ["PENDING_CANCEL", true],
  ["REJECTED", false],
  ["STOP_INIT", false],
  [1, true],
  [2, false],
  [3, true],
  [4, false],
  [5, true],
  [6, false],
  [10, false]
]);

test("normalizes isWorking from every authoritative server order status", () => {
  for (const [status, isWorking] of expectedByStatus) {
    assert.deepEqual(
      normalizeOrderWorkingStatus({ orderId: "1", status, isWorking: !isWorking, price: "10" }),
      { orderId: "1", status, isWorking, price: "10" }
    );
  }
});

test("normalizes direct arrays and common OpenAPI list wrappers without dropping fields", () => {
  const direct = [{ orderId: "1", status: "FILLED", isWorking: true }];
  assert.deepEqual(normalizeOrderWorkingStatus(direct), [{ orderId: "1", status: "FILLED", isWorking: false }]);

  const wrapped = {
    code: "0",
    data: {
      count: 2,
      list: [
        { orderId: "2", status: "PART_FILLED", isWorking: false, executedQty: "0.1" },
        { orderId: "3", status: "STOP_INIT", isWorking: true, stopPrice: "100" }
      ]
    }
  };
  assert.deepEqual(normalizeOrderWorkingStatus(wrapped), {
    code: "0",
    data: {
      count: 2,
      list: [
        { orderId: "2", status: "PART_FILLED", isWorking: true, executedQty: "0.1" },
        { orderId: "3", status: "STOP_INIT", isWorking: false, stopPrice: "100" }
      ]
    }
  });
});

test("preserves upstream isWorking for missing or unknown statuses", () => {
  const unknown = { orderId: "1", status: "INIT", isWorking: true };
  const missing = { orderId: "2", isWorking: false };
  assert.equal(normalizeOrderWorkingStatus(unknown), unknown);
  assert.equal(normalizeOrderWorkingStatus(missing), missing);
});

test("ToolRegistry applies the same status normalization to spot and margin order reads", async () => {
  const registry = createToolRegistry();
  const baseContext = {
    profile: { name: "status-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "test-version" }
  };
  const spot = await registry.execute("spot_get_order", { symbol: "BTCUSDT", orderId: "1" }, {
    ...baseContext,
    api: {
      symbols: async () => ({ symbols: [{ symbol: "BTCUSDT", SymbolName: "BTC/USDT" }] }),
      getOrder: async () => ({ code: "0", data: { orderId: "1", status: "CANCELED", isWorking: true } })
    }
  } as never);
  assert.deepEqual(spot, { code: "0", data: { orderId: "1", status: "CANCELED", isWorking: false } });

  const margin = await registry.execute("margin_get_open_orders", { symbol: "BTCUSDT", isolated: true }, {
    ...baseContext,
    api: {
      symbols: async () => ({ symbols: [{ symbol: "BTCUSDT", SymbolName: "BTC/USDT" }] }),
      signedGet: async () => ({ code: "0", data: { list: [{ orderId: "2", status: "PENDING_CANCEL", isWorking: false }] } })
    }
  } as never);
  assert.deepEqual(margin, { code: "0", data: { list: [{ orderId: "2", status: "PENDING_CANCEL", isWorking: true }] } });
});

test("every public order-status read Tool uses the shared Core normalizer", () => {
  const registry = createToolRegistry();
  for (const name of [
    "spot_get_order",
    "spot_get_open_orders",
    "spot_get_history_orders",
    "margin_get_order",
    "margin_get_open_orders"
  ]) {
    const tool = registry.byName(name);
    assert.ok(tool.normalizeResult, `${name} must normalize the server order status`);
    assert.deepEqual(
      tool.normalizeResult?.({ list: [{ orderId: name, status: "FILLED", isWorking: true }] }, {}),
      { list: [{ orderId: name, status: "FILLED", isWorking: false }] }
    );
  }
});
