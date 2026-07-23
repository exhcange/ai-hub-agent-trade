import { createHash, randomUUID } from "node:crypto";
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

interface PendingAction extends PrepareActionInput {
  confirmationId: string;
  requestHash: string;
  expiresAtMs: number;
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

/** In-memory, one-time authorization for an MCP state-changing request. */
export class ConfirmationService {
  private readonly actions = new Map<string, PendingAction>();

  public constructor(private readonly ttlMs = 5 * 60 * 1000, private readonly now = () => Date.now()) {}

  public prepare(input: PrepareActionInput): PreparedAction {
    const expiresAtMs = this.now() + this.ttlMs;
    const confirmationId = randomUUID();
    const requestHash = hash(input);
    this.actions.set(confirmationId, { ...input, confirmationId, requestHash, expiresAtMs, consumed: false });
    return {
      confirmationId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      requestHash,
      action: input.action,
      summary: input.summary,
      requiresNewUserConfirmation: true,
      nextStep: "Stop and wait for a new explicit user confirmation message. Do not call confirm_action from the same user instruction that prepared this request."
    };
  }

  public confirm(confirmationId: string, userConfirmation: string, context: ExecutionContext): { action: string; payload: Record<string, unknown>; requestHash: string } {
    if (typeof userConfirmation !== "string" || !userConfirmation.trim()) {
      throw new AiHubError("AI_HUB_CONFIRMATION_REQUIRED", "A non-empty new explicit user confirmation message is required before a state-changing request can execute.");
    }
    const pending = this.actions.get(confirmationId);
    if (!pending) throw new AiHubError("AI_HUB_CONFIRMATION_NOT_FOUND", "Confirmation was not found or has already been consumed.");
    if (pending.consumed) throw new AiHubError("AI_HUB_CONFIRMATION_CONSUMED", "Confirmation has already been consumed.");
    if (pending.expiresAtMs < this.now()) {
      this.actions.delete(confirmationId);
      throw new AiHubError("AI_HUB_CONFIRMATION_EXPIRED", "Confirmation has expired.");
    }
    if (stableJson(pending.context) !== stableJson(context)) {
      this.actions.delete(confirmationId);
      throw new AiHubError("AI_HUB_CONFIRMATION_CONTEXT_CHANGED", "Profile, OpenAPI base URL, configuration, or credentials changed after prepare.");
    }
    pending.consumed = true;
    this.actions.delete(confirmationId);
    return { action: pending.action, payload: pending.payload, requestHash: pending.requestHash };
  }
}
