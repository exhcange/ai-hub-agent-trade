# 01 Quick Start

Install the CLI and MCP packages, configure one merchant connection, and use Spot and Futures through one MCP server.

## Prerequisites

- npm and Node.js 20 or later.
- Your merchant's public HTTPS spot OpenAPI endpoint, normally `https://openapi.example.com`.
- One API key and secret key valid for both products, with the required permissions.
- A supported MCP client: Cursor, Claude Desktop, Claude Code, Codex, or OpenClaw.
- A Skills-compatible client, or support for loading Skill folders manually.

## Install

```bash
npm install -g @aihubspot/agent-trade-cli @aihubspot/agent-trade-mcp
ai-hub --help
ai-hub-trade-mcp --help
```

## Configure one merchant connection

Replace the example URL with your merchant's spot OpenAPI endpoint. Do not use the website or App API address.

```bash
ai-hub config init
ai-hub config set --profile merchant --products spot,futures --openapi-base-url https://openapi.example.com
ai-hub config set-credentials --profile merchant
ai-hub config show --profile merchant
```

The Futures endpoint is derived as `https://futuresopenapi.example.com`. Both endpoints are validated, and both products share the credentials entered once. Credential input is hidden. Never share keys in chat.

For a nonstandard environment, add `--futures-base-url https://your-futures-api.example.com` to the configuration command. Changing either endpoint clears the configured credentials; configure them again only after checking the addresses.

## Verify both products

```bash
ai-hub market ping --profile merchant
ai-hub futures ping --profile merchant
ai-hub futures time --profile merchant
ai-hub market ticker --symbol BTCUSDT --profile merchant
ai-hub futures contracts --profile merchant
ai-hub futures account assets --profile merchant
ai-hub futures account positions --profile merchant
```

Public reads require no credentials. Account and order reads need API read permissions. Use the exact Futures contract identifiers returned by `contracts`.

## Register one MCP server

Choose the client you use:

```bash
ai-hub-trade-mcp setup --client codex --profile merchant
```

Replace `codex` with `cursor`, `claude-desktop`, `claude-code`, or `openclaw` as appropriate. Add `--read-only` for queries only. Reload the MCP connection; fully restart the client if an old process remains.

The server `aihub-merchant` provides both products. Call `system_get_capabilities` and check `products`, `productAccess`, and `serviceVersion`. Spot tools use the spot endpoint; Futures tools use the Futures endpoint. Both transfer directions use spot wallet tools.

## Install Skills

```bash
npx skills add exhcange/ai-hub-agent-trade
```

Select your client and all twelve spot/Futures Skills. Installing npm packages alone does not register MCP or install Skills.


## Next steps

- [MCP](02-mcp.md)
- [Command Line](03-command-line.md)
- [Skills](04-skills.md)
- [Security](05-security.md)
