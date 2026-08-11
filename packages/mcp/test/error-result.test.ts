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

test("MCP preserves each Core read result without a dataType wrapper", () => {
  const array = [{ symbol: "BTCUSDT" }];
  const object = { bids: [] };
  assert.equal(formatMcpData(array), array);
  assert.equal(formatMcpData(object), object);
  assert.equal(formatMcpData("pong"), "pong");
  assert.equal(formatMcpData(null), null);
});

test("MCP compact reads avoid duplicating structured data in text", () => {
  const data = formatMcpData([{ symbol: "BTC/USDT" }]);
  const result = toMcpReadResult(data);
  assert.deepEqual(result.structuredContent, { ok: true, data });
  const content = result.content[0];
  assert.equal(content?.type, "text");
  assert.deepEqual(JSON.parse(content?.text ?? "{}"), { ok: true, summary: "Returned 1 items." });
});

test("MCP compact balance reads retain only a short count summary in text", () => {
  const data = formatMcpData({ balances: [{ asset: "USDT" }], count: 1, truncated: false });
  const result = toMcpReadResult(data);
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), { ok: true, summary: "Returned 1 balances." });
  assert.deepEqual(result.structuredContent, { ok: true, data });
});

test("MCP compat reads preserve the former JSON text payload", () => {
  const data = formatMcpData([{ symbol: "BTC/USDT" }]);
  const result = toMcpReadResult(data, "compat");
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), { ok: true, data });
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
      derivatives: false
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
