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
ai-hub wallet transfer --from-account-type 1 --to-account-type 5 --coin-symbol USDT --amount 10 --profile spot
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
npx skills add exhcange/ai-hub-agent-trade
```

更新 MCP 后，建议重新执行 `setup`，再重启或刷新目标 AI 客户端。

</details>

## 合约常见问题

<details>

<summary>为什么没有合约工具，或只能查询不能下单？</summary>

检查已安装的 CLI/MCP 包是否包含合约能力，`futures` Profile 是否标记为 `product=futures`，以及是否已独立注册合约 MCP 服务。同时安装六个合约 Skill。在 `aihub-futures` 调用 `system_get_capabilities` 核对产品、版本和 `readOnly`。

只读注册会主动隐藏 prepare 工具和 `confirm_action`。需要支持的写能力时，注册命令不加 `--read-only`，并确保 API 凭证有对应权限。变更后重新加载连接；若仍保留旧进程，完全退出客户端再打开。仅切换会话不一定重启 MCP。

</details>

<details>

<summary>为什么公共服务器时间返回 10002？</summary>

`10002` 是未登录错误，不是时间戳。应检查基址是否误填了 App API，而非平台提供的合约 OpenAPI。公共 time 和 ping 不需要登录或签名，应向平台确认正确基址，不要添加登录 Token 或猜测域名。修改端点会清除旧凭证，之后需在本地重新配置。

</details>

<details>

<summary>可以直接用 BTCUSDT 作为合约名称吗？</summary>

先运行 `ai-hub futures contracts --profile futures`，使用返回的准确 `symbol`。合约名称可能类似 `E-BTC-USDT`，实际名称由平台决定，不能默认现货币对 `BTCUSDT` 与合约标识一致。

</details>

<details>

<summary>委托数量 124 是 124 个币吗？</summary>

订单、成交和仓位结果中，标记为 `quantityUnit: "contracts"` 的数量表示“张”，124 即 124 张。该单位只应用于 `quantityFields` 列出的字段。下单时要明确选择 `contracts`、`coin` 或 `value`，并满足面值和下单限制。价格、金额和 ID 不能按张数解释。

</details>

<details>

<summary>资产保留两位小数，会影响下单精度吗？</summary>

不会。资产查询视图对金额进行展示舍入，例如 `123.456` 显示为 `123.46`，不改变交易所余额，也不改变订单校验和提交精度。显示 `0.00` 仍可能存在很小的非零金额；划转前应使用专门的可划转余额查询。

</details>

<details>

<summary>为什么 Agent 还要问开仓还是平仓？</summary>

合约下单需要同时明确多空和开平仓。BUY 可以是开多或平空，SELL 可以是开空或平多。请给出合约、意图、数量及单位、保证金模式和执行类型。“用 100 USDT”还可能指订单价值或保证金预算，需要先说明清楚。

</details>

<details>

<summary>条件单需要 Agent 一直在线盯盘吗？</summary>

确认并成功提交条件单或止盈止损单后，由交易所负责监测触发，Agent 不需要持续在线盯盘。仅展示预览尚未提交订单。触发价与触发后的限价是不同参数，触发也不保证成交。

</details>

<details>

<summary>全部撤单会撤掉止盈止损或平仓吗？</summary>

不会。它针对执行时合约账户所有合约的普通委托，包括可能在预览后新增的普通委托，但不包含条件单、止盈止损单或仓位。条件单使用单独的撤销命令指定 ID；平仓则是另一笔需预览确认的订单。

</details>

<details>

<summary>合约可以一次下多笔普通单或撤多笔普通单吗？</summary>

本期不提供普通单批量下单和指定多笔普通单批量撤销，支持单笔普通撤单和账户级普通全部撤单。条件单可按明确 ID 列表撤销，AI Hub 单次上限为 50 个；止盈止损单次最多五条。这些能力不能当作普通单批量交易，Agent 也不会循环写请求来模拟。

</details>

<details>

<summary>为什么持仓模式或保证金模式修改被拒绝？</summary>

持仓模式影响整个账户，要求无有效仓位和普通委托；保证金模式作用于指定合约，要求无相关仓位和普通委托。Agent 不会为此自动撤单或平仓。逐仓保证金调整还要求仓位属于本人、未冻结且为逐仓，杠杆也必须在合约允许范围内。

</details>

<details>

<summary>返回 20 条记录，就是全部历史吗？</summary>

不是。应根据该查询返回的续查信息继续。游标可能是 ID 下界或本地快照令牌，也有接口按页码翻页。没有续查字段也不能证明交易所全部历史已经返回。显式时间范围每次最多半年，各查询支持的字段见[命令行](03-ming-ling-xing.md)。

</details>

<details>

<summary>下单、改设置或划转超时后，可以直接重试吗？</summary>

不能自动重发。超时可能是交易所已执行，但响应丢失。应保留原标识，通过支持的只读证据查证，未确认前明确报告结果未知。不能换客户端订单 ID、改调用方式或换 Profile 绕过待处理操作。详见[安全](05-an-quan.md)。

</details>

<details>

<summary>为什么合约转现货也使用 spot Profile？</summary>

两个方向都复用现货侧划转 API，账户类型为 `1`（现货）和 `5`（合约），所以预览和确认均使用 `spot`。首次先验证账户配对，随后查询来源可划转余额。若现货 MCP 为只读或现货 API 凭证没有划转权限，仅有合约写权限仍不能划转。

</details>

<details>

<summary>为什么现货和合约余额分开展示，不给一个总数？</summary>

两个产品的字段口径不同，合约权益、保证金和未实现盈亏也不能作为独立余额重复相加，因此保留分项展示。一侧查询失败会标记不可用，不能让部分结果看起来像完整的余额总览。

</details>
