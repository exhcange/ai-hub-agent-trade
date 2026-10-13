# AI Hub 使用手册：现货与合约

面向已安装 npm、尚未安装 AI Hub 的新用户。本地审阅版，尚未同步到线上 GitBook。

## 01 快速开始

本页用于安装 CLI 和 MCP 组件，并为您的平台创建本地连接配置。

### 使用前准备

* 已安装 npm，Node.js 版本为 20 或更高；
* 可访问的租户 OpenAPI 公网 HTTPS 域名；
* 具有所需权限的 API Key 与 Secret Key；
* 使用 MCP 时，已安装 Cursor、Claude Desktop、Claude Code 或 Codex；
* 使用 Skills 时，客户端支持 `npx skills`，或支持手动加载 Skill 文件夹。

{% hint style="info" %}
建议为 AI Hub 单独创建 API 凭证，并遵循最小权限原则：只读场景仅授予查询权限；下单、撤单和划转需要各自对应的交易或资金权限。
{% endhint %}

{% stepper %}
{% step %}

### 安装 CLI 与 MCP

```bash
npm install -g @aihubspot/agent-trade-cli @aihubspot/agent-trade-mcp
```

确认安装成功：

```bash
ai-hub --help
ai-hub-trade-mcp --help
```

{% endstep %}

{% step %}

### 创建现货与合约配置

为两个产品分别创建 Profile：现货使用 `spot`，合约使用 `futures`。将两个示例域名分别替换为平台提供的现货、合约 OpenAPI HTTPS 地址，不要填写网站首页或 App API 地址。

```bash
ai-hub config init
ai-hub config set --profile spot --product spot --openapi-base-url https://your-spot-openapi-domain
ai-hub config set-credentials --profile spot
ai-hub config set --profile futures --product futures --openapi-base-url https://your-futures-openapi-domain
ai-hub config set-credentials --profile futures
```

执行 `set-credentials` 后，终端会分别提示输入 API Key 和 Secret Key，输入内容不会回显。两个产品的凭证分别在本机配置，不要发送到聊天中。

查看配置中的产品类型，并验证公共连通性：

```bash
ai-hub config show --profile spot
ai-hub config show --profile futures
ai-hub market ping --profile spot
ai-hub futures ping --profile futures
ai-hub futures time --profile futures
```

公共接口不需要凭证；资产、仓位和订单等签名查询需要对应 Profile 的凭证。

{% endstep %}

{% step %}

### 首次查询市场

```bash
## 查看当前市场摘要
ai-hub market ticker-summary --quote-asset USDT --limit 20 --profile spot

## 查询精确币对的 Ticker
ai-hub market ticker --symbol BTCUSDT --profile spot

## 查询价格精度、数量精度和最小下单限制
ai-hub market symbol-info --symbol BTCUSDT --profile spot
```

{% endstep %}
{% endstepper %}

### 首次查询合约

先查询公共合约列表，再使用前面配置的合约凭证查询账户。

```bash
ai-hub futures contracts --profile futures
ai-hub futures account assets --profile futures
ai-hub futures account positions --profile futures
```

`contracts` 返回准确合约标识和交易规则；`assets` 返回资产金额，保留两位小数；`positions` 返回当前有效仓位，数量按张展示。查询行情时先从列表选择合约，更多合约示例见[命令行](gitbook/zh/03-ming-ling-xing.md)。

安装完成后，继续按 MCP 章节将两个 Profile 注册到同一个客户端，再按 Skills 章节安装现货和合约操作规则。仅安装 npm 包不会自动完成这两个步骤。

### 下一步

* 在终端或脚本中使用：[命令行](gitbook/zh/03-ming-ling-xing.md)
* 接入 AI 客户端：[MCP 接入与启动](gitbook/zh/02-mcp.md)
* 安装 Agent 操作规则：[Skills](gitbook/zh/04-skills.md)


## 02 MCP

MCP（Model Context Protocol）让支持 MCP 的 AI 客户端以结构化工具形式调用 AI Hub。AI Hub MCP 仅以本地 `stdio` 服务运行，读取 CLI 已配置的本地 Profile 和凭证。

### 适用场景

* 在 Cursor、Claude Desktop、Claude Code 或 Codex 中，用自然语言查询行情、订单、资产和钱包信息；
* 对交易或资金操作先获取精确预览，再由用户进行最终确认；
* 使用有界摘要、分页和搜索工具，避免全量市场响应占满 Agent 上下文。

### 前置条件

{% stepper %}
{% step %}

#### 安装 MCP 包

```bash
npm install -g @aihubspot/agent-trade-mcp
```

{% endstep %}

{% step %}

#### 创建 Profile 并配置凭证

已按[快速开始](gitbook/zh/01-kuai-su-kai-shi.md)创建 Profile 并配置凭证。
{% endstep %}

{% step %}

#### 安装客户端

已安装 Cursor、Claude Desktop、Claude Code 或 Codex 中的任一客户端。
{% endstep %}
{% endstepper %}

### 接入与启动

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

#### 多 Profile 配置

为每个接入平台创建并注册独立的连接配置：

```bash
ai-hub config set --profile merchant-a --openapi-base-url https://merchant-a-openapi.example
ai-hub config set-credentials --profile merchant-a
ai-hub-trade-mcp setup --client codex --profile merchant-a
```

客户端注册的 MCP 名称会带上 Profile，例如 `aihub-merchant-a`，避免与其他租户混淆。

### 默认工具列表

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

#### 市场工具使用建议

| 用户意图             | 推荐工具                         | 不推荐方式               |
| ---------------- | ---------------------------- | ------------------- |
| “有哪些币对？”         | `market_get_symbol_overview` | 请求完整币对列表。           |
| “列出 USDT 币对”     | `market_list_symbols`，按偏移分页  | 一次请求所有币对规则。         |
| “查 BTC 币对”       | `market_search_symbols`      | 无过滤地查询全部币对。         |
| “BTCUSDT 精度是多少？” | `market_get_symbol_info`     | 从币对全量响应中自行查找。       |
| “看市场行情”          | `market_get_ticker_summary`  | 读取未筛选的全市场原始 Ticker。 |
| “看 BTCUSDT 盘口”   | `market_get_depth_summary`   | 请求无边界的完整深度。         |

列表或摘要类工具默认返回 20 条，单次最大 50 条；币对浏览请使用 `offset` 继续查询。K 线可用周期为 `1min`、`5min`、`15min`、`30min`、`60min`、`1day`、`1week`、`1month`。

#### 读结果结构

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

#### 写操作工具

MCP 对写操作只暴露 `prepare` 工具，例如：

* `spot_prepare_market_buy`
* `spot_prepare_market_sell`
* `spot_prepare_limit_order`
* `spot_prepare_cancel_order`
* `spot_prepare_batch_place_orders`
* `spot_prepare_batch_cancel_orders`
* `wallet_prepare_universal_transfer`

