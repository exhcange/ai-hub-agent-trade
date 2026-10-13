# 03 命令行

CLI 命令入口为 `ai-hub`。使用 `ai-hub --help` 查看当前版本的完整可用命令和参数。

{% hint style="info" %}
建议在脚本和 Agent 指令中始终传入 `--profile <name>`，避免跨租户调用。
{% endhint %}

## 市场数据

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

## 账户和订单查询

```bash
# 查询 ETH 的可用、冻结和总余额
ai-hub account asset-balance --asset ETH --profile spot

# 查询指定订单
ai-hub spot order get --symbol ETHUSDT --order-id <order-id> --profile spot

# 查询当前委托和成交记录
ai-hub spot order open --symbol ETHUSDT --limit 20 --profile spot
ai-hub spot order fills --symbol ETHUSDT --limit 20 --profile spot
```

## 现货下单

CLI 不使用有歧义的通用 `volume` 参数；请根据订单类型使用明确的资产单位：

| 场景      | 数量参数                          | `ETHUSDT` 示例         |
| ------- | ----------------------------- | -------------------- |
| 市价买入    | `--quote-amount`              | 花费多少 USDT。           |
| 市价卖出    | `--base-quantity`             | 卖出多少 ETH。            |
| 限价买入/卖出 | `--base-quantity` 和 `--price` | 买卖多少 ETH，价格以 USDT 计。 |

```bash
# 花费 100 USDT 市价买入 ETH
ai-hub spot order market-buy --symbol ETHUSDT --quote-amount 100 --profile spot

# 市价卖出 0.5 ETH
ai-hub spot order market-sell --symbol ETHUSDT --base-quantity 0.5 --profile spot

# 以 1,800 USDT 的限价买入 1 ETH
ai-hub spot order limit --symbol ETHUSDT --side BUY --base-quantity 1 --price 1800 --profile spot

# 卖出当前可执行的全部 ETH；预览会显示可卖数量和精度截断后的剩余量
ai-hub spot order sell-available --symbol ETHUSDT --profile spot
```

{% hint style="info" %}
市价买入只能指定花费的计价币金额，无法保证成交后恰好获得某个基础币数量。若目标是“买入恰好 1 ETH”，请使用限价单，或先明确允许花费的 USDT 金额。
{% endhint %}

## 撤单和批量操作

```bash
# 撤销单个订单
ai-hub spot order cancel --symbol ETHUSDT --order-id <order-id> --profile spot

# 批量下单：--orders 为 JSON 数组，单次最多 10 笔
ai-hub spot order batch-place --symbol ETHUSDT --orders '[
  {"side":"BUY","type":"LIMIT","baseQuantity":"0.1","price":"1600"},
  {"side":"SELL","type":"LIMIT","baseQuantity":"0.1","price":"2000"}
]' --profile spot

# 批量撤单：--order-ids 为 JSON 数组，单次最多 10 笔
ai-hub spot order batch-cancel --symbol ETHUSDT --order-ids '["<order-id-1>","<order-id-2>"]' --profile spot
```

所有写命令仅生成预览。确认执行方式见[安全](05-an-quan.md)。

## 钱包和万向划转

```bash
# 查询现货账户（类型 1）可划转资产
ai-hub wallet transferable-assets --account-type 1 --profile spot

# 查询 USDT 充值地址和充值历史
ai-hub wallet deposit-address --main-coin-symbol USDT --profile spot
ai-hub wallet deposit-history --page 1 --page-size 20 --profile spot

# 查询现货到衍生品账户的划转记录
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
# 从现货账户划转 10 USDT 到衍生品账户；只会生成预览
ai-hub wallet transfer \
  --from-account-type 1 \
  --to-account-type 5 \
  --coin-symbol USDT \
  --amount 10 \
  --profile spot
```

## 合约市场数据

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

## 合约资产与仓位

资产和仓位是合约账户的两个独立查询视图，均需要合约账户的只读凭证。

```bash
# 查询资产，或仅查看指定保证金币种。
ai-hub futures account assets --profile futures
ai-hub futures account assets --asset USDT --profile futures

# 查询当前仓位，可按合约及保证金币种过滤。
ai-hub futures account positions --limit 20 --profile futures
ai-hub futures account positions --contract-name E-BTC-USDT --asset USDT --limit 20 --profile futures
```

| 查询内容 | 结果如何理解 |
| --- | --- |
| 资产 | 账户资金、冻结资金、保证金、权益、未实现盈亏按接口返回的独立字段展示。资产金额保留两位小数，例如 `123.456` 展示为 `123.46`。 |
| 仓位 | 展示有效且持仓数量大于零的当前仓位；根据返回字段查看合约、方向、仓位 ID、数量、保证金模式和杠杆。空仓位列表不能证明账户当前的持仓模式或杠杆。 |
| 委托、成交和仓位数量 | 标有 `quantityUnit: "contracts"` 的数量字段使用“张”，例如 `volume: "124"` 为 124 张。价格、金额、ID 和市场成交量字段不套用这一单位。 |

