import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, DEFAULT_MCP_RESPONSE_MODE, parseMcpResponseMode } from "../src/index.js";

test("MCP response mode defaults to compact and validates explicit compatibility mode", () => {
  assert.equal(DEFAULT_MCP_RESPONSE_MODE, "compact");
  assert.equal(parseMcpResponseMode(undefined), "compact");
  assert.equal(parseMcpResponseMode("compat"), "compat");
  assert.throws(
    () => parseMcpResponseMode("verbose"),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT"
  );
});
