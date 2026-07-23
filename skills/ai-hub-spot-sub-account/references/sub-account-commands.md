# Sub-account Commands

All commands require a profile with locally configured credentials. `page-size` and `limit` are positive integers; a sub-account ID is supplied through `--sub-uid`.

| Command | Required options | Optional options |
| --- | --- | --- |
| `ai-hub sub-account list` | None | `--profile` |
| `ai-hub sub-account assets` | `--sub-uid`, `--account-type` | `--type`, `--profile` |
| `ai-hub sub-account api-key list` | `--sub-uid` | `--profile` |
| `ai-hub sub-account root-transfer-history` | `--sub-uid`, `--coin-symbol` | `--page`, `--page-size`, `--profile` |
| `ai-hub sub-account internal-transfer-history` | `--sub-uid`, `--type`, `--account-type`, `--coin-symbol` | `--page`, `--page-size`, `--profile` |
| `ai-hub sub-account parent-transfer-history` | `--coin-symbol` | `--page`, `--page-size`, `--profile` |
| `ai-hub sub-account create` | `--sub-user-email` | `--profile` |
| `ai-hub sub-account set-trading-status` | `--sub-uid`, `--type`, `--status` | `--profile` |
| `ai-hub sub-account api-key set-ip` | `--sub-uid`, `--sub-account-api-key`, `--status` | `--ip-address`, `--profile` |
| `ai-hub sub-account api-key delete` | `--sub-uid`, `--sub-account-api-key` | `--profile` |
| `ai-hub sub-account root-transfer` | `--sub-uid`, `--coin-symbol`, `--amount`, `--type` | `--profile` |
| `ai-hub sub-account internal-transfer` | `--sub-uid`, `--coin-symbol`, `--amount`, `--type`, `--account-type` | `--symbol`, `--profile` |
| `ai-hub sub-account transfer-to-parent` | `--coin-symbol`, `--amount` | `--profile` |

Examples:

```bash
ai-hub sub-account list --profile default
ai-hub sub-account assets --sub-uid 10001 --account-type 1
ai-hub sub-account api-key list --sub-uid 10001
ai-hub sub-account root-transfer-history --sub-uid 10001 --coin-symbol USDT
ai-hub sub-account create --sub-user-email abcde
ai-hub sub-account set-trading-status --sub-uid 10001 --type deposit --status 1
ai-hub sub-account root-transfer --sub-uid 10001 --coin-symbol USDT --amount 10 --type 1
```

For `set-trading-status`, `type` is one of `lever`, `etf`, or `deposit`; `status` is `0` or `1`. For `api-key set-ip`, `status` is `1` or `2`; status `2` additionally requires `--ip-address`. `create` accepts a value of at most five characters for `--sub-user-email`.

All write commands print a preview before execution. The user must enter a fresh manual `yes` in an interactive terminal. Do not type, pipe, or infer the confirmation.
