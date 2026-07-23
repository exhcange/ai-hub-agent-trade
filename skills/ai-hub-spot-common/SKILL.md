---
name: ai-hub-spot-common
description: Use this Skill when a user asks for AI Hub public spot market data, including connection status, server time, symbols, ticker data, order-book depth, recent trades, or candlesticks. Use the local ai-hub CLI, require no credentials for these commands, and route account or state-changing requests to the focused Skill.
---

# AI Hub Spot Common

Use this Skill for public spot market information. All commands in this Skill are read-only and may run without API credentials.

## Prerequisites

Confirm that the requested profile has the intended OpenAPI URL. Read [../_shared/preflight.md](../_shared/preflight.md) if the request expands to an authenticated or state-changing operation.

## Command Index

| Command | Description |
| --- | --- |
| `ai-hub market ping` | Test the configured OpenAPI connection. |
| `ai-hub market time` | Get server time. |
| `ai-hub market symbols` | List supported spot symbols. |
| `ai-hub market ticker` | Get ticker data, optionally filtered by symbol. |
| `ai-hub market depth` | Get order-book depth for one symbol. |
| `ai-hub market trades` | Get recent trades for one symbol. |
| `ai-hub market klines` | Get candlesticks for one symbol and interval. |

## Operating Flow

1. Identify the symbol and interval or limit when the command needs them.
2. Execute the read-only command immediately.
3. State whether the result is raw market data and avoid presenting it as investment advice.
4. Route balance, asset movement, sub-account, or order requests to the focused Skill.

If a public endpoint returns `AI_HUB_OPENAPI_BUSINESS_ERROR`, read [../_shared/openapi-error-diagnosis.md](../_shared/openapi-error-diagnosis.md). Use its `reason` and `suggestedAction`; do not infer a cause from the code alone.

Read [references/market-commands.md](references/market-commands.md) for parameters and examples.
