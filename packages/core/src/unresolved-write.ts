import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { AiHubError } from "./errors.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const OMITTED_HASH_FIELDS = new Set([
  "newClientOrderId", "client_order_id", "confirmationId", "expiresAt", "quotedAt",
  "tickerTimestamp", "referencePrice", "marketPriceReference", "requestId", "recvWindow",
  "requestedSymbol", "displaySymbol", "baseAsset", "quoteAsset", "displayBaseAsset", "displayQuoteAsset",
  "availableBaseQuantity", "executableBaseQuantity", "remainderBaseQuantity"
]);

export interface UnresolvedWriteRecord {
  id: string;
  profile: string;
  tool: string;
  businessRequestHash: string;
  createdAt: string;
  status: "unresolved";
  symbol?: string;
  newClientOrderId?: string;
}

export interface UnresolvedWriteStore {
  assertNoUnresolved(profile: string, tool: string, payload: Record<string, unknown>): Promise<void>;
  recordUnknown(profile: string, tool: string, payload: Record<string, unknown>): Promise<UnresolvedWriteRecord>;
  resolve(profile: string, symbol: string, newClientOrderId: string): Promise<void>;
}

/** Process-local fallback for explicitly constructed test or embedded contexts. */
export class MemoryUnresolvedWriteStore implements UnresolvedWriteStore {
  private records: UnresolvedWriteRecord[] = [];

  public async assertNoUnresolved(profile: string, tool: string, payload: Record<string, unknown>): Promise<void> {
    const hash = unresolvedBusinessRequestHash(profile, tool, payload);
    const existing = this.records.find((record) => record.profile === profile && record.businessRequestHash === hash);
    if (existing) throw new AiHubError("AI_HUB_UNRESOLVED_WRITE_EXISTS", "A matching write has an unresolved outcome. Query the original operation before creating another preview.", { writeOutcomeUnknown: true });
  }

  public async recordUnknown(profile: string, tool: string, payload: Record<string, unknown>): Promise<UnresolvedWriteRecord> {
    const businessRequestHash = unresolvedBusinessRequestHash(profile, tool, payload);
    const existing = this.records.find((record) => record.profile === profile && record.businessRequestHash === businessRequestHash);
    if (existing) return existing;
    const record: UnresolvedWriteRecord = {
      id: randomUUID(), profile, tool, businessRequestHash, createdAt: new Date().toISOString(), status: "unresolved",
      ...(typeof payload.symbol === "string" ? { symbol: payload.symbol } : {}),
      ...(typeof payload.newClientOrderId === "string" ? { newClientOrderId: payload.newClientOrderId } : {})
    };
    this.records.push(record);
    return record;
  }

  public async resolve(profile: string, symbol: string, newClientOrderId: string): Promise<void> {
    this.records = this.records.filter((record) => !(record.profile === profile && record.symbol === symbol && record.newClientOrderId === newClientOrderId));
  }
}

function normalizedBusinessValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedBusinessValue);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(object)
    .filter(([key]) => !OMITTED_HASH_FIELDS.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, normalizedBusinessValue(item)]));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function logicalToolName(tool: string): string {
  return tool.startsWith("spot_") && ["market_buy", "market_sell", "sell_available", "limit_order", "stop_limit_order", "stop_market_buy", "stop_market_sell"].includes(tool.slice(5))
    ? "spot_place_order"
    : tool;
}

export function unresolvedBusinessRequestHash(profile: string, tool: string, payload: Record<string, unknown>): string {
  return createHash("sha256").update(stableJson({ profile, tool: logicalToolName(tool), payload: normalizedBusinessValue(payload) })).digest("hex");
}

