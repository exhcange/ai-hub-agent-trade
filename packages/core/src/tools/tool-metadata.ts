import { AiHubError } from "../errors.js";
import type { AgentRouting, OpenApiContract, ToolSpec } from "./tool-spec.js";

const publicGet = (path: string): OpenApiContract => ({ method: "GET", path, authentication: "public" });
const signedGet = (path: string): OpenApiContract => ({ method: "GET", path, authentication: "signed" });
const signedPost = (path: string): OpenApiContract => ({ method: "POST", path, authentication: "signed" });

function assign(names: readonly string[], contract: OpenApiContract): Record<string, OpenApiContract> {
  return Object.fromEntries(names.map((name) => [name, contract]));
}

/**
 * One authoritative Tool -> OpenAPI manifest. Tool handlers perform the call;
 * this manifest exists for capability generation and contract verification.
 */
export const OPENAPI_CONTRACTS: Readonly<Record<string, Readonly<OpenApiContract>>> = {
  ...assign(["market_ping"], publicGet("/sapi/v2/ping")),
  ...assign(["market_get_server_time"], publicGet("/sapi/v2/time")),
  ...assign(["market_get_symbols", "market_get_symbol_overview", "market_list_symbols", "market_search_symbols", "market_get_symbol_info"], publicGet("/sapi/v2/symbols")),
  ...assign(["market_get_last_price", "market_get_ticker", "market_get_ticker_summary"], publicGet("/sapi/v2/ticker")),
  ...assign(["market_get_depth", "market_get_depth_summary"], publicGet("/sapi/v2/depth")),
  ...assign(["market_get_trades", "market_get_trades_summary"], publicGet("/sapi/v2/trades")),
  ...assign(["market_get_klines", "market_get_klines_summary"], publicGet("/sapi/v2/klines")),
  ...assign(["market_get_historical_minute_klines"], publicGet("/sapi/v2/klines_1min")),

  ...assign(["account_get_asset_balance", "account_list_balances"], signedGet("/sapi/v1/account")),

  ...assign(["spot_test_order"], signedPost("/sapi/v2/order/test")),
  ...assign(["spot_get_order"], signedGet("/sapi/v2/order")),
  ...assign(["spot_batch_place_orders"], signedPost("/sapi/v2/batchOrders")),
  ...assign(["spot_batch_cancel_orders"], signedPost("/sapi/v2/batchCancel")),
  ...assign(["spot_get_open_orders"], signedGet("/sapi/v2/openOrders")),
  ...assign(["spot_get_history_orders"], signedGet("/sapi/v2/historyOrders")),
  ...assign(["spot_get_fills"], signedGet("/sapi/v2/myTrades")),
  ...assign(["spot_market_buy", "spot_market_sell", "spot_sell_available", "spot_limit_order", "spot_stop_limit_order", "spot_stop_market_buy", "spot_stop_market_sell"], signedPost("/sapi/v2/order")),
  ...assign(["spot_cancel_order"], signedPost("/sapi/v2/cancel")),

  ...assign(["margin_get_order"], signedGet("/sapi/v2/margin/order")),
  ...assign(["margin_get_open_orders"], signedGet("/sapi/v2/margin/openOrders")),
  ...assign(["margin_get_fills"], signedGet("/sapi/v2/margin/myTrades")),
  ...assign(["margin_market_buy", "margin_market_sell", "margin_limit_order", "margin_stop_limit_order", "margin_stop_market_buy", "margin_stop_market_sell"], signedPost("/sapi/v2/margin/order")),
  ...assign(["margin_cancel_order"], signedPost("/sapi/v2/margin/cancel")),

  ...assign(["wallet_universal_transfer"], signedPost("/sapi/v1/asset/universal_transfer")),
  ...assign(["wallet_get_universal_transfer_history"], signedPost("/sapi/v1/asset/universal_transfer_query")),
  ...assign(["wallet_get_deposit_history"], signedPost("/sapi/v1/deposit/his_list")),
  ...assign(["wallet_get_deposit_address"], signedPost("/sapi/v1/deposit/query_address")),
  ...assign(["wallet_get_withdraw_address"], signedPost("/sapi/v1/withdraw/address/query")),
  ...assign(["wallet_get_transferable_assets"], signedPost("/sapi/v1/asset/account/by_type")),
  ...assign(["wallet_create_withdraw"], signedPost("/sapi/v1/withdraw/apply")),
  ...assign(["wallet_get_withdraw_history"], signedPost("/sapi/v1/withdraw/query")),

  ...assign(["sub_account_list"], signedPost("/sapi/v1/sub_user/get_sub_user_List")),
  ...assign(["sub_account_create"], signedPost("/sapi/v1/sub_user/create_sub_user")),
  ...assign(["sub_account_update_trading_status"], signedPost("/sapi/v1/sub_user/update_trade_status")),
  ...assign(["sub_account_get_api_key_ips"], signedPost("/sapi/v1/sub_user/sub_account_api/list")),
  ...assign(["sub_account_update_api_key_ips"], signedPost("/sapi/v1/sub_user/sub_account_api/update_ip")),
  ...assign(["sub_account_delete_api_key"], signedPost("/sapi/v1/sub_user/sub_account_api/delete")),
  ...assign(["sub_account_get_assets"], signedPost("/sapi/v1/sub_user/asset/account")),
  ...assign(["sub_account_root_transfer"], signedPost("/sapi/v1/sub_user/asset/root_transfer")),
  ...assign(["sub_account_get_root_transfer_history"], signedPost("/sapi/v1/sub_user/asset/root_transfer_query")),
  ...assign(["sub_account_internal_transfer"], signedPost("/sapi/v1/sub_user/asset/transfer")),
  ...assign(["sub_account_get_internal_transfer_history"], signedPost("/sapi/v1/sub_user/asset/transfer_query"))
};

