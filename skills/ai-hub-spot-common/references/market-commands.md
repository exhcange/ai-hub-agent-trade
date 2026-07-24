# Market Commands

All commands are read-only and use the OpenAPI URL from the selected local profile.

| Command | Required options | Optional options |
| --- | --- | --- |
| `ai-hub market ping` | None | `--profile` |
| `ai-hub market time` | None | `--profile` |
| `ai-hub market symbols` | None | `--profile` |
| `ai-hub market symbols-search` | None | `--query`, `--quote-asset`, `--limit` (1–50), `--profile` |
| `ai-hub market ticker` | `--symbol` or `--symbols` | `--time-zone`, `--profile` |
| `ai-hub market ticker-summary` | None | `--quote-asset`, `--limit` (1–20), `--profile` |
| `ai-hub market depth` | `--symbol` | `--limit` (1–100), `--profile` |
| `ai-hub market depth-summary` | `--symbol` | `--limit` (1–20), `--profile` |
| `ai-hub market trades` | `--symbol` | `--limit` (1–100), `--profile` |
| `ai-hub market trades-summary` | `--symbol` | `--limit` (1–50), `--profile` |
| `ai-hub market klines` | `--symbol`, `--interval` | `--start-time`, `--end-time`, `--timezone`, `--limit` (1–100), `--profile` |
| `ai-hub market klines-summary` | `--symbol`, `--interval` | `--start-time`, `--end-time`, `--timezone`, `--limit` (1–100), `--profile` |

Examples:

```bash
ai-hub market ping --profile default
ai-hub market ticker --symbol BTCUSDT
ai-hub market ticker-summary --quote-asset USDT --limit 5
ai-hub market depth-summary --symbol BTCUSDT --limit 10
ai-hub market trades-summary --symbol BTCUSDT --limit 20
ai-hub market klines-summary --symbol BTCUSDT --interval 60min --limit 20
```

Do not guess the symbol format. Use `ai-hub market symbols-search --query <asset>` first when the user has not provided an exact supported symbol. Use `symbols` only when complete raw symbol metadata is explicitly needed.
