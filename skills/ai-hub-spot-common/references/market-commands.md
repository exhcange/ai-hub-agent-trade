# Market Commands

All commands are read-only and use the OpenAPI URL from the selected local profile.

| Command | Required options | Optional options |
| --- | --- | --- |
| `ai-hub market ping` | None | `--profile` |
| `ai-hub market time` | None | `--profile` |
| `ai-hub market symbols` | None | `--profile` |
| `ai-hub market ticker` | None | `--symbol`, `--symbols`, `--time-zone`, `--profile` |
| `ai-hub market depth` | `--symbol` | `--limit` (1–100), `--profile` |
| `ai-hub market trades` | `--symbol` | `--limit` (1–1000), `--profile` |
| `ai-hub market klines` | `--symbol`, `--interval` | `--start-time`, `--end-time`, `--timezone`, `--limit` (1–1000), `--profile` |

Examples:

```bash
ai-hub market ping --profile default
ai-hub market ticker --symbol BTCUSDT
ai-hub market depth --symbol BTCUSDT --limit 20
ai-hub market trades --symbol BTCUSDT --limit 50
ai-hub market klines --symbol BTCUSDT --interval 1h --limit 100
```

Do not guess the symbol format. Use `ai-hub market symbols` first when the user has not provided an exact supported symbol.
