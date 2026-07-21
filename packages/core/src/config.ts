import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isIP } from "node:net";
import { parse, stringify } from "smol-toml";
import { AiHubError } from "./errors.js";

export interface TenantProfile {
  openapi_base_url: string;
  credential_ref?: string;
}

export interface LocalConfig {
  version: 1;
  default_profile: string;
  profiles: Record<string, TenantProfile>;
}

export interface ResolvedProfile {
  name: string;
  openApiBaseUrl: string;
  credentialRef?: string;
  configVersion: string;
}

const CONFIG_DIRECTORY = ".ai-hub";
const CONFIG_FILENAME = "config.toml";
const PROFILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function configFilePath(home = homedir()): string {
  return join(home, CONFIG_DIRECTORY, CONFIG_FILENAME);
}

export function validateProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) {
    throw new AiHubError("AI_HUB_INVALID_PROFILE", "Profile names must be 1-64 letters, numbers, hyphens, or underscores.");
  }
  return name;
}

function blockedIp(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const first = octets[0] ?? -1;
    const second = octets[1] ?? -1;
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168);
  }

  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

/** Validate a SaaS endpoint before it is persisted in the local profile. */
export async function normalizeOpenApiBaseUrl(value: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AiHubError("AI_HUB_INVALID_OPENAPI_URL", "OpenAPI base URL must be a valid HTTPS URL.");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new AiHubError("AI_HUB_INVALID_OPENAPI_URL", "OpenAPI base URL must be an HTTPS URL without credentials, query, or fragment.");
  }
  if (url.hostname.toLowerCase() === "localhost") {
    throw new AiHubError("AI_HUB_UNSAFE_OPENAPI_URL", "Localhost is not allowed as an OpenAPI base URL.");
  }

  const records = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => blockedIp(record.address))) {
    throw new AiHubError("AI_HUB_UNSAFE_OPENAPI_URL", "OpenAPI base URL must resolve only to public addresses.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function defaultConfig(): LocalConfig {
  return { version: 1, default_profile: "default", profiles: {} };
}

function parseConfig(text: string): LocalConfig {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    throw new AiHubError("AI_HUB_CONFIG_PARSE_ERROR", `Cannot parse config.toml: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const raw = parsed as Partial<LocalConfig>;
  if (raw.version !== 1 || typeof raw.default_profile !== "string" || !raw.profiles || typeof raw.profiles !== "object") {
    throw new AiHubError("AI_HUB_CONFIG_INVALID", "config.toml must contain version = 1, default_profile, and profiles.");
  }
  return raw as LocalConfig;
}

function versionOf(config: LocalConfig, profileName: string): string {
  return createHash("sha256").update(JSON.stringify({ version: config.version, profileName, profile: config.profiles[profileName] })).digest("hex");
}

export class ConfigStore {
  public constructor(private readonly filePath = configFilePath()) {}

  public async read(): Promise<LocalConfig> {
    try {
      return parseConfig(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultConfig();
      throw error;
    }
  }

  public async initialize(): Promise<{ created: boolean; path: string }> {
    const config = await this.read();
    const existing = Object.keys(config.profiles).length > 0;
    if (!existing) await this.write(config);
    return { created: !existing, path: this.filePath };
  }

  public async setProfile(name: string, openApiBaseUrl: string): Promise<ResolvedProfile> {
    validateProfileName(name);
    const config = await this.read();
    const normalizedUrl = await normalizeOpenApiBaseUrl(openApiBaseUrl);
    const existing = config.profiles[name];
    config.profiles[name] = { openapi_base_url: normalizedUrl, ...(existing?.credential_ref ? { credential_ref: existing.credential_ref } : {}) };
    if (Object.keys(config.profiles).length === 1) config.default_profile = name;
    await this.write(config);
    return this.resolveFrom(config, name);
  }

  public async showProfile(requestedName?: string): Promise<ResolvedProfile> {
    const config = await this.read();
    return this.resolveFrom(config, requestedName ?? config.default_profile);
  }

  public async removeProfile(name: string): Promise<void> {
    validateProfileName(name);
    const config = await this.read();
    if (!config.profiles[name]) throw new AiHubError("AI_HUB_PROFILE_NOT_FOUND", `Profile "${name}" does not exist.`);
    delete config.profiles[name];
    if (config.default_profile === name) config.default_profile = Object.keys(config.profiles)[0] ?? "default";
    await this.write(config);
  }

  public async setCredentialRef(name: string, credentialRef: string): Promise<ResolvedProfile> {
    validateProfileName(name);
    const config = await this.read();
    const profile = config.profiles[name];
    if (!profile) throw new AiHubError("AI_HUB_PROFILE_NOT_FOUND", `Profile "${name}" does not exist.`);
    config.profiles[name] = { ...profile, credential_ref: credentialRef };
    await this.write(config);
    return this.resolveFrom(config, name);
  }

  private resolveFrom(config: LocalConfig, name: string): ResolvedProfile {
    validateProfileName(name);
    const profile = config.profiles[name];
    if (!profile) throw new AiHubError("AI_HUB_PROFILE_NOT_FOUND", `Profile "${name}" does not exist.`);
    return {
      name,
      openApiBaseUrl: profile.openapi_base_url,
      credentialRef: profile.credential_ref,
      configVersion: versionOf(config, name)
    };
  }

  private async write(config: LocalConfig): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, stringify(config), { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }
}
