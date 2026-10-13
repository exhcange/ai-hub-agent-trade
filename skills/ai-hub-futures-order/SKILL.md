---
name: ai-hub-futures-order
metadata:
  version: "0.1.20"
description: Query Futures orders and fills, or prepare ordinary and trigger cancellations.
---

# Ai Hub Futures Order

Read tools: `futures_order_detail`, `futures_open_orders`, `futures_order_history`, `futures_my_trades`, `futures_trigger_orders`. CLI uses `ai-hub futures <operation> --profile futures`.

Order detail requires exactly one orderId or clientOrderId plus contractName. A tradeId is a fill identity, not an orderId; trigger identities are separate from ordinary-order identities. Use the continuation returned by Core; do not guess page direction.

Cancellation tools are `futures_prepare_cancel_order`, `futures_prepare_cancel_all_orders` and `futures_prepare_cancel_trigger_order`. CLI uses `order cancel|cancel-all|cancel-trigger`. Full cancellation requires explicit user intent to cancel all ordinary Futures orders and `scope=all-ordinary-orders`. Its scope is the whole account at execution time, not just the preview IDs. It excludes triggers, positions and spot orders. Do not repeat full cancellation to drain newly created orders.

A missing current trigger may have triggered, filled or been cancelled. A filled ordinary order is not a successfully cancelled order. Never treat list disappearance as proof of cancellation.

## Quantity display

Order, fill and position quantities marked `quantityUnit: "contracts"` use contracts as their unit. Apply this only to the fields listed in `quantityFields`, not prices, money, IDs or market volume. In Chinese output label them with 张 (for example, 124 张), not "raw API value" or a coin unit. Display integer quantities without decimal padding; do not round fractional values into integers or convert them into coin amounts. Asset money keeps its separate two-decimal display rule.

## Execution boundary

Prefer the available MCP tool. Use CLI only if MCP is unavailable before dispatch; never retry a possibly submitted write through another transport. Profile configuration errors are not permission to choose a different account.

For every write, prepare, display the complete preview, stop, and wait for a NEW explicit user message before `confirm_action` or `ai-hub confirm --profile <original-profile> --confirmation-id <id> --user-confirmation <message>`. Never infer confirmation from the original request. Core binds the preview and permits one dispatch.

If the result is unknown, do not resend or create a replacement client ID. Use supported read-only evidence and report unresolved status when it cannot be established. Core limits same-interface calls to at least one second apart; do not evade limits with alternate processes or profiles.

Do not request or expose API credentials in chat. Configure credentials only through the local profile workflow.
