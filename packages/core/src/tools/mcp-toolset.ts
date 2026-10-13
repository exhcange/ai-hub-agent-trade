import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";

export const MCP_TOOLSETS = ["default", "full", "transfer"] as const;
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
  if (_toolset !== "transfer") return [...tools];
  return tools.filter((tool) => ["wallet_universal_transfer", "wallet_get_universal_transfer_history", "wallet_get_transferable_assets"].includes(tool.name)).map((tool) => {
    const check = (input: Record<string, unknown>) => {
      const from = input.fromAccountType, to = input.toAccountType;
      for (const value of [from, to, input.accountType]) {
        if (value !== undefined && !["1", "5"].includes(String(value))) throw new AiHubError("AI_HUB_TOOL_NOT_AVAILABLE", "Transfer capabilities support only spot and Futures account types 1 and 5.");
      }
      if (tool.operation === "write" && (from === undefined || to === undefined || String(from) === String(to))) throw new AiHubError("AI_HUB_INVALID_ARGUMENT", "Transfer direction must be 1 to 5 or 5 to 1.");
    };
    return {
      ...tool,
      inputSchema: { ...tool.inputSchema, properties: Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {}).map(([key, value]) => [key, ["fromAccountType", "toAccountType", "accountType"].includes(key) ? { ...value, enum: ["1", "5"] } : value])) },
      validate: (input: unknown) => { const valid = tool.validate(input); check(valid); return valid; },
      preflight: async (input: Record<string, unknown>, context: Parameters<ToolSpec["handler"]>[1]) => {
        check(input);
        if (tool.operation === "write" && (context.profile.name !== "spot" || !context.profile.accountPairing)) throw new AiHubError("AI_HUB_ACCOUNT_PAIRING_REQUIRED", "Verify and bind the spot/Futures account pairing before transferring.");
        return tool.preflight ? tool.preflight(input, context) : input;
      },
      handler: async (input: Record<string, unknown>, context: Parameters<ToolSpec["handler"]>[1]) => {
        check(input);
        if (tool.operation !== "write") return tool.handler(input, context);
        if (context.profile.name !== "spot" || !context.profile.accountPairing) throw new AiHubError("AI_HUB_ACCOUNT_PAIRING_REQUIRED", "The verified account pairing is missing or changed.");
        return tool.handler(input, context);
      }
    };
  });
}
