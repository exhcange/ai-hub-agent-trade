import type { LoadedCredentials } from "../credential.js";
import type { ResolvedProfile } from "../config.js";
import type { AiHubSpotApi } from "../openapi.js";
import type { ListLimit, UnpagedListLimit } from "./list-limit.js";

export type ToolOperation = "read" | "write";
export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolAccess = "public" | "signed";

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
  inputSchema: JsonSchema;
  errorCodes: readonly string[];
  /** Shared CLI/MCP list pagination rule, when a Tool exposes a bounded list. */
  listLimit?: Readonly<ListLimit>;
  /** Response list capped by Core because the upstream endpoint has no page-size input. */
  unpagedListLimit?: Readonly<UnpagedListLimit>;
  validate(input: unknown): Input;
  /** Optional asynchronous preflight performed before a write is presented for confirmation. */
  preflight?(input: Input, context: ToolExecutionContext): Promise<Input>;
  handler(input: Input, context: ToolExecutionContext): Promise<unknown>;
  writeSummary?(input: Input): Record<string, unknown>;
}
