import assert from "node:assert/strict";
import test from "node:test";
import { codexAgentArguments, runFast } from "../src/fast.js";

test("aihub fast CLI executes and renders a common read without an Agent", async () => {
  const output: string[] = [];
  let agentCalls = 0;
  await runFast(["看资产余额"], {
    execute: async (route) => {
      assert.equal(route.toolName, "account_list_balances");
      assert.deepEqual(route.input, {});
      return { balances: [{ asset: "USDT", total: "2", available: "1.5", frozen: "0.5" }] };
    },
    runAgent: () => { agentCalls += 1; return 0; },
    write: (text) => output.push(text)
  });
  assert.equal(agentCalls, 0);
  assert.equal(output.join(""), "USDT: total 2, available 1.5, frozen 0.5\n");
});

test("aihub fast CLI falls back to a luna low MCP-only Codex Agent", async () => {
  let fallbackPrompt = "";
  let fallbackProfile: string | undefined;
  await runFast(["分析", "BTCUSDT", "趋势", "--profile", "default"], {
    execute: async () => { throw new Error("fast route must not run"); },
    runAgent: (prompt, profile) => { fallbackPrompt = prompt; fallbackProfile = profile; return 0; },
    write: () => undefined
  });
  assert.equal(fallbackPrompt, "分析 BTCUSDT 趋势");
  assert.equal(fallbackProfile, "default");

  const args = codexAgentArguments(fallbackPrompt, fallbackProfile);
  assert.ok(args.includes("gpt-5.6-luna"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("model_reasoning_effort=\"low\""));
  assert.ok(args.some((value) => value.includes("mcp_servers.aihub.command")));
  assert.ok(args.some((value) => value.includes("skills.config") && value.includes("ai-hub-spot-account")));
  assert.match(args.at(-1) ?? "", /only the configured AI Hub MCP server/i);
  assert.match(args.at(-1) ?? "", /Never call confirm_action until a new user message/i);
});

test("--no-agent rejects requests outside the deterministic surface", async () => {
  await assert.rejects(
    runFast(["--no-agent", "分析", "BTCUSDT", "趋势"], { write: () => undefined }),
    (error: unknown) => error instanceof Error && error.message.includes("not supported by the deterministic fast path")
  );
});
