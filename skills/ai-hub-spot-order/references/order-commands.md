# Spot Order Commands

All commands require a profile with locally configured credentials. `side` is `BUY` or `SELL`; `type` is `LIMIT` or `MARKET`; volume is a positive decimal string.

| Command | Required options | Optional options |
| --- | --- | --- |
| `ai-hub spot order test` | `--symbol`, `--volume`, `--side`, `--type` | `--price` for `LIMIT`, `--new-client-order-id`, `--recv-window`, `--profile` |
| `ai-hub spot order get` | `--symbol`, `--order-id` | `--new-client-order-id`, `--profile` |
| `ai-hub spot order open` | None | `--symbol`, `--limit` (1–1000), `--profile` |
| `ai-hub spot order fills` | `--symbol` | `--limit` (1–1000), `--from-id`, `--profile` |
| `ai-hub spot order place` | `--symbol`, `--volume`, `--side`, `--type` | `--price` for `LIMIT`, `--time-in-force` (`GTC`, `IOC`, `FOK`), `--new-client-order-id`, `--recv-window`, `--profile` |
| `ai-hub spot order cancel` | `--symbol`, `--order-id` | `--new-client-order-id`, `--profile` |
| `ai-hub spot order batch-place` | `--symbol`, `--orders` JSON array | `--profile` |
| `ai-hub spot order batch-cancel` | `--symbol`, `--order-ids` JSON array | `--profile` |

Examples:

```bash
ai-hub spot order test --symbol BTCUSDT --volume 0.001 --side BUY --type LIMIT --price 60000
ai-hub spot order open --symbol BTCUSDT --limit 20
ai-hub spot order fills --symbol BTCUSDT --limit 50
ai-hub spot order place --symbol BTCUSDT --volume 0.001 --side BUY --type LIMIT --price 60000
ai-hub spot order cancel --symbol BTCUSDT --order-id 123456
ai-hub spot order batch-place --symbol BTCUSDT --orders '[{"volume":"0.001","side":"BUY","batchType":"LIMIT","price":"60000"}]'
ai-hub spot order batch-cancel --symbol BTCUSDT --order-ids '["123456","123457"]'
```

`LIMIT` requires `--price`. `MARKET` rejects `--price`. Batch arrays contain 1–10 entries and must be valid JSON strings.

Every command that places or cancels an order is state-changing. After it shows a preview, the user—not an agent—must enter a new `yes` in the terminal.
