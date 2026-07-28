import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AiHubError, getMcpClientConfigPath, MCP_CLIENT_NAMES, runMcpSetup, SUPPORTED_MCP_CLIENTS } from "../src/index.js";

function setupOptions(client: "cursor" | "claude-desktop" | "claude-code" | "codex" | "openclaw", profile?: string) {
  return { client, profile, launch: { command: "/usr/local/bin/node", args: ["/opt/ai-hub/agent-trade-mcp/dist/index.js"] } };
}

test("declares the supported MCP clients", () => {
  assert.deepEqual(SUPPORTED_MCP_CLIENTS, ["cursor", "claude-desktop", "claude-code", "codex", "openclaw"]);
  assert.equal(MCP_CLIENT_NAMES.codex, "Codex");
  assert.equal(MCP_CLIENT_NAMES.openclaw, "OpenClaw");
});

test("resolves the Cursor MCP configuration path from the user home", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  const configPath = getMcpClientConfigPath("cursor", { home, platform: "darwin", cwd: home });
  assert.equal(configPath, join(home, ".cursor", "mcp.json"));
});

test("keeps the legacy macOS Claude Desktop path as the primary configuration path", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  await mkdir(join(home, "Library", "Application Support", "Claude-3p"), { recursive: true });
  const configPath = getMcpClientConfigPath("claude-desktop", { home, platform: "darwin", cwd: home });
  assert.equal(configPath, join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"));
});

test("falls back to the legacy macOS Claude configuration path", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  const configPath = getMcpClientConfigPath("claude-desktop", { home, platform: "darwin", cwd: home });
  assert.equal(configPath, join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"));
});

test("updates both existing macOS Claude and Claude-3p MCP registries", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  const legacyPath = join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  const modernPath = join(home, "Library", "Application Support", "Claude-3p", "claude_desktop_config.json");
  await mkdir(join(home, "Library", "Application Support", "Claude"), { recursive: true });
  await mkdir(join(home, "Library", "Application Support", "Claude-3p"), { recursive: true });
  await writeFile(legacyPath, JSON.stringify({ mcpServers: { legacy: { command: "legacy" } } }), "utf8");
  await writeFile(modernPath, JSON.stringify({ mcpServers: { modern: { command: "modern" } } }), "utf8");

  runMcpSetup(setupOptions("claude-desktop", "default"), { home, platform: "darwin", cwd: home });

  for (const [configPath, existingName] of [[legacyPath, "legacy"], [modernPath, "modern"]] as const) {
    const config = JSON.parse(await readFile(configPath, "utf8")) as { mcpServers: Record<string, unknown> };
    assert.ok(config.mcpServers[existingName]);
    assert.ok(config.mcpServers["ai-hub-trade-mcp-default"]);
    assert.ok(await readFile(`${configPath}.bak`, "utf8"));
  }
});

test("resolves the Linux Claude Desktop configuration path from XDG_CONFIG_HOME", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  const xdgConfigHome = join(home, "xdg-config");
  const configPath = getMcpClientConfigPath("claude-desktop", { home, platform: "linux", cwd: home, xdgConfigHome });
  assert.equal(configPath, join(xdgConfigHome, "Claude", "claude_desktop_config.json"));
});

test("does not change a user configuration while locating its path", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  const configPath = join(home, ".cursor", "mcp.json");
  await writeFile(join(home, "marker"), "unchanged", "utf8");
  assert.equal(getMcpClientConfigPath("cursor", { home, platform: "linux", cwd: home }), configPath);
  assert.equal(await readFile(join(home, "marker"), "utf8"), "unchanged");
});

test("merges a Cursor MCP registration and keeps an existing server", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  const configPath = join(home, ".cursor", "mcp.json");
  await (await import("node:fs/promises")).mkdir(join(home, ".cursor"), { recursive: true });
  await writeFile(configPath, JSON.stringify({ mcpServers: { existing: { command: "other" } } }), "utf8");

  runMcpSetup(setupOptions("cursor", "tenant-a"), { home, platform: "darwin", cwd: home });

  const config = JSON.parse(await readFile(configPath, "utf8")) as { mcpServers: Record<string, { command: string; args: string[] }> };
  assert.deepEqual(config.mcpServers.existing, { command: "other" });
  assert.deepEqual(config.mcpServers["ai-hub-trade-mcp-tenant-a"], {
    command: "/usr/local/bin/node",
    args: ["/opt/ai-hub/agent-trade-mcp/dist/index.js", "--profile", "tenant-a", "--toolset", "default", "--response-mode", "compact"]
  });
  assert.equal(await readFile(`${configPath}.bak`, "utf8"), JSON.stringify({ mcpServers: { existing: { command: "other" } } }));
});

