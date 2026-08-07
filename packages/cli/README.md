# AI Hub Agent Trade CLI

The package installs two commands:

- `ai-hub` provides exact structured commands for every supported capability.
- `aihub <request>` provides a deterministic fast path for common balance, price, and open-order reads. It renders Core results directly. Ambiguous requests fall back to an isolated Codex `gpt-5.6-luna`/`low` Agent that loads only the globally installed `ai-hub-trade-mcp`; use `--no-agent` to disable fallback.

Examples:

```bash
aihub show asset balances
aihub show USDT balance
aihub show BTCUSDT price
aihub show open orders
```

Install globally with `npm install -g @aihubspot/agent-trade-cli`, then run `ai-hub --help`.

The complex-request fallback requires both global packages: `npm install -g @aihubspot/agent-trade-cli @aihubspot/agent-trade-mcp`. Common deterministic reads do not start Codex or MCP.

Create a local profile and enter credentials interactively:

```bash
ai-hub config init
ai-hub config set --profile default --openapi-base-url https://your-openapi-domain
ai-hub config set-credentials --profile default
```

The API key and secret key are stored as plaintext in `~/.ai-hub/config.toml`. The configuration directory and file use mode `700` and `600` respectively. `ai-hub config show` never prints the key values. State-changing operations require a preview followed by a separate confirmation command.

Use `ai-hub config path` to print the local configuration file path. Use `ai-hub capabilities` to inspect this installed CLI version's supported tool names, CLI command paths, read/write classification, and OpenAPI contracts. Both commands are local-only: they do not call OpenAPI or read credential values.

If the profile was created by an earlier Keychain-based build, run `ai-hub config set-credentials --profile <name>` once after upgrading. Credentials are not migrated automatically.

## Spot order units

Order commands use explicit asset units. Do not use the legacy `volume` field.

```bash
# Spend exactly 100 USDT to market-buy ETH.
ai-hub spot order market-buy --symbol ETHUSDT --quote-amount 100

# Market-sell exactly 0.5 ETH.
ai-hub spot order market-sell --symbol ETHUSDT --base-quantity 0.5
ai-hub spot order sell-available --symbol ETHUSDT

# Buy exactly 1 ETH at a limit price of 1800 USDT.
ai-hub spot order limit --symbol ETHUSDT --side BUY --base-quantity 1 --price 1800

# Directly select one supported limit-style OpenAPI type.
ai-hub spot order limit --symbol ETHUSDT --side BUY --type POST_ONLY --base-quantity 1 --price 1800

# Conditional orders require an explicit trigger price.
ai-hub spot order stop-limit --symbol ETHUSDT --side SELL --base-quantity 1 --trigger-price 1700 --price 1690
ai-hub spot order stop-market-buy --symbol ETHUSDT --quote-amount 100 --trigger-price 2000
```

Market BUY cannot guarantee an exact base-asset quantity. If the desired quantity is "1 ETH", use a limit order or first choose an explicit USDT amount to spend.

Use `ai-hub account asset-balance --asset ETH` for one asset. Use `ai-hub account balances` when the user requests account balances without naming an asset; it returns only compact balance rows and defaults to non-zero assets. Use `ai-hub spot order sell-available --symbol ETHUSDT` when the user explicitly wants the maximum executable ETH balance sold: its preview floors only to the configured quantity precision and displays both the remainder and the amount that would be sold.

The same unit rules apply to margin orders: use `margin order market-buy --quote-amount`, `margin order market-sell --base-quantity`, `margin order limit --type IOC|FOK|POST_ONLY --base-quantity --price`, or the matching `margin order stop-limit|stop-market-buy|stop-market-sell` command.

For this OpenAPI, `LIMIT`, `IOC`, `FOK`, and `POST_ONLY` are direct `type` values. Do not supply `--time-in-force`: it is not a server parameter and is rejected by the CLI.

The CLI does not provide `spot order place --volume`. It deliberately exposes `market-buy`, `market-sell`, and `limit` as separate commands so the asset unit cannot be ambiguous. Batch placement accepts a JSON array with the same semantic fields: `quoteAmount` for a market BUY and `baseQuantity` for a market SELL or limit order.

## Write confirmation flow

Every state-changing command creates a local five-minute preview and exits; `--prepare` is accepted as an explicit alias. After showing the preview, stop and wait for a new user message. Then execute the returned confirmation ID in a separate command:

```bash
ai-hub spot order market-sell --symbol ETHUSDT --base-quantity 0.5 --prepare
ai-hub confirm --confirmation-id <confirmation-id> --user-confirmation "yes"
```

The pending preview is stored under `~/.ai-hub/pending-actions/` with owner-only permissions. It contains no credentials, is bound to the original profile and credential version, expires after five minutes, and is atomically consumed before execution. Do not run `confirm` in the same user instruction that generated the preview.

Before an order preview is created, the CLI lazily loads `/sapi/v2/symbols` once per local profile and keeps the rule snapshot for one hour in memory and an isolated local cache. It rejects known quantity/price precision and limit-order minimum violations before asking for confirmation.

## Bounded market analysis

For a generic trading-pair list, use `ai-hub market symbols-overview`; it returns only counts and a small sample. Use `symbols-list --quote-asset USDT --offset 0 --limit 20` for paged browsing, `symbols-search --query BTC` for a keyword search, and `symbol-info --symbol BTCUSDT` only when precision or minimum order rules are needed. These commands return Agent-friendly bounded results instead of complete market payloads. Raw trades and raw klines are capped at 50 rows. Kline intervals are `1min`, `5min`, `15min`, `30min`, `60min`, `1day`, `1week`, and `1month` (`60min`, not `1h`).
