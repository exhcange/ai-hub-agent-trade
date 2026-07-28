#!/usr/bin/env node
import { AiHubError, ConfigStore, configFilePath, confirmationContext, createToolExecutionContext, createToolRegistry, FileConfirmationStore, toAiHubErrorPayload, type ToolSpec } from "@ai-hub/agent-trade-core";

function printHelp(): void {
  process.stdout.write(`AI Hub Agent Trade CLI

Usage:
  ai-hub config init
  ai-hub config set --profile <name> --openapi-base-url <https-url>
  ai-hub config set-credentials --profile <name>
  ai-hub config show [--profile <name>]
  ai-hub config remove --profile <name>
  ai-hub confirm --confirmation-id <id> --user-confirmation <new-user-message> [--profile <name>]
  ai-hub market <ping|time|symbols|symbols-overview|symbols-list|symbols-search|symbol-info|ticker|ticker-summary|depth|depth-summary|trades|trades-summary|klines|klines-summary> [options]
  ai-hub account <asset-balance> [options]
  ai-hub spot order <test|get|open|fills|market-buy|market-sell|sell-available|limit|cancel|batch-place|batch-cancel> [options]
  ai-hub margin order <get|open|fills|market-buy|market-sell|limit|cancel> [options]
  ai-hub wallet <transfer|transfer-history|deposit-history|deposit-address|withdraw-address|transferable-assets|withdraw|withdraw-history> [options]
  ai-hub sub-account <list|create|set-trading-status|assets|root-transfer|root-transfer-history|internal-transfer|internal-transfer-history> [options]
  ai-hub sub-account api-key <list|set-ip|delete> [options]

State-changing commands only create a preview and exit. After a new user confirmation, run ai-hub confirm with the returned confirmation ID.
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
    throw new AiHubError("AI_HUB_CONFIRMATION_REQUIRED", "--confirm is not supported. Generate a preview, wait for a new user confirmation, then run ai-hub confirm with the returned confirmation ID.");
  }
  const commandArgs = args.filter((value) => value !== "--prepare");
  const registry = createToolRegistry();
  const tool = findTool(commandArgs);
  if (!tool) throw new AiHubError("AI_HUB_UNKNOWN_COMMAND", "Unknown API command. Run ai-hub --help for available command groups.");
  const input = parseToolInput(tool, commandArgs.slice(tool.cliPath.length));
  const context = await createToolExecutionContext(profileName);
  if (tool.operation === "read") {
    json(await registry.execute(tool.name, input, context));
    return;
  }
  const prepared = await registry.prepareWrite(tool.name, input, context, new FileConfirmationStore());
  json({
    preview: { action: prepared.action, summary: prepared.summary, requestHash: prepared.requestHash, expiresAt: prepared.expiresAt },
    confirmationId: prepared.confirmationId,
    executed: false,
    requiresNewUserConfirmation: true,
    nextStep: "Stop and wait for a new explicit user confirmation message. Then run ai-hub confirm with confirmationId and that message as userConfirmation."
  });
}

async function runConfirmation(args: string[], profileName: string | undefined): Promise<void> {
  const confirmationId = optionValue(args, "--confirmation-id");
  const userConfirmation = optionValue(args, "--user-confirmation");
  if (!confirmationId || !userConfirmation) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "confirm requires --confirmation-id and --user-confirmation.");
  }
  if (args.length !== 5 || args[0] !== "confirm" || args[1] !== "--confirmation-id" || args[2] !== confirmationId || args[3] !== "--user-confirmation" || args[4] !== userConfirmation) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "confirm accepts only --confirmation-id and --user-confirmation, plus --profile.");
  }
  const context = await createToolExecutionContext(profileName);
  const pending = await new FileConfirmationStore().confirm(confirmationId, userConfirmation, confirmationContext(context));
  try {
    json(await createToolRegistry().executeConfirmed(pending.action, pending.payload, context));
  } catch (error) {
    if (error instanceof AiHubError && error.code === "AI_HUB_OPENAPI_NETWORK_ERROR") {
      throw new AiHubError("AI_HUB_WRITE_RESULT_UNKNOWN", "The request may have reached OpenAPI. Do not retry automatically; query by client order ID before taking another action.");
    }
    throw error;
  }
}

export async function run(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  const profile = optionValue(argv, "--profile");
  const commandArgs = profile ? argv.filter((value, index) => value !== "--profile" && index !== argv.indexOf("--profile") + 1) : argv;

  if (commandArgs[0] === "confirm") return runConfirmation(commandArgs, profile);
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
