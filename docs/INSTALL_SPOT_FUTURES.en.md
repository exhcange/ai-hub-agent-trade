# AI Hub Operation Manual — Spot and Futures

For first-time AI Hub users with npm installed. Local review copy; not synchronized to the live GitBook site.

## 01 Quick Start

Use this page to install the CLI and MCP packages and create a local connection profile for your platform.

### Prerequisites

* npm installed, with Node.js 20 or later.
* A publicly reachable HTTPS OpenAPI endpoint for your tenant.
* An API key and secret key with the permissions required for your workflow.
* Cursor, Claude Desktop, Claude Code, or Codex if you plan to use MCP.
* A Skills-compatible AI Agent client, or a client that can load a Skill folder manually, if you plan to use Skills.

{% hint style="warning" %}
Create a dedicated API credential for AI Hub and follow least privilege: read-only permissions for query workflows, and only the specific trading or wallet permissions required for orders, cancellations, or transfers.
{% endhint %}

{% stepper %}
{% step %}

### Install the CLI and MCP packages

```bash
npm install -g @aihubspot/agent-trade-cli @aihubspot/agent-trade-mcp
```

Verify the installation:

```bash
ai-hub --help
ai-hub-trade-mcp --help
```

{% endstep %}

{% step %}

### Create spot and Futures profiles

Create one profile for each product. Use spot for spot trading and futures for Futures. Replace both example URLs with the respective OpenAPI HTTPS endpoints supplied by your platform; do not use the website or App API address.

```bash
ai-hub config init
ai-hub config set --profile spot --product spot --openapi-base-url https://your-spot-openapi-domain
ai-hub config set-credentials --profile spot
ai-hub config set --profile futures --product futures --openapi-base-url https://your-futures-openapi-domain
ai-hub config set-credentials --profile futures
```

set-credentials prompts separately for the API key and secret key without echoing them. Configure each product's credentials locally; do not share them in chat.

Review the product markers and test public connectivity:

```bash
ai-hub config show --profile spot
ai-hub config show --profile futures
ai-hub market ping --profile spot
ai-hub futures ping --profile futures
ai-hub futures time --profile futures
```

Public endpoints require no credentials. Account and order queries require the selected profile's credentials.

{% endstep %}

{% step %}

### Run your first market queries

```bash
## Show a market summary.
ai-hub market ticker-summary --quote-asset USDT --limit 20 --profile spot

## Retrieve the ticker for one exact symbol.
ai-hub market ticker --symbol BTCUSDT --profile spot

## Retrieve price precision, quantity precision, and order minimums.
ai-hub market symbol-info --symbol BTCUSDT --profile spot
```

{% endstep %}
{% endstepper %}

### First Futures queries

Start with the public contract list, then query your account using the Futures credentials configured above.

```bash
ai-hub futures contracts --profile futures
ai-hub futures account assets --profile futures
ai-hub futures account positions --profile futures
```

`contracts` returns the exact contract identifiers and trading rules. `assets` returns account money with two-decimal display, while `positions` returns active positions with quantities in contracts. For a ticker, first choose a contract from the returned list; see the Futures examples in [Command Line](gitbook/03-command-line.md).

Next, register both profiles with the same client using the MCP chapter, and install spot and Futures guidance using the Skills chapter. Installing npm packages alone does not complete those steps.

### Next steps

* Use the terminal or scripts: [Command Line](gitbook/03-command-line.md)
* Connect an AI client: [MCP](gitbook/02-mcp.md)
* Install agent operating guidance: [Skills](gitbook/04-skills.md)


## 02 MCP

MCP (Model Context Protocol) lets supported AI clients call AI Hub as structured tools. AI Hub MCP runs only as a local `stdio` server and uses the CLI's locally configured profile and credentials.

### When to use MCP

* Query market data, orders, balances, and wallet information through natural language in Cursor, Claude Desktop, Claude Code, or Codex.
* Generate an exact preview for a trading or wallet action before the user gives final confirmation.
* Use bounded summaries, pagination, and search tools instead of sending complete market responses into the Agent context.

### Prerequisites

{% stepper %}
{% step %}

### Install the MCP package

```bash
npm install -g @aihubspot/agent-trade-mcp
```

{% endstep %}

{% step %}

### Create a profile and configure credentials

Configure credentials as described in [Quick Start](gitbook/01-quick-start.md).
{% endstep %}

{% step %}

### Install a supported client

Install Cursor, Claude Desktop, Claude Code, or Codex.
{% endstep %}
{% endstepper %}

### Connect and start

After the CLI profile is ready, run the setup command for the target client:

```bash
## Cursor
ai-hub-trade-mcp setup --client cursor --profile spot
ai-hub-trade-mcp setup --client cursor --profile futures

## Claude Desktop
ai-hub-trade-mcp setup --client claude-desktop --profile spot
ai-hub-trade-mcp setup --client claude-desktop --profile futures

## Claude Code
ai-hub-trade-mcp setup --client claude-code --profile spot
ai-hub-trade-mcp setup --client claude-code --profile futures

## Codex
ai-hub-trade-mcp setup --client codex --profile spot
ai-hub-trade-mcp setup --client codex --profile futures
```

`setup` registers the installed MCP package using its absolute Node runtime and entrypoint, so the client does not depend on a global PATH. Credentials are not written into the client configuration; the MCP server continues to read the selected profile from `~/.ai-hub/config.toml`.

After setup:

* **Cursor and Claude Desktop**: close and reopen the client.
* **Claude Code and Codex**: open a new session or refresh MCP configuration using the client workflow.
* Call `system_get_capabilities` in the client and verify `profile`, `toolset`, `responseMode`, and `serviceVersion`.

For Cursor and Claude Desktop, setup merges the existing JSON MCP configuration and creates a backup before the first change. For Claude Code and Codex, setup uses the respective official CLI to register the server.

You normally do not need to start the server yourself. The client starts it from its registered configuration. To run the local `stdio` server directly:

```bash
ai-hub-trade-mcp --profile spot
```

The process waits for an MCP client over standard input and output, so seeing no interactive terminal output is expected. To show usage:

```bash
ai-hub-trade-mcp --help
```

#### Multiple profiles

Create and register a separate profile for each platform connection:

```bash
ai-hub config set --profile merchant-a --openapi-base-url https://merchant-a-openapi.example
ai-hub config set-credentials --profile merchant-a
ai-hub-trade-mcp setup --client codex --profile merchant-a
```

The registered MCP name includes the profile, for example `aihub-merchant-a`, so tenant configurations are not confused.

### Default tools

MCP uses the default toolset and filters tools by the profile product. The following table describes spot capabilities; Futures capabilities appear at the end of this chapter. Write tools are exposed only when read-only mode is disabled.

