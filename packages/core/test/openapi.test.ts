import assert from "node:assert/strict";
import test from "node:test";
import { AiHubSpotApi, OpenApiBusinessError, diagnoseOpenApiBusinessError, signRequest } from "../src/index.js";

test("signs the exact method, path, query, and JSON body", () => {
  const signature = signRequest(
    "1700000000000",
    "post",
    "/sapi/v2/order",
    "test-secret",
    undefined,
    '{"symbol":"btcusdt","volume":"1"}'
  );
  assert.equal(signature, "960bd10a714b8af8285913e904613b3bd7afdf00bfa67c3595f97faf2848f6f2");
});

test("includes the encoded query string in a signed read request", () => {
  const signature = signRequest("1700000000000", "GET", "/sapi/v2/order", "test-secret", "symbol=btc%2Fusdt&orderId=1");
  assert.equal(signature, "df7cad7455409bccae87d99ee7667c140fc143a783bb1780e974dfb134c97d3a");
});

test("maps a non-zero OpenAPI business code to a structured diagnosis", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "-2013", msg: "Order does not exist" }), { status: 200 });
  try {
    const api = new AiHubSpotApi("https://api.example.com");
    await assert.rejects(
      api.getOrder({ symbol: "BTCUSDT", orderId: "1" }, { apiKey: "test-key", secretKey: "test-secret", credentialVersion: "v1" }),
      (error: unknown) => error instanceof OpenApiBusinessError
        && error.code === "AI_HUB_OPENAPI_BUSINESS_ERROR"
        && error.diagnosis.upstreamCode === "-2013"
        && error.diagnosis.reason === "ORDER_NOT_FOUND"
        && error.diagnosis.retryable === false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses endpoint-specific diagnosis before a global error-code fallback", () => {
  const diagnosis = diagnoseOpenApiBusinessError("/sapi/v1/withdraw/query", "10005", "Users don't have permission to access");
  assert.equal(diagnosis.reason, "WITHDRAW_HISTORY_PERMISSION_DENIED");
  assert.match(diagnosis.suggestedAction, /withdrawal-history permission/i);
});

test("preserves unmapped upstream business codes", () => {
  const diagnosis = diagnoseOpenApiBusinessError("/sapi/v2/account", "99999", "Tenant-specific failure");
  assert.deepEqual(diagnosis, {
    upstreamCode: "99999",
    upstreamMessage: "Tenant-specific failure",
    reason: "UNKNOWN_UPSTREAM_CODE",
    suggestedAction: "Review the upstream message and endpoint. Do not retry a state-changing request automatically.",
    retryable: false,
    writeOutcomeUnknown: false
  });
});
