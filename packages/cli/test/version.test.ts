import assert from "node:assert/strict";
import test from "node:test";
import { AI_HUB_RELEASE_VERSION, AiHubError, configFilePath, createToolRegistry } from "@ai-hub/agent-trade-core";
import { parseToolInput, run } from "../src/index.js";

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
    productScope: { spotMargin: { isolated: boolean; cross: boolean; explicitLeverageMultiplier: boolean }; derivatives: boolean };
    summary: { totalTools: number; readTools: number; writeTools: number };
    tools: Array<{ name: string; cliPath: string; operation: string }>;
  };
  assert.equal(value.version, AI_HUB_RELEASE_VERSION);
  assert.equal(value.configPath, configFilePath());
  assert.deepEqual(value.productScope, {
    spot: true,
    spotMargin: { isolated: true, cross: true, explicitLeverageMultiplier: false },
    derivatives: false
  });
  assert.equal(value.summary.totalTools, value.summary.readTools + value.summary.writeTools);
  assert.ok(value.tools.some((tool) => tool.name === "market_get_ticker" && tool.cliPath === "market ticker" && tool.operation === "read"));
  assert.ok(value.tools.some((tool) => tool.name === "spot_limit_order" && tool.operation === "write"));
});

test("CLI preserves leverage-multiplier flags for the shared spot-margin boundary error", () => {
  const tool = createToolRegistry().byName("margin_limit_order");
  const input = parseToolInput(tool, [
    "--symbol", "BTCUSDT",
    "--side", "BUY",
    "--base-quantity", "0.001",
    "--price", "60000",
    "--isolated", "true",
    "--leverage", "10"
  ]);
  assert.throws(
    () => tool.validate(input),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_MARGIN_LEVERAGE_MULTIPLIER_NOT_SUPPORTED"
  );
});
