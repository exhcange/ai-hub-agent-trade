# 06 常见问题

<details>

<summary>为什么 <code>ai-hub-trade-mcp</code> 看起来没有输出？</summary>

不带 `--help` 的 `ai-hub-trade-mcp` 会启动本地 `stdio` MCP 服务，并等待客户端连接；它不是终端交互式程序，没有输出属于正常现象。

```bash
ai-hub-trade-mcp --help
```

</details>

<details>

<summary>为什么“市价买入 1 ETH”会被拒绝或要求澄清？</summary>

市价买入的数量是 `quoteAmount`，即花费的计价资产金额；在 `ETHUSDT` 中就是 USDT。市价成交价格会变化，无法保证精确买到 1 ETH。

应改为“花费 100 USDT 市价买入 ETH”，或使用限价单指定 ETH 数量和价格。市价卖出才使用基础币数量，例如“市价卖出 0.5 ETH”。

</details>

<details>

<summary>为什么现货划转到合约不能使用账户类型 <code>2</code>？</summary>

`2` 是逐仓杠杆账户，合约/衍生品账户使用 `5`。例如：

```bash
ai-hub wallet transfer --from-account-type 1 --to-account-type 5 --coin-symbol USDT --amount 10 --profile default
```

</details>

<details>

<summary>为什么 Agent 已显示预览，却没有直接下单？</summary>

这是预期的安全行为。写操作必须等待预览后的新用户确认消息。请核对币对、方向、数量、价格或账户类型后，再明确回复确认；不要要求 Agent 自动确认。

</details>

<details>

<summary>为什么看不到刚更新的 MCP 能力？</summary>

依次检查：

1. 确认安装版本：`npm list -g --depth=0 | grep aihubspot`；
2. 重新执行目标客户端的 `ai-hub-trade-mcp setup`；
3. 重启 Cursor 或 Claude Desktop，或新开 Claude Code/Codex 会话；
4. 调用 `system_get_capabilities`，查看 `serviceVersion`、`toolset` 和 `responseMode`。

</details>

<details>

<summary>如何更新 CLI、MCP 与 Skills？</summary>

```bash
# 更新 CLI 与 MCP
npm install -g @aihubspot/agent-trade-cli@latest @aihubspot/agent-trade-mcp@latest

# 再次安装/更新 Skills；具体更新行为取决于所使用的 Skills 客户端
npx skills add exhcange/ai-hub-agent-skills
```

更新 MCP 后，建议重新执行 `setup`，再重启或刷新目标 AI 客户端。

</details>
