---
name: ai-hub-spot
version: "0.1.17"
description: Use this Skill for supported AI Hub spot-market, account, order, wallet, or sub-account requests. Prefer the matching AI Hub MCP Tool; use the local ai-hub CLI only when MCP is unavailable. Enforce the preview and new-user-confirmation boundary for every state-changing operation. Do not use for unsupported products or capabilities.
---

# AI Hub Spot

Route supported spot-account requests to the matching MCP Tool when AI Hub MCP is available. Use the `ai-hub` CLI only as an MCP fallback. Do not invent commands or capabilities outside the installed integration.

## MCP First

When AI Hub MCP Tools are available, call the exact matching MCP Tool immediately. Do not load a focused Skill, CLI reference, `ai-hub --help`, or `config show` first. For writes, call only the matching `prepare_*` Tool, then stop for a new user message before `confirm_action`.

Read [../_shared/mcp-routing.md](../_shared/mcp-routing.md) for the shared direct MCP selection rules.

When MCP is unavailable, use the focused CLI command through its Fast Path. Load a reference only for setup, missing or ambiguous parameters, or an API error.

## Prerequisites

When the selected profile is already configured, execute the focused command directly. Read [../_shared/preflight.md](../_shared/preflight.md) only for first-time setup, a profile change, or a configuration/credential error. Public market requests can use the common Skill directly.

## Fast Path

When the request maps to one installed CLI command and all required parameters are present, execute that focused command immediately. Do not load routing references or another Skill first. Load additional instructions only for missing or ambiguous parameters, setup or credential errors, business errors, or an uncertain write result.

## Routing

| User intent | MCP Tool / CLI fallback |
| --- | --- |
| View asset balances | `account_list_balances` / `ai-hub account balances` |
| View one asset such as USDT | `account_get_asset_balance` / `ai-hub account asset-balance --asset USDT` |
| View BTC price | `market_get_last_price` / `ai-hub market price --symbol BTCUSDT` |
| View open spot orders | `spot_get_open_orders` / `ai-hub spot order open` |
| Other market, order, wallet, or sub-account work | Matching focused MCP Tool / matching focused CLI Skill |

## Safety Boundary

Execute read-only MCP Tools directly when available. For every state-changing MCP action, use its `prepare_*` Tool, stop, and wait for a new explicit user message before `confirm_action`. When MCP is unavailable, use the same boundary through CLI preview and `ai-hub confirm`. Never supply or infer the confirmation.

## Business Failures

If a command returns `AI_HUB_OPENAPI_BUSINESS_ERROR`, treat it as a failed operation. Read [../_shared/openapi-error-diagnosis.md](../_shared/openapi-error-diagnosis.md), follow the returned `suggestedAction`, and preserve the upstream code and message.

## Configuration

Use the CLI profile commands before the first authenticated request:

```bash
ai-hub config init
ai-hub config set --profile default --openapi-base-url https://your-openapi-domain
ai-hub config set-credentials --profile default
```

The API key and secret key are saved as plaintext in `~/.ai-hub/config.toml` with mode `600`; never copy them into a prompt, command argument, or source-controlled file.

Read [references/cli-routing.md](references/cli-routing.md) only when MCP is unavailable and the request does not map directly to one CLI command.