| Module      | Default capability                                                                       | Notes                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Market      | Symbol overview, paged/searchable symbols, exact symbol rules                            | Broad requests return counts, samples, or pages; query an exact symbol only when you need precision. |
| Market      | Ticker, order-book summary, recent-trade summary, candle summary                         | Avoids repeating full market or depth payloads in the Agent context.                                 |
| Spot orders | Order lookup, open orders, fills                                                         | Read-only queries.                                                                                   |
| Spot orders | Market buy/sell, limit order, cancel, batch placement/cancellation                       | Uses `prepare` tools to generate previews; cannot submit directly.                                   |
| Wallet      | Transferable assets, transfer history, deposit history, deposit and withdrawal addresses | Read-only queries.                                                                                   |
| Wallet      | Universal transfer                                                                       | Uses a `prepare` tool to generate a preview; cannot submit directly.                                 |

Call `system_get_capabilities` to inspect the modules, read/write tool counts, profile, toolset, and response mode that are actually registered in the current session.

#### Recommended market tools

| User intent                   | Recommended tool                             | Avoid                                            |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------ |
| “What symbols are available?” | `market_get_symbol_overview`                 | Requesting the complete symbol list.             |
| “List USDT symbols”           | `market_list_symbols` with offset pagination | Loading rules for every symbol at once.          |
| “Find BTC symbols”            | `market_search_symbols`                      | Querying all symbols without a filter.           |
| “What is BTCUSDT precision?”  | `market_get_symbol_info`                     | Searching through a full symbol response.        |
| “Show market prices”          | `market_get_ticker_summary`                  | Reading unfiltered raw tickers for every market. |
| “Show the BTCUSDT book”       | `market_get_depth_summary`                   | Requesting unbounded raw depth.                  |

List and summary tools return 20 entries by default and accept at most 50 per request. Continue symbol browsing with `offset`. Supported candle intervals are `1min`, `5min`, `15min`, `30min`, `60min`, `1day`, `1week`, and `1month`.

#### Read result shape

Every read tool returns a stable envelope:

```json
{
  "ok": true,
  "data": {
    "dataType": "array",
    "items": [],
    "count": 0
  }
}
```

`dataType` can be:

* `array`: read the list from `items`; `count` is the number of entries.
* `object`: read the object from `value`.
* `scalar`: read the single value from `value`.
* `null`: the result is empty.

Do not depend on raw upstream OpenAPI nesting. Check `data.dataType` before reading result fields.

#### Write tools

MCP exposes preview-only `prepare` tools for writes, including:

* `spot_prepare_market_buy`
* `spot_prepare_market_sell`
* `spot_prepare_limit_order`
* `spot_prepare_cancel_order`
* `spot_prepare_batch_place_orders`
* `spot_prepare_batch_cancel_orders`
* `wallet_prepare_universal_transfer`

The required flow is: **prepare preview → show preview → wait for a new user confirmation message → `confirm_action`**. See [Security](gitbook/05-security.md).

### Advanced options

#### Toolset

| Toolset             | Use case                                                               | Description                                                                             |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `default` (default) | Everyday use | Exposes supported tools for the selected product; read-only mode hides writes. |
| `full` | Existing configuration compatibility | Exposes the same tools as default. |

Keep the default for most users:

```bash
ai-hub-trade-mcp setup --client codex --profile spot
ai-hub-trade-mcp setup --client codex --profile futures
```

Existing configurations can continue to specify full:

```bash
ai-hub-trade-mcp setup --client codex --profile spot --toolset full
ai-hub-trade-mcp setup --client codex --profile futures --toolset full
```

#### Response mode

| Response mode       | Description                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `compact` (default) | Text and structuredContent return the same parseable standard result. |
| `compat` | Retained compatibility name; current read output is the same as compact. |

Existing clients configured with compatibility mode can retain it:

```bash
ai-hub-trade-mcp setup --client codex --profile spot --response-mode compat
ai-hub-trade-mcp setup --client codex --profile futures --response-mode compat
```

#### Read-only mode

To expose queries but no orders, cancellations, or transfers, start MCP in read-only mode:

```bash
ai-hub-trade-mcp --profile spot --read-only
```

This mode does not register write-preview tools or `confirm_action`.

### Spot and Futures together

Choose the setup commands for the client you use and register both profiles. The client should show two MCP servers:

| MCP server | Profile product | Use for |
| --- | --- | --- |
| `aihub-spot` | `spot` | Existing spot capabilities and both directions of Spot/Futures transfer. |
| `aihub-futures` | `futures` | Futures market data, account/position queries, orders and trading settings. |

The profile's product determines the exposed tools. Explicit spot requests use the spot server; explicit Futures requests use the Futures server. An unspecified balance request queries both and shows separate components without adding totals. A missing server or failed query must not be silently replaced by the other product.

Call `system_get_capabilities` on each server and check `profile`, `productScope.product`, `readOnly` and `serviceVersion`. The `default` and `full` toolset names are compatibility aliases, not profile names. After updating the npm package, reload the MCP connection; fully restart the client if it keeps an old process. Switching an existing conversation alone may keep old code loaded.

#### Futures read tools

These tools can run without a write preview. Market tools need a configured endpoint; account and order tools also need Futures read credentials.

| Area | Tool | Use and key inputs |
| --- | --- | --- |
| Public | `futures_ping` | Check OpenAPI connectivity. |
| Public | `futures_time` | Read server time. |
| Public | `futures_contracts` | Browse contracts and rules; optional `contractName`, `limit`, `cursor`. Use the returned exact contract symbol. |
| Public | `futures_depth` | Read bids/asks for `contractName`, bounded by `limit`. |
| Public | `futures_ticker` | Read the 24-hour ticker for one `contractName`. |
| Public | `futures_index` | Read index price, mark price and funding data for `contractName`. |
| Public | `futures_klines` | Read candles for `contractName` and `interval`; optional `limit`. One hour is `1h`. |
| Account | `futures_assets` | Read account asset fields; optional margin `asset`. |
| Account | `futures_positions` | Read active positions; optional `contractName`, `asset`, `limit`. |
| Account | `futures_profit_history` | Read historical PnL/fees; optional contract, `fromId` and paired `startTime`/`endTime`. |
| Account | `futures_transactions` | Read asset transactions; required `symbol`, `beginTime`, `endTime`; optional `page`, `limit`, `type`. |
| Orders | `futures_order_detail` | Required `contractName` and exactly one of `orderId` or `clientOrderId`. |
| Orders | `futures_open_orders` | Read current ordinary orders; optional `contractName`, `limit`, `cursor`. |
| Orders | `futures_order_history` | Read historical ordinary orders for `contractName`; optional `fromId`, `limit`. |
| Orders | `futures_my_trades` | Read your fills for `contractName`; optional `fromId`, `limit`. |
| Orders | `futures_trigger_orders` | Read current conditional/TP/SL orders for `contractName`; optional `page`, `limit`. |

