# 03 命令行

CLI 命令入口为 `ai-hub`。使用 `ai-hub --help` 查看当前版本的完整可用命令和参数。

{% hint style="info" %}
建议在脚本和 Agent 指令中始终传入 `--profile <name>`，避免跨租户调用。
{% endhint %}

## 市场数据

| 目标            | 示例命令                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| 查看币对总览        | `ai-hub market symbols-overview --limit 20 --profile default`                                 |
| 分页浏览 USDT 币对  | `ai-hub market symbols-list --quote-asset USDT --offset 0 --limit 20 --profile default`       |
| 搜索币对          | `ai-hub market symbols-search --query BTC --limit 20 --profile default`                       |
| 查询币对精度和最小下单限制 | `ai-hub market symbol-info --symbol BTCUSDT --profile default`                                |
| 查询指定币对 Ticker | `ai-hub market ticker --symbol ETHUSDT --profile default`                                     |
| 查看订单簿摘要       | `ai-hub market depth-summary --symbol BTCUSDT --limit 20 --profile default`                   |
| 查看最近成交摘要      | `ai-hub market trades-summary --symbol BTCUSDT --limit 20 --profile default`                  |
| 查看 K 线摘要      | `ai-hub market klines-summary --symbol ETHUSDT --interval 60min --limit 20 --profile default` |

列表型命令默认返回 20 条，单次最大 50 条。币对浏览请使用 `offset` 分页，不要尝试一次性获取完整币对或大体量历史数据。

## 账户和订单查询

```bash
# 查询 ETH 的可用、冻结和总余额
ai-hub account asset-balance --asset ETH --profile default

# 查询指定订单
ai-hub spot order get --symbol ETHUSDT --order-id <order-id> --profile default

# 查询当前委托和成交记录
ai-hub spot order open --symbol ETHUSDT --limit 20 --profile default
ai-hub spot order fills --symbol ETHUSDT --limit 20 --profile default
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
ai-hub spot order market-buy --symbol ETHUSDT --quote-amount 100 --profile default

# 市价卖出 0.5 ETH
ai-hub spot order market-sell --symbol ETHUSDT --base-quantity 0.5 --profile default

# 以 1,800 USDT 的限价买入 1 ETH
ai-hub spot order limit --symbol ETHUSDT --side BUY --base-quantity 1 --price 1800 --profile default

# 卖出当前可执行的全部 ETH；预览会显示可卖数量和精度截断后的剩余量
ai-hub spot order sell-available --symbol ETHUSDT --profile default
```

{% hint style="info" %}
市价买入只能指定花费的计价币金额，无法保证成交后恰好获得某个基础币数量。若目标是“买入恰好 1 ETH”，请使用限价单，或先明确允许花费的 USDT 金额。
{% endhint %}

## 撤单和批量操作

```bash
# 撤销单个订单
ai-hub spot order cancel --symbol ETHUSDT --order-id <order-id> --profile default

# 批量下单：--orders 为 JSON 数组，单次最多 10 笔
ai-hub spot order batch-place --symbol ETHUSDT --orders '[
  {"side":"BUY","type":"LIMIT","baseQuantity":"0.1","price":"1600"},
  {"side":"SELL","type":"LIMIT","baseQuantity":"0.1","price":"2000"}
]' --profile default

# 批量撤单：--order-ids 为 JSON 数组，单次最多 10 笔
ai-hub spot order batch-cancel --symbol ETHUSDT --order-ids '["<order-id-1>","<order-id-2>"]' --profile default
```

所有写命令仅生成预览。确认执行方式见[安全](/broken/pages/296a0a3a5ce41b16c7b420fd3779e0e671ec0803)。

## 钱包和万向划转

```bash
# 查询现货账户（类型 1）可划转资产
ai-hub wallet transferable-assets --account-type 1 --profile default

# 查询 USDT 充值地址和充值历史
ai-hub wallet deposit-address --main-coin-symbol USDT --profile default
ai-hub wallet deposit-history --page 1 --page-size 20 --profile default

# 查询现货到衍生品账户的划转记录
ai-hub wallet transfer-history --from-account-type 1 --to-account-type 5 --page 1 --page-size 20 --profile default
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
  --profile default
```
