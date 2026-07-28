# Spot Order Commands

All commands require a profile with locally configured credentials. Use explicit asset units: a market BUY spends `quoteAmount`; a market SELL and every limit order use `baseQuantity`. The legacy OpenAPI `volume` field is never accepted by the CLI.

| Command | Required options | Optional options |
| --- | --- | --- |
| `ai-hub spot order test` | `--symbol`, `--side`, `--type`, plus `--quote-amount` for `MARKET BUY` or `--base-quantity` for `MARKET SELL`/`LIMIT` | `--price` for `LIMIT`, `--time-in-force`, `--new-client-order-id`, `--recv-window`, `--profile` |
| `ai-hub spot order get` | `--symbol`, `--order-id` | `--new-client-order-id`, `--profile` |
| `ai-hub spot order open` | None | `--symbol`, `--limit` (1–50), `--profile` |
| `ai-hub spot order fills` | `--symbol` | `--limit` (1–50), `--from-id`, `--profile` |
| `ai-hub spot order market-buy` | `--symbol`, `--quote-amount` | `--new-client-order-id`, `--recv-window`, `--profile` |
| `ai-hub spot order market-sell` | `--symbol`, `--base-quantity` | `--new-client-order-id`, `--recv-window`, `--profile` |
| `ai-hub spot order sell-available` | `--symbol` | `--new-client-order-id`, `--recv-window`, `--profile` |
| `ai-hub spot order limit` | `--symbol`, `--side`, `--base-quantity`, `--price` | `--time-in-force` (`GTC`, `IOC`, `FOK`), `--new-client-order-id`, `--recv-window`, `--profile` |
| `ai-hub spot order cancel` | `--symbol`, `--order-id` | `--new-client-order-id`, `--profile` |
| `ai-hub spot order batch-place` | `--symbol`, `--orders` JSON array | `--profile` |
| `ai-hub spot order batch-cancel` | `--symbol`, `--order-ids` JSON array | `--profile` |

Examples:

```bash
ai-hub spot order test --symbol BTCUSDT --side BUY --type LIMIT --base-quantity 0.001 --price 60000
ai-hub spot order open --symbol BTCUSDT --limit 20
ai-hub spot order fills --symbol BTCUSDT --limit 50
ai-hub spot order market-buy --symbol ETHUSDT --quote-amount 100
ai-hub spot order market-sell --symbol ETHUSDT --base-quantity 0.5
ai-hub spot order sell-available --symbol ETHUSDT
ai-hub spot order limit --symbol BTCUSDT --side BUY --base-quantity 0.001 --price 60000
ai-hub spot order cancel --symbol BTCUSDT --order-id 123456
ai-hub spot order batch-place --symbol BTCUSDT --orders '[{"side":"BUY","type":"LIMIT","baseQuantity":"0.001","price":"60000"}]'
ai-hub spot order batch-cancel --symbol BTCUSDT --order-ids '["123456","123457"]'
```

`MARKET BUY` requires `--quote-amount` and never accepts `--base-quantity`. `MARKET SELL` requires `--base-quantity` and never accepts `--quote-amount`. `LIMIT` requires `--base-quantity` and `--price`. Market orders reject `--price`. Batch arrays contain 1–10 entries and use the same `quoteAmount`/`baseQuantity` rules as the single-order commands.

`sell-available` is the explicit exception for a request to sell all available balance: it floors the available base balance to the configured quantity precision, then shows the exact executable quantity and remainder in the preview. `market-sell` never rounds a user-supplied quantity.

Every command that places or cancels an order is state-changing. After preview, the user—not an agent—must provide a new explicit confirmation message.

For Agent-hosted CLI execution, the command exits after preview instead of waiting on terminal input. After a new explicit user message, run:

```bash
ai-hub confirm --confirmation-id <confirmation-id> --user-confirmation "yes"
```

Never run this command from the same user instruction that generated the preview.
