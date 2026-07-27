import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, createToolRegistry, findAssetBalance } from "../src/index.js";

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
