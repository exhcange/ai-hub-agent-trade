import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigStore, FileConfirmationStore, confirmationContext, createToolExecutionContext } from "@ai-hub/agent-trade-core";
import { run } from "../src/index.js";

test("CLI shares one profile across products, masks config output and confirms with the original product", async () => {
  const home = await mkdtemp(join(tmpdir(), "unified-cli-"));
  const previousHome = process.env.HOME, previousFetch = globalThis.fetch, previousWrite = process.stdout.write;
  process.env.HOME = home;
  const output: string[] = [], requests: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
  globalThis.fetch = async (input) => { requests.push(String(input)); return new Response('{"code":"0","data":{}}'); };
  try {
    await mkdir(join(home, ".ai-hub"));
    await writeFile(join(home, ".ai-hub", "config.toml"), `version = 2
default_profile = "merchant"
[profiles.merchant]
product = "spot"
products = ["spot", "futures"]
openapi_base_url = "https://openapi.example.com"
futures_base_url = "https://futuresopenapi.example.com"
api_key = "fixture-key"
secret_key = "fixture-secret"
`);
    await run(["market", "ping"]);
    await run(["futures", "ping"]);
    assert.deepEqual(requests.map((url) => new URL(url).host), ["openapi.example.com", "futuresopenapi.example.com"]);
    await run(["config", "show", "--profile", "merchant"]);
    assert.ok(output.join("").includes("futuresopenapi.example.com"));
    assert.equal(output.join("").includes("fixture-secret"), false);
    assert.equal(output.join("").includes("fixture-key"), false);
    await run(["config", "pair-products", "--profile", "merchant", "--evidence-id", "fixture-proof", "--operator-verified"]);
    assert.ok((await new ConfigStore().showProfile("merchant")).accountPairing);
    const confirmations = new FileConfirmationStore();
    const context = await createToolExecutionContext("merchant", undefined, undefined, "spot");
    const preview = await confirmations.prepare({ action: "spot_cancel_order", payload: { symbol: "BTCUSDT", orderId: "1" }, summary: {}, context: confirmationContext(context) });
    await run(["confirm", "--confirmation-id", preview.confirmationId, "--user-confirmation", "Confirm this preview", "--profile", "merchant"]);
    assert.ok(requests.at(-1)?.startsWith("https://openapi.example.com/sapi/v2/cancel"));
    await assert.rejects(run(["confirm", "--confirmation-id", preview.confirmationId, "--user-confirmation", "Confirm again", "--profile", "merchant"]), { code: "AI_HUB_CONFIRMATION_NOT_FOUND" });
    await assert.rejects(run(["config", "set", "--profile", "merchant", "--openapi-base-url", "https://openapi.example.com", "--products", "futures,spot"]), { code: "AI_HUB_INVALID_ARGUMENT" });
  } finally {
    globalThis.fetch = previousFetch; process.stdout.write = previousWrite;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