{% hint style="warning" %}
写操作流程必须是：**准备预览 → 展示预览 → 等待一条新的用户确认消息 → `confirm_action`**。详见[安全](gitbook/zh/05-an-quan.md)。
{% endhint %}

### 高级选项

#### Toolset

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

#### 响应模式

| 响应模式          | 说明                                             |
| ------------- | ---------------------------------------------- |
| `compact`（默认） | 文本与 structuredContent 返回相同、可解析的标准结果。 |
| `compat` | 兼容保留的模式名，当前查询结果格式与 compact 一致。 |

如已有客户端配置使用兼容模式，可继续保留：

```bash
ai-hub-trade-mcp setup --client codex --profile spot --response-mode compat
ai-hub-trade-mcp setup --client codex --profile futures --response-mode compat
```

#### 只读模式

只想让 Agent 查询数据、不希望暴露任何下单、撤单或划转能力时，直接启动只读 MCP：

```bash
ai-hub-trade-mcp --profile spot --read-only
```

{% hint style="info" %}
此模式不会注册写操作的预览工具，也不会注册 `confirm_action`。
{% endhint %}

### 同时使用现货与合约

选择你使用的客户端，为它分别注册两个 Profile。完成后客户端应显示两个 MCP 服务：

| MCP 服务 | Profile 产品标记 | 用途 |
| --- | --- | --- |
| `aihub-spot` | `spot` | 现有现货能力，以及现货与合约两个方向的划转。 |
| `aihub-futures` | `futures` | 合约行情、资产仓位、订单与交易设置。 |

Profile 的产品标记决定服务暴露的工具。明确的现货请求走现货服务，明确的合约请求走合约服务；未指定产品的余额查询分别查询两侧、分项展示，不合并总额。某个服务缺失或查询失败时，不能悄悄用另一个产品代替。

分别调用两个服务的 `system_get_capabilities`，检查 `profile`、`productScope.product`、`readOnly` 和 `serviceVersion`。`default`、`full` 是兼容保留的工具集名称，不是 Profile 名。更新 npm 包后重新加载 MCP 连接；如果仍保留旧进程，应完全退出客户端后重新打开。仅切换已有会话不一定加载新代码。

#### 合约查询工具

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

合约结果沿用前文的 `dataType` 包络。带分页信息的列表通常属于 `object`，应读取 `data.value.items` 及其续查信息，不能假设列表一定为 `dataType: "array"`。继续查询时保留原过滤条件，具体分页和时间范围规则见[命令行](gitbook/zh/03-ming-ling-xing.md)。

资产金额保留两位小数。委托、成交、仓位中标有 `quantityUnit: "contracts"` 的数量按“张”展示，仅对 `quantityFields` 指定的字段应用此单位。权益、保证金和未实现盈亏应分别保留，不能另行重复加总。

#### 合约写操作工具

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

#### 划转使用现货服务

合约划转 Skill 在 `1 → 5` 和 `5 → 1` 两个方向都使用现货侧已有工具：

| 现货 MCP 工具 | 用途 |
| --- | --- |
| `wallet_get_transferable_assets` | 查询来源账户类型的可划转资产。 |
| `wallet_get_universal_transfer_history` | 查询指定方向的划转记录。 |
| `wallet_prepare_universal_transfer` | 按来源、目标、币种和金额准备划转预览。 |

划转通过 `aihub-spot` 的 `confirm_action` 确认。仅开放合约服务写权限不能执行划转，现货服务和现货 API 凭证也需具备对应能力。首次使用前应完成[安全](gitbook/zh/05-an-quan.md)中的账户配对验证。

#### 只开放查询

需要将两个产品长期配置为只读时，在注册服务时添加 `--read-only`，例如：

```bash
ai-hub-trade-mcp setup --client codex --profile spot --read-only
ai-hub-trade-mcp setup --client codex --profile futures --read-only
```

客户端名称按实际安装情况替换。只读模式不暴露 prepare 工具和 `confirm_action`；不加该参数时，支持的写能力通过预览确认流程开放，实际执行仍受 API 凭证权限约束。安装 Skill 不会额外赋予 MCP 权限。


## 03 命令行

CLI 命令入口为 `ai-hub`。使用 `ai-hub --help` 查看当前版本的完整可用命令和参数。

{% hint style="info" %}
建议在脚本和 Agent 指令中始终传入 `--profile <name>`，避免跨租户调用。
{% endhint %}

### 市场数据

| 目标            | 示例命令                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| 查看币对总览        | `ai-hub market symbols-overview --limit 20 --profile spot`                                 |
| 分页浏览 USDT 币对  | `ai-hub market symbols-list --quote-asset USDT --offset 0 --limit 20 --profile spot`       |
| 搜索币对          | `ai-hub market symbols-search --query BTC --limit 20 --profile spot`                       |
| 查询币对精度和最小下单限制 | `ai-hub market symbol-info --symbol BTCUSDT --profile spot`                                |
| 查询指定币对 Ticker | `ai-hub market ticker --symbol ETHUSDT --profile spot`                                     |
| 查看订单簿摘要       | `ai-hub market depth-summary --symbol BTCUSDT --limit 20 --profile spot`                   |
| 查看最近成交摘要      | `ai-hub market trades-summary --symbol BTCUSDT --limit 20 --profile spot`                  |
| 查看 K 线摘要      | `ai-hub market klines-summary --symbol ETHUSDT --interval 60min --limit 20 --profile spot` |

列表型命令默认返回 20 条，单次最大 50 条。币对浏览请使用 `offset` 分页，不要尝试一次性获取完整币对或大体量历史数据。

### 账户和订单查询

```bash
## 查询 ETH 的可用、冻结和总余额
ai-hub account asset-balance --asset ETH --profile spot

## 查询指定订单
ai-hub spot order get --symbol ETHUSDT --order-id <order-id> --profile spot

## 查询当前委托和成交记录
ai-hub spot order open --symbol ETHUSDT --limit 20 --profile spot
ai-hub spot order fills --symbol ETHUSDT --limit 20 --profile spot
```

### 现货下单

CLI 不使用有歧义的通用 `volume` 参数；请根据订单类型使用明确的资产单位：

| 场景      | 数量参数                          | `ETHUSDT` 示例         |
| ------- | ----------------------------- | -------------------- |
| 市价买入    | `--quote-amount`              | 花费多少 USDT。           |
| 市价卖出    | `--base-quantity`             | 卖出多少 ETH。            |
| 限价买入/卖出 | `--base-quantity` 和 `--price` | 买卖多少 ETH，价格以 USDT 计。 |