export function unresolvedWriteDirectory(options: { home?: string; os?: NodeJS.Platform; environment?: NodeJS.ProcessEnv } = {}): string {
  const environment = options.environment ?? process.env;
  if (environment.AI_HUB_STATE_DIR) return environment.AI_HUB_STATE_DIR;
  const home = options.home ?? homedir();
  switch (options.os ?? platform()) {
    case "darwin": return join(home, "Library", "Application Support", "AIHub", "state");
    case "win32": return join(environment.LOCALAPPDATA || join(home, "AppData", "Local"), "AIHub", "state");
    default: return join(environment.XDG_STATE_HOME || join(home, ".local", "state"), "ai-hub");
  }
}

export class FileUnresolvedWriteStore implements UnresolvedWriteStore {
  private readonly file: string;

  public constructor(
    private readonly directory = unresolvedWriteDirectory(),
    private readonly now = () => new Date(),
    private readonly os: NodeJS.Platform = platform()
  ) {
    this.file = join(directory, "unresolved-writes.json");
  }

  public async assertNoUnresolved(profile: string, tool: string, payload: Record<string, unknown>): Promise<void> {
    const hash = unresolvedBusinessRequestHash(profile, tool, payload);
    const existing = (await this.readActive()).find((record) => record.profile === profile && record.businessRequestHash === hash);
    if (existing) {
      throw new AiHubError(
        "AI_HUB_UNRESOLVED_WRITE_EXISTS",
        "A matching write has an unresolved outcome. Query the original operation before creating another preview.",
        { writeOutcomeUnknown: true, ...(existing.symbol ? { symbol: existing.symbol } : {}), ...(existing.newClientOrderId ? { newClientOrderId: existing.newClientOrderId } : {}), unresolvedSince: existing.createdAt }
      );
    }
  }

  public async recordUnknown(profile: string, tool: string, payload: Record<string, unknown>): Promise<UnresolvedWriteRecord> {
    const records = await this.readActive();
    const businessRequestHash = unresolvedBusinessRequestHash(profile, tool, payload);
    const existing = records.find((record) => record.profile === profile && record.businessRequestHash === businessRequestHash);
    if (existing) return existing;
    const record: UnresolvedWriteRecord = {
      id: randomUUID(), profile, tool, businessRequestHash, createdAt: this.now().toISOString(), status: "unresolved",
      ...(typeof payload.symbol === "string" ? { symbol: payload.symbol } : {}),
      ...(typeof payload.newClientOrderId === "string" ? { newClientOrderId: payload.newClientOrderId } : {})
    };
    await this.write([...records, record]);
    return record;
  }

  public async resolve(profile: string, symbol: string, newClientOrderId: string): Promise<void> {
    const records = await this.readActive();
    const remaining = records.filter((record) => !(record.profile === profile && record.symbol === symbol && record.newClientOrderId === newClientOrderId));
    if (remaining.length !== records.length) await this.write(remaining);
  }

  private async readActive(): Promise<UnresolvedWriteRecord[]> {
    let records: UnresolvedWriteRecord[] = [];
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      if (Array.isArray(parsed)) records = parsed.filter((item): item is UnresolvedWriteRecord =>
        item && typeof item === "object" && item.status === "unresolved" && typeof item.profile === "string" &&
        typeof item.tool === "string" && typeof item.businessRequestHash === "string" && typeof item.createdAt === "string");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new AiHubError("AI_HUB_UNRESOLVED_WRITE_STORE_ERROR", "Unable to read the local unresolved-write state.");
      }
    }
    const cutoff = this.now().getTime() - RETENTION_MS;
    const active = records.filter((record) => Date.parse(record.createdAt) >= cutoff);
    if (active.length !== records.length) await this.write(active);
    return active;
  }

  private async write(records: UnresolvedWriteRecord[]): Promise<void> {
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (this.os !== "win32") await chmod(this.directory, 0o700);
      await writeFile(temporary, JSON.stringify(records), { mode: 0o600 });
      if (this.os !== "win32") await chmod(temporary, 0o600);
      await rename(temporary, this.file);
      if (this.os !== "win32") await chmod(this.file, 0o600);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new AiHubError("AI_HUB_UNRESOLVED_WRITE_STORE_ERROR", "Unable to save the local unresolved-write state.");
    }
  }
}
