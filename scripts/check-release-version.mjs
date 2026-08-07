import { existsSync } from "node:fs";
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
async function assertSkillVersions(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith("ai-hub-")) continue;
  const path = join(directory, entry.name, "SKILL.md");
  const content = await readFile(path, "utf8");
  if (!content.includes(`version: "${version}"`)) throw new Error(`${path} does not match release version ${version}.`);
  }
}

await assertSkillVersions(skillDirectory);

// A developer release can verify the sibling publish repository before either
// npm package is released. CI may not have that checkout, so its absence does
// not make a source-only verification fail.
const publishedSkills = process.env.AI_HUB_PUBLISHED_SKILLS_DIR ?? join(rootDirectory, "..", "ai-hub-agent-skills", "skills");
if (existsSync(publishedSkills)) {
  await assertSkillVersions(publishedSkills);
  const [sourceRouting, publishedRouting] = await Promise.all([
    readFile(join(skillDirectory, "_shared", "mcp-routing.md"), "utf8"),
    readFile(join(publishedSkills, "_shared", "mcp-routing.md"), "utf8")
  ]);
  if (sourceRouting !== publishedRouting) throw new Error("Published Skill MCP routing does not match the source Skill pack.");
}
