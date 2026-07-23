#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { AiHubError, ConfigStore, configFilePath, createToolExecutionContext, createToolRegistry, toAiHubErrorPayload, ToolWriteExecutor, type ToolSpec } from "@ai-hub/agent-trade-core";

function printHelp(): void {
  process.stdout.write(`AI Hub Agent Trade CLI

Usage:
  ai-hub config init
  ai-hub config set --profile <name> --openapi-base-url <https-url>
  ai-hub config set-credentials --profile <name>
  ai-hub config show [--profile <name>]
  ai-hub config remove --profile <name>
  ai-hub market <ping|time|symbols|ticker|depth|trades|klines> [options]
  ai-hub account <get|transfer|transfer-history> [options]
  ai-hub spot order <test|get|open|fills|place|cancel|batch-place|batch-cancel> [options]
  ai-hub margin order <get|open|fills|place|cancel> [options]
  ai-hub wallet <transfer|transfer-history|deposit-history|deposit-address|withdraw-address|transferable-assets|exchange-account|withdraw|withdraw-history> [options]
  ai-hub sub-account <list|create|set-trading-status|assets|root-transfer|root-transfer-history|internal-transfer|internal-transfer-history|transfer-to-parent|parent-transfer-history> [options]
  ai-hub sub-account api-key <list|set-ip|delete> [options]

Credentials are prompted interactively and saved as plaintext in ~/.ai-hub/config.toml (mode 600).
Array arguments such as --orders and --order-ids use a JSON array value.
`);
}

function optionValue(args: string[], option: string): string | undefined {
  const position = args.indexOf(option);
  if (position < 0) return undefined;
  const value = args[position + 1];
  if (!value || value.startsWith("--")) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${option} requires a value.`);
  }
  return value;
}

function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new AiHubError("AI_HUB_INTERACTIVE_INPUT_REQUIRED", "Credential setup requires an interactive terminal.");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new AiHubError("AI_HUB_CREDENTIAL_INPUT_CANCELLED", "Credential input cancelled."));
          return;
        }
        if (byte === 13 || byte === 10) {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (byte === 127 || byte === 8) {
          value = value.slice(0, -1);
          continue;
        }
        if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
      }
    };
    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
  });
}

async function approveWrite(preview: unknown): Promise<string | undefined> {
  json({
    preview,
    executed: false,
    requiresNewUserConfirmation: true,
    message: "This request is only a preview. A person must review it and enter yes as a new terminal response to execute."
  });
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new AiHubError("AI_HUB_CONFIRMATION_REQUIRED", "State-changing commands require an interactive terminal and a new manual yes response after the preview.");
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question("Type yes to execute: ");
  readline.close();
  return answer.trim().toLowerCase() === "yes" ? answer.trim() : undefined;
}

function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function parseToolInput(tool: ToolSpec, args: string[]): Record<string, unknown> {
  const properties = tool.inputSchema.properties ?? {};
  const input: Record<string, unknown> = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option?.startsWith("--")) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `Unexpected argument "${option}".`);
    const camelKey = camelCase(option.slice(2));
    const key = properties[camelKey] ? camelKey : camelKey === "timeZone" && properties.timezone ? "timezone" : camelKey;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${option} requires a value.`);
    index += 1;
    const property = properties[key] as { type?: string } | undefined;
    if (!property) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `Unknown argument "${option}" for ${tool.cliPath.join(" ")}.`);
    if (property.type === "integer") {
      input[key] = Number(value);
    } else if (property.type === "boolean") {
      if (!["true", "false", "1", "0"].includes(value)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${option} must be true, false, 1, or 0.`);
      input[key] = value === "true" || value === "1";
    } else if (property.type === "array") {
      try { input[key] = JSON.parse(value); } catch { throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${option} must be a JSON array.`); }
    } else {
      input[key] = value;
    }
  }
  return input;
}

function findTool(args: string[]): ToolSpec | undefined {
  const registry = createToolRegistry();
  return registry.list().sort((left, right) => right.cliPath.length - left.cliPath.length).find((tool) => tool.cliPath.every((part, index) => args[index] === part));
}

async function runTool(args: string[], profileName: string | undefined): Promise<void> {
  if (args.includes("--confirm")) {
    throw new AiHubError("AI_HUB_CONFIRMATION_REQUIRED", "--confirm is not supported. Review the preview, then provide a new manual yes response in an interactive terminal.");
  }
  const registry = createToolRegistry();
  const tool = findTool(args);
  if (!tool) throw new AiHubError("AI_HUB_UNKNOWN_COMMAND", "Unknown API command. Run ai-hub --help for available command groups.");
  const input = parseToolInput(tool, args.slice(tool.cliPath.length));
  const context = await createToolExecutionContext(profileName);
  if (tool.operation === "read") {
    json(await registry.execute(tool.name, input, context));
    return;
  }
  const executor = new ToolWriteExecutor(registry);
  const prepared = executor.prepare(tool.name, input, context);
  const userConfirmation = await approveWrite({ action: prepared.action, summary: prepared.summary, requestHash: prepared.requestHash, expiresAt: prepared.expiresAt });
  if (!userConfirmation) return;
  json(await executor.confirm(prepared.confirmationId, userConfirmation, context));
}

export async function run(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  const profile = optionValue(argv, "--profile");
  const commandArgs = profile ? argv.filter((value, index) => value !== "--profile" && index !== argv.indexOf("--profile") + 1) : argv;

  if (commandArgs[0] !== "config") return runTool(commandArgs, profile);

  const action = commandArgs[1];
  const store = new ConfigStore();

  switch (action) {
    case "init":
      json(await store.initialize());
      return;
    case "set": {
      const openApiBaseUrl = optionValue(argv, "--openapi-base-url");
      if (!profile || !openApiBaseUrl) {
        throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "config set requires --profile and --openapi-base-url.");
      }
      json(await store.setProfile(profile, openApiBaseUrl));
      return;
    }
    case "set-credentials": {
      if (!profile) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "config set-credentials requires --profile.");
      await store.showProfile(profile);
      const apiKey = await readHidden("API key: ");
      const secretKey = await readHidden("Secret key: ");
      const resolved = await store.setCredentials(profile, { apiKey, secretKey });
      json({ profile: resolved.name, credentialConfigured: true, configVersion: resolved.configVersion });
      return;
    }
    case "show": {
      const resolved = await store.showProfile(profile);
      json({ ...resolved, credentialConfigured: Boolean(await store.getCredentials(profile)), configPath: configFilePath() });
      return;
    }
    case "remove":
      if (!profile) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "config remove requires --profile.");
      await store.showProfile(profile);
      await store.removeProfile(profile);
      json({ removed: profile });
      return;
    default:
      throw new AiHubError("AI_HUB_UNKNOWN_COMMAND", "Use one of: init, set, show, remove.");
  }
}

run(process.argv.slice(2)).catch((error: unknown) => {
  const payload = toAiHubErrorPayload(error);
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
