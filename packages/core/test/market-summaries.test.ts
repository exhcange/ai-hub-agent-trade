import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, createToolRegistry } from "../src/index.js";
import { getSymbolInfo, listSymbols, searchSymbols, summarizeDepth, summarizeKlines, summarizeSymbolOverview, summarizeTickers, summarizeTrades } from "../src/tools/market-summaries.js";

test("ticker summary returns only the requested quote asset and bounded leaderboards", () => {
  const summary = summarizeTickers([
    { symbol: "BTC/USDT", last: "65000", rose: "0.01", amount: "100", vol: "1", high: "66000", low: "64000", time: 1 },
    { symbol: "ETH/USDT", last: "3000", rose: "-0.02", amount: "200", vol: "2", high: "3100", low: "2900", time: 1 },
    { symbol: "SOL/USDT", last: "100", rose: "0.06", amount: "150", vol: "3", high: "110", low: "90", time: 1 },
    { symbol: "BTC/USDC", last: "65001", rose: "0.90", amount: "999", vol: "1", high: "66001", low: "64001", time: 1 }
  ], { quoteAsset: "USDT", limit: 2 });
  assert.equal(summary.totalSymbols, 3);
  assert.deepEqual(summary.topGainers, [
    { symbol: "SOL/USDT", last: "100", rose: "0.06", amount: "150", vol: "3", high: "110", low: "90", time: "1" },
    { symbol: "BTC/USDT", last: "65000", rose: "0.01", amount: "100", vol: "1", high: "66000", low: "64000", time: "1" }
  ]);
  assert.equal((summary.topByQuoteVolume as unknown[]).length, 2);
});

test("symbol browse, search, and exact-info responses are intentionally separate and bounded", () => {
  const source = { symbols: [
    { symbol: "btcusdt", SymbolName: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 5, limitVolumeMin: "0.00001", limitPriceMin: "0.01", limitAmountMin: "0" },
    { symbol: "ethusdc", SymbolName: "ETH/USDC", baseAsset: "ETH", quoteAsset: "USDC", pricePrecision: 2, quantityPrecision: 4, limitVolumeMin: "0.001", limitPriceMin: "0.01", limitAmountMin: "0" },
    { symbol: "ethusdt", SymbolName: "ETH/USDT", baseAsset: "ETH", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, limitVolumeMin: "0.001", limitPriceMin: "0.01", limitAmountMin: "0" }
  ] };
  const overview = summarizeSymbolOverview(source, { limit: 2 });
  assert.equal(overview.totalSymbols, 3);
  assert.deepEqual(overview.sampleSymbols, ["BTC/USDT", "ETH/USDC"]);
  assert.deepEqual(overview.quoteAssetCounts, [{ asset: "USDT", count: 2 }, { asset: "USDC", count: 1 }]);

  const list = listSymbols(source, { quoteAsset: "USDT", offset: 1, limit: 1 });
  assert.equal(list.matchedSymbols, 2);
  assert.equal(list.nextOffset, null);
  assert.deepEqual(list.items, [{ symbol: "ETH/USDT", apiSymbol: "ethusdt", baseAsset: "ETH", quoteAsset: "USDT" }]);

  const symbols = searchSymbols(source, { query: "BTC", limit: 20 });
  assert.equal(symbols.matchedSymbols, 1);
  assert.deepEqual(symbols.items, [{ symbol: "BTC/USDT", apiSymbol: "btcusdt", baseAsset: "BTC", quoteAsset: "USDT" }]);
  assert.equal("pricePrecision" in ((symbols.items as Record<string, unknown>[])[0] ?? {}), false);

  assert.deepEqual(getSymbolInfo(source, "BTCUSDT"), {
    symbol: "BTC/USDT", apiSymbol: "btcusdt", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 5, limitVolumeMin: "0.00001", limitPriceMin: "0.01", limitAmountMin: "0"
  });
});

test("depth, trades, and kline summaries follow the actual OpenAPI payload shapes", () => {

  const depth = summarizeDepth({ time: 10, bids: [["100", "2"]], asks: [["101", "3"]] }, "BTC/USDT");
  assert.deepEqual(depth.bestBid, { price: "100", quantity: "2" });
  assert.deepEqual(depth.bestAsk, { price: "101", quantity: "3" });
  assert.equal(depth.spread, "1");

  const trades = summarizeTrades({ list: [
    { id: 3, side: "BUY", price: "101", qty: "0.1", time: 3 },
    { id: 2, side: "SELL", price: "99", qty: "0.02", time: 2 },
    { id: 1, side: "BUY", price: "100", qty: "0.003", time: 1 }
  ] }, "BTC/USDT");
  assert.equal(trades.highPrice, "101");
  assert.equal(trades.lowPrice, "99");
  assert.equal(trades.buyQuantity, "0.103");
  assert.equal(trades.sellQuantity, "0.02");

  const klines = summarizeKlines([
    { idx: 3, open: "101", close: "102", high: "103", low: "100", vol: "4" },
    { idx: 2, open: "99", close: "101", high: "102", low: "98", vol: "3" }
  ], "BTC/USDT", "60min");
  assert.equal(klines.changeRatio, "0.030303030303030304");
  assert.equal(klines.high, "103");
  assert.equal(klines.low, "98");
});

test("registry exposes bounded market tools and keeps unfiltered ticker requests out of the raw tool", () => {
  const registry = createToolRegistry();
  for (const name of ["market_get_symbol_overview", "market_list_symbols", "market_search_symbols", "market_get_symbol_info", "market_get_ticker_summary", "market_get_depth_summary", "market_get_trades_summary", "market_get_klines_summary"]) {
    assert.equal(registry.byName(name).operation, "read");
  }
  assert.throws(
    () => registry.byName("market_search_symbols").validate({}),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
  assert.equal((registry.byName("market_search_symbols").validate({ query: "BTC" }) as { limit: number }).limit, 10);
  assert.throws(
    () => registry.byName("market_get_ticker").validate({}),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
});
