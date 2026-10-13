# 01 Quick Start

Use this page to install the CLI and MCP packages and create a local connection profile for your platform.

## Prerequisites

* npm installed, with Node.js 20 or later.
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

## Create spot and Futures profiles

Create one profile for each product. Use spot for spot trading and futures for Futures. Replace both example URLs with the respective OpenAPI HTTPS endpoints supplied by your platform; do not use the website or App API address.

```bash
ai-hub config init
ai-hub config set --profile spot --product spot --openapi-base-url https://your-spot-openapi-domain
ai-hub config set-credentials --profile spot
ai-hub config set --profile futures --product futures --openapi-base-url https://your-futures-openapi-domain
ai-hub config set-credentials --profile futures
```

set-credentials prompts separately for the API key and secret key without echoing them. Configure each product's credentials locally; do not share them in chat.

Review the product markers and test public connectivity:

```bash
ai-hub config show --profile spot
ai-hub config show --profile futures
ai-hub market ping --profile spot
ai-hub futures ping --profile futures
ai-hub futures time --profile futures
```

Public endpoints require no credentials. Account and order queries require the selected profile's credentials.

{% endstep %}

{% step %}

## Run your first market queries

```bash
# Show a market summary.
ai-hub market ticker-summary --quote-asset USDT --limit 20 --profile spot

# Retrieve the ticker for one exact symbol.
ai-hub market ticker --symbol BTCUSDT --profile spot

# Retrieve price precision, quantity precision, and order minimums.
ai-hub market symbol-info --symbol BTCUSDT --profile spot
```

{% endstep %}
{% endstepper %}

## First Futures queries

Start with the public contract list, then query your account using the Futures credentials configured above.

```bash
ai-hub futures contracts --profile futures
ai-hub futures account assets --profile futures
ai-hub futures account positions --profile futures
```

`contracts` returns the exact contract identifiers and trading rules. `assets` returns account money with two-decimal display, while `positions` returns active positions with quantities in contracts. For a ticker, first choose a contract from the returned list; see the Futures examples in [Command Line](03-command-line.md).

Next, register both profiles with the same client using the MCP chapter, and install spot and Futures guidance using the Skills chapter. Installing npm packages alone does not complete those steps.

## Next steps

* Use the terminal or scripts: [Command Line](03-command-line.md)
* Connect an AI client: [MCP](02-mcp.md)
* Install agent operating guidance: [Skills](04-skills.md)