只说“查询余额”而未指定产品时，Agent 会分别查询 `spot` 和 `futures`，分项展示。不会把两个产品直接相加，也不会把未实现盈亏再次加到权益上。一侧查询失败时，该侧结果为不可用，整体查询不完整，不能将失败视为零余额。

### 历史盈亏与资金流水

```bash
# 查询一个合约的一页历史盈亏。
ai-hub futures account profit-history --contract-name E-BTC-USDT --limit 20 --profile futures

# 查询 UTC 2026 年 9 月 1 日 00:00 至 9 月 2 日 00:00 的 USDT 流水。
# 起止时间使用 Unix 毫秒时间戳。
ai-hub futures account transactions --symbol USDT \
  --begin-time 1788220800000 --end-time 1788307200000 \
  --page 1 --limit 20 --profile futures
```

`profit-history` 可选 `--contract-name`、`--from-id`，以及配套使用的 `--start-time` / `--end-time`，展示返回的历史盈亏和费用组成。`transactions` 必须提供资产 `--symbol`、`--begin-time` 和 `--end-time`，使用 `--page` 分页，也可传入 `--type`。资金流水的 `symbol` 是币种，不是合约名称。

资金流水包含所支持的普通账户业务，例如分摊、手续费分成、赠金、公私转账和商户风险准备金分成。可选业务类型为 `1`–`13` 和 `28`，选择具体类型时应参照平台业务类型定义。每次显式查询时间跨度最多半年，具体翻页方式见本章末尾。

## 合约订单查询

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

## 合约普通下单

`trade place` 用于普通限价单或市价单。本节及后续所有写命令都只生成预览。示例中的价格和数量用于说明语法，实际使用时应根据自己的意图和合约规则填写。

### 明确开平仓意图

| 意图 | `--intent` | 下单方向 |
| --- | --- | --- |
| 开多 | `open-long` | BUY + OPEN |
| 开空 | `open-short` | SELL + OPEN |
| 平多 | `close-long` | SELL + CLOSE |
| 平空 | `close-short` | BUY + CLOSE |

仅说“买入”或“卖出”不能明确是开仓还是平仓。下单仍受账户现有持仓模式约束，订单请求不会自动修改持仓模式。

### 明确数量和执行参数

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
# 预览：逐仓限价开多 1 张。
ai-hub futures trade place --contract-name E-BTC-USDT \
  --intent open-long --type LIMIT --quantity 1 --unit contracts \
  --margin-mode isolated --price 60000 --profile futures

# 预览：逐仓市价开空 1 张。
ai-hub futures trade place --contract-name E-BTC-USDT \
  --intent open-short --type MARKET --quantity 1 --unit contracts \
  --margin-mode isolated --profile futures

# 预览：市价平多 1 张。
# 实际仓位及所选保证金模式必须与账户情况相符。
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

不能把确认命令作为下单脚本的自动下一步。数量、价格、方向等参数变化时，必须重新生成预览。详见[安全](05-an-quan.md)。

## 合约条件单与止盈止损

### 条件单

`trade condition` 在确认后向交易所提交一笔包含触发价的条件订单，由交易所监测条件并触发；Agent 不会持续盯盘，再等价格到了临时提交一笔新单。

除普通订单的合约、开平仓意图、数量、单位、保证金模式和类型外，还需要：

| 参数 | 含义 |
| --- | --- |
| `--trigger-price` | 必填的正数触发价。 |
| `--trigger-type` | `3UP` 为向上触发方向，`4DOWN` 为向下触发方向。 |
| `--price` | LIMIT 的委托限价；MARKET 不传。触发价用于判断触发条件，委托限价用于限制触发后的执行价格。 |

```bash
# 预览：由交易所按向上触发条件执行一笔限价开多单。
ai-hub futures trade condition --contract-name E-BTC-USDT \
  --intent open-long --type LIMIT --quantity 1 --unit contracts \
  --margin-mode isolated --trigger-type 3UP \
  --trigger-price 65000 --price 65100 --profile futures
```

触发方向不决定多空或开平仓，交易意图由 `--intent` 指定。该命令不提供 `--time-in-force` 和 `--client-order-id`。实际触发、执行受交易所触发规则和市场情况影响，触发成功不等于保证成交。

### 仓位止盈止损

`trade profit-loss` 面向已有仓位，传入 `--contract-name`、平仓方向 `--side` 和包含 1–5 条明细的 `--order-list`。多仓平仓使用 `SELL`，空仓平仓使用 `BUY`。AI Hub 必须找到唯一匹配的仓位，并校验每条明细的数量不超过该仓位数量。

| `--order-list` 内的字段 | 含义 |
| --- | --- |
| `triggerType` | 数字 `1` 为止损，`2` 为止盈；与普通条件单的 `3UP` / `4DOWN` 是不同枚举。 |
| `type` | 数字 `1` 为限价，`2` 为市价。 |
| `volume` | 正整数张数，使用字符串，例如 `"1"`。 |
| `triggerPrice` | 正数触发价，使用字符串。 |
| `price` | 限价必填的字符串价格；市价不传。 |

