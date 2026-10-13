# 03 Command Line

The CLI entrypoint is `ai-hub`. Run `ai-hub --help` to see all commands and parameters supported by your installed version.

Pass `--profile <name>` explicitly in scripts and Agent instructions to prevent calls from using the wrong tenant.

## Market data

| Goal                             | Example command                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Show symbol overview             | `ai-hub market symbols-overview --limit 20 --profile spot`                                 |
| Browse USDT symbols by page      | `ai-hub market symbols-list --quote-asset USDT --offset 0 --limit 20 --profile spot`       |
| Search symbols                   | `ai-hub market symbols-search --query BTC --limit 20 --profile spot`                       |
| Get precision and order minimums | `ai-hub market symbol-info --symbol BTCUSDT --profile spot`                                |
| Get one ticker                   | `ai-hub market ticker --symbol ETHUSDT --profile spot`                                     |
| Get an order-book summary        | `ai-hub market depth-summary --symbol BTCUSDT --limit 20 --profile spot`                   |
| Get a recent-trades summary      | `ai-hub market trades-summary --symbol BTCUSDT --limit 20 --profile spot`                  |
| Get a candle summary             | `ai-hub market klines-summary --symbol ETHUSDT --interval 60min --limit 20 --profile spot` |

List commands return 20 entries by default and accept at most 50 per request. Use `offset` to page through symbols; do not attempt to retrieve every symbol or a large historical dataset in one request.

## Account and order queries

```bash
# Get available, frozen, and total ETH balance.
ai-hub account asset-balance --asset ETH --profile spot

# Get one order.
ai-hub spot order get --symbol ETHUSDT --order-id <order-id> --profile spot

# Get open orders and fills.
ai-hub spot order open --symbol ETHUSDT --limit 20 --profile spot
ai-hub spot order fills --symbol ETHUSDT --limit 20 --profile spot
```

## Spot orders

The CLI deliberately avoids an ambiguous generic `volume` parameter. Use an explicit asset unit for the order type:

| Scenario       | Quantity parameter              | `ETHUSDT` example                         |
| -------------- | ------------------------------- | ----------------------------------------- |
| Market buy     | `--quote-amount`                | How much USDT to spend.                   |
| Market sell    | `--base-quantity`               | How much ETH to sell.                     |
| Limit buy/sell | `--base-quantity` and `--price` | How much ETH to trade and the USDT price. |

```bash
# Spend 100 USDT to market-buy ETH.
ai-hub spot order market-buy --symbol ETHUSDT --quote-amount 100 --profile spot

# Market-sell 0.5 ETH.
ai-hub spot order market-sell --symbol ETHUSDT --base-quantity 0.5 --profile spot

# Buy 1 ETH at a limit price of 1,800 USDT.
ai-hub spot order limit --symbol ETHUSDT --side BUY --base-quantity 1 --price 1800 --profile spot

# Sell all executable ETH; the preview shows the sellable quantity and any precision remainder.
ai-hub spot order sell-available --symbol ETHUSDT --profile spot
```

{% hint style="info" %}
A market buy accepts the quote amount to spend and cannot guarantee an exact base-asset amount. To buy exactly 1 ETH, use a limit order or first define the amount of USDT you are willing to spend.
{% endhint %}

## Cancel and batch operations

```bash
# Cancel one order.
ai-hub spot order cancel --symbol ETHUSDT --order-id <order-id> --profile spot

# Place a batch of orders. --orders is a JSON array; maximum 10 orders.
ai-hub spot order batch-place --symbol ETHUSDT --orders '[
  {"side":"BUY","type":"LIMIT","baseQuantity":"0.1","price":"1600"},
  {"side":"SELL","type":"LIMIT","baseQuantity":"0.1","price":"2000"}
]' --profile spot

# Cancel a batch. --order-ids is a JSON array; maximum 10 IDs.
ai-hub spot order batch-cancel --symbol ETHUSDT --order-ids '["<order-id-1>","<order-id-2>"]' --profile spot
```

Every write command creates a preview only. See [Security](05-security.md) for confirmation.

## Wallet and universal transfer

```bash
# Get transferable assets in the spot account (account type 1).
ai-hub wallet transferable-assets --account-type 1 --profile spot

# Get a USDT deposit address and deposit history.
ai-hub wallet deposit-address --main-coin-symbol USDT --profile spot
ai-hub wallet deposit-history --page 1 --page-size 20 --profile spot

# Get transfer history from Spot to Derivatives.
ai-hub wallet transfer-history --from-account-type 1 --to-account-type 5 --page 1 --page-size 20 --profile spot
```

