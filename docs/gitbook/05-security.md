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
  --profile default

# Step 2: run only after a new, explicit user confirmation.
ai-hub confirm \
  --confirmation-id <confirmation-id> \
  --user-confirmation "yes" \
  --profile default
```

MCP uses the same boundary: call a `*_prepare_*` tool, display the preview, and stop. Only after a new user confirmation message may the Agent call `confirm_action`. An Agent must not generate, infer, or reuse confirmation text on its own.

## Local preflight checks

Before an order preview is created, the system lazily loads and caches symbol rules for the profile, including price precision, quantity precision, and minimum-order constraints. The cache is valid for one hour. Known precision or minimum violations are rejected locally before a preview is generated.

Local checks are not a fill guarantee. Balances, prices, market conditions, and server-side risk rules can change. If a write returns an uncertain network result, do not retry automatically; verify the final result by client order ID or history first.
