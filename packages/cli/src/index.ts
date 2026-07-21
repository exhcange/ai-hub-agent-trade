#!/usr/bin/env node
import { AiHubError, AiHubSpotApi, ConfigStore, CredentialStore, configFilePath } from "@ai-hub/agent-trade-core";

function printHelp(): void {
  process.stdout.write(`AI Hub Agent Trade CLI

Usage:
  ai-hub config init
  ai-hub config set --profile <name> --openapi-base-url <https-url>
  ai-hub config set-credentials --profile <name>
  ai-hub config show [--profile <name>]
  ai-hub config remove --profile <name>
  ai-hub market <time|symbols|ticker|depth|trades|klines> [options]
  ai-hub account get [--profile <name>]

Credentials are prompted interactively and stored only in the operating-system credential manager.
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

async function runMarket(args: string[], profileName: string | undefined): Promise<void> {
  const action = args[1];
  const profile = await new ConfigStore().showProfile(profileName);
  const api = new AiHubSpotApi(profile.openApiBaseUrl);
  switch (action) {
    case "time": json(await api.time()); return;
    case "symbols": json(await api.symbols()); return;
    case "ticker": json(await api.ticker({ symbol: optionValue(args, "--symbol"), symbols: optionValue(args, "--symbols"), timeZone: optionValue(args, "--time-zone") })); return;
    case "depth": {
      const symbol = optionValue(args, "--symbol");
      if (!symbol) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "market depth requires --symbol.");
      json(await api.depth(symbol, Number(optionValue(args, "--limit") ?? 20)));
      return;
    }
    case "trades": {
      const symbol = optionValue(args, "--symbol");
      if (!symbol) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "market trades requires --symbol.");
      json(await api.trades(symbol, Number(optionValue(args, "--limit") ?? 100)));
      return;
    }
    case "klines": {
      const symbol = optionValue(args, "--symbol");
      const interval = optionValue(args, "--interval");
      if (!symbol || !interval) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "market klines requires --symbol and --interval.");
      json(await api.klines({ symbol, interval, limit: Number(optionValue(args, "--limit") ?? 100), timezone: optionValue(args, "--time-zone") }));
      return;
    }
    default:
      throw new AiHubError("AI_HUB_UNKNOWN_COMMAND", "Use one of: time, symbols, ticker, depth, trades, klines.");
  }
}

async function runAccount(args: string[], profileName: string | undefined): Promise<void> {
  if (args[1] !== "get") throw new AiHubError("AI_HUB_UNKNOWN_COMMAND", "Use: ai-hub account get.");
  const config = new ConfigStore();
  const profile = await config.showProfile(profileName);
  const credentials = await new CredentialStore().get(profile.name);
  if (!credentials) throw new AiHubError("AI_HUB_CREDENTIAL_NOT_CONFIGURED", `Credentials are not configured for profile "${profile.name}".`);
  json(await new AiHubSpotApi(profile.openApiBaseUrl).account(credentials));
}

export async function run(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  const profile = optionValue(argv, "--profile");

  if (argv[0] === "market") return runMarket(argv, profile);
  if (argv[0] === "account") return runAccount(argv, profile);
  if (argv[0] !== "config") throw new AiHubError("AI_HUB_UNKNOWN_COMMAND", `Unknown command "${argv[0]}". Run "ai-hub --help".`);

  const action = argv[1];
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
      const stored = await new CredentialStore().set(profile, { apiKey, secretKey });
      const resolved = await store.setCredentialRef(profile, stored.credentialRef);
      json({ profile: resolved.name, credentialConfigured: true, credentialVersion: stored.credentialVersion });
      return;
    }
    case "show": {
      const resolved = await store.showProfile(profile);
      json({ ...resolved, credentialConfigured: Boolean(resolved.credentialRef), configPath: configFilePath() });
      return;
    }
    case "remove":
      if (!profile) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "config remove requires --profile.");
      await store.showProfile(profile);
      await new CredentialStore().remove(profile);
      await store.removeProfile(profile);
      json({ removed: profile });
      return;
    default:
      throw new AiHubError("AI_HUB_UNKNOWN_COMMAND", "Use one of: init, set, show, remove.");
  }
}

run(process.argv.slice(2)).catch((error: unknown) => {
  const payload = error instanceof AiHubError
    ? { code: error.code, message: error.message }
    : { code: "AI_HUB_UNEXPECTED_ERROR", message: error instanceof Error ? error.message : "Unexpected error" };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
