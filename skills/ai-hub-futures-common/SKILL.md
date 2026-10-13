---
name: ai-hub-futures-common
version: "0.1.30"
description: Query Futures contracts, rules and public market data through AI Hub.
---

# Ai Hub Futures Common

Use `futures_ping`, `futures_time`, `futures_contracts`, `futures_depth`, `futures_ticker`, `futures_index`, and `futures_klines`. CLI equivalents are `ai-hub futures ping`, `time`, `contracts`, or `market depth|ticker|index|klines`, with `--profile futures`.

Use exact contract names from the tenant contract list. Price, index price and mark price are distinct; do not turn unverified rates into percentages or annualized yields. The local fetch time is not a market-data timestamp. K-line intervals are 1min, 5min, 15min, 30min, 1h, 1day, 1week and 1month.

Default list requests are bounded to 20, maximum 50; depth limits apply per side. Ask before an unbounded scan. There is no public recent-market-trades tool or ticker_all tool. User fills are not market trades.

## Execution boundary

Prefer the available MCP tool. Use CLI only if MCP is unavailable before dispatch; never retry a possibly submitted write through another transport. Profile configuration errors are not permission to choose a different account.

For every write, prepare, display the complete preview, stop, and wait for a NEW explicit user message before `confirm_action` or `ai-hub confirm --profile <original-profile> --confirmation-id <id> --user-confirmation <message>`. Never infer confirmation from the original request. Core binds the preview and permits one dispatch.

If the result is unknown, do not resend or create a replacement client ID. Use supported read-only evidence and report unresolved status when it cannot be established. Core limits same-interface calls to at least one second apart; do not evade limits with alternate processes or profiles.

Do not request or expose API credentials in chat. Configure credentials only through the local profile workflow.