MCP uses camelCase input names such as `contractName`; CLI flags use kebab-case such as `--contract-name`. Amounts, quantities and IDs use strings where required by the tool schema; page sizes, page numbers and numeric enums use numbers.

Futures results use the same `dataType` envelope described above. A paged list is commonly an `object`: read `data.value.items` and its continuation metadata, rather than assuming that every list uses `dataType: "array"`. Follow the returned continuation with the same filters. See [Command Line](gitbook/03-command-line.md) for the exact pagination and time-range rules.

Asset money is displayed to two decimals. Order, fill and position quantities marked `quantityUnit: "contracts"` use contracts; only the listed `quantityFields` receive that unit. Preserve separate equity, margin and unrealized PnL fields instead of computing a new total.

#### Futures write tools

The following ten tools prepare a preview. They do not submit the exchange write during preparation.

| Tool | Action and preview focus |
| --- | --- |
| `futures_prepare_place_order` | Ordinary LIMIT/MARKET order: contract, open/close intent, quantity and unit, margin mode, price and client order ID. |
| `futures_prepare_place_condition_order` | Exchange-managed conditional order: ordinary order parameters plus trigger direction and price. |
| `futures_prepare_place_profit_loss_order` | Position TP/SL: contract, closing side and 1–5 trigger entries, each with quantity and execution type. |
| `futures_prepare_cancel_order` | Cancel one ordinary order by contract and exchange order ID. |
| `futures_prepare_cancel_all_orders` | Cancel all ordinary orders across the Futures account; requires `scope: "all-ordinary-orders"`. Excludes triggers and positions. |
| `futures_prepare_cancel_trigger_order` | Cancel selected trigger orders: contract and exactly one of `orderId`, `orderIds`, or `clientId`. |
| `futures_prepare_set_position_mode` | Account-wide one-way/hedge mode; the request still requires a contract. |
| `futures_prepare_set_margin_mode` | Cross/isolated margin mode for one contract. |
| `futures_prepare_adjust_position_margin` | Signed margin adjustment for one isolated position. |
| `futures_prepare_set_leverage` | Target leverage for one contract. |

For example, a request to preview a one-contract LIMIT open-long order can use `futures_prepare_place_order` with these arguments:

```json
{
  "contractName": "E-BTC-USDT",
  "intent": "open-long",
  "type": "LIMIT",
  "quantity": "1",
  "unit": "contracts",
  "marginMode": "isolated",
  "price": "60000"
}
```

This is an illustrative input, not a market recommendation. The server is already bound to the `futures` profile, so the input does not contain credentials or an endpoint. The Agent displays the returned preview and stops. After the user sends a new explicit confirmation, the Agent calls `confirm_action` on the **same server** using the returned confirmation ID and that user's confirmation text. Parameter changes require a new preview.

For all-cancel, the scope is all ordinary orders at execution time, including orders added after the preview. For conditional and TP/SL orders, the exchange manages triggering. These details must remain visible in the preview and must not be replaced by an Agent monitoring task.

#### Transfers use the spot server

The Futures transfer Skill calls these existing spot tools for both account-type directions `1 → 5` and `5 → 1`:

| Spot MCP tool | Purpose |
| --- | --- |
| `wallet_get_transferable_assets` | Query transferable funds for the source account type. |
| `wallet_get_universal_transfer_history` | Query transfer history for the selected direction. |
| `wallet_prepare_universal_transfer` | Preview a transfer with source, destination, coin and amount. |

A transfer preview is confirmed through `confirm_action` on `aihub-spot`. Registering a writable Futures server alone does not expose transfer writes; the spot server and spot API credential also need the relevant capability. First complete the account-pair verification in [Security](gitbook/05-security.md).

#### Enable query-only access

To persist read-only access for both products, add `--read-only` when registering each server. For example:

```bash
ai-hub-trade-mcp setup --client codex --profile spot --read-only
ai-hub-trade-mcp setup --client codex --profile futures --read-only
```

Use the client name appropriate to your installation. Read-only mode omits prepare tools and `confirm_action`. Without this option, supported writes are available through the preview/confirmation flow, subject to the API credential's permissions. Installing a Skill does not add a missing MCP permission.


## 03 Command Line

The CLI entrypoint is `ai-hub`. Run `ai-hub --help` to see all commands and parameters supported by your installed version.

Pass `--profile <name>` explicitly in scripts and Agent instructions to prevent calls from using the wrong tenant.

### Market data

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

### Account and order queries

```bash
## Get available, frozen, and total ETH balance.
ai-hub account asset-balance --asset ETH --profile spot

## Get one order.
ai-hub spot order get --symbol ETHUSDT --order-id <order-id> --profile spot

## Get open orders and fills.
ai-hub spot order open --symbol ETHUSDT --limit 20 --profile spot
ai-hub spot order fills --symbol ETHUSDT --limit 20 --profile spot
```

### Spot orders

The CLI deliberately avoids an ambiguous generic `volume` parameter. Use an explicit asset unit for the order type:

| Scenario       | Quantity parameter              | `ETHUSDT` example                         |
| -------------- | ------------------------------- | ----------------------------------------- |
| Market buy     | `--quote-amount`                | How much USDT to spend.                   |
| Market sell    | `--base-quantity`               | How much ETH to sell.                     |
| Limit buy/sell | `--base-quantity` and `--price` | How much ETH to trade and the USDT price. |

```bash
## Spend 100 USDT to market-buy ETH.
ai-hub spot order market-buy --symbol ETHUSDT --quote-amount 100 --profile spot

## Market-sell 0.5 ETH.
ai-hub spot order market-sell --symbol ETHUSDT --base-quantity 0.5 --profile spot

## Buy 1 ETH at a limit price of 1,800 USDT.
ai-hub spot order limit --symbol ETHUSDT --side BUY --base-quantity 1 --price 1800 --profile spot

## Sell all executable ETH; the preview shows the sellable quantity and any precision remainder.
ai-hub spot order sell-available --symbol ETHUSDT --profile spot
```

{% hint style="info" %}
A market buy accepts the quote amount to spend and cannot guarantee an exact base-asset amount. To buy exactly 1 ETH, use a limit order or first define the amount of USDT you are willing to spend.
{% endhint %}

### Cancel and batch operations

```bash
## Cancel one order.
ai-hub spot order cancel --symbol ETHUSDT --order-id <order-id> --profile spot

## Place a batch of orders. --orders is a JSON array; maximum 10 orders.
ai-hub spot order batch-place --symbol ETHUSDT --orders '[
  {"side":"BUY","type":"LIMIT","baseQuantity":"0.1","price":"1600"},
  {"side":"SELL","type":"LIMIT","baseQuantity":"0.1","price":"2000"}
]' --profile spot

## Cancel a batch. --order-ids is a JSON array; maximum 10 IDs.
ai-hub spot order batch-cancel --symbol ETHUSDT --order-ids '["<order-id-1>","<order-id-2>"]' --profile spot
```

