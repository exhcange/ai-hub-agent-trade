import type { LoadedCredentials } from "../credential.js";
import type { ResolvedProfile } from "../config.js";
import type { AiHubSpotApi } from "../openapi.js";

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
  validate(input: unknown): Input;
  handler(input: Input, context: ToolExecutionContext): Promise<unknown>;
  writeSummary?(input: Input): Record<string, unknown>;
}
