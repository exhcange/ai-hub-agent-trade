import { randomUUID } from "node:crypto";
import { AiHubError } from "../errors.js";
import type { ToolExecutionContext } from "./tool-spec.js";
import { optionalString, requiredString } from "./validation.js";

export const signedReadErrors = ["AI_HUB_INVALID_ARGUMENT", "AI_HUB_CREDENTIAL_NOT_CONFIGURED", "AI_HUB_OPENAPI_NETWORK_ERROR", "AI_HUB_OPENAPI_HTTP_ERROR", "AI_HUB_OPENAPI_INVALID_RESPONSE", "AI_HUB_OPENAPI_BUSINESS_ERROR"] as const;
export const writeErrors = [...signedReadErrors, "AI_HUB_WRITE_CONFIRMATION_REQUIRED", "AI_HUB_CONFIRMATION_REQUIRED", "AI_HUB_CONFIRMATION_EXPIRED", "AI_HUB_CONFIRMATION_CONTEXT_CHANGED", "AI_HUB_CONFIRMATION_NOT_FOUND"] as const;

export function signed(context: ToolExecutionContext) {
  if (!context.credentials) throw new AiHubError("AI_HUB_CREDENTIAL_NOT_CONFIGURED", `Credentials are not configured for profile "${context.profile.name}".`);
  return context.credentials;
}

export function positiveDecimal(input: Record<string, unknown>, name: string): string {
  const value = requiredString(input, name);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !/[1-9]/.test(value.replace(".", ""))) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} must be a positive decimal string.`);
  }
  return value;
}

export function requiredEnum<T extends string>(input: Record<string, unknown>, name: string, allowed: readonly T[]): T {
  const value = requiredString(input, name).toUpperCase() as T;
  if (!allowed.includes(value)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} must be one of: ${allowed.join(", ")}.`);
  return value;
}

export function optionalBoolean(input: Record<string, unknown>, name: string): boolean | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} must be a boolean.`);
  return value;
}

export function optionalPositiveInteger(input: Record<string, unknown>, name: string, fallback: number, maximum = 1000): number {
  const value = input[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

export function optionalClientOrderId(input: Record<string, unknown>): string {
  return optionalString(input, "newClientOrderId") ?? `agent_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}
