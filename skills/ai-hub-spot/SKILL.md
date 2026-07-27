---
name: ai-hub-spot
version: "0.1.11"
description: Use this Skill for supported AI Hub spot-market, account, order, wallet, or sub-account requests. Route the request to the focused AI Hub Skill, use the local ai-hub CLI, and enforce the preview and new-user-confirmation boundary for every state-changing operation. Do not use for unsupported products or capabilities.
---

# AI Hub Spot

Route supported spot-account requests to the most specific Skill. Use the `ai-hub` CLI as the primary execution interface. Do not invent commands or capabilities outside the installed CLI.

## Prerequisites

When the selected profile is already configured, execute the focused command directly. Read [../_shared/preflight.md](../_shared/preflight.md) only for first-time setup, a profile change, or a configuration/credential error. Public market requests can use the common Skill directly.

## Routing

| User intent | Load this Skill |
| --- | --- |
| Price, symbols, depth, trades, or candles | [ai-hub-spot-common](../ai-hub-spot-common/SKILL.md) |
| Balance, account overview, or account transfer history | [ai-hub-spot-account](../ai-hub-spot-account/SKILL.md) |
| Test, inspect, place, cancel, or list spot orders | [ai-hub-spot-order](../ai-hub-spot-order/SKILL.md) |
| Deposit, withdrawal, wallet balance, wallet transfer, or address | [ai-hub-spot-deposit-withdraw](../ai-hub-spot-deposit-withdraw/SKILL.md) |
| Sub-account list, assets, API-key IP list, or transfer | [ai-hub-spot-sub-account](../ai-hub-spot-sub-account/SKILL.md) |

## Safety Boundary

Execute read-only commands after validating the parameters. For every state-changing action, produce the CLI preview, stop, and wait for a new explicit user message before separately invoking `ai-hub confirm`. Never supply that message or convert an initial request into approval.

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

Read [references/cli-routing.md](references/cli-routing.md) for the compact command map.
