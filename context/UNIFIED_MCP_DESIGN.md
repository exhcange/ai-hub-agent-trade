# Unified merchant MCP implementation

Approved by the owner on 2026-11-04: implement in the Fork checkout on codex/unified-mcp; do not push. This supersedes the earlier fixed-profile/two-server rule only for unified profiles. No production calls or actual user profile migration are part of repository implementation.

- Keep Product = spot|futures on tools and execution contexts. Add products=[spot,futures] and a Futures URL to a merchant profile, with credentials stored once.
- Derive the Futures HTTPS hostname by changing the exact openapi first label to futuresopenapi; validate both endpoints. Retain explicit override for nonstandard environments.
- Resolve one immutable profile/credential snapshot per request and select the endpoint from ToolSpec.product. Wallet transfers always use the spot context. Keep the product-specific adapters and signatures.
- Expose the union of supported tools on one MCP server, retain tool names, and enforce global/per-product read-only filters on discovery and confirmation.
- Resolve confirmation routing by non-consuming persisted metadata, restrict it to the bound merchant and permitted action, then use the existing atomic consume/validate/dispatch path. New unified confirmations include explicit product identity. Legacy binding format stays compatible.
- Keep legacy single-product profiles and the existing installer. Explicit unify-products migration checks source product/credentials/domain relationship, defaults to dry-run, and requires a new target name. It preserves original durable state identities while replacing source config entries. Old previews are not migrated; account pairing must be reverified. Stop source clients before applying migration.
- Never infer verified account pairing from hostnames or shared credentials. Keep evidence-bearing pairing for transfers.
- Update CLI, deterministic/Agent shortcut routing, repository Skills and English setup guidance. Do not modify installed Skills, real credentials or client config as a side effect of development.
