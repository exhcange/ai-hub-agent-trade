import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify } from "smol-toml";
import { ConfigStore, deriveFuturesBaseUrl, FileConfirmationStore, confirmationContext, FuturesWriteState, AiHubError } from "../src/index.js";

const credentials = { apiKey: "fixture-key", secretKey: "fixture-secret" };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "unified-config-"));
  return { directory, file: join(directory, "config.toml"), store: new ConfigStore(join(directory, "config.toml")) };
}

test("derivation changes only the first hostname label and rejects ambiguous inputs", () => {
  assert.equal(deriveFuturesBaseUrl("https://openapi.example.com"), "https://futuresopenapi.example.com");
  assert.equal(deriveFuturesBaseUrl("https://OPENAPI.eu.example.com/"), "https://futuresopenapi.eu.example.com");
  for (const url of ["https://example.com", "http://openapi.example.com", "https://futuresopenapi.example.com", "https://openapi.example.com/path", "https://openapi.example.com:8443", "https://key@openapi.example.com", "https://openapi.example.com?q=1", "https://openapi.example.com#x"])
    assert.throws(() => deriveFuturesBaseUrl(url), { code: "AI_HUB_INVALID_OPENAPI_URL" });
});

test("one credential pair resolves product-specific endpoints and endpoint edits revoke credentials/pairing", async () => {
  const { store, file } = await fixture();
  await store.setUnifiedProfile("merchant", "https://8.8.8.8", "https://1.1.1.1");
  await store.setCredentials("merchant", credentials);
  const spot = await store.resolveProfileWithCredentials("merchant", "spot");
  const futures = await store.resolveProfileWithCredentials("merchant", "futures");
  assert.equal(spot.profile.openApiBaseUrl, "https://8.8.8.8");
  assert.equal(futures.profile.openApiBaseUrl, "https://1.1.1.1");
  assert.equal(futures.profile.product, "futures");
  assert.equal((await store.read()).version, 2);
  assert.deepEqual(spot.credentials, futures.credentials);
  assert.equal((await readFile(file, "utf8")).match(/api_key =/g)?.length, 1);
  assert.equal(spot.profile.accountPairing, undefined);
  await store.pairProducts("operator-proof", "merchant");
  assert.ok((await store.showProfile("merchant")).accountPairing);
  await store.setUnifiedProfile("merchant", "https://8.8.8.8", "https://1.1.1.1");
  assert.ok((await store.showProfile("merchant")).accountPairing);
  await store.setCredentials("merchant", { ...credentials, secretKey: "new-fixture-secret" });
  assert.equal((await store.showProfile("merchant")).accountPairing, undefined);
  await assert.rejects(store.setProfile("merchant", "https://8.8.8.8"), { code: "AI_HUB_INVALID_ARGUMENT" });
  await store.setUnifiedProfile("merchant", "https://8.8.8.8", "https://8.8.4.4");
  assert.equal(await store.getCredentials("merchant"), undefined);
});

test("single-product profiles retain product isolation", async () => {
  const { store } = await fixture();
  await store.setProfile("only-spot", "https://8.8.8.8", "spot");
  await assert.rejects(store.showProfile("only-spot", "futures"), { code: "AI_HUB_PRODUCT_MISMATCH" });
});

test("unification preserves legacy durable-state identities without duplicating credentials", async () => {
  const { store, file, directory } = await fixture();
  const profile = (product: "spot" | "futures", url: string) => ({ product, openapi_base_url: url, api_key: credentials.apiKey, secret_key: credentials.secretKey });
  await writeFile(file, stringify({ version: 1, default_profile: "spot", profiles: {
    spot: profile("spot", "https://openapi.example.com"), futures: profile("futures", "https://futuresopenapi.example.com")
  } }));
  const state = new FuturesWriteState(join(directory, "journal"));
  await assert.rejects(state.execute("futures|https://futuresopenapi.example.com|futures", "futures_cancel_order", async () => { throw new AiHubError("AI_HUB_WRITE_RESULT_UNKNOWN", "fixture"); }, { contractName: "E-BTC-USDT" }));
  assert.equal((await store.unifyProfiles("merchant", { spot: "spot", futures: "futures" })).applied, false);
  assert.ok((await store.read()).profiles.spot);
  await store.unifyProfiles("merchant", { spot: "spot", futures: "futures" }, true);
  const config = await store.read();
  assert.deepEqual(Object.keys(config.profiles), ["merchant"]);
  assert.equal(config.default_profile, "merchant");
  const futures = await store.showProfile("merchant", "futures");
  assert.equal(futures.stateProfileName, "futures");
  await assert.rejects(state.assertClear(`${futures.stateProfileName}|${futures.openApiBaseUrl}|futures`), { code: "AI_HUB_UNRESOLVED_WRITE_EXISTS" });
  assert.equal((await store.showProfile("merchant", "spot")).stateProfileName, "spot");
  assert.equal((await readFile(file, "utf8")).match(/api_key =/g)?.length, 1);
});

test("routing metadata does not consume confirmation and product/config bindings are enforced", async () => {
  const { store, directory } = await fixture();
  await store.setUnifiedProfile("merchant", "https://8.8.8.8", "https://1.1.1.1");
  await store.setCredentials("merchant", credentials);
  const spot = await store.resolveProfileWithCredentials("merchant", "spot");
  const futures = await store.resolveProfileWithCredentials("merchant", "futures");
  const context = (value: typeof spot) => confirmationContext({ ...value, api: {} as never });
  const confirmations = new FileConfirmationStore(join(directory, "pending"));
  const input = { action: "futures_cancel_order", payload: { contractName: "E-BTC-USDT", orderId: "1" }, summary: {}, context: context(futures) };
  const first = await confirmations.prepare(input);
  assert.deepEqual(await confirmations.routing(first.confirmationId), { profile: "merchant", product: "futures", action: "futures_cancel_order" });
  await assert.rejects(confirmations.confirm(first.confirmationId, "Confirm", context(spot)), { code: "AI_HUB_CONFIRMATION_CONTEXT_CHANGED" });
  const second = await confirmations.prepare(input);
  await confirmations.confirm(second.confirmationId, "Confirm", context(futures));
  await assert.rejects(confirmations.confirm(second.confirmationId, "Confirm", context(futures)), { code: "AI_HUB_CONFIRMATION_NOT_FOUND" });
  const third = await confirmations.prepare(input);
  await store.setCredentials("merchant", { ...credentials, secretKey: "rotated-fixture-secret" });
  await assert.rejects(confirmations.confirm(third.confirmationId, "Confirm", context(await store.resolveProfileWithCredentials("merchant", "futures"))), { code: "AI_HUB_CONFIRMATION_CONTEXT_CHANGED" });
});
