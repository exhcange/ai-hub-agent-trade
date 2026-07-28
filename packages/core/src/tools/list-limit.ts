import { AiHubError } from "../errors.js";
import { optionalInteger } from "./validation.js";
import type { ToolSpec } from "./tool-spec.js";

export interface ListLimit {
  field: "limit" | "pageSize";
  defaultValue: number;
  maximum: number;
}

/**
 * Declares a response list for an upstream endpoint that cannot be constrained
 * with a page-size request parameter. Core applies the cap after the upstream
 * response so the CLI and MCP cannot drift.
 */
export interface UnpagedListLimit {
  path: readonly string[];
  /** The request field that can continue to the next fixed upstream page, if any. */
  pageField?: "page" | "offset";
}

export const STANDARD_LIST_LIMIT: Readonly<ListLimit> = {
  field: "limit",
  defaultValue: 20,
  maximum: 50
};

export const STANDARD_PAGE_SIZE: Readonly<ListLimit> = {
  field: "pageSize",
  defaultValue: 20,
  maximum: 50
};

export function listLimitSchema(limit: Readonly<ListLimit>, description?: string): { type: "integer"; minimum: number; maximum: number; description: string } {
  return {
    type: "integer",
    minimum: 1,
    maximum: limit.maximum,
    description: description ?? `Defaults to ${limit.defaultValue}; maximum ${limit.maximum}.`
  };
}

export function optionalListLimit(input: Record<string, unknown>, limit: Readonly<ListLimit>): number {
  return optionalInteger(input, limit.field, limit.defaultValue, 1, limit.maximum);
}

/**
 * Adds the ToolSpec-declared list default and validates its range before the
 * focused Tool validator runs. CLI and MCP both enter through ToolRegistry,
 * so this is the only place that owns list-size default/range behavior.
 */
export function normalizeListLimitInput(input: unknown, limit: Readonly<ListLimit>): unknown {
  const value = record(input);
  return value ? { ...value, [limit.field]: optionalListLimit(value, limit) } : input;
}

/** Reads a value that was normalized by the shared list-limit adapter. */
export function normalizedListLimit(input: Record<string, unknown>, limit: Readonly<ListLimit>): number {
  const value = input[limit.field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > limit.maximum) {
    throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `${limit.field} must be an integer between 1 and ${limit.maximum}.`);
  }
  return value;
}

/**
 * Produces the registered form of a list Tool. Its schema and input parsing
 * are derived from one ListLimit declaration instead of adapter-specific code.
 */
export function withListLimit<Input>(tool: ToolSpec<Input>): ToolSpec<Input> {
  if (!tool.listLimit) return tool;
  const limit = tool.listLimit;
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...tool.inputSchema.properties,
        [limit.field]: listLimitSchema(limit, (tool.inputSchema.properties?.[limit.field] as { description?: unknown } | undefined)?.description as string | undefined)
      }
    },
    validate: (input) => tool.validate(normalizeListLimitInput(input, limit))
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Truncates a known list in an otherwise opaque upstream response. The response
 * keeps its native fields, but announces whether a further request is possible.
 */
export function truncateUnpagedListResponse(
  response: unknown,
  definition: Readonly<UnpagedListLimit>,
  input: Record<string, unknown>,
  maximum = STANDARD_LIST_LIMIT.maximum
): unknown {
  const root = record(response);
  if (!root || definition.path.length === 0) return response;

  const ancestors: Record<string, unknown>[] = [root];
  let current: unknown = root;
  for (const key of definition.path) {
    const next = record(current)?.[key];
    if (key === definition.path[definition.path.length - 1]) {
      if (!Array.isArray(next) || next.length <= maximum) return response;
      const parent = record(current);
      if (!parent) return response;
      const currentPage = definition.pageField ? input[definition.pageField] : undefined;
      const nextPage = typeof currentPage === "number" ? currentPage + 1 : null;
      const limitedParent = {
        ...parent,
        [key]: next.slice(0, maximum),
        returnedCount: maximum,
        totalCount: next.length,
        truncated: true,
        continuation: definition.pageField
          ? { available: true, [definition.pageField]: nextPage }
          : { available: false, reason: "The upstream endpoint does not expose a continuation parameter." }
      };
      let replacement: Record<string, unknown> = limitedParent;
      for (let index = ancestors.length - 2; index >= 0; index -= 1) {
        const ancestor = ancestors[index];
        const childKey = definition.path[index];
        if (!ancestor || !childKey) return response;
        replacement = { ...ancestor, [childKey]: replacement };
      }
      return replacement;
    }
    const nextRecord = record(next);
    if (!nextRecord) return response;
    ancestors.push(nextRecord);
    current = nextRecord;
  }
  return response;
}
