# AI Hub Agent Trade

Local CLI, MCP, and Skills for AI Hub spot and Futures trading integrations.

For a combined local installation or migration, see [现货与合约安装使用说明（中文）](docs/INSTALL_SPOT_FUTURES.zh-CN.md). The offline Codex installer is `node scripts/install-local-products.mjs` (dry-run by default).

The Futures extension is implemented in this checkout and awaits live acceptance. See [Futures setup, migration and operating rules](docs/FUTURES.md), [operation mapping](docs/FUTURES_OPERATIONS.md), and [delivery and acceptance record](docs/FUTURES_DELIVERY.md).

For low-latency natural-language reads, the CLI package also installs `aihub`. Requests such as `aihub show asset balances` and `aihub show BTCUSDT price` use a deterministic Core fast path and render the final result without an Agent. Requests outside the bounded fast surface fall back to a Codex `gpt-5.6-luna`/`low` Agent restricted to the configured AI Hub MCP server.

## Implemented foundation

- SaaS-safe local profiles at `~/.ai-hub/config.toml`.
- Plaintext API credentials stored in the local profile at `~/.ai-hub/config.toml`.
- Public spot market reads: connectivity, server time, symbols, ticker, depth, trades, and klines.
- Bounded symbol overview, pagination, keyword search, and exact trading-rule lookup for responsive Agent interactions.
- Compact single-symbol last-price reads through `market_get_last_price` / `ai-hub market price`.
- Signed account, wallet, sub-account, isolated/cross spot-margin, and transfer read capabilities.
- Local stdio MCP and CLI tools for single/batch spot orders, v2 isolated/cross spot-margin orders, wallet transfers and withdrawals, and sub-account administration. Futures operations and leverage settings use the separate `futures` command group and product profile.
- Shared Tool Registry for MCP and CLI schemas, validation, access controls, error codes, and handlers.
- One-time shared preparation and confirmation. Preparation can query OpenAPI for validation but never sends the requested state-changing operation.
- MCP read-only mode for exposing queries without order, cancellation, withdrawal, transfer, or confirmation capabilities. Use `ai-hub-trade-mcp --profile default --read-only`, or persist it with `ai-hub-trade-mcp setup --client <client> --profile default --read-only`.

## Required confirmation boundary

For every state-changing operation, the caller must prepare the action, show the exact preview, and stop for a new explicit user confirmation message. Only after that new message may it call `confirm_action` with `confirmationId` and `userConfirmation`.

`confirm_action` is one-time and expires after five minutes. The CLI rejects `--confirm`; it persists a preview locally and requires a separate `ai-hub confirm --confirmation-id <id> --user-confirmation <new-user-message>` command. The MCP server and all Skills prohibit chaining prepare and confirm from one user instruction. The local protocol cannot prove who authored a message, so the Agent or host must preserve the new-user-message boundary.

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
