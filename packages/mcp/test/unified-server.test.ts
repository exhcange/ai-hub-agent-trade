import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stringify } from "smol-toml";
import { FileConfirmationStore, ConfigStore, createToolExecutionContext, confirmationContext } from "@ai-hub/agent-trade-core";
import { createServer } from "../src/server.js";

async function connect(readOnly = false, productReadOnly: ("spot" | "futures")[] = []) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createServer("merchant", readOnly, "default", "compact", "unified", productReadOnly);
  const client = new Client({ name: "unified-test", version: "1" });
  await server.connect(b); await client.connect(a);
  return { server, client };
}
function payload(result: any): any { return JSON.parse(result.content[0].text); }

test("one server exposes both products and enforces product-level and global read-only policies", async () => {
  for (const [readOnly, restrictions] of [[false, []], [false, ["spot"]], [true, []]] as const) {
    const { server, client } = await connect(readOnly, [...restrictions]);
    try {
      const { tools } = await client.listTools();
      assert.ok(tools.some((t) => t.name === "market_ping"));
      assert.ok(tools.some((t) => t.name === "futures_ping"));
      assert.equal(tools.some((t) => t.name === "spot_prepare_cancel_order"), !readOnly && !restrictions.length);
      assert.equal(tools.some((t) => t.name === "futures_prepare_cancel_order"), !readOnly);
      assert.equal(tools.some((t) => t.name === "futures_cancel_order"), false);
      if (restrictions.length) assert.equal((await client.callTool({ name: "spot_prepare_cancel_order", arguments: {} })).isError, true);
    } finally { await client.close(); await server.close(); }
  }
});

test("unified dispatch uses the correct domain and shared credential; confirmations stay within the merchant and product", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unified-server-"));
  const previousHome = process.env.HOME, previousFetch = globalThis.fetch;
  process.env.HOME = directory;
  const calls: { host: string; path: string; method: string; key: string | null }[] = [];
  let futuresDown = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ host: url.host, path: url.pathname, method: init?.method ?? "GET", key: new Headers(init?.headers).get("X-CH-APIKEY") });
    if (futuresDown && url.host.startsWith("futuresopenapi")) return new Response("{}", { status: 400 });
    const data = url.pathname.endsWith("/contracts") ? [{ symbol: "E-BTC-USDT" }] : {};
    return new Response(JSON.stringify({ code: "0", data }));
  };
  await mkdir(join(directory, ".ai-hub"));
  await writeFile(join(directory, ".ai-hub", "config.toml"), stringify({ version: 2, default_profile: "merchant", profiles: {
    merchant: { product: "spot", products: ["spot", "futures"], openapi_base_url: "https://openapi.example.com", futures_base_url: "https://futuresopenapi.example.com", api_key: "fixture-key", secret_key: "fixture-secret" }
  } }));
  const { client, server } = await connect();
  try {
    const capabilities = payload(await client.callTool({ name: "system_get_capabilities" }));
    assert.deepEqual(capabilities.data.value.products, ["spot", "futures"]);
    assert.equal((await client.callTool({ name: "market_ping" })).isError, undefined);
    assert.equal((await client.callTool({ name: "futures_ping" })).isError, undefined);
    assert.deepEqual(calls.slice(0, 2).map((c) => c.host), ["openapi.example.com", "futuresopenapi.example.com"]);
    const pending = payload(await client.callTool({ name: "futures_prepare_cancel_order", arguments: { contractName: "E-BTC-USDT", orderId: "1" } }));
    assert.equal(pending.ok, true);
    assert.equal(calls.filter((c) => c.method === "POST").length, 0);
    const confirmationId = pending.data.confirmationId;
    assert.equal(payload(await client.callTool({ name: "confirm_action", arguments: { confirmationId, userConfirmation: "Confirm this preview" } })).ok, true);
    assert.equal((await client.callTool({ name: "wallet_get_transferable_assets", arguments: { accountType: "1" } })).isError, undefined);
    const spotRead = calls.find((c) => c.path.endsWith("/by_type"));
    assert.equal(spotRead?.host, "openapi.example.com");
    assert.equal(spotRead?.key, "fixture-key");
    const writes = calls.filter((c) => c.path.endsWith("/cancel"));
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.host, "futuresopenapi.example.com");
    assert.equal(writes[0]?.key, "fixture-key");
    assert.equal((await client.callTool({ name: "confirm_action", arguments: { confirmationId, userConfirmation: "Confirm again" } })).isError, true);
    const confirmations = new FileConfirmationStore();
    const context = await createToolExecutionContext("merchant", undefined, undefined, "spot");
    const foreign = await confirmations.prepare({ action: "spot_cancel_order", payload: {}, summary: {}, context: { ...confirmationContext(context), profile: "another-merchant" } });
    const before = calls.length;
    assert.equal((await client.callTool({ name: "confirm_action", arguments: { confirmationId: foreign.confirmationId, userConfirmation: "Confirm" } })).isError, true);
    assert.equal(calls.length, before);
    assert.equal((await confirmations.routing(foreign.confirmationId)).profile, "another-merchant");
    futuresDown = true;
    assert.equal((await client.callTool({ name: "futures_ping" })).isError, true);
    assert.equal((await client.callTool({ name: "market_ping" })).isError, undefined);
    // Changing shared credentials invalidates a previously bound preview.
    futuresDown = false;
    const stale = await confirmations.prepare({ action: "spot_cancel_order", payload: { symbol: "BTCUSDT", orderId: "2" }, summary: {}, context: confirmationContext(context) });
    await new ConfigStore().setCredentials("merchant", { apiKey: "rotated-fixture-key", secretKey: "rotated-fixture-secret" });
    assert.equal((await client.callTool({ name: "confirm_action", arguments: { confirmationId: stale.confirmationId, userConfirmation: "Confirm" } })).isError, true);
    assert.equal(calls.filter((c) => c.path.endsWith("/cancel")).length, 1);
  } finally {
    await client.close(); await server.close(); globalThis.fetch = previousFetch;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  }
});
