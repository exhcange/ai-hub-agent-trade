# AI Hub Agent Trade CLI

Install globally with `npm install -g @aihubspot/agent-trade-cli`, then run `ai-hub --help`.

Create a local profile and enter credentials interactively:

```bash
ai-hub config init
ai-hub config set --profile default --openapi-base-url https://your-openapi-domain
ai-hub config set-credentials --profile default
```

The API key and secret key are stored as plaintext in `~/.ai-hub/config.toml`. The configuration directory and file use mode `700` and `600` respectively. `ai-hub config show` never prints the key values. State-changing operations require a preview and a new interactive confirmation.

If the profile was created by an earlier Keychain-based build, run `ai-hub config set-credentials --profile <name>` once after upgrading. Credentials are not migrated automatically.
