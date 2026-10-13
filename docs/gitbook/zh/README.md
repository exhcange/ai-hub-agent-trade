# 01 快速开始

本页用于安装 CLI 和 MCP 组件，并为您的平台创建本地连接配置。

## 使用前准备

* Node.js 20 或更高版本；
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
## 创建连接配置

以下示例使用 `default` 作为 Profile 名称。请将示例域名替换为当前商户实际分配的 OpenAPI HTTPS 地址。

```bash
ai-hub config init
ai-hub config set --profile default --openapi-base-url https://your-openapi-domain
ai-hub config set-credentials --profile default
```

执行 `set-credentials` 后，终端会分别提示输入 API Key 与 Secret Key，输入内容不会回显。

查看配置并测试连通性：

```bash
ai-hub config show --profile default
ai-hub market ping --profile default
```
{% endstep %}

{% step %}
## 首次查询市场

```bash
# 查看当前市场摘要
ai-hub market ticker-summary --quote-asset USDT --limit 20 --profile default

# 查询精确币对的 Ticker
ai-hub market ticker --symbol BTCUSDT --profile default

# 查询价格精度、数量精度和最小下单限制
ai-hub market symbol-info --symbol BTCUSDT --profile default
```
{% endstep %}
{% endstepper %}

## 下一步

* 在终端或脚本中使用：[命令行](03-ming-ling-xing.md)
* 接入 AI 客户端：[MCP 接入与启动](02-mcp.md)
* 安装 Agent 操作规则：[Skills](04-skills.md)