Every write command creates a preview only. See [Security](gitbook/05-security.md) for confirmation.

### Wallet and universal transfer

```bash
## Get transferable assets in the spot account (account type 1).
ai-hub wallet transferable-assets --account-type 1 --profile spot

## Get a USDT deposit address and deposit history.
ai-hub wallet deposit-address --main-coin-symbol USDT --profile spot
ai-hub wallet deposit-history --page 1 --page-size 20 --profile spot

## Get transfer history from Spot to Derivatives.
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
## Transfer 10 USDT from Spot to Derivatives. This generates a preview only.
ai-hub wallet transfer \
  --from-account-type 1 \
  --to-account-type 5 \
  --coin-symbol USDT \
  --amount 10 \
  --profile spot
```

### Futures market data

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

### Futures assets and positions

Assets and positions are separate views of the Futures account. These queries require Futures read credentials.

```bash
## Get asset balances, or select one margin asset.
ai-hub futures account assets --profile futures
ai-hub futures account assets --asset USDT --profile futures

## Get current positions, optionally filtered by contract and margin asset.
ai-hub futures account positions --limit 20 --profile futures
ai-hub futures account positions --contract-name E-BTC-USDT --asset USDT --limit 20 --profile futures
```

| View | How to read the result |
| --- | --- |
| Assets | Keep account funds, locked funds, margin, equity and unrealized PnL as separate reported fields. Asset amounts use two decimal places; for example, `123.456` displays as `123.46`. |
| Positions | Shows active positions with a positive position quantity. Read contract, side, position ID, quantity, margin mode and leverage where returned. An empty list does not establish the account's mode or leverage. |
| Order/fill/position quantities | Fields marked with `quantityUnit: "contracts"` use contracts (张 in Chinese). For example, `volume: "124"` means 124 contracts. Price, money, IDs and market-volume fields do not inherit this unit. |

An unspecified-product request such as “show my balances” queries `spot` and `futures` and presents them separately. It does not add the two products together or add unrealized PnL to equity again. If one query fails, its result is unavailable and the combined view is incomplete; failure is not a zero balance.

#### Historical PnL and account transactions

```bash
## Get one bounded PnL page for a contract.
ai-hub futures account profit-history --contract-name E-BTC-USDT --limit 20 --profile futures

## Query USDT transactions for September 1, 2026, 00:00 through
## September 2, 2026, 00:00 UTC. Times are Unix milliseconds.
ai-hub futures account transactions --symbol USDT \
  --begin-time 1788220800000 --end-time 1788307200000 \
  --page 1 --limit 20 --profile futures
```

`profit-history` accepts optional `--contract-name`, `--from-id` and a paired `--start-time`/`--end-time`. It provides historical PnL and fee components where returned. `transactions` requires `--symbol` for the asset and both `--begin-time` and `--end-time`; it uses `--page`, with optional `--type`. Do not pass a contract name as the transaction asset.

Transactions include supported ordinary-account business such as apportionment, fee sharing, bonuses, public/private transfers and merchant risk-reserve sharing. The optional transaction type accepts `1`–`13` and `28`; use the platform's business-type definitions when selecting a type. Each explicit time range is limited to six calendar months. Pagination details appear at the end of this chapter.

### Futures order queries

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

### Futures ordinary orders

Use `trade place` for a LIMIT or MARKET order. Every command in this and the following write sections creates a preview only. Example prices and quantities illustrate syntax; select values that match your intention and the actual contract rules.

#### Specify open/close intent

| Intention | `--intent` | Order direction |
| --- | --- | --- |
| Open a long position | `open-long` | BUY + OPEN |
| Open a short position | `open-short` | SELL + OPEN |
| Close a long position | `close-long` | SELL + CLOSE |
| Close a short position | `close-short` | BUY + CLOSE |

“Buy” or “sell” alone does not specify whether to open or close. The account's current position mode still applies; an order request does not automatically change it.

#### Specify quantity and execution parameters

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
## Preview a LIMIT open-long order for 1 contract.
ai-hub futures trade place --contract-name E-BTC-USDT \
  --intent open-long --type LIMIT --quantity 1 --unit contracts \
  --margin-mode isolated --price 60000 --profile futures

## Preview a MARKET open-short order for 1 contract.
ai-hub futures trade place --contract-name E-BTC-USDT \
  --intent open-short --type MARKET --quantity 1 --unit contracts \
  --margin-mode isolated --profile futures

## Preview closing 1 contract of a long position at market.
## The position and chosen margin mode must match your account.
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

Do not execute this confirmation automatically as part of an order script. A different quantity, price or direction requires a new preview. See [Security](gitbook/05-security.md).

### Futures conditional orders and TP/SL

#### Conditional orders

`trade condition` submits an exchange-managed order containing a trigger price after confirmation. The exchange monitors the condition and triggers the order; the Agent does not watch prices and submit a new order later.

Use the ordinary order's contract, intent, quantity, unit, margin mode and type, plus:

| Parameter | Meaning |
| --- | --- |
| `--trigger-price` | Required positive trigger price. |
| `--trigger-type` | `3UP` for the upward trigger direction; `4DOWN` for the downward trigger direction. |
| `--price` | Execution limit price when type is LIMIT; omit for MARKET. The trigger price and execution limit price serve different purposes. |

```bash
## Preview opening long when the exchange's upward condition triggers.
ai-hub futures trade condition --contract-name E-BTC-USDT \
  --intent open-long --type LIMIT --quantity 1 --unit contracts \
  --margin-mode isolated --trigger-type 3UP \
  --trigger-price 65000 --price 65100 --profile futures
```

The trigger direction does not choose long/short or open/close; `--intent` does. This command does not expose `--time-in-force` or `--client-order-id`. Exchange trigger rules and market conditions determine triggering and execution; a trigger is not a guaranteed fill.

#### Position take-profit and stop-loss orders

`trade profit-loss` targets an existing position. Supply `--contract-name`, closing-order `--side`, and `--order-list` containing 1–5 entries. Closing a long uses `SELL`; closing a short uses `BUY`. AI Hub must identify one matching position and check each entry's quantity against that position.

| Field inside `--order-list` | Meaning |
| --- | --- |
| `triggerType` | Number `1` for stop loss; `2` for take profit. These enums differ from conditional-order `3UP`/`4DOWN`. |
| `type` | Number `1` for LIMIT; `2` for MARKET. |
| `volume` | Positive integer contract quantity as a string, for example `"1"`. |
| `triggerPrice` | Positive trigger price as a string. |
| `price` | Required string for LIMIT; omit for MARKET. |

