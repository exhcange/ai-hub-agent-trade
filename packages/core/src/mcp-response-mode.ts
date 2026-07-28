import { AiHubError } from "./errors.js";

export const MCP_RESPONSE_MODES = ["compact", "compat"] as const;
export type McpResponseMode = (typeof MCP_RESPONSE_MODES)[number];
export const DEFAULT_MCP_RESPONSE_MODE: McpResponseMode = "compact";

export function parseMcpResponseMode(value: string | undefined): McpResponseMode {
  if (value === undefined) return DEFAULT_MCP_RESPONSE_MODE;
  if ((MCP_RESPONSE_MODES as readonly string[]).includes(value)) return value as McpResponseMode;
  throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `--response-mode must be one of: ${MCP_RESPONSE_MODES.join(", ")}.`);
}