```bash
## 花费 100 USDT 市价买入 ETH
ai-hub spot order market-buy --symbol ETHUSDT --quote-amount 100 --profile spot

## 市价卖出 0.5 ETH
ai-hub spot order market-sell --symbol ETHUSDT --base-quantity 0.5 --profile spot

## 以 1,800 USDT 的限价买入 1 ETH
ai-hub spot order limit --symbol ETHUSDT --side BUY --base-quantity 1 --price 1800 --profile spot

## 卖出当前可执行的全部 ETH；预览会显示可卖数量和精度截断后的剩余量
ai-hub spot order sell-available --symbol ETHUSDT --profile spot
```

{% hint style="info" %}
市价买入只能指定花费的计价币金额，无法保证成交后恰好获得某个基础币数量。若目标是“买入恰好 1 ETH”，请使用限价单，或先明确允许花费的 USDT 金额。
{% endhint %}

### 撤单和批量操作

```bash
## 撤销单个订单
ai-hub spot order cancel --symbol ETHUSDT --order-id <order-id> --profile spot

## 批量下单：--orders 为 JSON 数组，单次最多 10 笔
ai-hub spot order batch-place --symbol ETHUSDT --orders '[
  {"side":"BUY","type":"LIMIT","baseQuantity":"0.1","price":"1600"},
  {"side":"SELL","type":"LIMIT","baseQuantity":"0.1","price":"2000"}
]' --profile spot

## 批量撤单：--order-ids 为 JSON 数组，单次最多 10 笔
ai-hub spot order batch-cancel --symbol ETHUSDT --order-ids '["<order-id-1>","<order-id-2>"]' --profile spot
```

所有写命令仅生成预览。确认执行方式见[安全](gitbook/zh/05-an-quan.md)。

### 钱包和万向划转

```bash
## 查询现货账户（类型 1）可划转资产
ai-hub wallet transferable-assets --account-type 1 --profile spot

## 查询 USDT 充值地址和充值历史
ai-hub wallet deposit-address --main-coin-symbol USDT --profile spot
ai-hub wallet deposit-history --page 1 --page-size 20 --profile spot

## 查询现货到衍生品账户的划转记录
ai-hub wallet transfer-history --from-account-type 1 --to-account-type 5 --page 1 --page-size 20 --profile spot
```

万向划转账户类型：

| 代码  | 账户类型                                    |
| --- | --------------------------------------- |
| `1` | 现货账户（Spot）                              |
| `2` | 逐仓杠杆（Isolated Margin；必须同时提供 `--symbol`） |
| `3` | 全仓杠杆（Cross Margin）                      |
| `4` | C2C 账户                                  |
| `5` | 衍生品账户（Derivatives）                      |

{% hint style="warning" %}
`2` 是逐仓杠杆，不是合约/衍生品账户；合约/衍生品必须使用 `5`。
{% endhint %}

```bash
## 从现货账户划转 10 USDT 到衍生品账户；只会生成预览
ai-hub wallet transfer \
  --from-account-type 1 \
  --to-account-type 5 \
  --coin-symbol USDT \
  --amount 10 \
  --profile spot
```

### 合约市场数据

合约命令使用 `ai-hub futures` 和 `--profile futures`。先通过 `contracts` 查询合约列表，把返回的准确 `symbol` 作为 `--contract-name`。下文的 `E-BTC-USDT` 仅为示例，实际可交易合约、价格和下单限制以所在平台为准。

| 目标 | 示例命令 |
| --- | --- |
| 检查连通性 | `ai-hub futures ping --profile futures` |
| 查询服务器时间 | `ai-hub futures time --profile futures` |
| 浏览合约列表 | `ai-hub futures contracts --limit 20 --profile futures` |
| 查询指定合约规则 | `ai-hub futures contracts --contract-name E-BTC-USDT --profile futures` |
| 查询盘口深度 | `ai-hub futures market depth --contract-name E-BTC-USDT --limit 20 --profile futures` |
| 查询单合约 24 小时行情 | `ai-hub futures market ticker --contract-name E-BTC-USDT --profile futures` |
| 查询指数价、标记价和资金费率数据 | `ai-hub futures market index --contract-name E-BTC-USDT --profile futures` |
| 查询 K 线 | `ai-hub futures market klines --contract-name E-BTC-USDT --interval 1h --limit 20 --profile futures` |

这些属于公共查询，不需要 API 凭证，但仍需配置正确的合约 OpenAPI 基址。合约规则包括面值、保证金币种、价格精度、下单上下限和杠杆范围；准备订单前应读取目标合约的实际规则。

合约 K 线周期支持 `1min`、`5min`、`15min`、`30min`、`1h`、`1day`、`1week`、`1month`，其中一小时使用 `1h`。该命令支持 `interval` 和 `limit`，不提供起止时间过滤。深度查询分别返回最多 `limit` 档买盘和卖盘。

### 合约资产与仓位

资产和仓位是合约账户的两个独立查询视图，均需要合约账户的只读凭证。

```bash
## 查询资产，或仅查看指定保证金币种。
ai-hub futures account assets --profile futures
ai-hub futures account assets --asset USDT --profile futures

## 查询当前仓位，可按合约及保证金币种过滤。
ai-hub futures account positions --limit 20 --profile futures
ai-hub futures account positions --contract-name E-BTC-USDT --asset USDT --limit 20 --profile futures
```

| 查询内容 | 结果如何理解 |
| --- | --- |
| 资产 | 账户资金、冻结资金、保证金、权益、未实现盈亏按接口返回的独立字段展示。资产金额保留两位小数，例如 `123.456` 展示为 `123.46`。 |
| 仓位 | 展示有效且持仓数量大于零的当前仓位；根据返回字段查看合约、方向、仓位 ID、数量、保证金模式和杠杆。空仓位列表不能证明账户当前的持仓模式或杠杆。 |
| 委托、成交和仓位数量 | 标有 `quantityUnit: "contracts"` 的数量字段使用“张”，例如 `volume: "124"` 为 124 张。价格、金额、ID 和市场成交量字段不套用这一单位。 |

只说“查询余额”而未指定产品时，Agent 会分别查询 `spot` 和 `futures`，分项展示。不会把两个产品直接相加，也不会把未实现盈亏再次加到权益上。一侧查询失败时，该侧结果为不可用，整体查询不完整，不能将失败视为零余额。

#### 历史盈亏与资金流水

```bash
## 查询一个合约的一页历史盈亏。
ai-hub futures account profit-history --contract-name E-BTC-USDT --limit 20 --profile futures

## 查询 UTC 2026 年 9 月 1 日 00:00 至 9 月 2 日 00:00 的 USDT 流水。
## 起止时间使用 Unix 毫秒时间戳。
ai-hub futures account transactions --symbol USDT \
  --begin-time 1788220800000 --end-time 1788307200000 \
  --page 1 --limit 20 --profile futures
```

