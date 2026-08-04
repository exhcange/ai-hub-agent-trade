import assert from "node:assert/strict";
import test from "node:test";
import { AI_HUB_RELEASE_VERSION } from "@ai-hub/agent-trade-core";
import { run } from "../src/index.js";

test("CLI --version uses the shared release version", async () => {
  const output: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try {
    await run(["--version"]);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(JSON.parse(output.join("")), { version: AI_HUB_RELEASE_VERSION });
});
