# 06 FAQ

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
# Update the CLI and MCP packages.
npm install -g @aihubspot/agent-trade-cli@latest @aihubspot/agent-trade-mcp@latest

# Reinstall or update Skills. Exact update behavior depends on the Skills client.
npx skills add exhcange/ai-hub-agent-trade
```

After updating MCP, run `setup` again and restart or refresh the target AI client.

</details>

## Futures questions

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

No. Follow the returned continuation for that query. A cursor may be an ID lower bound or a local snapshot token, while some lists use page numbers. A missing continuation does not prove complete upstream history. Each explicit time range is limited to six calendar months; see [Command Line](03-command-line.md) for the supported fields on each query.

</details>

<details>

<summary>Can I retry when an order, setting change or transfer times out?</summary>

Do not resend it automatically. Timeout can mean the exchange executed the request but the response was lost. Preserve the original IDs, use supported read-only evidence and report an unknown result until it is established. A fresh client ID, another transport or a changed profile must not be used to bypass an unresolved operation. See [Security](05-security.md).

</details>

<details>

<summary>Why does a Futures-to-Spot transfer use the spot profile?</summary>

Both directions use the existing spot-side transfer API, with account types `1` (Spot) and `5` (Futures). Transfer preview and confirmation therefore both use `spot`. First verify account pairing, then query source transferable funds. Futures write permission alone is insufficient if the spot MCP server is read-only or the spot API credential lacks transfer permission.

</details>

<details>

<summary>Why are Spot and Futures balances displayed separately?</summary>

Their fields have different meanings. Futures equity, margin and unrealized PnL must not be added together as independent balances, and the two products are not combined into one total. A failed query is reported as unavailable, so a partial result cannot look like a complete balance overview.

</details>