```bash
## Preview a market stop loss and a market take profit for a long position.
ai-hub futures trade profit-loss --contract-name E-BTC-USDT --side SELL \
  --order-list '[
    {"triggerType":1,"type":2,"volume":"1","triggerPrice":"58000"},
    {"triggerType":2,"type":2,"volume":"1","triggerPrice":"68000"}
  ]' --profile futures
```

Review every entry before confirming. The trigger orders are submitted to the exchange together; this command does not promise OCO behavior or automatic cancellation of the sibling order. Query their returned IDs through the supported order queries.

### Futures cancellations

| Scenario | Command and scope |
| --- | --- |
| One ordinary order | `order cancel` requires a contract and exchange `orderId`. Query detail first if you only have a client ID. |
| All ordinary orders | `order cancel-all --scope all-ordinary-orders` targets all contracts in this Futures account at execution time. |
| One or several trigger orders | `order cancel-trigger` requires a contract and exactly one selector: `--order-id`, `--order-ids`, or `--client-id`. |

```bash
## Preview cancellation of one ordinary order.
ai-hub futures order cancel --contract-name E-BTC-USDT \
  --order-id <order-id> --profile futures

## Preview cancellation of all ordinary orders in the Futures account.
ai-hub futures order cancel-all --scope all-ordinary-orders --profile futures

## Preview cancellation of one trigger order.
ai-hub futures order cancel-trigger --contract-name E-BTC-USDT \
  --order-id <trigger-order-id> --profile futures

## Preview cancellation of explicitly selected trigger orders.
ai-hub futures order cancel-trigger --contract-name E-BTC-USDT \
  --order-ids '["<trigger-order-id-1>","<trigger-order-id-2>"]' --profile futures
```

Cancel-all does not accept a contract filter. Its preview shows the current observed ordinary-order count, but execution is not restricted to those previewed orders: ordinary orders added before execution may also be canceled. It excludes trigger orders and does not close positions. Use it only for an explicit request to cancel all ordinary Futures orders, then follow the same separate confirmation flow.

AI Hub accepts 1–50 unique IDs per trigger cancellation request; the exchange may impose further limits. It does not interpret an omitted selector as “all triggers.” Ordinary batch placement and selected ordinary batch cancellation are not supported in this Futures release and are not emulated by looping writes.

### Futures trading settings

All four settings create previews and require the same next-message confirmation as an order.

| Setting | Required parameters | Scope and checks |
| --- | --- | --- |
| Position mode | `--contract-name`, `--position-model 1` (one-way) or `2` (hedge) | Account-wide even though the API requires a contract. Existing positions or ordinary orders prevent the change. |
| Margin mode | `--contract-name`, `--margin-model 1` (cross) or `2` (isolated) | Selected contract; relevant existing positions or ordinary orders prevent the change. |
| Isolated position margin | `--position-id`, `--amount` | One owned, unfrozen isolated position. Positive adds margin; negative removes margin. The amount uses that position's margin asset and cannot be zero. |
| Leverage | `--contract-name`, `--now-level` | Selected contract; positive integer within its verified leverage range. |

```bash
## Preview changing account-wide position mode to hedge mode.
ai-hub futures trade position-mode --contract-name E-BTC-USDT \
  --position-model 2 --profile futures

## Preview changing this contract to isolated margin mode.
ai-hub futures trade margin-mode --contract-name E-BTC-USDT \
  --margin-model 2 --profile futures

## Preview adding 10 units of the position's margin asset.
ai-hub futures trade position-margin --position-id <position-id> \
  --amount 10 --profile futures

## Preview setting this contract's leverage to 5.
ai-hub futures trade leverage --contract-name E-BTC-USDT \
  --now-level 5 --profile futures
```

The Agent does not automatically cancel orders, close positions or change another setting to satisfy a prerequisite. If the current value cannot be verified, it must be described as unknown instead of inventing a current-to-target comparison. Exchange risk checks still apply at submission.

### Transfers between Spot and Futures

Both directions use the existing spot wallet commands and `--profile spot`. Account type `1` is Spot and `5` is Futures. Complete the one-time account-pair verification described in [Security](gitbook/05-security.md) before preparing a transfer.

```bash
## Read transferable assets on the Futures side through the spot API.
ai-hub wallet transferable-assets --account-type 5 --profile spot

## Preview transferring 10 USDT from Futures back to Spot.
ai-hub wallet transfer --from-account-type 5 --to-account-type 1 \
  --coin-symbol USDT --amount 10 --profile spot

## Read transfer history for the same direction.
ai-hub wallet transfer-history --from-account-type 5 --to-account-type 1 \
  --page 1 --page-size 20 --profile spot
```

For Spot to Futures, use `--from-account-type 1 --to-account-type 5`, as in the wallet example above. The transfer's confirmation also uses `--profile spot`. Futures account equity is not a substitute for a transferable-balance query.

### Futures pagination, time ranges and request frequency

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

See [the complete Futures operation mapping](gitbook/futures-operations.md) for the corresponding MCP names and HTTP operations.


## 04 Skills

Skills are Markdown operating rules for AI Agents. They tell an Agent when to call the `ai-hub` CLI, how to pass parameters, and when it must stop for human confirmation.

Skills and MCP are independent:

* Skills prefer matching MCP tools and use CLI when MCP is unavailable.
* MCP exposes local structured tools through `ai-hub-trade-mcp`.
* Both use the same local profile and write-confirmation boundary.
* Installing Skills does not configure MCP, and installing MCP does not install Skills.

### Install

Install the CLI and configure a profile first, then run:

```bash
npx skills add exhcange/ai-hub-agent-trade
```

For clients that do not support `npx skills`, load the `skills/` subdirectory from the [Skills repository](gitbook/07-links.md) manually.

Select your target client and all twelve spot/Futures ai-hub-* Skills during installation. This command installs both products from the same AI Hub repository; MCP registration and profile configuration remain separate steps.

### Available Skills

| Skill                          | Purpose                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| `ai-hub-spot`                  | Routes a request to the appropriate focused spot Skill.           |
| `ai-hub-spot-common`           | Markets, symbols, tickers, order books, trades, and candlesticks. |
| `ai-hub-spot-order`            | Spot order queries, placement, cancellation, and safety rules.    |
| `ai-hub-spot-account`          | Single-asset balance queries.                                     |
| `ai-hub-spot-deposit-withdraw` | Wallet, transfer, deposit, and withdrawal workflows.              |
| `ai-hub-spot-sub-account`      | Sub-account workflows.                                            |

### Recommended prompts

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

### Futures Skills

Install the six Futures Skills alongside the six spot Skills. The router selects the appropriate focused Skill; users do not need to memorize MCP tool names or CLI flags.

