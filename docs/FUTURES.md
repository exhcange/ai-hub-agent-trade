# Futures integration

This extension changes AI Hub only. It adds a Futures adapter, 26 semantic Core operations backed by 25 approved HTTP operations, CLI/MCP exposure, six Skills, product-aware profiles, and reuse of three spot transfer capabilities. The spot frontend team owns Skill display; there is no frontend or exchange-server implementation here.

## Configuration and migration

Commands below are operator instructions, not actions performed during development. Replace endpoint placeholders with the approved environment. Public market reads do not require credentials. Signed reads and writes require credentials configured locally, never in chat or command arguments.

```sh
ai-hub config set --profile spot --product spot --openapi-base-url https://YOUR-SPOT-ENDPOINT
ai-hub config set --profile futures --product futures --openapi-base-url https://YOUR-FUTURES-ENDPOINT
ai-hub config set-credentials --profile spot
ai-hub config set-credentials --profile futures
```

Legacy profiles without product remain spot-compatible. Product routes use fixed spot/futures names. The explicit migration command defaults to a redacted dry run; target collisions abort without overwriting. Supply the actual old profile names, review the plan, then explicitly apply it:

```sh
ai-hub config migrate-products --spot-source OLD-SPOT --futures-source OLD-FUTURES
ai-hub config migrate-products --spot-source OLD-SPOT --futures-source OLD-FUTURES --apply
```

Changing an endpoint removes the old stored credentials; reconfigure them for that endpoint. Profile/credential changes invalidate confirmation context and account pairing. Migration does not automatically rewrite installed MCP clients or install Skills.

For transfers, an operator must independently establish that the two profiles represent the intended same-user/tenant account pair. The following records that verified evidence; it does not verify identity through an exchange API:

```sh
ai-hub config pair-products --evidence-id NON-SECRET-VERIFICATION-ID --operator-verified
```

Do not pass API keys, secret keys or credential references as evidence IDs. A profile name or matching balance is not account identity evidence.

## MCP and Skills

```sh
ai-hub-trade-mcp --profile futures --read-only
ai-hub-trade-mcp --profile futures
ai-hub-trade-mcp --profile spot --toolset transfer
```

The Futures server exposes Futures tools only. The transfer toolset exposes the two existing spot transfer reads and the transfer prepare/confirm path restricted to account types 1 and 5. Read-only mode still removes all writes. Existing full/default spot sessions retain their other spot capabilities.

The six source Skills are ai-hub-futures, ai-hub-futures-common, ai-hub-futures-account, ai-hub-futures-order, ai-hub-futures-trade and ai-hub-futures-transfer. Their SKILL.md descriptions and agents/openai.yaml metadata can be used by the spot frontend team for display. Ship descriptions, supported examples, the confirmation boundary and the limitations below together. No Skills were installed into a user's runtime by this change.

See [the operation reference](FUTURES_OPERATIONS.md) for the Core/MCP/CLI mapping. MCP write names contain futures_prepare_; the underlying write is never directly exposed. CLI writes produce a preview and exit.

## Reads and routing

Explicit Futures commands default to futures; explicit spot commands default to spot. The aihub balance shortcut queries both fixed profiles when product is unspecified, retaining successful components on partial failure. It does not add equity, margin, available funds or unrealized PnL across products. Profile pairing status is separate from the reported components.

Paged Futures queries default to 20 and cap at 50. Depth applies that limit per side. Contracts and current ordinary orders support five-minute local immutable snapshot continuation when output spans more than one page; pass the returned cursor with the same query/profile. This proves coverage of the captured response, not of all exchange data. Current ordinary orders can already be capped upstream.

Transaction and current trigger lists use page+limit. Historical PnL uses an inclusive position-ID lower bound, so continuation is the maximum consumed ID plus one, even if the controller reorders the page by time. Ordinary history and user-fill lower bounds do not establish safe backward continuation; their output does not invent a next cursor. A null continuation must not be described as proof that the whole account history is exhausted.

Explicit time windows are limited to six calendar months. Current timestamp validation uses UTC calendar boundaries; resolve human date requests to explicit timestamps. A query allowance is not a guarantee of six months of server retention, especially for recent-ID-limited user fills.

