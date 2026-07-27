# Shared Preflight

Apply this preflight before an authenticated command or any command that changes state.

## 1. Select the local profile

```bash
ai-hub config show --profile <profile>
```

If no profile exists, create one before continuing:

```bash
ai-hub config init
ai-hub config set --profile <profile> --openapi-base-url https://your-openapi-domain
ai-hub config set-credentials --profile <profile>
```

Use `--profile <profile>` on an API command when the desired profile is not the default. Do not expose, print, or pass API credentials as command-line flags. The credential setup command prompts locally and saves plaintext credentials to `~/.ai-hub/config.toml`, which is written with mode `600`.

## 2. Classify the operation

- **Read-only:** execute after validating the requested parameters. Public market commands do not require credentials; account, order, wallet, and sub-account reads do.
- **Test order:** `ai-hub spot order test` validates an order without sending it to the matching engine. It is safe to execute as a read-like validation call.
- **State-changing:** placing or cancelling an order, transferring assets, withdrawing assets, creating a sub-account, changing a capability, or changing an API-key IP whitelist.

## 3. Enforce the confirmation boundary

For a state-changing operation:

1. Collect every required field and show the intended action in plain language.
2. Invoke the CLI command once, optionally with `--prepare`. It prints an exact preview, a `confirmationId`, and `executed: false`, then exits.
3. Stop. Do not type, pipe, generate, or infer a confirmation. Do not use `--confirm` because it is rejected.
4. Wait for a new explicit user message. Only after that message, invoke `ai-hub confirm --confirmation-id <id> --user-confirmation <message>` once. Any failure, expiry, or context change consumes the preview and requires a new preview.
5. Do not automatically retry an uncertain result. Query the relevant order or history endpoint first.

For a local MCP client, use the same rule: prepare the action, show the exact preview, stop for a new user message, then confirm once. The original instruction, a previous confirmation, silence, and agent-generated text are never confirmation.

## 4. Handle failures

| Condition | Action |
| --- | --- |
| `AI_HUB_CREDENTIAL_NOT_CONFIGURED` | Run `ai-hub config set-credentials --profile <profile>` in an interactive terminal. |
| `AI_HUB_INVALID_ARGUMENT` | Correct the named parameter; do not guess missing values. |
| `AI_HUB_OPENAPI_NETWORK_ERROR` or `AI_HUB_OPENAPI_HTTP_ERROR` | Do not retry a write automatically. Check its outcome first. |
| `AI_HUB_OPENAPI_BUSINESS_ERROR` | Read [openapi-error-diagnosis.md](openapi-error-diagnosis.md). Follow `reason` and `suggestedAction`; preserve the original upstream code and message. |
| Confirmation declined, expired, or context changed | Start a new preview only after the user requests the action again. |