| Skill | Purpose | Information to provide |
| --- | --- | --- |
| `ai-hub-futures` | Recognizes Futures intent and routes to a focused Skill. | Product and intended query or action; resolve ambiguity before trading. |
| `ai-hub-futures-common` | Contracts, trading rules, depth, ticker, index/mark price, funding and candles. | Contract; candle interval or result limit where relevant. |
| `ai-hub-futures-account` | Assets, active positions, historical PnL and account transactions. | Asset or contract when filtering; dates for a time-range query. |
| `ai-hub-futures-order` | Ordinary order detail/open/history, user fills, current triggers and supported cancellations. | Contract, order ID and whether the order is ordinary or conditional; explicit scope for all-cancel. |
| `ai-hub-futures-trade` | Ordinary orders, conditional orders, position TP/SL and four trading settings. | Open/close and long/short intent, quantity and unit, margin mode, type, price/trigger price as applicable. Settings need a target value and contract or position ID. |
| `ai-hub-futures-transfer` | Transferable funds, history and Spot/Futures transfers through the spot API. | Direction, coin and amount; verified account pairing before the first transfer. |

#### Market data and contract rules

```text
Use AI Hub to find the BTC Futures contracts available on my platform.
Show E-BTC-USDT's contract multiplier, price precision, minimum order quantity and leverage range.
Show the first 20 bid and ask levels for E-BTC-USDT Futures.
Show the latest 20 one-hour candles for E-BTC-USDT Futures.
```

The Agent first resolves an exact contract if the name is ambiguous. It reports bounded data rather than loading every market or assuming that a spot symbol is a Futures contract.

#### Assets, positions and history

```text
Show my USDT Futures assets and current E-BTC-USDT positions. Display position quantities in contracts.
Show my Futures PnL records for E-BTC-USDT from September 1 to September 7, 2026, using UTC.
Show my USDT Futures account transactions for that same UTC period, starting with 20 entries.
Show my balances, with Spot and Futures presented separately.
```

The account Skill keeps money and contract quantities distinct. An asset query is not a position query; historical PnL is not a complete transaction ledger. For date ranges, specify the timezone or let the Agent clarify it. Each query range may span at most six calendar months.

#### Order queries and cancellations

```text
Show the current ordinary Futures orders for E-BTC-USDT, up to 20 entries.
Show my E-BTC-USDT Futures fills.
Show current conditional and TP/SL orders for E-BTC-USDT Futures.
Preview cancellation of ordinary Futures order <order-id> on E-BTC-USDT.
Preview cancellation of all ordinary orders across my Futures account. Wait for my next confirmation.
```

For a single cancellation, the Agent identifies the order category and exact ID. All-cancel means all ordinary orders across contracts at execution time; it does not cancel trigger orders or close positions. Selected trigger orders can be canceled together when their IDs are explicit.

#### Ordinary orders

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

#### Conditional orders and TP/SL

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

#### Trading settings

```text
Preview changing my Futures account to hedge position mode, using E-BTC-USDT for the required contract parameter.
Preview changing E-BTC-USDT to isolated margin mode.
Preview adding 10 USDT of margin to isolated position <position-id>.
Preview changing E-BTC-USDT leverage to 5.
```

The Agent verifies the relevant contract or position and explains the scope. Position mode is account-wide. Margin adjustments must use the position's actual margin asset. If positions or orders prevent a mode change, the Agent reports that prerequisite; it does not clear them automatically.

#### Spot/Futures transfers

```text
Show how much USDT I can transfer from Spot to Futures.
Preview transferring 10 USDT from Spot to Futures.
Preview transferring 10 USDT from Futures back to Spot.
Show the first 20 transfer records from Futures to Spot.
```

Both directions use `spot`, including the confirmation. The transfer Skill checks transferable funds and requires prior account-pair verification; two similarly named profiles alone do not prove that the accounts belong together.

#### Supported boundaries

Every state-changing example stops at the preview. Installing Skills does not bypass confirmation, API permissions, or a read-only MCP configuration. If an MCP write has an uncertain result, the Agent must not repeat it through CLI.

Public recent market trades, ordinary batch placement, selected ordinary batch cancellation and the all-contract ticker are outside this Futures release. Copy trading, KOL, grid, robot and WebSocket workflows remain excluded. Unsupported writes are not emulated by loops. Existing spot features remain available through the spot Skills.


## 05 Security

### Credential security

Create a dedicated API credential for AI Hub and follow least privilege.

* Public market reads do not require an API key.
* Account, order, and wallet reads require the relevant read permissions.
* Orders, cancellations, and transfers require the relevant trading or wallet permissions.
* Never upload API keys, secret keys, `~/.ai-hub/config.toml`, or terminal history to GitHub, a chat, or a shared document.
* Configure IP allowlists, scopes, and expiration when the platform supports them.

The current version stores credentials locally in `~/.ai-hub/config.toml`. The configuration directory uses mode `700` and the file uses mode `600`. `ai-hub config show` never prints secret values, but the security of the local account and disk remains the user's responsibility.

### Every write requires a second confirmation

Orders, cancellations, transfers, withdrawals, and sub-account changes follow this flow:

{% stepper %}
{% step %}

### Create a preview

The Agent or CLI validates the request and returns a **preview** only.
{% endstep %}

{% step %}

### Review the preview

The preview includes the action summary, `confirmationId`, and expiry time.
{% endstep %}

{% step %}

### Send an explicit confirmation

The Agent must stop and wait for a new, explicit user message sent **after** the preview.
{% endstep %}

{% step %}

### Confirm the action

Only after receiving that message may it use `confirmationId` to confirm.
{% endstep %}

{% step %}

### Note confirmation limits

A confirmation can be consumed once and expires after five minutes by default.
{% endstep %}
{% endstepper %}

CLI example:

```bash
## Step 1: create a preview only. No order is submitted.
ai-hub spot order market-sell \
  --symbol ETHUSDT \
  --base-quantity 0.5 \
  --profile spot

## Step 2: run only after a new, explicit user confirmation.
ai-hub confirm \
  --confirmation-id <confirmation-id> \
  --user-confirmation "yes" \
  --profile spot
```

MCP uses the same boundary: call a `*_prepare_*` tool, display the preview, and stop. Only after a new user confirmation message may the Agent call `confirm_action`. An Agent must not generate, infer, or reuse confirmation text on its own.

### Local preflight checks

Before a spot order preview is created, the system lazily loads and caches symbol rules for the profile, including price precision, quantity precision, and minimum-order constraints. The cache is valid for one hour. Known precision or minimum violations are rejected locally before a preview is generated.

Local checks are not a fill guarantee. Balances, prices, market conditions, and server-side risk rules can change. If a write returns an uncertain network result, do not retry automatically; verify the final result by client order ID or history first.

