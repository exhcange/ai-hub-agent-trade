import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

test("MCP advertises bounded market tools and compact high-frequency account tools", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(undefined, false);
  const client = new Client({ name: "mcp-tool-schema-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.listTools();
    for (const name of ["market_get_symbol_overview", "market_list_symbols", "market_search_symbols", "market_get_symbol_info", "market_get_ticker_summary", "market_get_depth_summary", "market_get_trades_summary", "market_get_klines_summary"]) {
      const tool = response.tools.find((item) => item.name === name);
      assert.ok(tool, `${name} must be advertised`);
      assert.equal(tool.outputSchema?.type, "object");
      assert.ok(tool.description);
    }
    const klineSummary = response.tools.find((item) => item.name === "market_get_klines_summary");
    const spotFuturesTransfer = response.tools.find((item) => item.name === "account_prepare_transfer");
    const universalTransfer = response.tools.find((item) => item.name === "wallet_prepare_universal_transfer");
    const assetBalance = response.tools.find((item) => item.name === "account_get_asset_balance");
    const sellAvailable = response.tools.find((item) => item.name === "spot_prepare_sell_available");
    for (const name of ["market_get_symbols", "market_get_depth", "market_get_trades", "market_get_klines"]) {
      assert.equal(response.tools.some((item) => item.name === name), false, `${name} must not be advertised through MCP`);
    }
    const searchSymbols = response.tools.find((item) => item.name === "market_search_symbols");
    const listSymbols = response.tools.find((item) => item.name === "market_list_symbols");
    assert.deepEqual(searchSymbols?.inputSchema.required, ["query"]);
    assert.equal(((searchSymbols?.inputSchema.properties?.limit as { maximum?: number } | undefined)?.maximum), 20);
    assert.equal(((listSymbols?.inputSchema.properties?.limit as { maximum?: number } | undefined)?.maximum), 50);
    assert.deepEqual(klineSummary?.inputSchema.required, ["symbol"]);
    assert.deepEqual(assetBalance?.inputSchema.required, ["asset"]);
    assert.deepEqual(sellAvailable?.inputSchema.required, ["symbol"]);
    assert.deepEqual((spotFuturesTransfer?.inputSchema.properties?.fromAccount as { enum?: readonly string[] } | undefined)?.enum, ["EXCHANGE", "FUTURE"]);
    assert.match((universalTransfer?.inputSchema.properties?.toAccountType as { description?: string } | undefined)?.description ?? "", /2=Isolated Margin/);
  } finally {
    await client.close();
    await server.close();
  }
});
