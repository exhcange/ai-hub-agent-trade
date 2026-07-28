# AI Hub Agent Trade MCP

Install with `npm install -g @aihubspot/agent-trade-mcp`, then start `ai-hub-trade-mcp --profile default`. The default Toolset exposes the focused market, spot-order, universal-transfer, and wallet-query workflows. Use `--toolset full` to expose every supported Core capability. Read responses use compact text by default; use `--response-mode compat` only for clients that require the legacy duplicated JSON text.

This package provides a local stdio MCP server. State-changing operations require a preview and a new explicit user confirmation.

It reads the same local profile as the CLI from `~/.ai-hub/config.toml`. The API key and secret key are stored as plaintext in that file with mode `600`; configure them once through `ai-hub config set-credentials --profile <name>`. Do not share this file.

## Client setup

Register the local stdio MCP server with one supported client. The setup command is the only client-configuration entry point in this phase:

```bash
ai-hub-trade-mcp setup --client cursor --profile default
ai-hub-trade-mcp setup --client claude-desktop --profile default
ai-hub-trade-mcp setup --client claude-code --profile default
ai-hub-trade-mcp setup --client codex --profile default
ai-hub-trade-mcp setup --client codex --profile default --toolset full
ai-hub-trade-mcp setup --client codex --profile default --response-mode compat
```

Setup registers the currently installed MCP binary through its absolute Node runtime and entrypoint path, so desktop clients do not depend on a global PATH or an unpublished `npx` package. Cursor and Claude Desktop configurations are merged with existing MCP servers through their JSON configurations. Claude Code and Codex are registered through their official CLIs; Claude Code uses user scope. Existing JSON configurations are validated, atomically updated, and backed up before their first modification. The setup command stores no API credentials; the MCP server continues to read its profile from `~/.ai-hub/config.toml`.

## Spot market-order units

Use `spot_prepare_market_buy` or `margin_prepare_market_buy` only with `quoteAmount` (for example, the exact USDT amount to spend for `ETHUSDT`). Use `spot_prepare_market_sell` or `margin_prepare_market_sell` only with `baseQuantity` (the exact ETH amount to sell for `ETHUSDT`). A market buy cannot guarantee an exact base-asset quantity; it must never reinterpret a requested base quantity as a quote amount.

Before any order preview, MCP lazily loads `/sapi/v2/symbols` once per local profile and caches the symbol rules for one hour in memory and an isolated local cache. Known quantity/price precision and limit-order minimum violations are rejected before confirmation.

## Read response

All read tools return `{ "ok": true, "data": ... }` in one of these stable forms:

- Arrays: `{ "dataType": "array", "items": [...], "count": 500 }`
- Objects: `{ "dataType": "object", "value": { ... } }`
- Scalars: `{ "dataType": "scalar", "value": "..." }`

MCP clients receive the full envelope in `structuredContent`, validated by each read tool's output schema. In the default `compact` mode, text contains only the response type plus safe list metadata (`count`, `returnedCount`, `totalCount`, `nextOffset`, or `truncated` when applicable), so the same JSON is not duplicated in the Agent context. Use `--response-mode compat` to also place the full envelope in text. Check `data.dataType` before formatting; do not infer raw OpenAPI nesting.

## Bounded market analysis

Use these tools for requests that would otherwise return a broad market payload:

- `market_get_symbol_overview`: counts by quote asset and a small sample. Use this first for a generic request to list trading pairs.
- `market_list_symbols`: a paged, optionally quote-asset-filtered list without order-rule metadata.
- `market_search_symbols`: required-keyword lookup with at most 50 basic matching rows. Do not use it for a generic pair list.
- `market_get_symbol_info`: exact precision and minimum order rules for one symbol only.
- `market_get_ticker_summary`: watchlist, gainers, losers, and quote-volume leaders under one total result budget (20 by default, 50 maximum).
- `market_get_depth_summary`: best bid/ask, spread, and up to 50 levels per side.
- `market_get_trades_summary`: price range, buy/sell statistics, and up to 50 recent trades.
- `market_get_klines_summary`: period change, high/low, latest candle, and up to 50 candles. It defaults to `60min`; formal intervals are `1min`, `5min`, `15min`, `30min`, `60min`, `1day`, `1week`, and `1month`.

The default Toolset exposes only these bounded forms. The `full` Toolset additionally exposes raw symbols, depth, trades, and kline responses for explicit advanced use. Every list is limited to 50 rows; raw symbols are paged with `offset` and `nextOffset`.