`profit-history` 可选 `--contract-name`、`--from-id`，以及配套使用的 `--start-time` / `--end-time`，展示返回的历史盈亏和费用组成。`transactions` 必须提供资产 `--symbol`、`--begin-time` 和 `--end-time`，使用 `--page` 分页，也可传入 `--type`。资金流水的 `symbol` 是币种，不是合约名称。

资金流水包含所支持的普通账户业务，例如分摊、手续费分成、赠金、公私转账和商户风险准备金分成。可选业务类型为 `1`–`13` 和 `28`，选择具体类型时应参照平台业务类型定义。每次显式查询时间跨度最多半年，具体翻页方式见本章末尾。

### 合约订单查询

| 目标 | 示例命令 |
| --- | --- |
| 按交易所订单 ID 查询普通订单详情 | `ai-hub futures order detail --contract-name E-BTC-USDT --order-id <order-id> --profile futures` |
| 按客户端订单 ID 查询普通订单详情 | `ai-hub futures order detail --contract-name E-BTC-USDT --client-order-id <client-order-id> --profile futures` |
| 查询指定合约当前普通委托 | `ai-hub futures order open --contract-name E-BTC-USDT --limit 20 --profile futures` |
| 跨合约查询当前普通委托 | `ai-hub futures order open --limit 20 --profile futures` |
| 查询历史普通委托 | `ai-hub futures order history --contract-name E-BTC-USDT --limit 20 --profile futures` |
| 查询本人成交记录 | `ai-hub futures order trades --contract-name E-BTC-USDT --limit 20 --profile futures` |
| 查询当前条件单和止盈止损单 | `ai-hub futures order triggers --contract-name E-BTC-USDT --page 1 --limit 20 --profile futures` |

普通订单详情必须指定合约，并在 `--order-id` 和 `--client-order-id` 中选择一个，不能同时传入。ID 应始终按字符串保留。历史普通委托与成交查询必须指定合约，可选 `--from-id`。这里的成交记录是当前用户的私有成交，不是公共市场最近成交。

普通订单保留原始状态，并提供 `statusName`，例如 `NEW`（新委托）、`PART_FILLED`（部分成交）、`FILLED`（完全成交）、`CANCELED`（已撤销）、`PENDING_CANCEL`（撤销处理中）。“提交已受理”不能代替成交状态，“撤销处理中”也不能当作已撤销，应通过指定订单查询了解最新结果。

### 合约普通下单

`trade place` 用于普通限价单或市价单。本节及后续所有写命令都只生成预览。示例中的价格和数量用于说明语法，实际使用时应根据自己的意图和合约规则填写。

#### 明确开平仓意图

| 意图 | `--intent` | 下单方向 |
| --- | --- | --- |
| 开多 | `open-long` | BUY + OPEN |
| 开空 | `open-short` | SELL + OPEN |
| 平多 | `close-long` | SELL + CLOSE |
| 平空 | `close-short` | BUY + CLOSE |

仅说“买入”或“卖出”不能明确是开仓还是平仓。下单仍受账户现有持仓模式约束，订单请求不会自动修改持仓模式。

#### 明确数量和执行参数

| 参数 | 含义及规则 |
| --- | --- |
| `--contract-name` | `contracts` 返回的准确合约标识。 |
| `--type` | `LIMIT`（限价）或 `MARKET`（市价）。 |
| `--quantity` | 正数数量，单位由下方 `--unit` 决定。 |
| `--unit contracts` | 按“张”下单，必须是正整数，例如 `1`。 |
| `--unit coin` | 按币数量下单，例如 `0.001`；根据已核实的面值必须能精确转换为整数张，AI Hub 不会通过舍入替用户修改数量。 |
| `--unit value` | 按合约规则所标明币种的订单价值下单，交易所使用参考价或执行价向下换算为整数张。这不是保证金预算，也不保证最终张数精确固定。 |
| `--margin-mode` | 明确指定 `cross`（全仓）或 `isolated`（逐仓）。 |
| `--price` | 限价单必填；市价单不传。 |
| `--time-in-force` | 普通限价单可选 `IOC`、`FOK`、`POST_ONLY`；市价单不传。 |
| `--client-order-id` | 可选，最多 31 个字符。不传时 AI Hub 在预览前自动生成，并在该次提交中保持不变。 |

```bash
## 预览：逐仓限价开多 1 张。
ai-hub futures trade place --contract-name E-BTC-USDT \
  --intent open-long --type LIMIT --quantity 1 --unit contracts \
  --margin-mode isolated --price 60000 --profile futures

## 预览：逐仓市价开空 1 张。
ai-hub futures trade place --contract-name E-BTC-USDT \
  --intent open-short --type MARKET --quantity 1 --unit contracts \
  --margin-mode isolated --profile futures

## 预览：市价平多 1 张。
## 实际仓位及所选保证金模式必须与账户情况相符。
ai-hub futures trade place --contract-name E-BTC-USDT \
  --intent close-long --type MARKET --quantity 1 --unit contracts \
  --margin-mode isolated --profile futures
```

展示并核对其中一份预览后，Agent 必须停止，等待用户新发一条明确确认消息。收到后才能执行与该预览对应的确认命令：

```bash
ai-hub confirm --profile futures \
  --confirmation-id <confirmation-id> \
  --user-confirmation "确认执行这份预览"
```

不能把确认命令作为下单脚本的自动下一步。数量、价格、方向等参数变化时，必须重新生成预览。详见[安全](gitbook/zh/05-an-quan.md)。

### 合约条件单与止盈止损

#### 条件单

`trade condition` 在确认后向交易所提交一笔包含触发价的条件订单，由交易所监测条件并触发；Agent 不会持续盯盘，再等价格到了临时提交一笔新单。

除普通订单的合约、开平仓意图、数量、单位、保证金模式和类型外，还需要：

| 参数 | 含义 |
| --- | --- |
| `--trigger-price` | 必填的正数触发价。 |
| `--trigger-type` | `3UP` 为向上触发方向，`4DOWN` 为向下触发方向。 |
| `--price` | LIMIT 的委托限价；MARKET 不传。触发价用于判断触发条件，委托限价用于限制触发后的执行价格。 |

```bash
## 预览：由交易所按向上触发条件执行一笔限价开多单。
ai-hub futures trade condition --contract-name E-BTC-USDT \
  --intent open-long --type LIMIT --quantity 1 --unit contracts \
  --margin-mode isolated --trigger-type 3UP \
  --trigger-price 65000 --price 65100 --profile futures
```

触发方向不决定多空或开平仓，交易意图由 `--intent` 指定。该命令不提供 `--time-in-force` 和 `--client-order-id`。实际触发、执行受交易所触发规则和市场情况影响，触发成功不等于保证成交。

