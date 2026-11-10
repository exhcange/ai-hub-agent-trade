---
name: ai-hub-futures-transfer
version: "0.1.31"
description: Transfer between spot and Futures using the existing spot-side capabilities.
---

# Ai Hub Futures Transfer

## Unified merchant connections

A single MCP server may support both Spot and Futures. Select the configured merchant by `system_get_capabilities`, including `products` and `productAccess`; never infer its product from the server name. Use product-specific tools on that same server. For CLI fallback, use the selected unified merchant profile for either product, replacing legacy `--profile spot` / `--profile futures` examples below. Never switch merchant profiles to recover from a failed request. Existing separate product profiles remain supported.


Both directions use the spot-side context of the selected unified merchant profile, or the legacy `spot` profile and existing `wallet_get_transferable_assets`, `wallet_get_universal_transfer_history`, and `wallet_prepare_universal_transfer` tools. CLI equivalents are `ai-hub wallet <operation> --profile spot`.

Account type 1 is spot and 5 is Futures. Restrict this workflow to 1 -> 5 or 5 -> 1. A transfer-only MCP session must not grant unrelated writes. Verify intended account pairing; a similarly named profile is not identity evidence. Never transfer credentials across profiles.

Preview direction, coin, exact amount, actual account identity and verified transferable balance. Do not substitute generic account equity for transferable balance or invent fees. Reconcile by transfer identity/history when supported; balance deltas alone cannot prove success.

## Execution boundary

Prefer the available MCP tool. Use CLI only if MCP is unavailable before dispatch; never retry a possibly submitted write through another transport. Profile configuration errors are not permission to choose a different account.

For every write, prepare, display the complete preview, stop, and wait for a NEW explicit user message before `confirm_action` or `ai-hub confirm --profile <original-profile> --confirmation-id <id> --user-confirmation <message>`. Never infer confirmation from the original request. Core binds the preview and permits one dispatch.

If the result is unknown, do not resend or create a replacement client ID. Use supported read-only evidence and report unresolved status when it cannot be established. Core limits same-interface calls to at least one second apart; do not evade limits with alternate processes or profiles.

Do not request or expose API credentials in chat. Configure credentials only through the local profile workflow.
