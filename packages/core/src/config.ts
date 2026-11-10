import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isIP } from "node:net";
import { parse, stringify } from "smol-toml";
import { loadStoredCredentials, validateApiCredentials, type ApiCredentials, type LoadedCredentials } from "./credential.js";
import { AiHubError } from "./errors.js";

export type Product = "spot" | "futures";

export function validateProduct(value: unknown): Product {
  if (value === undefined) return "spot";
  if (value === "spot" || value === "futures") return value;
  throw new AiHubError("AI_HUB_INVALID_PRODUCT", "Product must be spot or futures.");
}

export interface TenantProfile {
  product?: Product;
  products?: Product[];
  futures_base_url?: string;
  state_profile_names?: Record<Product, string>;
  pairing?: { version: string; evidenceId: string };
  openapi_base_url: string;
  api_key?: string;
  secret_key?: string;
}

export interface LocalConfig {
  version: 1 | 2;
  default_profile: string;
  profiles: Record<string, TenantProfile>;
  account_pairing?: { spotVersion: string; futuresVersion: string; evidenceId: string };
}

export interface ResolvedProfile {
  accountPairing?: { source: "operator-verified"; evidenceId: string };
  product?: Product;
  name: string;
  products?: Product[];
  stateProfileName?: string;
  openApiBaseUrl: string;
  configVersion: string;
}

/** One immutable configuration snapshot for one CLI command or MCP call. */
export interface ResolvedProfileWithCredentials {
  profile: ResolvedProfile;
  credentials?: LoadedCredentials;
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

export function deriveFuturesBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new AiHubError("AI_HUB_INVALID_OPENAPI_URL", "A valid spot OpenAPI URL is required."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port || !url.hostname.startsWith("openapi.") || url.hostname.slice(8).split(".").length < 2 || !["", "/"].includes(url.pathname)) {
    throw new AiHubError("AI_HUB_INVALID_OPENAPI_URL", "Automatic derivation requires https://openapi.<merchant-domain> without a path or port; provide an explicit Futures URL otherwise.");
  }
  url.hostname = `futuresopenapi.${url.hostname.slice(8)}`;
  return url.origin;
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
  if ((raw.version !== 1 && raw.version !== 2) || typeof raw.default_profile !== "string" || !raw.profiles || typeof raw.profiles !== "object") {
    throw new AiHubError("AI_HUB_CONFIG_INVALID", "config.toml must contain supported version = 1 or 2, default_profile, and profiles.");
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

  public async setProfile(name: string, openApiBaseUrl: string, product?: Product): Promise<ResolvedProfile> {
    validateProfileName(name);
    const config = await this.read();
    const normalizedUrl = await normalizeOpenApiBaseUrl(openApiBaseUrl);
    const existing = config.profiles[name];
    if (existing?.products) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "Update unified profiles with --products spot,futures.");
    const keepCredentials = existing?.openapi_base_url === normalizedUrl;
    config.profiles[name] = {
      product: validateProduct(product ?? existing?.product),
      openapi_base_url: normalizedUrl,
      ...(keepCredentials && existing?.api_key ? { api_key: existing.api_key } : {}),
      ...(keepCredentials && existing?.secret_key ? { secret_key: existing.secret_key } : {})
    };
    if (Object.keys(config.profiles).length === 1) config.default_profile = name;
    await this.write(config);
    return this.resolveFrom(config, name);
  }

  public async setUnifiedProfile(name: string, spotUrl: string, futuresUrl?: string): Promise<ResolvedProfile> {
    validateProfileName(name);
    const spot = await normalizeOpenApiBaseUrl(spotUrl);
    const futures = await normalizeOpenApiBaseUrl(futuresUrl ?? deriveFuturesBaseUrl(spot));
    if (new URL(spot).origin === new URL(futures).origin) throw new AiHubError("AI_HUB_INVALID_OPENAPI_URL", "Spot and Futures endpoints must have distinct origins.");
    const config = await this.read();
    const previous = config.profiles[name];
    const unchanged = previous?.products?.join(",") === "spot,futures" && previous.openapi_base_url === spot && previous.futures_base_url === futures;
    config.version = 2;
    config.profiles[name] = { product: "spot", products: ["spot", "futures"], openapi_base_url: spot, futures_base_url: futures,
      ...(previous?.state_profile_names ? { state_profile_names: previous.state_profile_names } : {}),
      ...(unchanged ? { api_key: previous.api_key, secret_key: previous.secret_key, pairing: previous.pairing } : {}) };
    if (Object.keys(config.profiles).length === 1) config.default_profile = name;
    await this.write(config);
    return this.resolveFrom(config, name);
  }