#### 仓位止盈止损

`trade profit-loss` 面向已有仓位，传入 `--contract-name`、平仓方向 `--side` 和包含 1–5 条明细的 `--order-list`。多仓平仓使用 `SELL`，空仓平仓使用 `BUY`。AI Hub 必须找到唯一匹配的仓位，并校验每条明细的数量不超过该仓位数量。

| `--order-list` 内的字段 | 含义 |
| --- | --- |
| `triggerType` | 数字 `1` 为止损，`2` 为止盈；与普通条件单的 `3UP` / `4DOWN` 是不同枚举。 |
| `type` | 数字 `1` 为限价，`2` 为市价。 |
| `volume` | 正整数张数，使用字符串，例如 `"1"`。 |
| `triggerPrice` | 正数触发价，使用字符串。 |
| `price` | 限价必填的字符串价格；市价不传。 |

```bash
## 预览：给已有多仓设置一条市价止损和一条市价止盈。
ai-hub futures trade profit-loss --contract-name E-BTC-USDT --side SELL \
  --order-list '[
    {"triggerType":1,"type":2,"volume":"1","triggerPrice":"58000"},
    {"triggerType":2,"type":2,"volume":"1","triggerPrice":"68000"}
  ]' --profile futures
```

确认前逐条核对。该命令将这些触发订单一起提交给交易所，但不承诺 OCO 行为，也不保证一条触发后另一条自动撤销。应保留返回 ID，并通过支持的订单查询查看状态。

### 合约撤单

| 场景 | 命令及范围 |
| --- | --- |
| 单笔普通单 | `order cancel` 必须提供合约和交易所 `orderId`；若只有客户端 ID，先查询详情取得订单 ID。 |
| 全部普通单 | `order cancel-all --scope all-ordinary-orders` 针对执行时该合约账户所有合约的普通委托。 |
| 单笔或多笔条件单 | `order cancel-trigger` 必须提供合约，并在 `--order-id`、`--order-ids`、`--client-id` 中选择一个。 |

```bash
## 预览撤销一笔普通单。
ai-hub futures order cancel --contract-name E-BTC-USDT \
  --order-id <order-id> --profile futures

## 预览撤销合约账户下的全部普通委托。
ai-hub futures order cancel-all --scope all-ordinary-orders --profile futures

## 预览撤销一笔条件单。
ai-hub futures order cancel-trigger --contract-name E-BTC-USDT \
  --order-id <trigger-order-id> --profile futures

## 预览撤销明确指定的多笔条件单。
ai-hub futures order cancel-trigger --contract-name E-BTC-USDT \
  --order-ids '["<trigger-order-id-1>","<trigger-order-id-2>"]' --profile futures
```

全部撤单不接受合约过滤。预览会展示当前查询到的普通委托数量，但执行范围不锁定在预览订单上：预览后、执行前新增的普通委托也可能被撤销。该操作不撤条件单、不平仓。只有用户明确要求撤销合约账户全部普通委托时才使用，并继续遵循单独确认流程。

AI Hub 每次条件单撤销接受 1–50 个不重复 ID，交易所还可能有额外限制。不传选择条件不会被解释为“撤销全部条件单”。本期不支持普通单批量下单和指定多笔普通单批量撤销，也不会通过循环写请求模拟这些能力。

### 合约交易设置

以下四类设置均只生成预览，必须像下单一样等待用户下一条消息明确确认。

| 设置 | 必填参数 | 作用范围及检查 |
| --- | --- | --- |
| 持仓模式 | `--contract-name`，`--position-model 1`（单向）或 `2`（双向） | 作用于整个合约账户，虽然接口要求传合约。有现存仓位或普通委托时不能修改。 |
| 保证金模式 | `--contract-name`，`--margin-model 1`（全仓）或 `2`（逐仓） | 作用于指定合约，该合约有现存仓位或普通委托时不能修改。 |
| 逐仓保证金 | `--position-id`，`--amount` | 指定本人未冻结的逐仓仓位。正数增加、负数减少，单位为该仓位保证金币种，金额不能为零。 |
| 杠杆 | `--contract-name`，`--now-level` | 作用于指定合约，必须是合约允许范围内的正整数。 |

```bash
## 预览：将合约账户持仓模式修改为双向。
ai-hub futures trade position-mode --contract-name E-BTC-USDT \
  --position-model 2 --profile futures

## 预览：将指定合约改为逐仓模式。
ai-hub futures trade margin-mode --contract-name E-BTC-USDT \
  --margin-model 2 --profile futures

## 预览：给指定仓位增加 10 个单位的保证金币种金额。
ai-hub futures trade position-margin --position-id <position-id> \
  --amount 10 --profile futures

## 预览：将指定合约杠杆设为 5 倍。
ai-hub futures trade leverage --contract-name E-BTC-USDT \
  --now-level 5 --profile futures
```

Agent 不会为了满足前置条件自动撤单、平仓或修改其他设置。当前值无法核实时，应标明未知，不能编造“当前值 → 目标值”。实际提交仍受交易所风控规则约束。

### 现货与合约互转

两个方向都使用现有钱包命令及 `--profile spot`，账户类型 `1` 代表现货，`5` 代表合约。首次准备划转前，请先完成[安全](gitbook/zh/05-an-quan.md)中的账户配对验证。

```bash
## 通过现货 API 查询合约账户可划转资产。
ai-hub wallet transferable-assets --account-type 5 --profile spot

## 预览：从合约转回现货 10 USDT。
ai-hub wallet transfer --from-account-type 5 --to-account-type 1 \
  --coin-symbol USDT --amount 10 --profile spot

## 查询同一方向的划转记录。
ai-hub wallet transfer-history --from-account-type 5 --to-account-type 1 \
  --page 1 --page-size 20 --profile spot
```

从现货转入合约时，使用 `--from-account-type 1 --to-account-type 5`，与前文钱包示例一致。划转的确认命令同样使用 `--profile spot`。不能把合约权益当作可划转余额，划转前应查询专门的可划转资产。

### 合约分页、时间范围与调用频率

支持 `--limit` 的合约命令默认返回 20 条，单次最多 50 条。不同命令使用各自支持的分页字段：

| 查询 | 如何继续 |
| --- | --- |
| 合约列表、当前普通委托 | 将返回的 `continuation.cursor` 传给 `--cursor`。它是本次响应的本地快照分页，有效期 5 分钟，并绑定 Profile 和过滤条件；不能据此推断交易所返回了全部记录。 |
| 历史盈亏 | 存在 `continuation.fromId` 时，将它传给 `--from-id`，不要按展示的最后一行自行计算。 |
| 历史普通委托、用户成交 | 支持 ID 下界 `--from-id`；不保证能完整倒序遍历全部历史，也不能自行编造下一页游标。 |
| 资金流水、条件单列表 | 按返回的 `continuation.page` 继续，并保持原过滤条件和页大小。某页资金流水没有展示记录，仍可能存在下一页。 |
| 当前仓位 | 支持数量限制和过滤，不支持游标。结果被截断时，不能称为完整仓位列表。 |

