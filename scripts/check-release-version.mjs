import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const releaseSource = await readFile(join(rootDirectory, "packages/core/src/release.ts"), "utf8");
const match = releaseSource.match(/AI_HUB_RELEASE_VERSION\s*=\s*"([^"]+)"/);
if (!match) throw new Error("AI_HUB_RELEASE_VERSION was not found.");
const version = match[1];
const manifests = ["../package.json", "../packages/core/package.json", "../packages/cli/package.json", "../packages/mcp/package.json"];
for (const relativePath of manifests) {
  const manifest = JSON.parse(await readFile(join(rootDirectory, relativePath.slice(3)), "utf8"));
  if (manifest.version !== version) throw new Error(`${relativePath} version ${manifest.version} does not match ${version}.`);
}
const skillDirectory = join(rootDirectory, "skills");
for (const entry of await readdir(skillDirectory, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith("ai-hub-")) continue;
  const path = join(skillDirectory, entry.name, "SKILL.md");
  const content = await readFile(path, "utf8");
  if (!content.includes(`version: "${version}"`)) throw new Error(`${path} does not match release version ${version}.`);
}
