export class AiHubError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "AiHubError";
    this.code = code;
  }
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

/** Serialize every locally generated error without dropping OpenAPI diagnostics. */
export function toAiHubErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof OpenApiBusinessError) {
    return { code: error.code, ...error.diagnosis };
  }
  if (error instanceof AiHubError) {
    return { code: error.code, message: error.message };
  }
  return { code: "AI_HUB_UNEXPECTED_ERROR", message: error instanceof Error ? error.message : "Unexpected error" };
}
