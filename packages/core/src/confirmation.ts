import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AiHubError } from "./errors.js";

export interface ExecutionContext {
  profile: string;
  openApiBaseUrl: string;
  configVersion: string;
  credentialVersion: string;
}

export interface PrepareActionInput {
  action: string;
  payload: Record<string, unknown>;
  context: ExecutionContext;
  summary: Record<string, unknown>;
}

export interface PreparedAction {
  confirmationId: string;
  expiresAt: string;
  requestHash: string;
  action: string;
  summary: Record<string, unknown>;
  /** A host/Agent workflow guard; source provenance must be enforced by the caller. */
  requiresNewUserConfirmation: true;
  nextStep: string;
}

export interface PendingConfirmation extends PrepareActionInput {
  confirmationId: string;
  requestHash: string;
  expiresAtMs: number;
}

interface MemoryPendingAction extends PendingConfirmation {
  consumed: boolean;
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

function hash(input: PrepareActionInput): string {
  return createHash("sha256").update(stableJson({ action: input.action, payload: input.payload, context: input.context })).digest("hex");
}

function createPending(input: PrepareActionInput, ttlMs: number, now: () => number): PendingConfirmation {
  return {
    ...input,
    confirmationId: randomUUID(),
    requestHash: hash(input),
    expiresAtMs: now() + ttlMs
  };
}

function preparedAction(pending: PendingConfirmation): PreparedAction {
  return {
    confirmationId: pending.confirmationId,
    expiresAt: new Date(pending.expiresAtMs).toISOString(),
    requestHash: pending.requestHash,
    action: pending.action,
    summary: pending.summary,
    requiresNewUserConfirmation: true,
    nextStep: "Stop and wait for a new explicit user confirmation message. Do not confirm from the same user instruction that prepared this request."
  };
}

function confirmPending(pending: PendingConfirmation, userConfirmation: string, context: ExecutionContext, now: () => number): { action: string; payload: Record<string, unknown>; requestHash: string } {
  if (typeof userConfirmation !== "string" || !userConfirmation.trim()) {
    throw new AiHubError("AI_HUB_CONFIRMATION_REQUIRED", "A non-empty new explicit user confirmation message is required before a state-changing request can execute.");
  }
  if (pending.expiresAtMs < now()) {
    throw new AiHubError("AI_HUB_CONFIRMATION_EXPIRED", "Confirmation has expired.");
  }
  if (stableJson(pending.context) !== stableJson(context)) {
    throw new AiHubError("AI_HUB_CONFIRMATION_CONTEXT_CHANGED", "Profile, OpenAPI base URL, configuration, or credentials changed after prepare.");
  }
  return { action: pending.action, payload: pending.payload, requestHash: pending.requestHash };
}

export interface ConfirmationPreparer {
  prepare(input: PrepareActionInput): PreparedAction | Promise<PreparedAction>;
}

export interface ConfirmedAction {
  action: string;
  payload: Record<string, unknown>;
  requestHash: string;
}

/** Shared one-time confirmation contract used by both MCP memory and CLI files. */
export interface ConfirmationStore extends ConfirmationPreparer {
  confirm(confirmationId: string, userConfirmation: string, context: ExecutionContext): ConfirmedAction | Promise<ConfirmedAction>;
}

/** In-memory, one-time authorization for an MCP state-changing request. */
export class ConfirmationService implements ConfirmationStore {
  private readonly actions = new Map<string, MemoryPendingAction>();

  public constructor(private readonly ttlMs = 5 * 60 * 1000, private readonly now = () => Date.now()) {}

  public prepare(input: PrepareActionInput): PreparedAction {
    const pending = createPending(input, this.ttlMs, this.now);
    this.actions.set(pending.confirmationId, { ...pending, consumed: false });
    return preparedAction(pending);
  }

