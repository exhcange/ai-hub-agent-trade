# AI Hub Agent Trade

Local CLI, MCP, and Skills for AI Hub spot trading integrations.

## Implemented foundation

- SaaS-safe local profiles at `~/.ai-hub/config.toml`.
- OS credential storage through macOS Keychain, Windows Credential Manager, and Linux Secret Service.
- Public spot market reads: server time, symbols, ticker, depth, trades, and klines.
- Signed account overview read.
- Local stdio MCP tools for the available read capabilities.

The first release does not expose state-changing tools until the shared prepare/confirm flow is complete and tested.

## Development endpoint

The current production OpenAPI endpoint used for read-only smoke tests is `https://openapi.coobit.vip`. The website domain is not an API endpoint. This value is only a development reference: production users must configure their own tenant endpoint in a local profile.

## Packages

- `@ai-hub/agent-trade-cli`: terminal commands.
- `@ai-hub/agent-trade-mcp`: local stdio MCP server.
- `@ai-hub/agent-trade-core`: internal shared workspace package.

No API key or secret key is stored in the repository or in `~/.ai-hub/config.toml`.
