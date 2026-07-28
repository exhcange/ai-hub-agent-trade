import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

test("default MCP advertises only the approved bounded trading and wallet tools", async () => {
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
    assert.equal(response.tools.length, 26);
    const klineSummary = response.tools.find((item) => item.name === "market_get_klines_summary");
    const universalTransfer = response.tools.find((item) => item.name === "wallet_prepare_universal_transfer");
    for (const name of ["market_get_symbols", "market_get_depth", "market_get_trades", "market_get_klines", "spot_test_order", "spot_prepare_sell_available", "account_get_asset_balance", "margin_get_order", "wallet_prepare_create_withdraw", "sub_account_list"]) {
      assert.equal(response.tools.some((item) => item.name === name), false, `${name} must not be advertised through MCP`);
    }
    const searchSymbols = response.tools.find((item) => item.name === "market_search_symbols");
    const listSymbols = response.tools.find((item) => item.name === "market_list_symbols");
    assert.deepEqual(searchSymbols?.inputSchema.required, ["query"]);
    assert.equal(((searchSymbols?.inputSchema.properties?.limit as { maximum?: number } | undefined)?.maximum), 50);
    assert.equal(((listSymbols?.inputSchema.properties?.limit as { maximum?: number } | undefined)?.maximum), 50);
    assert.deepEqual(klineSummary?.inputSchema.required, ["symbol"]);
    assert.match((universalTransfer?.inputSchema.properties?.toAccountType as { description?: string } | undefined)?.description ?? "", /2=Isolated Margin/);
    const unavailable = await client.callTool({ name: "margin_get_order", arguments: {} });
    assert.equal(unavailable.isError, true);
    assert.match((unavailable.content[0] as { text: string }).text, /AI_HUB_TOOL_NOT_AVAILABLE/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("full MCP exposes every remaining Core tool, including raw market responses", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(undefined, false, "full");
  const client = new Client({ name: "mcp-full-tool-schema-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.listTools();
    assert.equal(response.tools.length, 55);
    for (const name of ["market_get_symbols", "market_get_depth", "market_get_trades", "market_get_klines", "margin_get_order", "wallet_prepare_create_withdraw", "sub_account_list"]) assert.ok(response.tools.some((item) => item.name === name), `${name} must be advertised through full MCP`);
  } finally {
    await client.close();
    await server.close();
  }
});

test("read-only MCP rejects write preparation and confirmation even when called directly", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(undefined, true);
  const client = new Client({ name: "mcp-read-only-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.listTools();
    assert.equal(response.tools.some((item) => item.name === "spot_prepare_market_buy"), false);
    assert.equal(response.tools.some((item) => item.name === "confirm_action"), false);
    for (const name of ["spot_prepare_market_buy", "confirm_action"]) {
      const result = await client.callTool({ name, arguments: {} });
      assert.equal(result.isError, true);
      assert.match((result.content[0] as { text: string }).text, /AI_HUB_TOOL_NOT_AVAILABLE/);
    }
  } finally {
    await client.close();
    await server.close();
  }
});
