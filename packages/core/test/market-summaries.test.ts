import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, createToolRegistry } from "../src/index.js";
import { getSymbolInfo, listSymbols, searchSymbols, summarizeDepth, summarizeKlines, summarizeLastPrice, summarizeSymbolOverview, summarizeTickers, summarizeTrades } from "../src/tools/market-summaries.js";

test("last-price summary keeps only the requested symbol, price, and timestamp", () => {
  assert.deepEqual(summarizeLastPrice({ last: "63573.99", high: "64244.07", low: "62299.98", time: 123 }, "BTC/USDT"), {
    symbol: "BTCUSDT",
    last: "63573.99",
    time: "123"
  });
});

test("ticker summary returns only the requested quote asset and bounded leaderboards", () => {
  const summary = summarizeTickers([
    { symbol: "BTC/USDT", last: "65000", rose: "0.01", amount: "100", vol: "1", high: "66000", low: "64000", time: 1 },
    { symbol: "ETH/USDT", last: "3000", rose: "-0.02", amount: "200", vol: "2", high: "3100", low: "2900", time: 1 },
    { symbol: "SOL/USDT", last: "100", rose: "0.06", amount: "150", vol: "3", high: "110", low: "90", time: 1 },
    { symbol: "BTC/USDC", last: "65001", rose: "0.90", amount: "999", vol: "1", high: "66001", low: "64001", time: 1 }
  ], { quoteAsset: "USDT", limit: 5 });
  assert.equal(summary.totalSymbols, 3);
  assert.equal(summary.returnedSymbols, 5);
  assert.deepEqual(summary.topGainers, [
    { symbol: "SOL/USDT", last: "100", rose: "0.06", amount: "150", vol: "3", high: "110", low: "90", time: "1" }
  ]);
  assert.deepEqual(summary.topLosers, [{ symbol: "ETH/USDT", last: "3000", rose: "-0.02", amount: "200", vol: "2", high: "3100", low: "2900", time: "1" }]);
  assert.equal((summary.topByQuoteVolume as unknown[]).length, 0);
});

test("ticker summary removes conflicting duplicate display symbols before ranking", () => {
  const summary = summarizeTickers([
    { symbol: "BTC/USDT", last: "59000", rose: "-0.1", amount: "1", vol: "1", high: "60000", low: "58000", time: 1 },
    { symbol: "BTC/USDT", last: "153001", rose: "0.1", amount: "2", vol: "2", high: "154000", low: "150000", time: 2 },
    { symbol: "ETH/USDT", last: "3000", rose: "0", amount: "3", vol: "3", high: "3100", low: "2900", time: 2 }
  ], { quoteAsset: "USDT", limit: 10 });
  assert.equal(summary.totalSymbols, 2);
  assert.equal((summary.watchlist as Array<{ symbol: string; last: string }>).find((item) => item.symbol === "BTC/USDT")?.last, "153001");
  assert.equal((summary.topGainers as Array<{ symbol: string; last: string }>).find((item) => item.symbol === "BTC/USDT")?.last, "153001");
  assert.equal((summary.topLosers as Array<{ symbol: string; last: string }>).find((item) => item.symbol === "BTC/USDT")?.last, "153001");
});

test("symbol browse, search, and exact-info responses are intentionally separate and bounded", () => {
  const source = { symbols: [
    { symbol: "btcusdt", SymbolName: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 5, limitVolumeMin: "0.00001", limitPriceMin: "0.01", limitAmountMin: "0", marketBuyMin: "10", marketSellMin: "0.0001" },
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
    symbol: "BTC/USDT", apiSymbol: "btcusdt", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 5, limitVolumeMin: "0.00001", limitPriceMin: "0.01", limitAmountMin: "0", marketBuyMin: "10", marketSellMin: "0.0001"
  });
});

test("symbol discovery prefers a hybrid tenant record over a colliding global display pair", () => {
  const source = { symbols: [
    { symbol: "btcusdt", SymbolName: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 1, quantityPrecision: 3 },
    { symbol: "btc1701usdt1701", SymbolName: "BTC/USDT", baseAsset: "BTC1701", quoteAsset: "USDT1701", baseAssetName: "BTC", quoteAssetName: "USDT", pricePrecision: 2, quantityPrecision: 8 },
    { symbol: "eth1701usdt1701", SymbolName: "ETH/USDT", baseAsset: "ETH1701", quoteAsset: "USDT1701", baseAssetName: "ETH", quoteAssetName: "USDT" }
  ] };
  assert.deepEqual(summarizeSymbolOverview(source, { limit: 20 }), {
    totalSymbols: 2,
    quoteAssetCounts: [{ asset: "USDT", count: 2 }],
    sampleSymbols: ["BTC/USDT", "ETH/USDT"]
  });
  assert.deepEqual(listSymbols(source, { offset: 0, limit: 20 }), {
    totalSymbols: 2,
    matchedSymbols: 2,
    quoteAsset: null,
    offset: 0,
    limit: 20,
    nextOffset: null,
    items: [
      { symbol: "BTC/USDT", apiSymbol: "btc1701usdt1701", baseAsset: "BTC", quoteAsset: "USDT" },
      { symbol: "ETH/USDT", apiSymbol: "eth1701usdt1701", baseAsset: "ETH", quoteAsset: "USDT" }
    ]
  });
  assert.deepEqual(searchSymbols(source, { query: "BTC", limit: 20 }), {
    matchedSymbols: 1,
    query: "BTC",
    quoteAsset: null,
    items: [{ symbol: "BTC/USDT", apiSymbol: "btc1701usdt1701", baseAsset: "BTC", quoteAsset: "USDT" }]
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
  for (const name of ["market_get_symbol_overview", "market_list_symbols", "market_search_symbols", "market_get_symbol_info", "market_get_last_price", "market_get_ticker_summary", "market_get_depth_summary", "market_get_trades_summary", "market_get_klines_summary"]) {
    assert.equal(registry.byName(name).operation, "read");
  }
  assert.throws(
    () => registry.byName("market_search_symbols").validate({}),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
  assert.equal((registry.byName("market_search_symbols").validate({ query: "BTC" }) as { limit: number }).limit, 20);
  assert.throws(
    () => registry.byName("market_get_ticker").validate({}),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
  assert.throws(
    () => registry.byName("market_get_ticker").validate({ symbol: "BTCUSDT", symbols: "ETHUSDT" }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
  for (const name of ["market_get_symbols", "market_get_depth", "market_get_trades", "market_get_klines"]) assert.equal(registry.byName(name).operation, "read");
});
