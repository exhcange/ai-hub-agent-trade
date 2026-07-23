# OpenAPI Business Error Diagnosis

When the CLI or local MCP returns `AI_HUB_OPENAPI_BUSINESS_ERROR`, treat the request as failed even if the HTTP response was successful. Use the structured fields in this order:

1. Report `reason` and follow `suggestedAction`.
2. Preserve `upstreamCode` and `upstreamMessage` for troubleshooting.
3. Never retry a state-changing action automatically.
4. If `writeOutcomeUnknown` is `true`, query the affected order or history record before any new action.
5. If `reason` is `UNKNOWN_UPSTREAM_CODE`, report the raw code and message and do not invent a cause.

## Common Diagnoses

| Upstream code | Reason | Agent action |
| --- | --- | --- |
| `-1003` | `RATE_LIMITED` | Wait before retrying; reduce request frequency. |
| `-1006`, `-1007` | `WRITE_STATUS_UNKNOWN`, `UPSTREAM_TIMEOUT` | Do not retry a write; query the outcome first. |
| `-1021`, `-1022` | `INVALID_TIMESTAMP`, `INVALID_SIGNATURE` | Check local time or profile credentials. |
| `-1102`, `-1103` | `MISSING_OR_MALFORMED_PARAMETER`, `UNKNOWN_PARAMETER` | Correct the documented command parameters. |
| `-1121`, `21020` | `INVALID_SYMBOL`, `SYMBOL_NOT_FOUND` | Query supported symbols and use an exact value. |
| `-2013`, `21022` | `ORDER_NOT_FOUND` | Verify symbol and order ID; query open orders if needed. |
| `-2015` | `API_KEY_REJECTED` | Check API-key permissions, IP restrictions, and selected profile. |
| `-2017` | `INSUFFICIENT_BALANCE` | Check available balance; create a new preview with a lower amount. |
| `-2018` | `DUPLICATE_WITHDRAWAL_REQUEST` | Query withdrawal history or use a new withdrawal order ID. |
| `-2030` | `TRANSFER_NOT_FOUND` | Verify the transfer ID or query by source and destination account. |
| `-2034`, `21018` | `SUB_ACCOUNT_RELATION_NOT_FOUND`, `SUB_ACCOUNT_NOT_FOUND` | List sub-accounts and use one owned by the authenticated parent account. |
| `-2036`, `-2040`, `21024` | Sub-account permission diagnosis | Use the required parent or sub-account credential and enable the feature if needed. |
| `10005` on withdrawal history | `WITHDRAW_HISTORY_PERMISSION_DENIED` | Enable withdrawal-history permission for the API key. |

The full endpoint-aware catalog lives in Core. This reference intentionally lists only frequent, agent-actionable scenarios.
