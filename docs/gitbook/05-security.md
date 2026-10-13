# 05 Security

## Credential security

Create a dedicated API credential for AI Hub and follow least privilege.

* Public market reads do not require an API key.
* Account, order, and wallet reads require the relevant read permissions.
* Orders, cancellations, and transfers require the relevant trading or wallet permissions.
* Never upload API keys, secret keys, `~/.ai-hub/config.toml`, or terminal history to GitHub, a chat, or a shared document.
* Configure IP allowlists, scopes, and expiration when the platform supports them.

The current version stores credentials locally in `~/.ai-hub/config.toml`. The configuration directory uses mode `700` and the file uses mode `600`. `ai-hub config show` never prints secret values, but the security of the local account and disk remains the user's responsibility.

## Every write requires a second confirmation

Orders, cancellations, transfers, withdrawals, and sub-account changes follow this flow:

{% stepper %}
{% step %}

## Create a preview

The Agent or CLI validates the request and returns a **preview** only.
{% endstep %}

{% step %}

## Review the preview

The preview includes the action summary, `confirmationId`, and expiry time.
{% endstep %}

{% step %}

## Send an explicit confirmation

The Agent must stop and wait for a new, explicit user message sent **after** the preview.
{% endstep %}

{% step %}

## Confirm the action

Only after receiving that message may it use `confirmationId` to confirm.
{% endstep %}

{% step %}

## Note confirmation limits

A confirmation can be consumed once and expires after five minutes by default.
{% endstep %}
{% endstepper %}

CLI example:

```bash
# Step 1: create a preview only. No order is submitted.
ai-hub spot order market-sell \
  --symbol ETHUSDT \
  --base-quantity 0.5 \
  --profile spot

# Step 2: run only after a new, explicit user confirmation.
ai-hub confirm \
  --confirmation-id <confirmation-id> \
  --user-confirmation "yes" \
  --profile spot
```

MCP uses the same boundary: call a `*_prepare_*` tool, display the preview, and stop. Only after a new user confirmation message may the Agent call `confirm_action`. An Agent must not generate, infer, or reuse confirmation text on its own.

## Local preflight checks

Before a spot order preview is created, the system lazily loads and caches symbol rules for the profile, including price precision, quantity precision, and minimum-order constraints. The cache is valid for one hour. Known precision or minimum violations are rejected locally before a preview is generated.

Local checks are not a fill guarantee. Balances, prices, market conditions, and server-side risk rules can change. If a write returns an uncertain network result, do not retry automatically; verify the final result by client order ID or history first.

## Futures preview and confirmation

All ten Futures write operations follow the same boundary, including cancellations and the four trading settings. A request such as “place this order and confirm automatically” does not remove the requirement for a new confirmation message after the preview.

Review the actual returned preview before confirming:

| Action | What to check |
| --- | --- |
| Every Futures action | The `futures` profile, exact action, scope, confirmation ID and expiry. |
| Ordinary order | Contract, open/close and long/short intent, LIMIT/MARKET, quantity and unit, cross/isolated mode, price when applicable, client order ID. |
| Conditional order | All order parameters plus trigger direction, trigger price and execution price/type. The exchange manages triggering. |
| Position TP/SL | Target contract and matching position, closing side and every trigger entry, including quantity in contracts. |
| One ordinary/trigger cancellation | Correct order category, contract and exact ID or selected IDs. |
| All ordinary cancellations | Account-wide scope at execution time, current observed order count and its coverage limits. Triggers and positions are excluded. |
| Trading settings | Target mode/leverage or signed margin delta, affected account/contract/position, and current value only where verified. |
| Spot/Futures transfer | The `spot` profile, source and destination account types, asset, amount and source transferable balance. |

For example, after “preview an isolated LIMIT open-long order for 1 contract of E-BTC-USDT at 60000,” the Agent returns a preview and stops. The user can then send “Confirm this preview.” The Agent confirms that one preview. If the user instead changes the price or quantity, the Agent creates a new preview and waits again.

A confirmation is bound to the original profile, configuration, credentials and prepared request. Use it on that profile and only once. An expired preview needs to be prepared again; do not reuse an old confirmation or treat the original trading request as the later confirmation.

### Futures preflight and scope

Futures order preparation checks the selected contract's rules, price precision and quantity bounds. Coin quantities must map exactly to whole contracts. Futures confirmation repeats the relevant preflight checks because conditions may have changed since the preview.

Position-mode changes affect the whole account and require no active positions or ordinary orders. Margin-mode changes apply to one contract and require no relevant positions or ordinary orders. Margin adjustments require an owned, unfrozen isolated position. TP/SL requires an identifiable matching position. Exchange restrictions still apply; these checks do not guarantee acceptance or execution.

The Agent must not cancel orders, close positions or change settings automatically to satisfy these prerequisites. If a current setting cannot be verified, it remains unknown in the preview. An empty position list must not be used to invent a current setting.

All-cancel executes against **all ordinary orders then present in the Futures account**, not a fixed list captured during preview. New ordinary orders can therefore fall within its scope. Confirm it only when that account-wide action matches the user's request.

### Submission results and timeouts

A successful submission can report `accepted: true` with `executionVerified: false`. This means that the request was accepted; it does not establish that an order filled, a setting reached its target, or every order was canceled.

Futures writes are never automatically retried. For a timeout or another uncertain result:

1. Preserve the original order/operation identifiers and report that the result is unknown.
2. Use supported read-only evidence, such as ordinary order detail by the original client order ID. A missing current-list entry or a changed balance alone is insufficient proof.
3. If the result remains unknown, retain the unresolved state and seek authoritative platform/operator evidence. Do not create a replacement order, change the client ID, switch to CLI, or repeat a margin adjustment or transfer.

Unresolved writes persist locally and block overlapping writes until resolved with authoritative evidence. To inspect them without submitting an exchange write:

```bash
# Futures operations.
ai-hub futures operation-status --profile futures

# Spot/Futures transfers submitted through the spot profile.
ai-hub futures operation-status --profile spot --transfer
```

Normal query limits still apply during verification. Repeated polling does not make an unknown result safe to resend.

## Spot/Futures transfer verification

Both directions use the `spot` profile and spot-side API: `1 → 5` for Spot to Futures and `5 → 1` for Futures to Spot. Before the first transfer, independently verify that the profiles represent the intended same-user, same-tenant account pair. Then record a non-secret evidence identifier:

```bash
ai-hub config pair-products --evidence-id <non-secret-evidence-id> --operator-verified
```

This command records verification already performed by the operator; it does not prove account identity through an API. It also does not authorize a transfer. Each transfer still requires a source transferable-balance check, a complete preview and a new explicit confirmation on the spot profile.

Configure spot transfer permissions if transfers are needed; query-only MCP access does not expose the transfer preview or confirmation. Avoid granting withdrawal or unrelated permissions merely to enable Spot/Futures transfers.

Changing a profile endpoint clears its old endpoint-bound credentials. Configure the appropriate credentials locally and reverify the account pairing when its configuration changes. Do not copy credentials to a guessed endpoint.