Universal-transfer account types:

| Code | Account type                         |
| ---- | ------------------------------------ |
| `1`  | Spot                                 |
| `2`  | Isolated Margin; requires `--symbol` |
| `3`  | Cross Margin                         |
| `4`  | C2C                                  |
| `5`  | Derivatives                          |

{% hint style="warning" %}
`2` means Isolated Margin, not a derivatives account. Use `5` for derivatives.
{% endhint %}

```bash
# Transfer 10 USDT from Spot to Derivatives. This generates a preview only.
ai-hub wallet transfer \
  --from-account-type 1 \
  --to-account-type 5 \
  --coin-symbol USDT \
  --amount 10 \
  --profile spot
```

## Futures market data

Futures commands use `ai-hub futures` and `--profile futures`. Start with `contracts` and use the exact `symbol` returned by that list as `--contract-name`. `E-BTC-USDT` below is an example; availability, prices and order limits depend on your platform.

| Goal | Example command |
| --- | --- |
| Check connectivity | `ai-hub futures ping --profile futures` |
| Read server time | `ai-hub futures time --profile futures` |
| Browse contracts | `ai-hub futures contracts --limit 20 --profile futures` |
| Get one contract's rules | `ai-hub futures contracts --contract-name E-BTC-USDT --profile futures` |
| Read the order book | `ai-hub futures market depth --contract-name E-BTC-USDT --limit 20 --profile futures` |
| Read one contract's 24-hour ticker | `ai-hub futures market ticker --contract-name E-BTC-USDT --profile futures` |
| Read index price, mark price and funding data | `ai-hub futures market index --contract-name E-BTC-USDT --profile futures` |
| Read candles | `ai-hub futures market klines --contract-name E-BTC-USDT --interval 1h --limit 20 --profile futures` |

These are public reads and do not require API credentials. A valid Futures OpenAPI base URL is still required. Contract rules include the contract multiplier, margin asset, price precision, order bounds and leverage bounds; use the rules for the selected contract before preparing an order.

Futures candle intervals are `1min`, `5min`, `15min`, `30min`, `1h`, `1day`, `1week`, and `1month`. The one-hour value is `1h`. This command accepts `interval` and `limit`, without a start/end-time filter. Depth returns up to `limit` levels on each side.

## Futures assets and positions

Assets and positions are separate views of the Futures account. These queries require Futures read credentials.

```bash
# Get asset balances, or select one margin asset.
ai-hub futures account assets --profile futures
ai-hub futures account assets --asset USDT --profile futures

# Get current positions, optionally filtered by contract and margin asset.
ai-hub futures account positions --limit 20 --profile futures
ai-hub futures account positions --contract-name E-BTC-USDT --asset USDT --limit 20 --profile futures
```

| View | How to read the result |
| --- | --- |
| Assets | Keep account funds, locked funds, margin, equity and unrealized PnL as separate reported fields. Asset amounts use two decimal places; for example, `123.456` displays as `123.46`. |
| Positions | Shows active positions with a positive position quantity. Read contract, side, position ID, quantity, margin mode and leverage where returned. An empty list does not establish the account's mode or leverage. |
| Order/fill/position quantities | Fields marked with `quantityUnit: "contracts"` use contracts (张 in Chinese). For example, `volume: "124"` means 124 contracts. Price, money, IDs and market-volume fields do not inherit this unit. |

An unspecified-product request such as “show my balances” queries `spot` and `futures` and presents them separately. It does not add the two products together or add unrealized PnL to equity again. If one query fails, its result is unavailable and the combined view is incomplete; failure is not a zero balance.

### Historical PnL and account transactions

```bash
# Get one bounded PnL page for a contract.
ai-hub futures account profit-history --contract-name E-BTC-USDT --limit 20 --profile futures

# Query USDT transactions for September 1, 2026, 00:00 through
# September 2, 2026, 00:00 UTC. Times are Unix milliseconds.
ai-hub futures account transactions --symbol USDT \
  --begin-time 1788220800000 --end-time 1788307200000 \
  --page 1 --limit 20 --profile futures
```

