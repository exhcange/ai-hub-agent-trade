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

已按[快速开始](01-kuai-su-kai-shi.md)创建 Profile 并配置凭证。
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
ai-hub-trade-mcp setup --client cursor --profile spot
ai-hub-trade-mcp setup --client cursor --profile futures
```

{% endtab %}

{% tab title="Claude Desktop" %}

```bash
ai-hub-trade-mcp setup --client claude-desktop --profile spot
ai-hub-trade-mcp setup --client claude-desktop --profile futures
```

{% endtab %}

{% tab title="Claude Code" %}

```bash
ai-hub-trade-mcp setup --client claude-code --profile spot
ai-hub-trade-mcp setup --client claude-code --profile futures
```

{% endtab %}

{% tab title="Codex" %}

```bash
ai-hub-trade-mcp setup --client codex --profile spot
ai-hub-trade-mcp setup --client codex --profile futures
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
ai-hub-trade-mcp --profile spot
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

客户端注册的 MCP 名称会带上 Profile，例如 `aihub-merchant-a`，避免与其他租户混淆。

## 默认工具列表

MCP 默认使用 `default` Toolset，并按 Profile 的产品类型暴露工具。以下表格为现货能力；合约能力见本章末尾。写工具仅在未启用只读模式时暴露。

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
写操作流程必须是：**准备预览 → 展示预览 → 等待一条新的用户确认消息 → `confirm_action`**。详见[安全](05-an-quan.md)。
{% endhint %}

## 高级选项

### Toolset

| Toolset       | 适用场景               | 说明                                |
| ------------- | ------------------ | --------------------------------- |
| `default`（默认） | 日常使用 | 暴露所选产品支持的全部工具；只读模式隐藏写工具。 |
| `full` | 兼容已有配置 | 与 default 暴露相同的工具。 |

大多数用户保持默认值即可：

```bash
ai-hub-trade-mcp setup --client codex --profile spot
ai-hub-trade-mcp setup --client codex --profile futures
```

已有配置也可以继续显式指定 full：

```bash
ai-hub-trade-mcp setup --client codex --profile spot --toolset full
ai-hub-trade-mcp setup --client codex --profile futures --toolset full
```

### 响应模式

| 响应模式          | 说明                                             |
| ------------- | ---------------------------------------------- |
| `compact`（默认） | 文本与 structuredContent 返回相同、可解析的标准结果。 |
| `compat` | 兼容保留的模式名，当前查询结果格式与 compact 一致。 |

如已有客户端配置使用兼容模式，可继续保留：

```bash
ai-hub-trade-mcp setup --client codex --profile spot --response-mode compat
ai-hub-trade-mcp setup --client codex --profile futures --response-mode compat
```

### 只读模式

只想让 Agent 查询数据、不希望暴露任何下单、撤单或划转能力时，直接启动只读 MCP：

```bash
ai-hub-trade-mcp --profile spot --read-only
```

{% hint style="info" %}
此模式不会注册写操作的预览工具，也不会注册 `confirm_action`。
{% endhint %}

## 同时使用现货与合约

选择你使用的客户端，为它分别注册两个 Profile。完成后客户端应显示两个 MCP 服务：

| MCP 服务 | Profile 产品标记 | 用途 |
| --- | --- | --- |
| `aihub-spot` | `spot` | 现有现货能力，以及现货与合约两个方向的划转。 |
| `aihub-futures` | `futures` | 合约行情、资产仓位、订单与交易设置。 |

Profile 的产品标记决定服务暴露的工具。明确的现货请求走现货服务，明确的合约请求走合约服务；未指定产品的余额查询分别查询两侧、分项展示，不合并总额。某个服务缺失或查询失败时，不能悄悄用另一个产品代替。

分别调用两个服务的 `system_get_capabilities`，检查 `profile`、`productScope.product`、`readOnly` 和 `serviceVersion`。`default`、`full` 是兼容保留的工具集名称，不是 Profile 名。更新 npm 包后重新加载 MCP 连接；如果仍保留旧进程，应完全退出客户端后重新打开。仅切换已有会话不一定加载新代码。

### 合约查询工具

这些工具可以直接读取，不需要写操作预览。行情查询需配置基址，账户和订单查询还需合约只读凭证。

