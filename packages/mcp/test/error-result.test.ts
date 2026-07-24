import assert from "node:assert/strict";
import test from "node:test";
import { OpenApiBusinessError, diagnoseOpenApiBusinessError } from "@ai-hub/agent-trade-core";
import { formatMcpData, toMcpErrorResult, toMcpReadResult } from "../src/server.js";

test("MCP marks an upstream business failure as an MCP error with diagnosis", () => {
  const error = new OpenApiBusinessError(
    diagnoseOpenApiBusinessError("/sapi/v1/withdraw/query", "10005", "Users don't have permission to access")
  );
  const result = toMcpErrorResult(error);
  assert.equal(result.isError, true);
  const content = result.content[0];
  assert.equal(content?.type, "text");
  const payload = JSON.parse(content?.text ?? "{}") as Record<string, unknown>;
  assert.deepEqual(payload, {
    ok: false,
    code: "AI_HUB_OPENAPI_BUSINESS_ERROR",
    upstreamCode: "10005",
    upstreamMessage: "Users don't have permission to access",
    reason: "WITHDRAW_HISTORY_PERMISSION_DENIED",
    suggestedAction: "Enable the withdrawal-history permission for this API key, then retry.",
    retryable: false,
    writeOutcomeUnknown: false
  });
});

test("MCP normalizes every read response to a stable, type-discriminated shape", () => {
  assert.deepEqual(formatMcpData([{ symbol: "BTCUSDT" }]), {
    dataType: "array",
    items: [{ symbol: "BTCUSDT" }],
    count: 1
  });
  assert.deepEqual(formatMcpData({ bids: [] }), { dataType: "object", value: { bids: [] } });
  assert.deepEqual(formatMcpData("pong"), { dataType: "scalar", value: "pong" });
  assert.deepEqual(formatMcpData(null), { dataType: "null", value: null });
});

test("MCP returns normalized reads as protocol structured content and JSON text", () => {
  const data = formatMcpData([{ symbol: "BTC/USDT" }]);
  const result = toMcpReadResult(data);
  assert.deepEqual(result.structuredContent, { ok: true, data });
  const content = result.content[0];
  assert.equal(content?.type, "text");
  assert.deepEqual(JSON.parse(content?.text ?? "{}"), { ok: true, data });
});