`profit-history` accepts optional `--contract-name`, `--from-id` and a paired `--start-time`/`--end-time`. It provides historical PnL and fee components where returned. `transactions` requires `--symbol` for the asset and both `--begin-time` and `--end-time`; it uses `--page`, with optional `--type`. Do not pass a contract name as the transaction asset.

Transactions include supported ordinary-account business such as apportionment, fee sharing, bonuses, public/private transfers and merchant risk-reserve sharing. The optional transaction type accepts `1`–`13` and `28`; use the platform's business-type definitions when selecting a type. Each explicit time range is limited to six calendar months. Pagination details appear at the end of this chapter.

## Futures order queries

| Goal | Example command |
| --- | --- |
| Get an ordinary order by exchange ID | `ai-hub futures order detail --contract-name E-BTC-USDT --order-id <order-id> --profile futures` |
| Get an ordinary order by client ID | `ai-hub futures order detail --contract-name E-BTC-USDT --client-order-id <client-order-id> --profile futures` |
| Read current ordinary orders for a contract | `ai-hub futures order open --contract-name E-BTC-USDT --limit 20 --profile futures` |
| Read current ordinary orders across contracts | `ai-hub futures order open --limit 20 --profile futures` |
| Read historical ordinary orders | `ai-hub futures order history --contract-name E-BTC-USDT --limit 20 --profile futures` |
| Read your fills | `ai-hub futures order trades --contract-name E-BTC-USDT --limit 20 --profile futures` |
| Read current conditional and TP/SL orders | `ai-hub futures order triggers --contract-name E-BTC-USDT --page 1 --limit 20 --profile futures` |

Order detail requires a contract and exactly one of `--order-id` or `--client-order-id`. Preserve IDs as strings. History and fills require a contract and optionally accept `--from-id`. Your fills are private account records, not a public market recent-trades feed.

Ordinary order results retain the original status and add a readable `statusName`, such as `NEW`, `PART_FILLED`, `FILLED`, `CANCELED` or `PENDING_CANCEL`. An accepted placement is not proof of a fill, and a pending cancellation is not a completed cancellation. Query the specific order for its latest reported state.

## Futures ordinary orders

Use `trade place` for a LIMIT or MARKET order. Every command in this and the following write sections creates a preview only. Example prices and quantities illustrate syntax; select values that match your intention and the actual contract rules.

### Specify open/close intent

| Intention | `--intent` | Order direction |
| --- | --- | --- |
| Open a long position | `open-long` | BUY + OPEN |
| Open a short position | `open-short` | SELL + OPEN |
| Close a long position | `close-long` | SELL + CLOSE |
| Close a short position | `close-short` | BUY + CLOSE |

“Buy” or “sell” alone does not specify whether to open or close. The account's current position mode still applies; an order request does not automatically change it.

### Specify quantity and execution parameters

| Parameter | Meaning and rules |
| --- | --- |
| `--contract-name` | Exact contract identifier from `contracts`. |
| `--type` | `LIMIT` or `MARKET`. |
| `--quantity` | Positive quantity in the unit selected below. |
| `--unit contracts` | Number of contracts; must be a positive integer, such as `1`. |
| `--unit coin` | Coin quantity, such as `0.001`; must convert exactly to an integer number of contracts using the verified multiplier. AI Hub does not round it into a valid quantity. |
| `--unit value` | Order value in the asset identified by the contract rules. The exchange converts it to whole contracts by rounding down using its reference/execution price. This does not specify a margin budget or guarantee an exact final contract count. |
| `--margin-mode` | Explicitly use `cross` or `isolated`. |
| `--price` | Required for LIMIT; omit for MARKET. |
| `--time-in-force` | Optional for ordinary LIMIT orders: `IOC`, `FOK`, or `POST_ONLY`. Omit for MARKET. |
| `--client-order-id` | Optional identifier, at most 31 characters. If omitted, AI Hub generates one before the preview and keeps it for that submission. |

```bash
# Preview a LIMIT open-long order for 1 contract.
ai-hub futures trade place --contract-name E-BTC-USDT \
  --intent open-long --type LIMIT --quantity 1 --unit contracts \
  --margin-mode isolated --price 60000 --profile futures

# Preview a MARKET open-short order for 1 contract.
ai-hub futures trade place --contract-name E-BTC-USDT \
  --intent open-short --type MARKET --quantity 1 --unit contracts \
  --margin-mode isolated --profile futures

# Preview closing 1 contract of a long position at market.
# The position and chosen margin mode must match your account.
ai-hub futures trade place --contract-name E-BTC-USDT \
  --intent close-long --type MARKET --quantity 1 --unit contracts \
  --margin-mode isolated --profile futures
```