const RAW_MARKET_TOOLS = new Set(["market_get_symbols", "market_get_ticker", "market_get_depth", "market_get_trades", "market_get_klines"]);

function routingFor(tool: ToolSpec): AgentRouting {
  if (RAW_MARKET_TOOLS.has(tool.name)) {
    return { preference: "advanced", selectionHint: "Use only when the user explicitly requests raw or complete market fields; otherwise use the matching summary Tool." };
  }
  if (tool.name.endsWith("_summary")) {
    return { preference: "default", selectionHint: "Use for ordinary natural-language market questions; it returns a bounded compact summary." };
  }
  return { preference: "default", selectionHint: `Use when the request directly matches ${tool.title.toLowerCase()}.` };
}

/** Applies mandatory metadata and fails closed when a new Tool lacks an OpenAPI contract. */
export function withToolMetadata(tool: ToolSpec): ToolSpec {
  // Built-in tools obtain their contract from the manifest. A caller that
  // constructs an isolated Registry (for example, an adapter test) must
  // supply the same explicit metadata rather than silently creating an
  // uncontracted tool.
  const openApiContract = tool.openApiContract ?? OPENAPI_CONTRACTS[tool.name];
  if (!openApiContract) throw new AiHubError("AI_HUB_OPENAPI_CONTRACT_MISSING", `Tool "${tool.name}" has no OpenAPI contract metadata.`);
  if (openApiContract.authentication !== tool.access) {
    throw new AiHubError("AI_HUB_OPENAPI_CONTRACT_INVALID", `Tool "${tool.name}" OpenAPI authentication does not match its access mode.`);
  }
  return { ...tool, openApiContract, agentRouting: tool.agentRouting ?? routingFor(tool) };
}

/** Short session-level guide: detailed mapping belongs in focused Skills. */
export function mcpRoutingInstructions(): string {
  return [
    "Route directly to the matching Tool after understanding the user's intent; do not call CLI when this MCP is available.",
    "Market: current price=market_get_last_price; normal ticker/depth/trades/klines use the matching *_summary Tool; raw market tools only for explicit raw/complete data requests.",
    "Account: one named asset=account_get_asset_balance; balance overview=account_list_balances.",
    "Spot and margin writes: call the matching prepare Tool only, then wait for a NEW user message before confirm_action.",
    "Wallet: use wallet_*; sub-accounts: use sub_account_*. Never infer account types, identifiers, or write parameters.",
    "If a Tool returns a business or validation error, handle that result; do not retry through CLI."
  ].join(" ");
}

/** Shared reference content consumed by focused Skills in both repositories. */
export function skillRoutingMarkdown(): string {
  return `# AI Hub MCP Routing\n\nWhen AI Hub MCP is available, understand the request and call the exact MCP Tool directly. Use the CLI only when MCP is unavailable. Never retry an MCP business or validation failure through CLI.\n\n- **Market:** current price → \`market_get_last_price\`; normal ticker, depth, trades, or K lines → the matching \`*_summary\` Tool. Use raw market Tools only when the user explicitly requests raw or complete fields.\n- **Account:** one named asset → \`account_get_asset_balance\`; balance overview → \`account_list_balances\`.\n- **Spot/Margin writes:** call the matching \`*_prepare_*\` Tool, then wait for a new explicit user message before \`confirm_action\`.\n- **Wallet/Sub-account:** choose the exact \`wallet_*\` or \`sub_account_*\` Tool. Do not infer identifiers, account types, or write values.\n`;
}
