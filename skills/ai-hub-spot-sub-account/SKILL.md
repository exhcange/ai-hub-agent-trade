---
name: ai-hub-spot-sub-account
version: "0.1.14"
description: Use this Skill when a user asks to list, inspect, create, configure, or transfer assets for supported AI Hub sub-accounts, including sub-account assets, API-key IP lists, and transfer histories. Use the local ai-hub CLI with a configured credential profile. Every state-changing sub-account action requires an exact preview and a new manual user confirmation.
---

# AI Hub Spot Sub-accounts

Use this Skill for supported sub-account operations only. Do not assume a sub-account identifier, account type, transfer type, API key, IP address, or status value.

## Prerequisites

If the selected profile is already configured, run the focused command directly. Read [../_shared/preflight.md](../_shared/preflight.md) only for first-time setup, a profile change, or a configuration/credential error.

## Fast Path

Run an exact read command immediately when its required parameters are present. For a complete write request, generate one preview and wait for a new confirmation. Load references only for incomplete, ambiguous, setup, or error cases.

For `AI_HUB_OPENAPI_BUSINESS_ERROR`, read [../_shared/openapi-error-diagnosis.md](../_shared/openapi-error-diagnosis.md). Do not substitute a different sub-account identifier or credential without a user decision.

## Command Index

| Command | Operation | Description |
| --- | --- | --- |
| `ai-hub sub-account list` | Read | List enabled sub-accounts. |
| `ai-hub sub-account assets` | Read | Get assets for one sub-account and account type. |
| `ai-hub sub-account api-key list` | Read | Get an API-key IP whitelist. |
| `ai-hub sub-account root-transfer-history` | Read | Get transfer history between root and sub-account. |
| `ai-hub sub-account internal-transfer-history` | Read | Get transfer history within a sub-account. |
| `ai-hub sub-account create` | Write | Create a virtual sub-account. |
| `ai-hub sub-account set-trading-status` | Write | Change a supported sub-account capability status. |
| `ai-hub sub-account api-key set-ip` | Write | Update an API-key IP whitelist. |
| `ai-hub sub-account api-key delete` | Write | Delete a sub-account API key. |
| `ai-hub sub-account root-transfer` | Write | Transfer between root and sub-account. |
| `ai-hub sub-account internal-transfer` | Write | Transfer within a sub-account. |

## Read Workflow

1. Retrieve the sub-account list before asking the user to choose an identifier when needed.
2. Validate that each requested account type, coin symbol, and transfer direction is explicit.
3. Use history queries to determine a previous action's outcome; never retry an uncertain write automatically.

## Write Workflow

1. Collect all required values and describe the precise effect, including sub-account ID, asset, amount, direction, capability status, API-key identifier, or IP address as applicable.
2. Run the state-changing command once and display the returned preview.
3. Stop and wait for a new explicit user message. Then run `ai-hub confirm --confirmation-id <id> --user-confirmation <message>` once.
4. Never enter `yes`, infer consent, or chain a follow-up state-changing action from the same instruction.

Only read [references/sub-account-commands.md](references/sub-account-commands.md) when Fast Path does not apply.
