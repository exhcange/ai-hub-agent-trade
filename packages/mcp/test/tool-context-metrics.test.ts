import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

interface ToolContextMetrics {
  tools: number;
  jsonBytes: number;
  descriptionChars: number;
  schemaBytes: number;
}

/**
 * Recorded from the previous full MCP list: all current Registry tools with
 * the former capability Tool, uncompressed descriptions, and repeated read
 * output schema. Update deliberately only when changing the compatibility
 * baseline, not when adding a tool.
 */
const PRE_COMPRESSION_FULL_BASELINE: Readonly<ToolContextMetrics> = {
  tools: 64,
  jsonBytes: 53_954,
  descriptionChars: 8_396,
  schemaBytes: 32_506
};

function measure(tools: readonly { description?: string; inputSchema?: unknown; outputSchema?: unknown }[]): ToolContextMetrics {
  return {
    tools: tools.length,
    jsonBytes: Buffer.byteLength(JSON.stringify(tools)),
    descriptionChars: tools.reduce((sum, tool) => sum + (tool.description?.length ?? 0), 0),
    schemaBytes: tools.reduce((sum, tool) => sum + Buffer.byteLength(JSON.stringify({ input: tool.inputSchema, output: tool.outputSchema })), 0)
  };
}

async function listTools(toolset: "default" | "full") {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(undefined, false, toolset);
  const client = new Client({ name: "mcp-context-metrics-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await client.listTools();
  } finally {
    await client.close();
    await server.close();
  }
}

test("default MCP keeps every tool, the required read schemas, and a bounded tools/list context", async () => {
  const response = await listTools("default");
  const current = measure(response.tools);

  assert.equal(current.tools, PRE_COMPRESSION_FULL_BASELINE.tools + 1, "system_get_capabilities is restored alongside the focused last-price tool");
  // The documented response contract now requires outputSchema on every read
  // Tool, so schema bytes may exceed the former two-schema baseline. Keep the
  // complete listing within 10% while retaining the description compression.
  assert.ok(current.jsonBytes <= PRE_COMPRESSION_FULL_BASELINE.jsonBytes * 1.1, JSON.stringify({ current, baseline: PRE_COMPRESSION_FULL_BASELINE }));
  assert.ok(current.descriptionChars <= PRE_COMPRESSION_FULL_BASELINE.descriptionChars * 0.7);
  assert.ok(current.schemaBytes <= PRE_COMPRESSION_FULL_BASELINE.schemaBytes * 1.2);
  assert.ok(response.tools.filter((tool) => tool.name !== "confirm_action" && tool.description?.includes("configured tenant OpenAPI")).length === 0);
  assert.ok(response.tools.filter((tool) => tool.name !== "confirm_action" && tool.annotations?.readOnlyHint).every((tool) => (tool.description?.length ?? 0) <= 120));
});

test("full MCP has the same compact tools/list footprint as default", async () => {
  const [defaultTools, fullTools] = await Promise.all([listTools("default"), listTools("full")]);
  assert.deepEqual(measure(fullTools.tools), measure(defaultTools.tools));
});
