# 01 快速开始

本页面向已安装 npm、尚未安装 AI Hub 的新用户，安装完成后通过一个 MCP 服务使用现货和合约。

## 使用前准备

- 已安装 npm，Node.js 版本为 20 或更高；
- 平台提供的现货 OpenAPI 公网 HTTPS 地址，例如 `https://openapi.example.com`；
- 具有所需查询、交易或资金权限的 API Key 和 Secret Key；
- 使用 MCP 时，已安装 Cursor、Claude Desktop、Claude Code、Codex 或 OpenClaw；
- 使用 Skills 时，客户端支持 Skills 安装或手动加载 Skill 文件夹。

## 安装 CLI 与 MCP

```bash
npm install -g @aihubspot/agent-trade-cli @aihubspot/agent-trade-mcp
ai-hub --help
ai-hub-trade-mcp --help
```

CLI 和 MCP 仍是两个安装包；后续只需注册一个 MCP 服务。请使用已包含 `--products spot,futures` 功能的版本。

## 创建连接配置

将示例地址替换为平台提供的现货 OpenAPI 地址，不要填写网站首页或 App API 地址。以下页面统一使用 `merchant` 作为 Profile 名称。

```bash
ai-hub config init
ai-hub config set --profile merchant --products spot,futures --openapi-base-url https://openapi.example.com
ai-hub config set-credentials --profile merchant
ai-hub config show --profile merchant
```

`set-credentials` 会在终端依次提示输入 API Key 和 Secret Key，输入不会回显，不要把密钥发送到聊天中。

配置现货地址后，系统会自动得到 `https://futuresopenapi.example.com` 作为合约地址。若平台使用不同命名规则，配置时通过 `--futures-base-url <合约HTTPS地址>` 显式指定。

## 验证连接

```bash
ai-hub market ping --profile merchant
ai-hub futures ping --profile merchant
ai-hub futures time --profile merchant
```

公共接口不需要凭证；资产、仓位及订单等签名查询需要相应权限。

## 首次查询市场和账户

```bash
# 现货行情、币对规则。
ai-hub market ticker-summary --quote-asset USDT --limit 20 --profile merchant
ai-hub market ticker --symbol BTCUSDT --profile merchant
ai-hub market symbol-info --symbol BTCUSDT --profile merchant

# 合约规则、资产和当前仓位。
ai-hub futures contracts --profile merchant
ai-hub futures account assets --profile merchant
ai-hub futures account positions --profile merchant
```

`contracts` 返回准确合约标识和交易规则；合约资产金额保留两位小数，订单、成交和仓位的合约数量按“张”展示。后续行情和下单命令使用实际返回的合约标识。

## 注册 MCP 与安装 Skills

选择自己使用的客户端注册一次。例如 Codex：

```bash
ai-hub-trade-mcp setup --client codex --profile merchant
npx skills add exhcange/ai-hub-agent-trade
```

在 Skills 安装界面选择目标客户端和全部 12 个现货、合约 Skills。客户端应显示 `aihub-merchant`；调用 `system_get_capabilities`，确认 `products` 包含 `spot`、`futures`。具体客户端命令见[MCP](02-mcp.md)。

## 下一步

- [MCP](02-mcp.md)
- [命令行](03-ming-ling-xing.md)
- [Skills](04-skills.md)
- [安全](05-an-quan.md)
