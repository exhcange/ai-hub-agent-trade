# 02 MCP

MCP (Model Context Protocol) lets supported AI clients call AI Hub as structured tools. AI Hub MCP runs only as a local `stdio` server and uses the CLI's locally configured profile and credentials.

## When to use MCP

* Query market data, orders, balances, and wallet information through natural language in Cursor, Claude Desktop, Claude Code, or Codex.
* Generate an exact preview for a trading or wallet action before the user gives final confirmation.
* Use bounded summaries, pagination, and search tools instead of sending complete market responses into the Agent context.

## Prerequisites

{% stepper %}
{% step %}

## Install the MCP package

```bash
npm install -g @aihubspot/agent-trade-mcp
```

{% endstep %}

{% step %}

## Create a profile and configure credentials

Configure credentials as described in [Quick Start](01-quick-start.md).
{% endstep %}

{% step %}

## Install a supported client

Install Cursor, Claude Desktop, Claude Code, or Codex.
{% endstep %}
{% endstepper %}

## Connect and start

After the CLI profile is ready, run the setup command for the target client:

```bash
# Cursor
ai-hub-trade-mcp setup --client cursor --profile spot
ai-hub-trade-mcp setup --client cursor --profile futures

# Claude Desktop
ai-hub-trade-mcp setup --client claude-desktop --profile spot
ai-hub-trade-mcp setup --client claude-desktop --profile futures

# Claude Code
ai-hub-trade-mcp setup --client claude-code --profile spot
ai-hub-trade-mcp setup --client claude-code --profile futures

# Codex
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

### Multiple profiles

Create and register a separate profile for each platform connection:

```bash
ai-hub config set --profile merchant-a --openapi-base-url https://merchant-a-openapi.example
ai-hub config set-credentials --profile merchant-a
ai-hub-trade-mcp setup --client codex --profile merchant-a
```

The registered MCP name includes the profile, for example `aihub-merchant-a`, so tenant configurations are not confused.

## Default tools

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

### Recommended market tools

| User intent                   | Recommended tool                             | Avoid                                            |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------ |
| “What symbols are available?” | `market_get_symbol_overview`                 | Requesting the complete symbol list.             |
| “List USDT symbols”           | `market_list_symbols` with offset pagination | Loading rules for every symbol at once.          |
| “Find BTC symbols”            | `market_search_symbols`                      | Querying all symbols without a filter.           |
| “What is BTCUSDT precision?”  | `market_get_symbol_info`                     | Searching through a full symbol response.        |
| “Show market prices”          | `market_get_ticker_summary`                  | Reading unfiltered raw tickers for every market. |
| “Show the BTCUSDT book”       | `market_get_depth_summary`                   | Requesting unbounded raw depth.                  |

List and summary tools return 20 entries by default and accept at most 50 per request. Continue symbol browsing with `offset`. Supported candle intervals are `1min`, `5min`, `15min`, `30min`, `60min`, `1day`, `1week`, and `1month`.

### Read result shape

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

### Write tools

MCP exposes preview-only `prepare` tools for writes, including:

* `spot_prepare_market_buy`
* `spot_prepare_market_sell`
* `spot_prepare_limit_order`
* `spot_prepare_cancel_order`
* `spot_prepare_batch_place_orders`
* `spot_prepare_batch_cancel_orders`
* `wallet_prepare_universal_transfer`

The required flow is: **prepare preview → show preview → wait for a new user confirmation message → `confirm_action`**. See [Security](05-security.md).

## Advanced options

### Toolset

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

### Response mode

| Response mode       | Description                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `compact` (default) | Text and structuredContent return the same parseable standard result. |
| `compat` | Retained compatibility name; current read output is the same as compact. |

Existing clients configured with compatibility mode can retain it:

```bash
ai-hub-trade-mcp setup --client codex --profile spot --response-mode compat
ai-hub-trade-mcp setup --client codex --profile futures --response-mode compat
```

### Read-only mode

To expose queries but no orders, cancellations, or transfers, start MCP in read-only mode:

```bash
ai-hub-trade-mcp --profile spot --read-only
```

This mode does not register write-preview tools or `confirm_action`.

## Spot and Futures together

Choose the setup commands for the client you use and register both profiles. The client should show two MCP servers:

| MCP server | Profile product | Use for |
| --- | --- | --- |
| `aihub-spot` | `spot` | Existing spot capabilities and both directions of Spot/Futures transfer. |
| `aihub-futures` | `futures` | Futures market data, account/position queries, orders and trading settings. |

The profile's product determines the exposed tools. Explicit spot requests use the spot server; explicit Futures requests use the Futures server. An unspecified balance request queries both and shows separate components without adding totals. A missing server or failed query must not be silently replaced by the other product.

Call `system_get_capabilities` on each server and check `profile`, `productScope.product`, `readOnly` and `serviceVersion`. The `default` and `full` toolset names are compatibility aliases, not profile names. After updating the npm package, reload the MCP connection; fully restart the client if it keeps an old process. Switching an existing conversation alone may keep old code loaded.

### Futures read tools

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

Futures results use the same `dataType` envelope described above. A paged list is commonly an `object`: read `data.value.items` and its continuation metadata, rather than assuming that every list uses `dataType: "array"`. Follow the returned continuation with the same filters. See [Command Line](03-command-line.md) for the exact pagination and time-range rules.

Asset money is displayed to two decimals. Order, fill and position quantities marked `quantityUnit: "contracts"` use contracts; only the listed `quantityFields` receive that unit. Preserve separate equity, margin and unrealized PnL fields instead of computing a new total.

### Futures write tools

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

### Transfers use the spot server

The Futures transfer Skill calls these existing spot tools for both account-type directions `1 → 5` and `5 → 1`:

| Spot MCP tool | Purpose |
| --- | --- |
| `wallet_get_transferable_assets` | Query transferable funds for the source account type. |
| `wallet_get_universal_transfer_history` | Query transfer history for the selected direction. |
| `wallet_prepare_universal_transfer` | Preview a transfer with source, destination, coin and amount. |

A transfer preview is confirmed through `confirm_action` on `aihub-spot`. Registering a writable Futures server alone does not expose transfer writes; the spot server and spot API credential also need the relevant capability. First complete the account-pair verification in [Security](05-security.md).

### Enable query-only access

To persist read-only access for both products, add `--read-only` when registering each server. For example:

```bash
ai-hub-trade-mcp setup --client codex --profile spot --read-only
ai-hub-trade-mcp setup --client codex --profile futures --read-only
```

Use the client name appropriate to your installation. Read-only mode omits prepare tools and `confirm_action`. Without this option, supported writes are available through the preview/confirmation flow, subject to the API credential's permissions. Installing a Skill does not add a missing MCP permission.
