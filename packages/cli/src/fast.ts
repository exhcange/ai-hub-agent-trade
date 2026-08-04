#!/usr/bin/env node
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_HUB_RELEASE_VERSION,
  AiHubError,
  createToolExecutionContext,
  createToolRegistry,
  matchAiHubFastRoute,
  renderAiHubFastResult,
  toAiHubErrorPayload,
  validateProfileName,
  type AiHubFastRoute
} from "@ai-hub/agent-trade-core";

export interface FastCliRuntime {
  execute?: (route: AiHubFastRoute, profile: string | undefined) => Promise<unknown>;
  runAgent?: (prompt: string, profile: string | undefined) => number;
  write?: (text: string) => void;
}

function printHelp(write: (text: string) => void): void {
  write(`AI Hub Fast Router

Usage:
  aihub <request> [--profile <name>]
  aihub --no-agent <request> [--profile <name>]

Examples:
  aihub show asset balances
  aihub show USDT balance
  aihub show BTCUSDT price
  aihub show open orders

Common read requests use the local deterministic fast path. Ambiguous or complex requests fall back to a Codex luna/low Agent that may use only AI Hub MCP tools.
`);
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} requires a value.`);
  return value;
}

function requestArguments(args: readonly string[]): string[] {
  const profileIndex = args.indexOf("--profile");
  return args.filter((value, index) => value !== "--no-agent" && (profileIndex < 0 || (index !== profileIndex && index !== profileIndex + 1)));
}

async function executeFastRoute(route: AiHubFastRoute, profile: string | undefined): Promise<unknown> {
  const context = await createToolExecutionContext(profile);
  return createToolRegistry().execute(route.toolName, route.input, context, { readOnly: true });
}

export function codexAgentArguments(prompt: string, profile: string | undefined): string[] {
  const mcpArgs = [...(profile ? ["--profile", profile] : []), "--toolset", "default", "--response-mode", "compact"];
  const skillNames = ["ai-hub-spot", "ai-hub-spot-account", "ai-hub-spot-common", "ai-hub-spot-deposit-withdraw", "ai-hub-spot-order", "ai-hub-spot-sub-account"];
  const disabledSkills = skillNames
    .map((name) => `{ path = ${JSON.stringify(join(homedir(), ".agents", "skills", name, "SKILL.md"))}, enabled = false }`)
    .join(", ");
  const agentPrompt = [
    "Use only the configured AI Hub MCP server \"aihub\".",
    "Do not read Skills, call any CLI or shell command, use web search, or use non-AIHub tools.",
    "For writes, call only a prepare tool, show the preview, and stop. Never call confirm_action until a new user message explicitly confirms that exact preview.",
    `User request: ${prompt}`
  ].join(" ");
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--color", "never",
    "--skip-git-repo-check",
    "-s", "read-only",
    "-m", "gpt-5.6-luna",
    "-c", "model_reasoning_effort=\"low\"",
    "-c", "service_tier=\"fast\"",
    "-c", "web_search=\"disabled\"",
    "-c", "agents.enabled=false",
    "-c", `skills.config=[${disabledSkills}]`,
    "-c", `mcp_servers.aihub.command=${JSON.stringify("ai-hub-trade-mcp")}`,
    "-c", `mcp_servers.aihub.args=${JSON.stringify(mcpArgs)}`,
    "-c", "mcp_servers.aihub.required=true",
    agentPrompt
  ];
}

function runCodexAgent(prompt: string, profile: string | undefined): number {
  const result: SpawnSyncReturns<string> = spawnSync("codex", codexAgentArguments(prompt, profile), {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"]
  });
  if (result.error) {
    throw new AiHubError("AI_HUB_CODEX_NOT_AVAILABLE", `Codex Agent fallback could not start: ${result.error.message}`);
  }
  if (result.status === 0) {
    process.stdout.write(result.stdout);
  } else {
    process.stderr.write(result.stderr);
  }
  return result.status ?? 1;
}

/** Runs one deterministic request or delegates an ambiguous request to Codex. */
export async function runFast(argv: string[], runtime: FastCliRuntime = {}): Promise<void> {
  const write = runtime.write ?? ((text: string) => process.stdout.write(text));
  if (argv.includes("--version") || argv.includes("-V")) {
    write(`${AI_HUB_RELEASE_VERSION}\n`);
    return;
  }
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    printHelp(write);
    return;
  }
  const profileOption = option(argv, "--profile");
  const profile = profileOption ? validateProfileName(profileOption) : undefined;
  const noAgent = argv.includes("--no-agent");
  const prompt = requestArguments(argv).join(" ").trim();
  if (!prompt) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "A request is required.");

  const route = matchAiHubFastRoute(`aihub ${prompt}`);
  if (route) {
    const data = await (runtime.execute ?? executeFastRoute)(route, profile);
    write(`${renderAiHubFastResult(route, data)}\n`);
    return;
  }
  if (noAgent) {
    throw new AiHubError("AI_HUB_FAST_ROUTE_NOT_FOUND", "The request is not supported by the deterministic fast path. Remove --no-agent to use the Codex fallback.");
  }
  const status = (runtime.runAgent ?? runCodexAgent)(prompt, profile);
  if (status !== 0) throw new AiHubError("AI_HUB_CODEX_AGENT_FAILED", `Codex Agent fallback exited with status ${status}.`);
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectExecution()) runFast(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(toAiHubErrorPayload(error))}\n`);
  process.exitCode = 1;
});
