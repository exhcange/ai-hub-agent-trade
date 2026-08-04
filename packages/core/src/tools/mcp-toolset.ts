import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";

export const MCP_TOOLSETS = ["default", "full"] as const;
export type McpToolset = (typeof MCP_TOOLSETS)[number];
export const DEFAULT_MCP_TOOLSET: McpToolset = "default";

export function parseMcpToolset(value: string | undefined): McpToolset {
  if (value === undefined) return DEFAULT_MCP_TOOLSET;
  if ((MCP_TOOLSETS as readonly string[]).includes(value)) return value as McpToolset;
  throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `--toolset must be one of: ${MCP_TOOLSETS.join(", ")}.`);
}

/**
 * Both names are retained for existing client configurations. Tool exposure is
 * intentionally identical: context is reduced through concise metadata, not
 * by hiding product capabilities.
 */
export function selectMcpToolset(tools: readonly ToolSpec[], _toolset: McpToolset): ToolSpec[] {
  return [...tools];
}
