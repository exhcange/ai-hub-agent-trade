# Futures extension: approved consolidated design

Status: approved by the owner with the subsequent instruction to begin development on 2026-09-14. Repository-only implementation is authorized; runtime configuration changes, publishing and production calls are not implied. See ../docs/FUTURES_DELIVERY.md for implementation evidence and remaining live-acceptance limits. C02-C19 product directions are approved. C01 identifies a production environment, not permission to access it. Endpoint facts still requiring verification are listed below. This document supersedes historical proposals in FUTURES_DESIGN_HANDOFF.md where they conflict; that file retains evidence and decision history.

## 1. Delivery boundary

Modify only ai-hub-agent-trade. The local chainup-futures checkout is a read-only reference. No Futures backend changes, database changes, PC/H5 UI development or external frontend changes. The spot frontend team will display/explain the delivered Skills using the supplied descriptions and documentation. Publishing packages, installing Skills, migrating actual profiles and live trading are separate execution activities.

Deliver all 25 approved Futures HTTP operations and reuse three spot transfer operations. Public market recent trades, ordinary batch placement and selected ordinary batch cancellation are accepted deferred PRD gaps. Exclude ticker_all, WebSocket, KOL/copy/grid/robot/internal operations. Do not simulate missing batch APIs by looping writes. A contract blocker does not silently remove an approved operation from delivery or count an unavailable operation as complete.

## 2. Implementation alternatives

| Approach | Benefit | Cost / limitation |
| --- | --- | --- |
| A. Shared Core, separate Futures Adapter (recommended) | Reuses existing confirmation, registry, CLI/MCP and spot transfer foundation; keeps product payloads and schemas separate | Requires deliberate changes to currently spot-specific context and registry types |
| B. Independent Futures package/runtime | Strong isolation of transport and releases | Duplicates confirmation, persistence, rate limiting and profile logic; increases migration and regression burden |
| C. Direct API calls in Skills/CLI wrappers | Small initial scaffolding | Cannot consistently enforce the approved shared safety, routing and output rules across CLI/MCP; unsuitable for this delivery |

Recommend A. Keep current package identities for compatibility; do not rename npm packages merely to add Futures commands.

## 3. Architecture and responsibility

Flow: user intent -> router/domain Skill -> MCP or CLI -> shared ToolRegistry -> product-validated execution context -> Futures Adapter or existing Spot API. All writes enter shared prepare/confirm before transport dispatch.

- Extend ToolSpec with explicit product and capability metadata. Risk classification is semantic: historical POST reads remain reads. Discovery filtering and execution authorization use the same policy.
- Add a Futures Adapter beside the existing Spot API. It owns endpoint metadata, exact request serialization, version headers, lossless response parsing and endpoint-specific normalization. Do not make spot response handling accept arbitrary Futures payloads.
- ExecutionContext constructs only the adapter appropriate to the validated profile. No ad hoc cross-profile requests inside a Core operation. Transfers are spot operations; dual balance views orchestrate two separate reads.
- Extend existing write executor/confirmation/unresolved-write storage rather than implement separate Futures confirmations. Add operation-specific reconciliation strategies.
- CLI/MCP share schemas, validators, output models and policy enforcement. Skills guide dialogue and tool selection, not independent signing or trading implementations.
- Extend the deterministic fast route carefully: explicit Futures intent must never hit spot logic; unspecified balances follow dual reads; ambiguous trading requests ask for product/instrument clarification.

Principal existing integration points: packages/core/src/config.ts, openapi.ts, tools/tool-spec.ts, tools/tool-registry.ts, tools/execution-context.ts, tools/write-executor.ts, confirmation.ts, unresolved-write.ts, fast-router.ts; packages/cli/src/index.ts and fast.ts; packages/mcp/src/server.ts and index.ts; Core setup/capability generation; skills and release checks. New module filenames may follow repository conventions during implementation.

## 4. Profile routing, permissions and migration

| Intent | Fixed profile | Product |
| --- | --- | --- |
| Explicit spot | spot | spot |
| Explicit Futures | futures | futures |
| Unspecified balance | spot and futures independently | Separate components, no arithmetic total |
| Transfer 1 -> 5 or 5 -> 1 | spot | Existing spot transfer API |

