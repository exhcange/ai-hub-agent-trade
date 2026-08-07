import assert from "node:assert/strict";
import test from "node:test";
import { AI_HUB_RELEASE_VERSION, configFilePath } from "@ai-hub/agent-trade-core";
import { run } from "../src/index.js";

async function captureStdout(action: () => Promise<void>): Promise<unknown> {
  const output: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try {
    await action();
  } finally {
    process.stdout.write = originalWrite;
  }
  return JSON.parse(output.join(""));
}

test("CLI --version uses the shared release version", async () => {
  assert.deepEqual(await captureStdout(() => run(["--version"])), { version: AI_HUB_RELEASE_VERSION });
});

test("config path is local-only and reports the resolved config path", async () => {
  assert.deepEqual(await captureStdout(() => run(["config", "path"])), { configPath: configFilePath() });
});

test("capabilities reports the installed CLI surface without requiring a profile", async () => {
  const value = await captureStdout(() => run(["capabilities"])) as {
    version: string;
    configPath: string;
    summary: { totalTools: number; readTools: number; writeTools: number };
    tools: Array<{ name: string; cliPath: string; operation: string }>;
  };
  assert.equal(value.version, AI_HUB_RELEASE_VERSION);
  assert.equal(value.configPath, configFilePath());
  assert.equal(value.summary.totalTools, value.summary.readTools + value.summary.writeTools);
  assert.ok(value.tools.some((tool) => tool.name === "market_get_ticker" && tool.cliPath === "market ticker" && tool.operation === "read"));
  assert.ok(value.tools.some((tool) => tool.name === "spot_limit_order" && tool.operation === "write"));
});
