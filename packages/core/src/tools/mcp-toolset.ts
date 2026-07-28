import { AiHubError } from "../errors.js";
import type { ToolSpec } from "./tool-spec.js";

export const MCP_TOOLSETS = ["default", "full"] as const;
export type McpToolset = (typeof MCP_TOOLSETS)[number];
export const DEFAULT_MCP_TOOLSET: McpToolset = "default";

const DEFAULT_MCP_TOOL_NAMES = new Set([
  "market_get_symbol_overview",
  "market_list_symbols",
  "market_search_symbols",
  "market_get_symbol_info",
  "market_get_depth_summary",
  "market_get_ticker",
  "market_get_ticker_summary",
  "market_get_trades_summary",
  "market_get_klines_summary",
  "spot_get_order",
  "spot_batch_place_orders",
  "spot_batch_cancel_orders",
  "spot_get_open_orders",
  "spot_get_fills",
  "spot_market_buy",
  "spot_market_sell",
  "spot_limit_order",
  "spot_cancel_order",
  "wallet_universal_transfer",
  "wallet_get_universal_transfer_history",
  "wallet_get_deposit_history",
  "wallet_get_deposit_address",
  "wallet_get_withdraw_address",
  "wallet_get_transferable_assets"
]);

export function parseMcpToolset(value: string | undefined): McpToolset {
  if (value === undefined) return DEFAULT_MCP_TOOLSET;
  if ((MCP_TOOLSETS as readonly string[]).includes(value)) return value as McpToolset;
  throw new AiHubError("AI_HUB_INVALID_ARGUMENT", `--toolset must be one of: ${MCP_TOOLSETS.join(", ")}.`);
}

/** Returns the only business Tools visible to one local MCP server session. */
export function selectMcpToolset(tools: readonly ToolSpec[], toolset: McpToolset): ToolSpec[] {
  return toolset === "full" ? [...tools] : tools.filter((tool) => DEFAULT_MCP_TOOL_NAMES.has(tool.name));
}