No fallback to smoke/default or arbitrary available profiles. Missing profiles or wrong product markers are configuration errors. Legacy profiles lacking product retain spot compatibility, but do not satisfy the fixed Futures route. Endpoint resolution always comes from validated local configuration; no production base URL in executable code or Skills.

Proposed migration tooling emits a redacted dry-run plan first. Map the intended old smoke/default configurations to spot/futures only through an explicit migration action. Existing target-name collisions stop migration; never overwrite or merge credentials automatically. Preserve existing secure credential storage through the supported configuration layer without printing, exporting or committing credential references. If the endpoint changes, detach old credentials and invalidate outstanding previews. Bind previews to a non-secret configuration generation; never serialize credentials or credential references into action records. Actual migration is outside this design-review turn.

MCP server labels are not routing authority. Reuse the existing setup naming convention generated from the selected profile; resolve product/profile from validated capabilities. Update old setup registrations explicitly during migration, with no invisible label-based fallback.

Permission sets: existing read-only remains read-only; Futures write capability enables only approved Futures actions; a spot transfer capability permits the two transfer reads plus prepare/confirm for account types 1 and 5, not unrelated writes. Core checks transfer direction even if the underlying universal-transfer API accepts more account types. Do not silently enable this set on an existing read-only server.

Use verified same-user/tenant pairing for intended cross-product balances/transfers. If pairing is unknown, do not imply that two profiles represent one account or that funds will arrive in the configured Futures account.

## 5. Operation mapping

All Futures HTTP paths have /fapi/v1/ prefix. Names below are proposed registry operations; write operations are exposed through existing prepare/confirm plumbing, never direct execute. CLI suffixes follow ai-hub futures. Total: 26 Futures semantic operations (account splits into two), backed by 25 HTTP operations; generated helper/confirmation tools are not included in this count.

| HTTP operation | Core/MCP operation | CLI suffix |
| --- | --- | --- |
| GET ping | futures_ping | ping |
| GET time | futures_time | time |
| GET contracts | futures_contracts | contracts |
| GET depth | futures_depth | market depth |
| GET ticker | futures_ticker | market ticker |
| GET index | futures_index | market index |
| GET klines | futures_klines | market klines |
| GET account | futures_assets | account assets |
| GET account | futures_positions | account positions |
| GET order | futures_order_detail | order detail |
| GET openOrders | futures_open_orders | order open |
| POST orderHistorical | futures_order_history | order history |
| POST profitHistorical | futures_profit_history | account profit-history |
| GET myTrades | futures_my_trades | order trades |
| POST get_user_transaction | futures_transactions | account transactions |
| POST trigger_order_list | futures_trigger_orders | order triggers |
| POST order | futures_place_order | trade place |
| POST conditionOrder | futures_place_condition_order | trade condition |
| POST profitLossOrder | futures_place_profit_loss_order | trade profit-loss |
| POST cancel | futures_cancel_order | order cancel |
| POST cancel_all | futures_cancel_all_orders | order cancel-all |
| POST cancel_trigger_order | futures_cancel_trigger_order | order cancel-trigger |
| POST edit_user_position_model | futures_set_position_mode | trade position-mode |
| POST edit_user_margin_model | futures_set_margin_mode | trade margin-mode |
| POST edit_position_margin | futures_adjust_position_margin | trade position-margin |
| POST edit_lever | futures_set_leverage | trade leverage |

Reuse existing wallet transferable-assets, wallet transfer-history and wallet transfer under the spot profile. Do not duplicate these as Futures HTTP operations. Confirm retains the shared confirmation interface bound to the original profile/action. Exact exposed prepare helper names follow existing registry generation, avoiding a second confirmation protocol.

## 6. Input, transport and output contracts

