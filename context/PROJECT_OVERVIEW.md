# Project overview

`ai-hub-agent-trade` is a local Node.js toolset for AI agents and terminals.

- `packages/cli`: terminal entry point.
- `packages/mcp`: local stdio MCP server.
- `packages/core`: shared configuration, credential, safety, and OpenAPI abstractions.
- `skills`: English-only agent instructions.

The product is SaaS multi-tenant. Each local profile contains one tenant's OpenAPI base URL and references only that profile's credentials. The original release covered spot trading and its account, deposit/withdrawal, and sub-account companion APIs. The owner-approved Futures extension now adds 25 public HTTP operations, 26 semantic tools and six Futures Skills, reusing three spot transfer capabilities. Product routes use the fixed `spot` and `futures` profiles; all writes share Core prepare/confirm. See `FUTURES_IMPLEMENTATION_DESIGN.md` for the approved architecture and `../docs/FUTURES_DELIVERY.md` for implementation and acceptance status.
