---
name: ai-hub-spot-account
version: "0.1.11"
description: Use this Skill when a user asks to inspect the configured AI Hub spot account, retrieve balances or account information, review Spot/Derivatives transfer history, or transfer assets between Spot and Derivatives. Use the local ai-hub CLI and require a configured credential profile. Account transfers require the mandatory preview and new manual confirmation boundary.
---

# AI Hub Spot Account

Use this Skill for the configured account overview and account-level transfer history. Treat returned account data and all profile information as sensitive.

## Prerequisites

If the selected profile is already configured, run the focused command directly. Read [../_shared/preflight.md](../_shared/preflight.md) only for first-time setup, a profile change, or a configuration/credential error.

For `AI_HUB_OPENAPI_BUSINESS_ERROR`, read [../_shared/openapi-error-diagnosis.md](../_shared/openapi-error-diagnosis.md) before proposing a retry or alternative action.

## Command Index

| Command | Operation | Description |
| --- | --- | --- |
| `ai-hub account get` | Read | Get the signed account overview. |
| `ai-hub account asset-balance` | Read | Get one asset's compact available, frozen, and total balance. |
| `ai-hub account transfer-history` | Read | Query Spot/Derivatives transfer history. |
| `ai-hub account transfer` | Write | Transfer only between Spot and Derivatives. |

## Read Workflow

1. Use `ai-hub account asset-balance --asset <asset>` when the request is for one asset; use `account get` only when an account overview is needed.
2. Use transfer history with either a transfer ID or both account names.
3. Return only the fields needed to answer the request. Never print credentials or credential references.

## Transfer Workflow

1. Use only `EXCHANGE` (Spot) and `FUTURE` (Derivatives) as account names. For Spot to Derivatives, use `EXCHANGE -> FUTURE`; use the reverse for Derivatives to Spot.
2. Do not use numeric account types with this command. In particular, account type `2` is Isolated Margin, not Derivatives.
3. Use `ai-hub wallet transfer` for Isolated Margin, Cross Margin, or C2C transfers instead.
4. Explain the source account, destination account, asset, and amount before running the command.
5. Run the CLI command once and display its preview.
6. Stop and wait for a new explicit user message. Then run `ai-hub confirm --confirmation-id <id> --user-confirmation <message>` once; never provide or infer that message.
7. If the result is uncertain, query the transfer history rather than retrying.

Read [references/account-commands.md](references/account-commands.md) for command parameters and examples.
