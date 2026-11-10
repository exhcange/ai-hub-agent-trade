# Unified Spot and Futures MCP

One merchant profile can expose both products through one local MCP process. The profile stores one API key/secret pair and two validated endpoints. The selected tool determines the product; callers cannot supply a request host.

## New installation

```bash
npm install -g @aihubspot/agent-trade-cli @aihubspot/agent-trade-mcp
ai-hub config init
ai-hub config set --profile merchant --products spot,futures --openapi-base-url https://openapi.example.com
ai-hub config set-credentials --profile merchant
ai-hub config show --profile merchant
ai-hub market ping --profile merchant
ai-hub futures ping --profile merchant
ai-hub-trade-mcp setup --client codex --profile merchant
npx skills add exhcange/ai-hub-agent-trade
```

Replace the example with your merchant's spot OpenAPI domain. Replace `codex` with the supported client you use. Credential input is interactive and hidden. Never pass keys in command arguments or chat. Install all twelve spot/Futures Skills. Reload the MCP connection after setup; fully restart the client if its old process remains.

One registration is named `aihub-merchant`. Each client connection starts its own combined-product stdio process, so multiple open sessions can create multiple processes. It exposes both products, a single `system_get_capabilities`, and at most one `confirm_action`. Check `products`, `productScope`, `productAccess`, `profile`, and `serviceVersion`. Installing a Skill does not configure a profile or change permissions.

Unified profiles use configuration format version 2. The current CLI reads legacy version 1 files too; older CLI versions intentionally reject a version 2 file rather than silently overwrite a unified profile. Update CLI and MCP together.

## Domain derivation

`https://openapi.example.com` derives `https://futuresopenapi.example.com`. Only the first hostname label changes. The automatic rule accepts HTTPS origins with the exact `openapi.` prefix and no path, non-default port, user information, query, or fragment. It also works with nested merchant suffixes. Both endpoints pass the existing public-address validation before the configuration is saved.

For a nonstandard environment, provide the Futures endpoint explicitly:

```bash
ai-hub config set --profile merchant --products spot,futures \
  --openapi-base-url https://spot-api.example.com \
  --futures-base-url https://futures-api.example.com
```

Both products use the same locally stored credentials. Signature serialization, headers and API adapters remain product-specific. Changing either endpoint clears the shared credentials and invalidates existing previews and account-pair verification. Re-enter credentials only after checking the new addresses. Updating a unified profile must include `--products spot,futures`; it cannot silently become a single-product profile.

Startup does not probe the exchange or write configuration. Run the public ping commands above to diagnose each product independently. Failure on one API does not disable the other product's queries; a process failure disconnects both.

## Queries and writes

```bash
ai-hub account asset-balance --asset USDT --profile merchant
ai-hub futures account assets --profile merchant
ai-hub futures account positions --profile merchant
ai-hub futures operation-status --profile merchant
ai-hub futures operation-status --profile merchant --transfer
aihub show balances --profile merchant
```

CLI command groups and registry metadata select the product. Unspecified balances query the two views separately and preserve partial failures; do not add cross-product totals. Existing tool names and API allowlists remain unchanged.

Preparation never submits the requested write. Display the preview, stop, and wait for a NEW explicit user confirmation. Then use `confirm_action` on the same server, or:

```bash
ai-hub confirm --profile merchant --confirmation-id <id> --user-confirmation "Confirm this preview"
```

Confirmation routing reads non-consuming metadata, checks the merchant and permitted action, resolves the product, and then atomically consumes and validates the original binding. Product, endpoint, configuration and credential changes cannot redirect a preview. Confirmations remain single-use and expire after five minutes. Unknown write results are not automatically retried.

## Read-only access

```bash
# Both products read-only.
ai-hub-trade-mcp setup --client codex --profile merchant --read-only

# Spot read-only; Futures writes still require prepare/confirm and API permissions.
ai-hub-trade-mcp setup --client codex --profile merchant --spot-read-only

# Futures read-only; Spot writes still require prepare/confirm and API permissions.
ai-hub-trade-mcp setup --client codex --profile merchant --futures-read-only
```

Restrictions are applied before tools are exposed and before a prepared action can be confirmed. Global read-only cannot be overridden by a product flag. For transfer-only access, the existing `--toolset transfer` remains available and uses the spot endpoint. The spot-side write policy also controls both directions of Spot/Futures transfer.

## Transfers

Both `1 -> 5` and `5 -> 1` use spot wallet tools and the unified merchant profile. Identical credentials and related hostnames do not themselves prove account pairing. After independently verifying the account pair, record non-secret evidence:

```bash
ai-hub config pair-products --profile merchant --evidence-id <non-secret-proof-id> --operator-verified
```

Every transfer still checks source transferable funds and requires its own preview and new confirmation. Credential or endpoint changes invalidate pairing. Shared credentials do not grant additional platform permissions.

## Migrate existing separate profiles

Existing single-product profiles and registrations remain supported. To explicitly merge matching legacy profiles, stop their MCP processes and other local trading commands first:

```bash
# Inspect only: no configuration or state changes.
ai-hub config unify-products --profile merchant --spot-source spot --futures-source futures

# Apply after checking the source profiles.
ai-hub config unify-products --profile merchant --spot-source spot --futures-source futures --apply

ai-hub config pair-products --profile merchant --evidence-id <non-secret-proof-id> --operator-verified
ai-hub-trade-mcp setup --client codex --profile merchant
```

The target must be a new name. Sources must have the expected products, identical complete credentials, and endpoints matching the automatic derivation rule. A mismatch fails without changing configuration. The dry run does not expose credentials or read exchange data.

Apply replaces the two source profiles with one profile and one credential pair. It preserves the source names as non-secret durable-state identities, so existing unresolved Futures/transfer reservations and spot duplicate blockers remain effective. Old previews cannot be confirmed under the new profile; prepare them again after resolving any unknown outcome. Pairing must be verified again. No pending or unresolved state files are deleted by migration.

If the previous default was either source, the new profile becomes the default; otherwise keep selecting it explicitly. Verify the new server, then remove only the two old AI Hub registrations in your client. Setup intentionally does not delete unrelated or old-profile registrations. Do not run old and new registrations together during migration. The existing `install-local-products.mjs` remains a legacy two-profile installer; use the commands above for a unified installation.

## Verification status

The implementation is covered by local configuration, CLI, MCP routing, confirmation and regression tests using synthetic credentials and mocked exchange responses. These checks do not establish live merchant API acceptance. Actual local credential migration, client registration, package publication, and real trades are separate actions.