```bash
# 预览：给已有多仓设置一条市价止损和一条市价止盈。
ai-hub futures trade profit-loss --contract-name E-BTC-USDT --side SELL \
  --order-list '[
    {"triggerType":1,"type":2,"volume":"1","triggerPrice":"58000"},
    {"triggerType":2,"type":2,"volume":"1","triggerPrice":"68000"}
  ]' --profile futures
```

确认前逐条核对。该命令将这些触发订单一起提交给交易所，但不承诺 OCO 行为，也不保证一条触发后另一条自动撤销。应保留返回 ID，并通过支持的订单查询查看状态。

## 合约撤单

| 场景 | 命令及范围 |
| --- | --- |
| 单笔普通单 | `order cancel` 必须提供合约和交易所 `orderId`；若只有客户端 ID，先查询详情取得订单 ID。 |
| 全部普通单 | `order cancel-all --scope all-ordinary-orders` 针对执行时该合约账户所有合约的普通委托。 |
| 单笔或多笔条件单 | `order cancel-trigger` 必须提供合约，并在 `--order-id`、`--order-ids`、`--client-id` 中选择一个。 |

```bash
# 预览撤销一笔普通单。
ai-hub futures order cancel --contract-name E-BTC-USDT \
  --order-id <order-id> --profile futures

# 预览撤销合约账户下的全部普通委托。
ai-hub futures order cancel-all --scope all-ordinary-orders --profile futures

# 预览撤销一笔条件单。
ai-hub futures order cancel-trigger --contract-name E-BTC-USDT \
  --order-id <trigger-order-id> --profile futures

# 预览撤销明确指定的多笔条件单。
ai-hub futures order cancel-trigger --contract-name E-BTC-USDT \
  --order-ids '["<trigger-order-id-1>","<trigger-order-id-2>"]' --profile futures
```

全部撤单不接受合约过滤。预览会展示当前查询到的普通委托数量，但执行范围不锁定在预览订单上：预览后、执行前新增的普通委托也可能被撤销。该操作不撤条件单、不平仓。只有用户明确要求撤销合约账户全部普通委托时才使用，并继续遵循单独确认流程。

AI Hub 每次条件单撤销接受 1–50 个不重复 ID，交易所还可能有额外限制。不传选择条件不会被解释为“撤销全部条件单”。本期不支持普通单批量下单和指定多笔普通单批量撤销，也不会通过循环写请求模拟这些能力。

## 合约交易设置

以下四类设置均只生成预览，必须像下单一样等待用户下一条消息明确确认。

| 设置 | 必填参数 | 作用范围及检查 |
| --- | --- | --- |
| 持仓模式 | `--contract-name`，`--position-model 1`（单向）或 `2`（双向） | 作用于整个合约账户，虽然接口要求传合约。有现存仓位或普通委托时不能修改。 |
| 保证金模式 | `--contract-name`，`--margin-model 1`（全仓）或 `2`（逐仓） | 作用于指定合约，该合约有现存仓位或普通委托时不能修改。 |
| 逐仓保证金 | `--position-id`，`--amount` | 指定本人未冻结的逐仓仓位。正数增加、负数减少，单位为该仓位保证金币种，金额不能为零。 |
| 杠杆 | `--contract-name`，`--now-level` | 作用于指定合约，必须是合约允许范围内的正整数。 |

```bash
# 预览：将合约账户持仓模式修改为双向。
ai-hub futures trade position-mode --contract-name E-BTC-USDT \
  --position-model 2 --profile futures

# 预览：将指定合约改为逐仓模式。
ai-hub futures trade margin-mode --contract-name E-BTC-USDT \
  --margin-model 2 --profile futures

# 预览：给指定仓位增加 10 个单位的保证金币种金额。
ai-hub futures trade position-margin --position-id <position-id> \
  --amount 10 --profile futures

# 预览：将指定合约杠杆设为 5 倍。
ai-hub futures trade leverage --contract-name E-BTC-USDT \
  --now-level 5 --profile futures
```

Agent 不会为了满足前置条件自动撤单、平仓或修改其他设置。当前值无法核实时，应标明未知，不能编造“当前值 → 目标值”。实际提交仍受交易所风控规则约束。

## 现货与合约互转

两个方向都使用现有钱包命令及 `--profile spot`，账户类型 `1` 代表现货，`5` 代表合约。首次准备划转前，请先完成[安全](05-an-quan.md)中的账户配对验证。

```bash
# 通过现货 API 查询合约账户可划转资产。
ai-hub wallet transferable-assets --account-type 5 --profile spot

# 预览：从合约转回现货 10 USDT。
ai-hub wallet transfer --from-account-type 5 --to-account-type 1 \
  --coin-symbol USDT --amount 10 --profile spot

# 查询同一方向的划转记录。
ai-hub wallet transfer-history --from-account-type 5 --to-account-type 1 \
  --page 1 --page-size 20 --profile spot
```

从现货转入合约时，使用 `--from-account-type 1 --to-account-type 5`，与前文钱包示例一致。划转的确认命令同样使用 `--profile spot`。不能把合约权益当作可划转余额，划转前应查询专门的可划转资产。

## 合约分页、时间范围与调用频率

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

MCP 工具名称与 HTTP 操作对应关系见[完整合约操作表](../futures-operations.md)。
