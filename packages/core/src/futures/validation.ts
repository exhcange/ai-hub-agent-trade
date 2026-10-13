import { AiHubError } from "../errors.js";
import type { JsonSchema } from "../tools/tool-spec.js";

export function invalid(message: string): never { throw new AiHubError("AI_HUB_INVALID_ARGUMENT", message); }
export const decimal = { type: "string", pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$", maxLength: 80 };
export const identifier = { type: "string", pattern: "^[1-9][0-9]{0,18}$" };
export const text = { type: "string", minLength: 1, maxLength: 128 };
export const limit = { type: "integer", minimum: 1, maximum: 50, default: 20 };
export const page = { type: "integer", minimum: 1, maximum: 1000000, default: 1 };
export const timestamp = { type: "integer", minimum: 0, maximum: 8640000000000000 };
export const oneOf = (...values: (string | number)[]) => ({ type: typeof values[0] === "number" ? "integer" : "string", enum: values });
export function schema(properties: Record<string, object>, required: string[] = []): JsonSchema { return { type: "object", properties, required, additionalProperties: false }; }

export function validateSchema(input: unknown, spec: Record<string, unknown>, path = "input"): unknown {
  if (input === undefined && spec.default !== undefined) return spec.default;
  if (spec.type === "object") {
    if (!input || typeof input !== "object" || Array.isArray(input)) invalid(`${path} must be an object.`);
    const record = input as Record<string, unknown>, properties = spec.properties as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(record)) if (!Object.hasOwn(properties, key)) invalid(`Unknown argument ${path}.${key}.`);
    for (const key of spec.required as string[] ?? []) if (record[key] === undefined) invalid(`${path}.${key} is required.`);
    return Object.fromEntries(Object.entries(properties).filter(([k, v]) => record[k] !== undefined || v.default !== undefined).map(([k, v]) => [k, validateSchema(record[k], v, `${path}.${k}`)]));
  }
  if (spec.type === "array") {
    if (!Array.isArray(input) || input.length < Number(spec.minItems ?? 0) || input.length > Number(spec.maxItems ?? 50)) invalid(`${path} has an invalid item count.`);
    return (input as unknown[]).map((value, i) => validateSchema(value, spec.items as Record<string, unknown>, `${path}[${i}]`));
  }
  if (spec.type === "string") {
    if (typeof input !== "string" || !input.trim() || input.length > Number(spec.maxLength ?? 128) || (spec.pattern && !new RegExp(String(spec.pattern)).test(input))) invalid(`${path} must be a valid string.`);
  } else if (spec.type === "integer") {
    if (typeof input !== "number" || !Number.isSafeInteger(input) || input < Number(spec.minimum ?? -Number.MAX_SAFE_INTEGER) || input > Number(spec.maximum ?? Number.MAX_SAFE_INTEGER)) invalid(`${path} must be an integer in its declared range.`);
  } else if (spec.type === "boolean" && typeof input !== "boolean") invalid(`${path} must be boolean.`);
  if (spec.pattern === identifier.pattern && BigInt(String(input)) > 9223372036854775807n) invalid(`${path} exceeds the signed 64-bit identifier range.`);
  if (Array.isArray(spec.enum) && !spec.enum.includes(input)) invalid(`${path} is not an allowed value.`);
  if (spec.const !== undefined && spec.const !== input) invalid(`${path} does not match the required value.`);
  return input;
}
export function positive(value: unknown, name: string): void {
  if (typeof value !== "string" || !/[1-9]/.test(value) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) invalid(`${name} must be a positive exact decimal string.`);
}
/** UTC timestamp boundary; callers resolve the user's calendar/time zone before invocation. */
export function validateHalfYear(input: Record<string, unknown>, startField = "startTime"): void {
  const start = input[startField], end = input.endTime;
  if (start === undefined && end === undefined) return;
  if (typeof start !== "number" || typeof end !== "number" || start > end) invalid(`${startField} and endTime must form an ordered timestamp pair.`);
  const from = new Date(start as number), maximum = new Date(start as number);
  const day = from.getUTCDate(); maximum.setUTCDate(1); maximum.setUTCMonth(maximum.getUTCMonth() + 6);
  const last = new Date(Date.UTC(maximum.getUTCFullYear(), maximum.getUTCMonth() + 1, 0)).getUTCDate();
  maximum.setUTCDate(Math.min(day, last));
  if (!Number.isFinite(maximum.getTime()) || (end as number) > maximum.getTime()) invalid("Query time span must not exceed six calendar months.");
}
