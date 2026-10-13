# 02 MCP

MCP（Model Context Protocol）让支持 MCP 的 AI 客户端以结构化工具形式调用 AI Hub。AI Hub MCP 仅以本地 `stdio` 服务运行，读取 CLI 已配置的本地 Profile 和凭证。

## 适用场景

* 在 Cursor、Claude Desktop、Claude Code 或 Codex 中，用自然语言查询行情、订单、资产和钱包信息；
* 对交易或资金操作先获取精确预览，再由用户进行最终确认；
* 使用有界摘要、分页和搜索工具，避免全量市场响应占满 Agent 上下文。

## 前置条件

{% stepper %}
{% step %}
### 安装 MCP 包

```bash
npm install -g @aihubspot/agent-trade-mcp
```
{% endstep %}

{% step %}
### 创建 Profile 并配置凭证

已按[快速开始](./)创建 Profile 并配置凭证。
{% endstep %}

{% step %}
### 安装客户端

已安装 Cursor、Claude Desktop、Claude Code 或 Codex 中的任一客户端。
{% endstep %}
{% endstepper %}

## 接入与启动

先完成 CLI Profile 初始化，然后执行与目标客户端对应的命令：

{% tabs %}
{% tab title="Cursor" %}
```bash
ai-hub-trade-mcp setup --client cursor --profile default
```
{% endtab %}

{% tab title="Claude Desktop" %}
```bash
ai-hub-trade-mcp setup --client claude-desktop --profile default
```
{% endtab %}

{% tab title="Claude Code" %}
```bash
ai-hub-trade-mcp setup --client claude-code --profile default
```
{% endtab %}

{% tab title="Codex" %}
```bash
ai-hub-trade-mcp setup --client codex --profile default
```
{% endtab %}
{% endtabs %}

`setup` 会将当前已安装的 MCP 包以绝对 Node 路径和入口路径注册到客户端，因此客户端不依赖全局 PATH。凭证不会写入客户端配置文件，MCP 服务会继续从 `~/.ai-hub/config.toml` 读取指定 Profile。

执行完成后：

* **Cursor、Claude Desktop**：关闭并重新打开客户端；
* **Claude Code、Codex**：重新开启一个会话或按客户端方式刷新 MCP 配置；
* 在客户端中调用 `system_get_capabilities`，检查 `profile`、`toolset`、`responseMode` 与 `serviceVersion`。

对于 Cursor 和 Claude Desktop，`setup` 会合并已有 JSON MCP 配置，首次修改时会创建备份；对于 Claude Code 和 Codex，`setup` 会调用对应官方 CLI 完成注册。

通常无需手动启动服务；客户端会按注册配置启动它。若要从终端直接运行本地 `stdio` MCP 服务：

```bash
ai-hub-trade-mcp --profile default
```

{% hint style="info" %}
该命令会等待 MCP 客户端通过标准输入输出连接，因此终端没有交互式输出是正常现象。
{% endhint %}

查看帮助请使用：

```bash
ai-hub-trade-mcp --help
```

### 多 Profile 配置

为每个接入平台创建并注册独立的连接配置：

```bash
ai-hub config set --profile merchant-a --openapi-base-url https://merchant-a-openapi.example
ai-hub config set-credentials --profile merchant-a
ai-hub-trade-mcp setup --client codex --profile merchant-a
```

客户端注册的 MCP 名称会带上 Profile，例如 `ai-hub-trade-mcp-merchant-a`，避免与其他租户混淆。

## 默认工具列表

MCP 默认使用 `default` Toolset。它优先暴露现货交易最常用、结果有界的工具，包含 `system_get_capabilities`、`confirm_action` 以及以下业务能力。

| 模块   | 默认能力                      | 说明                           |
| ---- | ------------------------- | ---------------------------- |
| 市场   | 币对总览、币对分页/搜索、精确币对规则       | 泛查询优先返回总数、样例或分页；需要精度时再查具体币对。 |
| 市场   | Ticker、订单簿摘要、最近成交摘要、K 线摘要 | 避免将完整市场或深度响应重复放入 Agent 上下文。  |
| 现货订单 | 订单查询、当前委托、成交记录            | 只读查询。                        |
| 现货订单 | 市价买/卖、限价、撤单、批量下单/撤单       | 以 `prepare` 工具生成预览，不能直接提交。   |
| 钱包   | 可划转资产、划转记录、充值历史、充值地址、提现地址 | 只读查询。                        |
| 钱包   | 万向划转                      | 以 `prepare` 工具生成预览，不能直接提交。   |

