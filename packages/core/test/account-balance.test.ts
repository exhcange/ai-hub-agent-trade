import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, createToolRegistry, findAssetBalance, listAssetBalances, listNonZeroAssetBalances } from "../src/index.js";

test("asset-balance extracts one compact balance from the signed account response", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
    api: { account: async () => ({ balances: [{ asset: "ETH", free: "0.00054012", locked: "0.1" }] }) }
  } as never;
  assert.deepEqual(await registry.execute("account_get_asset_balance", { asset: "eth" }, context), {
    asset: "ETH", available: "0.00054012", frozen: "0.1", total: "0.10054012", found: true
  });
  assert.deepEqual(findAssetBalance({ balances: [] }, "USDT"), { asset: "USDT", available: "0", frozen: "0", total: "0", found: false });
});

test("account_list_balances uses the v1 overview and returns only compact requested balances", async () => {
  const registry = createToolRegistry();
  const nonZeroOnlySchema = registry.byName("account_list_balances").inputSchema.properties?.nonZeroOnly as { default?: unknown; description?: unknown };
  assert.equal(nonZeroOnlySchema.default, true);
  assert.match(String(nonZeroOnlySchema.description), /explicitly asks to include zero balances/i);
  const context = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
    api: {
      accountOverview: async () => ({ balances: [
        { asset: "USDT", free: "10.5", locked: "0" },
        { asset: "BTC", free: "0", locked: "0.01" },
        { asset: "ETH", free: "0.000", locked: "0" }
      ] })
    }
  } as never;
  assert.deepEqual(await registry.execute("account_list_balances", {}, context), {
    balances: [
      { asset: "USDT", available: "10.5", frozen: "0", total: "10.5" },
      { asset: "BTC", available: "0", frozen: "0.01", total: "0.01" }
    ],
    count: 2,
    truncated: false
  });
  assert.deepEqual(await registry.execute("account_list_balances", { assets: ["eth", "usdt"], nonZeroOnly: false }, context), {
    balances: [
      { asset: "USDT", available: "10.5", frozen: "0", total: "10.5" },
      { asset: "ETH", available: "0.000", frozen: "0", total: "0" }
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

test("sell-available prepares a precision-safe market sell preview", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "tenant-a", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "ethusdt", SymbolName: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT", quantityPrecision: 4, pricePrecision: 2, limitVolumeMin: "0.0001" }] }),
      account: async () => ({ balances: [{ asset: "ETH", free: "0.00054012", locked: "0" }] })
    }
  } as never;
  const prepared = await registry.prepareWrite("spot_sell_available", { symbol: "ETHUSDT" }, context, { prepare: (input) => input as never });
  assert.deepEqual(prepared.summary, {
    action: "market_sell", symbol: "ethusdt", side: "SELL", type: "MARKET", baseQuantity: "0.0005", amountMeaning: "exact base-asset quantity", newClientOrderId: prepared.summary.newClientOrderId,
    requestedMode: "available_balance", baseAsset: "ETH", availableBaseQuantity: "0.00054012", executableBaseQuantity: "0.0005", remainderBaseQuantity: "0.00004012", rounding: "floored to the configured base-quantity precision"
  });
});

test("sell-available rejects an amount below the configured executable minimum", async () => {
  const registry = createToolRegistry();
  const context = {
    profile: { name: "tenant-b", openApiBaseUrl: "https://api.example.com", configVersion: "v1" },
    credentials: { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "credential-v1" },
    api: {
      symbols: async () => ({ symbols: [{ symbol: "ethusdt", baseAsset: "ETH", quantityPrecision: 4, limitVolumeMin: "0.01" }] }),
      account: async () => ({ balances: [{ asset: "ETH", free: "0.0005" }] })
    }
  } as never;
  await assert.rejects(
    registry.prepareWrite("spot_sell_available", { symbol: "ETHUSDT" }, context, { prepare: (input) => input as never }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_SYMBOL_MINIMUM_NOT_MET"
  );
});
