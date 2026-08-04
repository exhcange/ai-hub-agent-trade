# CLI Routing Reference

Use the focused Skill for the command family instead of loading every command reference.

| Command family | Focused Skill |
| --- | --- |
| `ai-hub market ...` | `ai-hub-spot-common` |
| `ai-hub account ...` | `ai-hub-spot-account` |
| `ai-hub spot order ...` | `ai-hub-spot-order` |
| `ai-hub wallet ...` | `ai-hub-spot-deposit-withdraw` |
| `ai-hub sub-account ...` | `ai-hub-spot-sub-account` |

Global profile option:

```bash
ai-hub market price --symbol BTCUSDT --profile default
```

The profile option may appear with any API command. It selects the locally stored OpenAPI URL and credential reference; it never exposes the secret values.
