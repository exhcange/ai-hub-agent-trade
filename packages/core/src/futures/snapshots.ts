import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unresolvedWriteDirectory } from "../unresolved-write.js";
import { AiHubError } from "../errors.js";
import { allowFields } from "./normalize.js";

/** Local immutable response pages; tokens cannot move between profiles or queries. */
export class FuturesSnapshots {
  constructor(private readonly directory = join(unresolvedWriteDirectory(), "futures-snapshots")) {}
  private hash(binding: unknown) { return createHash("sha256").update(JSON.stringify(binding)).digest("hex"); }
  async first(rows: unknown[], size: number, binding: unknown): Promise<unknown> {
    const safe = allowFields(rows) as unknown[];
    if (safe.length <= size) return { items: safe, returnedCount: safe.length, truncated: false, continuation: null, upstreamCompleteness: "not_established" };
    // Bound local storage; never imply complete coverage if the upstream exceeds this bound.
    if (safe.length > 10_000) return { items: safe.slice(0, size), returnedCount: size, truncated: true, continuation: null, upstreamCompleteness: "storage_bound_exceeded" };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    await writeFile(join(this.directory, `${id}.json`), JSON.stringify({ rows: safe, binding: this.hash(binding), expires: Date.now() + 300_000 }), { mode: 0o600, flag: "wx" });
    return { items: safe.slice(0, size), returnedCount: size, truncated: true, continuation: { cursor: `${id}:${size}` }, upstreamCompleteness: "not_established" };
  }
  async next(token: string, size: number, binding: unknown): Promise<unknown> {
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(\d{1,5})$/.exec(token);
    if (!match) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "Invalid snapshot cursor.");
    let snapshot;
    try { snapshot = JSON.parse(await readFile(join(this.directory, `${match[1]}.json`), "utf8")); }
    catch { throw new AiHubError("AI_HUB_CURSOR_EXPIRED", "Snapshot is unavailable. Start a new query."); }
    if (!Array.isArray(snapshot.rows) || snapshot.binding !== this.hash(binding) || !Number.isFinite(snapshot.expires) || snapshot.expires <= Date.now()) throw new AiHubError("AI_HUB_CURSOR_EXPIRED", "Snapshot expired or belongs to another query/profile.");
    const offset = Number(match[2]), end = Math.min(snapshot.rows.length, offset + size);
    if (offset >= snapshot.rows.length) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "Cursor is past the end of the snapshot.");
    return { items: snapshot.rows.slice(offset, end), returnedCount: end - offset, truncated: end < snapshot.rows.length, continuation: end < snapshot.rows.length ? { cursor: `${match[1]}:${end}` } : null, upstreamCompleteness: "not_established" };
  }
}
