import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigStore, normalizeOpenApiBaseUrl } from "../src/index.js";

test("stores a profile without storing credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-hub-config-"));
  const store = new ConfigStore(join(directory, "config.toml"));

  const profile = await store.setProfile("tenant-a", "https://8.8.8.8/openapi/");

  assert.equal(profile.name, "tenant-a");
  assert.equal(profile.openApiBaseUrl, "https://8.8.8.8/openapi");
  assert.equal(profile.credentialRef, undefined);
  assert.equal(profile.configVersion.length, 64);
});

test("rejects a local OpenAPI endpoint", async () => {
  await assert.rejects(
    normalizeOpenApiBaseUrl("https://127.0.0.1/openapi"),
    { code: "AI_HUB_UNSAFE_OPENAPI_URL" }
  );
});
