import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const excluded = new Set([".git", "node_modules", "dist", "coverage"]);
const textExtensions = new Set([".md", ".ts", ".mts", ".cts", ".json", ".yaml", ".yml", ".toml", ".mjs"]);
const denied = /chainup|coobit|\bcws\b|\bfutures\b|\bcontract\b/i;
const violations = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (textExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
      const body = await readFile(fullPath, "utf8");
      if (denied.test(body)) violations.push(relative(root, fullPath));
    }
  }
}

for (const directory of [join(root, "packages"), join(root, "skills")]) {
  await walk(directory);
}
if (violations.length > 0) {
  process.stderr.write(`Denied terms found in:\n${violations.map((file) => `- ${file}`).join("\n")}\n`);
  process.exitCode = 1;
}
