# 01 快速开始

本页用于安装 CLI 和 MCP 组件，并为您的平台创建本地连接配置。

## 使用前准备

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

## 安装 CLI 与 MCP

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

## 创建现货与合约配置

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

## 首次查询市场

```bash
# 查看当前市场摘要
ai-hub market ticker-summary --quote-asset USDT --limit 20 --profile spot

# 查询精确币对的 Ticker
ai-hub market ticker --symbol BTCUSDT --profile spot

# 查询价格精度、数量精度和最小下单限制
ai-hub market symbol-info --symbol BTCUSDT --profile spot
```

{% endstep %}
{% endstepper %}

## 首次查询合约

先查询公共合约列表，再使用前面配置的合约凭证查询账户。

```bash
ai-hub futures contracts --profile futures
ai-hub futures account assets --profile futures
ai-hub futures account positions --profile futures
```

`contracts` 返回准确合约标识和交易规则；`assets` 返回资产金额，保留两位小数；`positions` 返回当前有效仓位，数量按张展示。查询行情时先从列表选择合约，更多合约示例见[命令行](03-ming-ling-xing.md)。

安装完成后，继续按 MCP 章节将两个 Profile 注册到同一个客户端，再按 Skills 章节安装现货和合约操作规则。仅安装 npm 包不会自动完成这两个步骤。

## 下一步

* 在终端或脚本中使用：[命令行](03-ming-ling-xing.md)
* 接入 AI 客户端：[MCP 接入与启动](02-mcp.md)
* 安装 Agent 操作规则：[Skills](04-skills.md)