- Resolve contracts from the tenant's contract list. Preserve ambiguity rather than infer product from a symbol. Represent IDs and financial values as exact strings before ordinary JSON numeric conversion. Validate precision and allowed quantities using verified contract rules; do not silently round or convert using assumed multipliers.
- Sign the exact sent bytes: millisecond timestamp + uppercase method + path + optional question-mark/query + body, HMAC-SHA256 UTF-8 lowercase hex. Reuse the signing primitive. Send futures-version:101 on order POST, conditionOrder, profitLossOrder, cancel_trigger_order and trigger_order_list only under the reviewed metadata. No legacy-header fallback.
- Decode raw/wrapped results per endpoint; wrapped code 0 or string 0 is business success. HTTP 200 alone is not success. Preserve safe error codes and sanitized messages, never raw headers, unchecked payloads or stacks.
- Preserve existing MCP envelope structure. A read carries normalized data plus accurate pagination/source metadata. A write distinguishes accepted, rejected, partial and unknown; acceptance is not a promise of a fill. Field allowlists omit internal/counterparty identifiers while keeping usable order/position IDs.
- Keep last price, index, mark and funding distinct. No invented percent, annualization, volume conversion or freshness. fetchedAt is local retrieval time. Futures intervals use their own validated enum, not spot aliases.
- Separate asset fields and positions. Do not infer configured leverage/modes from empty positions. Account snapshots may be stale; current data is not assumed suitable for immediate write attribution. Combined account views can reuse one response within a request, not a long-lived balance cache.
- Unspecified balances show spot and Futures separately with no cross-product or cross-coin arithmetic. One-side failure retains available results and marks incompleteness; failure is never zero balance.
- Transactions use assetType=0 and business types 1-13 plus 28. Include apportionment, fee sharing, bonus, public/private transfers and merchant risk-reserve sharing. Exclude grid/robot and KOL/follow types. Normal output adds no filtering-scope notice; genuine truncation/errors remain visible. Do not present an upstream pre-filter count as the filtered total.

## 7. Trading and confirmation

One ordinary placement schema uses explicit intent open-long/open-short/close-long/close-short and LIMIT/MARKET, with exactly one quantity unit coin/contracts/value. Map to BUY/SELL and OPEN/CLOSE only for verified mode semantics. LIMIT requires a positive price; MARKET rejects a user limit price/TIF. Margin mode is explicit; never silently adjust leverage/mode to make an order work. Generate a stable clientOrderId before preview, within the verified format/length, and preserve it through reconciliation.

GET order uses query parameters with contract plus exactly one orderId/clientOrderId. Direct ordinary cancellation uses published orderId; resolve user-supplied client identity by read first. Preserve Futures status semantics separately from spot.

Conditional and TP/SL requests are submitted to the exchange with trigger prices after confirmation. The exchange observes prices and triggers them; no Agent monitor or delayed ordinary order. Keep condition trigger enums distinct from TP/SL. TP/SL supports at most five entries, positive integer contracts and unit 2. No assumed OCO or auto-cancel sibling behavior. Never select the first position when a target is ambiguous.

All ten Futures writes and the reused transfer write follow prepare -> complete preview -> stop -> subsequent explicit user confirmation -> confirm once. Retain the current five-minute single-use expiry unless a later approved change is needed. Core guarantees binding and one-shot dispatch; Skills/client interaction supplies the separate-user-message requirement. Core alone cannot prove a human authored a new message when an arbitrary caller directly invokes tools; do not claim otherwise.

Preview binds action, validated arguments, account/profile/product/config generation, target scope and expiry. A changed material intent requires a new preview. Revalidate required conditions immediately before dispatch. All-cancel is the approved exception to order-set drift: it targets execution-time account-wide ordinary orders, including those added since preview. New order IDs alone do not invalidate it. Do not include trigger orders or promise a fixed snapshot cancellation. Submit cancel_all only once.

Settings scope: position mode is account-wide despite the API contractName parameter; margin mode and leverage target the selected contract; margin adjustment targets a specific owned isolated position, positive delta adds and negative delta removes. Show current -> target when reliably known. No automatic cancellation, position closing or prerequisite repair. Missing mandatory information prevents prepare; unavailable readback must be explicit, not fabricated.

## 8. Persistence, uncertainty and concurrency

Persist confirmation consumption and a dispatch-intent state atomically before networking. A crash after dispatch intent but before a recorded response remains unknown; do not resend at restart. Track prepared, dispatch-intent, accepted/rejected/partial/unknown, and resolved states, keeping order lifecycle separate from request lifecycle.

