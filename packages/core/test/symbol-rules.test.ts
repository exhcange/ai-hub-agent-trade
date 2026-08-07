import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AiHubError, clearSymbolRuleCache, getCachedSymbols, getSymbolRule, preflightSymbolOrder, resolveTenantAsset, type ToolExecutionContext } from "../src/index.js";

test("lazily loads one profile's symbol rules once and validates BTCUSDT precision", async () => {
  clearSymbolRuleCache();
  let calls = 0;
  const context = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: {
      symbols: async () => {
        calls += 1;
        return { symbols: [{ symbol: "BTCUSDT", quantityPrecision: 5, pricePrecision: 2, limitVolumeMin: "0.00002", limitAmountMin: "0", limitPriceMin: "0.01", marketBuyMin: "10", marketSellMin: "0.0001" }] };
      }
    }
  } as unknown as ToolExecutionContext;

  const snapshot = await getCachedSymbols(context);
  const first = await getSymbolRule(context, "BTC/USDT");
  const second = await getSymbolRule(context, "btcusdt");
  assert.equal(calls, 1);
  assert.deepEqual(snapshot, { symbols: [{ symbol: "BTCUSDT", quantityPrecision: 5, pricePrecision: 2, limitVolumeMin: "0.00002", limitAmountMin: "0", limitPriceMin: "0.01", marketBuyMin: "10", marketSellMin: "0.0001" }] });
  assert.equal(first.quantityPrecision, 5);
  assert.equal(first.pricePrecision, 2);
  assert.equal(second.limitVolumeMin, "0.00002");
  assert.equal(second.marketBuyMin, "10");
  assert.equal(second.marketSellMin, "0.0001");

  await assert.rejects(
    preflightSymbolOrder(context, { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", baseQuantity: "0.000001", price: "65000.123" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_PRECISION_INVALID"
  );
  await assert.rejects(
    preflightSymbolOrder(context, { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", baseQuantity: "0.00001", price: "0.01" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET"
  );
  await assert.rejects(
    preflightSymbolOrder(context, { symbol: "BTCUSDT", side: "SELL", type: "STOP", baseQuantity: "0.00002", price: "65000.12", triggerPrice: "65000.123" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_PRECISION_INVALID" && error.message.includes("triggerPrice")
  );
});

test("resolves a tenant display symbol to its physical OpenAPI symbol", async () => {
  clearSymbolRuleCache();
  const context = {
    profile: { name: "hybrid-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "BTC1701USDT1701", SymbolName: "BTC/USDT", baseAsset: "BTC1701", quoteAsset: "USDT1701", quantityPrecision: 5, pricePrecision: 2 }] })
    }
  } as unknown as ToolExecutionContext;

  const rule = await getSymbolRule(context, "btcusdt");
  assert.deepEqual(rule, {
    symbol: "BTC1701USDT1701",
    displaySymbol: "BTC/USDT",
    baseAsset: "BTC1701",
    quoteAsset: "USDT1701",
    displayBaseAsset: "BTC1701",
    displayQuoteAsset: "USDT1701",
    quantityPrecision: 5,
    pricePrecision: 2,
    limitVolumeMin: undefined,
    limitAmountMin: undefined,
    limitPriceMin: undefined,
    marketBuyMin: undefined,
    marketSellMin: undefined
  });
  assert.equal(await resolveTenantAsset(context, "BTC"), "BTC1701");
  assert.equal(await resolveTenantAsset(context, "USDT"), "USDT1701");
});

test("mirrors OpenAPI market buy and sell minimums for MARKET and STOP_MARKET orders", async () => {
  clearSymbolRuleCache();
  const context = {
    profile: { name: "market-minimum-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "ETHUSDT", quantityPrecision: 4, pricePrecision: 2, marketBuyMin: "10", marketSellMin: "0.001" }] })
    }
  } as unknown as ToolExecutionContext;

  for (const type of ["MARKET", "STOP_MARKET"] as const) {
    await assert.rejects(
      preflightSymbolOrder(context, { symbol: "ETHUSDT", side: "BUY", type, quoteAmount: "9.99" }),
      (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET" && error.message.includes("quoteAmount")
    );
    await preflightSymbolOrder(context, { symbol: "ETHUSDT", side: "BUY", type, quoteAmount: "10" });
    await assert.rejects(
      preflightSymbolOrder(context, { symbol: "ETHUSDT", side: "SELL", type, baseQuantity: "0.0009" }),
      (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET" && error.message.includes("baseQuantity")
    );
    await preflightSymbolOrder(context, { symbol: "ETHUSDT", side: "SELL", type, baseQuantity: "0.001" });
  }
});

test("skips local market minimum validation when an older server omits fields or returns zero", async () => {
  clearSymbolRuleCache();
  const withoutFields = {
    profile: { name: "market-minimum-legacy", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: { symbols: async () => ({ symbols: [{ symbol: "ETHUSDT", quantityPrecision: 4, pricePrecision: 2 }] }) }
  } as unknown as ToolExecutionContext;
  const zeroFields = {
    profile: { name: "market-minimum-zero", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: { symbols: async () => ({ symbols: [{ symbol: "ETHUSDT", quantityPrecision: 4, pricePrecision: 2, marketBuyMin: "0", marketSellMin: "0.0000" }] }) }
  } as unknown as ToolExecutionContext;

  await preflightSymbolOrder(withoutFields, { symbol: "ETHUSDT", side: "BUY", type: "MARKET", quoteAmount: "0.01" });
  await preflightSymbolOrder(withoutFields, { symbol: "ETHUSDT", side: "SELL", type: "MARKET", baseQuantity: "0.0001" });
  await preflightSymbolOrder(zeroFields, { symbol: "ETHUSDT", side: "BUY", type: "STOP_MARKET", quoteAmount: "0.01" });
  await preflightSymbolOrder(zeroFields, { symbol: "ETHUSDT", side: "SELL", type: "STOP_MARKET", baseQuantity: "0.0001" });
});

test("prefers a verified four-digit tenant mapping over a colliding ordinary symbol and asset", async () => {
  clearSymbolRuleCache();
  const context = {
    profile: { name: "hybrid-priority-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: {
      symbols: async () => ({
        symbols: [
          { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", baseAssetName: "BTC", quoteAssetName: "USDT" },
          { symbol: "BTC1701USDT1701", SymbolName: "BTC/USDT", baseAsset: "BTC1701", quoteAsset: "USDT1701", baseAssetName: "BTC", quoteAssetName: "USDT" }
        ]
      })
    }
  } as unknown as ToolExecutionContext;

  assert.equal((await getSymbolRule(context, "BTC/USDT")).symbol, "BTC1701USDT1701");
  assert.equal(await resolveTenantAsset(context, "BTC"), "BTC1701");
  assert.equal(await resolveTenantAsset(context, "USDT"), "USDT1701");
});

test("rejects ambiguous mixed-cloud mappings and blocks unmapped assets for writes", async () => {
  clearSymbolRuleCache();
  let calls = 0;
  const context = {
    profile: { name: "hybrid-ambiguous-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: {
      symbols: async () => {
        calls += 1;
        return {
          symbols: [
            { symbol: "BTC1701USDT1701", SymbolName: "BTC/USDT", baseAsset: "BTC1701", quoteAsset: "USDT1701", baseAssetName: "BTC", quoteAssetName: "USDT" },
            { symbol: "BTC1702USDT1702", SymbolName: "BTC/USDT", baseAsset: "BTC1702", quoteAsset: "USDT1702", baseAssetName: "BTC", quoteAssetName: "USDT" }
          ]
        };
      }
    }
  } as unknown as ToolExecutionContext;

  await assert.rejects(
    getSymbolRule(context, "BTCUSDT"),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_AMBIGUOUS"
  );
  assert.equal(await resolveTenantAsset(context, "DOGE"), "DOGE");
  await assert.rejects(
    resolveTenantAsset(context, "DOGE", "write"),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_ASSET_NOT_MAPPED"
  );
  assert.equal(calls, 2);
});

test("refreshes the OpenAPI symbol snapshot once before reporting a missing symbol", async () => {
  clearSymbolRuleCache();
  let calls = 0;
  const context = {
    profile: { name: "symbol-refresh-tenant", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: {
      symbols: async () => {
        calls += 1;
        return calls === 1
          ? { symbols: [{ symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT" }] }
          : { symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" }] };
      }
    }
  } as unknown as ToolExecutionContext;

  assert.equal((await getSymbolRule(context, "BTCUSDT")).symbol, "BTCUSDT");
  assert.equal(calls, 2);
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

test("ignores a persisted symbol snapshot from the previous cache schema", async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), "ai-hub-symbol-cache-schema-"));
  const previousDisable = process.env.AI_HUB_DISABLE_PERSISTENT_CACHE;
  const previousDirectory = process.env.AI_HUB_CACHE_DIR;
  delete process.env.AI_HUB_DISABLE_PERSISTENT_CACHE;
  process.env.AI_HUB_CACHE_DIR = cacheDirectory;
  clearSymbolRuleCache();
  let calls = 0;
  const context = {
    profile: { name: "tenant-cache-schema", openApiBaseUrl: "https://api.example.com", configVersion: "config-v1" },
    api: {
      symbols: async () => {
        calls += 1;
        return { symbols: [{ symbol: "ETHUSDT", marketBuyMin: "10", marketSellMin: "0.001" }] };
      }
    }
  } as unknown as ToolExecutionContext;
  try {
    await getCachedSymbols(context);
    const files = await readdir(cacheDirectory);
    const filePath = join(cacheDirectory, files[0] ?? "");
    const snapshot = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    delete snapshot.schemaVersion;
    await writeFile(filePath, JSON.stringify(snapshot));
    clearSymbolRuleCache();
    await getCachedSymbols(context);
    assert.equal(calls, 2);
  } finally {
    clearSymbolRuleCache();
    if (previousDisable === undefined) delete process.env.AI_HUB_DISABLE_PERSISTENT_CACHE;
    else process.env.AI_HUB_DISABLE_PERSISTENT_CACHE = previousDisable;
    if (previousDirectory === undefined) delete process.env.AI_HUB_CACHE_DIR;
    else process.env.AI_HUB_CACHE_DIR = previousDirectory;
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});
