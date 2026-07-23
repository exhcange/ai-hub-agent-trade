# Account Commands

All commands in this reference require a profile with locally configured credentials.

| Command | Required options | Optional options |
| --- | --- | --- |
| `ai-hub account get` | None | `--profile` |
| `ai-hub account transfer-history` | `--transfer-id`, or both `--from-account` and `--to-account` | `--coin-symbol`, `--start-time`, `--end-time`, `--page`, `--limit`, `--profile` |
| `ai-hub account transfer` | `--coin-symbol`, `--amount`, `--from-account`, `--to-account` | `--profile` |

Examples:

```bash
ai-hub account get --profile default
ai-hub account transfer-history --from-account spot --to-account wallet --coin-symbol USDT
ai-hub account transfer --coin-symbol USDT --amount 10 --from-account wallet --to-account spot
```

The transfer command is state-changing. It prints a preview and requires the user to enter `yes` manually in an interactive terminal. Do not pipe or inject the confirmation.
