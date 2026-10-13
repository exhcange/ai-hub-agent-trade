# AI Hub MCP Routing

When AI Hub MCP is available, understand the request and call the exact MCP Tool directly. Use the CLI only when MCP is unavailable. Never retry an MCP business or validation failure through CLI.

- **Market:** current price → `market_get_last_price`; normal ticker, depth, trades, or K lines → the matching `*_summary` Tool. Use raw market Tools only when the user explicitly requests raw or complete fields.
- **Account:** one named asset → `account_get_asset_balance`; balance overview → `account_list_balances`.
- **Spot margin scope:** margin Tools support isolated and cross spot margin only. Do not submit Futures requests through margin tools. Route explicit Futures requests to the futures product server and ai-hub-futures Skill. An unspecified balance request queries spot and futures separately without adding totals.
- **Spot-margin mode:** every margin write must explicitly provide `isolated=true` for isolated margin or `isolated=false` for cross margin. Never infer this value.
- **Spot/Spot-margin writes:** call the matching `*_prepare_*` Tool, then wait for a new explicit user message before `confirm_action`.
- **Wallet/Sub-account:** choose the exact `wallet_*` or `sub_account_*` Tool. Do not infer identifiers, account types, or write values.
