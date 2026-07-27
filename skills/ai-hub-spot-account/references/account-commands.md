# Account Commands

All commands in this reference require a profile with locally configured credentials.

| Command | Required options | Optional options |
| --- | --- | --- |
| `ai-hub account get` | None | `--profile` |
| `ai-hub account asset-balance` | `--asset` | `--profile` |
| `ai-hub account transfer-history` | `--transfer-id`, or both `--from-account` and `--to-account` | `--coin-symbol`, `--start-time`, `--end-time`, `--page`, `--limit`, `--profile` |
| `ai-hub account transfer` | `--coin-symbol`, `--amount`, `--from-account`, `--to-account` | `--profile` |

Examples:

```bash
ai-hub account get --profile default
ai-hub account asset-balance --asset ETH --profile default
ai-hub account transfer-history --from-account EXCHANGE --to-account FUTURE --coin-symbol USDT
ai-hub account transfer --coin-symbol USDT --amount 10 --from-account EXCHANGE --to-account FUTURE
```

`account transfer` supports only `EXCHANGE` (Spot) and `FUTURE` (Derivatives). Use `EXCHANGE -> FUTURE` for Spot to Derivatives and the reverse for Derivatives to Spot. Do not pass numeric account types such as `1` or `5`; use `wallet transfer` for numeric account-type transfers. The transfer command is state-changing. It prints a preview and exits; after a new explicit user message, run `ai-hub confirm --confirmation-id <id> --user-confirmation <message>` once. Do not infer or inject the confirmation.