### Futures preview and confirmation

All ten Futures write operations follow the same boundary, including cancellations and the four trading settings. A request such as “place this order and confirm automatically” does not remove the requirement for a new confirmation message after the preview.

Review the actual returned preview before confirming:

| Action | What to check |
| --- | --- |
| Every Futures action | The `futures` profile, exact action, scope, confirmation ID and expiry. |
| Ordinary order | Contract, open/close and long/short intent, LIMIT/MARKET, quantity and unit, cross/isolated mode, price when applicable, client order ID. |
| Conditional order | All order parameters plus trigger direction, trigger price and execution price/type. The exchange manages triggering. |
| Position TP/SL | Target contract and matching position, closing side and every trigger entry, including quantity in contracts. |
| One ordinary/trigger cancellation | Correct order category, contract and exact ID or selected IDs. |
| All ordinary cancellations | Account-wide scope at execution time, current observed order count and its coverage limits. Triggers and positions are excluded. |
| Trading settings | Target mode/leverage or signed margin delta, affected account/contract/position, and current value only where verified. |
| Spot/Futures transfer | The `spot` profile, source and destination account types, asset, amount and source transferable balance. |

For example, after “preview an isolated LIMIT open-long order for 1 contract of E-BTC-USDT at 60000,” the Agent returns a preview and stops. The user can then send “Confirm this preview.” The Agent confirms that one preview. If the user instead changes the price or quantity, the Agent creates a new preview and waits again.

A confirmation is bound to the original profile, configuration, credentials and prepared request. Use it on that profile and only once. An expired preview needs to be prepared again; do not reuse an old confirmation or treat the original trading request as the later confirmation.

#### Futures preflight and scope

Futures order preparation checks the selected contract's rules, price precision and quantity bounds. Coin quantities must map exactly to whole contracts. Futures confirmation repeats the relevant preflight checks because conditions may have changed since the preview.

Position-mode changes affect the whole account and require no active positions or ordinary orders. Margin-mode changes apply to one contract and require no relevant positions or ordinary orders. Margin adjustments require an owned, unfrozen isolated position. TP/SL requires an identifiable matching position. Exchange restrictions still apply; these checks do not guarantee acceptance or execution.

The Agent must not cancel orders, close positions or change settings automatically to satisfy these prerequisites. If a current setting cannot be verified, it remains unknown in the preview. An empty position list must not be used to invent a current setting.

All-cancel executes against **all ordinary orders then present in the Futures account**, not a fixed list captured during preview. New ordinary orders can therefore fall within its scope. Confirm it only when that account-wide action matches the user's request.

#### Submission results and timeouts

A successful submission can report `accepted: true` with `executionVerified: false`. This means that the request was accepted; it does not establish that an order filled, a setting reached its target, or every order was canceled.

Futures writes are never automatically retried. For a timeout or another uncertain result:

1. Preserve the original order/operation identifiers and report that the result is unknown.
2. Use supported read-only evidence, such as ordinary order detail by the original client order ID. A missing current-list entry or a changed balance alone is insufficient proof.
3. If the result remains unknown, retain the unresolved state and seek authoritative platform/operator evidence. Do not create a replacement order, change the client ID, switch to CLI, or repeat a margin adjustment or transfer.

Unresolved writes persist locally and block overlapping writes until resolved with authoritative evidence. To inspect them without submitting an exchange write:

```bash
## Futures operations.
ai-hub futures operation-status --profile futures

## Spot/Futures transfers submitted through the spot profile.
ai-hub futures operation-status --profile spot --transfer
```

Normal query limits still apply during verification. Repeated polling does not make an unknown result safe to resend.

### Spot/Futures transfer verification

Both directions use the `spot` profile and spot-side API: `1 → 5` for Spot to Futures and `5 → 1` for Futures to Spot. Before the first transfer, independently verify that the profiles represent the intended same-user, same-tenant account pair. Then record a non-secret evidence identifier:

```bash
ai-hub config pair-products --evidence-id <non-secret-evidence-id> --operator-verified
```

This command records verification already performed by the operator; it does not prove account identity through an API. It also does not authorize a transfer. Each transfer still requires a source transferable-balance check, a complete preview and a new explicit confirmation on the spot profile.

Configure spot transfer permissions if transfers are needed; query-only MCP access does not expose the transfer preview or confirmation. Avoid granting withdrawal or unrelated permissions merely to enable Spot/Futures transfers.

Changing a profile endpoint clears its old endpoint-bound credentials. Configure the appropriate credentials locally and reverify the account pairing when its configuration changes. Do not copy credentials to a guessed endpoint.


## 06 FAQ

<details>

<summary>Why does <code>ai-hub-trade-mcp</code> appear to produce no output?</summary>

Without `--help`, `ai-hub-trade-mcp` starts a local `stdio` MCP server and waits for a client connection. It is not an interactive terminal program, so no output is expected.

```bash
ai-hub-trade-mcp --help
```

</details>

<details>

<summary>Why is “market-buy 1 ETH” rejected or treated as ambiguous?</summary>

Market buys use `quoteAmount`: the amount of quote asset to spend. For `ETHUSDT`, that is USDT. Because the market price changes, a market buy cannot guarantee that you receive exactly 1 ETH.

Say “spend 100 USDT to market-buy ETH,” or use a limit order with an exact ETH quantity and price. Market sells use a base-asset quantity, for example “market-sell 0.5 ETH.”

</details>

<details>

<summary>Why can I not use account type <code>2</code> to transfer from Spot to Derivatives?</summary>

`2` is an Isolated Margin account. Use `5` for a Derivatives account:

```bash
ai-hub wallet transfer --from-account-type 1 --to-account-type 5 --coin-symbol USDT --amount 10 --profile spot
```

</details>

<details>

<summary>Why does the Agent show a preview but not submit the order?</summary>

This is expected. A write action must wait for a new user confirmation message after the preview. Verify the symbol, side, amount, price, and account type, then explicitly confirm. Do not ask the Agent to auto-confirm.

</details>

<details>

<summary>Why do I not see newly released MCP capabilities?</summary>

Check the following in order:

{% stepper %}
{% step %}
Verify the installed version: `npm list -g --depth=0 | grep aihubspot`.
{% endstep %}

{% step %}
Run the relevant `ai-hub-trade-mcp setup` command again.
{% endstep %}

{% step %}
Restart Cursor or Claude Desktop, or open a new Claude Code/Codex session.
{% endstep %}

{% step %}
Call `system_get_capabilities` and inspect `serviceVersion`, `toolset`, and `responseMode`.
{% endstep %}
{% endstepper %}

</details>

<details>

<summary>How do I update the CLI, MCP, and Skills?</summary>

