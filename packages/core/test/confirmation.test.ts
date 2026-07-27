import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfirmationService, FileConfirmationStore } from "../src/index.js";

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

test("file confirmations survive a separate CLI process and are consumed atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-hub-confirmation-"));
  const store = new FileConfirmationStore(directory);
  try {
    const prepared = await store.prepare({ action: "spot_market_sell", payload: { symbol: "ethusdt", baseQuantity: "0.5" }, context, summary: { symbol: "ethusdt" } });
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.equal((await stat(join(directory, files[0] ?? ""))).mode & 0o777, 0o600);

    const restoredStore = new FileConfirmationStore(directory);
    const confirmed = await restoredStore.confirm(prepared.confirmationId, "yes", context);
    assert.deepEqual(confirmed, { action: "spot_market_sell", payload: { symbol: "ethusdt", baseQuantity: "0.5" }, requestHash: prepared.requestHash });
    await assert.rejects(restoredStore.confirm(prepared.confirmationId, "yes", context), { code: "AI_HUB_CONFIRMATION_NOT_FOUND" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("file confirmation rejects a changed profile context and consumes the preview", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-hub-confirmation-"));
  const store = new FileConfirmationStore(directory);
  try {
    const prepared = await store.prepare({ action: "spot_market_sell", payload: { symbol: "ethusdt", baseQuantity: "0.5" }, context, summary: { symbol: "ethusdt" } });
    await assert.rejects(store.confirm(prepared.confirmationId, "yes", { ...context, credentialVersion: "credential-v2" }), { code: "AI_HUB_CONFIRMATION_CONTEXT_CHANGED" });
    await assert.rejects(store.confirm(prepared.confirmationId, "yes", context), { code: "AI_HUB_CONFIRMATION_NOT_FOUND" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
