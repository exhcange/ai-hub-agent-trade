import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore } from '../packages/core/dist/index.js';
import { install } from './install-local-products.mjs';

test('migration preserves existing profiles, other MCP settings and read-only access', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aihub-install-'));
  try {
    const file = join(home, '.ai-hub/config.toml'), store = new ConfigStore(file);
    await store.setProfile('smoke', 'https://8.8.8.8');
    await store.setProfile('default', 'https://1.1.1.1');
    await store.setCredentials('smoke', { apiKey: 'synthetic-key', secretKey: 'synthetic-secret' });
    await mkdir(join(home, '.codex'));
    const original = '# Keep this comment\n[mcp_servers.other]\ncommand = "example"\n\n[mcp_servers.aihub-smoke]\ncommand = "node"\nargs = ["mcp.js", "--profile", "smoke", "--read-only"]\n';
    await writeFile(join(home, '.codex/config.toml'), original);
    const before = await readFile(file, 'utf8');
    const dry = await install({ home, migrate: true });
    assert.equal(dry.applied, false);
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal(await readFile(join(home, '.codex/config.toml'), 'utf8'), original);
    const result = await install({ home, migrate: true, apply: true });
    assert.equal(result.applied, true);
    assert.equal((await store.showProfile('spot')).product, 'spot');
    assert.equal((await store.showProfile('futures')).product, 'futures');
    assert.equal((await store.getCredentials('spot')).apiKey, 'synthetic-key');
    assert.equal((await readdir(join(home, '.agents/skills'))).length, 12);
    const codex = await readFile(join(home, '.codex/config.toml'), 'utf8');
    assert.match(codex, /Keep this comment/); assert.match(codex, /mcp_servers.other/);
    assert.doesNotMatch(codex, /aihub-smoke/); assert.equal((codex.match(/--read-only/g) ?? []).length, 2);
    await assert.rejects(install({ home, migrate: true, apply: true }));
    assert.equal(await readFile(join(home, '.codex/config.toml'), 'utf8'), codex);
  } finally { await rm(home, { recursive: true, force: true }); }
});
test('fresh install creates both products without credentials and refuses invalid endpoints', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aihub-install-new-'));
  try {
    await assert.rejects(install({ home, apply: true, spotEndpoint: 'http://localhost', futuresEndpoint: 'https://1.1.1.1' }));
    const result = await install({ home, apply: true, spotEndpoint: 'https://8.8.8.8', futuresEndpoint: 'https://1.1.1.1' });
    assert.equal(result.skills, 12);
    const store = new ConfigStore(join(home, '.ai-hub/config.toml'));
    assert.equal((await store.showProfile('futures')).product, 'futures');
    assert.equal(await store.getCredentials('spot'), undefined);
    assert.equal(await store.getCredentials('futures'), undefined);
  } finally { await rm(home, { recursive: true, force: true }); }
});
