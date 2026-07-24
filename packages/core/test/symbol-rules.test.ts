import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, clearSymbolRuleCache, getSymbolRule, preflightSymbolOrder, type ToolExecutionContext } from "../src/index.js";

test("lazily loads one profile's symbol rules once and validates BTCUSDT precision", async () => {
  clearSymbolRuleCache();
  let calls = 0;
  const context = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: {
      symbols: async () => {
        calls += 1;
        return { symbols: [{ symbol: "BTCUSDT", quantityPrecision: 5, pricePrecision: 2, limitVolumeMin: "0.00002", limitAmountMin: "0", limitPriceMin: "0.01" }] };
      }
    }
  } as unknown as ToolExecutionContext;

  const first = await getSymbolRule(context, "BTC/USDT");
  const second = await getSymbolRule(context, "btcusdt");
  assert.equal(calls, 1);
  assert.equal(first.quantityPrecision, 5);
  assert.equal(first.pricePrecision, 2);
  assert.equal(second.limitVolumeMin, "0.00002");

  await assert.rejects(
    preflightSymbolOrder(context, { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", baseQuantity: "0.000001", price: "65000.123" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_PRECISION_INVALID"
  );
  await assert.rejects(
    preflightSymbolOrder(context, { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", baseQuantity: "0.00001", price: "0.01" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET"
  );
});
