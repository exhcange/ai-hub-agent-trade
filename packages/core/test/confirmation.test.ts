import assert from "node:assert/strict";
import test from "node:test";
import { ConfirmationService } from "../src/index.js";

const context = {
  profile: "tenant-a",
  openApiBaseUrl: "https://api.example.com",
  configVersion: "config-v1",
  credentialVersion: "credential-v1"
};

test("confirmation is bound to its original context and is one-time", () => {
  const confirmations = new ConfirmationService();
  const prepared = confirmations.prepare({
    action: "spot_place_order",
    payload: { symbol: "btcusdt", volume: "1", side: "BUY", type: "LIMIT", price: "1" },
    context,
    summary: { symbol: "btcusdt", side: "BUY" }
  });
  const confirmed = confirmations.confirm(prepared.confirmationId, "yes", context);
  assert.equal(confirmed.action, "spot_place_order");
  assert.equal(confirmed.payload.symbol, "btcusdt");
  assert.throws(() => confirmations.confirm(prepared.confirmationId, "yes", context), { code: "AI_HUB_CONFIRMATION_NOT_FOUND" });
});

test("confirmation is invalid when a credential version changes", () => {
  const confirmations = new ConfirmationService();
  const prepared = confirmations.prepare({ action: "spot_cancel_order", payload: { symbol: "btcusdt", orderId: "1" }, context, summary: { orderId: "1" } });
  assert.throws(
    () => confirmations.confirm(prepared.confirmationId, "yes", { ...context, credentialVersion: "credential-v2" }),
    { code: "AI_HUB_CONFIRMATION_CONTEXT_CHANGED" }
  );
});
