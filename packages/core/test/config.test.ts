import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConfigStore, normalizeOpenApiBaseUrl } from "../src/index.js";

test("stores plaintext credentials in the selected TOML profile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ai-hub-config-"));
  const store = new ConfigStore(join(directory, "config.toml"));

  const profile = await store.setProfile("tenant-a", "https://8.8.8.8/openapi/");

  assert.equal(profile.name, "tenant-a");
  assert.equal(profile.openApiBaseUrl, "https://8.8.8.8/openapi");
  assert.equal(profile.configVersion.length, 64);

  await store.setCredentials("tenant-a", { apiKey: "test-api-key", secretKey: "test-secret-key" });
  const credentials = await store.getCredentials("tenant-a");
  const text = await readFile(join(directory, "config.toml"), "utf8");
  const file = await stat(join(directory, "config.toml"));

  assert.equal(credentials?.apiKey, "test-api-key");
  assert.equal(credentials?.secretKey, "test-secret-key");
  assert.match(text, /api_key = "test-api-key"/);
  assert.match(text, /secret_key = "test-secret-key"/);
  assert.equal(file.mode & 0o777, 0o600);

  const snapshot = await store.resolveProfileWithCredentials("tenant-a");
  assert.equal(snapshot.profile.name, "tenant-a");
  assert.equal(snapshot.credentials?.apiKey, "test-api-key");
  assert.equal(snapshot.credentials?.secretKey, "test-secret-key");
});

test("rejects a local OpenAPI endpoint", async () => {
  await assert.rejects(
    normalizeOpenApiBaseUrl("https://127.0.0.1/openapi"),
    { code: "AI_HUB_UNSAFE_OPENAPI_URL" }
  );
});
