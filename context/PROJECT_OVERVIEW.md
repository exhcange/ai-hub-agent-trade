# Project overview

`ai-hub-agent-trade` is a local Node.js toolset for AI agents and terminals.

- `packages/cli`: terminal entry point.
- `packages/mcp`: local stdio MCP server.
- `packages/core`: shared configuration, credential, safety, and OpenAPI abstractions.
- `skills`: English-only agent instructions.

The product is SaaS multi-tenant. Each local profile contains one tenant's OpenAPI base URL and references only that profile's credentials. The first release covers spot trading and its account, deposit/withdrawal, and sub-account companion APIs only.