  /** Merge only an explicitly selected matching credential pair; preserve legacy durable-state identities. */
  public async unifyProfiles(name: string, sources: { spot: string; futures: string }, apply = false): Promise<{ applied: boolean; profile: string; products: Product[] }> {
    validateProfileName(name);
    if (sources.spot === sources.futures || name === sources.spot || name === sources.futures) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "Use a new target name and two distinct source profiles.");
    const config = await this.read();
    if (config.profiles[name]) throw new AiHubError("AI_HUB_PROFILE_EXISTS", "The target profile already exists.");
    const spot = this.profileFrom(config, sources.spot), futures = this.profileFrom(config, sources.futures);
    if (spot.products || futures.products || validateProduct(spot.product) !== "spot" || validateProduct(futures.product) !== "futures") throw new AiHubError("AI_HUB_PRODUCT_MISMATCH", "Select one legacy spot profile and one legacy Futures profile.");
    const left = loadStoredCredentials(spot.api_key, spot.secret_key), right = loadStoredCredentials(futures.api_key, futures.secret_key);
    if (!left || !right || left.credentialVersion !== right.credentialVersion) throw new AiHubError("AI_HUB_CREDENTIAL_MISMATCH", "Both source profiles must have identical configured credentials.");
    if (deriveFuturesBaseUrl(spot.openapi_base_url) !== futures.openapi_base_url) throw new AiHubError("AI_HUB_INVALID_OPENAPI_URL", "Source endpoints do not match the automatic derivation rule; configure a separate unified profile explicitly instead.");
    if (apply) {
      config.version = 2;
      config.profiles[name] = { product: "spot", products: ["spot", "futures"], openapi_base_url: spot.openapi_base_url,
        futures_base_url: futures.openapi_base_url, api_key: spot.api_key, secret_key: spot.secret_key,
        state_profile_names: { spot: sources.spot, futures: sources.futures } };
      delete config.profiles[sources.spot]; delete config.profiles[sources.futures];
      if ([sources.spot, sources.futures].includes(config.default_profile)) config.default_profile = name;
      delete config.account_pairing;
      await this.write(config);
    }
    return { applied: apply, profile: name, products: ["spot", "futures"] };
  }

  public async showProfile(requestedName?: string, product?: Product): Promise<ResolvedProfile> {
    const config = await this.read();
    return this.resolveFrom(config, requestedName ?? config.default_profile, product);
  }

  public async getCredentials(requestedName?: string): Promise<LoadedCredentials | undefined> {
    const config = await this.read();
    const name = requestedName ?? config.default_profile;
    const profile = this.profileFrom(config, name);
    return loadStoredCredentials(profile.api_key, profile.secret_key);
  }

  /**
   * Resolve the selected profile and credentials from exactly one config read.
   * This does not cache across requests, so an on-disk profile change is still
   * visible to the very next CLI command or MCP Tool call.
   */
  public async resolveProfileWithCredentials(requestedName?: string, product?: Product): Promise<ResolvedProfileWithCredentials> {
    const config = await this.read();
    const name = requestedName ?? config.default_profile;
    const rawProfile = this.profileFrom(config, name);
    return {
      profile: this.resolveFrom(config, name, product),
      credentials: loadStoredCredentials(rawProfile.api_key, rawProfile.secret_key)
    };
  }

  /** Records an operator-verified pairing; any profile/credential change invalidates it. */
  public async pairProducts(evidenceId: string, requestedName?: string): Promise<{ paired: true; source: "operator-verified" }> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(evidenceId)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "Provide a non-secret pairing evidence ID.");
    const config = await this.read();
    if (requestedName) {
      const profile = this.profileFrom(config, requestedName);
      if (!profile.products) throw new AiHubError("AI_HUB_PRODUCT_MISMATCH", "Select a unified profile for profile-scoped pairing.");
      const { pairing: _, ...binding } = profile;
      profile.pairing = { version: createHash("sha256").update(JSON.stringify(binding)).digest("hex"), evidenceId };
      await this.write(config);
      return { paired: true, source: "operator-verified" };
    }
    const spot = this.profileFrom(config, "spot");
    const futures = this.profileFrom(config, "futures");
    if (spot.products || futures.products || validateProduct(spot.product) !== "spot" || validateProduct(futures.product) !== "futures") {
      throw new AiHubError("AI_HUB_PRODUCT_MISMATCH", "Legacy pairing requires separate spot and futures profiles. Use --profile to pair a unified profile.");
    }
    config.account_pairing = { spotVersion: versionOf(config, "spot"), futuresVersion: versionOf(config, "futures"), evidenceId };
    await this.write(config);
    return { paired: true, source: "operator-verified" };
  }

  /** Explicit offline migration. Dry-run reports names/products only, never credentials. */
  public async migrateProducts(sources: { spot: string; futures: string }, apply = false): Promise<{ applied: boolean; mappings: { from: string; to: Product; product: Product }[] }> {
    const config = await this.read();
    const mappings = (["spot", "futures"] as const).map((product) => ({ from: validateProfileName(sources[product]), to: product, product }));
    if (sources.spot === sources.futures) throw new AiHubError("AI_HUB_INVALID_PROFILE", "Two distinct source profiles are required.");
    for (const item of mappings) {
      this.profileFrom(config, item.from);
      if (item.from !== item.to && config.profiles[item.to]) throw new AiHubError("AI_HUB_PROFILE_EXISTS", "Migration target already exists; no profiles were changed.");
    }
    if (apply) {
      const copies = mappings.map((item) => ({ ...config.profiles[item.from]!, product: item.product }));
      for (const item of mappings) delete config.profiles[item.from];
      mappings.forEach((item, index) => { config.profiles[item.to] = copies[index]!; });
      config.default_profile = mappings.find((item) => item.from === config.default_profile)?.to ?? config.default_profile;
      await this.write(config);
    }
    return { applied: apply, mappings };
  }

  public async removeProfile(name: string): Promise<void> {
    validateProfileName(name);
    const config = await this.read();
    if (!config.profiles[name]) throw new AiHubError("AI_HUB_PROFILE_NOT_FOUND", `Profile "${name}" does not exist.`);
    delete config.profiles[name];
    if (config.default_profile === name) config.default_profile = Object.keys(config.profiles)[0] ?? "default";
    await this.write(config);
  }

  public async setCredentials(name: string, credentials: ApiCredentials): Promise<ResolvedProfile> {
    validateProfileName(name);
    const config = await this.read();
    const profile = config.profiles[name];
    if (!profile) throw new AiHubError("AI_HUB_PROFILE_NOT_FOUND", `Profile "${name}" does not exist.`);
    const value = validateApiCredentials(credentials);
    config.profiles[name] = { ...profile, api_key: value.apiKey, secret_key: value.secretKey };
    await this.write(config);
    return this.resolveFrom(config, name);
  }

  private resolveFrom(config: LocalConfig, name: string, requestedProduct?: Product): ResolvedProfile {
    validateProfileName(name);
    const profile = this.profileFrom(config, name);
    const product = requestedProduct ?? validateProduct(profile.product);
    if (requestedProduct && !profile.products && product !== validateProduct(profile.product)) throw new AiHubError("AI_HUB_PRODUCT_MISMATCH", "The selected profile does not support this product.");
    const { pairing: _, ...binding } = profile;
    const paired = profile.pairing?.version === createHash("sha256").update(JSON.stringify(binding)).digest("hex");
    const legacyPairing = config.account_pairing;
    const legacyPairValid = legacyPairing && ["spot", "futures"].includes(name)
      && !config.profiles.spot?.products && !config.profiles.futures?.products
      && legacyPairing.spotVersion === versionOf(config, "spot") && legacyPairing.futuresVersion === versionOf(config, "futures");
    return {
      name,
      product,
      ...(profile.products ? { products: [...profile.products], ...(profile.state_profile_names ? { stateProfileName: profile.state_profile_names[product] } : {}) } : {}),
      ...(paired && profile.pairing ? { accountPairing: { source: "operator-verified" as const, evidenceId: profile.pairing.evidenceId } } : {}),
      ...(legacyPairValid ? { accountPairing: { source: "operator-verified" as const, evidenceId: legacyPairing.evidenceId } } : {}),
      openApiBaseUrl: profile.products && product === "futures" ? profile.futures_base_url! : profile.openapi_base_url,
      configVersion: createHash("sha256").update(versionOf(config, name)).update(JSON.stringify(config.account_pairing ?? null)).digest("hex")
    };
  }

  private profileFrom(config: LocalConfig, name: string): TenantProfile {
    validateProfileName(name);
    const profile = config.profiles[name];
    if (!profile) throw new AiHubError("AI_HUB_PROFILE_NOT_FOUND", `Profile "${name}" does not exist.`);
    validateProduct(profile.product);
    if (profile.products && config.version !== 2) throw new AiHubError("AI_HUB_CONFIG_INVALID", "Unified profiles require configuration version 2.");
    if (profile.products && (!Array.isArray(profile.products) || profile.products.join(",") !== "spot,futures" || !profile.futures_base_url || profile.product !== "spot")) throw new AiHubError("AI_HUB_CONFIG_INVALID", "Unified profiles require spot,futures and both endpoints.");
    if (profile.state_profile_names) {
      if (!profile.products) throw new AiHubError("AI_HUB_CONFIG_INVALID", "Legacy state identities require a unified profile.");
      for (const product of ["spot", "futures"] as const) validateProfileName(profile.state_profile_names[product]);
    }
    try {
      for (const endpoint of [profile.openapi_base_url, ...(profile.products ? [profile.futures_base_url!] : [])]) {
        const url = new URL(endpoint);
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.hostname === "localhost" || (isIP(url.hostname) && blockedIp(url.hostname))) throw new Error("unsafe URL");
      }
    } catch { throw new AiHubError("AI_HUB_INVALID_OPENAPI_URL", "Profile must contain a valid public HTTPS endpoint."); }
    return profile;
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