test("preserves the first MCP configuration backup across repeated setup", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  const configPath = join(home, ".cursor", "mcp.json");
  const original = JSON.stringify({ mcpServers: { existing: { command: "other" } } });
  await (await import("node:fs/promises")).mkdir(join(home, ".cursor"), { recursive: true });
  await writeFile(configPath, original, "utf8");
  await chmod(configPath, 0o600);

  runMcpSetup(setupOptions("cursor", "tenant-a"), { home, platform: "darwin", cwd: home });
  runMcpSetup(setupOptions("cursor", "tenant-b"), { home, platform: "darwin", cwd: home });

  assert.equal(await readFile(`${configPath}.bak`, "utf8"), original);
  const config = JSON.parse(await readFile(configPath, "utf8")) as { mcpServers: Record<string, unknown> };
  assert.ok(config.mcpServers["ai-hub-trade-mcp-tenant-a"]);
  assert.ok(config.mcpServers["ai-hub-trade-mcp-tenant-b"]);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
});

test("writes a new MCP configuration with owner-only permissions", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  const configPath = join(home, ".cursor", "mcp.json");

  runMcpSetup(setupOptions("cursor"), { home, platform: "darwin", cwd: home });

  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
});

test("rejects invalid JSON root or mcpServers objects without modifying the configuration", async () => {
  for (const value of ["[]", "null", JSON.stringify({ mcpServers: [] })]) {
    const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
    const configPath = join(home, ".cursor", "mcp.json");
    await (await import("node:fs/promises")).mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(configPath, value, "utf8");

    assert.throws(
      () => runMcpSetup(setupOptions("cursor"), { home, platform: "darwin", cwd: home }),
      /No changes were made/
    );
    assert.equal(await readFile(configPath, "utf8"), value);
    await assert.rejects(readFile(`${configPath}.bak`, "utf8"), { code: "ENOENT" });
  }
});

test("rejects an invalid profile before changing a client configuration", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  assert.throws(
    () => runMcpSetup(setupOptions("cursor", "../invalid"), { home, platform: "darwin", cwd: home }),
    (error: unknown) => error instanceof AiHubError && error.code === "AI_HUB_INVALID_PROFILE"
  );
  await assert.rejects(readFile(join(home, ".cursor", "mcp.json"), "utf8"), { code: "ENOENT" });
});

test("uses the official client CLIs for Claude Code, Codex, and OpenClaw", async () => {
  const home = await mkdtemp(join(tmpdir(), "ai-hub-setup-"));
  const commands: Array<{ command: string; args: string[] }> = [];
  const value = {
    home,
    platform: "darwin" as const,
    cwd: home,
    executeClientCommand(command: "claude" | "codex" | "openclaw", args: string[]): void {
      commands.push({ command, args });
    }
  };

  runMcpSetup(setupOptions("claude-code", "default"), value);
  runMcpSetup(setupOptions("codex", "default"), value);
  runMcpSetup(setupOptions("openclaw", "default"), value);

  assert.deepEqual(commands, [
    {
      command: "claude",
      args: ["mcp", "add", "--scope", "user", "--transport", "stdio", "ai-hub-trade-mcp-default", "--", "/usr/local/bin/node", "/opt/ai-hub/agent-trade-mcp/dist/index.js", "--profile", "default", "--toolset", "default", "--response-mode", "compact"]
    },
    {
      command: "codex",
      args: ["mcp", "add", "ai-hub-trade-mcp-default", "--", "/usr/local/bin/node", "/opt/ai-hub/agent-trade-mcp/dist/index.js", "--profile", "default", "--toolset", "default", "--response-mode", "compact"]
    },
    {
      command: "openclaw",
      args: ["mcp", "add", "ai-hub-trade-mcp-default", "--command", "/usr/local/bin/node", "--arg=/opt/ai-hub/agent-trade-mcp/dist/index.js", "--arg=--profile", "--arg=default", "--arg=--toolset", "--arg=default", "--arg=--response-mode", "--arg=compact"]
    }
  ]);
});
