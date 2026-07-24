import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../src/index.js";

test("MCP help prints usage and does not start the stdio server", async () => {
  const output: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await main(["--help"]);
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(output.join(""), /ai-hub-trade-mcp \[--profile <name>\]/);
  assert.match(output.join(""), /default command starts the local stdio MCP server/i);
});
