import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createToolRegistry } from "@ai-hub/agent-trade-core";
import { createServer } from "../src/server.js";

function prepareName(name: string): string {
  const [prefix, ...rest] = name.split("_");
  return `${prefix}_prepare_${rest.join("_")}`;
}

async function listTools(toolset: "default" | "full") {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(undefined, false, toolset);
  const client = new Client({ name: "mcp-tool-schema-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const response = await client.listTools();
  return { client, server, tools: response.tools };
}

for (const toolset of ["default", "full"] as const) {
  test(`${toolset} MCP exposes every Registry capability and only prepare forms for writes`, async () => {
    const { client, server, tools } = await listTools(toolset);
    try {
      const registryTools = createToolRegistry().list();
      assert.equal(tools.length, registryTools.length + 1, "confirm_action is the only non-Registry MCP tool");
      assert.equal(tools.some((tool) => tool.name === "system_get_capabilities"), false);
      assert.ok(tools.some((tool) => tool.name === "confirm_action"));
      for (const tool of registryTools) {
        if (tool.operation === "read") {
          assert.ok(tools.some((item) => item.name === tool.name), `${tool.name} must be exposed`);
        } else {
          assert.ok(tools.some((item) => item.name === prepareName(tool.name)), `${tool.name} must be exposed as prepare`);
          assert.equal(tools.some((item) => item.name === tool.name), false, `${tool.name} must not be exposed directly`);
        }
      }
      const balance = tools.find((tool) => tool.name === "account_get_asset_balance");
      const balances = tools.find((tool) => tool.name === "account_list_balances");
      assert.ok(balance?.outputSchema);
      assert.ok(balances?.outputSchema);
      assert.equal(tools.find((tool) => tool.name === "market_get_ticker")?.outputSchema, undefined);
      assert.equal((balances?.inputSchema.properties?.nonZeroOnly as { default?: unknown } | undefined)?.default, true);
      const prepare = tools.find((tool) => tool.name === "spot_prepare_market_buy");
      assert.deepEqual(prepare?.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
}

test("read-only MCP removes every prepared write and confirmation", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(undefined, true);
  const client = new Client({ name: "mcp-read-only-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.listTools();
    assert.equal(response.tools.some((item) => item.name === "spot_prepare_market_buy"), false);
    assert.equal(response.tools.some((item) => item.name === "confirm_action"), false);
  } finally {
    await client.close();
    await server.close();
  }
});
