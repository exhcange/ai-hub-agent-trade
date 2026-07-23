---
name: ai-hub-spot-order
description: Use this Skill when a user asks to test, retrieve, list, place, batch-place, cancel, or batch-cancel supported AI Hub spot orders, including open orders and fills. Use the local ai-hub CLI with a configured credential profile. Order placement and cancellation require an exact preview followed by a new manual user confirmation.
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
| `ai-hub spot order place` | Write | Place one supported spot order. |
| `ai-hub spot order cancel` | Write | Cancel one supported spot order. |
| `ai-hub spot order batch-place` | Write | Place 1–10 orders for one symbol. |
| `ai-hub spot order batch-cancel` | Write | Cancel 1–10 orders for one symbol. |

## Read and Test Workflow

1. Use `test` when the user wants parameter validation without a matching-engine submission.
2. Use `get`, `open`, or `fills` to inspect an existing order or activity.
3. If a previous write has an unknown outcome, query by order ID or client order ID before any further action.

## Write Workflow

1. Confirm the exact symbol, side, order type, volume, price when required, and client order ID when supplied.
2. For a limit order, require a price. For a market order, reject a price instead of silently dropping it.
3. Run the write command once. It prints an exact preview and `executed: false`.
4. Stop. The user must inspect the preview and enter `yes` as a new manual interactive-terminal response.
5. Never type, pipe, generate, or infer `yes`. Never use `--confirm`; it is intentionally rejected.
6. Do not automatically retry an uncertain result. Query the order first.

Read [references/order-commands.md](references/order-commands.md) for parameters, batch JSON, and examples.