After reviewing one returned preview, stop and wait for a new explicit user confirmation. Only then run the corresponding confirmation command:

```bash
ai-hub confirm --profile futures \
  --confirmation-id <confirmation-id> \
  --user-confirmation "Confirm this preview"
```

Do not execute this confirmation automatically as part of an order script. A different quantity, price or direction requires a new preview. See [Security](05-security.md).

## Futures conditional orders and TP/SL

### Conditional orders

`trade condition` submits an exchange-managed order containing a trigger price after confirmation. The exchange monitors the condition and triggers the order; the Agent does not watch prices and submit a new order later.

Use the ordinary order's contract, intent, quantity, unit, margin mode and type, plus:

| Parameter | Meaning |
| --- | --- |
| `--trigger-price` | Required positive trigger price. |
| `--trigger-type` | `3UP` for the upward trigger direction; `4DOWN` for the downward trigger direction. |
| `--price` | Execution limit price when type is LIMIT; omit for MARKET. The trigger price and execution limit price serve different purposes. |

```bash
# Preview opening long when the exchange's upward condition triggers.
ai-hub futures trade condition --contract-name E-BTC-USDT \
  --intent open-long --type LIMIT --quantity 1 --unit contracts \
  --margin-mode isolated --trigger-type 3UP \
  --trigger-price 65000 --price 65100 --profile futures
```

The trigger direction does not choose long/short or open/close; `--intent` does. This command does not expose `--time-in-force` or `--client-order-id`. Exchange trigger rules and market conditions determine triggering and execution; a trigger is not a guaranteed fill.

### Position take-profit and stop-loss orders

`trade profit-loss` targets an existing position. Supply `--contract-name`, closing-order `--side`, and `--order-list` containing 1–5 entries. Closing a long uses `SELL`; closing a short uses `BUY`. AI Hub must identify one matching position and check each entry's quantity against that position.

| Field inside `--order-list` | Meaning |
| --- | --- |
| `triggerType` | Number `1` for stop loss; `2` for take profit. These enums differ from conditional-order `3UP`/`4DOWN`. |
| `type` | Number `1` for LIMIT; `2` for MARKET. |
| `volume` | Positive integer contract quantity as a string, for example `"1"`. |
| `triggerPrice` | Positive trigger price as a string. |
| `price` | Required string for LIMIT; omit for MARKET. |

```bash
# Preview a market stop loss and a market take profit for a long position.
ai-hub futures trade profit-loss --contract-name E-BTC-USDT --side SELL \
  --order-list '[
    {"triggerType":1,"type":2,"volume":"1","triggerPrice":"58000"},
    {"triggerType":2,"type":2,"volume":"1","triggerPrice":"68000"}
  ]' --profile futures
```

Review every entry before confirming. The trigger orders are submitted to the exchange together; this command does not promise OCO behavior or automatic cancellation of the sibling order. Query their returned IDs through the supported order queries.

## Futures cancellations

| Scenario | Command and scope |
| --- | --- |
| One ordinary order | `order cancel` requires a contract and exchange `orderId`. Query detail first if you only have a client ID. |
| All ordinary orders | `order cancel-all --scope all-ordinary-orders` targets all contracts in this Futures account at execution time. |
| One or several trigger orders | `order cancel-trigger` requires a contract and exactly one selector: `--order-id`, `--order-ids`, or `--client-id`. |

```bash
# Preview cancellation of one ordinary order.
ai-hub futures order cancel --contract-name E-BTC-USDT \
  --order-id <order-id> --profile futures

# Preview cancellation of all ordinary orders in the Futures account.
ai-hub futures order cancel-all --scope all-ordinary-orders --profile futures

# Preview cancellation of one trigger order.
ai-hub futures order cancel-trigger --contract-name E-BTC-USDT \
  --order-id <trigger-order-id> --profile futures

# Preview cancellation of explicitly selected trigger orders.
ai-hub futures order cancel-trigger --contract-name E-BTC-USDT \
  --order-ids '["<trigger-order-id-1>","<trigger-order-id-2>"]' --profile futures
```

Cancel-all does not accept a contract filter. Its preview shows the current observed ordinary-order count, but execution is not restricted to those previewed orders: ordinary orders added before execution may also be canceled. It excludes trigger orders and does not close positions. Use it only for an explicit request to cancel all ordinary Futures orders, then follow the same separate confirmation flow.

