# 04 Skills

Skills 是给 AI Agent 读取的 Markdown 操作规则。它们告诉 Agent 应在什么场景下调用 `ai-hub` CLI、如何传参，以及何时必须停止等待人工确认。

Skills 与 MCP 相互独立：

* Skills 通过 CLI 执行；
* MCP 通过 `ai-hub-trade-mcp` 提供本地结构化工具；
* 两者共享本地 Profile 和同一套写操作确认边界；
* 安装 Skills 不会自动配置 MCP，安装 MCP 也不会自动安装 Skills。

## 安装

先安装 CLI 并完成 Profile 配置，再执行：

```bash
npx skills add exhcange/ai-hub-agent-skills
```

不支持 `npx skills` 的客户端，可手动加载 [Skills 仓库](07-xiang-guan-lian-jie.md)中的 `skills/` 子目录。

## Skill 列表

| Skill                          | 用途                        |
| ------------------------------ | ------------------------- |
| `ai-hub-spot`                  | 将需求路由到对应的现货子 Skill。       |
| `ai-hub-spot-common`           | 行情、币对、Ticker、订单簿、成交和 K 线。 |
| `ai-hub-spot-order`            | 现货订单查询、下单、撤单和订单安全规则。      |
| `ai-hub-spot-account`          | 单资产余额查询。                  |
| `ai-hub-spot-deposit-withdraw` | 钱包查询、划转、充值和提现工作流。         |
| `ai-hub-spot-sub-account`      | 子账户工作流。                   |

Skill 正文采用英文编写，命令和安全边界与当前 CLI 一致。对于参数完整的只读请求，Skill 会优先直接执行准确命令；只有首次配置、参数歧义、业务错误或需要诊断时，才读取更多参考说明。

## 推荐请求方式

```
使用 AI Hub 查询 BTCUSDT 的订单簿前 20 档。
```

```
使用 AI Hub 查询我的 ETH 可用余额，profile 为 default。
```

```
使用 AI Hub 以市价花费 100 USDT 买入 ETH；先给我订单预览，等待我下一条消息确认。
```

避免模糊表达：

* 不要说“市价买入 1 ETH”；
* 应说“花费 100 USDT 市价买入 ETH”；
* 市价卖出时才使用基础资产数量，例如“市价卖出 0.5 ETH”。
