# AI Hub Agent Trade MCP

Install with `npm install -g @aihubspot/agent-trade-mcp`, then start `ai-hub-trade-mcp --profile default`.

This package provides a local stdio MCP server. State-changing operations require a preview and a new explicit user confirmation.

It reads the same local profile as the CLI from `~/.ai-hub/config.toml`. The API key and secret key are stored as plaintext in that file with mode `600`; configure them once through `ai-hub config set-credentials --profile <name>`. Do not share this file.

## Client setup

Register the local stdio MCP server with one supported client. The setup command is the only client-configuration entry point in this phase:

```bash
ai-hub-trade-mcp setup --client cursor --profile default
ai-hub-trade-mcp setup --client claude-desktop --profile default
ai-hub-trade-mcp setup --client claude-code --profile default
ai-hub-trade-mcp setup --client codex --profile default
```

Setup registers the currently installed MCP binary through its absolute Node runtime and entrypoint path, so desktop clients do not depend on a global PATH or an unpublished `npx` package. Cursor and Claude Desktop configurations are merged with existing MCP servers through their JSON configurations. Claude Code and Codex are registered through their official CLIs; Claude Code uses user scope. Existing JSON configurations are validated, atomically updated, and backed up before their first modification. The setup command stores no API credentials; the MCP server continues to read its profile from `~/.ai-hub/config.toml`.

## Spot market-order units

Use `spot_prepare_market_buy` or `margin_prepare_market_buy` only with `quoteAmount` (for example, the exact USDT amount to spend for `ETHUSDT`). Use `spot_prepare_market_sell` or `margin_prepare_market_sell` only with `baseQuantity` (the exact ETH amount to sell for `ETHUSDT`). A market buy cannot guarantee an exact base-asset quantity; it must never reinterpret a requested base quantity as a quote amount.

Before any order preview, MCP lazily loads `/sapi/v2/symbols` once per local profile and caches the symbol rules in memory for five minutes. Known quantity/price precision and limit-order minimum violations are rejected before confirmation.