| 模块 | 工具 | 用途及主要参数 |
| --- | --- | --- |
| 公共 | `futures_ping` | 检查 OpenAPI 连通性。 |
| 公共 | `futures_time` | 查询服务器时间。 |
| 公共 | `futures_contracts` | 浏览合约及规则；可选 `contractName`、`limit`、`cursor`。后续使用返回的准确合约标识。 |
| 公共 | `futures_depth` | 查询 `contractName` 的买卖盘口，以 `limit` 限制档数。 |
| 公共 | `futures_ticker` | 查询一个 `contractName` 的 24 小时行情。 |
| 公共 | `futures_index` | 查询 `contractName` 的指数价、标记价和资金费率数据。 |
| 公共 | `futures_klines` | 按 `contractName`、`interval` 查询 K 线，可选 `limit`；一小时周期为 `1h`。 |
| 账户 | `futures_assets` | 查询合约资产字段，可选保证金币种 `asset`。 |
| 账户 | `futures_positions` | 查询当前有效仓位，可选 `contractName`、`asset`、`limit`。 |
| 账户 | `futures_profit_history` | 查询历史盈亏和费用，可选合约、`fromId` 及配套的 `startTime` / `endTime`。 |
| 账户 | `futures_transactions` | 查询资金流水；必填 `symbol`、`beginTime`、`endTime`，可选 `page`、`limit`、`type`。 |
| 订单 | `futures_order_detail` | 必填 `contractName`，并在 `orderId` / `clientOrderId` 中选择一个。 |
| 订单 | `futures_open_orders` | 当前普通委托，可选 `contractName`、`limit`、`cursor`。 |
| 订单 | `futures_order_history` | 指定 `contractName` 的历史普通委托，可选 `fromId`、`limit`。 |
| 订单 | `futures_my_trades` | 指定 `contractName` 的本人成交记录，可选 `fromId`、`limit`。 |
| 订单 | `futures_trigger_orders` | 指定 `contractName` 的当前条件单/止盈止损单，可选 `page`、`limit`。 |

MCP 参数采用 `contractName` 这样的驼峰名称，CLI 参数采用 `--contract-name`。金额、数量、ID 根据工具 Schema 使用字符串；页大小、页码和数字枚举使用数字。

合约结果沿用前文的 `dataType` 包络。带分页信息的列表通常属于 `object`，应读取 `data.value.items` 及其续查信息，不能假设列表一定为 `dataType: "array"`。继续查询时保留原过滤条件，具体分页和时间范围规则见[命令行](03-ming-ling-xing.md)。

资产金额保留两位小数。委托、成交、仓位中标有 `quantityUnit: "contracts"` 的数量按“张”展示，仅对 `quantityFields` 指定的字段应用此单位。权益、保证金和未实现盈亏应分别保留，不能另行重复加总。

### 合约写操作工具

以下十个工具用于准备预览，准备阶段不会向交易所提交写请求。

| 工具 | 操作及预览重点 |
| --- | --- |
| `futures_prepare_place_order` | 普通限价/市价下单：合约、开平仓意图、数量和单位、保证金模式、价格、客户端订单 ID。 |
| `futures_prepare_place_condition_order` | 交易所托管的条件单：普通下单参数、触发方向与触发价。 |
| `futures_prepare_place_profit_loss_order` | 仓位止盈止损：合约、平仓方向、1–5 条包含数量和执行类型的触发明细。 |
| `futures_prepare_cancel_order` | 按合约和交易所订单 ID 撤销一笔普通单。 |
| `futures_prepare_cancel_all_orders` | 撤销合约账户全部普通委托，必填 `scope: "all-ordinary-orders"`；不撤条件单、不平仓。 |
| `futures_prepare_cancel_trigger_order` | 撤销指定条件单；提供合约，并在 `orderId`、`orderIds`、`clientId` 中选择一个。 |
| `futures_prepare_set_position_mode` | 修改账户级单向/双向持仓模式，请求仍需提供合约。 |
| `futures_prepare_set_margin_mode` | 修改指定合约的全仓/逐仓模式。 |
| `futures_prepare_adjust_position_margin` | 按正负金额调整指定逐仓仓位保证金。 |
| `futures_prepare_set_leverage` | 修改指定合约的杠杆。 |

例如，准备一笔限价开多 1 张的订单，可调用 `futures_prepare_place_order`，参数为：

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

以上仅为参数示例。服务已经绑定 `futures` Profile，输入中不包含凭证或端点。Agent 展示返回的预览后停止；用户新发一条明确确认消息后，才在**同一个服务**调用 `confirm_action`，传入返回的确认 ID 和这条用户确认文本。修改参数时须重新生成预览。

全部撤单覆盖执行时的全部普通委托，包括预览后新增的普通委托。条件单和止盈止损由交易所负责触发。这些语义应在预览中明确，不能替换成 Agent 监控任务。

### 划转使用现货服务

合约划转 Skill 在 `1 → 5` 和 `5 → 1` 两个方向都使用现货侧已有工具：

| 现货 MCP 工具 | 用途 |
| --- | --- |
| `wallet_get_transferable_assets` | 查询来源账户类型的可划转资产。 |
| `wallet_get_universal_transfer_history` | 查询指定方向的划转记录。 |
| `wallet_prepare_universal_transfer` | 按来源、目标、币种和金额准备划转预览。 |

划转通过 `aihub-spot` 的 `confirm_action` 确认。仅开放合约服务写权限不能执行划转，现货服务和现货 API 凭证也需具备对应能力。首次使用前应完成[安全](05-an-quan.md)中的账户配对验证。

### 只开放查询

需要将两个产品长期配置为只读时，在注册服务时添加 `--read-only`，例如：

```bash
ai-hub-trade-mcp setup --client codex --profile spot --read-only
ai-hub-trade-mcp setup --client codex --profile futures --read-only
```

客户端名称按实际安装情况替换。只读模式不暴露 prepare 工具和 `confirm_action`；不加该参数时，支持的写能力通过预览确认流程开放，实际执行仍受 API 凭证权限约束。安装 Skill 不会额外赋予 MCP 权限。
