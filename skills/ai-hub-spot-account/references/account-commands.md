# Account Commands

All commands in this reference require a profile with locally configured credentials.

| Command | Required options | Optional options |
| --- | --- | --- |
| `ai-hub account asset-balance` | `--asset` | `--profile` |
| `ai-hub account balances` | None | `--assets` JSON array, `--non-zero-only` (`true` by default), `--limit` (1–50, default 50), `--profile` |

Examples:

```bash
ai-hub account asset-balance --asset ETH --profile default
ai-hub account balances --profile default
ai-hub account balances --assets '["USDT","BTC"]' --non-zero-only true --limit 50 --profile default
```

`asset-balance` requires exactly one asset. `balances` calls `GET /sapi/v1/account`, returns only asset, available, frozen, and total fields, and excludes an asset only when both `free` and `locked` are zero unless `--non-zero-only false` is supplied.
