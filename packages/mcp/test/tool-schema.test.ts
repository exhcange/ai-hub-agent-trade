import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

test("read tools advertise an output schema, including bounded market summaries", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(undefined, true);
  const client = new Client({ name: "mcp-tool-schema-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.listTools();
    for (const name of ["market_search_symbols", "market_get_ticker_summary", "market_get_depth_summary", "market_get_trades_summary", "market_get_klines_summary"]) {
      const tool = response.tools.find((item) => item.name === name);
      assert.ok(tool, `${name} must be advertised`);
      assert.equal(tool.outputSchema?.type, "object");
      assert.match(tool.description ?? "", /structured as/);
    }
    const klines = response.tools.find((item) => item.name === "market_get_klines");
    const klineSummary = response.tools.find((item) => item.name === "market_get_klines_summary");
    assert.equal(response.tools.some((item) => item.name === "market_get_symbols"), false);
    assert.match(response.tools.find((item) => item.name === "market_search_symbols")?.description ?? "", /data\.value\.items/);
    assert.deepEqual((klines?.inputSchema.properties?.interval as { enum?: readonly string[] } | undefined)?.enum, ["1min", "5min", "15min", "30min", "60min", "1day", "1week", "1month"]);
    assert.deepEqual(klineSummary?.inputSchema.required, ["symbol"]);
  } finally {
    await client.close();
    await server.close();
  }
});
