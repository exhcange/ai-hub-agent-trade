# Market Commands

All commands are read-only and use the OpenAPI URL from the selected local profile.

| Command | Required options | Optional options |
| --- | --- | --- |
| `ai-hub market ping` | None | `--profile` |
| `ai-hub market time` | None | `--profile` |
| `ai-hub market symbols` | None | `--offset`, `--limit` (1–50), `--profile` |
| `ai-hub market symbols-overview` | None | `--limit` (1–50), `--profile` |
| `ai-hub market symbols-list` | None | `--quote-asset`, `--offset`, `--limit` (1–50), `--profile` |
| `ai-hub market symbols-search` | `--query` | `--quote-asset`, `--limit` (1–50), `--profile` |
| `ai-hub market symbol-info` | `--symbol` | `--profile` |
| `ai-hub market ticker` | `--symbol` or `--symbols` | `--time-zone`, `--profile` |
| `ai-hub market ticker-summary` | None | `--quote-asset`, `--limit` (1–50), `--profile` |
| `ai-hub market depth` | `--symbol` | `--limit` (1–50), `--profile` |
| `ai-hub market depth-summary` | `--symbol` | `--limit` (1–50), `--profile` |
| `ai-hub market trades` | `--symbol` | `--limit` (1–50), `--profile` |
| `ai-hub market trades-summary` | `--symbol` | `--limit` (1–50), `--profile` |
| `ai-hub market klines` | `--symbol`, `--interval` | `--start-time`, `--end-time`, `--timezone`, `--limit` (1–50), `--profile` |
| `ai-hub market klines-summary` | `--symbol` | `--interval` (defaults to `60min`), `--start-time`, `--end-time`, `--timezone`, `--limit` (1–50), `--profile` |
| `ai-hub market klines-1min-history` | `--symbol` | `--start-time`, `--end-time`, `--limit` (1–50), `--profile` |

Examples:

```bash
ai-hub market ping --profile default
ai-hub market symbols-overview --limit 12
ai-hub market symbols-list --quote-asset USDT --offset 0 --limit 20
ai-hub market symbols-search --query BTC
ai-hub market symbol-info --symbol BTCUSDT
ai-hub market ticker --symbol BTCUSDT
ai-hub market ticker-summary --quote-asset USDT --limit 5
ai-hub market depth-summary --symbol BTCUSDT --limit 10
ai-hub market trades-summary --symbol BTCUSDT --limit 20
ai-hub market klines-summary --symbol BTCUSDT --interval 60min --limit 20
ai-hub market klines-1min-history --symbol BTCUSDT --start-time 1722470400000 --end-time 1722474000000 --limit 20
```

## Kline parameter rules

- `symbol` is required. Both `ETHUSDT` and `ETH/USDT` are accepted.
- Supported `--interval` values are exactly `1min`, `5min`, `15min`, `30min`, `60min`, `1day`, `1week`, and `1month`. Use `60min`, not `1h`.
- CLI accepts common aliases (`1h`, `1d`, `1w`, and minute shorthand) and normalizes them before calling OpenAPI. Unsupported periods such as `4h` fail locally with `AI_HUB_INVALID_ARGUMENT`.
- `--start-time` and `--end-time` are inclusive Unix timestamps in milliseconds. `start-time` cannot be after `end-time`.
- `--timezone` is optional (`UTC+08` by default); daily, weekly, and monthly data may vary by timezone.
- The CLI returns newest-first candles with a maximum of 50 rows in both raw and summary commands.
- `klines-1min-history` calls `GET /sapi/v2/klines_1min`; its server response is capped locally to the requested limit because the upstream endpoint has no page-size parameter.

For a generic pair list, use `ai-hub market symbols-overview` first. Use `symbols-list` for a paged quote-asset list, `symbols-search --query <asset>` for a keyword lookup, and `symbol-info` only when the exact symbol's precision or minimum rules are needed. `symbols` returns complete metadata in pages of at most 50 rows.
