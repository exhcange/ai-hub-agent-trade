---
name: ai-hub-futures-account
metadata:
  version: "0.1.30"
description: Query Futures assets, positions, historical PnL and account transactions.
---

# Ai Hub Futures Account

Use `futures_assets`, `futures_positions`, `futures_profit_history`, and `futures_transactions`. CLI equivalents are `ai-hub futures <operation> --profile futures` with the schema-required arguments.

Assets and positions are separate views of the same account endpoint. Preserve equity, margin, locked funds and unrealized PnL as distinct values. Do not compute available-to-close quantity or infer modes/leverage from an empty position list. Account snapshots may be stale and cannot alone establish the outcome of a margin change.

Resolve required time ranges before calling history tools; maximum six calendar months. Follow returned continuation fields. A missing continuation does not prove an entire history was retrieved. Never guess a cursor by taking the last displayed ID.

Normal transactions include types 1-13 and 28, including apportionment, fee sharing, bonus and public/private transfers. Do not add a filtering-scope notice to normal results. Report real truncation, missing data and failures.

## Quantity display

Order, fill and position quantities marked `quantityUnit: "contracts"` use contracts as their unit. Apply this only to the fields listed in `quantityFields`, not prices, money, IDs or market volume. In Chinese output label them with 张 (for example, 124 张), not "raw API value" or a coin unit. Display integer quantities without decimal padding; do not round fractional values into integers or convert them into coin amounts. Asset money keeps its separate two-decimal display rule.

## Execution boundary

Prefer the available MCP tool. Use CLI only if MCP is unavailable before dispatch; never retry a possibly submitted write through another transport. Profile configuration errors are not permission to choose a different account.

For every write, prepare, display the complete preview, stop, and wait for a NEW explicit user message before `confirm_action` or `ai-hub confirm --profile <original-profile> --confirmation-id <id> --user-confirmation <message>`. Never infer confirmation from the original request. Core binds the preview and permits one dispatch.

If the result is unknown, do not resend or create a replacement client ID. Use supported read-only evidence and report unresolved status when it cannot be established. Core limits same-interface calls to at least one second apart; do not evade limits with alternate processes or profiles.

Do not request or expose API credentials in chat. Configure credentials only through the local profile workflow.
