# Futures delivery and acceptance record

Date: 2026-09-14. Status: implemented in the local AI Hub checkout; live acceptance pending. This is an unreleased extension on the existing 0.1.20 package baseline. No package has been published and no installed client configuration has been changed.

## Delivered scope

- Separate Futures adapter and allowlisted operation contracts: 25 HTTP operations, 26 semantic Core/CLI/MCP operations (account assets and positions are separate views), including all ten approved write operations.
- Three existing spot transfer operations reused for both 1 -> 5 and 5 -> 1. The transfer MCP toolset limits exposure to those account types and requires recorded operator-verified pairing for writes.
- Product-aware profiles, explicit migration dry run/apply, credential detachment on endpoint change, and pairing invalidation after profile/credential changes. Intent routing uses spot and futures; balances remain separate without arithmetic totals.
- Lossless Futures numeric parsing, output field allowlists, transaction types 1-13 plus 28, bounded list output, source-based cursor handling, six-calendar-month UTC timestamp windows, local cross-process same-interface throttling and bounded read retries.
- Shared one-time prepare/confirm with expiry and context binding. New overlapping Futures previews invalidate old previews. All writes dispatch once; Futures and transfer unknown outcomes persist with operation IDs and require evidence-based resolution. Exchange-managed conditional/TP-SL orders do not create Agent price watchers.
- Six source Skills, operation reference, setup/migration instructions and frontend handoff information. No Futures backend or frontend code changes.

See [operating instructions and limitations](FUTURES.md) and [the generated operation reference](FUTURES_OPERATIONS.md). Regenerate the reference with `node --import tsx scripts/generate-futures-reference.mjs`.

## Automated evidence

Validation completed:

- `pnpm release-check`: passed, including type checks, 152 tests (Core 129, CLI 8, MCP 15), denylist and release/version checks.
- `pnpm build`: passed for Core, CLI and MCP bundles and declarations.
- Official Skill validator: all six Futures Skills passed.
- `git diff --check`: passed.

The standard test runner needed permission to create its local tsx IPC socket outside the sandbox. Test data uses synthetic identifiers, mocked HTTP responses and temporary state directories. The tests do not contact exchange services. Source-derived expectations are not captured production fixtures.

Coverage includes the approved operation inventory, exact signing bytes and version headers, large IDs/decimal tokens, read retries versus one-shot writes, product isolation and transfer restrictions, all ten write preview/confirm flows, superseded and consumed previews, filtered transaction continuation, snapshot binding, migration/pairing invalidation, scheduling and queued expiry, durable unknown outcomes and operator resolution, and both transfer directions with balance changes before confirmation. Existing spot tests remain in the release suite.

Skill validation uses the official skill-creator quick validator. Its PyYAML dependency was installed only under a temporary directory, not into this project or the user's global environment.

## Frontend handoff

The spot frontend team can use each Skill's description and agents/openai.yaml metadata for presentation. Keep the following boundaries visible in the Skill explanation:

| Skill | Display responsibility |
| --- | --- |
| ai-hub-futures | Product routing, capability discovery, separate balance components |
| ai-hub-futures-common | Connectivity, contract rules and market data |
| ai-hub-futures-account | Assets, positions, historical PnL and transactions |
| ai-hub-futures-order | Order queries, user fills and ordinary/trigger cancellation |
| ai-hub-futures-trade | Ordinary, conditional and TP/SL placement; four trading settings |
| ai-hub-futures-transfer | Spot-routed transfer queries and separately confirmed transfers |

Display the preview/next-message-confirm rule and the difference between submission acceptance, triggering and execution. Do not describe all-cancel acknowledgment as verified completion or describe the three deferred capabilities as implemented.

## Remaining live acceptance

An authorized operator must configure the intended local profiles and credentials, review/apply migration if needed, verify account pairing, install/register the built MCP/Skills, and validate against the intended environment. These are not actions performed by this development change.

1. Verify public connectivity, exact contract names and market field units/timestamps.
2. Validate signed reads, version headers, account/position meaning, history cursors and response envelopes against deployed behavior.
3. Validate each placement unit and mode combination, conditional/TP-SL identities, cancellation behavior and all four settings under their real prerequisites. Every real write needs its own preview and subsequent user confirmation.
4. Validate both transfer directions with operator-established pairing and published transferable balance fields; test unknown handling only in an appropriate controlled environment.
5. Establish authoritative readback/operation evidence where available. Until then, retain unresolved state for ambiguous outcomes; do not infer success from balance deltas, disappearance from current lists or elapsed time.

Known contract constraints: ordinary history/user-fill backward coverage is not established; local cancel_all implementation has a bounded query and lacks per-order result reporting; cached accounts cannot attribute settings/margin changes; trigger terminal and partial-result coverage is incomplete; transfer history lacks a documented unique operation identifier. Detailed consequences are in FUTURES.md. These limits must remain part of acceptance and must not be hidden by frontend descriptions.

Deferred by explicit agreement: public recent market trades, ordinary batch placement, selected ordinary batch cancellation. Also excluded: ticker_all, WebSocket, KOL/copy/grid/robot and internal APIs.

## Subsequent local installation: 2026-09-15

The owner subsequently authorized migration of the existing local setup. The offline installer migrated smoke -> spot and default -> futures with product markers, preserving endpoints and stored credentials. It registered aihub-spot and aihub-futures in Codex in read-only mode, installed twelve Skills under ~/.agents/skills, and added command wrappers under ~/.local/bin. Private configuration backups remain under ~/.ai-hub/install-backups. This supersedes the earlier development-only statement for this later installation activity; it does not constitute production API acceptance.

The installer has fresh-install and migration fixture tests, collision checks, private backups and rollback. Shared spot Skill routing was updated to route Futures requests correctly. No exchange API was called. See INSTALL_SPOT_FUTURES.zh-CN.md for the combined Chinese installation manual.
