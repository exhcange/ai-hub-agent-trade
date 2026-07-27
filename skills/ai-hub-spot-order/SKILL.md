---
name: ai-hub-spot-order
version: 0.1.9
description: Use this Skill when a user asks to test, retrieve, list, buy, sell, place a limit order, batch-place, cancel, or batch-cancel supported AI Hub spot orders. Use the local ai-hub CLI with a configured credential profile. Every state-changing action requires an exact preview followed by a new manual user confirmation.
---

# AI Hub Spot Orders

Use this Skill only for supported spot order operations. Do not infer an order size, symbol, side, price, or order ID. For financial actions, preserve the exact values supplied by the user.

## Prerequisites

Read [../_shared/preflight.md](../_shared/preflight.md) before every workflow. Confirm that the target profile is configured and that the user has supplied all mandatory order fields.

For `AI_HUB_OPENAPI_BUSINESS_ERROR`, read [../_shared/openapi-error-diagnosis.md](../_shared/openapi-error-diagnosis.md). Never retry a failed or unknown write until the diagnosis permits it and the user starts a new confirmation flow.

## Command Index

| Command | Operation | Description |
| --- | --- | --- |
| `ai-hub spot order test` | Read-like validation | Validate one order without sending it to the matching engine. |
| `ai-hub spot order get` | Read | Get one order by symbol and order ID. |
| `ai-hub spot order open` | Read | List current open orders. |
| `ai-hub spot order fills` | Read | List fills for one symbol. |
| `ai-hub spot order market-buy` | Write | Spend an exact quote-asset amount at market. |
| `ai-hub spot order market-sell` | Write | Sell an exact base-asset quantity at market. |
| `ai-hub spot order limit` | Write | Place a limit BUY or SELL with a base-asset quantity and price. |
| `ai-hub spot order cancel` | Write | Cancel one supported spot order. |
| `ai-hub spot order batch-place` | Write | Place 1–10 orders for one symbol. |
| `ai-hub spot order batch-cancel` | Write | Cancel 1–10 orders for one symbol. |

## Read and Test Workflow

1. Use `test` when the user wants parameter validation without a matching-engine submission.
2. Use `get`, `open`, or `fills` to inspect an existing order or activity.
3. If a previous write has an unknown outcome, query by order ID or client order ID before any further action.

## Write Workflow

1. Use `market-buy` only for a market BUY with `--quote-amount`: this is the exact quote asset to spend. Never reinterpret a requested base-asset quantity as a quote amount.
2. Use `market-sell` only for a market SELL with `--base-quantity`: this is the exact base asset to sell.
3. Use `limit` for a limit BUY or SELL with `--base-quantity` and `--price`.
4. When the user asks to sell all available balance, query the available balance and the symbol rules first. Do not silently round a quantity that exceeds the supported precision; state the executable quantity and obtain a new user instruction for it.
5. Run the write command once. It prints an exact preview and `executed: false`.
6. Stop. The user must inspect the preview and enter `yes` as a new manual interactive-terminal response.
7. Never type, pipe, generate, or infer `yes`. Never use `--confirm`; it is intentionally rejected.
8. Do not automatically retry an uncertain result. Query the order first.

Read [references/order-commands.md](references/order-commands.md) for parameters, batch JSON, and examples.
