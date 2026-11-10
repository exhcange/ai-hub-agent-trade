# 03 Command Line

For one MCP server with shared Spot/Futures credentials and automatic domain derivation, see [Unified connections](unified-mcp.md). With a unified profile, use the same merchant profile for both products; separate-product examples remain valid for legacy installations.


The CLI entrypoint is `ai-hub`. Run `ai-hub --help` to see all commands and parameters supported by your installed version.

Pass `--profile <name>` explicitly in scripts and Agent instructions to prevent calls from using the wrong tenant.

## Market data

| Goal                             | Example command                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| Show symbol overview             | `ai-hub market symbols-overview --limit 20 --profile merchant`                                 |
| Browse USDT symbols by page      | `ai-hub market symbols-list --quote-asset USDT --offset 0 --limit 20 --profile merchant`       |
| Search symbols                   | `ai-hub market symbols-search --query BTC --limit 20 --profile merchant`                       |
| Get precision and order minimums | `ai-hub market symbol-info --symbol BTCUSDT --profile merchant`                                |
| Get one ticker                   | `ai-hub market ticker --symbol ETHUSDT --profile merchant`                                     |
| Get an order-book summary        | `ai-hub market depth-summary --symbol BTCUSDT --limit 20 --profile merchant`                   |
| Get a recent-trades summary      | `ai-hub market trades-summary --symbol BTCUSDT --limit 20 --profile merchant`                  |
| Get a candle summary             | `ai-hub market klines-summary --symbol ETHUSDT --interval 60min --limit 20 --profile merchant` |

List commands return 20 entries by default and accept at most 50 per request. Use `offset` to page through symbols; do not attempt to retrieve every symbol or a large historical dataset in one request.

## Account and order queries

```bash
# Get available, frozen, and total ETH balance.
ai-hub account asset-balance --asset ETH --profile merchant

# Get one order.
ai-hub spot order get --symbol ETHUSDT --order-id <order-id> --profile merchant

# Get open orders and fills.
ai-hub spot order open --symbol ETHUSDT --limit 20 --profile merchant
ai-hub spot order fills --symbol ETHUSDT --limit 20 --profile merchant
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
ai-hub spot order market-buy --symbol ETHUSDT --quote-amount 100 --profile merchant

# Market-sell 0.5 ETH.
ai-hub spot order market-sell --symbol ETHUSDT --base-quantity 0.5 --profile merchant

# Buy 1 ETH at a limit price of 1,800 USDT.
ai-hub spot order limit --symbol ETHUSDT --side BUY --base-quantity 1 --price 1800 --profile merchant

# Sell all executable ETH; the preview shows the sellable quantity and any precision remainder.
ai-hub spot order sell-available --symbol ETHUSDT --profile merchant
```

{% hint style="info" %}
A market buy accepts the quote amount to spend and cannot guarantee an exact base-asset amount. To buy exactly 1 ETH, use a limit order or first define the amount of USDT you are willing to spend.
{% endhint %}

## Cancel and batch operations

```bash
# Cancel one order.
ai-hub spot order cancel --symbol ETHUSDT --order-id <order-id> --profile merchant

# Place a batch of orders. --orders is a JSON array; maximum 10 orders.
ai-hub spot order batch-place --symbol ETHUSDT --orders '[
  {"side":"BUY","type":"LIMIT","baseQuantity":"0.1","price":"1600"},
  {"side":"SELL","type":"LIMIT","baseQuantity":"0.1","price":"2000"}
]' --profile merchant

# Cancel a batch. --order-ids is a JSON array; maximum 10 IDs.
ai-hub spot order batch-cancel --symbol ETHUSDT --order-ids '["<order-id-1>","<order-id-2>"]' --profile merchant
```

Every write command creates a preview only. See [Security](/broken/pages/7ebb6bf07cc7868aa211f3555719c9072f121b0a) for confirmation.

## Wallet and universal transfer

```bash
# Get transferable assets in the spot account (account type 1).
ai-hub wallet transferable-assets --account-type 1 --profile merchant

# Get a USDT deposit address and deposit history.
ai-hub wallet deposit-address --main-coin-symbol USDT --profile merchant
ai-hub wallet deposit-history --page 1 --page-size 20 --profile merchant

# Get transfer history from Spot to Derivatives.
ai-hub wallet transfer-history --from-account-type 1 --to-account-type 5 --page 1 --page-size 20 --profile merchant
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
  --profile merchant
```
