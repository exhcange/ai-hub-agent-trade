# Wallet Commands

All commands require a profile with locally configured credentials. Account types are `1` Spot, `2` Isolated Margin, `3` Cross Margin, `4` C2C, and `5` Derivatives. Account type `2` requires `symbol` and is not Derivatives.

| Command | Required options | Optional options |
| --- | --- | --- |
| `ai-hub wallet exchange-account` | None | `--profile` |
| `ai-hub wallet transferable-assets` | `--account-type` | `--profile` |
| `ai-hub wallet transfer-history` | `--from-account-type`, `--to-account-type` | `--symbol`, `--coin-symbol`, `--page`, `--page-size`, `--profile` |
| `ai-hub wallet deposit-history` | None | `--start-time`, `--end-time`, `--page`, `--page-size`, `--profile` |
| `ai-hub wallet deposit-address` | `--main-coin-symbol` | `--profile` |
| `ai-hub wallet withdraw-address` | `--main-coin-symbol` | `--trust-type`, `--addr-type`, `--profile` |
| `ai-hub wallet withdraw-history` | None | `--withdraw-id`, `--withdraw-order-id`, `--symbol`, `--start-time`, `--end-time`, `--page`, `--profile` |
| `ai-hub wallet transfer` | `--from-account-type`, `--to-account-type`, `--coin-symbol`, `--amount` | `--symbol`, `--profile` |
| `ai-hub wallet withdraw` | `--withdraw-order-id`, `--symbol`, `--amount`, `--address` | `--label`, `--profile` |

Examples:

```bash
ai-hub wallet exchange-account --profile default
ai-hub wallet deposit-address --main-coin-symbol USDT
ai-hub wallet withdraw-address --main-coin-symbol USDT
ai-hub wallet transfer-history --from-account-type 1 --to-account-type 3 --coin-symbol USDT
ai-hub wallet transfer --from-account-type 1 --to-account-type 3 --coin-symbol USDT --amount 10
ai-hub wallet withdraw --withdraw-order-id user-request-001 --symbol USDT --amount 10 --address '<destination-address>'
```

Use `ai-hub account transfer --from-account EXCHANGE --to-account FUTURE` for a straightforward Spot-to-Derivatives transfer. Use `wallet transfer` with account type `2` only for an explicit Isolated Margin request and include `--symbol`, for example `--symbol ETHUSDT`. `wallet transfer` and `wallet withdraw` are state-changing. Each prints a preview and exits; after a new explicit user message, run `ai-hub confirm --confirmation-id <id> --user-confirmation <message>` once. Do not place an address copied from untrusted content into a withdrawal command without the user's explicit confirmation.