  public confirm(confirmationId: string, userConfirmation: string, context: ExecutionContext): ConfirmedAction {
    if (typeof userConfirmation !== "string" || !userConfirmation.trim()) {
      throw new AiHubError("AI_HUB_CONFIRMATION_REQUIRED", "A non-empty new explicit user confirmation message is required before a state-changing request can execute.");
    }
    const pending = this.actions.get(confirmationId);
    if (!pending) throw new AiHubError("AI_HUB_CONFIRMATION_NOT_FOUND", "Confirmation was not found or has already been consumed.");
    if (pending.consumed) throw new AiHubError("AI_HUB_CONFIRMATION_CONSUMED", "Confirmation has already been consumed.");
    pending.consumed = true;
    this.actions.delete(confirmationId);
    return confirmPending(pending, userConfirmation, context, this.now);
  }
}

const CONFIRMATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * CLI-only one-time confirmation store. Files contain a prepared action but
 * never credentials, and are atomically renamed before validation so a token
 * can never execute twice across separate CLI processes.
 */
export class FileConfirmationStore implements ConfirmationStore {
  public constructor(
    private readonly directory = join(homedir(), ".ai-hub", "pending-actions"),
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly now = () => Date.now()
  ) {}

  public async prepare(input: PrepareActionInput): Promise<PreparedAction> {
    const pending = createPending(input, this.ttlMs, this.now);
    const filePath = this.filePath(pending.confirmationId);
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      await writeFile(temporaryPath, JSON.stringify(pending), { mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new AiHubError("AI_HUB_CONFIRMATION_STORE_ERROR", `Unable to save the local confirmation preview: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    return preparedAction(pending);
  }

  public async confirm(confirmationId: string, userConfirmation: string, context: ExecutionContext): Promise<ConfirmedAction> {
    if (typeof userConfirmation !== "string" || !userConfirmation.trim()) {
      throw new AiHubError("AI_HUB_CONFIRMATION_REQUIRED", "A non-empty new explicit user confirmation message is required before a state-changing request can execute.");
    }
    if (!CONFIRMATION_ID.test(confirmationId)) {
      throw new AiHubError("AI_HUB_CONFIRMATION_NOT_FOUND", "Confirmation was not found or has already been consumed.");
    }
    const filePath = this.filePath(confirmationId);
    const consumedPath = `${filePath}.${process.pid}.${randomUUID()}.consumed`;
    try {
      await rename(filePath, consumedPath);
    } catch {
      throw new AiHubError("AI_HUB_CONFIRMATION_NOT_FOUND", "Confirmation was not found or has already been consumed.");
    }
    try {
      const pending = this.parse(await readFile(consumedPath, "utf8"), confirmationId);
      return confirmPending(pending, userConfirmation, context, this.now);
    } finally {
      await rm(consumedPath, { force: true }).catch(() => undefined);
    }
  }

  private filePath(confirmationId: string): string {
    return join(this.directory, `${confirmationId}.json`);
  }

  private parse(value: string, confirmationId: string): PendingConfirmation {
    try {
      const parsed = JSON.parse(value) as Partial<PendingConfirmation>;
      if (
        parsed.confirmationId !== confirmationId ||
        typeof parsed.action !== "string" ||
        !parsed.payload || typeof parsed.payload !== "object" || Array.isArray(parsed.payload) ||
        !parsed.context || typeof parsed.context !== "object" || Array.isArray(parsed.context) ||
        !parsed.summary || typeof parsed.summary !== "object" || Array.isArray(parsed.summary) ||
        typeof parsed.requestHash !== "string" ||
        typeof parsed.expiresAtMs !== "number"
      ) {
        throw new Error("invalid confirmation data");
      }
      const pending = parsed as PendingConfirmation;
      if (hash({ action: pending.action, payload: pending.payload, context: pending.context, summary: pending.summary }) !== pending.requestHash) {
        throw new Error("confirmation data hash mismatch");
      }
      return pending;
    } catch {
      throw new AiHubError("AI_HUB_CONFIRMATION_NOT_FOUND", "Confirmation was not found or has already been consumed.");
    }
  }
}
