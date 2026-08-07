import type { LoadedCredentials } from "../credential.js";
import type { ResolvedProfile } from "../config.js";
import type { AiHubSpotApi } from "../openapi.js";
import type { ListLimit, UnpagedListLimit } from "./list-limit.js";

export type ToolOperation = "read" | "write";
export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolAccess = "public" | "signed";

/** Stable OpenAPI identity used for generated capability documentation and contract tests. */
export interface OpenApiContract {
  method: "GET" | "POST";
  path: string;
  authentication: ToolAccess;
}

/** Concise, model-facing routing metadata. It never parses user intent at runtime. */
export interface AgentRouting {
  /** Normal user-facing choice, or an explicit raw/advanced alternative. */
  preference: "default" | "advanced";
  /** Short English selection hint used in MCP metadata and generated Skill references. */
  selectionHint: string;
}

export interface JsonSchema {
  [key: string]: unknown;
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
  additionalProperties: false;
}

export interface ToolExecutionContext {
  profile: ResolvedProfile;
  credentials?: LoadedCredentials;
  api: AiHubSpotApi;
}

export interface ToolSpec<Input = Record<string, unknown>> {
  name: string;
  title: string;
  description: string;
  cliPath: readonly string[];
  module: "spot-common" | "spot-order" | "spot-margin" | "spot-account" | "spot-deposit-withdraw" | "spot-sub-account";
  access: ToolAccess;
  operation: ToolOperation;
  riskLevel: ToolRiskLevel;
  openApiContract?: Readonly<OpenApiContract>;
  agentRouting?: Readonly<AgentRouting>;
  inputSchema: JsonSchema;
  errorCodes: readonly string[];
  /** Shared CLI/MCP list pagination rule, when a Tool exposes a bounded list. */
  listLimit?: Readonly<ListLimit>;
  /** Response list capped by Core because the upstream endpoint has no page-size input. */
  unpagedListLimit?: Readonly<UnpagedListLimit>;
  validate(input: unknown): Input;
  /** Optional asynchronous preflight performed before a write is presented for confirmation. */
  preflight?(input: Input, context: ToolExecutionContext): Promise<Input>;
  /**
   * Optional write-only safety check performed after user confirmation and
   * immediately before the request is sent. It must never mutate the order
   * payload or silently alter the user's confirmed intent.
   */
  confirmPreflight?(input: Input, context: ToolExecutionContext): Promise<void>;
  handler(input: Input, context: ToolExecutionContext): Promise<unknown>;
  /**
   * Optional Core-level response normalization shared by CLI and MCP.
   * It may clarify upstream semantics, but must preserve compatibility fields
   * when an existing OpenAPI response is already publicly exposed.
   */
  normalizeResult?(result: unknown, input: Input): unknown;
  writeSummary?(input: Input): Record<string, unknown>;
}
