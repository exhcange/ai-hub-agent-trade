# AI Hub Agent Skills

Release: **0.1.30**. English-language Skills for supported AI Hub spot, isolated/cross spot-margin, and Futures workflows. When MCP and CLI are both installed, use the matching MCP tool first; use CLI only when MCP is unavailable before dispatch.

## Skills

| Skill | Scope | Authentication |
| --- | --- | :---: |
| [`ai-hub-spot`](ai-hub-spot/SKILL.md) | Routes spot workflows to focused Skills. | Varies |
| [`ai-hub-spot-common`](ai-hub-spot-common/SKILL.md) | Public spot markets, prices, depth, trades, and candles. | No |
| [`ai-hub-spot-account`](ai-hub-spot-account/SKILL.md) | Spot balances and bounded asset overviews. | Yes |
| [`ai-hub-spot-order`](ai-hub-spot-order/SKILL.md) | Spot and isolated/cross spot-margin orders and cancellations. | Yes |
| [`ai-hub-spot-deposit-withdraw`](ai-hub-spot-deposit-withdraw/SKILL.md) | Wallet assets, transfers, deposit/withdrawal information, and withdrawals. | Yes |
| [`ai-hub-spot-sub-account`](ai-hub-spot-sub-account/SKILL.md) | Supported sub-account information and operations. | Yes |
| [`ai-hub-futures`](ai-hub-futures/SKILL.md) | Routes Futures workflows and separates spot/Futures balance results. | Varies |
| [`ai-hub-futures-common`](ai-hub-futures-common/SKILL.md) | Futures connectivity, contracts, ticker, index, depth, and candles. | No |
| [`ai-hub-futures-account`](ai-hub-futures-account/SKILL.md) | Futures assets, positions, historical PnL, and account transactions. | Yes |
| [`ai-hub-futures-order`](ai-hub-futures-order/SKILL.md) | Futures order queries, fills, and supported cancellations. | Yes |
| [`ai-hub-futures-trade`](ai-hub-futures-trade/SKILL.md) | Ordinary, conditional, TP/SL orders, and approved trading settings. | Yes |
| [`ai-hub-futures-transfer`](ai-hub-futures-transfer/SKILL.md) | Spot-routed spot/Futures transfer queries and confirmed transfers. | Yes |

## Install

Requires Node.js 20 or later.

```bash
npm install -g @aihubspot/agent-trade-cli@0.1.30 @aihubspot/agent-trade-mcp@0.1.30
npx skills add exhcange/ai-hub-agent-skills
```

Install Skills and register MCP separately. Create the fixed product profiles before authenticated workflows:

```bash
ai-hub config init
ai-hub config set --profile spot --product spot --openapi-base-url https://your-spot-openapi-domain
ai-hub config set-credentials --profile spot
ai-hub config set --profile futures --product futures --openapi-base-url https://your-futures-openapi-domain
ai-hub config set-credentials --profile futures
```

Credentials are entered locally. Never request or expose API credentials in chat or commit local profile files. Register each product's MCP server with its corresponding profile. Use `--read-only` when only queries are required. Transfers use the spot profile and require operator-verified account pairing before writes.

See the [client repository](https://github.com/exhcange/ai-hub-agent-trade) and [operating guide](https://exchangedocsv2.gitbook.io/aihub) for MCP setup and supported commands.

## Execution rules

- Preserve spot and Futures product isolation. An unspecified balance query returns separate components without arithmetic totals; a failed query is not zero balance.
- Every state-changing operation produces a preview. The agent then stops and waits for a NEW explicit user message before confirmation.
- Never automatically retry a failed or uncertain write, and never switch from MCP to CLI to resend it.
- For unresolved writes, obtain authoritative evidence and retain the unresolved state until verified resolution.
- Exchange-managed conditional and TP/SL orders do not require an Agent price watcher. Do not promise OCO behavior.
- Public recent Futures trades, ordinary Futures batch placement, selected ordinary batch cancellation, ticker_all, WebSocket, and strategy/copy/robot operations are excluded.

## Repository layout

The pack contains six `ai-hub-spot*` and six `ai-hub-futures*` directories. Each installable directory includes its own `SKILL.md` and operating instructions. Spot Skills carry local `references/` copies of shared guidance; Futures Skills include their execution boundaries directly. No installed Skill depends on a parent `_shared` directory.

Skill version declarations follow the source pack's existing format. Keep this pack aligned with the client repository's `skills/` directory when releasing.