客户端可先调用 `system_get_capabilities` 查看当前实际注册的模块、读写工具数量、Profile、Toolset 和响应模式。

### 市场工具使用建议

| 用户意图             | 推荐工具                         | 不推荐方式               |
| ---------------- | ---------------------------- | ------------------- |
| “有哪些币对？”         | `market_get_symbol_overview` | 请求完整币对列表。           |
| “列出 USDT 币对”     | `market_list_symbols`，按偏移分页  | 一次请求所有币对规则。         |
| “查 BTC 币对”       | `market_search_symbols`      | 无过滤地查询全部币对。         |
| “BTCUSDT 精度是多少？” | `market_get_symbol_info`     | 从币对全量响应中自行查找。       |
| “看市场行情”          | `market_get_ticker_summary`  | 读取未筛选的全市场原始 Ticker。 |
| “看 BTCUSDT 盘口”   | `market_get_depth_summary`   | 请求无边界的完整深度。         |

列表或摘要类工具默认返回 20 条，单次最大 50 条；币对浏览请使用 `offset` 继续查询。K 线可用周期为 `1min`、`5min`、`15min`、`30min`、`60min`、`1day`、`1week`、`1month`。

### 读结果结构

所有读取工具使用稳定包裹结构：

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

`dataType` 可能为：

* `array`：从 `items` 读取列表，`count` 表示数量；
* `object`：从 `value` 读取对象；
* `scalar`：从 `value` 读取单个值；
* `null`：结果为空。

不要依赖上游 OpenAPI 的原始嵌套结构；应先判断 `data.dataType` 再读取数据。

### 写操作工具

MCP 对写操作只暴露 `prepare` 工具，例如：

* `spot_prepare_market_buy`
* `spot_prepare_market_sell`
* `spot_prepare_limit_order`
* `spot_prepare_cancel_order`
* `spot_prepare_batch_place_orders`
* `spot_prepare_batch_cancel_orders`
* `wallet_prepare_universal_transfer`

{% hint style="warning" %}
写操作流程必须是：**准备预览 → 展示预览 → 等待一条新的用户确认消息 → `confirm_action`**。详见[安全](/broken/pages/faf67ce835bf645a29d7da0711a980476a047f99)。
{% endhint %}

## 高级选项

### Toolset

| Toolset       | 适用场景               | 说明                                |
| ------------- | ------------------ | --------------------------------- |
| `default`（默认） | 日常现货 Agent 使用      | 只注册聚焦的市场摘要、现货订单、钱包查询与万向划转工具。      |
| `full`        | 高级调试或确实需要所有当前公开能力时 | 注册 Core 中所有公开工具，工具选择成本和响应上下文都会增加。 |

大多数用户保持默认值即可：

```bash
ai-hub-trade-mcp setup --client codex --profile default
```

确需完整工具集时，显式指定：

```bash
ai-hub-trade-mcp setup --client codex --profile default --toolset full
```

### 响应模式

| 响应模式          | 说明                                             |
| ------------- | ---------------------------------------------- |
| `compact`（默认） | 文本只返回结果类型、数量和摘要；完整标准数据保留在 MCP 的结构化结果中，减少重复上下文。 |
| `compat`      | 文本和结构化结果都包含完整 JSON，仅用于依赖旧文本 JSON 的客户端。         |

如客户端无法正确读取结构化结果，可使用兼容模式：

```bash
ai-hub-trade-mcp setup --client codex --profile default --response-mode compat
```

### 只读模式

只想让 Agent 查询数据、不希望暴露任何下单、撤单或划转能力时，直接启动只读 MCP：

```bash
ai-hub-trade-mcp --profile default --read-only
```

{% hint style="info" %}
此模式不会注册写操作的预览工具，也不会注册 `confirm_action`。
{% endhint %}
