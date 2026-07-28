import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { validateProfileName } from "./config.js";
import { DEFAULT_MCP_TOOLSET, parseMcpToolset, type McpToolset } from "./tools/mcp-toolset.js";
import { DEFAULT_MCP_RESPONSE_MODE, parseMcpResponseMode, type McpResponseMode } from "./mcp-response-mode.js";

export type McpClientId = "cursor" | "claude-desktop" | "claude-code" | "codex" | "openclaw";

export interface McpSetupOptions {
  client: McpClientId;
  profile?: string;
  toolset?: McpToolset;
  responseMode?: McpResponseMode;
  launch: McpServerLaunch;
}

export interface McpServerLaunch {
  command: string;
  args: string[];
}

export interface McpSetupRuntime {
  home: string;
  platform: NodeJS.Platform;
  cwd: string;
  appData?: string;
  localAppData?: string;
  xdgConfigHome?: string;
  executeClientCommand?: (command: "claude" | "codex" | "openclaw", args: string[]) => void;
}

const MCP_BINARY = "ai-hub-trade-mcp";

export const MCP_CLIENT_NAMES: Record<McpClientId, string> = {
  cursor: "Cursor",
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  codex: "Codex",
  openclaw: "OpenClaw"
};

export const SUPPORTED_MCP_CLIENTS = Object.keys(MCP_CLIENT_NAMES) as McpClientId[];

interface McpServerSpec {
  name: string;
  command: string;
  args: string[];
}

interface McpClientAdapter {
  readonly id: McpClientId;
  readonly name: string;
  install(server: McpServerSpec, value: McpSetupRuntime): void;
}

function runtime(): McpSetupRuntime {
  const home = os.homedir();
  return {
    home,
    platform: process.platform,
    cwd: process.cwd(),
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    xdgConfigHome: process.env.XDG_CONFIG_HOME
  };
}

function windowsAppData(value: string | undefined, home: string): string {
  return value ?? path.join(home, "AppData", "Roaming");
}

function findMicrosoftStoreClaudePath(value: string | undefined, home: string): string | undefined {
  const packagesDirectory = path.join(value ?? path.join(home, "AppData", "Local"), "Packages");
  try {
    const packageName = fs.readdirSync(packagesDirectory).find((entry) => entry.startsWith("Claude_"));
    if (!packageName) return undefined;
    const configPath = path.join(
      packagesDirectory,
      packageName,
      "LocalCache",
      "Roaming",
      "Claude",
      "claude_desktop_config.json"
    );
    return fs.existsSync(configPath) || fs.existsSync(path.dirname(configPath)) ? configPath : undefined;
  } catch {
    return undefined;
  }
}

/** Returns every JSON configuration file that must receive one client registration. */
function getMcpClientConfigPaths(client: Exclude<McpClientId, "claude-code" | "codex" | "openclaw">, value: McpSetupRuntime = runtime()): string[] {
  if (client === "cursor") return [path.join(value.home, ".cursor", "mcp.json")];

  if (value.platform === "win32") {
    return [findMicrosoftStoreClaudePath(value.localAppData, value.home)
      ?? path.join(windowsAppData(value.appData, value.home), "Claude", "claude_desktop_config.json")];
  }
  if (value.platform === "darwin") {
    const legacyPath = path.join(value.home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    const modernPath = path.join(value.home, "Library", "Application Support", "Claude-3p", "claude_desktop_config.json");
    // Keep the documented legacy registration current. A running Claude-3p
    // installation reads its own file, so update that existing registry too.
    return fs.existsSync(modernPath) ? [legacyPath, modernPath] : [legacyPath];
  }
  return [path.join(value.xdgConfigHome ?? path.join(value.home, ".config"), "Claude", "claude_desktop_config.json")];
}

/** Returns the primary config file for callers that only need one display path. */
export function getMcpClientConfigPath(client: Exclude<McpClientId, "claude-code" | "codex" | "openclaw">, value: McpSetupRuntime = runtime()): string {
  return getMcpClientConfigPaths(client, value)[0]!;
}

function buildServerSpec(profile: string | undefined, toolset: McpToolset, responseMode: McpResponseMode, launch: McpServerLaunch): McpServerSpec {
  return {
    name: serverName(profile),
    command: launch.command,
    args: [...launch.args, ...(profile ? ["--profile", profile] : []), "--toolset", toolset, "--response-mode", responseMode]
  };
}

function serverName(profile?: string): string {
  return profile ? `${MCP_BINARY}-${profile}` : MCP_BINARY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeJsonMcpConfig(configPath: string, server: McpServerSpec): void {
  const directory = path.dirname(configPath);
  fs.mkdirSync(directory, { recursive: true });

  const configExists = fs.existsSync(configPath);
  let config: Record<string, unknown> = {};
  if (configExists) {
    const raw = fs.readFileSync(configPath, "utf8");
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("root must be a JSON object");
      config = parsed;
    } catch {
      throw new Error(`Failed to parse existing MCP configuration at ${configPath}. No changes were made.`);
    }
  }

  if (config.mcpServers === undefined) {
    config.mcpServers = {};
  }
  if (!isRecord(config.mcpServers)) {
    throw new Error(`Existing MCP configuration at ${configPath} has an invalid mcpServers object. No changes were made.`);
  }
  if (configExists) {
    const backupPath = `${configPath}.bak`;
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(configPath, backupPath);
      process.stdout.write(`Backup created: ${backupPath}\n`);
    }
  }
  config.mcpServers[server.name] = { command: server.command, args: server.args };

  const mode = configExists ? fs.statSync(configPath).mode & 0o777 : 0o600;
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode });
  fs.chmodSync(temporaryPath, mode);
  fs.renameSync(temporaryPath, configPath);
}

