# 04 Skills

Skills are Markdown operating rules for AI Agents. They tell an Agent when to call the `ai-hub` CLI, how to pass parameters, and when it must stop for human confirmation.

Skills and MCP are independent:

* Skills execute through the CLI.
* MCP exposes local structured tools through `ai-hub-trade-mcp`.
* Both use the same local profile and write-confirmation boundary.
* Installing Skills does not configure MCP, and installing MCP does not install Skills.

## Install

Install the CLI and configure a profile first, then run:

```bash
npx skills add exhcange/ai-hub-agent-skills
```

For clients that do not support `npx skills`, load the `skills/` subdirectory from the [Skills repository](07-links.md) manually.

## Available Skills

| Skill                          | Purpose                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| `ai-hub-spot`                  | Routes a request to the appropriate focused spot Skill.           |
| `ai-hub-spot-common`           | Markets, symbols, tickers, order books, trades, and candlesticks. |
| `ai-hub-spot-order`            | Spot order queries, placement, cancellation, and safety rules.    |
| `ai-hub-spot-account`          | Single-asset balance queries.                                     |
| `ai-hub-spot-deposit-withdraw` | Wallet, transfer, deposit, and withdrawal workflows.              |
| `ai-hub-spot-sub-account`      | Sub-account workflows.                                            |

## Recommended prompts

```
Use AI Hub to show the first 20 order-book levels for BTCUSDT.
```

```
Use AI Hub to show my available ETH balance with profile default.
```

```
Use AI Hub to market-buy ETH with 100 USDT. Show an order preview first and wait for my next message before confirmation.
```

Avoid ambiguous wording:

* Do not say “market-buy 1 ETH.”
* Say “spend 100 USDT to market-buy ETH.”
* Use a base-asset quantity only for market sells, for example “market-sell 0.5 ETH.”
