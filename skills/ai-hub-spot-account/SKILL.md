---
name: ai-hub-spot-account
version: "0.1.12"
description: Use this Skill when a user asks for one configured AI Hub spot-asset balance. Use the local ai-hub CLI and require a configured credential profile.
---

# AI Hub Spot Account

Use this Skill for one configured spot-asset balance. Treat returned account data and all profile information as sensitive.

## Prerequisites

If the selected profile is already configured, run the focused command directly. Read [../_shared/preflight.md](../_shared/preflight.md) only for first-time setup, a profile change, or a configuration/credential error.

For `AI_HUB_OPENAPI_BUSINESS_ERROR`, read [../_shared/openapi-error-diagnosis.md](../_shared/openapi-error-diagnosis.md) before proposing a retry or alternative action.

## Fast Path

When the asset code is present and the selected profile is configured, run `ai-hub account asset-balance --asset <asset>` immediately. Read the reference only for setup, parameter, or business-error handling.

## Command Index

| Command | Operation | Description |
| --- | --- | --- |
| `ai-hub account asset-balance` | Read | Get one asset's compact available, frozen, and total balance. |

## Read Workflow

1. Require the requested asset code, then run `ai-hub account asset-balance --asset <asset>`.
2. Return only the fields needed to answer the request. Never print credentials or credential references.

Only read [references/account-commands.md](references/account-commands.md) when Fast Path does not apply.
