import assert from "node:assert/strict";
import test from "node:test";
import { signRequest } from "../src/index.js";

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
