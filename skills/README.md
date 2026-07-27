# AI Hub Agent Skills

English-language Skills for AI agents that operate supported AI Hub spot-account workflows through the `ai-hub` CLI. Each Skill supplies routing, safety boundaries, and command guidance; the CLI remains the execution interface.

## Skills

| Skill | Purpose | Credentials |
| --- | --- | --- |
| [ai-hub-spot](ai-hub-spot/SKILL.md) | Routes supported market, account, order, wallet, and sub-account requests. | Depends on operation |
| [ai-hub-spot-common](ai-hub-spot-common/SKILL.md) | Retrieves public market data and applies common operating rules. | No |
| [ai-hub-spot-order](ai-hub-spot-order/SKILL.md) | Inspects, tests, places, and cancels spot orders. | Yes |
| [ai-hub-spot-account](ai-hub-spot-account/SKILL.md) | Retrieves account information and account transfer history. | Yes |
| [ai-hub-spot-deposit-withdraw](ai-hub-spot-deposit-withdraw/SKILL.md) | Manages wallet information, transfers, deposits, and withdrawals. | Yes |
| [ai-hub-spot-sub-account](ai-hub-spot-sub-account/SKILL.md) | Manages supported sub-account information and operations. | Yes |

## Requirements

Install the CLI and create a local profile before using a Skill:

```bash
npm install -g @aihubspot/agent-trade-cli
ai-hub config init
ai-hub config set --profile default --openapi-base-url https://your-openapi-domain
ai-hub config set-credentials --profile default
```

The profile stores the OpenAPI URL, API key, and secret key in `~/.ai-hub/config.toml`. The configuration directory and file use mode `700` and `600` respectively. Never include credentials in prompts, Skill files, command arguments, or source control.

## Operating Rules

- If the selected profile is already configured, run the focused command directly. Use configuration commands only for first-time setup, a profile change, or a configuration/credential error.
- Every state-changing command first prints an exact preview and exits. After a new explicit user message, invoke `ai-hub confirm` with the returned confirmation ID and that message.
- An agent must never fabricate a confirmation or treat the original request as approval. It must stop after the preview and wait for a fresh user decision.
- Skills do not define MCP tools. A separately installed local MCP client follows the same capability and confirmation rules.

Read [_shared/preflight.md](_shared/preflight.md) only when setup or a configuration/credential error requires it.

## Skill Format

Every Skill contains portable YAML frontmatter with `name`, `version`, and `description`, followed by agent instructions. Detailed command parameters and examples are stored in its `references/` directory so that an agent loads them only when required.
