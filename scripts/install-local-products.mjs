#!/usr/bin/env node
/** Offline Codex installation from this built checkout. Dry-run unless --apply. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { readFile, writeFile, mkdir, cp, copyFile, rename, rm, stat, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ConfigStore, normalizeOpenApiBaseUrl } from '../packages/core/dist/index.js';
const require = createRequire(new URL('../packages/mcp/package.json', import.meta.url));
const { parse, stringify } = require('smol-toml');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exists = async (p) => !!await stat(p).catch(() => undefined);
const shellQuote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
async function atomic(p, content, mode = 0o600) {
  await mkdir(dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, { mode });
  await rename(tmp, p);
}
export async function install({ home = homedir(), apply = false, migrate = false, spotEndpoint, futuresEndpoint } = {}) {
  const profileFile = join(home, '.ai-hub/config.toml');
  const codexFile = join(home, '.codex/config.toml');
  const store = new ConfigStore(profileFile);
  const config = await store.read();
  const originalCodex = await exists(codexFile) ? await readFile(codexFile, 'utf8') : '';
  const codex = parse(originalCodex);
  const servers = codex.mcp_servers ?? {};
  const names = ['aihub-spot', 'aihub-futures'];
  for (const name of names) if (servers[name]) throw new Error('Target MCP registration exists; review it instead of overwriting.');
  if (servers['aihub-smoke']) {
    const args = servers['aihub-smoke'].args;
    if (!migrate || !Array.isArray(args) || args[args.indexOf('--profile') + 1] !== 'smoke' || !args.includes('--read-only')) throw new Error('Legacy MCP registration does not match the expected read-only smoke configuration.');
  }
  let mappings;
  if (migrate) mappings = (await store.migrateProducts({ spot: 'smoke', futures: 'default' })).mappings;
  else {
    if (!spotEndpoint || !futuresEndpoint) throw new Error('Fresh install requires both endpoint options.');
    await normalizeOpenApiBaseUrl(spotEndpoint); await normalizeOpenApiBaseUrl(futuresEndpoint);
    if (config.profiles.spot || config.profiles.futures) throw new Error('Target profiles already exist; no profiles were changed.');
    mappings = [{ to: 'spot', product: 'spot' }, { to: 'futures', product: 'futures' }];
  }
  const skills = (await readdir(join(root, 'skills'))).filter((name) => /^ai-hub-(spot|futures)(-|$)/.test(name)).sort();
  if (skills.length !== 12) throw new Error('Expected the complete set of twelve Skills.');
  const targets = [];
  for (const name of skills) {
    const src = join(root, 'skills', name), dest = join(home, '.agents/skills', name);
    if (!await exists(join(src, 'SKILL.md'))) throw new Error('Skill source is incomplete.');
    if (await exists(dest)) throw new Error('A target Skill already exists; review it instead of overwriting.');
    targets.push({ src, dest, directory: true });
  }
  for (const [name, relative] of [['ai-hub', 'packages/cli/dist/index.js'], ['aihub', 'packages/cli/dist/fast.js'], ['ai-hub-trade-mcp', 'packages/mcp/dist/index.js']]) {
    const entry = join(root, relative), dest = join(home, '.local/bin', name);
    if (!await exists(entry)) throw new Error('Run pnpm build before installing.');
    if (await exists(dest)) throw new Error('A target command already exists; review it instead of overwriting.');
    targets.push({ dest, content: `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(entry)} "$@"\n` });
  }
  const plan = { applied: false, mappings, registrations: names.map((name, i) => ({ name, profile: i ? 'futures' : 'spot', readOnly: true })), removeLegacyRegistration: !!servers['aihub-smoke'], skills: skills.length, commandDirectory: join(home, '.local/bin') };
  if (!apply) return plan;
  const backup = join(home, '.ai-hub/install-backups', randomUUID());
  await mkdir(backup, { recursive: true, mode: 0o700 });
  const hadProfile = await exists(profileFile), hadCodex = await exists(codexFile);
  // Backups remain private local configuration files, never printed or exported.
  if (hadProfile) { await atomic(join(backup, 'profiles.toml'), await readFile(profileFile)); }
  if (hadCodex) { await atomic(join(backup, 'codex.toml'), originalCodex); }
  const created = [];
  try {
    if (migrate) await store.migrateProducts({ spot: 'smoke', futures: 'default' }, true);
    else { await store.setProfile('spot', spotEndpoint, 'spot'); await store.setProfile('futures', futuresEndpoint, 'futures'); }
    for (const target of targets) {
      // Record before copying so partial copies are also removed during rollback.
      created.push(target.dest);
      if (target.directory) { await mkdir(dirname(target.dest), { recursive: true }); await cp(target.src, target.dest, { recursive: true, errorOnExist: true, force: false }); }
      else await atomic(target.dest, target.content, 0o700);
    }
    // Preserve unrelated TOML sections and comments; only replace the old server block.
    let section = '', retained = [];
    for (const line of originalCodex.split('\n')) {
      const match = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
      if (match) section = match[1];
      if (!/^mcp_servers\.(?:aihub-smoke|"aihub-smoke")(?:\.|$)/.test(section)) retained.push(line);
    }
    const newServers = Object.fromEntries(names.map((name, i) => [name, { command: process.execPath, args: [join(root, 'packages/mcp/dist/index.js'), '--profile', i ? 'futures' : 'spot', '--toolset', 'default', '--response-mode', 'compact', '--read-only'] }]));
    const updated = `${retained.join('\n').trimEnd()}\n\n${stringify({ mcp_servers: newServers })}`;
    const verified = parse(updated);
    if (verified.mcp_servers?.['aihub-smoke']) throw new Error('Legacy registration removal could not be verified.');
    await atomic(codexFile, updated);
    const after = await store.read();
    if (migrate) for (const [old, next] of [['smoke', 'spot'], ['default', 'futures']]) {
      const { product: _a, ...beforeFields } = config.profiles[old];
      const { product: _b, ...afterFields } = after.profiles[next];
      if (JSON.stringify(beforeFields) !== JSON.stringify(afterFields)) throw new Error('Profile preservation verification failed.');
    }
    return { ...plan, applied: true, backupDirectory: backup, verification: 'Endpoints and stored profile fields preserved; no exchange requests made.' };
  } catch {
    for (const dest of created.reverse()) await rm(dest, { recursive: true, force: true });
    if (hadProfile) await copyFile(join(backup, 'profiles.toml'), profileFile); else await rm(profileFile, { force: true });
    if (hadCodex) await copyFile(join(backup, 'codex.toml'), codexFile); else await rm(codexFile, { force: true });
    throw new Error('Installation failed and local changes were rolled back. Private backups remain in the installation backup directory.');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const known = new Set(['--apply', '--migrate-legacy', '--spot-endpoint', '--futures-endpoint']);
  try {
    for (let i = 0; i < args.length; i++) { if (!known.has(args[i])) throw new Error('Unknown installer option.'); if (args[i].endsWith('-endpoint')) { if (!args[++i] || args[i].startsWith('--')) throw new Error('Endpoint option needs a value.'); } }
    console.log(JSON.stringify(await install({ apply: args.includes('--apply'), migrate: args.includes('--migrate-legacy'), spotEndpoint: value('--spot-endpoint'), futuresEndpoint: value('--futures-endpoint') }), null, 2));
  } catch { console.error('Installation stopped. Check build outputs and target collisions; no credentials are printed. Use a dry run before applying.'); process.exitCode = 1; }
}
