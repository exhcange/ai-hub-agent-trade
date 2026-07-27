# AI Hub Agent Trade

Local CLI, MCP, and Skills for AI Hub spot trading integrations.

## Implemented foundation

- SaaS-safe local profiles at `~/.ai-hub/config.toml`.
- Plaintext API credentials stored in the local profile at `~/.ai-hub/config.toml`.
- Public spot market reads: connectivity, server time, symbols, ticker, depth, trades, and klines.
- Bounded symbol overview, pagination, keyword search, and exact trading-rule lookup for responsive Agent interactions.
- Signed account, wallet, sub-account, margin, and transfer read capabilities.
- Local stdio MCP and CLI tools for single/batch spot orders, v2 margin orders, wallet transfers and withdrawals, and sub-account administration.
- Shared Tool Registry for MCP and CLI schemas, validation, access controls, error codes, and handlers.
- One-time spot order preparation and confirmation. Preparation never sends an OpenAPI request.

## Required confirmation boundary

For every state-changing operation, the caller must prepare the action, show the exact preview, and stop for a new explicit user confirmation message. Only after that new message may it call `confirm_action` with `confirmationId` and `userConfirmation`.

`confirm_action` is one-time and expires after five minutes. The CLI rejects `--confirm` and requires a new interactive `yes` response after showing the preview. The MCP server and all Skills prohibit chaining prepare and confirm from one user instruction. The local protocol cannot prove who authored a message, so the Agent or host must preserve the new-user-message boundary.

## Command surface

CLI commands are generated from the same Tool Registry as MCP. Use command paths such as `ai-hub margin order get`, `ai-hub wallet deposit-history`, and `ai-hub sub-account api-key list`; use standard kebab-case flags for Tool fields. Array inputs, including batch order `--orders` and batch cancellation `--order-ids`, accept a JSON array string.

## Development endpoint

The current production OpenAPI endpoint used for read-only smoke tests is `https://openapi.coobit.vip`. The website domain is not an API endpoint. This value is only a development reference: production users must configure their own tenant endpoint in a local profile.

## Packages

- `@ai-hub/agent-trade-cli`: terminal commands.
- `@ai-hub/agent-trade-mcp`: local stdio MCP server.
- `@ai-hub/agent-trade-core`: internal shared workspace package.

No API key or secret key is stored in the repository. The local configuration directory and file are written with mode `700` and `600` respectively; users must still protect their local machine and avoid sharing `~/.ai-hub/config.toml`.

The public symbols snapshot is cached for one hour under `~/.ai-hub/cache/`, using a hash of the profile name, configuration version, and configured OpenAPI URL. Cache files do not contain credentials and use mode `600`; a cache-read or cache-write failure never prevents a live public-symbol query.

Profiles created by an earlier Keychain-based build must run `ai-hub config set-credentials --profile <name>` once after upgrading. The CLI does not copy credentials from the operating-system credential manager into the TOML file automatically.
