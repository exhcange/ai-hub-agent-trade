import assert from "node:assert/strict";
import test from "node:test";
import { AI_HUB_RELEASE_VERSION, createToolRegistry, OpenApiBusinessError, diagnoseOpenApiBusinessError } from "@ai-hub/agent-trade-core";
import { buildSystemCapabilities, formatMcpData, normalizeMcpArguments, toMcpErrorResult, toMcpReadResult } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

test("MCP marks an upstream business failure as an MCP error with diagnosis", () => {
  const error = new OpenApiBusinessError(
    diagnoseOpenApiBusinessError("/sapi/v1/withdraw/query", "10005", "Users don't have permission to access")
  );
  const result = toMcpErrorResult(error, "request-id");
  assert.equal(result.isError, true);
  const content = result.content[0];
  assert.equal(content?.type, "text");
  const payload = JSON.parse(content?.text ?? "{}") as Record<string, unknown>;
  assert.deepEqual(payload, {
    ok: false,
    request_id: "request-id",
    error_category: "UPSTREAM_BUSINESS",
    error_code: "AI_HUB_OPENAPI_BUSINESS_ERROR",
    message: "OpenAPI business error 10005: Users don't have permission to access",
    retry_after: null,
    action_required: "Enable the withdrawal-history permission for this API key, then retry.",
    operation_status: "REJECTED",
    timestamp: payload.timestamp,
    code: "AI_HUB_OPENAPI_BUSINESS_ERROR",
    upstreamCode: "10005",
    upstreamMessage: "Users don't have permission to access",
    reason: "WITHDRAW_HISTORY_PERMISSION_DENIED",
    suggestedAction: "Enable the withdrawal-history permission for this API key, then retry.",
    retryable: false,
    writeOutcomeUnknown: false
  });
  assert.match(String(payload.timestamp), /^\d{4}-\d{2}-\d{2}T/);
});

test("MCP wraps each Core read result in the documented dataType envelope", () => {
  const array = [{ symbol: "BTCUSDT" }];
  const object = { bids: [] };
  assert.deepEqual(formatMcpData(array), { dataType: "array", items: array, count: 1 });
  assert.deepEqual(formatMcpData(object), { dataType: "object", value: object });
  assert.deepEqual(formatMcpData("pong"), { dataType: "scalar", value: "pong" });
  assert.deepEqual(formatMcpData(null), { dataType: "null" });
});

test("MCP reads expose identical parseable text and structured content", () => {
  const source = [{ symbol: "BTC/USDT" }];
  const result = toMcpReadResult(source);
  const expected = { ok: true, data: { dataType: "array", items: source, count: 1 } };
  assert.deepEqual(result.structuredContent, expected);
  const content = result.content[0];
  assert.equal(content?.type, "text");
  assert.deepEqual(JSON.parse(content?.text ?? "{}"), expected);
});

test("MCP compat mode uses the same documented read contract", () => {
  const source = [{ symbol: "BTC/USDT" }];
  const result = toMcpReadResult(source, "compat");
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), result.structuredContent);
});

test("MCP drops schema-declared blank optional strings before Core validation", () => {
  const registry = createToolRegistry();
  const testOrder = registry.byName("spot_test_order");
  const normalizedOrder = normalizeMcpArguments({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    baseQuantity: "0.001",
    price: "60000",
    quoteAmount: "",
    triggerPrice: "",
    recvWindow: "",
    newClientOrderId: ""
  }, testOrder.inputSchema as Record<string, unknown>);
  assert.deepEqual(normalizedOrder, { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", baseQuantity: "0.001", price: "60000" });
  assert.doesNotThrow(() => testOrder.validate(normalizedOrder));

  const batch = registry.byName("spot_batch_place_orders");
  const normalizedBatch = normalizeMcpArguments({
    symbol: "BTCUSDT",
    orders: [{ side: "BUY", type: "LIMIT", baseQuantity: "0.001", price: "60000", quoteAmount: "", triggerPrice: "", recvWindow: "", newClientOrderId: "" }]
  }, batch.inputSchema as Record<string, unknown>);
  assert.deepEqual(normalizedBatch, { symbol: "BTCUSDT", orders: [{ side: "BUY", type: "LIMIT", baseQuantity: "0.001", price: "60000" }] });
  assert.doesNotThrow(() => batch.validate(normalizedBatch));
});

test("system capabilities report the active MCP configuration and Tool counts", () => {
  const tools = [
    { name: "read", module: "market", operation: "read" },
    { name: "write", module: "orders", operation: "write" }
  ] as never;
  assert.deepEqual(buildSystemCapabilities("default", tools, "full", "compact", false), {
    profile: "default",
    toolset: "full",
    responseMode: "compact",
    serviceVersion: AI_HUB_RELEASE_VERSION,
    readOnly: false,
    productScope: {
      spot: true,
      spotMargin: { isolated: true, cross: true, explicitLeverageMultiplier: false },
      derivatives: false,
      product: "spot"
    },
    modules: ["market", "orders"],
    toolCounts: { read: 1, write: 1, total: 2 }
  });
});

test("debug timing is opt-in and emits only anonymous timing fields", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(undefined, false);
  const client = new Client({ name: "mcp-timing-test", version: "1.0.0" });
  const output: string[] = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stderr.write;
  const originalSetting = process.env.AI_HUB_DEBUG_TIMING;
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await client.callTool({ name: "unknown_tool", arguments: {} });
    assert.deepEqual(output, []);

    process.env.AI_HUB_DEBUG_TIMING = "1";
    await client.callTool({ name: "unknown_tool", arguments: {} });
    assert.equal(output.length, 1);
    const payload = JSON.parse(output[0] ?? "{}") as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ["contextLoadMs", "handlerMs", "openApiMs", "totalMs"]);
    assert.ok(Object.values(payload).every((value) => typeof value === "number" && Number.isFinite(value)));
  } finally {
    if (originalSetting === undefined) delete process.env.AI_HUB_DEBUG_TIMING;
    else process.env.AI_HUB_DEBUG_TIMING = originalSetting;
    process.stderr.write = originalWrite;
    await client.close();
    await server.close();
  }
});
