import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AiHubError, clearSymbolRuleCache, getCachedSymbols, getSymbolRule, preflightSymbolOrder, type ToolExecutionContext } from "../src/index.js";

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

  const snapshot = await getCachedSymbols(context);
  const first = await getSymbolRule(context, "BTC/USDT");
  const second = await getSymbolRule(context, "btcusdt");
  assert.equal(calls, 1);
  assert.deepEqual(snapshot, { symbols: [{ symbol: "BTCUSDT", quantityPrecision: 5, pricePrecision: 2, limitVolumeMin: "0.00002", limitAmountMin: "0", limitPriceMin: "0.01" }] });
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

test("persists an isolated public symbol snapshot without retaining credentials", async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), "ai-hub-symbol-cache-"));
  const previousDisable = process.env.AI_HUB_DISABLE_PERSISTENT_CACHE;
  const previousDirectory = process.env.AI_HUB_CACHE_DIR;
  delete process.env.AI_HUB_DISABLE_PERSISTENT_CACHE;
  process.env.AI_HUB_CACHE_DIR = cacheDirectory;
  clearSymbolRuleCache();
  let calls = 0;
  const context = {
    profile: { name: "tenant-persistent", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: {
      symbols: async () => {
        calls += 1;
        return { symbols: [{ symbol: "ETHUSDT", quantityPrecision: 4, pricePrecision: 2 }] };
      }
    }
  } as unknown as ToolExecutionContext;
  try {
    await getCachedSymbols(context);
    clearSymbolRuleCache();
    await getCachedSymbols(context);
    assert.equal(calls, 1);
    const files = await readdir(cacheDirectory);
    assert.equal(files.length, 1);
    assert.equal((await stat(join(cacheDirectory, files[0] ?? ""))).mode & 0o777, 0o600);
  } finally {
    clearSymbolRuleCache();
    if (previousDisable === undefined) delete process.env.AI_HUB_DISABLE_PERSISTENT_CACHE;
    else process.env.AI_HUB_DISABLE_PERSISTENT_CACHE = previousDisable;
    if (previousDirectory === undefined) delete process.env.AI_HUB_CACHE_DIR;
    else process.env.AI_HUB_CACHE_DIR = previousDirectory;
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});