AI Hub accepts 1–50 unique IDs per trigger cancellation request; the exchange may impose further limits. It does not interpret an omitted selector as “all triggers.” Ordinary batch placement and selected ordinary batch cancellation are not supported in this Futures release and are not emulated by looping writes.

## Futures trading settings

All four settings create previews and require the same next-message confirmation as an order.

| Setting | Required parameters | Scope and checks |
| --- | --- | --- |
| Position mode | `--contract-name`, `--position-model 1` (one-way) or `2` (hedge) | Account-wide even though the API requires a contract. Existing positions or ordinary orders prevent the change. |
| Margin mode | `--contract-name`, `--margin-model 1` (cross) or `2` (isolated) | Selected contract; relevant existing positions or ordinary orders prevent the change. |
| Isolated position margin | `--position-id`, `--amount` | One owned, unfrozen isolated position. Positive adds margin; negative removes margin. The amount uses that position's margin asset and cannot be zero. |
| Leverage | `--contract-name`, `--now-level` | Selected contract; positive integer within its verified leverage range. |

```bash
# Preview changing account-wide position mode to hedge mode.
ai-hub futures trade position-mode --contract-name E-BTC-USDT \
  --position-model 2 --profile futures

# Preview changing this contract to isolated margin mode.
ai-hub futures trade margin-mode --contract-name E-BTC-USDT \
  --margin-model 2 --profile futures

# Preview adding 10 units of the position's margin asset.
ai-hub futures trade position-margin --position-id <position-id> \
  --amount 10 --profile futures

# Preview setting this contract's leverage to 5.
ai-hub futures trade leverage --contract-name E-BTC-USDT \
  --now-level 5 --profile futures
```

The Agent does not automatically cancel orders, close positions or change another setting to satisfy a prerequisite. If the current value cannot be verified, it must be described as unknown instead of inventing a current-to-target comparison. Exchange risk checks still apply at submission.

## Transfers between Spot and Futures

Both directions use the existing spot wallet commands and `--profile spot`. Account type `1` is Spot and `5` is Futures. Complete the one-time account-pair verification described in [Security](05-security.md) before preparing a transfer.

```bash
# Read transferable assets on the Futures side through the spot API.
ai-hub wallet transferable-assets --account-type 5 --profile spot

# Preview transferring 10 USDT from Futures back to Spot.
ai-hub wallet transfer --from-account-type 5 --to-account-type 1 \
  --coin-symbol USDT --amount 10 --profile spot

# Read transfer history for the same direction.
ai-hub wallet transfer-history --from-account-type 5 --to-account-type 1 \
  --page 1 --page-size 20 --profile spot
```

For Spot to Futures, use `--from-account-type 1 --to-account-type 5`, as in the wallet example above. The transfer's confirmation also uses `--profile spot`. Futures account equity is not a substitute for a transferable-balance query.

## Futures pagination, time ranges and request frequency

Where `--limit` is supported, it defaults to 20 and accepts at most 50. Each command exposes only its supported paging fields:

| Query | How to continue |
| --- | --- |
| Contracts and open ordinary orders | Copy the returned `continuation.cursor` to `--cursor`. It pages a local snapshot of that response, valid for five minutes and bound to the profile and filters. It does not establish that the exchange returned every record. |
| Historical PnL | Use returned `continuation.fromId` as `--from-id` when present. Do not calculate it from the last displayed row. |
| Ordinary order history and fills | Accept `--from-id` as an ID lower bound. A complete backward-history traversal is not guaranteed; do not invent a next cursor. |
| Transactions and trigger orders | Use returned `continuation.page` with the same filters and limit. A transaction page with no displayed rows can still have a next page. |
| Current positions | Supports a limit and filters, with no cursor. A truncated response is not a complete position list. |

A cursor tells the next query where to continue. It can be an ID or a snapshot token; it is not necessarily a page number. Follow the returned continuation and report truncation or missing coverage instead of claiming that all history was retrieved.

Supported time filters use Unix milliseconds. Supply both ends of a range and keep each range within six calendar months. AI Hub limits calls to the same Futures interface to at least one second apart; exchange limits can be stricter. Transient read failures may be retried once. Writes are never automatically retried, including after a timeout.

See [the complete Futures operation mapping](futures-operations.md) for the corresponding MCP names and HTTP operations.
