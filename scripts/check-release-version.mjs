import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

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

const sharedReferenceNames = ["mcp-routing.md", "preflight.md", "openapi-error-diagnosis.md"];
async function assertSelfContainedSkills(directory) {
  const shared = Object.fromEntries(await Promise.all(sharedReferenceNames.map(async (name) => [name, await readFile(join(directory, "_shared", name), "utf8")])));
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("ai-hub-")) continue;
    const skillRoot = join(directory, entry.name);
    const skillPath = join(skillRoot, "SKILL.md");
    const content = await readFile(skillPath, "utf8");
    if (content.includes("../_shared/")) throw new Error(`${skillPath} contains a non-portable _shared runtime link.`);
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)) {
      const referenced = resolve(dirname(skillPath), match[1]);
      if (!referenced.startsWith(`${skillRoot}/`) || !existsSync(referenced)) {
        throw new Error(`${skillPath} references missing or external Markdown: ${match[1]}.`);
      }
    }
    for (const name of sharedReferenceNames) {
      const copied = await readFile(join(skillRoot, "references", name), "utf8");
      if (copied !== shared[name]) throw new Error(`${skillRoot}/references/${name} does not match _shared/${name}.`);
    }
    const safetyText = `${content}\n${Object.values(shared).join("\n")}`;
    if (!/Do not (?:expose|share|ask for|request)[^\n]*(?:API credentials|API key|secret key|credentials)/i.test(safetyText)) {
      throw new Error(`${skillPath} must explicitly prohibit credential disclosure or collection in chat.`);
    }
  }
}

await assertSelfContainedSkills(skillDirectory);

// A developer release can verify the sibling publish repository before either
// npm package is released. CI may not have that checkout, so its absence does
// not make a source-only verification fail.
const publishedSkills = process.env.AI_HUB_PUBLISHED_SKILLS_DIR ?? join(rootDirectory, "..", "ai-hub-agent-skills", "skills");
if (existsSync(publishedSkills)) {
  await assertSkillVersions(publishedSkills);
  await assertSelfContainedSkills(publishedSkills);
  for (const name of sharedReferenceNames) {
    const [source, published] = await Promise.all([readFile(join(skillDirectory, "_shared", name), "utf8"), readFile(join(publishedSkills, "_shared", name), "utf8")]);
    if (source !== published) throw new Error(`Published Skill ${name} does not match the source Skill pack.`);
  }
}
