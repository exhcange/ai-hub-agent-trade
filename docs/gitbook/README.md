# 01 Quick Start

Use this page to install the CLI and MCP packages and create a local connection profile for your platform.

## Prerequisites

* Node.js 20 or later.
* A publicly reachable HTTPS OpenAPI endpoint for your tenant.
* An API key and secret key with the permissions required for your workflow.
* Cursor, Claude Desktop, Claude Code, or Codex if you plan to use MCP.
* A Skills-compatible AI Agent client, or a client that can load a Skill folder manually, if you plan to use Skills.

{% hint style="warning" %}
Create a dedicated API credential for AI Hub and follow least privilege: read-only permissions for query workflows, and only the specific trading or wallet permissions required for orders, cancellations, or transfers.
{% endhint %}

{% stepper %}
{% step %}
## Install the CLI and MCP packages

```bash
npm install -g @aihubspot/agent-trade-cli @aihubspot/agent-trade-mcp
```

Verify the installation:

```bash
ai-hub --help
ai-hub-trade-mcp --help
```
{% endstep %}

{% step %}
## Create a connection profile

The following example uses default as the profile name. Replace the sample URL with the HTTPS OpenAPI endpoint provided for your platform.

```bash
ai-hub config init
ai-hub config set --profile default --openapi-base-url https://your-openapi-domain
ai-hub config set-credentials --profile default
```

`set-credentials` prompts separately for the API key and secret key. The values are not echoed in the terminal.

Review the profile and test connectivity:

```bash
ai-hub config show --profile default
ai-hub market ping --profile default
```
{% endstep %}

{% step %}
## Run your first market queries

```bash
# Show a market summary.
ai-hub market ticker-summary --quote-asset USDT --limit 20 --profile default

# Retrieve the ticker for one exact symbol.
ai-hub market ticker --symbol BTCUSDT --profile default

# Retrieve price precision, quantity precision, and order minimums.
ai-hub market symbol-info --symbol BTCUSDT --profile default
```
{% endstep %}
{% endstepper %}

## Next steps

* Use the terminal or scripts: [Command Line](03-command-line.md)
* Connect an AI client: [MCP](02-mcp.md)
* Install agent operating guidance: [Skills](04-skills.md)