游标是告诉下一次查询“从哪里继续”的标记，可能是 ID，也可能是快照令牌，不一定是页码。应使用返回的续查信息；有截断或覆盖范围不明时如实说明，不能宣称已查询全部历史。

支持的时间过滤使用 Unix 毫秒时间戳，起止时间必须成对提供，每次最多跨度半年。AI Hub 在本地限制同一合约接口最快每秒调用一次，交易所还可能有更严格的限制。临时性读取失败最多重试一次；写请求包括超时在内都不会自动重试。

MCP 工具名称与 HTTP 操作对应关系见[完整合约操作表](gitbook/futures-operations.md)。


## 04 Skills

Skills 是给 AI Agent 读取的 Markdown 操作规则。它们告诉 Agent 应在什么场景下调用 `ai-hub` CLI、如何传参，以及何时必须停止等待人工确认。

Skills 与 MCP 相互独立：

* Skills 优先调用匹配的 MCP 工具；MCP 不可用时使用 CLI；
* MCP 通过 `ai-hub-trade-mcp` 提供本地结构化工具；
* 两者共享本地 Profile 和同一套写操作确认边界；
* 安装 Skills 不会自动配置 MCP，安装 MCP 也不会自动安装 Skills。

### 安装

先安装 CLI 并完成 Profile 配置，再执行：

```bash
npx skills add exhcange/ai-hub-agent-trade
```

不支持 `npx skills` 的客户端，可手动加载 [Skills 仓库](gitbook/zh/07-xiang-guan-lian-jie.md)中的 `skills/` 子目录。

安装时选择你使用的客户端，并选择现货与合约共 12 个 `ai-hub-*` Skills。此命令从同一个 AI Hub 仓库安装两个产品的规则；MCP 注册和 Profile 配置仍按前面章节单独完成。

### Skill 列表

| Skill                          | 用途                        |
| ------------------------------ | ------------------------- |
| `ai-hub-spot`                  | 将需求路由到对应的现货子 Skill。       |
| `ai-hub-spot-common`           | 行情、币对、Ticker、订单簿、成交和 K 线。 |
| `ai-hub-spot-order`            | 现货订单查询、下单、撤单和订单安全规则。      |
| `ai-hub-spot-account`          | 单资产余额查询。                  |
| `ai-hub-spot-deposit-withdraw` | 钱包查询、划转、充值和提现工作流。         |
| `ai-hub-spot-sub-account`      | 子账户工作流。                   |

Skill 正文采用英文编写，命令和安全边界与当前 CLI 一致。对于参数完整的只读请求，Skill 会优先直接执行准确命令；只有首次配置、参数歧义、业务错误或需要诊断时，才读取更多参考说明。

### 推荐请求方式

```
使用 AI Hub 查询 BTCUSDT 的订单簿前 20 档。
```

```
使用 AI Hub 查询我的 ETH 可用余额，profile 为 spot。
```

```
使用 AI Hub 以市价花费 100 USDT 买入 ETH；先给我订单预览，等待我下一条消息确认。
```

避免模糊表达：

* 不要说“市价买入 1 ETH”；
* 应说“花费 100 USDT 市价买入 ETH”；
* 市价卖出时才使用基础资产数量，例如“市价卖出 0.5 ETH”。

### 合约 Skills

在六个现货 Skill 的基础上，同时安装六个合约 Skill。路由 Skill 会选择具体领域的 Skill，用户不需要记住 MCP 工具名称或 CLI 参数。

| Skill | 用途 | 用户应提供的信息 |
| --- | --- | --- |
| `ai-hub-futures` | 识别合约意图，分发给对应 Skill。 | 产品及查询或操作目标；交易前消除歧义。 |
| `ai-hub-futures-common` | 合约、交易规则、深度、行情、指数价/标记价、资金费率和 K 线。 | 合约；需要时指定 K 线周期或结果数量。 |
| `ai-hub-futures-account` | 资产、当前仓位、历史盈亏和资金流水。 | 按需指定币种或合约；查询时间段时提供日期。 |
| `ai-hub-futures-order` | 普通单详情/当前/历史委托、本人成交、当前条件单及支持的撤单。 | 合约、订单 ID、普通单或条件单类别；全部撤单需明确范围。 |
| `ai-hub-futures-trade` | 普通单、条件单、仓位止盈止损和四类交易设置。 | 开平仓及多空方向、数量及单位、保证金模式、类型，以及适用的价格和触发价；设置操作需目标值与合约或仓位 ID。 |
| `ai-hub-futures-transfer` | 通过现货 API 查询可划转资产、记录并进行现货/合约互转。 | 方向、币种、金额；首次划转前验证账户配对。 |

#### 行情与合约规则

```text
用 AI Hub 查一下当前平台有哪些 BTC 合约。
查看 E-BTC-USDT 的合约面值、价格精度、最小下单数量和杠杆范围。
查看 E-BTC-USDT 合约买卖盘前 20 档。
查看 E-BTC-USDT 合约最近 20 根一小时 K 线。
```

名称不明确时，Agent 先确定准确合约。它会按需返回有限数量的数据，不会默认加载全部市场，也不会直接把现货币对当作合约标识。

#### 资产、仓位与历史

```text
查看我的 USDT 合约资产和 E-BTC-USDT 当前仓位，仓位数量用张展示。
查看 UTC 2026 年 9 月 1 日至 9 月 7 日 E-BTC-USDT 的合约历史盈亏。
查看同一 UTC 时间段的 USDT 合约资金流水，先返回 20 条。
查询我的余额，分别展示现货和合约。
```

账户 Skill 会区分金额与张数。资产查询不等于仓位查询，历史盈亏也不等于完整资金流水。日期范围应说明时区，或由 Agent 在调用前澄清；每次范围最多半年。

#### 订单查询与撤单

```text
查看 E-BTC-USDT 当前合约普通委托，最多 20 条。
查看我的 E-BTC-USDT 合约成交记录。
查看 E-BTC-USDT 当前条件单和止盈止损单。
预览撤销 E-BTC-USDT 的普通合约订单 <order-id>。
预览撤销我合约账户下所有合约的全部普通委托，等待我下一条消息确认。
```

单笔撤单先明确订单类别与准确 ID。全部撤单是执行时跨合约的全部普通委托，不包含条件单，也不平仓。明确给出多个条件单 ID 时，可以一起准备撤销。

#### 普通下单