```bash
## Update the CLI and MCP packages.
npm install -g @aihubspot/agent-trade-cli@latest @aihubspot/agent-trade-mcp@latest

## Reinstall or update Skills. Exact update behavior depends on the Skills client.
npx skills add exhcange/ai-hub-agent-trade
```

After updating MCP, run `setup` again and restart or refresh the target AI client.

</details>

### Futures questions

<details>

<summary>Why are Futures tools missing, or only queries available?</summary>

Check that the installed CLI/MCP package includes the Futures extension, that profile `futures` has `product=futures`, and that it is registered as a separate MCP server. Install all six Futures Skills alongside the spot Skills. Call `system_get_capabilities` on `aihub-futures` to verify product, version and `readOnly`.

Read-only registration intentionally omits prepare tools and `confirm_action`. To enable supported writes, register without `--read-only` and ensure the API credential has the required permissions. Reload the connection after changes; if an old process remains, fully restart the client. Switching conversations alone may not restart MCP.

</details>

<details>

<summary>Why does the public Futures time endpoint return 10002?</summary>

`10002` is a not-logged-in error, not a timestamp. Check whether the configured base URL points to an App API instead of the platform's Futures OpenAPI. Public time and ping do not need a login or signature. Obtain the correct base URL from the platform rather than adding a login token or guessing a domain. Changing the endpoint clears its old credentials, which must then be configured locally again.

</details>

<details>

<summary>Can I use BTCUSDT directly as a Futures contract name?</summary>

Use `ai-hub futures contracts --profile futures` and select the exact returned `symbol`. A Futures identifier may be something like `E-BTC-USDT`; the available names depend on your platform. Do not assume that the spot pair `BTCUSDT` has the same Futures identifier.

</details>

<details>

<summary>Does an order quantity of 124 mean 124 coins?</summary>

In order, fill and position results marked with `quantityUnit: "contracts"`, 124 means 124 contracts (124 张). Only the fields listed in `quantityFields` use that unit. For placement, explicitly choose `contracts`, `coin` or `value`; the contract multiplier and order bounds still apply. Price, money and IDs never become contract quantities.

</details>

<details>

<summary>Does two-decimal asset display change order precision?</summary>

No. Asset money is rounded for the returned asset view, for example `123.456` becomes `123.46`. This does not change the exchange balance or the precision used to validate and submit orders. A displayed `0.00` can represent a small nonzero amount; use the dedicated transferable-balance check before transfers.

</details>

<details>

<summary>Why does the Agent ask whether I want to open or close?</summary>

Futures orders require both long/short direction and open/close intent. BUY can mean open-long or close-short; SELL can mean open-short or close-long. State the contract, intent, quantity with unit, margin mode and execution type. “Spend 100 USDT” also needs clarification if it could mean an order value or a margin budget.

</details>

<details>

<summary>Does the Agent need to stay online for a conditional order?</summary>

After confirmation successfully submits a conditional or TP/SL order, the exchange monitors its trigger. The Agent does not need to remain online to watch prices. A displayed preview alone has not submitted an order. The trigger price is distinct from a LIMIT execution price, and triggering does not guarantee a fill.

</details>

<details>

<summary>Does cancel-all also cancel TP/SL or close positions?</summary>

No. It targets all ordinary orders across the Futures account at execution time. It can include ordinary orders added after the preview, but excludes conditional/TP/SL orders and positions. Cancel selected trigger IDs through the trigger cancellation command; closing a position is a separate order with its own preview and confirmation.

</details>

<details>

<summary>Can Futures place or cancel several ordinary orders at once?</summary>

This release has no ordinary batch placement or selected ordinary batch cancellation. It supports one ordinary cancellation and account-wide ordinary cancel-all. Trigger cancellation supports explicitly selected IDs, with an AI Hub cap of 50, and a TP/SL request supports up to five entries. These do not provide ordinary batch trading, and the Agent does not simulate unsupported batch writes by looping.

</details>

<details>

<summary>Why can a margin-mode or position-mode change be rejected?</summary>

Position-mode changes are account-wide and require no active positions or ordinary orders. Margin-mode changes are limited to a contract and require no relevant positions or ordinary orders. The Agent will not automatically cancel or close anything to satisfy those conditions. Margin adjustments also require an owned, unfrozen isolated position, and leverage must fit the contract's allowed range.

</details>

<details>

<summary>Does a page with 20 records contain my entire history?</summary>

No. Follow the returned continuation for that query. A cursor may be an ID lower bound or a local snapshot token, while some lists use page numbers. A missing continuation does not prove complete upstream history. Each explicit time range is limited to six calendar months; see [Command Line](gitbook/03-command-line.md) for the supported fields on each query.

</details>

<details>

<summary>Can I retry when an order, setting change or transfer times out?</summary>

Do not resend it automatically. Timeout can mean the exchange executed the request but the response was lost. Preserve the original IDs, use supported read-only evidence and report an unknown result until it is established. A fresh client ID, another transport or a changed profile must not be used to bypass an unresolved operation. See [Security](gitbook/05-security.md).

</details>

<details>

<summary>Why does a Futures-to-Spot transfer use the spot profile?</summary>

Both directions use the existing spot-side transfer API, with account types `1` (Spot) and `5` (Futures). Transfer preview and confirmation therefore both use `spot`. First verify account pairing, then query source transferable funds. Futures write permission alone is insufficient if the spot MCP server is read-only or the spot API credential lacks transfer permission.

</details>

<details>

<summary>Why are Spot and Futures balances displayed separately?</summary>

Their fields have different meanings. Futures equity, margin and unrealized PnL must not be added together as independent balances, and the two products are not combined into one total. A failed query is reported as unavailable, so a partial result cannot look like a complete balance overview.

</details>


## 07 Links

### Projects and packages

* [AI Hub Agent Trade: CLI and MCP source](https://github.com/exhcange/ai-hub-agent-trade)
* [AI Hub Agent Skills: Skills source](https://github.com/exhcange/ai-hub-agent-trade/tree/main/skills)
* [CLI npm package: @aihubspot/agent-trade-cli](https://www.npmjs.com/package/@aihubspot/agent-trade-cli)
* [MCP npm package: @aihubspot/agent-trade-mcp](https://www.npmjs.com/package/@aihubspot/agent-trade-mcp)

### Local help

Use the local help output from your installed version as the final reference for commands and parameters:

```bash
ai-hub --help
ai-hub-trade-mcp --help
```

### Documentation version note

{% hint style="info" %}
This guide describes commonly released capabilities. If documentation differs from the CLI or MCP behavior, defer to the latest GitHub source, the npm package version, and your local `--help` output.
{% endhint %}


### Futures

- [Futures OpenAPI](https://exchangedocsv2.gitbook.io/open-api-doc-v2/futures)
- [Futures operation mapping](gitbook/futures-operations.md)
