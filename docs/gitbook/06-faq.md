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
ai-hub wallet transfer --from-account-type 1 --to-account-type 5 --coin-symbol USDT --amount 10 --profile default
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
npx skills add exhcange/ai-hub-agent-skills
```

After updating MCP, run `setup` again and restart or refresh the target AI client.

</details>
