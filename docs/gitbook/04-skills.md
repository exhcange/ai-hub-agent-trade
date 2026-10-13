# 04 Skills

Skills are Markdown operating rules for AI Agents. They tell an Agent when to call the `ai-hub` CLI, how to pass parameters, and when it must stop for human confirmation.

Skills and MCP are independent:

* Skills prefer matching MCP tools and use CLI when MCP is unavailable.
* MCP exposes local structured tools through `ai-hub-trade-mcp`.
* Both use the same local profile and write-confirmation boundary.
* Installing Skills does not configure MCP, and installing MCP does not install Skills.

## Install

Install the CLI and configure a profile first, then run:

```bash
npx skills add exhcange/ai-hub-agent-trade
```

For clients that do not support `npx skills`, load the `skills/` subdirectory from the [Skills repository](07-links.md) manually.

Select your target client and all twelve spot/Futures ai-hub-* Skills during installation. This command installs both products from the same AI Hub repository; MCP registration and profile configuration remain separate steps.

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
Use AI Hub to show my available ETH balance with profile spot.
```

```
Use AI Hub to market-buy ETH with 100 USDT. Show an order preview first and wait for my next message before confirmation.
```

Avoid ambiguous wording:

* Do not say “market-buy 1 ETH.”
* Say “spend 100 USDT to market-buy ETH.”
* Use a base-asset quantity only for market sells, for example “market-sell 0.5 ETH.”

## Futures Skills

Install the six Futures Skills alongside the six spot Skills. The router selects the appropriate focused Skill; users do not need to memorize MCP tool names or CLI flags.

| Skill | Purpose | Information to provide |
| --- | --- | --- |
| `ai-hub-futures` | Recognizes Futures intent and routes to a focused Skill. | Product and intended query or action; resolve ambiguity before trading. |
| `ai-hub-futures-common` | Contracts, trading rules, depth, ticker, index/mark price, funding and candles. | Contract; candle interval or result limit where relevant. |
| `ai-hub-futures-account` | Assets, active positions, historical PnL and account transactions. | Asset or contract when filtering; dates for a time-range query. |
| `ai-hub-futures-order` | Ordinary order detail/open/history, user fills, current triggers and supported cancellations. | Contract, order ID and whether the order is ordinary or conditional; explicit scope for all-cancel. |
| `ai-hub-futures-trade` | Ordinary orders, conditional orders, position TP/SL and four trading settings. | Open/close and long/short intent, quantity and unit, margin mode, type, price/trigger price as applicable. Settings need a target value and contract or position ID. |
| `ai-hub-futures-transfer` | Transferable funds, history and Spot/Futures transfers through the spot API. | Direction, coin and amount; verified account pairing before the first transfer. |

### Market data and contract rules

```text
Use AI Hub to find the BTC Futures contracts available on my platform.
Show E-BTC-USDT's contract multiplier, price precision, minimum order quantity and leverage range.
Show the first 20 bid and ask levels for E-BTC-USDT Futures.
Show the latest 20 one-hour candles for E-BTC-USDT Futures.
```

The Agent first resolves an exact contract if the name is ambiguous. It reports bounded data rather than loading every market or assuming that a spot symbol is a Futures contract.

### Assets, positions and history

```text
Show my USDT Futures assets and current E-BTC-USDT positions. Display position quantities in contracts.
Show my Futures PnL records for E-BTC-USDT from September 1 to September 7, 2026, using UTC.
Show my USDT Futures account transactions for that same UTC period, starting with 20 entries.
Show my balances, with Spot and Futures presented separately.
```

The account Skill keeps money and contract quantities distinct. An asset query is not a position query; historical PnL is not a complete transaction ledger. For date ranges, specify the timezone or let the Agent clarify it. Each query range may span at most six calendar months.

### Order queries and cancellations

```text
Show the current ordinary Futures orders for E-BTC-USDT, up to 20 entries.
Show my E-BTC-USDT Futures fills.
Show current conditional and TP/SL orders for E-BTC-USDT Futures.
Preview cancellation of ordinary Futures order <order-id> on E-BTC-USDT.
Preview cancellation of all ordinary orders across my Futures account. Wait for my next confirmation.
```

For a single cancellation, the Agent identifies the order category and exact ID. All-cancel means all ordinary orders across contracts at execution time; it does not cancel trigger orders or close positions. Selected trigger orders can be canceled together when their IDs are explicit.

### Ordinary orders

```text
Preview an isolated-margin LIMIT open-long order for 1 contract of E-BTC-USDT at 60000.
Preview an isolated-margin MARKET open-short order for 1 contract of E-BTC-USDT.
Preview closing 1 contract of my isolated E-BTC-USDT long position at market.
```

These prices and quantities are syntax examples. The Agent reads contract rules, checks the request and shows the preview. It then stops until a new user confirmation arrives.

| Ambiguous request | Clearer request |
| --- | --- |
| “Buy 1 BTC Futures.” | Specify the exact contract, open-long or close-short, and whether `1` means one contract or one BTC. |
| “Open a position with 100 USDT.” | Specify whether 100 USDT means order value or a margin budget, plus direction, quantity basis and margin mode. The Agent must not assume leverage to convert a budget into an order. |
| “Close my BTC.” | Specify the Futures contract, long/short position, quantity in contracts and execution type. |
| “Set 5x.” | Specify the Futures contract and ask to preview a leverage change to 5. |

### Conditional orders and TP/SL

```text
Preview an isolated LIMIT open-long conditional order for 1 contract of E-BTC-USDT,
with upward trigger price 65000 and execution limit price 65100.
Submit the trigger order to the exchange only after my next confirmation.
```

```text
Preview a market stop loss at 58000 and a market take profit at 68000
for 1 contract of my existing E-BTC-USDT long position.
Show both trigger entries and wait for my next confirmation.
```

The exchange receives and monitors these trigger orders. The Skill does not arrange for the Agent to watch prices. Conditional direction, execution price and open/close intent are separate choices. Position TP/SL supports up to five entries and requires an identifiable matching position; do not assume one entry cancels another.

### Trading settings

```text
Preview changing my Futures account to hedge position mode, using E-BTC-USDT for the required contract parameter.
Preview changing E-BTC-USDT to isolated margin mode.
Preview adding 10 USDT of margin to isolated position <position-id>.
Preview changing E-BTC-USDT leverage to 5.
```

The Agent verifies the relevant contract or position and explains the scope. Position mode is account-wide. Margin adjustments must use the position's actual margin asset. If positions or orders prevent a mode change, the Agent reports that prerequisite; it does not clear them automatically.

### Spot/Futures transfers

```text
Show how much USDT I can transfer from Spot to Futures.
Preview transferring 10 USDT from Spot to Futures.
Preview transferring 10 USDT from Futures back to Spot.
Show the first 20 transfer records from Futures to Spot.
```

Both directions use `spot`, including the confirmation. The transfer Skill checks transferable funds and requires prior account-pair verification; two similarly named profiles alone do not prove that the accounts belong together.

### Supported boundaries

Every state-changing example stops at the preview. Installing Skills does not bypass confirmation, API permissions, or a read-only MCP configuration. If an MCP write has an uncertain result, the Agent must not repeat it through CLI.

Public recent market trades, ordinary batch placement, selected ordinary batch cancellation and the all-contract ticker are outside this Futures release. Copy trading, KOL, grid, robot and WebSocket workflows remain excluded. Unsupported writes are not emulated by loops. Existing spot features remain available through the spot Skills.
