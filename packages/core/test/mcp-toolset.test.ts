import assert from "node:assert/strict";
import test from "node:test";
import { AiHubError, createToolRegistry, parseMcpToolset, selectMcpToolset } from "../src/index.js";

test("default and full MCP Toolsets both include every registered business capability", () => {
  const all = createToolRegistry().list();
  const expected = all.map((tool) => tool.name).sort();
  assert.deepEqual(selectMcpToolset(all, "default").map((tool) => tool.name).sort(), expected);
  assert.deepEqual(selectMcpToolset(all, "full").map((tool) => tool.name).sort(), expected);
  assert.ok(expected.includes("account_get_asset_balance"));
  assert.ok(expected.includes("account_list_balances"));
  assert.ok(expected.includes("margin_get_order"));
  assert.ok(expected.includes("sub_account_list"));
  assert.ok(expected.includes("wallet_create_withdraw"));
});

test("MCP Toolset parser retains both compatible names", () => {
  assert.equal(parseMcpToolset(undefined), "default");
  assert.equal(parseMcpToolset("default"), "default");
  assert.equal(parseMcpToolset("full"), "full");
  assert.throws(() => parseMcpToolset("trader"), (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_ARGUMENT");
});