```text
预览 E-BTC-USDT 逐仓限价开多 1 张，价格 60000。
预览 E-BTC-USDT 逐仓市价开空 1 张。
预览把我 E-BTC-USDT 的逐仓多仓市价平掉 1 张。
```

这些价格与数量仅为表达示例。Agent 会读取合约规则、检查请求并展示预览，然后停止等待新的用户确认。

| 容易产生歧义的说法 | 更明确的表达方式 |
| --- | --- |
| “买 1 个 BTC 合约。” | 指定准确合约、开多还是平空，以及“1”指 1 张还是 1 BTC。 |
| “用 100 USDT 开仓。” | 说明 100 USDT 是订单价值还是保证金预算，并指定方向、数量口径和保证金模式；Agent 不能假设杠杆把预算换算成订单。 |
| “把 BTC 平了。” | 指定合约、多仓还是空仓、平仓张数以及市价或限价。 |
| “调成 5 倍。” | 指定合约，并要求预览将该合约杠杆修改为 5 倍。 |

#### 条件单与止盈止损

```text
预览 E-BTC-USDT 逐仓限价开多条件单，数量 1 张，
向上触发价 65000，触发后的委托限价 65100。
等我下一条确认后，把这笔触发订单提交给交易所。
```

```text
给我已有的 E-BTC-USDT 多仓预览一组止盈止损：
1 张，市价止损触发价 58000，市价止盈触发价 68000。
展示两条触发明细，等待我下一条消息确认。
```

这些触发订单由交易所接收并监测，Skill 不会安排 Agent 盯盘。触发方向、执行价格、开平仓意图是不同参数。仓位止盈止损最多五条，并要求能明确识别匹配仓位；不能默认一条执行后会自动撤销另一条。

#### 交易设置

```text
预览把我的合约账户改为双向持仓模式，接口要求的合约参数使用 E-BTC-USDT。
预览把 E-BTC-USDT 改为逐仓模式。
预览给逐仓仓位 <position-id> 增加 10 USDT 保证金。
预览把 E-BTC-USDT 杠杆改为 5 倍。
```

Agent 会核对合约或仓位并说明范围。持仓模式影响整个合约账户，保证金调整的币种必须匹配该仓位。如果现有仓位或委托阻止模式变更，Agent 应说明前置条件，不会自行清理。

#### 现货与合约划转

```text
查询我可以从现货转入合约的 USDT 金额。
预览从现货转入合约 10 USDT。
预览从合约转回现货 10 USDT。
查看从合约转到现货的前 20 条划转记录。
```

两个方向包括确认步骤都使用 `spot`。划转 Skill 查询专门的可划转余额，并要求事先完成账户配对验证；仅凭两个 Profile 名称相似不能证明账户对应关系。

#### 能力边界

上述所有改变状态的示例均停在预览。安装 Skill 不会绕过确认、API 权限或 MCP 只读配置。MCP 写操作结果不确定时，Agent 不能改用 CLI 重复执行。

本期合约不支持公共市场最近成交、普通单批量下单、指定多笔普通单批量撤销和全合约行情汇总接口；跟单、KOL、网格、机器人和 WebSocket 仍不纳入。不会通过循环写请求模拟未支持能力。原有现货能力继续由现货 Skill 提供。


## 05 安全

### 凭证安全

请为 AI Hub 单独创建 API 凭证，并按最小权限原则授权。

* 只查看行情时，不需要 API Key；
* 查询账户、订单、钱包时，需要相应的只读权限；
* 下单、撤单、划转等状态改变操作，需要对应交易或资金权限；
* 不要把 API Key、Secret Key、`~/.ai-hub/config.toml` 或终端历史上传到 GitHub、聊天记录或共享文档；
* 建议按平台能力配置 IP 白名单、权限范围和有效期。

当前版本将凭证保存于本机 `~/.ai-hub/config.toml`，配置目录权限为 `700`，配置文件权限为 `600`。`ai-hub config show` 不会打印密钥值，但本机账户和磁盘安全仍由使用者负责。

### 所有写操作必须二次确认

下单、撤单、划转、提现、子账户变更等改变状态的操作，均遵循以下流程：

{% stepper %}
{% step %}

### 生成预览

Agent 或 CLI 调用写操作，只校验参数并返回**预览**。
{% endstep %}

{% step %}

### 查看预览

预览包含操作摘要、`confirmationId` 和过期时间。
{% endstep %}

{% step %}

### 等待用户确认

Agent 必须停止，等待用户在预览**之后**发送一条新的、明确的确认消息。
{% endstep %}

{% step %}

### 执行确认

收到新消息后，才可使用 `confirmationId` 执行确认。
{% endstep %}

{% step %}

### 确认记录失效

确认记录只可消费一次，默认 5 分钟后失效。
{% endstep %}
{% endstepper %}

CLI 示例：

```bash
## 第一步：只生成预览，不会提交订单
ai-hub spot order market-sell \
  --symbol ETHUSDT \
  --base-quantity 0.5 \
  --profile spot

## 第二步：仅在收到新的用户明确确认后执行
ai-hub confirm \
  --confirmation-id <confirmation-id> \
  --user-confirmation "yes" \
  --profile spot
```

MCP 中的规则相同：先调用对应 `*_prepare_*` 工具，展示预览并停止；只有收到新的用户确认消息后，才可调用 `confirm_action`。Agent 不得自行生成、猜测或重复使用确认文本。

### 下单前本地规则检查

创建现货订单预览前，系统会按 Profile 懒加载并缓存币对规则，包括价格精度、数量精度和最小下单限制。缓存有效期为 1 小时。已知的精度或最小值不符合时会在本地直接拒绝，避免生成不可执行预览。

本地检查不代表成交保证。下单前后的余额、价格、市场状态和服务端风控规则都可能变化。若写操作返回网络不确定错误，请不要自动重试；应先按客户端订单号或历史记录核实最终结果。

### 合约预览与确认

合约十类写操作全部遵循同一流程，包括撤单和四类交易设置。“下单并自动确认”这样的初始请求不能代替预览之后的新确认消息。

确认前应核对实际返回的预览：

| 操作 | 核对内容 |
| --- | --- |
| 所有合约操作 | `futures` Profile、准确操作、作用范围、确认 ID 和有效期。 |
| 普通下单 | 合约、开平仓及多空方向、限价/市价、数量和单位、全仓/逐仓、适用时的价格、客户端订单 ID。 |
| 条件单 | 全部下单参数，以及触发方向、触发价、执行价格/类型；确认由交易所负责触发。 |
| 仓位止盈止损 | 目标合约及匹配仓位、平仓方向、每一条触发明细和对应张数。 |
| 单笔普通单/条件单撤销 | 正确的订单类别、合约和准确 ID 或指定 ID 列表。 |
| 全部普通委托撤销 | 执行时的全账户范围、当前观察到的委托数量及覆盖限制；不包含条件单和仓位。 |
| 交易设置 | 目标模式/杠杆或保证金增减金额、影响的账户/合约/仓位；当前值仅在已核实时展示。 |
| 现货/合约划转 | `spot` Profile、来源和目标账户类型、币种、金额及来源可划转余额。 |

