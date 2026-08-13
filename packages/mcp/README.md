# AI Hub Agent Trade MCP

Install with `npm install -g @aihubspot/agent-trade-mcp`, then start `ai-hub-trade-mcp --profile default`. Both `default` and `full` expose every supported Core capability; the names remain only for configuration compatibility. Read responses use one stable parseable envelope in both MCP text and structured content.

This package provides a local stdio MCP server. State-changing operations require a preview and a new explicit user confirmation.

Preview tools are annotated read-only because they only validate and persist an expiring local preview; they never submit an OpenAPI write. `confirm_action` remains destructive and always requires a new explicit user confirmation.

It reads the same local profile as the CLI from `~/.ai-hub/config.toml`. The API key and secret key are stored as plaintext in that file with mode `600`; configure them once through `ai-hub config set-credentials --profile <name>`. Do not share this file.

## Client setup

Register the local stdio MCP server with one supported client. The setup command is the only client-configuration entry point in this phase:

```bash
ai-hub-trade-mcp setup --client cursor --profile default
ai-hub-trade-mcp setup --client claude-desktop --profile default
ai-hub-trade-mcp setup --client claude-code --profile default
ai-hub-trade-mcp setup --client codex --profile default
ai-hub-trade-mcp setup --client openclaw --profile default
ai-hub-trade-mcp setup --client codex --profile default --toolset full
ai-hub-trade-mcp setup --client codex --profile default --response-mode compat
ai-hub-trade-mcp setup --client codex --profile default --read-only
```

Setup registers the currently installed MCP binary through its absolute Node runtime and entrypoint path, so desktop clients do not depend on a global PATH or an unpublished `npx` package. Cursor and Claude Desktop configurations are merged with existing MCP servers through their JSON configurations. Claude Code, Codex, and OpenClaw are registered through their official CLIs; Claude Code uses user scope. Existing JSON configurations are validated, atomically updated, and backed up before their first modification. The setup command stores no API credentials; the MCP server continues to read its profile from `~/.ai-hub/config.toml`.

Setup registers the default profile as `aihub`; a named profile becomes `aihub-<profile>`. Existing `ai-hub-trade-mcp*` registrations are kept and a migration note is printed, so remove the old registration manually only after confirming the new one works.

## Read-only mode

To expose queries while removing every order, cancellation, withdrawal, transfer, and other state-changing capability, start the server with:

```bash
ai-hub-trade-mcp --profile default --read-only
```

For a configured client, persist the same restriction through setup:

```bash
ai-hub-trade-mcp setup --client codex --profile default --read-only
```

Replace `codex` with `cursor`, `claude-desktop`, `claude-code`, or `openclaw` as needed. Read-only mode removes all `*_prepare_*` Tools and `confirm_action`; unavailable writes fail locally and do not send an OpenAPI request.

For OpenClaw, run setup on the machine that runs the OpenClaw Gateway and as the same operating-system user as that Gateway. The selected AI Hub profile must exist in that user's `~/.ai-hub/config.toml`. Verify the registration after setup:

```bash
openclaw mcp doctor aihub --probe
openclaw mcp reload
```

## Spot market-order units

Use `spot_prepare_market_buy` or `margin_prepare_market_buy` only with `quoteAmount` (for example, the exact USDT amount to spend for `ETHUSDT`). Use `spot_prepare_market_sell` or `margin_prepare_market_sell` only with `baseQuantity` (the exact ETH amount to sell for `ETHUSDT`). A market buy cannot guarantee an exact base-asset quantity; it must never reinterpret a requested base quantity as a quote amount.

Before any order preview, MCP lazily loads `/sapi/v2/symbols` once per local profile and caches the symbol rules for one hour in memory and an isolated local cache. Known quantity/price precision and limit-order minimum violations are rejected before confirmation.

## Advanced order types

`spot_prepare_limit_order` accepts `type: LIMIT|IOC|FOK|POST_ONLY` and sends that type directly to OpenAPI. `STOP` and `STOP_MARKET` have focused prepare tools: `spot_prepare_stop_limit_order`, `spot_prepare_stop_market_buy`, and `spot_prepare_stop_market_sell`. Conditional orders always require `triggerPrice`; STOP also requires `price`. STOP_MARKET BUY uses `quoteAmount`, while STOP_MARKET SELL uses `baseQuantity`.

Margin Tools support isolated and cross **spot margin only**. They do not support perpetuals, other non-spot products, or an explicit leverage multiplier such as `10x`. Every `margin_prepare_*` Tool requires `isolated: true` for isolated margin or `isolated: false` for cross margin. An Agent must ask for this mode instead of inferring it. Requests that include a leverage-multiplier field fail with `AI_HUB_MARGIN_LEVERAGE_MULTIPLIER_NOT_SUPPORTED`.

## Read response

Every read returns the same JSON object in `content.text` and `structuredContent`. Inspect `data.dataType`: arrays use `items` plus `count`, objects and scalars use `value`, and null uses `dataType: "null"`. Every read Tool publishes this output schema. `--response-mode` remains accepted for setup compatibility, but no longer changes the success envelope.

## Bounded market analysis

Use these tools for requests that would otherwise return a broad market payload:

- `market_get_symbol_overview`: counts by quote asset and a small sample. Use this first for a generic request to list trading pairs.
- `market_list_symbols`: a paged, optionally quote-asset-filtered list without order-rule metadata.
- `market_search_symbols`: required-keyword lookup with at most 50 basic matching rows. Do not use it for a generic pair list.
- `market_get_symbol_info`: exact precision and minimum order rules for one symbol only.
- `market_get_ticker_summary`: watchlist, gainers, losers, and quote-volume leaders under one total result budget (20 by default, 50 maximum).
- `market_get_last_price`: symbol, current last price, and timestamp only. Use this for a single-symbol current-price request.
- `market_get_depth_summary`: best bid/ask, spread, and up to 50 levels per side.
- `market_get_trades_summary`: price range, buy/sell statistics, and up to 50 recent trades.
- `market_get_klines_summary`: period change, high/low, latest candle, and up to 50 candles. It defaults to `60min`; formal intervals are `1min`, `5min`, `15min`, `30min`, `60min`, `1day`, `1week`, and `1month`.

All Toolsets expose bounded and advanced functions alike. Every list is limited to 50 rows; raw symbols are paged with `offset` and `nextOffset`.
