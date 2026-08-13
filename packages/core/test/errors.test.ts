import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, OpenApiBusinessError, diagnoseOpenApiBusinessError, toAiHubErrorPayload } from "../src/index.js";

const options = { requestId: "request-id", now: new Date("2026-08-10T08:00:00.000Z") };

test("local errors use the complete backward-compatible client envelope", () => {
  assert.deepEqual(toAiHubErrorPayload(new AiHubError("AI_HUB_SYMBOL_NOT_FOUND", "Symbol was not found."), options), {
    request_id: "request-id",
    error_category: "NOT_FOUND",
    error_code: "AI_HUB_SYMBOL_NOT_FOUND",
    message: "Symbol was not found.",
    retryable: false,
    retry_after: null,
    action_required: "Verify the requested identifier against the available tenant data before retrying.",
    operation_status: "NOT_STARTED",
    timestamp: "2026-08-10T08:00:00.000Z",
    code: "AI_HUB_SYMBOL_NOT_FOUND"
  });
});

test("upstream diagnoses preserve legacy fields and add retry metadata", () => {
  const error = new OpenApiBusinessError(diagnoseOpenApiBusinessError("/sapi/v2/order", "-1007", "Timeout waiting for a response"));
  const payload = toAiHubErrorPayload(error, options);
  assert.equal(payload.request_id, "request-id");
  assert.equal(payload.error_category, "UPSTREAM_BUSINESS");
  assert.equal(payload.error_code, "AI_HUB_OPENAPI_BUSINESS_ERROR");
  assert.equal(payload.retryable, true);
  assert.equal(payload.retry_after, null);
  assert.equal(payload.operation_status, "UNKNOWN");
  assert.equal(payload.reason, "UPSTREAM_TIMEOUT");
  assert.equal(payload.writeOutcomeUnknown, true);
});

test("unknown write results explicitly prohibit automatic retry", () => {
  const payload = toAiHubErrorPayload(new AiHubError("AI_HUB_WRITE_RESULT_UNKNOWN", "The request outcome is unknown."), options);
  assert.equal(payload.retryable, false);
  assert.equal(payload.operation_status, "UNKNOWN");
  assert.match(String(payload.action_required), /Do not retry automatically/i);
});

test("local error details are preserved in the shared envelope", () => {
  const payload = toAiHubErrorPayload(new AiHubError("AI_HUB_WRITE_RESULT_UNKNOWN", "Unknown.", {
    writeOutcomeUnknown: true,
    symbol: "BTCUSDT",
    newClientOrderId: "agent_123",
    reconciliationTool: "spot_get_order"
  }), { requestId: "request-id", now: new Date("2026-08-13T00:00:00.000Z") });
  assert.equal(payload.writeOutcomeUnknown, true);
  assert.equal(payload.symbol, "BTCUSDT");
  assert.equal(payload.newClientOrderId, "agent_123");
  assert.equal(payload.reconciliationTool, "spot_get_order");
});