function executeClientRegistration(command: "claude" | "codex" | "openclaw", args: string[], value: McpSetupRuntime): void {
  process.stdout.write(`Running: ${command} ${args.join(" ")}\n`);
  if (value.executeClientCommand) {
    value.executeClientCommand(command, args);
    return;
  }
  execFileSync(command, args, { stdio: "inherit" }); // NOSONAR -- commands and arguments are fixed by this module.
}

function jsonFileAdapter(id: "cursor" | "claude-desktop"): McpClientAdapter {
  return {
    id,
    name: MCP_CLIENT_NAMES[id],
    install(server, value): void {
      const configPaths = getMcpClientConfigPaths(id, value);
      for (const configPath of configPaths) mergeJsonMcpConfig(configPath, server);
      process.stdout.write(`Configured ${this.name}: ${configPaths.join(", ")}\nRestart ${this.name} to apply changes.\n`);
    }
  };
}

function cliAdapter(id: "claude-code" | "codex"): McpClientAdapter {
  const command = id === "claude-code" ? "claude" : "codex";
  return {
    id,
    name: MCP_CLIENT_NAMES[id],
    install(server, value): void {
      const args = [
        "mcp",
        "add",
        ...(id === "claude-code" ? ["--scope", "user", "--transport", "stdio"] : []),
        server.name,
        "--",
        server.command,
        ...server.args
      ];
      executeClientRegistration(command, args, value);
      process.stdout.write(`Configured ${this.name} with local stdio MCP server "${server.name}".\n`);
    }
  };
}

/**
 * OpenClaw owns its gateway configuration. Register through its CLI instead
 * of writing an implementation-specific config file, so this remains stable
 * across local and remote Gateway installations.
 */
function openClawAdapter(): McpClientAdapter {
  return {
    id: "openclaw",
    name: MCP_CLIENT_NAMES.openclaw,
    install(server, value): void {
      const args = [
        "mcp",
        "add",
        server.name,
        "--command",
        server.command,
        ...server.args.flatMap((argument) => ["--arg", argument])
      ];
      executeClientRegistration("openclaw", args, value);
      process.stdout.write(
        `Configured ${this.name} with local stdio MCP server "${server.name}". ` +
        `Run \`openclaw mcp doctor ${server.name} --probe\` to verify it.\n`
      );
    }
  };
}

const MCP_CLIENT_ADAPTERS: Record<McpClientId, McpClientAdapter> = {
  cursor: jsonFileAdapter("cursor"),
  "claude-desktop": jsonFileAdapter("claude-desktop"),
  "claude-code": cliAdapter("claude-code"),
  codex: cliAdapter("codex"),
  openclaw: openClawAdapter()
};

/** Registers the local stdio MCP package with one supported AI client. */
export function runMcpSetup(options: McpSetupOptions, value: McpSetupRuntime = runtime()): void {
  const adapter = MCP_CLIENT_ADAPTERS[options.client];
  if (!adapter) {
    throw new Error(`Unknown MCP client "${options.client}". Supported clients: ${SUPPORTED_MCP_CLIENTS.join(", ")}.`);
  }
  const profile = options.profile ? validateProfileName(options.profile) : undefined;
  const toolset = parseMcpToolset(options.toolset ?? DEFAULT_MCP_TOOLSET);
  const responseMode = parseMcpResponseMode(options.responseMode ?? DEFAULT_MCP_RESPONSE_MODE);
  adapter.install(buildServerSpec(profile, toolset, responseMode, options.launch), value);
}

export function printMcpSetupUsage(): void {
  process.stdout.write(
    `Usage: ${MCP_BINARY} setup --client <client> [--profile <name>] [--toolset <default|full>] [--response-mode <compact|compat>]\n\n` +
    `Supported clients:\n` +
    SUPPORTED_MCP_CLIENTS.map((client) => `  ${client.padEnd(16)} ${MCP_CLIENT_NAMES[client]}`).join("\n") +
    "\n"
  );
}
