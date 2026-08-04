import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createToolRegistry } from "../src/index.js";

const skillDirectory = fileURLToPath(new URL("../../../skills/ai-hub-spot-order/", import.meta.url));

test("spot-order Skill documents the Core CLI command and unit agreement", async () => {
  const [skill, reference, cliPackage] = await Promise.all([
    readFile(new URL("SKILL.md", `file://${skillDirectory}`).pathname, "utf8"),
    readFile(new URL("references/order-commands.md", `file://${skillDirectory}`).pathname, "utf8"),
    readFile(new URL("../../cli/package.json", import.meta.url), "utf8")
  ]);
  const registry = createToolRegistry();

  for (const path of [
    ["spot", "order", "market-buy"],
    ["spot", "order", "market-sell"],
    ["spot", "order", "limit"],
    ["spot", "order", "stop-limit"],
    ["spot", "order", "stop-market-buy"],
    ["spot", "order", "stop-market-sell"],
    ["spot", "order", "batch-place"]
  ]) {
    assert.ok(registry.byCliPath(path), `Core must expose ${path.join(" ")}`);
  }

  assert.match(skill, /spot order market-buy/);
  assert.match(skill, /spot order market-sell/);
  assert.match(skill, /spot order limit/);
  assert.match(skill, /spot order stop-limit/);
  assert.match(skill, /spot order stop-market-buy/);
  assert.match(skill, /spot order stop-market-sell/);
  assert.doesNotMatch(skill, /spot order place/);
  assert.match(reference, /--quote-amount/);
  assert.match(reference, /--base-quantity/);
  assert.match(reference, /--trigger-price/);
  assert.match(reference, /POST_ONLY/);
  assert.doesNotMatch(reference, /spot order place/);
  assert.doesNotMatch(reference, /--volume/);
  assert.match(skill, new RegExp(`version: "${JSON.parse(cliPackage).version}"`));
});