Store non-secret normalized action/scope, generated operation IDs, timestamps, safe outcomes and configuration generation through local protected storage. Do not store API keys, signatures, credential references or raw requests. Use atomic updates and interprocess locking for CLI and MCP sharing the same local state directory. Different machines cannot be assumed coordinated.

Unknown blockers bind account/product/scope rather than only client ID: order intents reserve relevant exposure scope; settings reserve affected contract/position or account; transfer uncertainty affects corresponding transfer scope. Prevent changed IDs or overlapping modified parameters bypassing the blocker. Unrelated reads remain available. Document the conflict matrix and prove it with concurrency tests before release.

| Write family | Allowed evidence / limits |
| --- | --- |
| Ordinary placement | Exact original ID lookup and matching request identity; one not-found result is not proof of non-execution |
| Condition/TP-SL | Exact trigger identity and state coverage; current-list disappearance is insufficient |
| Ordinary cancellation | Target final status; filled is not cancelled |
| All ordinary cancellation | Coverage-aware remaining-order evidence and execution boundaries; partial coverage cannot prove all cancelled; no repeated drain loop |
| Mode/leverage setter | Trustworthy fresh target state; current state does not necessarily prove causation |
| Margin delta | Operation-level evidence; concurrent balance/position changes cannot attribute the delta |
| Transfer | Exact transfer identity and verified history/final-state contract; balance delta alone is insufficient |

Reconcile only through reads. Proposed foreground budget: at most three read dispatches total over 30 seconds per reconciliation attempt, including any read retry, with mandatory spacing; expose a later explicit status check if consistency delays exceed this. No perpetual background polling. If reliable evidence remains unavailable, preserve unknown and block overlapping writes. Manual resolution requires an explicit evidence-bearing action and audit record, not timeout expiry or another confirmation of the original intent. Detailed readback gaps below remain visible.

## 9. Pagination, time and throttling

Paged Futures reads default to 20 and cap at 50 per call, subject to stricter upstream bounds; depth applies per side. Do not mistake a display cap for backend coverage. For an unpaged response, retain a bounded immutable local snapshot for truthful continuation or report unavailable continuation; never discard undisplayed rows and jump to the next backend page. Any snapshot storage uses the same protected local-data rules, no credentials, and an explicit expiry.

History input windows are at most six calendar months, interpreted in the user's specified/configured time zone with month-end clamping. Normalize internally to milliseconds; serialize per verified endpoint. Do not promise six months of retrievable history where the API imposes a recent-ID window. Do not invent unsupported time parameters or silently split a longer request.

Source-guided pagination: orderHistorical fromId is orderId but the inspected query combines id > bound with descending time; backward continuation is unresolved. profitHistorical fromId is position id with id >= bound and ascending ID; use lossless integer successor for continuation after a fully consumed page, handling maximum-ID exhaustion. myTrades cursor is tradeId, with recent-window and branch-specific behavior needing tracing. Transaction and trigger lists use page+limit. openOrders does not currently establish a public continuation mechanism. Filters must not turn an empty page into a false end-of-list; maintain accurate progress and bound scans.

Enforce at least 1,000 ms between actual request starts for the same method/path across participating local Core processes, including pagination, reconciliation and retries. Use a shared locked scheduler keyed by endpoint identity (origin + method + path), not tool name; two profiles pointing to the same endpoint cannot bypass spacing. This local rule does not claim exchange-wide coordination across devices. Apply any stricter verified shared platform quotas too. Timestamp/sign only after a rate slot is granted.

Proposed ordinary read budget: 10-second transport timeout, 30-second total foreground budget including queue/backoff, at most one automatic retry for transient transport failures or HTTP 429/502/503/504. Respect Retry-After within budget; otherwise return retry-later. No retries for business/auth/parameter/schema failures. Writes: one dispatch, proposed 10-second response timeout then unknown as appropriate; no automatic retries. Queued confirmation must still be valid at dispatch. These numerical budgets are final-design proposals, not previously verified platform limits.

## 10. Skills and frontend handoff

