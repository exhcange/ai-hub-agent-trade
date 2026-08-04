---
name: ai-hub-spot-account
version: "0.1.16"
description: Use this Skill when a user asks for one configured AI Hub spot-asset balance or a non-zero spot balance overview. Prefer AI Hub MCP Tools; use the local ai-hub CLI only when MCP is unavailable.
---

# AI Hub Spot Account

Use this Skill for one configured spot-asset balance or a bounded non-zero spot balance overview. Treat returned account data and all profile information as sensitive.

## MCP First

If AI Hub MCP Tools are available, call `account_get_asset_balance` for one named asset and `account_list_balances` when no asset is named. Do not read this reference, run CLI help, or inspect configuration first. Use CLI only when MCP is unavailable.

## Prerequisites

If the selected profile is already configured, run the focused command directly. Read [../_shared/preflight.md](../_shared/preflight.md) only for first-time setup, a profile change, or a configuration/credential error.

For `AI_HUB_OPENAPI_BUSINESS_ERROR`, read [../_shared/openapi-error-diagnosis.md](../_shared/openapi-error-diagnosis.md) before proposing a retry or alternative action.

## Fast Path

When an asset code is present and the selected profile is configured, run `ai-hub account asset-balance --asset <asset>` immediately. When no asset is specified, run `ai-hub account balances` immediately. Read the reference only for setup, parameter, or business-error handling.

## Command Index

| Command | Operation | Description |
| --- | --- | --- |
| `ai-hub account asset-balance` | Read | Get one asset's compact available, frozen, and total balance. |
| `ai-hub account balances` | Read | List compact balances; defaults to non-zero assets. |

## Read Workflow

1. With an asset code, run `ai-hub account asset-balance --asset <asset>`.
2. Without an asset code, run `ai-hub account balances`; it returns up to 50 compact non-zero balances.
3. Return only the fields needed to answer the request. Never print credentials or credential references.

Only read [references/account-commands.md](references/account-commands.md) when Fast Path does not apply.