例如，用户要求“预览 E-BTC-USDT 逐仓限价开多 1 张，价格 60000”后，Agent 展示预览并停止。用户随后发送“确认执行这份预览”，Agent 才确认这一笔。如果用户改成另一个价格或数量，应重新预览并再次等待确认。

确认记录绑定原 Profile、配置、凭证和已准备请求，只能在原 Profile 消费一次。预览过期后要重新准备，不能复用旧确认，也不能把最初的下单要求当作后续确认。

#### 合约前置检查与作用范围

合约订单准备阶段会核对目标合约规则、价格精度和数量上下限，按币下单的数量必须能精确换算为整数张。确认执行时还会重复相关前置检查，因为预览后条件可能已经变化。

持仓模式修改影响整个账户，要求没有有效仓位和普通委托；保证金模式修改作用于指定合约，要求没有相关仓位和普通委托；保证金调整要求目标为本人未冻结的逐仓仓位；止盈止损要求能识别唯一匹配仓位。实际执行仍受交易所约束，本地检查不能保证受理或成交。

Agent 不得为了满足这些条件自动撤单、平仓或修改设置。无法查证的当前设置应在预览中保留为未知，不能由空仓位列表推测出来。

全部撤单针对**执行时合约账户内的全部普通委托**，不锁定为预览快照中的固定订单。新增普通委托也可能被撤销，因此只有用户意图确实是全账户普通委托撤销时才确认。

#### 提交结果与超时

提交成功可能返回 `accepted: true` 和 `executionVerified: false`，含义是请求已受理，不能据此认定订单成交、设置已达到目标值或所有委托均已撤销。

合约写请求永不自动重试。遇到超时或其他不确定结果时：

1. 保留原订单/操作标识，明确说明结果未知。
2. 使用支持的只读证据查证，例如按原客户端订单 ID 查询普通单详情。仅凭当前列表中没有该订单或余额发生变化，不足以证明执行结果。
3. 仍无法确认时保留待处理状态，取得平台或操作者的可靠证据后处理。不能生成替代订单、换客户端 ID、改走 CLI，或重复保证金调整和划转。

待处理状态保存在本地，并阻止重叠写操作，直到取得可靠证据完成处理。以下命令只查看状态，不向交易所提交写请求：

```bash
## 合约操作状态。
ai-hub futures operation-status --profile futures

## 通过现货 Profile 提交的现货/合约划转状态。
ai-hub futures operation-status --profile spot --transfer
```

查证期间仍需遵守查询频率限制。重复轮询不能让结果未知的请求变得可以安全重发。

### 现货与合约划转验证

两个方向都使用 `spot` Profile 的现货 API：`1 → 5` 为现货转合约，`5 → 1` 为合约转现货。首次划转前，操作者应独立确认两个 Profile 属于预期的同用户、同租户账户，再登记非敏感证明编号：

```bash
ai-hub config pair-products --evidence-id <non-secret-evidence-id> --operator-verified
```

此命令记录操作者已经完成的验证，不会通过 API 自动证明账户身份，也不是划转授权。每次划转仍需查询来源可划转余额、展示完整预览，并在现货 Profile 收到新的明确确认。

需要划转时配置现货侧对应权限，只读 MCP 不暴露划转预览或确认工具。不要为了现货/合约划转额外授予提现等无关权限。

修改 Profile 端点会清除旧端点绑定的凭证，应在本地配置正确凭证；账户配对所依据的配置变化后也需重新验证。不要把凭证复制到猜测的域名。


## 06 常见问题

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
## 更新 CLI 与 MCP
npm install -g @aihubspot/agent-trade-cli@latest @aihubspot/agent-trade-mcp@latest

## 再次安装/更新 Skills；具体更新行为取决于所使用的 Skills 客户端
npx skills add exhcange/ai-hub-agent-trade
```

更新 MCP 后，建议重新执行 `setup`，再重启或刷新目标 AI 客户端。

</details>

### 合约常见问题

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

不是。应根据该查询返回的续查信息继续。游标可能是 ID 下界或本地快照令牌，也有接口按页码翻页。没有续查字段也不能证明交易所全部历史已经返回。显式时间范围每次最多半年，各查询支持的字段见[命令行](gitbook/zh/03-ming-ling-xing.md)。

</details>

<details>

<summary>下单、改设置或划转超时后，可以直接重试吗？</summary>

不能自动重发。超时可能是交易所已执行，但响应丢失。应保留原标识，通过支持的只读证据查证，未确认前明确报告结果未知。不能换客户端订单 ID、改调用方式或换 Profile 绕过待处理操作。详见[安全](gitbook/zh/05-an-quan.md)。

</details>

<details>

<summary>为什么合约转现货也使用 spot Profile？</summary>

两个方向都复用现货侧划转 API，账户类型为 `1`（现货）和 `5`（合约），所以预览和确认均使用 `spot`。首次先验证账户配对，随后查询来源可划转余额。若现货 MCP 为只读或现货 API 凭证没有划转权限，仅有合约写权限仍不能划转。

</details>

<details>

<summary>为什么现货和合约余额分开展示，不给一个总数？</summary>

两个产品的字段口径不同，合约权益、保证金和未实现盈亏也不能作为独立余额重复相加，因此保留分项展示。一侧查询失败会标记不可用，不能让部分结果看起来像完整的余额总览。

</details>


## 07 相关链接

### 项目与安装包

* [AI Hub Agent Trade：CLI + MCP 源码](https://github.com/exhcange/ai-hub-agent-trade)
* [AI Hub Agent Skills：Skills 源码](https://github.com/exhcange/ai-hub-agent-trade/tree/main/skills)
* [CLI npm 包：@aihubspot/agent-trade-cli](https://www.npmjs.com/package/@aihubspot/agent-trade-cli)
* [MCP npm 包：@aihubspot/agent-trade-mcp](https://www.npmjs.com/package/@aihubspot/agent-trade-mcp)

### 本地帮助

以当前安装版本的命令帮助作为参数和能力的最终依据：

```bash
ai-hub --help
ai-hub-trade-mcp --help
```

### 文档版本说明

{% hint style="info" %}
本操作手册用于说明当前已发布的常用能力。若文档与 CLI/MCP 实际行为不一致，应以 GitHub 最新代码、npm 发布版本和本机 `--help` 输出为准。
{% endhint %}


### 合约

- [Futures OpenAPI](https://exchangedocsv2.gitbook.io/open-api-doc-v2/futures)
- [合约操作映射](gitbook/futures-operations.md)
