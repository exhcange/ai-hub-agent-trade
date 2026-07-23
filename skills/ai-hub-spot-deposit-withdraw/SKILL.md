---
name: ai-hub-spot-deposit-withdraw
description: Use this Skill when a user asks about AI Hub wallet assets, deposit history or addresses, withdrawal addresses or history, transferable assets, wallet transfer history, wallet transfers, or withdrawals. Use the local ai-hub CLI with a configured credential profile. Wallet transfers and withdrawals require the mandatory preview and new manual confirmation boundary.
---

# AI Hub Deposits and Withdrawals

Use this Skill for supported wallet operations. Treat asset balances, addresses, and transaction history as sensitive user data. Do not fabricate an address, network detail, account type, or transfer direction.

## Prerequisites

Read [../_shared/preflight.md](../_shared/preflight.md). Confirm the requested profile and credentials before running any command in this Skill.

For `AI_HUB_OPENAPI_BUSINESS_ERROR`, read [../_shared/openapi-error-diagnosis.md](../_shared/openapi-error-diagnosis.md). In particular, a withdrawal-history permission diagnosis requires an API-key permission change, not a retry.

## Command Index

| Command | Operation | Description |
| --- | --- | --- |
| `ai-hub wallet exchange-account` | Read | Get exchange account assets. |
| `ai-hub wallet transferable-assets` | Read | Get assets transferable from an account type. |
| `ai-hub wallet transfer-history` | Read | Get universal transfer history. |
| `ai-hub wallet deposit-history` | Read | Get deposit history. |
| `ai-hub wallet deposit-address` | Read | Get deposit addresses for a main coin. |
| `ai-hub wallet withdraw-address` | Read | Get withdrawal addresses for a main coin. |
| `ai-hub wallet withdraw-history` | Read | Get withdrawal request history. |
| `ai-hub wallet transfer` | Write | Transfer assets between account types. |
| `ai-hub wallet withdraw` | Write | Submit a withdrawal request. |

## Read Workflow

1. Identify whether the user needs an account asset, address, history, or transferable-asset query.
2. Require the main coin symbol for address queries and the account type for transferable-asset queries.
3. Return only the requested information. Never reformat an address in a way that can change it.

## Asset Movement Workflow

1. For a wallet transfer, collect source and destination account types, coin symbol, amount, and optional symbol exactly.
2. For a withdrawal, collect the withdrawal order ID, coin symbol, amount, exact address, and optional label. Do not infer a label or destination.
3. Show a plain-language summary before executing the command.
4. Run the command once. It prints the exact preview.
5. Stop. The user must enter a new manual `yes` in the interactive terminal. Never enter, pipe, or infer it.
6. If the write outcome is unknown, query its relevant history before any retry.

Read [references/wallet-commands.md](references/wallet-commands.md) for parameters and examples.
