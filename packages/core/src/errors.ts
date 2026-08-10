import { randomUUID } from "node:crypto";

export class AiHubError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "AiHubError";
    this.code = code;
  }
}

export type AiHubErrorCategory =
  | "VALIDATION"
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "CONFIRMATION"
  | "NOT_FOUND"
  | "RATE_LIMIT"
  | "UPSTREAM_BUSINESS"
  | "UPSTREAM_NETWORK"
  | "INTERNAL";

export type AiHubOperationStatus = "NOT_STARTED" | "REJECTED" | "FAILED" | "UNKNOWN";

export interface AiHubErrorPayloadOptions {
  requestId?: string;
  now?: Date;
}

export interface OpenApiBusinessDiagnosis {
  upstreamCode: string;
  upstreamMessage: string;
  reason: string;
  suggestedAction: string;
  retryable: boolean;
  writeOutcomeUnknown: boolean;
}

/** A successful HTTP response whose OpenAPI business code indicates failure. */
export class OpenApiBusinessError extends AiHubError {
  public constructor(public readonly diagnosis: OpenApiBusinessDiagnosis) {
    super(
      "AI_HUB_OPENAPI_BUSINESS_ERROR",
      `OpenAPI business error ${diagnosis.upstreamCode}: ${diagnosis.upstreamMessage}`
    );
    this.name = "OpenApiBusinessError";
  }
}

export function createRequestId(): string {
  return randomUUID();
}

function localErrorCategory(code: string): AiHubErrorCategory {
  if (code === "AI_HUB_INVALID_CREDENTIAL") return "AUTHENTICATION";
  if (code.includes("CREDENTIAL")) return "CONFIGURATION";
  if (code.includes("PROFILE") || code.includes("CONFIG") || code.includes("OPENAPI_URL")) return "CONFIGURATION";
  if (code.includes("CONFIRMATION") || code === "AI_HUB_WRITE_RESULT_UNKNOWN") return "CONFIRMATION";
  if (code.includes("NOT_FOUND") || code === "AI_HUB_ASSET_NOT_MAPPED") return "NOT_FOUND";
  if (code.includes("NETWORK") || code.includes("HTTP") || code.includes("REDIRECT") || code.includes("INVALID_RESPONSE")) return "UPSTREAM_NETWORK";
  if (code.includes("PERMISSION") || code.includes("AUTHORIZATION")) return "AUTHORIZATION";
  if (code.includes("RATE_LIMIT")) return "RATE_LIMIT";
  if (code.includes("INVALID") || code.includes("AMBIGUOUS") || code.includes("PRECISION") || code.includes("MINIMUM") || code.includes("ARGUMENT") || code.includes("MARKET_PRICE") || code.includes("TOOL_NOT_AVAILABLE") || code.includes("UNKNOWN_COMMAND")) return "VALIDATION";
  return "INTERNAL";
}

function localActionRequired(code: string): string {
  if (code === "AI_HUB_WRITE_RESULT_UNKNOWN") return "Query the affected order or history record before taking another action. Do not retry automatically.";
  if (code.includes("CONFIRMATION")) return "Create a new preview when necessary and provide a new explicit user confirmation before execution.";
  if (code.includes("CREDENTIAL") || code.includes("PROFILE") || code.includes("CONFIG")) return "Correct the selected local profile or credentials before retrying.";
  if (code.includes("NOT_FOUND") || code === "AI_HUB_ASSET_NOT_MAPPED") return "Verify the requested identifier against the available tenant data before retrying.";
  if (code.includes("NETWORK")) return "Retry a read after connectivity recovers. For a write, query its status before any new action.";
  if (code.includes("INVALID") || code.includes("AMBIGUOUS") || code.includes("PRECISION") || code.includes("MINIMUM") || code.includes("ARGUMENT")) return "Correct the request parameters before retrying.";
  return "Review the error details and do not retry a state-changing request automatically.";
}

function operationStatus(error: unknown, code: string): AiHubOperationStatus {
  if (code === "AI_HUB_WRITE_RESULT_UNKNOWN") return "UNKNOWN";
  if (error instanceof OpenApiBusinessError) return error.diagnosis.writeOutcomeUnknown ? "UNKNOWN" : "REJECTED";
  const category = localErrorCategory(code);
  if (["VALIDATION", "CONFIGURATION", "AUTHENTICATION", "AUTHORIZATION", "CONFIRMATION", "NOT_FOUND"].includes(category)) return "NOT_STARTED";
  return "FAILED";
}

/**
 * Serialize every failure into one backward-compatible client envelope.
 * The extra metadata is generated locally in constant time and never adds an
 * OpenAPI request, retry, or other network round trip.
 */
export function toAiHubErrorPayload(error: unknown, options: AiHubErrorPayloadOptions = {}): Record<string, unknown> {
  const requestId = options.requestId ?? createRequestId();
  const timestamp = (options.now ?? new Date()).toISOString();
  const code = error instanceof AiHubError ? error.code : "AI_HUB_UNEXPECTED_ERROR";
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (error instanceof OpenApiBusinessError) {
    const { retryable, ...diagnosis } = error.diagnosis;
    return {
      request_id: requestId,
      error_category: "UPSTREAM_BUSINESS",
      error_code: code,
      message,
      retryable,
      retry_after: null,
      action_required: error.diagnosis.suggestedAction,
      operation_status: operationStatus(error, code),
      timestamp,
      code,
      ...diagnosis
    };
  }
  const category = localErrorCategory(code);
  return {
    request_id: requestId,
    error_category: category,
    error_code: code,
    message,
    retryable: code === "AI_HUB_OPENAPI_NETWORK_ERROR",
    retry_after: null,
    action_required: localActionRequired(code),
    operation_status: operationStatus(error, code),
    timestamp,
    code
  };
}