Six Skills: ai-hub-futures router; common for connectivity/rules/market; account for assets/positions/PnL/transactions; order for query/fills/cancellation; trade for placement and four settings; transfer for spot-routed transfers. MCP first; CLI fallback only before a possible dispatch. Transport fallback must not repeat a write.

Provide descriptions, supported intent examples, required information, preview behavior, limitations and installation/use documentation for the spot frontend team's display. No website changes in this delivery. Repository Skill content/product artifacts remain English; discussions and design explanations to this owner remain Chinese.

## 11. Open contract facts and completion gates

Engineering first resolves facts from the allowed public specification and the actual local call chain, without asking the owner to rediscover fields. Local source does not establish deployed parity. Record exact evidence and seek clarification only for contradictions or absent facts. No backend modifications are part of resolving these items.

| Gate | Unresolved fact / delivery consequence |
| --- | --- |
| G1 Serialization and fixtures | Exact conditional required fields, enum combinations, success/error/partial-result examples and header applicability; no invented authoritative fixtures |
| G2 Trading rules | Mode mapping, quantities/conversions/rounding, bounds and MARKET serialization; ambiguous or unsupported combinations cannot dispatch |
| G3 Pagination | History/fill branch sorting and continuation, public open-order coverage, stable page behavior; do not advertise full-history or full-cancel verification without evidence |
| G4 cancel_all | Local code uses a bounded backend page and ignores individual RPC results; cannot promise all-order completion or partial-failure reporting from generic success |
| G5 Triggers | Trigger price reference/equality, IDs, target-position disambiguation, terminal lookup, batch-cancel maximum and partial result contract |
| G6 Settings / unknown writes | Reliable settings readback with no positions, account-cache freshness, margin-delta attribution and evidence-backed manual resolution |
| G7 Assets and market units | Authoritative asset meanings, rate/volume units and timestamps; preserve distinct raw values with explicit uncertainty rather than compute guesses |
| G8 Transfer identity | Supported same-account pairing evidence, transferable amount/fees and unique transfer history lookup |
| G9 Runtime verification | Authorized environment, sanitized fixtures, deployed parity and acceptance operator; no production calls performed or implied |

No claim that all fields are finalized or all 25 operations are ready for live use. Approval of architecture permits subsequent implementation only when explicitly granted by the owner; unresolved facts block the affected behavior, not automatically unrelated work. Do not silently deliver a reduced scope as complete.

## 12. Implementation and acceptance sequence

1. After design approval: complete evidence-backed endpoint/schema matrix and fixtures; reconcile project scope docs/denylist intentionally for the approved Futures allowlist while retaining other exclusions.
2. Extend profile/product capabilities, execution context and Futures transport/parsing with spot regression coverage.
3. Deliver reads, output normalization, source-based pagination, routing and shared local throttling.
4. Extend shared write persistence/conflict handling, then implement all ten Futures writes and restricted spot transfers with preview/reconciliation contracts.
5. Generate CLI/MCP exposure, six Skills and frontend handoff documentation; implement migration tooling without changing actual user profiles.
6. Run existing build/typecheck/tests/release checks plus targeted Futures scenarios; record approved scope coverage, outstanding contract gates and live-acceptance status. Prepare release notes and migration instructions without publishing automatically.

Acceptance covers all 25+3 HTTP mappings; exact signing and version metadata; large IDs/decimal tokens; per-endpoint errors; paging boundaries/filtered-empty pages; half-year limits and DST/calendar edges; interprocess one-second spacing; read retry budgets; wrong-product/least-privilege rejection; duplicate confirms and crash recovery; unknown/partial outcomes; account-wide cancellation drift; exchange-managed triggers; spot compatibility and both transfer directions. Mock/source-fixture evidence is not live acceptance. Real writes require individual previews and explicit subsequent confirmations in an authorized environment.

## 13. Approval recorded

The owner subsequently approved the consolidated design and explicitly instructed development to begin. Approach A, the operation mapping and runtime budgets are the implementation baseline. Development changes only this repository. No actual profile, credential configuration, external server, frontend or database is changed by this authorization. Earlier proposal wording records the design history; current implementation evidence is in ../docs/FUTURES_DELIVERY.md.
