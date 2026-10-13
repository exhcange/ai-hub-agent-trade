import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AiHubError, OpenApiBusinessError } from "../errors.js";
import { unresolvedWriteDirectory } from "../unresolved-write.js";
import { withLocalLock } from "./transport.js";
import { futuresErrorEvidence } from "./error-catalog.js";

type Identity = Record<string, unknown>;
interface Reservation { id: string; action: string; scope: string; identity: Identity; status: "dispatch-intent"; createdAt: string; failure?: Record<string, unknown> }
function scope(action: string, identity: Identity): string {
  if (["futures_set_position_mode", "futures_cancel_all_orders"].includes(action)) return "account";
  if (typeof identity.contractName === "string") return `contract:${identity.contractName}`;
  if (action === "wallet_universal_transfer" && typeof identity.coinSymbol === "string") return `asset:${identity.coinSymbol}`;
  // A position ID without a verified contract cannot establish non-overlap.
  return "account";
}
function safeIdentity(identity: Identity): Identity {
  return Object.fromEntries(["contractName", "clientOrderId", "orderId", "positionId", "coinSymbol"].filter((key) => typeof identity[key] === "string").map((key) => [key, identity[key]]));
}
/** Durable reservations precede dispatch; unknown outcomes never expire automatically. */
export class FuturesWriteState {
  public constructor(private readonly directory = join(unresolvedWriteDirectory(), "futures-writes")) {}
  private path(binding: string): string { return join(this.directory, createHash("sha256").update(binding).digest("hex")); }
  private async records(binding: string): Promise<Reservation[]> {
    try {
      const rows: unknown = JSON.parse(await readFile(this.path(binding), "utf8"));
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.id !== "string" || typeof row.scope !== "string" || row.status !== "dispatch-intent")) throw new Error("invalid state");
      return rows as Reservation[];
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw new AiHubError("AI_HUB_LOCAL_STATE_INVALID", "Cannot read the operation records."); }
  }
  private async save(binding: string, rows: Reservation[]): Promise<void> {
    const file = this.path(binding), temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(rows), { mode: 0o600 });
    await rename(temporary, file);
  }
  public async assertClear(binding: string, action = "", identity: Identity = {}): Promise<void> {
    const target = scope(action, identity);
    const conflicts = (await this.records(binding)).filter((row) => row.scope === "account" || target === "account" || row.scope === target);
    if (conflicts.length) throw new AiHubError("AI_HUB_UNRESOLVED_WRITE_EXISTS", "An overlapping write has an unresolved outcome. Obtain authoritative evidence before resolving it.", { writeOutcomeUnknown: true, operationIds: conflicts.map((r) => r.id) });
  }
  public async inspect(binding: string): Promise<unknown> {
    const records = await this.records(binding);
    return { status: records.length ? "unresolved" : "clear", records };
  }
  /** Explicit operator resolution only; archive the original record with its evidence. */
  public async resolveWithEvidence(binding: string, outcome: "executed" | "not-executed", evidenceId: string, operationId?: string): Promise<void> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(evidenceId)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "A non-secret authoritative evidence ID is required.");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = this.path(binding);
    await withLocalLock(`${file}.lock`, Date.now() + 30_000, async () => {
      const rows = await this.records(binding);
      const selected = operationId ? rows.find((row) => row.id === operationId) : rows.length === 1 ? rows[0] : undefined;
      if (!selected) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "Select one unresolved operation ID.");
      await writeFile(`${file}.${randomUUID()}.resolved`, JSON.stringify({ original: selected, outcome, evidenceId, resolvedAt: new Date().toISOString(), source: "operator-verified" }), { mode: 0o600, flag: "wx" });
      await this.save(binding, rows.filter((row) => row.id !== selected.id));
    });
  }
  public async execute<T>(binding: string, action: string, send: () => Promise<T>, identity: Identity = {}): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = this.path(binding);
    return withLocalLock(`${file}.lock`, Date.now() + 30_000, async () => {
      await this.assertClear(binding, action, identity);
      const existing = await this.records(binding);
      const record: Reservation = { id: randomUUID(), action, scope: scope(action, identity), identity: safeIdentity(identity), status: "dispatch-intent", createdAt: new Date().toISOString() };
      await this.save(binding, [...existing, record]);
      try {
        const result = await send();
        await this.save(binding, existing);
        return result;
      } catch (error) {
        if (error instanceof AiHubError && !(error instanceof OpenApiBusinessError && (error.diagnosis.writeOutcomeUnknown || ["-1000", "-1001", "-1006", "-1007"].includes(error.diagnosis.upstreamCode))) && ["AI_HUB_OPENAPI_BUSINESS_ERROR", "AI_HUB_RATE_LIMITED", "AI_HUB_LOCAL_STATE_BUSY", "AI_HUB_CREDENTIAL_NOT_CONFIGURED", "AI_HUB_CONFIRMATION_EXPIRED"].includes(error.code)) { await this.save(binding, existing); throw error; }
        const evidence = futuresErrorEvidence(error);
        // Keep only the normalized diagnostic, never a raw response, stack or
        // request. Later operation-status queries can explain the reservation.
        await this.save(binding, [...existing, { ...record, failure: evidence }]);
        throw new AiHubError("AI_HUB_WRITE_RESULT_UNKNOWN", "The write outcome remains unresolved. Do not resend it.", { ...evidence, writeOutcomeUnknown: true, operationId: record.id });
      }
    });
  }
}
