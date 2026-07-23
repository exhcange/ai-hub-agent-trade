# AI Hub Agent Trade MCP

Install with `npm install -g @aihubspot/agent-trade-mcp`, then start `ai-hub-trade-mcp --profile default`.

This package provides a local stdio MCP server. State-changing operations require a preview and a new explicit user confirmation.

It reads the same local profile as the CLI from `~/.ai-hub/config.toml`. The API key and secret key are stored as plaintext in that file with mode `600`; configure them once through `ai-hub config set-credentials --profile <name>`. Do not share this file.
