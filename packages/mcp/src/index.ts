#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AiHubError } from "@ai-hub/agent-trade-core";
import { createServer } from "./server.js";

function readOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${option} requires a value.`);
  return value;
}

export async function main(argv: string[]): Promise<void> {
  const profileName = readOption(argv, "--profile");
  const readOnly = argv.includes("--read-only");
  const server = createServer(profileName, readOnly);
  await server.connect(new StdioServerTransport());
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const payload = error instanceof AiHubError
    ? { code: error.code, message: error.message }
    : { code: "AI_HUB_UNEXPECTED_ERROR", message: error instanceof Error ? error.message : "Unexpected error" };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
