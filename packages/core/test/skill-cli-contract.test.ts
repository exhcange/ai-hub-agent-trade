import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { createToolRegistry } from "../src/index.js";

const sourceSkills = fileURLToPath(new URL("../../../skills/", import.meta.url));
const publishedSkills = fileURLToPath(new URL("../../../../ai-hub-agent-skills/skills/", import.meta.url));
const skillDirectories = [sourceSkills, ...(existsSync(publishedSkills) ? [publishedSkills] : [])];

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

function commandPaths(markdown: string): string[][] {
  const matches = markdown.matchAll(/`(ai-hub(?:\s+[A-Za-z0-9_-]+)+(?:\s+[^`]*)?)`/g);
  const paths: string[][] = [];
  for (const match of matches) {
    const tokens = (match[1] ?? "").trim().split(/\s+/).slice(1);
    const optionIndex = tokens.findIndex((token) => token.startsWith("--"));
    const path = (optionIndex < 0 ? tokens : tokens.slice(0, optionIndex));
    if (!path.length || path.some((token) => token.includes("...") || token.includes("<") || token.includes(">"))) continue;
    if (path[0] === "config" || path[0] === "confirm") continue;
    paths.push(path);
  }
  return paths;
}

test("every concrete Skill CLI command maps to the shared Tool Registry", async () => {
  const registry = createToolRegistry();
  for (const directory of skillDirectories) {
    for (const file of await markdownFiles(directory)) {
      const markdown = await readFile(file, "utf8");
      for (const path of commandPaths(markdown)) {
        assert.ok(registry.byCliPath(path), `${file} references unknown CLI command: ai-hub ${path.join(" ")}`);
      }
    }
  }
});

test("account Skill maps generic and one-asset balance intents to distinct CLI paths", () => {
  const registry = createToolRegistry();
  assert.equal(registry.byCliPath(["account", "balances"]).name, "account_list_balances");
  assert.equal(registry.byCliPath(["account", "asset-balance"]).name, "account_get_asset_balance");
});
