#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AI_HUB_RELEASE_VERSION, AiHubError, parseMcpResponseMode, parseMcpToolset, printMcpSetupUsage, runMcpSetup, SUPPORTED_MCP_CLIENTS, type McpClientId } from "@ai-hub/agent-trade-core";
import { createServer } from "./server.js";

function readOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${option} requires a value.`);
  return value;
}

function printUsage(): void {
  process.stdout.write(
    "AI Hub Agent Trade MCP\n\n" +
    "Usage:\n" +
    "  ai-hub-trade-mcp [--profile <name>] [--toolset <default|full>] [--response-mode <compact|compat>] [--read-only]\n" +
    "  ai-hub-trade-mcp setup --client <client> [--profile <name>] [--toolset <default|full>] [--response-mode <compact|compat>]\n\n" +
    "The default command starts the local stdio MCP server.\n" +
    "Use setup to register it with Cursor, Claude Desktop, Claude Code, Codex, or OpenClaw.\n"
  );
}

export async function main(argv: string[]): Promise<void> {
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${AI_HUB_RELEASE_VERSION}\n`);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }

  if (argv[0] === "setup") {
    const client = readOption(argv.slice(1), "--client");
    const profile = readOption(argv.slice(1), "--profile");
    const toolset = parseMcpToolset(readOption(argv.slice(1), "--toolset"));
    const responseMode = parseMcpResponseMode(readOption(argv.slice(1), "--response-mode"));
    if (!client) {
      printMcpSetupUsage();
      return;
    }
    if (!SUPPORTED_MCP_CLIENTS.includes(client as McpClientId)) {
      throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `Unknown MCP client "${client}". Supported clients: ${SUPPORTED_MCP_CLIENTS.join(", ")}.`);
    }
    const entrypoint = process.argv[1];
    if (!entrypoint) throw new AiHubError("AI_HUB_UNEXPECTED_ERROR", "Cannot locate the local MCP server entrypoint for client setup.");
    runMcpSetup({ client: client as McpClientId, profile, toolset, responseMode, launch: { command: process.execPath, args: [entrypoint] } });
    return;
  }
  const profileName = readOption(argv, "--profile");
  const readOnly = argv.includes("--read-only");
  const toolset = parseMcpToolset(readOption(argv, "--toolset"));
  const responseMode = parseMcpResponseMode(readOption(argv, "--response-mode"));
  const server = createServer(profileName, readOnly, toolset, responseMode);
  await server.connect(new StdioServerTransport());
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectExecution()) main(process.argv.slice(2)).catch((error: unknown) => {
  const payload = error instanceof AiHubError
    ? { code: error.code, message: error.message }
    : { code: "AI_HUB_UNEXPECTED_ERROR", message: error instanceof Error ? error.message : "Unexpected error" };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
