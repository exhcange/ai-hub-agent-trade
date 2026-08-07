import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, createToolRegistry, findAssetBalance, listAssetBalances, listNonZeroAssetBalances } from "../src/index.js";

test("asset-balance extracts one compact balance from the signed account response", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "balance-one", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "ETHUSDT", SymbolName: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT" }] }),
      accountOverview: async () => ({ balances: [{ asset: "ETH", free: "0.00054012", locked: "0.1" }] })
    }
  } as never;
  assert.deepEqual(await registry.execute("account_get_asset_balance", { asset: "eth" }, context), {
    asset: "ETH", apiAsset: "ETH", available: "0.00054012", frozen: "0.1", total: "0.10054012", found: true
  });
  assert.deepEqual(findAssetBalance({ balances: [] }, "USDT"), { asset: "USDT", available: "0", frozen: "0", total: "0", found: false });
});

test("account_list_balances uses the v1 overview and returns only compact requested balances", async () => {
  const registry = createToolRegistry();
  const nonZeroOnlySchema = registry.byName("account_list_balances").inputSchema.properties?.nonZeroOnly as { default?: unknown; description?: unknown };
  assert.equal(nonZeroOnlySchema.default, true);
  assert.match(String(nonZeroOnlySchema.description), /explicitly asks to include zero balances/i);
  const context = {
    profile: { name: "balance-list", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
    api: {
      symbols: async () => ({ symbols: [
        { symbol: "USDTUSDC", SymbolName: "USDT/USDC", baseAsset: "USDT", quoteAsset: "USDC" },
        { symbol: "BTCUSDT", SymbolName: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT" },
        { symbol: "ETHUSDT", SymbolName: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT" }
      ] }),
      accountOverview: async () => ({ balances: [
        { asset: "USDT", free: "10.5", locked: "0" },
        { asset: "BTC", free: "0", locked: "0.01" },
        { asset: "ETH", free: "0.000", locked: "0" }
      ] })
    }
  } as never;
  assert.deepEqual(await registry.execute("account_list_balances", {}, context), {
    balances: [
      { asset: "USDT", apiAsset: "USDT", available: "10.5", frozen: "0", total: "10.5" },
      { asset: "BTC", apiAsset: "BTC", available: "0", frozen: "0.01", total: "0.01" }
    ],
    count: 2,
    truncated: false
  });
  assert.deepEqual(await registry.execute("account_list_balances", { assets: ["eth", "usdt"], nonZeroOnly: false }, context), {
    balances: [
      { asset: "USDT", apiAsset: "USDT", available: "10.5", frozen: "0", total: "10.5" },
      { asset: "ETH", apiAsset: "ETH", available: "0.000", frozen: "0", total: "0" }
    ],
    count: 2,
    truncated: false
  });
  assert.throws(
    () => registry.byName("account_get_asset_balance").validate({}),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
  assert.deepEqual(listNonZeroAssetBalances({ balances: [{ asset: "ETH", free: "0", locked: "0" }] }, 0, 20).items, []);
  assert.deepEqual(listAssetBalances({ balances: [{ asset: "USDT", free: "1", locked: "0" }, { asset: "BTC", free: "0", locked: "0" }] }, { nonZeroOnly: true, limit: 1 }), {
    balances: [{ asset: "USDT", available: "1", frozen: "0", total: "1" }], count: 1, truncated: false
  });
});

test("account balances resolve mixed-cloud asset aliases and return both display and API codes", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "hybrid-account", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "BTC1701USDT1701", SymbolName: "BTC/USDT", baseAsset: "BTC1701", quoteAsset: "USDT1701", baseAssetName: "BTC", quoteAssetName: "USDT" }] }),
      accountOverview: async () => ({ balances: [{ asset: "BTC1701", free: "0.1", locked: "0" }] })
    }
  } as never;
  assert.deepEqual(await registry.execute("account_get_asset_balance", { asset: "BTC" }, context), {
    asset: "BTC", apiAsset: "BTC1701", available: "0.1", frozen: "0", total: "0.1", found: true
  });
});

test("mixed-cloud display aliases prefer tenant-specific assets over colliding legacy codes", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "hybrid-collision", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
    api: {
      symbols: async () => ({ symbols: [
        { symbol: "BTCUSDT", SymbolName: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", baseAssetName: "BTC", quoteAssetName: "USDT" },
        { symbol: "BTC1701USDT1701", SymbolName: "BTC/USDT", baseAsset: "BTC1701", quoteAsset: "USDT1701", baseAssetName: "BTC", quoteAssetName: "USDT" }
      ] }),
      accountOverview: async () => ({ balances: [
        { asset: "BTC", free: "0", locked: "0" },
        { asset: "BTC1701", free: "0.1", locked: "0" }
      ] })
    }
  } as never;
  assert.deepEqual(await registry.execute("account_get_asset_balance", { asset: "BTC" }, context), {
    asset: "BTC", apiAsset: "BTC1701", available: "0.1", frozen: "0", total: "0.1", found: true
  });
});

test("sell-available prepares a precision-safe market sell preview", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "sell-available", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "ethusdt", SymbolName: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT", quantityPrecision: 4, pricePrecision: 2, marketSellMin: "0.0001" }] }),
      accountOverview: async () => ({ balances: [{ asset: "ETH", free: "0.00054012", locked: "0" }] }),
      ticker: async () => ({ last: "2000", time: "1" })
    }
  } as never;
  const prepared = await registry.prepareWrite("spot_sell_available", { symbol: "ETHUSDT" }, context, { prepare: (input) => input as never });
  assert.equal(prepared.summary.executionMode, "LIVE");
  assert.equal(prepared.summary.executed, false);
  assert.equal(prepared.summary.symbol, "ETH/USDT");
  assert.equal(prepared.summary.apiSymbol, "ethusdt");
  assert.deepEqual(prepared.summary.quantityOrAmount, { value: "0.0005", asset: "ETH", apiAsset: "ETH", meaning: "exact base-asset quantity" });
  assert.deepEqual(prepared.summary.priceOrMarket, { mode: "MARKET", referencePrice: "2000", priceSource: "LIVE_TICKER", quotedAt: (prepared.summary.priceOrMarket as Record<string, unknown>).quotedAt, tickerTimestamp: "1" });
  assert.deepEqual(prepared.summary.estimatedNotional, { amount: "1", asset: "USDT", apiAsset: "USDT", status: "INDICATIVE", basis: "LIVE_TICKER", tickerPrice: "2000", quotedAt: (prepared.summary.priceOrMarket as Record<string, unknown>).quotedAt });
  assert.equal(prepared.summary.executableBaseQuantity, "0.0005");
});

test("sell-available rejects an amount below the configured executable minimum", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "tenant-b", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "ethusdt", baseAsset: "ETH", quantityPrecision: 4, marketSellMin: "0.01" }] }),
      accountOverview: async () => ({ balances: [{ asset: "ETH", free: "0.0005" }] })
    }
  } as never;
  await assert.rejects(
    registry.prepareWrite("spot_sell_available", { symbol: "ETHUSDT" }, context, { prepare: (input) => input as never }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET"
  );
});
