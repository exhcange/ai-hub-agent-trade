import { AiHubError } from "../errors.js";

export function strictObject(input: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "Tool input must be an object.");
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `Unknown argument "${key}".`);
  }
  return record;
}

export function requiredString(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || !value.trim()) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} is required.`);
  return value.trim();
}

export function optionalString(input: Record<string, unknown>, name: string): string | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} must be a non-empty string.`);
  return value.trim();
}

export function optionalInteger(input: Record<string, unknown>, name: string, fallback: number, minimum: number, maximum: number): number {
  const value = input[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