Financial numbers and IDs preserve numeric tokens before conversion. Asset-query monetary fields are displayed as strings with two decimal places using exact decimal half-up rounding (negative ties away from zero). This display rounding does not change raw account data used in validation, position output, or write parameters. Fields with unverified units remain unconverted. Normal transaction output includes business types 1-13 and 28, without a filtering-scope notice. Real errors and truncation remain visible.

## Writes

Prepare -> display the full preview -> stop -> new explicit user message -> confirm once:

```sh
ai-hub futures trade place --profile futures --contract-name E-BTC-USDT --intent open-long --type LIMIT --quantity 2 --unit contracts --margin-mode isolated --price 100.00
# Only after the user separately confirms the returned preview:
ai-hub confirm --profile futures --confirmation-id PREVIEW-ID --user-confirmation 'Confirm this preview'
```

This example is illustrative and was not submitted. Contract rules are read before prepare and rechecked before confirm. No automatic mode/leverage changes, position closing or cancellation repairs occur. Coin quantities must map exactly to integer contracts under the verified contract multiplier. TP/SL requires one unambiguous matching position. Position-mode changes are account-wide; margin mode and leverage are contract-specific; margin adjustments target an owned unfrozen isolated position.

Conditional/TP-SL orders are submitted with trigger prices and managed by the exchange, not by Agent price watching. Full cancellation requires scope=all-ordinary-orders and covers account-wide ordinary orders at execution time; it excludes conditions and positions. An acknowledgment is not proof that all orders were cancelled.

Same-interface requests are coordinated across participating local CLI/MCP processes with at least one second between requests. Different machines are not coordinated. Futures reads retry at most once for transient transport/429/502/503/504 within a bounded budget; writes never automatically retry. Confirmation expiry is checked before Futures and transfer dispatch after queueing. A new overlapping Futures preview invalidates older pending previews; unrelated contract previews remain usable.

## Unknown outcomes and operator resolution

Futures and Futures-transfer writes create durable reservations before dispatch. On uncertain outcomes, overlapping intents remain blocked across restarts. Known unrelated contract scopes can continue. Ordinary placement attempts one read-only lookup using the original client ID; not-found is not proof of non-execution. Other operations without reliable readback remain unresolved.

```sh
ai-hub futures operation-status --profile futures
ai-hub futures operation-status --profile spot --transfer
# Only after authoritative evidence establishes the outcome:
ai-hub futures resolve-operation --profile futures --operation-id OPERATION-ID --outcome executed --evidence-id NON-SECRET-EVIDENCE-ID --operator-verified
```

Use --transfer with the spot profile for transfer resolution. Resolution archives the original reservation and evidence; it does not send an exchange write. Do not resolve from balance changes, disappearance from a current-only list, or elapsed time alone. Multiple unresolved operations require selecting one ID.

## Acceptance boundaries

Mocks/source fixtures validate local behavior, not deployed API parity. No production endpoint, actual profile migration, live trade, installed MCP configuration or exchange backend was changed during development.

The following remain live-acceptance/contract limitations and must not be represented as verified guarantees:

- cancel_all uses a bounded backend query and does not expose individual cancellation outcomes in the inspected source; AI Hub reports acceptance, not verified all-cancel completion.
- Ordinary history/user-fill continuation and server retention need authoritative coverage before promising exhaustive history. Unsupported public parameters are not added from internal APIs.
- Cached account data cannot reliably attribute a setting/margin change. Operator evidence remains necessary when no supported readback exists.
- Trigger terminal-state coverage and partial-batch results are incomplete in the public contract. Missing or partial creation identities retain an unknown outcome.
- Coin quantities must divide exactly by the contract multiplier. Value quantities are converted and rounded down by the exchange at its reference/execution price; the preview discloses that final contract quantity is not guaranteed. Missing rule fields fail rather than guess. Every order-unit/mode combination still needs live acceptance.
- Transfer previews use the published canTransferBalance field and recheck it before dispatch. The published transfer-history response does not identify a unique transfer operation, so uncertain transfers require operator evidence; balance deltas are not substituted. Fees are not invented.

Deferred by agreement: public recent market trades, ordinary batch placement and selected ordinary batch cancellation. Other exclusions remain ticker_all, WebSocket and strategy/copy/grid/robot/internal operations.

Order, fill, trigger-order and position result rows identify contract quantities with quantityUnit=contracts and quantityFields. These quantity values retain their exact API representation; localized Chinese display uses 张 and omits trailing decimal zeros for integers. Prices, money, identifiers and market volume are not covered by this quantity label.
