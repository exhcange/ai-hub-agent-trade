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

Configure credentials as described in [Quick Start](./).
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
ai-hub-trade-mcp setup --client cursor --profile default

# Claude Desktop
ai-hub-trade-mcp setup --client claude-desktop --profile default

# Claude Code
ai-hub-trade-mcp setup --client claude-code --profile default

# Codex
ai-hub-trade-mcp setup --client codex --profile default
```

`setup` registers the installed MCP package using its absolute Node runtime and entrypoint, so the client does not depend on a global PATH. Credentials are not written into the client configuration; the MCP server continues to read the selected profile from `~/.ai-hub/config.toml`.

After setup:

* **Cursor and Claude Desktop**: close and reopen the client.
* **Claude Code and Codex**: open a new session or refresh MCP configuration using the client workflow.
* Call `system_get_capabilities` in the client and verify `profile`, `toolset`, `responseMode`, and `serviceVersion`.

For Cursor and Claude Desktop, setup merges the existing JSON MCP configuration and creates a backup before the first change. For Claude Code and Codex, setup uses the respective official CLI to register the server.

You normally do not need to start the server yourself. The client starts it from its registered configuration. To run the local `stdio` server directly:

```bash
ai-hub-trade-mcp --profile default
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

The registered MCP name includes the profile, for example `ai-hub-trade-mcp-merchant-a`, so tenant configurations are not confused.

## Default tools

MCP uses the `default` toolset unless you explicitly choose another one. It exposes the most common, bounded spot workflows, along with `system_get_capabilities` and `confirm_action`.

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
| `default` (default) | Everyday spot-agent workflows                                          | Registers focused market summaries, spot orders, wallet reads, and universal transfers. |
| `full`              | Advanced debugging or an explicit need for every currently public tool | Registers all public Core tools, increasing tool-selection cost and response context.   |

Keep the default for most users:

```bash
ai-hub-trade-mcp setup --client codex --profile default
```

Choose the full toolset only when required:

```bash
ai-hub-trade-mcp setup --client codex --profile default --toolset full
```

### Response mode

| Response mode       | Description                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `compact` (default) | Text includes only type, count, and a summary. The complete standard result remains in MCP structured content, reducing duplicate context. |
| `compat`            | Both text and structured content include full JSON. Use only for clients that require legacy text JSON.                                    |

If a client cannot correctly read structured results, use compatibility mode:

```bash
ai-hub-trade-mcp setup --client codex --profile default --response-mode compat
```

### Read-only mode

To expose queries but no orders, cancellations, or transfers, start MCP in read-only mode:

```bash
ai-hub-trade-mcp --profile default --read-only
```

This mode does not register write-preview tools or `confirm_action`.
